// Ingestion infrastructure only. This node materializes an n8n-native binary
// item; a dedicated HTTP Request node owns the Storage upload.
function unwrapWhatsAppMessage(raw = {}) {
  let message = raw?.data?.message || raw?.message || raw || {};
  for (const key of ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'documentWithCaptionMessage']) {
    if (message?.[key]?.message) message = message[key].message;
  }
  return message;
}

function mediaNumber(value) {
  if (Number.isFinite(Number(value))) return Math.max(0, Number(value));
  if (value && typeof value === 'object' && Number.isFinite(Number(value.low))) {
    return (Number(value.low) >>> 0) + (Number(value.high || 0) >>> 0) * 4294967296;
  }
  return 0;
}

function mediaError(error, fallback) {
  return String(error?.message || error || fallback)
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 180);
}

function extensionFor(kind, mimeType, fileName = '') {
  const fromName = String(fileName).match(/\.([a-z0-9]{1,12})$/i)?.[1];
  if (fromName) return fromName.toLowerCase();
  const byMime = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
    'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/webm': 'webm',
    'video/mp4': 'mp4', 'video/webm': 'webm', 'video/3gpp': '3gp',
    'application/pdf': 'pdf',
  };
  return byMime[mimeType] || (kind === 'sticker' ? 'webp' : kind === 'document' ? 'bin' : kind);
}

function allowedMime(kind, mimeType) {
  const allowed = {
    image: ['image/jpeg', 'image/png', 'image/webp'],
    sticker: ['image/webp'],
    audio: ['audio/ogg', 'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/m4a', 'audio/wav', 'audio/x-wav', 'audio/aac', 'audio/flac', 'audio/webm'],
    video: ['video/mp4', 'video/webm', 'video/3gpp'],
  };
  return kind === 'document'
    ? /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mimeType)
    : Boolean(allowed[kind]?.includes(mimeType));
}

function magicFor(mimeType, bytes) {
  if (!bytes || bytes.length < 4) throw new Error('media_payload_empty');
  const magic = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 12))).toString('hex');
  const has = (...expected) => expected.every((byte, index) => bytes[index] === byte);
  const mime = String(mimeType || '').toLowerCase();
  if ((mime === 'image/jpeg' || mime === 'image/jpg') && !has(0xff, 0xd8, 0xff)) throw new Error('media_magic_mismatch');
  if (mime === 'image/png' && !has(0x89, 0x50, 0x4e, 0x47)) throw new Error('media_magic_mismatch');
  if (mime === 'image/webp' && (bytes.length < 12 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP')) throw new Error('media_magic_mismatch');
  if (mime === 'audio/ogg' && !has(0x4f, 0x67, 0x67, 0x53)) throw new Error('media_magic_mismatch');
  if (mime === 'application/pdf' && !has(0x25, 0x50, 0x44, 0x46)) throw new Error('media_magic_mismatch');
  if (['video/mp4', 'audio/mp4', 'audio/m4a'].includes(mime) && !bytes.subarray(0, Math.min(bytes.length, 32)).toString('ascii').includes('ftyp')) throw new Error('media_magic_mismatch');
  return magic;
}

function sourceDescriptor(input) {
  const message = unwrapWhatsAppMessage(input.raw_payload);
  const source = input?.queued?.event_id ? input : input;
  const fallback = input?.source_media || {};
  const entries = [
    ['image', message.imageMessage], ['audio', message.audioMessage], ['video', message.videoMessage],
    ['document', message.documentMessage], ['sticker', message.stickerMessage],
  ];
  const found = entries.find(([, value]) => value && typeof value === 'object');
  const kind = found?.[0] || String(fallback.kind || '').toLowerCase();
  if (!kind) return null;
  const raw = found?.[1] || {};
  const defaults = { image: 'image/jpeg', audio: 'audio/ogg', video: 'video/mp4', document: 'application/octet-stream', sticker: 'image/webp' };
  const mimeType = String(fallback.mime_type || raw.mimetype || raw.mimeType || defaults[kind] || '').split(';')[0].trim().toLowerCase();
  return {
    kind,
    category: kind,
    source: 'whatsapp',
    caption: String(fallback.caption || raw.caption || ''),
    fileName: String(fallback.file_name || raw.fileName || raw.file_name || ''),
    mimeType,
    size: mediaNumber(fallback.file_length || raw.fileLength || raw.file_length),
    duration: mediaNumber(fallback.duration || raw.seconds || raw.duration),
    width: mediaNumber(fallback.width || raw.width),
    height: mediaNumber(fallback.height || raw.height),
  };
}

const input = $json;
const queued = input.queued || {};
const descriptor = sourceDescriptor(input);
const eventId = String(queued.event_id || '').trim();
const messageId = String(input.messageId || '').trim();
const limit = 10 * 1024 * 1024;

if (!descriptor || !eventId || queued.duplicate) {
  return { json: { ...input, media_ingestion: { present: Boolean(descriptor), should_upload: false, skipped: queued.duplicate ? 'duplicate' : 'not_media' } } };
}

const bucket = String($env.WHATSAPP_MEDIA_BUCKET || 'channel-media').trim();
const safeChat = String(input.remoteJid || '').replace(/[^a-zA-Z0-9._-]/g, '_');
const safeMessageId = messageId.replace(/[^a-zA-Z0-9._-]/g, '_');
const base = {
  ...descriptor,
  origin: input.is_manual_whatsapp_outbound ? 'whatsapp_fromMe' : 'inbound',
  bucket,
  storagePath: [String(input.tenant_slug || '').replace(/[^a-zA-Z0-9_-]/g, ''), 'whatsapp', safeChat, `${safeMessageId}.${extensionFor(descriptor.kind, descriptor.mimeType, descriptor.fileName)}`].join('/'),
  encoding: 'binary',
  verified: false,
};

function failed(status, error) {
  return { json: { ...input, media_ingestion: { present: true, should_upload: false, event_id: eventId, external_message_id: messageId, media: { ...base, status, error: mediaError(error, status) } } } };
}

if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(bucket)) return failed('storage_error', 'media_storage_bucket_invalid');
if (!allowedMime(descriptor.kind, descriptor.mimeType)) return failed('unsupported', 'media_format_unsupported');
if (descriptor.size > limit) return failed('too_large', 'media_too_large');

function downloadFailure(error) {
  const status = Number(error?.statusCode || error?.status || error?.response?.status || 0);
  if (status === 401 || status === 403) return 'evolution_auth_failed';
  if ([408, 425, 429, 500, 502, 503, 504].includes(status) || /timeout|timed out|econnreset|socket|temporar|rate.?limit/i.test(String(error?.message || error || ''))) return 'evolution_download_transient';
  return 'evolution_download_failed';
}

let downloaded;
let downloadError = null;
try {
  const suffix = String(input.tenant_slug || '').toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const request = {
    method: 'POST',
    url: String($env[`EVOLUTION_API_URL_${suffix}`] || '').replace(/\/$/, '') + '/chat/getBase64FromMediaMessage/' + encodeURIComponent(String(input.instance || $env[`EVOLUTION_INSTANCE_${suffix}`] || '')),
    headers: { apikey: $env[`EVOLUTION_API_KEY_${suffix}`], 'Content-Type': 'application/json' },
    body: { message: { key: { id: messageId, remoteJid: input.remoteJid, fromMe: Boolean(input.is_manual_whatsapp_outbound) } }, convertToMp4: false },
    json: true, timeout: 30000,
  };
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try { downloaded = await this.helpers.httpRequest(request); break; }
    catch (error) {
      downloadError = error;
      if (attempt === 2 || downloadFailure(error) !== 'evolution_download_transient') break;
    }
  }
} catch (error) {
  downloadError = error;
}
if (!downloaded) return failed('download_failed', downloadFailure(downloadError));

try {
  const mimeType = String(downloaded.mimetype || downloaded.mimeType || descriptor.mimeType).split(';')[0].trim().toLowerCase();
  const base64 = String(downloaded.base64 || '').replace(/^data:[^,]+;base64,/, '');
  if (!allowedMime(descriptor.kind, mimeType)) throw new Error('media_format_unsupported');
  if (!base64) throw new Error('media_payload_missing');
  if (base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error('media_invalid_base64');
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length) throw new Error('media_payload_empty');
  if (bytes.length > limit) throw new Error('media_too_large');
  const magic = magicFor(mimeType, bytes);
  const media = { ...base, mimeType, size: bytes.length, storagePath: base.storagePath.replace(/\.[^.]+$/, `.${extensionFor(descriptor.kind, mimeType, descriptor.fileName)}`), status: 'pending', magic };
  const binary = await this.helpers.prepareBinaryData(bytes, media.fileName || `whatsapp-${messageId}.${extensionFor(descriptor.kind, mimeType, descriptor.fileName)}`, mimeType);
  return {
    json: { ...input, media_ingestion: { present: true, should_upload: true, event_id: eventId, external_message_id: messageId, expectedSize: bytes.length, mimeType, magic, media } },
    binary: { media_file: binary },
  };
} catch (error) {
  const code = String(error?.message || '');
  return failed(code === 'media_too_large' ? 'too_large' : code === 'media_payload_missing' ? 'missing_binary' : code === 'media_magic_mismatch' || code === 'media_format_unsupported' ? 'unsupported' : 'storage_error', code || 'media_prepare_failed');
}

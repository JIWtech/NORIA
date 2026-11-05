// Runs after the native HTTP Request node. Storage is considered available only
// after a 2xx upload and a scoped HEAD whose exact length matches the bytes sent.
function compactMediaError(error, fallback) {
  return String(error?.message || error || fallback)
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 180);
}

function responseStatus(value) {
  return Number(value?.statusCode || value?.status || value?.body?.statusCode || 0);
}

function headerValue(headers, name) {
  const lower = String(name).toLowerCase();
  const entries = Object.entries(headers || {});
  return entries.find(([key]) => String(key).toLowerCase() === lower)?.[1] || '';
}

function preparedInput() {
  if ($json?.media_ingestion) return { json: $json, binary: $binary || {} };
  const item = $('Preparar Mídia WhatsApp').item;
  return { json: item?.json || {}, binary: item?.binary || {} };
}

const prepared = preparedInput();
const source = prepared.json;
const job = source.media_ingestion || {};

if (!job.present) return { json: source, binary: prepared.binary };

let media = { ...(job.media || {}) };
if (job.should_upload) {
  const status = responseStatus($json);
  if (status < 200 || status >= 300) {
    media = { ...media, status: 'storage_error', verified: false, error: `storage_upload_failed:${status || 'unknown'}` };
  } else {
    try {
      const base = String($env.SUPABASE_URL || '').replace(/\/$/, '');
      const serviceKey = $env.SUPABASE_SERVICE_ROLE_KEY;
      const verify = await this.helpers.httpRequest({
        method: 'HEAD',
        url: `${base}/storage/v1/object/${encodeURIComponent(media.bucket)}/${media.storagePath}`,
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        json: false,
        returnFullResponse: true,
        timeout: 20000,
      });
      const verifyStatus = responseStatus(verify);
      if (verifyStatus < 200 || verifyStatus >= 300) throw new Error(`storage_verify_failed:${verifyStatus || 'unknown'}`);
      const storedSize = Number(headerValue(verify.headers || verify.response?.headers, 'content-length'));
      if (!Number.isFinite(storedSize) || storedSize !== Number(job.expectedSize)) throw new Error('storage_size_mismatch');
      media = { ...media, status: 'stored', verified: true, storedSize, size: storedSize, magic: job.magic || media.magic || '' };
    } catch (error) {
      const code = String(error?.message || 'storage_verify_failed');
      media = { ...media, status: 'storage_error', verified: false, error: code.includes('storage_size_mismatch') ? 'storage_size_mismatch' : compactMediaError(error, 'storage_verify_failed') };
    }
  }
}

const tenantId = String(source.tenant_id || '').trim();
const eventId = String(job.event_id || '').trim();
const externalMessageId = String(job.external_message_id || '').trim();
const chatId = String(source.remoteJid || '').trim();
let persistenceError = '';

if (!tenantId || !eventId || !externalMessageId || !chatId) {
  persistenceError = 'media_identity_missing';
  media = { ...media, status: 'persistence_error', verified: false, error: persistenceError };
} else {
  const base = String($env.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = $env.SUPABASE_SERVICE_ROLE_KEY;
  let result;
  try {
    result = await this.helpers.httpRequest({
      method: 'POST',
      url: base + '/rest/v1/rpc/magia_confirm_whatsapp_media',
      headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Content-Type': 'application/json' },
      body: { p_tenant: tenantId, p_event: eventId, p_channel: 'whatsapp', p_conversation: chatId,
        p_external_message: externalMessageId, p_media: media },
      json: true,
      timeout: 10000,
    });
  } catch (_) {
    persistenceError = 'media_atomic_rpc_transport_failed';
    media = { ...media, status: 'persistence_error', verified: false, error: persistenceError };
  }
  const confirmationResult = Array.isArray(result) ? result[0] : result;
  const normalizeNoriaMime = (value) => {
    const normalized = String(value || '').toLowerCase().replace(/\s+/g, '');
    if (/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(normalized)) {
      return { value: normalized, base: normalized };
    }
    if (normalized === 'audio/ogg;codecs=opus') return { value: normalized, base: 'audio/ogg' };
    return null;
  };
  const equivalentNoriaMime = (left, right) => {
    const a = normalizeNoriaMime(left);
    const b = normalizeNoriaMime(right);
    return Boolean(a && b && a.base === b.base && (a.base === 'audio/ogg' || a.value === b.value));
  };
  const sameObject = confirmationResult?.stored_media
    && confirmationResult.stored_media.bucket === media.bucket
    && confirmationResult.stored_media.storagePath === media.storagePath
    && equivalentNoriaMime(confirmationResult.stored_media.mimeType, media.mimeType)
    && Number(confirmationResult.stored_media.size || 0) === Number(media.size || 0)
    && confirmationResult.stored_media.status === 'stored'
    && confirmationResult.stored_media.verified === true
    && media.status === 'stored'
    && media.verified === true;
  if (!persistenceError && (!confirmationResult
    || (confirmationResult.applied !== true
      && !(confirmationResult.reason === 'already_stored' && sameObject)))) {
    persistenceError = 'media_atomic_confirmation_rejected';
    media = { ...media, status: 'persistence_error', verified: false, error: persistenceError };
  }
}

return {
  json: { ...source, media_ingestion: { ...job, media, persisted: !persistenceError, persistence_error: persistenceError || undefined } },
  binary: prepared.binary,
};

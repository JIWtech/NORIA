const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const prepareCode = fs.readFileSync(path.join(root, 'n8n/code/whatsapp_prepare_media_ingestion.js'), 'utf8');
const finalizeCode = fs.readFileSync(path.join(root, 'n8n/code/whatsapp_finalize_media_ingestion.js'), 'utf8');
const workflowPath = path.join(root, 'n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json');
const corePath = path.join(root, 'n8n/code/whatsapp_conversation_core.generated.js');

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const OGG = Buffer.from('OggS\x00\x02voice-payload', 'binary');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x12, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF = Buffer.from('%PDF-1.7 test');
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 20]), Buffer.from('ftypisom'), Buffer.from('video')]);

const info = {
  image: { messageKey: 'imageMessage', mime: 'image/jpeg', bytes: JPEG },
  audio: { messageKey: 'audioMessage', mime: 'audio/ogg', bytes: OGG },
  video: { messageKey: 'videoMessage', mime: 'video/mp4', bytes: MP4 },
  document: { messageKey: 'documentMessage', mime: 'application/pdf', bytes: PDF },
  sticker: { messageKey: 'stickerMessage', mime: 'image/webp', bytes: WEBP },
};

function env() {
  return {
    SUPABASE_URL: 'https://db.example',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-not-persisted',
    EVOLUTION_API_URL_LOJA: 'https://evolution.example',
    EVOLUTION_API_KEY_LOJA: 'evolution-key-not-persisted',
    EVOLUTION_INSTANCE_LOJA: 'loja',
    WHATSAPP_MEDIA_BUCKET: 'channel-media',
  };
}

function inbound(kind, overrides = {}) {
  const fixture = info[kind] || info.image;
  const media = { mimetype: fixture.mime, fileLength: fixture.bytes.length, seconds: kind === 'audio' ? 3 : undefined };
  if (kind === 'document') media.fileName = 'documento.pdf';
  return {
    tenant_id: 'tenant-1',
    tenant_slug: 'loja',
    instance: 'loja',
    remoteJid: '5511999999999@s.whatsapp.net',
    messageId: `msg-${kind}-1`,
    queued: { event_id: `event-${kind}-1`, duplicate: false },
    raw_payload: { data: { message: { [fixture.messageKey]: media } } },
    ...overrides,
  };
}

async function prepare(input, { bytes, mime, downloadError = null, binaryResult } = {}) {
  const calls = [];
  const prepared = [];
  const fn = new AsyncFunction('$json', '$env', '$binary', prepareCode);
  const result = await fn.call({
    helpers: {
      async httpRequest(request) {
        calls.push(request);
        if (downloadError) throw new Error(downloadError);
        return { mimetype: mime || 'image/jpeg', base64: (bytes || JPEG).toString('base64') };
      },
      async prepareBinaryData(data, fileName, mimeType) {
        prepared.push({ data: Buffer.from(data), fileName, mimeType });
        return binaryResult || { id: 'native-n8n-binary', fileName, mimeType };
      },
    },
  }, input, env(), {});
  return { result, calls, prepared };
}

async function finalize(preparedItem, uploadResponse = { statusCode: 201 }, { headStatus = 200, headSize, confirmation } = {}) {
  const calls = [];
  let rpcPayload = null;
  const fn = new AsyncFunction('$json', '$env', '$binary', '$', finalizeCode);
  const result = await fn.call({
    helpers: {
      async httpRequest(request) {
        calls.push(request);
        if (request.method === 'HEAD') {
          return { statusCode: headStatus, headers: { 'content-length': String(headSize ?? preparedItem.json.media_ingestion.expectedSize) } };
        }
        if (request.method === 'POST' && /\/rpc\/magia_confirm_whatsapp_media$/.test(request.url)) {
          rpcPayload = request.body;
          if (confirmation !== undefined) return confirmation;
          return [{
            event_id: preparedItem.json.media_ingestion.event_id,
            applied: true,
            reason: 'confirmed',
            stored_media: request.body.p_media,
          }];
        }
        throw new Error(`Unexpected ${request.method}`);
      },
    },
  }, uploadResponse, env(), {}, (name) => {
    assert.equal(name, 'Preparar Mídia WhatsApp');
    return { item: preparedItem };
  });
  return { result, calls, rpcPayload };
}

function workflow() {
  return JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
}

function nodeByName(name) {
  const node = workflow().nodes.find((candidate) => candidate.name === name);
  assert.ok(node, `workflow must have node ${name}`);
  return node;
}

function nextNames(name) {
  const entries = workflow().connections[name]?.main || [];
  return entries.flat().map((edge) => edge.node);
}

function reaches(from, to) {
  const seen = new Set();
  const queue = [from];
  while (queue.length) {
    const current = queue.shift();
    for (const next of nextNames(current)) {
      if (next === to) return true;
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return false;
}

test('pipeline 1: image materializes a native n8n binary item', async () => {
  const { result, prepared } = await prepare(inbound('image'), { bytes: JPEG, mime: 'image/jpeg' });
  assert.equal(result.json.media_ingestion.should_upload, true);
  assert.equal(result.binary.media_file.id, 'native-n8n-binary');
  assert.equal(prepared.length, 1);
  assert.ok(prepared[0].data.equals(JPEG));
});

test('pipeline 2: JPEG binary starts with the expected magic bytes', async () => {
  const { result, prepared } = await prepare(inbound('image'), { bytes: JPEG, mime: 'image/jpeg' });
  assert.equal(result.json.media_ingestion.magic.slice(0, 6), 'ffd8ff');
  assert.ok(prepared[0].data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])));
});

test('pipeline 3: audio materializes OggS in the native binary item', async () => {
  const { result, prepared } = await prepare(inbound('audio'), { bytes: OGG, mime: 'audio/ogg' });
  assert.equal(result.json.media_ingestion.media.kind, 'audio');
  assert.equal(prepared[0].data.subarray(0, 4).toString('ascii'), 'OggS');
});

test('pipeline 4: video uses the same binary preparation path', async () => {
  const { result, prepared } = await prepare(inbound('video'), { bytes: MP4, mime: 'video/mp4' });
  assert.equal(result.json.media_ingestion.media.mimeType, 'video/mp4');
  assert.ok(prepared[0].data.toString('ascii').includes('ftyp'));
});

test('pipeline 5: PDF document uses the same binary preparation path', async () => {
  const { result, prepared } = await prepare(inbound('document'), { bytes: PDF, mime: 'application/pdf' });
  assert.equal(result.json.media_ingestion.media.kind, 'document');
  assert.equal(prepared[0].data.subarray(0, 4).toString(), '%PDF');
});

test('pipeline 6: WebP sticker uses the same binary preparation path', async () => {
  const { result, prepared } = await prepare(inbound('sticker'), { bytes: WEBP, mime: 'image/webp' });
  assert.equal(result.json.media_ingestion.media.kind, 'sticker');
  assert.equal(prepared[0].data.subarray(8, 12).toString(), 'WEBP');
});

test('pipeline 7: PNG is accepted as a real image payload', async () => {
  const input = inbound('image', { raw_payload: { data: { message: { imageMessage: { mimetype: 'image/png' } } } } });
  const { result, prepared } = await prepare(input, { bytes: PNG, mime: 'image/png' });
  assert.equal(result.json.media_ingestion.media.mimeType, 'image/png');
  assert.ok(prepared[0].data.equals(PNG));
});

test('pipeline 8: pure text bypasses download and upload', async () => {
  const { result, calls, prepared } = await prepare({ ...inbound('image'), raw_payload: { data: { message: { conversation: 'olá' } } } });
  assert.equal(result.json.media_ingestion.should_upload, false);
  assert.equal(result.json.media_ingestion.skipped, 'not_media');
  assert.equal(calls.length, 0);
  assert.equal(prepared.length, 0);
});

test('pipeline 9: duplicate event bypasses download and upload', async () => {
  const { result, calls } = await prepare(inbound('image', { queued: { event_id: 'event-image-1', duplicate: true } }));
  assert.equal(result.json.media_ingestion.skipped, 'duplicate');
  assert.equal(calls.length, 0);
});

test('pipeline 10: Evolution download failure becomes unavailable without a binary item', async () => {
  const { result } = await prepare(inbound('image'), { downloadError: 'timeout' });
  assert.equal(result.json.media_ingestion.media.status, 'download_failed');
  assert.equal(result.binary, undefined);
});

test('pipeline 11: invalid Base64 never becomes a Storage upload', async () => {
  const input = inbound('image');
  const fn = new AsyncFunction('$json', '$env', '$binary', prepareCode);
  const result = await fn.call({ helpers: { httpRequest: async () => ({ mimetype: 'image/jpeg', base64: 'not valid' }), prepareBinaryData: async () => { throw new Error('must not prepare'); } } }, input, env(), {});
  assert.equal(result.json.media_ingestion.media.status, 'storage_error');
  assert.equal(result.json.media_ingestion.media.error, 'media_invalid_base64');
});

test('pipeline 12: mismatched JPEG magic is rejected before HTTP upload', async () => {
  const { result, prepared } = await prepare(inbound('image'), { bytes: Buffer.from('not-a-jpeg'), mime: 'image/jpeg' });
  assert.equal(result.json.media_ingestion.media.status, 'unsupported');
  assert.equal(result.json.media_ingestion.media.error, 'media_magic_mismatch');
  assert.equal(prepared.length, 0);
});

test('pipeline 13: declared media over 10 MiB is skipped before download', async () => {
  const huge = inbound('image', { raw_payload: { data: { message: { imageMessage: { mimetype: 'image/jpeg', fileLength: 10 * 1024 * 1024 + 1 } } } } });
  const { result, calls } = await prepare(huge, { bytes: JPEG, mime: 'image/jpeg' });
  assert.equal(result.json.media_ingestion.media.status, 'too_large');
  assert.equal(calls.length, 0);
});

test('pipeline 14: actual bytes, not provider length, determine expected upload size', async () => {
  const { result } = await prepare(inbound('image'), { bytes: JPEG, mime: 'image/jpeg' });
  assert.equal(result.json.media_ingestion.expectedSize, JPEG.length);
  assert.equal(result.json.media_ingestion.media.size, JPEG.length);
});

test('pipeline 15: metadata contains no Base64 or credential', async () => {
  const { result } = await prepare(inbound('image'), { bytes: Buffer.concat([JPEG, Buffer.from('do-not-persist')]), mime: 'image/jpeg' });
  const json = JSON.stringify(result.json);
  assert.doesNotMatch(json, /do-not-persist|base64|evolution-key-not-persisted|service-role-not-persisted/i);
});

test('pipeline 16: storage path is isolated by tenant, chat and message', async () => {
  const { result } = await prepare(inbound('image', { messageId: 'external/image:1' }), { bytes: JPEG, mime: 'image/jpeg' });
  assert.match(result.json.media_ingestion.media.storagePath, /^loja\/whatsapp\/5511999999999_s\.whatsapp\.net\/external_image_1\.jpg$/);
});

test('pipeline 17: two inbound images retain distinct event-scoped paths', async () => {
  const first = await prepare(inbound('image', { messageId: 'm-a', queued: { event_id: 'evt-a', duplicate: false } }), { bytes: JPEG, mime: 'image/jpeg' });
  const second = await prepare(inbound('image', { messageId: 'm-b', queued: { event_id: 'evt-b', duplicate: false } }), { bytes: JPEG, mime: 'image/jpeg' });
  assert.notEqual(first.result.json.media_ingestion.media.storagePath, second.result.json.media_ingestion.media.storagePath);
  assert.notEqual(first.result.json.media_ingestion.event_id, second.result.json.media_ingestion.event_id);
});

test('pipeline 18: successful upload plus exact HEAD size becomes stored', async () => {
  const prepared = await prepare(inbound('image'), { bytes: JPEG, mime: 'image/jpeg' });
  const { result, rpcPayload } = await finalize(prepared.result);
  assert.equal(result.json.media_ingestion.media.status, 'stored');
  assert.equal(result.json.media_ingestion.media.verified, true);
  assert.equal(result.json.media_ingestion.media.storedSize, JPEG.length);
  assert.equal(rpcPayload.p_media.status, 'stored');
});

test('pipeline 19: failed upload never becomes stored', async () => {
  const prepared = await prepare(inbound('image'), { bytes: JPEG, mime: 'image/jpeg' });
  const { result } = await finalize(prepared.result, { statusCode: 400 });
  assert.equal(result.json.media_ingestion.media.status, 'storage_error');
  assert.equal(result.json.media_ingestion.media.verified, false);
});

test('pipeline 20: upload 2xx with mismatched HEAD length is storage_size_mismatch', async () => {
  const prepared = await prepare(inbound('image'), { bytes: JPEG, mime: 'image/jpeg' });
  const { result } = await finalize(prepared.result, { statusCode: 201 }, { headSize: JPEG.length + 1 });
  assert.equal(result.json.media_ingestion.media.status, 'storage_error');
  assert.equal(result.json.media_ingestion.media.error, 'storage_size_mismatch');
});

test('pipeline 21: failed HEAD never becomes stored', async () => {
  const prepared = await prepare(inbound('audio'), { bytes: OGG, mime: 'audio/ogg' });
  const { result } = await finalize(prepared.result, { statusCode: 201 }, { headStatus: 404 });
  assert.equal(result.json.media_ingestion.media.status, 'storage_error');
  assert.equal(result.json.media_ingestion.media.verified, false);
});

test('pipeline 22: finalizer delegates the atomic merge to the RPC without reading raw payload', async () => {
  const prepared = await prepare(inbound('image'), { bytes: JPEG, mime: 'image/jpeg' });
  const { calls, rpcPayload } = await finalize(prepared.result);
  assert.ok(calls.some((call) => call.method === 'POST' && /\/rpc\/magia_confirm_whatsapp_media$/.test(call.url)));
  assert.ok(!calls.some((call) => call.method === 'GET' || call.method === 'PATCH'));
  assert.equal(rpcPayload.p_media.status, 'stored');
  assert.equal(Object.hasOwn(rpcPayload, 'raw_payload'), false);
});

test('pipeline 23: scope mismatch is reported instead of patching another event', async () => {
  const prepared = await prepare(inbound('image'), { bytes: JPEG, mime: 'image/jpeg' });
  const { result } = await finalize(prepared.result, { statusCode: 201 }, {
    confirmation: [{ applied: false, reason: 'event_scope_mismatch', stored_media: null }],
  });
  assert.equal(result.json.media_ingestion.media.status, 'persistence_error');
  assert.equal(result.json.media_ingestion.media.verified, false);
});

test('pipeline 24: upload node is an n8n HTTP Request binary upload', () => {
  const upload = nodeByName('Upload Mídia WhatsApp Storage');
  assert.equal(upload.type, 'n8n-nodes-base.httpRequest');
  assert.equal(upload.parameters.sendBody, true);
  assert.equal(upload.parameters.contentType, 'binaryData');
  assert.equal(upload.parameters.inputDataFieldName, 'media_file');
});

test('pipeline 25: generated workflow has preparation, condition, upload and finalizer nodes', () => {
  assert.equal(nodeByName('Preparar Mídia WhatsApp').type, 'n8n-nodes-base.code');
  assert.equal(nodeByName('Mídia WhatsApp precisa de upload?').type, 'n8n-nodes-base.if');
  assert.equal(nodeByName('Confirmar Mídia WhatsApp').type, 'n8n-nodes-base.code');
});

test('pipeline 26: workflow routes both upload branches through the finalizer', () => {
  assert.deepEqual(nextNames('Preparar Mídia WhatsApp'), ['Mídia WhatsApp precisa de upload?']);
  const branches = workflow().connections['Mídia WhatsApp precisa de upload?'].main;
  assert.equal(branches[0][0].node, 'Upload Mídia WhatsApp Storage');
  assert.equal(branches[1][0].node, 'Confirmar Mídia WhatsApp');
  assert.ok(nextNames('Upload Mídia WhatsApp Storage').includes('Confirmar Mídia WhatsApp'));
});

test('pipeline 27: queue and debounce remain downstream of the media finalizer', () => {
  assert.ok(nextNames('Confirmar Mídia WhatsApp').includes('Confirmar Recebimento Core'));
  // A topologia atual passa por nós de restauração de contexto; o que importa é a ordem finalizador → janela → motor.
  assert.ok(reaches('Confirmar Recebimento Core', 'Aguardar Janela de Mensagens'));
  assert.ok(reaches('Aguardar Janela de Mensagens', 'CORE - Resolver extensão do tenant'));
  assert.ok(!reaches('Aguardar Janela de Mensagens', 'Confirmar Mídia WhatsApp'));
});

test('pipeline 28: preparation uses n8n prepareBinaryData and never Storage fetch', () => {
  assert.match(prepareCode, /helpers\.prepareBinaryData\(/);
  assert.doesNotMatch(prepareCode, /globalThis\.fetch|storage\/v1\/object|body\s*:\s*bytes/);
});

test('pipeline 29: core no longer owns a Storage uploader or global fetch', () => {
  const core = fs.readFileSync(corePath, 'utf8');
  assert.doesNotMatch(core, /globalThis\.fetch|uploadSupabaseBinary|persistTurnWhatsAppMedia/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'n8n/code/whatsapp_core_runtime.js'), 'utf8'), /persistTurnWhatsAppMedia/);
});

test('pipeline 30: finalizer verifies storage only after the binary HTTP response', () => {
  assert.match(finalizeCode, /responseStatus\(\$json\)/);
  assert.match(finalizeCode, /method:\s*'HEAD'/);
  assert.match(finalizeCode, /storedSize !== Number\(job\.expectedSize\)/);
});

test('pipeline 31: ingestion stays before AI guards because it follows enqueue', () => {
  const start = nextNames('Registrar Mensagem na Fila');
  assert.deepEqual(start, ['Preparar Mídia WhatsApp']);
  const core = fs.readFileSync(corePath, 'utf8');
  assert.match(core, /contact_exclusion/);
  // O motor só lê mídia já armazenada e verificada; upload para o Storage não pertence a ele.
  assert.doesNotMatch(core, /method:\s*'(?:POST|PUT)'[^\n]{0,300}storage\/v1\/object/);
});

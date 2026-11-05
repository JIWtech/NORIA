const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const contextCode = fs.readFileSync(path.join(root, 'n8n/code/whatsapp_prepare_context.js'), 'utf8');
const syncContactCode = fs.readFileSync(path.join(root, 'n8n/code/whatsapp_sync_contact.js'), 'utf8');
const sentCode = fs.readFileSync(path.join(root, 'n8n/code/whatsapp_prepare_sent.js'), 'utf8');
const mediaCode = fs.readFileSync(path.join(root, 'n8n/code/whatsapp_send_product_media.js'), 'utf8');
const catalog = [{ category_key: 'pulseiras', label: 'Pulseiras', aliases: ['pulseira', 'pulseiras'], items: [1, 2, 3].map((n) => ({ url: `https://media.example/${n}.jpg` })) }];
const env = { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'test-key' };

async function syncContact(input = {}, { environment = env, contacts = [], evolution = null, failEvolution = false } = {}) {
  const fn = new AsyncFunction('$json', '$env', syncContactCode);
  const calls = [];
  const httpRequest = async (request) => {
    calls.push(request);
    const url = request.url;
    if (url.includes('/tenants?')) return [{ id: 'tenant-test' }];
    if (url.includes('/contacts?select=')) return contacts;
    if (url.endsWith('/rest/v1/contacts') && request.method === 'POST') {
      const created = { id: `contact-${contacts.length + 1}`, ...request.body, metadata: {} };
      contacts.push(created);
      return [created];
    }
    if (url.includes('/rest/v1/contacts?id=') && request.method === 'PATCH') return [];
    if (url.includes('/chat/fetchProfilePictureUrl/')) {
      if (failEvolution) throw new Error('timeout');
      return evolution || { profilePictureUrl: null };
    }
    throw Error(`Unexpected request ${request.method} ${url}`);
  };
  const result = await fn.call({ helpers: { httpRequest } }, {
    tenant_slug: 'loja', instance: 'loja', remoteJid: '5521992988071@s.whatsapp.net', phone: '5521992988071',
    contactName: 'Guilherme Santos', raw_payload: {}, ...input,
  }, environment);
  return { json: result.json, calls, contacts };
}

async function context(message, { history = [], boundary = null, environment = env, failSettings = false, failPrompt = false, failBoundary = false, tenant = 'loja', chat = 'chat', settings = {}, prompts = [], services = [], failCatalog = false, avatar = {} } = {}) {
  const fn = new AsyncFunction('$json', '$env', '$getWorkflowStaticData', contextCode);
  const json = { tenant_slug: tenant, remoteJid: chat, messageText: message, raw_payload: { apikey: 'do-not-persist' } };
  const httpRequest = async ({ url }) => {
    // Reserva de cota do Gemini (mesma RPC do motor): liberada nestes cenários.
    if (url.endsWith('/rest/v1/rpc/magia_gemini_reserve')) return { allowed: true, tenant_used: 0 };
    assert.ok(url.includes(tenant) || url.includes('tenant-test') || url.includes('evolution.example'));
    if (url.includes('/channel_events?') && url.includes('&or=')) {
      assert.ok(url.includes('&channel_type=eq.whatsapp'));
      assert.ok(url.includes('&external_conversation_id=eq.' + encodeURIComponent(chat)));
      if (failBoundary) throw new Error('Timeout');
      return boundary ? [boundary] : [];
    }
    if (url.includes('/channel_events?')) return history;
    if (url.includes('/tenants?')) return [{ id: 'tenant-test' }];
    if (url.includes('/contacts?select=')) return avatar.contacts || [{ id: 'contact-test', avatar_url: null, avatar_fetched_at: new Date().toISOString() }];
    if (url.endsWith('/rest/v1/contacts')) return [{ id: 'contact-test' }];
    if (url.includes('/rest/v1/contacts?id=')) return [];
    if (url.includes('/chat/fetchProfilePictureUrl/')) {
      if (avatar.fail) throw new Error('provider unavailable');
      return avatar.response || { profilePictureUrl: null };
    }
    if (url.includes('/tenant_settings?')) {
      if (failSettings) throw Object.assign(new Error('permission denied'), { statusCode: 403 });
      return [{ settings: { product_media_catalog: catalog, system_prompt: 'Prompt do cliente', commerce_mode: true, ...settings } }];
    }
    if (url.includes('/ai_agents?')) return [];
    if (url.includes('/ai_prompt_versions?')) {
      if (failPrompt) throw Object.assign(new Error('missing table'), { statusCode: 404 });
      return prompts;
    }
    if (url.includes('/tenant_service_catalog?')) {
      assert.ok(url.includes('&tenant_id=eq.tenant-test&active=eq.true'));
      if (failCatalog) throw Object.assign(new Error('Timeout'), { statusCode: 504 });
      return services;
    }
    throw Error('Unexpected request');
  };
  return (await fn.call({ helpers: { httpRequest } }, json, environment, () => ({}))).json;
}

const catalogSettings = { whatsapp_context_mode: 'tenant_catalog_v1', ai_model: 'gemini-2.5-flash-lite', commerce_mode: false, conversation_style_instructions: 'Tom da cliente' };
test('opt-in uses settings prompt plus real multi-tenant catalog, not old version', async () => {
  const result = await context('Qual o valor?', { settings: catalogSettings,
    prompts: [{ prompt: 'Versao anterior' }], services: [{ name: 'Servico A', price: 99.99 }, { name: 'Servico B', price: 149.99 }] });
  assert.ok(result.systemMessage.startsWith('Prompt do cliente'));
  assert.ok(!result.systemMessage.includes('Versao anterior'));
  assert.ok(result.systemMessage.includes('Tom da cliente'));
  assert.ok(result.systemMessage.includes('99.99'));
  assert.equal(result.catalog_diagnostics.service_catalog_count, 2);
  assert.equal(result.handoff, false);
  assert.equal(result.whatsapp_ai_model, 'models/gemini-2.5-flash-lite');
  assert.equal(result.whatsapp_ai_options.maxOutputTokens, 500);
});
test('legacy clients retain old prompt precedence and model options', async () => {
  const result = await context('oi', { prompts: [{ prompt: 'Versao anterior' }] });
  assert.equal(result.systemMessage, 'Versao anterior');
  assert.equal(result.whatsapp_ai_model, undefined);
  assert.equal(result.whatsapp_ai_options, undefined);
});
test('failed catalog read blocks generation with diagnostics, never silently invents a price', async () => {
  const result = await context('valor', { settings: catalogSettings, failCatalog: true });
  assert.equal(result.ai_allowed, false);
  assert.equal(result.ai_block_reason, 'service_catalog_unavailable');
  assert.equal(result.catalog_diagnostics.context_load_errors.at(-1).step, 'service_catalog');
});
test('partial catalog is not falsely marked complete and null price is not zero', async () => {
  const result = await context('todos os servicos', { settings: catalogSettings,
    services: Array.from({ length: 101 }, (_, i) => ({ name: 'Servico ' + i, price: null })) });
  assert.equal(result.catalog_diagnostics.service_catalog_complete, false);
  assert.equal(result.catalog_diagnostics.service_catalog_count, 100);
  assert.ok(result.systemMessage.includes('"preco_brl":null'));
  assert.equal(result.whatsapp_ai_options.maxOutputTokens, 2500);
});

test('explicit category selects three media items and strips incoming API key', async () => {
  const result = await context('quero ver pulseiras');
  assert.equal(result.product_media_matches.length, 3);
  assert.equal(result.catalog_diagnostics.selection_source, 'current_message');
  assert.equal(result.raw_payload.apikey, undefined);
});

test('prepare context stays fail-soft when contact sync has not supplied an avatar result', async () => {
  const result = await context('oi', {
    environment: { ...env, EVOLUTION_API_URL_LOJA: 'https://evolution.example', EVOLUTION_API_KEY_LOJA: 'test', EVOLUTION_INSTANCE_LOJA: 'loja' },
    avatar: { contacts: [{ id: 'contact-test', avatar_url: null, avatar_fetched_at: null }], fail: true },
  });
  assert.equal(result.raw_payload.contact_avatar.source, 'unresolved');
  assert.equal(result.avatarUrl, null);
  assert.equal(result.promptText.includes('Mensagem: oi'), true);
});

test('prepare context carries the avatar result produced by the canonical sync node', async () => {
  const result = await context('oi', {
    environment: { ...env, EVOLUTION_API_URL_LOJA: 'https://evolution.example', EVOLUTION_API_KEY_LOJA: 'test', EVOLUTION_INSTANCE_LOJA: 'loja' },
    avatar: { contacts: [{ id: 'contact-test', avatar_url: null, avatar_fetched_at: null }], response: { profilePictureUrl: 'https://pps.example/avatar.jpg' } },
  });
  assert.equal(result.raw_payload.contact_avatar.avatarUrl, null);
  assert.equal(result.raw_payload.contact_avatar.source, 'unresolved');
});
test('contact sync creates one canonical WhatsApp contact and reuses it on the next inbound', async () => {
  const contacts = [];
  const first = await syncContact({}, { contacts });
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].name, 'Guilherme Santos');
  assert.equal(contacts[0].external_handle, '5521992988071@s.whatsapp.net');
  const second = await syncContact({ contactName: '.' }, { contacts });
  assert.equal(contacts.length, 1);
  assert.equal(second.json.contact_sync.contactId, contacts[0].id);
  const identityPatches = second.calls.filter((call) => call.method === 'PATCH' && call.body?.external_handle);
  assert.equal(identityPatches.length, 1);
  assert.equal(identityPatches[0].body.name, undefined);
});
test('contact sync accepts emoji-only names but rejects punctuation placeholders', async () => {
  const emoji = await syncContact({ contactName: '🧋' }, { contacts: [] });
  assert.equal(emoji.contacts[0].name, '🧋');
  const placeholder = await syncContact({ contactName: '.' }, { contacts: [] });
  assert.equal(placeholder.contacts[0].name, null);
});
test('webhook avatar skips Evolution and is persisted as a completed fetch', async () => {
  const result = await syncContact({ raw_payload: { profilePictureUrl: 'https://cdn.example/webhook.jpg' } }, { contacts: [] });
  assert.equal(result.json.contact_sync.source, 'webhook');
  assert.equal(result.calls.some((call) => call.url.includes('/chat/fetchProfilePictureUrl/')), false);
  assert.ok(result.calls.some((call) => call.body?.avatar_url === 'https://cdn.example/webhook.jpg' && call.body?.avatar_fetched_at));
});
test('Evolution success records a long-lived avatar cache while transient errors do not', async () => {
  const success = await syncContact({}, {
    contacts: [{ id: 'contact-1', name: null, phone: null, external_handle: '5521992988071@s.whatsapp.net', source_channel: 'whatsapp', avatar_url: null, avatar_fetched_at: null, metadata: {} }],
    environment: { ...env, EVOLUTION_API_URL_LOJA: 'https://evolution.example', EVOLUTION_API_KEY_LOJA: 'test', EVOLUTION_INSTANCE_LOJA: 'loja' },
    evolution: { profilePictureUrl: 'https://cdn.example/evolution.jpg' },
  });
  assert.equal(success.json.contact_sync.source, 'evolution');
  assert.ok(success.calls.some((call) => call.body?.avatar_url === 'https://cdn.example/evolution.jpg' && call.body?.avatar_fetched_at));
  const failed = await syncContact({}, {
    contacts: [{ id: 'contact-2', name: null, phone: null, external_handle: '5521992988071@s.whatsapp.net', source_channel: 'whatsapp', avatar_url: null, avatar_fetched_at: null, metadata: {} }],
    environment: { ...env, EVOLUTION_API_URL_LOJA: 'https://evolution.example', EVOLUTION_API_KEY_LOJA: 'test', EVOLUTION_INSTANCE_LOJA: 'loja' },
    failEvolution: true,
  });
  assert.equal(failed.json.contact_sync.source, 'evolution_error');
  assert.equal(failed.calls.some((call) => call.body?.avatar_fetched_at), false);
});
test('a confirmed no-photo response writes the short explicit negative cache', async () => {
  const result = await syncContact({}, {
    contacts: [{ id: 'contact-1', name: null, phone: null, external_handle: '5521992988071@s.whatsapp.net', source_channel: 'whatsapp', avatar_url: null, avatar_fetched_at: null, metadata: {} }],
    environment: { ...env, EVOLUTION_API_URL_LOJA: 'https://evolution.example', EVOLUTION_API_KEY_LOJA: 'test', EVOLUTION_INSTANCE_LOJA: 'loja' },
    evolution: { profilePictureUrl: null },
  });
  const negative = result.calls.find((call) => call.body?.metadata?.whatsapp_avatar_negative_fetched_at);
  assert.equal(result.json.contact_sync.source, 'negative_cache');
  assert.ok(negative?.body?.avatar_fetched_at);
});
test('resend recovers category from inbound history even when previous send selected nothing', async () => {
  const result = await context('manda de novo', { history: [{ direction: 'inbound', message_text: 'pulseiras', raw_payload: {} }] });
  assert.equal(result.product_media_matches.length, 3);
  assert.equal(result.catalog_diagnostics.selection_source, 'conversation_history');
});
test('does not infer category from assistant text or a closed session', async () => {
  for (const history of [
    [{ direction: 'outbound', message_text: 'pulseiras' }],
    [{ service: 'conversation_closed' }, { direction: 'inbound', message_text: 'pulseiras' }],
  ]) {
    assert.equal((await context('manda de novo', { history })).product_media_matches.length, 0);
  }
});
test('missing runner env and settings errors are visible in persisted diagnostics', async () => {
  const missing = await context('pulseiras', { environment: {} });
  assert.equal(missing.catalog_diagnostics.context_load_errors[0].step, 'missing_supabase_env_in_code_node');
  const denied = await context('pulseiras', { failSettings: true });
  assert.deepEqual(denied.catalog_diagnostics.context_load_errors, [{ step: 'tenant_settings', status: 403 }]);
  assert.ok(denied.promptText.includes('Nao prometa enviar fotos'));
});
test('prompt lookup failure preserves tenant settings prompt and catalog', async () => {
  const result = await context('pulseiras', { failPrompt: true });
  assert.equal(result.systemMessage, 'Prompt do cliente');
  assert.equal(result.product_media_matches.length, 3);
});
test('payment acknowledgement keeps payment stage and does not send a catalog', async () => {
  const result = await context('SINAL PAGO pulseiras');
  assert.equal(result.stage, 'Verificar Sinal');
  assert.equal(result.handoff, true);
  assert.equal(result.ai_allowed, false);
  assert.equal(result.product_media_matches.length, 0);
});
test('media sender uses tenant credentials and records partial failures without dropping text', async () => {
  const base = await context('pulseiras');
  base.responseText = 'Aqui estao as opcoes';
  base.phone = '5500000000000';
  base.remoteJid = '5500000000000@s.whatsapp.net';
  base.instance = 'loja';
  base.should_send_response = true;
  let calls = 0;
  const fn = new AsyncFunction('$json', '$env', mediaCode);
  const result = await fn.call({ helpers: { httpRequest: async (request) => {
    assert.equal(request.headers.apikey, 'tenant-key');
    assert.equal(request.url, 'https://evolution.example/message/sendMedia/loja');
    assert.equal(request.body.number, base.remoteJid);
    if (++calls === 2) throw Object.assign(new Error('private failure detail'), { statusCode: 429 });
    return { key: { id: `media-${calls}` } };
  } } }, base, {
    EVOLUTION_API_URL_LOJA: 'https://evolution.example', EVOLUTION_API_KEY_LOJA: 'tenant-key',
  });
  assert.equal(calls, 3);
  assert.match(result.json.responseText, /parte das fotos/);
  assert.deepEqual(result.json.product_media_delivery.sent.map((x) => x.status), ['accepted', 'failed', 'accepted']);
});
test('generated workflow embeds exactly the tested source', () => {
  const w = JSON.parse(fs.readFileSync(path.join(root, 'n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json'), 'utf8'));
  const embedded = (name) => w.nodes.find((n) => n.name === name).parameters.jsCode.replace(/\r\n/g, '\n').trimEnd();
  const tested = (code) => code.replace(/\r\n/g, '\n').trimEnd();
  assert.equal(embedded('Preparar Contexto JIW'), tested(contextCode));
  assert.equal(embedded('Preparar Evento Enviado'), tested(sentCode));
  assert.equal(embedded('Enviar Fotos do Catalogo'), tested(mediaCode));
  assert.equal(embedded('Sincronizar Contato WhatsApp'), tested(syncContactCode));
  for (const node of w.nodes.filter((n) => n.type === 'n8n-nodes-base.code')) new AsyncFunction(node.parameters.jsCode);
});

const closed = { id: 'close-1', service: 'conversation_closed', created_at: '2026-09-21T15:00:00Z' };
test('open conversations without a close event keep their existing Redis memory', async () => {
  const result = await context('oi');
  assert.equal(result.memory_session_key, 'magia:chat:loja:chat');
});
test('closing an attendance changes Redis session and excludes old context', async () => {
  const old = { direction: 'inbound', message_text: 'pulseiras', created_at: '2026-09-21T14:59:00Z' };
  const before = await context('oi', { history: [old] });
  const after = await context('manda de novo', { history: [closed, old], boundary: closed });
  assert.notEqual(before.memory_session_key, after.memory_session_key);
  assert.equal(after.hasHistory, false);
  assert.equal(after.product_media_matches.length, 0);
  assert.equal(after.handoff, false);
  assert.equal(after.ai_allowed, true);
});
test('session stays stable after the close event leaves the 40-event history window', async () => {
  const first = await context('oi', { boundary: closed });
  const later = await context('pulseiras', { boundary: closed, history: Array.from({ length: 40 }, () => ({ created_at: '2026-09-21T15:05:00Z', message_text: 'oi' })) });
  assert.equal(first.memory_session_key, later.memory_session_key);
  assert.equal(later.hasHistory, true);
});
test('new close rotates again; other tenants and contacts have different keys', async () => {
  const first = await context('oi', { boundary: closed });
  const second = await context('oi', { boundary: { ...closed, id: 'close-2' } });
  const otherTenant = await context('oi', { boundary: closed, tenant: 'outro' });
  const otherContact = await context('oi', { boundary: closed, chat: 'outro' });
  assert.equal(new Set([first, second, otherTenant, otherContact].map((r) => r.memory_session_key)).size, 4);
});
test('boundary lookup failure never invokes Gemini with old memory', async () => {
  const result = await context('oi', { failBoundary: true });
  assert.equal(result.ai_allowed, false);
  assert.equal(result.ai_block_reason, 'conversation_state_unavailable');
});
test('pre-send guard discards replies generated before closing and permits current replies', async () => {
  const code = fs.readFileSync(path.join(root, 'n8n/code/whatsapp_validate_session.js'), 'utf8');
  const fn = new AsyncFunction('$json', '$env', code);
  const base = await context('oi', { boundary: closed });
  for (const [latest, expected] of [[closed, true], [{ ...closed, id: 'close-2' }, false]]) {
    const result = await fn.call({ helpers: { httpRequest: async () => [latest] } }, base, env);
    assert.equal(result.json.should_send_response, expected);
  }
  const failed = await fn.call({ helpers: { httpRequest: async () => { throw Error('unavailable'); } } }, base, env);
  assert.equal(failed.json.should_send_response, false);
});
test('workflow uses the computed Redis key and all sends pass through the session guard', () => {
  const w = JSON.parse(fs.readFileSync(path.join(root, 'n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json'), 'utf8'));
  assert.equal(w.nodes.find((n) => n.name === 'Memoria Redis da Conversa').parameters.sessionKey, '={{ $json.memory_session_key }}');
  assert.equal(w.connections['Restaurar Contexto para Envio'].main[0][0].node, 'Validar Sessao Antes do Envio');
  assert.equal(w.connections['Sessao ainda ativa?'].main[1][0].node, 'Responder Resposta Cancelada');
  const sendParents = Object.entries(w.connections).filter(([, connections]) => connections.main?.flat().some((edge) => edge.node === 'Enviar Resposta pela Evolution')).map(([name]) => name);
  assert.deepEqual(sendParents, ['Sessao ativa apos fotos?']);
  assert.equal(w.connections['Sessao ainda ativa?'].main[0][0].node, 'Enviar Fotos do Catalogo');
  assert.equal(w.connections['Enviar Fotos do Catalogo'].main[0][0].node, 'Validar Sessao Apos Fotos');
  assert.equal(w.nodes.find(n => n.name === 'Validar Sessao Apos Fotos').parameters.jsCode,
    w.nodes.find(n => n.name === 'Validar Sessao Antes do Envio').parameters.jsCode);
});

test('HTTP failures include sanitized provider detail and never claim photos were sent', async () => {
  const base = await context('pulseiras');
  base.should_send_response = true;
  base.responseText = 'Estou enviando tudo!';
  const fn = new AsyncFunction('$json', '$env', mediaCode);
  const result = (await fn.call({ helpers: { httpRequest: async () => ({ statusCode: 500, body: {
    response: { message: ['AxiosError: Request failed with status code 403 key=secret-test'] },
  } }) } }, base, { EVOLUTION_API_URL_LOJA: 'https://evolution.example', EVOLUTION_API_KEY_LOJA: 'secret-test', EVOLUTION_INSTANCE_LOJA: 'loja' })).json;
  assert.equal(result.stage, 'Qualificacao');
  assert.match(result.responseText, /consegui enviar/);
  assert.equal(result.product_media_delivery.sent[0].http_status, 500);
  assert.match(result.product_media_delivery.sent[0].error_detail, /403/);
  assert.ok(!JSON.stringify(result.product_media_delivery).includes('secret-test'));
});

test('no catalog, handoff and invalid session never send photos', async () => {
  const fn = new AsyncFunction('$json', '$env', mediaCode);
  for (const override of [{ product_media_matches: [] }, { handoff: true }, { should_send_response: false }]) {
    const base = { ...await context('pulseiras'), should_send_response: true, responseText: 'original', ...override };
    const result = (await fn.call({ helpers: { httpRequest: async () => { assert.fail('must not send'); } } }, base, {})).json;
    assert.equal(result.responseText, 'original');
    assert.equal(result.product_media_delivery.sent.length, 0);
  }
});

test('persisting outbound does not send photos a second time and preserves session', async () => {
  const base = { responseText: 'resposta real', conversation_session_id: 'close-1', product_media_delivery: { sent: [] } };
  const fn = new AsyncFunction('$json', '$', sentCode);
  const result = (await fn({ key: { id: 'text-1' } }, name => {
    assert.equal(name, 'Enviar Fotos do Catalogo');
    return { item: { json: base } };
  })).json;
  assert.equal(result.messageText, base.responseText);
  assert.equal(result.raw_payload.conversation_session_id, 'close-1');
});

test('full HTTP response requires message IDs before confirming catalog presentation', async () => {
  const fn = new AsyncFunction('$json', '$env', mediaCode);
  const base = { ...await context('pulseiras'), should_send_response: true };
  const environment = { EVOLUTION_API_URL_LOJA: 'https://evolution.example', EVOLUTION_API_KEY_LOJA: 'key', EVOLUTION_INSTANCE_LOJA: 'loja' };
  for (const accepted of [true, false]) {
    const result = (await fn.call({ helpers: { httpRequest: async () => ({ statusCode: 201, body: accepted ? { key: { id: 'image-id' } } : {} }) } }, base, environment)).json;
    assert.equal(result.stage, accepted ? 'Produtos apresentados' : 'Qualificacao');
    assert.equal(result.product_media_delivery.sent[0].status, accepted ? 'accepted' : 'unconfirmed');
  }
});

test('missing media credentials does not promise delivery', async () => {
  const fn = new AsyncFunction('$json', '$env', mediaCode);
  const base = { ...await context('pulseiras'), should_send_response: true, responseText: 'Enviei tudo' };
  const result = (await fn.call({ helpers: { httpRequest: async () => assert.fail('must not send') } }, base, {})).json;
  assert.equal(result.product_media_delivery.skipped, 'missing_or_placeholder_evolution_media_env');
  assert.match(result.responseText, /consegui enviar/);
  assert.equal(result.stage, 'Qualificacao');
});


// =========================================================================
// SECTION 2: NEW PERSISTENT WHATSAPP MEDIA PIPELINE TESTS
// =========================================================================

const generatedCode = fs.readFileSync(path.join(root, 'n8n/code/whatsapp_conversation_core.generated.js'), 'utf8');
const executeCore = new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', generatedCode);

const FIXTURE_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]), Buffer.from('binary-image-data-here')]);
const FIXTURE_JPEG_SHORT = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01]);
const FIXTURE_OGG = Buffer.from('OggS test audio content');
const FIXTURE_MP4 = Buffer.from('000000186674797069736f6d00000001', 'hex');
const FIXTURE_PDF = Buffer.from('%PDF-1.7 sample document');
const FIXTURE_WEBP = Buffer.from('524946460000000057454250', 'hex');

function createMockHarness({
  messages = [],
  rawPayloads = {},
  mediaFixtures = {},
  storageFailure = false,
  downloadFailure = false,
  controlHistory = [],
  contact = null,
  salesLead = null,
  aiModelResponse = null,
  contactExclusionEnabled = false,
  contactExclusion = null,
  failContactExclusion = false,
  disableFetch = false,
  verifySizeMismatch = false,
} = {}) {
  const calls = [];
  const uploads = [];
  const patches = [];
  const posts = [];
  const eventsInDb = {};

  // Seed DB events
  for (const m of messages) {
    eventsInDb[m.event_id] = {
      id: m.event_id,
      external_message_id: m.id,
      direction: 'inbound',
      tenant_slug: 'wesley_automoveis',
      channel_type: 'whatsapp',
      message_text: m.text,
      raw_payload: rawPayloads[m.event_id] || { channel_type: 'whatsapp', content_type: 'text', core_revision: 'conversation_core_v1' },
    };
  }

  const httpRequest = async ({ method, url, body, headers }) => {
    calls.push({ method, url, body, headers });
    const u = new URL(url);

    // Evolution getBase64FromMediaMessage
    if (u.pathname.includes('/chat/getBase64FromMediaMessage')) {
      if (downloadFailure) throw new Error('Evolution timeout');
      const msgId = body?.message?.key?.id;
      const fixture = mediaFixtures[msgId];
      if (fixture) return fixture;
      return {
        mimetype: 'image/jpeg',
        base64: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01]).toString('base64'),
      };
    }

    // Supabase Storage
    if (u.pathname.includes('/storage/v1/object/')) {
      if (storageFailure) throw new Error('Storage service 500 error');
      assert.ok(Buffer.isBuffer(body), 'Storage upload body must be a binary Buffer, never Base64');
      uploads.push({ url, body, headers, length: body.length });
      return { Key: 'stored' };
    }

    // Evolution sendText
    if (u.pathname.includes('/message/sendText')) {
      return { key: { id: 'outbound-msg-1' } };
    }

    // Gemini
    if (u.hostname === 'generativelanguage.googleapis.com') {
      if (aiModelResponse) return aiModelResponse;
      // Default classifier or transcription response
      if (url.includes('generateContent')) {
        const prompt = JSON.stringify(body);
        if (prompt.includes('Classifique cada imagem')) {
          return {
            candidates: [{
              finishReason: 'STOP',
              content: { parts: [{ text: JSON.stringify({ kinds: ['vehicle_photo'] }) }] }
            }]
          };
        }
        if (prompt.includes('Transcreva fielmente')) {
          return {
            candidates: [{
              finishReason: 'STOP',
              content: { parts: [{ text: JSON.stringify({ intelligible: true, text: 'Quero vender meu carro' }) }] }
            }],
            usageMetadata: { totalTokenCount: 15 }
          };
        }
        return {
          candidates: [{
            finishReason: 'STOP',
            content: { parts: [{ text: JSON.stringify({ action: 'reply', reason: 'none', reply: 'Olá, posso te ajudar!' }) }] }
          }]
        };
      }
    }

    // Supabase RPCs
    const table = u.pathname.split('/').at(-1);
    if (table === 'magia_claim_turn') {
      return {
        claimed: true,
        token: 'token-claim-1',
        boundary_id: 'initial',
        instance: 'wesley-carros',
        tenant_slug: 'wesley_automoveis',
        messages: messages.map(m => ({ ...m, received_at: new Date().toISOString() })),
      };
    }
    if (table === 'magia_commit_turn') return { committed: true };
    if (table === 'magia_finish_turn') return { finished: true, outcome: body?.p_outcome };
    if (table === 'magia_sales_save') {
      return {
        id: 'lead-1',
        revision: (body?.p_revision || 0) + 1,
        stage_key: body?.p_stage || 'sales_qualifying',
        state: body?.p_state || {},
      };
    }

    if (table === 'magia_contact_exclusion_status') {
      if (failContactExclusion) throw new Error('Contact exclusion RPC failed');
      return contactExclusion || { blocked: false, reason: 'disabled' };
    }

    // Supabase tables
    if (table === 'tenants') {
      return [{ id: 'tenant-1', slug: 'wesley_automoveis', status: 'active', name: 'Wesley Automóveis' }];
    }
    if (table === 'tenant_settings') {
      return [{
        timezone: 'America/Sao_Paulo',
        settings: {
          whatsapp_processing_mode: 'conversation_core_v1',
          conversation_capability: 'sales_v1',
          contact_exclusion_enabled: contactExclusionEnabled,
          ai_model: 'gemini-3.5-flash-lite',
          ai_enabled: true,
          sales: {
            stage_keys: { initial: 'sales_new', qualifying: 'sales_qualifying', appraisal: 'sales_appraisal', human: 'sales_human' },
            stages: {
              sales_new: { allow_ai: true },
              sales_qualifying: { allow_ai: true },
              sales_appraisal: { allow_ai: true },
              sales_human: { allow_ai: false }
            },
            document_ocr_enabled: true,
          },
          sdr_rules: { minimum_vehicle_photos: 1 },
          whatsapp_media_bucket: 'channel-media',
          whatsapp_audio_enabled: true,
        },
      }];
    }
    if (table === 'ai_agents') {
      return [{ model: 'gemini-3.5-flash-lite', max_tokens: 500, temperature: 0.45 }];
    }
    if (table === 'contacts') return contact ? [contact] : [];
    if (table === 'channels') return [{ external_id: 'wesley-carros', config: { instance_name: 'wesley-carros' } }];
    if (table === 'sales_leads') {
      if (method === 'POST') return [{ id: 'lead-1', revision: 0, stage_key: 'sales_qualifying', state: {} }];
      return salesLead ? [salesLead] : [];
    }
    if (table === 'inventory_vehicles' || table === 'tenant_service_catalog') return [];

    if (table === 'channel_events') {
      const idParam = u.searchParams.get('id');
      if (method === 'GET' && idParam) {
        const id = idParam.replace(/^eq\./, '');
        const ev = eventsInDb[id];
        return ev ? [ev] : [];
      }
      if (method === 'PATCH') {
        patches.push({ url, body });
        if (idParam && idParam.startsWith('eq.')) {
          const id = idParam.replace(/^eq\./, '');
          if (eventsInDb[id]) {
            eventsInDb[id] = { ...eventsInDb[id], ...body, raw_payload: { ...eventsInDb[id].raw_payload, ...body.raw_payload } };
          }
        }
        return [{ id: 'patched' }];
      }
      if (method === 'POST') {
        posts.push(body);
        return [{ id: 'new-outbound-id', ...body }];
      }
      if (u.searchParams.get('or')?.includes('sender_type.eq.human')) return [];
      if (u.searchParams.get('or')?.includes('conversation_closed')) return [];
      return controlHistory;
    }

    throw new Error(`Unexpected mock HTTP ${method} ${url}`);
  };

  const execute = async (contextInput = {}) => {
    const input = {
      tenant_slug: 'wesley_automoveis',
      tenant_id: 'tenant-1',
      remoteJid: '5521999999999@s.whatsapp.net',
      instance: 'wesley-carros',
      ...contextInput,
    };
    const envVars = {
      SUPABASE_URL: 'https://supabase.test',
      SUPABASE_SERVICE_ROLE_KEY: 'mock-key',
      EVOLUTION_API_URL_WESLEY_AUTOMOVEIS: 'https://evo.test',
      EVOLUTION_API_KEY_WESLEY_AUTOMOVEIS: 'evo-key',
      EVOLUTION_INSTANCE_WESLEY_AUTOMOVEIS: 'wesley-carros',
      GEMINI_ENABLED: 'true',
      GEMINI_API_KEY: 'gemini-key',
    };
    const origFetch = globalThis.fetch;
    if (disableFetch) {
      delete globalThis.fetch;
    } else {
      globalThis.fetch = async (url, options = {}) => {
        const method = options.method || 'GET';
        const headers = options.headers || {};
        const body = options.body;
        if (typeof url === 'string' && url.includes('/storage/v1/object/')) {
          if (storageFailure) {
            return {
              ok: false,
              status: 500,
              text: async () => 'Storage service 500 error',
            };
          }
          if (method === 'POST') {
            assert.ok(Buffer.isBuffer(body) || body instanceof Uint8Array, 'Storage upload body must be a binary Buffer, never Base64 or JSON');
            uploads.push({ url, body, headers, length: body.length });
            calls.push({ method: 'POST', url, body, headers });
            return {
              ok: true,
              status: 200,
              text: async () => JSON.stringify({ Key: 'stored' }),
            };
          }
          if (method === 'HEAD') {
            const lastUpload = uploads.find(u => u.url === url) || uploads[uploads.length - 1];
            const len = verifySizeMismatch ? 999999 : (lastUpload ? lastUpload.length : 0);
            return {
              ok: true,
              status: 200,
              headers: new Headers({
                'content-length': String(len),
              }),
            };
          }
        }
        return origFetch ? origFetch(url, options) : { ok: false, status: 500 };
      };
    }

    let res;
    try {
      res = await executeCore.call({ helpers: { httpRequest } }, input, envVars, {}, () => ({}));
    } finally {
      globalThis.fetch = origFetch;
    }
    return res?.json || res;
  };

  return { execute, calls, uploads, patches, posts, eventsInDb };
}

// The legacy direct-uploader suite is intentionally kept as historical context only.
// Storage is no longer allowed to be uploaded from a Code node. The active coverage
// starts in test_whatsapp_media_ingestion.cjs and exercises the generated n8n pipeline.
if (false) {
test('legacy 1. image stored by direct Code-node uploader', async () => {
  const harness = createMockHarness({
    messages: [{ event_id: 'e-img-1', id: 'msg-img-1', text: '[image]', name: 'Cliente' }],
    rawPayloads: {
      'e-img-1': {
        channel_type: 'whatsapp',
        content_type: 'image',
        core_revision: 'conversation_core_v1',
        source_media: { kind: 'image', mime_type: 'image/jpeg', file_length: 12345 }
      }
    },
    mediaFixtures: {
      'msg-img-1': { mimetype: 'image/jpeg', base64: FIXTURE_JPEG.toString('base64') }
    }
  });

  const res = await harness.execute();
  assert.equal(res.ok, true);

  // 1. Verify upload occurred to Supabase Storage
  assert.equal(harness.uploads.length, 1);
  const upload = harness.uploads[0];
  assert.match(upload.url, /\/storage\/v1\/object\/channel-media\/wesley_automoveis\/whatsapp\/5521999999999_s\.whatsapp\.net\/msg-img-1\.jpg/);
  assert.ok(upload.body.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])));
  assert.ok(upload.body.includes(Buffer.from('binary-image-data-here')));

  // 2. Verify channel_events row has raw_payload.media
  const event = harness.eventsInDb['e-img-1'];
  assert.ok(event.raw_payload.media);
  assert.equal(event.raw_payload.media.status, 'stored');
  assert.equal(event.raw_payload.media.bucket, 'channel-media');
  assert.equal(event.raw_payload.media.storagePath, 'wesley_automoveis/whatsapp/5521999999999_s.whatsapp.net/msg-img-1.jpg');
  assert.equal(event.raw_payload.media.mimeType, 'image/jpeg');
  assert.equal(event.raw_payload.media.verified, true);
});

test('2. image + text isolation: raw_payload of text message NEVER receives media or sales_media', async () => {
  const harness = createMockHarness({
    messages: [
      { event_id: 'e-img', id: 'm-img', text: '[image]', name: 'Cliente' },
      { event_id: 'e-txt', id: 'm-txt', text: 'quanto vocês pagam?', name: 'Cliente' },
    ],
    rawPayloads: {
      'e-img': { channel_type: 'whatsapp', content_type: 'image', core_revision: 'conversation_core_v1' },
      'e-txt': { channel_type: 'whatsapp', content_type: 'text', core_revision: 'conversation_core_v1' },
    },
    mediaFixtures: {
      'm-img': { mimetype: 'image/jpeg', base64: FIXTURE_JPEG_SHORT.toString('base64') }
    }
  });

  await harness.execute();

  // Event 1 (image) must have media
  assert.equal(harness.eventsInDb['e-img'].raw_payload.media?.status, 'stored');

  // Event 2 (text) must NOT have media or sales_media
  assert.equal(harness.eventsInDb['e-txt'].raw_payload.media, undefined);
  assert.equal(harness.eventsInDb['e-txt'].raw_payload.sales_media, undefined);
  assert.equal(harness.eventsInDb['e-txt'].raw_payload.content_type, 'text');
});

test('3. multiple images same turn (album): each image gets its own distinct storagePath and sales_media entry', async () => {
  const harness = createMockHarness({
    messages: [
      { event_id: 'e-img-1', id: 'm-img-1', text: '[image]', name: 'Cliente' },
      { event_id: 'e-img-2', id: 'm-img-2', text: '[image]', name: 'Cliente' },
    ],
    rawPayloads: {
      'e-img-1': { channel_type: 'whatsapp', content_type: 'image', core_revision: 'conversation_core_v1' },
      'e-img-2': { channel_type: 'whatsapp', content_type: 'image', core_revision: 'conversation_core_v1' },
    },
    mediaFixtures: {
      'm-img-1': { mimetype: 'image/jpeg', base64: FIXTURE_JPEG_SHORT.toString('base64') },
      'm-img-2': { mimetype: 'image/jpeg', base64: FIXTURE_JPEG_SHORT.toString('base64') },
    }
  });

  await harness.execute();

  assert.equal(harness.uploads.length, 2);
  assert.equal(harness.eventsInDb['e-img-1'].raw_payload.media.storagePath, 'wesley_automoveis/whatsapp/5521999999999_s.whatsapp.net/m-img-1.jpg');
  assert.equal(harness.eventsInDb['e-img-2'].raw_payload.media.storagePath, 'wesley_automoveis/whatsapp/5521999999999_s.whatsapp.net/m-img-2.jpg');
});

test('4. audio stored + transcription: audio persisted in Storage and transcribed with single download', async () => {
  let downloadCalls = 0;
  const harness = createMockHarness({
    messages: [{ event_id: 'e-aud-1', id: 'm-aud-1', text: '[audio]', name: 'Alex' }],
    rawPayloads: {
      'e-aud-1': {
        channel_type: 'whatsapp',
        content_type: 'audio',
        core_revision: 'conversation_core_v1',
        audio_metadata: { seconds: 5, bytes: 5000 }
      }
    },
    mediaFixtures: {
      'm-aud-1': { mimetype: 'audio/ogg', base64: FIXTURE_OGG.toString('base64') }
    }
  });

  await harness.execute();

  // Must have uploaded audio to channel-media
  const audUpload = harness.uploads.find(u => u.url.includes('.ogg'));
  assert.ok(audUpload, 'Audio must be uploaded to Storage');

  // Event must have BOTH media and audio_processing
  const audEvent = harness.eventsInDb['e-aud-1'];
  assert.ok(audEvent.raw_payload.media);
  assert.equal(audEvent.raw_payload.media.status, 'stored');
  assert.ok(audEvent.raw_payload.audio_processing);
  assert.equal(audEvent.raw_payload.audio_processing.status, 'transcribed');
  assert.equal(audEvent.raw_payload.audio_processing.text, 'Quero vender meu carro');
});

test('5. video stored: video uploaded to Storage channel-media without crashing sales core', async () => {
  const harness = createMockHarness({
    messages: [{ event_id: 'e-vid-1', id: 'm-vid-1', text: '[video]', name: 'Kian' }],
    rawPayloads: {
      'e-vid-1': {
        channel_type: 'whatsapp',
        content_type: 'video',
        core_revision: 'conversation_core_v1',
        source_media: { kind: 'video', mime_type: 'video/mp4', file_length: 50000 }
      }
    },
    mediaFixtures: {
      'm-vid-1': { mimetype: 'video/mp4', base64: FIXTURE_MP4.toString('base64') }
    }
  });

  await harness.execute();

  // Video must be uploaded to Storage
  const vidUpload = harness.uploads.find(u => u.url.includes('m-vid-1.mp4'));
  assert.ok(vidUpload, 'Video must be uploaded to Storage');
  assert.match(vidUpload.url, /\/wesley_automoveis\/whatsapp\/5521999999999_s\.whatsapp\.net\/m-vid-1\.mp4/);

  // Event raw_payload.media must be stored
  const vidEvent = harness.eventsInDb['e-vid-1'];
  assert.ok(vidEvent.raw_payload.media);
  assert.equal(vidEvent.raw_payload.media.status, 'stored');
  assert.equal(vidEvent.raw_payload.media.mimeType, 'video/mp4');
});

test('6. document stored + OCR: PDF uploaded to Storage channel-media and OCR extracted', async () => {
  const harness = createMockHarness({
    messages: [{ event_id: 'e-doc-1', id: 'm-doc-1', text: '[document]', name: 'Cliente' }],
    rawPayloads: {
      'e-doc-1': {
        channel_type: 'whatsapp',
        content_type: 'document',
        core_revision: 'conversation_core_v1',
        source_media: { kind: 'document', mime_type: 'application/pdf', file_name: 'cnh.pdf' }
      }
    },
    mediaFixtures: {
      'm-doc-1': { mimetype: 'application/pdf', base64: Buffer.from('%PDF-cnh').toString('base64') }
    },
    aiModelResponse: {
      candidates: [{
        finishReason: 'STOP',
        content: { parts: [{ text: JSON.stringify({ kind: 'document', name: 'João Silva', cpf: '12345678909', cnh: '12345678901', birth_date: '1990-01-01' }) }] }
      }]
    }
  });

  await harness.execute();

  const docUpload = harness.uploads.find(u => u.url.includes('m-doc-1.pdf'));
  assert.ok(docUpload, 'Document must be uploaded to Storage');
  assert.equal(harness.eventsInDb['e-doc-1'].raw_payload.media.status, 'stored');
});

test('7. static sticker: webp sticker uploaded to Storage channel-media', async () => {
  const harness = createMockHarness({
    messages: [{ event_id: 'e-stk-1', id: 'm-stk-1', text: '[sticker]', name: 'Cliente' }],
    rawPayloads: {
      'e-stk-1': {
        channel_type: 'whatsapp',
        content_type: 'sticker',
        core_revision: 'conversation_core_v1',
        source_media: { kind: 'sticker', mime_type: 'image/webp' }
      }
    },
    mediaFixtures: {
      'm-stk-1': { mimetype: 'image/webp', base64: FIXTURE_WEBP.toString('base64') }
    }
  });

  await harness.execute();

  const stkUpload = harness.uploads.find(u => u.url.includes('m-stk-1.webp'));
  assert.ok(stkUpload, 'Sticker must be uploaded to Storage');
  assert.equal(harness.eventsInDb['e-stk-1'].raw_payload.media.status, 'stored');
});

test('8. human_lock: image is stored in Storage even when conversation is locked by human operator', async () => {
  const harness = createMockHarness({
    messages: [{ event_id: 'e-img-lock', id: 'm-img-lock', text: '[image]', name: 'Cliente' }],
    rawPayloads: {
      'e-img-lock': { channel_type: 'whatsapp', content_type: 'image', core_revision: 'conversation_core_v1' }
    },
    mediaFixtures: {
      'm-img-lock': { mimetype: 'image/jpeg', base64: FIXTURE_JPEG_SHORT.toString('base64') }
    },
    controlHistory: [
      { id: 'human-msg-1', direction: 'outbound', sender_type: 'human', message_text: 'Estou atendendo você' }
    ]
  });

  const res = await harness.execute();
  assert.equal(res.ok, true);
  assert.equal(res.human_lock, true);

  // Verify image was stored in Storage
  assert.equal(harness.uploads.length, 1);
  assert.equal(harness.eventsInDb['e-img-lock'].raw_payload.media.status, 'stored');
});

test('9. owner_saved suppression: audio/media is stored in Storage even when contact is owner-saved', async () => {
  const harness = createMockHarness({
    messages: [{ event_id: 'e-img-owner', id: 'm-img-owner', text: '[image]', name: 'Amigo do Wesley' }],
    rawPayloads: {
      'e-img-owner': { channel_type: 'whatsapp', content_type: 'image', core_revision: 'conversation_core_v1' }
    },
    mediaFixtures: {
      'm-img-owner': { mimetype: 'image/jpeg', base64: FIXTURE_JPEG_SHORT.toString('base64') }
    },
    contact: {
      id: 'c-1',
      name: 'Amigo do Wesley',
      metadata: { whatsapp_owner_saved: true, whatsapp_owner_saved_source: 'evolution_contacts' }
    }
  });

  const res = await harness.execute();
  assert.equal(res.ok, true);
  assert.equal(res.ai_suppressed, true);

  // Image must be stored in Storage despite AI suppression!
  assert.equal(harness.uploads.length, 1);
  assert.equal(harness.eventsInDb['e-img-owner'].raw_payload.media.status, 'stored');
});

test('10. storage upload failure: records status storage_error without leaking credentials or base64', async () => {
  const harness = createMockHarness({
    messages: [{ event_id: 'e-img-fail', id: 'm-img-fail', text: '[image]', name: 'Cliente' }],
    rawPayloads: {
      'e-img-fail': { channel_type: 'whatsapp', content_type: 'image', core_revision: 'conversation_core_v1' }
    },
    mediaFixtures: {
      'm-img-fail': { mimetype: 'image/jpeg', base64: Buffer.concat([FIXTURE_JPEG_SHORT, Buffer.from('secret-base64-data')]).toString('base64') }
    },
    storageFailure: true,
  });

  const res = await harness.execute();
  assert.equal(res.ok, true);

  const event = harness.eventsInDb['e-img-fail'];
  assert.ok(event.raw_payload.media);
  assert.equal(event.raw_payload.media.status, 'storage_error');
  assert.doesNotMatch(JSON.stringify(event.raw_payload), /secret-base64-data/);
  assert.doesNotMatch(JSON.stringify(event.raw_payload), /mock-key/);
  assert.doesNotMatch(JSON.stringify(event.raw_payload), /evo-key/);
});

test('11. Evolution download failure: records status storage_error fail-soft', async () => {
  const harness = createMockHarness({
    messages: [{ event_id: 'e-img-evo-fail', id: 'm-img-evo-fail', text: '[image]', name: 'Cliente' }],
    rawPayloads: {
      'e-img-evo-fail': { channel_type: 'whatsapp', content_type: 'image', core_revision: 'conversation_core_v1' }
    },
    downloadFailure: true,
  });

  const res = await harness.execute();
  assert.equal(res.ok, true);

  const event = harness.eventsInDb['e-img-evo-fail'];
  assert.ok(event.raw_payload.media);
  assert.equal(event.raw_payload.media.status, 'storage_error');
  assert.match(event.raw_payload.media.error, /media_download_failed/);
});

test('12. repeated same event is idempotent and does not upload duplicate files', async () => {
  const harness = createMockHarness({
    messages: [{ event_id: 'e-img-repeat', id: 'm-img-repeat', text: '[image]', name: 'Cliente' }],
    rawPayloads: {
      'e-img-repeat': {
        channel_type: 'whatsapp',
        content_type: 'image',
        core_revision: 'conversation_core_v1',
        media: {
          status: 'stored',
          kind: 'image',
          bucket: 'channel-media',
          storagePath: 'wesley_automoveis/whatsapp/5521999999999_s.whatsapp.net/m-img-repeat.jpg',
        }
      }
    },
  });

  await harness.execute();

  // Storage upload should NOT be called again because media.status is already 'stored'
  assert.equal(harness.uploads.length, 0);
});

test('13. no base64 in DB: verifies all database patches and states contain zero raw base64 data', async () => {
  const harness = createMockHarness({
    messages: [{ event_id: 'e-clean', id: 'm-clean', text: '[image]', name: 'Cliente' }],
    rawPayloads: {
      'e-clean': { channel_type: 'whatsapp', content_type: 'image', core_revision: 'conversation_core_v1' }
    },
    mediaFixtures: {
      'm-clean': { mimetype: 'image/jpeg', base64: Buffer.concat([FIXTURE_JPEG_SHORT, Buffer.from('binary-must-not-leak-into-db')]).toString('base64') }
    }
  });

  await harness.execute();

  for (const patch of harness.patches) {
    const serialized = JSON.stringify(patch.body);
    assert.doesNotMatch(serialized, /binary-must-not-leak-into-db/);
    assert.doesNotMatch(serialized, /;base64,/);
  }
});

test('14. tenant path isolation: storage path strictly starts with tenant_slug', async () => {
  const harness = createMockHarness({
    messages: [{ event_id: 'e-tenant', id: 'm-tenant', text: '[image]', name: 'Cliente' }],
    rawPayloads: {
      'e-tenant': { channel_type: 'whatsapp', content_type: 'image', core_revision: 'conversation_core_v1' }
    },
    mediaFixtures: {
      'm-tenant': { mimetype: 'image/jpeg', base64: FIXTURE_JPEG_SHORT.toString('base64') }
    }
  });

  await harness.execute();

  const path = harness.eventsInDb['e-tenant'].raw_payload.media.storagePath;
  assert.ok(path.startsWith('wesley_automoveis/whatsapp/'));
});

test('15. sales_human: media is persisted into Storage and raw_payload.media even when sales lead is in sales_human / ai_locked', async () => {
  const harness = createMockHarness({
    messages: [{ event_id: 'e-sh-1', id: 'm-sh-1', text: '[image]', name: 'Cliente' }],
    rawPayloads: {
      'e-sh-1': { channel_type: 'whatsapp', content_type: 'image', core_revision: 'conversation_core_v1' }
    },
    salesLead: {
      id: 'lead-human',
      revision: 3,
      stage_key: 'sales_human',
      ai_locked: true,
      state: { intent: 'sell' }
    },
    mediaFixtures: {
      'm-sh-1': { mimetype: 'image/jpeg', base64: FIXTURE_JPEG_SHORT.toString('base64') }
    }
  });

  const res = await harness.execute();
  assert.equal(res.ok, true);
  assert.equal(res.human_lock, true);

  // Storage upload MUST still happen
  assert.equal(harness.uploads.length, 1);
  const ev = harness.eventsInDb['e-sh-1'];
  assert.equal(ev.raw_payload.media?.status, 'stored');
  assert.equal(ev.raw_payload.media?.storagePath, 'wesley_automoveis/whatsapp/5521999999999_s.whatsapp.net/m-sh-1.jpg');
});

test('16. anti-loop: media is persisted into Storage even when anti-loop / repeated question triggers', async () => {
  const harness = createMockHarness({
    messages: [{ event_id: 'e-loop-1', id: 'm-loop-1', text: '[image]', name: 'Cliente' }],
    rawPayloads: {
      'e-loop-1': { channel_type: 'whatsapp', content_type: 'image', core_revision: 'conversation_core_v1' }
    },
    controlHistory: [
      { id: 'h-1', direction: 'outbound', message_text: 'Qual é o modelo do veículo que deseja vender?', response_text: 'Qual é o modelo do veículo que deseja vender?' },
      { id: 'h-2', direction: 'inbound', message_text: '2006' },
      { id: 'h-3', direction: 'outbound', message_text: 'Qual é o modelo do veículo que deseja vender?', response_text: 'Qual é o modelo do veículo que deseja vender?' },
    ],
    salesLead: {
      id: 'lead-loop',
      revision: 2,
      stage_key: 'sales_qualifying',
      ai_locked: false,
      state: { intent: 'sell', sell_year: 2006 }
    },
    mediaFixtures: {
      'm-loop-1': { mimetype: 'image/jpeg', base64: FIXTURE_JPEG_SHORT.toString('base64') }
    }
  });

  await harness.execute();

  // Storage upload MUST occur
  assert.equal(harness.uploads.length, 1);
  const ev = harness.eventsInDb['e-loop-1'];
  assert.equal(ev.raw_payload.media?.status, 'stored');
});

test('17. technical error in sales turn: media remains stored even if error occurs downstream', async () => {
  const harness = createMockHarness({
    messages: [{ event_id: 'e-err-1', id: 'm-err-1', text: '[image]', name: 'Cliente' }],
    rawPayloads: {
      'e-err-1': { channel_type: 'whatsapp', content_type: 'image', core_revision: 'conversation_core_v1' }
    },
    salesLead: {
      id: 'lead-err',
      revision: 1,
      stage_key: 'sales_qualifying',
      ai_locked: false,
      state: { intent: 'sell' }
    },
    aiModelResponse: { throwError: true },
    mediaFixtures: {
      'm-err-1': { mimetype: 'image/jpeg', base64: FIXTURE_JPEG_SHORT.toString('base64') }
    }
  });

  await harness.execute();

  // Storage upload occurred before any AI error
  assert.equal(harness.uploads.length, 1);
  const ev = harness.eventsInDb['e-err-1'];
  assert.equal(ev.raw_payload.media?.status, 'stored');
});

test('18. no encrypted WhatsApp URL: raw_payload.media contains only private bucket + storagePath, never whatsapp.net or enc URLs', async () => {
  const harness = createMockHarness({
    messages: [{ event_id: 'e-sec-1', id: 'm-sec-1', text: '[image]', name: 'Cliente' }],
    rawPayloads: {
      'e-sec-1': {
        channel_type: 'whatsapp',
        content_type: 'image',
        core_revision: 'conversation_core_v1',
        data: {
          message: {
            imageMessage: {
              url: 'https://mmg.whatsapp.net/v/t62.7118-24/fake_encrypted_url.enc',
              directPath: '/v/t62.7118-24/fake_encrypted_url.enc',
              mediaKey: 'fakeMediaKey123=='
            }
          }
        }
      }
    },
    mediaFixtures: {
      'm-sec-1': { mimetype: 'image/jpeg', base64: FIXTURE_JPEG_SHORT.toString('base64') }
    }
  });

  await harness.execute();

  const ev = harness.eventsInDb['e-sec-1'];
  const media = ev.raw_payload.media;
  assert.equal(media.status, 'stored');
  assert.equal(media.bucket, 'channel-media');
  assert.doesNotMatch(media.storagePath, /mmg\.whatsapp\.net/);
  assert.doesNotMatch(media.storagePath, /^https?:\/\//);
  assert.doesNotMatch(media.storagePath, /\.enc$/);
  assert.equal(media.url, undefined);
  assert.equal(media.mediaKey, undefined);
});

test('19. Section 20 mixed turn: Photo A + "é um Siena 2014" + Photo B isolation', async () => {
  const harness = createMockHarness({
    messages: [
      { event_id: 'e-photo-a', id: 'm-photo-a', text: '[image]', name: 'Cliente' },
      { event_id: 'e-text-mid', id: 'm-text-mid', text: 'é um Siena 2014', name: 'Cliente' },
      { event_id: 'e-photo-b', id: 'm-photo-b', text: '[image]', name: 'Cliente' },
    ],
    rawPayloads: {
      'e-photo-a': { channel_type: 'whatsapp', content_type: 'image', core_revision: 'conversation_core_v1' },
      'e-text-mid': { channel_type: 'whatsapp', content_type: 'text', core_revision: 'conversation_core_v1' },
      'e-photo-b': { channel_type: 'whatsapp', content_type: 'image', core_revision: 'conversation_core_v1' },
    },
    mediaFixtures: {
      'm-photo-a': { mimetype: 'image/jpeg', base64: FIXTURE_JPEG_SHORT.toString('base64') },
      'm-photo-b': { mimetype: 'image/jpeg', base64: FIXTURE_JPEG_SHORT.toString('base64') },
    }
  });

  await harness.execute();

  // Exactly 2 uploads (Photo A and Photo B)
  assert.equal(harness.uploads.length, 2);

  const evA = harness.eventsInDb['e-photo-a'];
  const evText = harness.eventsInDb['e-text-mid'];
  const evB = harness.eventsInDb['e-photo-b'];

  // Event A: media A and sales_media
  assert.equal(evA.raw_payload.media?.status, 'stored');
  assert.match(evA.raw_payload.media.storagePath, /m-photo-a\.jpg$/);

  // Event Text: NO media, NO sales_media, NEVER overwritten by turn payload
  assert.equal(evText.raw_payload.media, undefined);
  assert.equal(evText.raw_payload.sales_media, undefined);

  // Event B: media B and sales_media
  assert.equal(evB.raw_payload.media?.status, 'stored');
  assert.match(evB.raw_payload.media.storagePath, /m-photo-b\.jpg$/);

  // Distinct storage paths
  assert.notEqual(evA.raw_payload.media.storagePath, evB.raw_payload.media.storagePath);
});


test('20. storage size limit: <= 10 MiB permitted, > 10 MiB rejected without upload attempt', async () => {
  // Case A: 10 MiB exact (10485760 bytes) -> allowed
  const tenMbBuffer = Buffer.alloc(10 * 1024 * 1024, 0x61);
  FIXTURE_JPEG_SHORT.copy(tenMbBuffer, 0);
  const tenMbBase64 = tenMbBuffer.toString('base64');
  const hA = createMockHarness({
    messages: [{ event_id: 'e-10mb', id: 'm-10mb', text: '[image]' }],
    rawPayloads: {
      'e-10mb': {
        channel_type: 'whatsapp', content_type: 'image',
        source_media: { kind: 'image', file_length: 10 * 1024 * 1024, mime_type: 'image/jpeg' },
      },
    },
    mediaFixtures: {
      'm-10mb': { mimetype: 'image/jpeg', base64: tenMbBase64 },
    },
  });
  const resA = await hA.execute();
  assert.equal(resA.ok, true, 'Turn must succeed');
  assert.equal(hA.uploads.length, 1, 'Upload must be attempted for <= 10 MiB');
  assert.equal(hA.eventsInDb['e-10mb'].raw_payload.media.status, 'stored');
  assert.equal(hA.eventsInDb['e-10mb'].raw_payload.media.size, 10 * 1024 * 1024);

  // Case B: > 10 MiB declared in descriptor -> rejected BEFORE download/upload
  const hB = createMockHarness({
    messages: [{ event_id: 'e-11mb', id: 'm-11mb', text: '[image]' }],
    rawPayloads: {
      'e-11mb': {
        channel_type: 'whatsapp', content_type: 'image',
        source_media: { kind: 'image', file_length: 11 * 1024 * 1024, mime_type: 'image/jpeg' },
      },
    },
    mediaFixtures: {
      'm-11mb': { mimetype: 'image/jpeg', base64: 'should-not-be-called' },
    },
  });
  const resB = await hB.execute();
  assert.equal(resB.ok, true, 'Turn must not crash for oversized media');
  assert.equal(hB.uploads.length, 0, 'Must NOT attempt upload for > 10 MiB');
  const mediaB = hB.eventsInDb['e-11mb'].raw_payload.media;
  assert.equal(mediaB.status, 'skipped_too_large');
  assert.equal(mediaB.error, 'media_too_large');

  // Case C: > 10 MiB undeclared (downloaded bytes > 10 MiB) -> rejected BEFORE storage upload
  const elevenMbBuffer = Buffer.alloc(11 * 1024 * 1024, 0x62);
  FIXTURE_JPEG_SHORT.copy(elevenMbBuffer, 0);
  const elevenMbBase64 = elevenMbBuffer.toString('base64');
  const hC = createMockHarness({
    messages: [{ event_id: 'e-11mb-undec', id: 'm-11mb-undec', text: '[image]' }],
    rawPayloads: {
      'e-11mb-undec': {
        channel_type: 'whatsapp', content_type: 'image',
        source_media: { kind: 'image', mime_type: 'image/jpeg' },
      },
    },
    mediaFixtures: {
      'm-11mb-undec': { mimetype: 'image/jpeg', base64: elevenMbBase64 },
    },
  });
  const resC = await hC.execute();
  assert.equal(resC.ok, true, 'Turn must not crash for oversized downloaded media');
  assert.equal(hC.uploads.length, 0, 'Must NOT attempt upload when downloaded bytes > 10 MiB');
  const mediaC = hC.eventsInDb['e-11mb-undec'].raw_payload.media;
  assert.equal(mediaC.status, 'skipped_too_large');
  assert.equal(mediaC.error, 'media_too_large');
});

test('21. storage real idempotency: same event upload does not duplicate path, uses x-upsert, never 409', async () => {
  const h = createMockHarness({
    messages: [{ event_id: 'e-idemp', id: 'm-idemp', text: '[image]' }],
    rawPayloads: {
      'e-idemp': { channel_type: 'whatsapp', content_type: 'image' },
    },
    mediaFixtures: {
      'm-idemp': { mimetype: 'image/jpeg', base64: FIXTURE_JPEG_SHORT.toString('base64') },
    },
  });
  // First run: stores file
  await h.execute();
  assert.equal(h.uploads.length, 1);
  const firstUpload = h.uploads[0];
  assert.equal(firstUpload.headers['x-upsert'], 'true');
  const firstStoragePath = h.eventsInDb['e-idemp'].raw_payload.media.storagePath;
  assert.equal(firstStoragePath, 'wesley_automoveis/whatsapp/5521999999999_s.whatsapp.net/m-idemp.jpg');
  assert.equal(h.eventsInDb['e-idemp'].raw_payload.media.status, 'stored');

  // Second run on exact same event:
  // Since existing.status === 'stored' with bucket and storagePath, it skips re-uploading
  await h.execute();
  assert.equal(h.uploads.length, 1, 'Does not re-upload if already stored');
  assert.equal(h.eventsInDb['e-idemp'].raw_payload.media.storagePath, firstStoragePath);
  assert.equal(h.eventsInDb['e-idemp'].raw_payload.media.status, 'stored');
});

test('22. raw_payload sequential preservation: real patchMedia, patchAudioProcessing, and patchSalesMedia preserve all blocks without data loss or cross-event contamination', async () => {
  // Persistent mock PostgREST store
  const eventsInDb = {
    'evt-target': {
      id: 'evt-target',
      external_message_id: 'msg-target',
      tenant_slug: 'wesley_automoveis',
      channel_type: 'whatsapp',
      message_text: '[audio]',
      raw_payload: {
        channel_type: 'whatsapp',
        content_type: 'audio',
        original_carrier: 'evolution',
        trace_id: 'tr-123'
      }
    },
    'evt-isolate': {
      id: 'evt-isolate',
      external_message_id: 'msg-isolate',
      tenant_slug: 'wesley_automoveis',
      channel_type: 'whatsapp',
      message_text: 'Mensagem concorrente no evento B',
      raw_payload: {
        channel_type: 'whatsapp',
        content_type: 'text',
        original_note: 'event_b_must_never_be_touched'
      }
    }
  };

  const httpRequest = async ({ method, url, body }) => {
    const u = new URL(url);
    const table = u.pathname.split('/').at(-1);
    if (table === 'channel_events') {
      const idParam = u.searchParams.get('id');
      const id = idParam ? idParam.replace(/^eq\./, '') : null;
      if (method === 'GET' && id) {
        const ev = eventsInDb[id];
        return ev ? [JSON.parse(JSON.stringify(ev))] : [];
      }
      if (method === 'PATCH' && id) {
        if (!eventsInDb[id]) return [];
        eventsInDb[id] = {
          ...eventsInDb[id],
          ...body,
          raw_payload: {
            ...eventsInDb[id].raw_payload,
            ...(body.raw_payload || {})
          }
        };
        return [JSON.parse(JSON.stringify(eventsInDb[id]))];
      }
    }
    throw new Error(`Unexpected HTTP in patch test: ${method} ${url}`);
  };

  // Compile runner using the REAL functions in generatedCode
  const freshGeneratedCode = fs.readFileSync(path.join(root, 'n8n/code/whatsapp_conversation_core.generated.js'), 'utf8');
  const patchRunnerCode = freshGeneratedCode.replace(
    'return { json: await runTurn() };',
    'return { patchMedia, patchAudioProcessing, patchSalesMedia };'
  );
  const runnerFn = new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', patchRunnerCode);
  const handles = await runnerFn.call(
    { helpers: { httpRequest } },
    {
      tenant_slug: 'wesley_automoveis',
      tenant_id: 'tenant-1',
      remoteJid: '5521999999999@s.whatsapp.net',
      instance: 'wesley-carros'
    },
    { SUPABASE_URL: 'https://supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'test-key' },
    {},
    () => ({})
  );

  const { patchMedia, patchAudioProcessing, patchSalesMedia } = handles;
  assert.equal(typeof patchMedia, 'function', 'patchMedia must be a function');
  assert.equal(typeof patchAudioProcessing, 'function', 'patchAudioProcessing must be a function');
  assert.equal(typeof patchSalesMedia, 'function', 'patchSalesMedia must be a function');

  const context = { tenant: { id: 'tenant-1', slug: 'wesley_automoveis' } };

  // Initial Snapshot: event B
  const initialEventB = JSON.parse(JSON.stringify(eventsInDb['evt-isolate']));

  // Phase A: patchMedia(event) -> raw_payload.media exists
  const mediaObj = {
    status: 'stored',
    kind: 'audio',
    category: 'audio',
    bucket: 'channel-media',
    storagePath: 'wesley_automoveis/whatsapp/5521999999999_s.whatsapp.net/msg-target.ogg',
    mimeType: 'audio/ogg',
    size: 24680,
    verified: true
  };
  await patchMedia(context, 'evt-target', mediaObj);

  const evAfterA = eventsInDb['evt-target'];
  assert.ok(evAfterA.raw_payload.media, 'Phase A: media must exist');
  assert.equal(evAfterA.raw_payload.media.status, 'stored');
  assert.equal(evAfterA.raw_payload.media.storagePath, mediaObj.storagePath);
  assert.equal(evAfterA.raw_payload.original_carrier, 'evolution', 'Phase A: original payload keys preserved');
  assert.equal(evAfterA.raw_payload.audio_processing, undefined, 'Phase A: audio_processing not yet present');
  assert.equal(evAfterA.raw_payload.sales_media, undefined, 'Phase A: sales_media not yet present');

  // Verify event B was NOT changed
  assert.deepEqual(eventsInDb['evt-isolate'], initialEventB, 'Phase A: Event B must not change');

  // Phase B: patchAudioProcessing(event) -> media continua; audio_processing aparece
  const audioResult = {
    version: 'whatsapp_audio_v1',
    status: 'transcribed',
    text: 'Quero vender meu Prisma 2018',
    model: 'gemini-1.5-flash',
    mime_type: 'audio/ogg',
    transcribed_at: '2026-10-05T12:00:00.000Z'
  };
  await patchAudioProcessing(context, 'evt-target', audioResult);

  const evAfterB = eventsInDb['evt-target'];
  assert.ok(evAfterB.raw_payload.media, 'Phase B: media block must continue intact');
  assert.equal(evAfterB.raw_payload.media.status, 'stored');
  assert.equal(evAfterB.raw_payload.media.storagePath, mediaObj.storagePath);
  assert.ok(evAfterB.raw_payload.audio_processing, 'Phase B: audio_processing must appear');
  assert.equal(evAfterB.raw_payload.audio_processing.status, 'transcribed');
  assert.equal(evAfterB.raw_payload.audio_processing.text, 'Quero vender meu Prisma 2018');
  assert.equal(evAfterB.raw_payload.original_carrier, 'evolution', 'Phase B: original payload keys preserved');
  assert.equal(evAfterB.raw_payload.sales_media, undefined, 'Phase B: sales_media not yet present');

  // Verify event B was NOT changed
  assert.deepEqual(eventsInDb['evt-isolate'], initialEventB, 'Phase B: Event B must not change');

  // Phase C: patchSalesMedia(event) -> media continua; audio_processing continua; sales_media aparece
  const salesEntry = {
    event_id: 'evt-target',
    kind: 'vehicle_audio',
    readable: true,
    extracted: { intent: 'sell', sell_model: 'Prisma', sell_year: 2018 }
  };
  await patchSalesMedia(context, 'evt-target', salesEntry);

  const evAfterC = eventsInDb['evt-target'];
  assert.ok(evAfterC.raw_payload.media, 'Phase C: media block must continue intact');
  assert.equal(evAfterC.raw_payload.media.status, 'stored');
  assert.equal(evAfterC.raw_payload.media.storagePath, mediaObj.storagePath);

  assert.ok(evAfterC.raw_payload.audio_processing, 'Phase C: audio_processing must continue intact');
  assert.equal(evAfterC.raw_payload.audio_processing.status, 'transcribed');
  assert.equal(evAfterC.raw_payload.audio_processing.text, 'Quero vender meu Prisma 2018');

  assert.ok(Array.isArray(evAfterC.raw_payload.sales_media), 'Phase C: sales_media array must appear');
  assert.equal(evAfterC.raw_payload.sales_media.length, 1);
  assert.equal(evAfterC.raw_payload.sales_media[0].kind, 'vehicle_audio');
  assert.equal(evAfterC.raw_payload.sales_media[0].readable, true);
  assert.equal(evAfterC.raw_payload.sales_media[0].extracted.sell_model, 'Prisma');

  assert.equal(evAfterC.raw_payload.original_carrier, 'evolution', 'Phase C: original payload keys preserved');
  assert.equal(evAfterC.raw_payload.trace_id, 'tr-123', 'Phase C: trace_id preserved');

  // Phase D: patch em event A -> event B NÃO muda
  assert.deepEqual(eventsInDb['evt-isolate'], initialEventB, 'Phase D: Event B must remain strictly identical to initial state');
  assert.equal(eventsInDb['evt-isolate'].raw_payload.media, undefined);
  assert.equal(eventsInDb['evt-isolate'].raw_payload.audio_processing, undefined);
  assert.equal(eventsInDb['evt-isolate'].raw_payload.sales_media, undefined);
  assert.equal(eventsInDb['evt-isolate'].raw_payload.original_note, 'event_b_must_never_be_touched');
});

test('23. contact_exclusion media preservation: excluded contact sends image -> persistTurnWhatsAppMedia stores media before exclusion blocks AI', async () => {
  const harness = createMockHarness({
    messages: [{ event_id: 'e-excl-img', id: 'm-excl-img', text: '[image]', name: 'Amigo Protegido' }],
    rawPayloads: {
      'e-excl-img': { channel_type: 'whatsapp', content_type: 'image', core_revision: 'conversation_core_v1' }
    },
    mediaFixtures: {
      'm-excl-img': { mimetype: 'image/jpeg', base64: FIXTURE_JPEG_SHORT.toString('base64') }
    },
    contactExclusionEnabled: true,
    contactExclusion: { blocked: true, reason: 'contact_excluded', resolved_phone: '5521999999999' }
  });

  const res = await harness.execute();
  assert.equal(res.ok, true);
  assert.equal(res.skipped, true);
  assert.equal(res.reason, 'contact_excluded');

  // CRITICAL RULE: Contato salvo bloqueia IA, MAS NÃO BLOQUEIA PERSISTÊNCIA DE MÍDIA.
  // 1. Upload to Supabase Storage MUST have occurred
  assert.equal(harness.uploads.length, 1, 'Image must be uploaded to Storage even when contact is excluded');
  assert.match(harness.uploads[0].url, /\/channel-media\/wesley_automoveis\/whatsapp\/5521999999999_s\.whatsapp\.net\/m-excl-img\.jpg/);

  // 2. raw_payload.media must exist and have status 'stored'
  const ev = harness.eventsInDb['e-excl-img'];
  assert.ok(ev.raw_payload.media, 'media block must exist in raw_payload');
  assert.equal(ev.raw_payload.media.status, 'stored');
  assert.equal(ev.raw_payload.media.bucket, 'channel-media');
  assert.match(ev.raw_payload.media.storagePath, /m-excl-img\.jpg$/);

  // 3. IA was blocked: zero messages sent
  assert.equal(harness.posts.length, 0, 'No outbound message must be created for excluded contact');
  const sendCalls = harness.calls.filter(c => c.url.includes('/message/sendText'));
  assert.equal(sendCalls.length, 0, 'No message sent via Evolution');
});

test('24. definitive fix: real local HTTP server captures raw binary JPEG body, not JSON Buffer', async () => {
  const http = require('node:http');
  let receivedPostBytes = null;
  let receivedHeaders = null;
  let postCount = 0;
  let headCount = 0;

  const server = http.createServer((req, res) => {
    if (req.method === 'POST') {
      postCount++;
      receivedHeaders = req.headers;
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        receivedPostBytes = Buffer.concat(chunks);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ Key: 'channel-media/test.jpg' }));
      });
      return;
    }
    if (req.method === 'HEAD') {
      headCount++;
      res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Content-Length': String(receivedPostBytes ? receivedPostBytes.length : 0),
      });
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const mockSupabaseUrl = `http://127.0.0.1:${port}`;

  try {
    const freshGeneratedCode = fs.readFileSync(path.join(root, 'n8n/code/whatsapp_conversation_core.generated.js'), 'utf8');
    const runnerCode = freshGeneratedCode.replace(
      'return { json: await runTurn() };',
      'return { uploadSupabaseBinary, validateMediaMagicBytes };'
    );
    const runnerFn = new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', runnerCode);
    const { uploadSupabaseBinary } = await runnerFn.call(
      { helpers: {} },
      {},
      { SUPABASE_URL: mockSupabaseUrl, SUPABASE_SERVICE_ROLE_KEY: 'test-service-key' },
      {},
      () => ({})
    );

    const testJpeg = FIXTURE_JPEG;
    const uploadRes = await uploadSupabaseBinary({
      bucket: 'channel-media',
      storagePath: 'test/path/car.jpg',
      mimeType: 'image/jpeg',
      bytes: testJpeg,
      timeout: 10000,
    });

    assert.equal(uploadRes.verified, true);
    assert.equal(uploadRes.storedSize, testJpeg.length);
    assert.equal(postCount, 1, 'Exactly one POST request to storage');
    assert.equal(headCount, 1, 'Exactly one HEAD request for post-upload verification');

    // RAW bytes verification:
    assert.ok(receivedPostBytes !== null, 'Server must receive POST body');
    assert.equal(receivedPostBytes.length, testJpeg.length, 'Received length must match original JPEG length');
    assert.ok(receivedPostBytes.equals(testJpeg), 'Received bytes must strictly equal original binary buffer');

    // Magic bytes:
    assert.equal(receivedPostBytes[0], 0xff);
    assert.equal(receivedPostBytes[1], 0xd8);
    assert.equal(receivedPostBytes[2], 0xff);

    // Negative assertions: MUST NOT BE JSON BUFFER SERIALIZATION
    const prefix16 = receivedPostBytes.subarray(0, 16).toString('utf8');
    assert.ok(!prefix16.includes('type'), 'Must not contain "type"');
    assert.ok(!prefix16.includes('Buffer'), 'Must not contain "Buffer"');
    assert.ok(!prefix16.includes('data'), 'Must not contain "data"');
    assert.ok(!prefix16.startsWith('{'), 'Must not start with "{"');
  } finally {
    server.close();
  }
});

test('25. anti-regression: corrupt JSON Buffer {"type":"Buffer","data":[...]} is detected and rejected', async () => {
  const freshGeneratedCode = fs.readFileSync(path.join(root, 'n8n/code/whatsapp_conversation_core.generated.js'), 'utf8');
  const runnerCode = freshGeneratedCode.replace(
    'return { json: await runTurn() };',
    'return { validateMediaMagicBytes };'
  );
  const runnerFn = new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', runnerCode);
  const { validateMediaMagicBytes } = await runnerFn.call(
    { helpers: {} },
    {},
    {},
    {},
    () => ({})
  );

  // 1. Corrupted payload simulating the bug: JSON.stringify(Buffer)
  const simulatedBugPayload = Buffer.from(JSON.stringify({ type: 'Buffer', data: [255, 216, 255, 224, 0, 16, 74, 70, 73, 70] }));

  // Pre-upload magic bytes validation MUST detect that this is NOT valid JPEG bytes
  assert.throws(() => {
    validateMediaMagicBytes('image/jpeg', simulatedBugPayload);
  }, /media_magic_mismatch/, 'Must throw media_magic_mismatch when buffer starts with JSON string');

  // 2. String representation starts with {"type":"Buffer"
  assert.ok(simulatedBugPayload.toString('utf8').startsWith('{"type":"Buffer"'));
});

test('26. real local HTTP server captures raw binary OGG body for audio upload, not JSON Buffer', async () => {
  const http = require('node:http');
  let receivedAudioBytes = null;
  let postCount = 0;
  let headCount = 0;

  const server = http.createServer((req, res) => {
    if (req.method === 'POST') {
      postCount++;
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        receivedAudioBytes = Buffer.concat(chunks);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ Key: 'channel-media/audio.ogg' }));
      });
      return;
    }
    if (req.method === 'HEAD') {
      headCount++;
      res.writeHead(200, {
        'Content-Type': 'audio/ogg',
        'Content-Length': String(receivedAudioBytes ? receivedAudioBytes.length : 0),
      });
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const mockSupabaseUrl = `http://127.0.0.1:${port}`;

  try {
    const freshGeneratedCode = fs.readFileSync(path.join(root, 'n8n/code/whatsapp_conversation_core.generated.js'), 'utf8');
    const runnerCode = freshGeneratedCode.replace(
      'return { json: await runTurn() };',
      'return { uploadSupabaseBinary };'
    );
    const runnerFn = new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', runnerCode);
    const { uploadSupabaseBinary } = await runnerFn.call(
      { helpers: {} },
      {},
      { SUPABASE_URL: mockSupabaseUrl, SUPABASE_SERVICE_ROLE_KEY: 'test-service-key' },
      {},
      () => ({})
    );

    const testOgg = FIXTURE_OGG;
    const uploadRes = await uploadSupabaseBinary({
      bucket: 'channel-media',
      storagePath: 'test/path/voice.ogg',
      mimeType: 'audio/ogg',
      bytes: testOgg,
      timeout: 10000,
    });

    assert.equal(uploadRes.verified, true);
    assert.equal(uploadRes.storedSize, testOgg.length);
    assert.equal(postCount, 1);
    assert.equal(headCount, 1);

    // RAW bytes verification:
    assert.ok(receivedAudioBytes !== null);
    assert.equal(receivedAudioBytes.length, testOgg.length);
    assert.ok(receivedAudioBytes.equals(testOgg));

    // Magic bytes: OggS
    assert.equal(receivedAudioBytes.subarray(0, 4).toString('ascii'), 'OggS');

    // Negative assertions:
    const prefix = receivedAudioBytes.subarray(0, 16).toString('utf8');
    assert.ok(!prefix.includes('Buffer'));
    assert.ok(!prefix.startsWith('{'));
  } finally {
    server.close();
  }
});

test('27. magic bytes validation: mismatching magic bytes mark media status unsupported without uploading', async () => {
  const harness = createMockHarness({
    messages: [{ event_id: 'e-bad-magic', id: 'm-bad-magic', text: '[image]', name: 'Cliente' }],
    rawPayloads: {
      'e-bad-magic': {
        channel_type: 'whatsapp',
        content_type: 'image',
        core_revision: 'conversation_core_v1',
      }
    },
    mediaFixtures: {
      'm-bad-magic': { mimetype: 'image/jpeg', base64: Buffer.from('NOT-A-JPEG-IMAGE-FILE').toString('base64') }
    }
  });

  const res = await harness.execute();
  assert.equal(res.ok, true);

  // Storage upload MUST NOT be attempted
  assert.equal(harness.uploads.length, 0);

  const ev = harness.eventsInDb['e-bad-magic'];
  assert.ok(ev.raw_payload.media);
  assert.equal(ev.raw_payload.media.status, 'unsupported');
  assert.equal(ev.raw_payload.media.verified, false);
  assert.equal(ev.raw_payload.media.error, 'media_magic_mismatch');
});

test('28. defensive runtime check: binary_transport_unavailable if globalThis.fetch is missing', async () => {
  const harness = createMockHarness({
    disableFetch: true,
    messages: [{ event_id: 'e-no-fetch', id: 'm-no-fetch', text: '[image]', name: 'Cliente' }],
    rawPayloads: {
      'e-no-fetch': {
        channel_type: 'whatsapp',
        content_type: 'image',
        core_revision: 'conversation_core_v1',
      }
    },
    mediaFixtures: {
      'm-no-fetch': { mimetype: 'image/jpeg', base64: FIXTURE_JPEG_SHORT.toString('base64') }
    }
  });

  const res = await harness.execute();
  assert.equal(res.ok, true, 'Turn must not crash even when fetch is absent');

  const ev = harness.eventsInDb['e-no-fetch'];
  assert.ok(ev.raw_payload.media);
  assert.equal(ev.raw_payload.media.status, 'storage_error');
  assert.equal(ev.raw_payload.media.verified, false);
  assert.match(ev.raw_payload.media.error, /binary_transport_unavailable/);
});

test('29. post-upload verification: storage_size_mismatch marks status storage_error and verified false', async () => {
  const harness = createMockHarness({
    verifySizeMismatch: true,
    messages: [{ event_id: 'e-mismatch', id: 'm-mismatch', text: '[image]', name: 'Cliente' }],
    rawPayloads: {
      'e-mismatch': {
        channel_type: 'whatsapp',
        content_type: 'image',
        core_revision: 'conversation_core_v1',
      }
    },
    mediaFixtures: {
      'm-mismatch': { mimetype: 'image/jpeg', base64: FIXTURE_JPEG_SHORT.toString('base64') }
    }
  });

  const res = await harness.execute();
  assert.equal(res.ok, true);

  const ev = harness.eventsInDb['e-mismatch'];
  assert.ok(ev.raw_payload.media);
  assert.equal(ev.raw_payload.media.status, 'storage_error');
  assert.equal(ev.raw_payload.media.verified, false);
  assert.match(ev.raw_payload.media.error, /storage_size_mismatch/);
});

test('30. early exit bypass: media with status stored but verified false is re-uploaded and verified', async () => {
  const harness = createMockHarness({
    messages: [{ event_id: 'e-unverified-retry', id: 'm-unverified-retry', text: '[image]', name: 'Cliente' }],
    rawPayloads: {
      'e-unverified-retry': {
        channel_type: 'whatsapp',
        content_type: 'image',
        core_revision: 'conversation_core_v1',
        media: {
          status: 'stored',
          verified: false, // Previously failed verification or legacy unverified
          bucket: 'channel-media',
          storagePath: 'wesley_automoveis/whatsapp/5521999999999_s.whatsapp.net/m-unverified-retry.jpg',
        }
      }
    },
    mediaFixtures: {
      'm-unverified-retry': { mimetype: 'image/jpeg', base64: FIXTURE_JPEG_SHORT.toString('base64') }
    }
  });

  await harness.execute();

  // Re-upload must occur because verified was false
  assert.equal(harness.uploads.length, 1);
  const ev = harness.eventsInDb['e-unverified-retry'];
  assert.equal(ev.raw_payload.media.status, 'stored');
  assert.equal(ev.raw_payload.media.verified, true);
});

test('legacy 31. full turn audio uses direct binary transport', async () => {
  const harness = createMockHarness({
    messages: [{ event_id: 'e-aud-full', id: 'm-aud-full', text: '[audio]', name: 'Maria' }],
    rawPayloads: {
      'e-aud-full': {
        channel_type: 'whatsapp',
        content_type: 'audio',
        core_revision: 'conversation_core_v1',
      }
    },
    mediaFixtures: {
      'm-aud-full': { mimetype: 'audio/ogg', base64: FIXTURE_OGG.toString('base64') }
    }
  });

  const res = await harness.execute();
  assert.equal(res.ok, true);

  // Uploaded via binary transport
  assert.equal(harness.uploads.length, 1);
  const upload = harness.uploads[0];
  assert.ok(upload.body.subarray(0, 4).equals(Buffer.from('OggS')));
  assert.equal(upload.length, FIXTURE_OGG.length);

  // DB state
  const ev = harness.eventsInDb['e-aud-full'];
  assert.ok(ev.raw_payload.media);
  assert.equal(ev.raw_payload.media.status, 'stored');
  assert.equal(ev.raw_payload.media.verified, true);
  assert.equal(ev.raw_payload.media.size, FIXTURE_OGG.length);
  assert.equal(ev.raw_payload.audio_processing.status, 'transcribed');
});
}

require('./test_whatsapp_media_ingestion.cjs');

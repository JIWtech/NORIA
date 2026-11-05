// Gênesis 28/10 09:40: uma rajada de fotos (revendedor, 4 imagens reenviadas pela Evolution) estourou o timeout de 5 s
// em "Selecionar Motor WhatsApp". Cada mensagem fazia duas leituras e baixava o settings INTEIRO do tenant (124 KB na
// Gênesis, ~97 KB de snapshots antigos de prompt) só para ler cinco opções.
// Agora: uma leitura com só os campos necessários e uma nova tentativa apenas para falha transitória de leitura.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const code = fs.readFileSync(path.join(root, 'n8n/code/whatsapp_select_core.js'), 'utf8');
const selector = new AsyncFunction('$json', '$env', code);
const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'fake' };
const input = { tenant_slug: 'wesley_automoveis', instance: 'wesley-carros', tenant_resolution: { source: 'channels.external_id' } };
const settingsRow = { mode: 'conversation_core_v1', capability: 'sales_v1', exclusion: true, quiet: 8000, fragment: 12000 };

function helpers(responses) {
  const calls = [];
  return { calls, helpers: { httpRequest: async request => {
    calls.push(request);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(request) : next;
  } } };
}
const timeout = () => Object.assign(new Error('timeout of 5000ms exceeded'), { code: 'ECONNABORTED' });

test('uma leitura só com os campos necessários, nunca o settings inteiro', async () => {
  const h = helpers([[{ id: 't1', status: 'active', tenant_settings: [settingsRow] }]]);
  const out = await selector.call({ helpers: h.helpers }, input, env);
  assert.equal(h.calls.length, 1);
  const url = decodeURIComponent(h.calls[0].url);
  assert.match(url, /\/rest\/v1\/tenants\?select=id,status,tenant_settings\(/);
  assert.match(url, /settings->>whatsapp_processing_mode/);
  assert.doesNotMatch(url, /select=settings\b|tenant_settings\(settings\)/);
  assert.equal(h.calls[0].method, 'GET');
  assert.deepEqual({ id: out.json.tenant_id, core: out.json.use_conversation_core, sales: out.json.core_sales, quiet: out.json.core_quiet_ms, fragment: out.json.core_fragment_ms },
    { id: 't1', core: true, sales: true, quiet: 8000, fragment: 12000 });
});

test('aceita o embed como objeto ou lista', async () => {
  const h = helpers([[{ id: 't1', status: 'active', tenant_settings: settingsRow }]]);
  assert.equal((await selector.call({ helpers: h.helpers }, input, env)).json.core_sales, true);
});

test('timeout transitório: uma nova tentativa e segue', async () => {
  const h = helpers([timeout(), [{ id: 't1', status: 'active', tenant_settings: [settingsRow] }]]);
  const out = await selector.call({ helpers: h.helpers }, input, env);
  assert.equal(h.calls.length, 2);
  assert.equal(out.json.use_conversation_core, true);
});

test('5xx e 429 também ganham uma nova tentativa; 4xx não', async () => {
  for (const status of [500, 503, 429]) {
    const h = helpers([Object.assign(new Error('x'), { response: { status } }), [{ id: 't1', status: 'active', tenant_settings: [settingsRow] }]]);
    await selector.call({ helpers: h.helpers }, input, env);
    assert.equal(h.calls.length, 2, String(status));
  }
  for (const status of [400, 401, 403, 404]) {
    const h = helpers([Object.assign(new Error('x'), { response: { status } }), [{ id: 't1' }]]);
    await assert.rejects(selector.call({ helpers: h.helpers }, input, env));
    assert.equal(h.calls.length, 1, String(status));
  }
});

test('duas falhas seguidas: falha fechado, sem terceira tentativa', async () => {
  const h = helpers([timeout(), timeout(), [{ id: 't1' }]]);
  await assert.rejects(selector.call({ helpers: h.helpers }, input, env), /timeout/);
  assert.equal(h.calls.length, 2);
});

test('travas de segurança continuam iguais', async () => {
  let h = helpers([[{ id: 't1', status: 'active', tenant_settings: [{ ...settingsRow, mode: 'legacy' }] }]]);
  await assert.rejects(selector.call({ helpers: h.helpers }, input, env), /legacy fallback blocked/);
  h = helpers([[{ id: 't1', status: 'paused', tenant_settings: [settingsRow] }]]);
  await assert.rejects(selector.call({ helpers: h.helpers }, input, env), /active tenant/);
  h = helpers([[{ id: 't1', status: 'active', tenant_settings: [settingsRow] }]]);
  await assert.rejects(selector.call({ helpers: h.helpers }, { ...input, tenant_resolution: { source: 'env_fallback' }, instance: '' }, env), /active tenant/);
  h = helpers([[]]);
  assert.equal((await selector.call({ helpers: h.helpers }, input, env)).json.use_conversation_core, false);
  h = helpers([[{ id: 't1', status: 'active', tenant_settings: [] }]]);
  assert.equal((await selector.call({ helpers: h.helpers }, input, env)).json.use_conversation_core, false);
});

test('o nó publicado do Entrada tem exatamente este código', () => {
  const workflow = JSON.parse(fs.readFileSync(path.join(root, 'n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json'), 'utf8'));
  const node = workflow.nodes.find(item => item.name === 'Selecionar Motor WhatsApp');
  const normalize = text => String(text || '').replace(/\r\n/g, '\n').trim();
  assert.equal(normalize(node.parameters.jsCode), normalize(code));
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const code = fs.readFileSync(path.join(root, 'n8n/code/whatsapp_avatar_refresh.js'), 'utf8');

const baseEnv = { SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'k' };
const evolutionEnv = slug => ({
  [`EVOLUTION_API_URL_${slug}`]: `https://evo-${slug.toLowerCase()}.example`,
  [`EVOLUTION_API_KEY_${slug}`]: `key-${slug}`,
  [`EVOLUTION_INSTANCE_${slug}`]: `inst-${slug}`,
});
const contact = (id, extra = {}) => ({ id, external_handle: `55219${String(id).replace(/\D/g, '').padStart(8, '0')}@s.whatsapp.net`, avatar_url: null, ...extra });

async function run({ tenants, contacts = {}, evolution = () => ({ profilePictureUrl: 'https://pps.whatsapp.net/a.jpg?oe=6AFF94ED' }), environment }) {
  const calls = [];
  const httpRequest = async (request) => {
    calls.push(request);
    const { url, method } = request;
    if (url.includes('/rest/v1/tenants?')) return tenants;
    if (url.includes('/rest/v1/contacts?select=') && method === 'GET') {
      const tenantId = /tenant_id=eq\.([^&]+)/.exec(url)[1];
      const limit = Number(/limit=(\d+)/.exec(url)[1]);
      return (contacts[decodeURIComponent(tenantId)] || []).slice(0, limit);
    }
    if (url.includes('/rest/v1/contacts?id=') && method === 'PATCH') return [];
    if (url.includes('/chat/fetchProfilePictureUrl/')) return evolution(request);
    throw new Error(`unexpected ${method} ${url}`);
  };
  const fn = new AsyncFunction('$json', '$env', code);
  const [{ json }] = await fn.call({ helpers: { httpRequest } }, {}, environment);
  return { summary: json, calls };
}

test('atende todos os tenants ativos com Evolution configurada e ignora os sem configuração', async () => {
  const { summary, calls } = await run({
    tenants: [{ id: 't-a', slug: 'ic_salon' }, { id: 't-b', slug: 'clinica_nubia_oficial' }, { id: 't-c', slug: 'novo_tenant' }],
    contacts: { 't-a': [contact('a1')], 't-b': [contact('b1')], 't-c': [contact('c1')] },
    environment: { ...baseEnv, ...evolutionEnv('IC_SALON'), ...evolutionEnv('CLINICA_NUBIA_OFICIAL') },
  });
  assert.deepEqual(summary.tenants_without_evolution, ['novo_tenant']);
  assert.equal(summary.photos_saved, 2);
  assert.equal(calls.some(call => call.url.includes('tenant_id=eq.t-c')), false, 'tenant sem Evolution nem é consultado');
  const tenantsQuery = calls.find(call => call.url.includes('/rest/v1/tenants?'));
  assert.match(tenantsQuery.url, /status=eq\.active/);
  assert.match(tenantsQuery.url, /deleted_at=is\.null/);
});

test('cada tenant usa a própria instância e cada gravação é filtrada pelo tenant do contato', async () => {
  const { calls } = await run({
    tenants: [{ id: 't-a', slug: 'ic_salon' }, { id: 't-b', slug: 'wesley_automoveis' }],
    contacts: { 't-a': [contact('a1')], 't-b': [contact('b1')] },
    environment: { ...baseEnv, ...evolutionEnv('IC_SALON'), ...evolutionEnv('WESLEY_AUTOMOVEIS') },
  });
  const evo = calls.filter(call => call.url.includes('/chat/fetchProfilePictureUrl/'));
  assert.ok(evo.some(call => call.url === 'https://evo-ic_salon.example/chat/fetchProfilePictureUrl/inst-IC_SALON' && call.headers.apikey === 'key-IC_SALON'));
  assert.ok(evo.some(call => call.url.startsWith('https://evo-wesley_automoveis.example/') && call.headers.apikey === 'key-WESLEY_AUTOMOVEIS'));
  const patches = calls.filter(call => call.method === 'PATCH');
  assert.ok(patches.some(call => call.url.includes('id=eq.a1&tenant_id=eq.t-a')));
  assert.ok(patches.some(call => call.url.includes('id=eq.b1&tenant_id=eq.t-b')));
  assert.ok(patches.every(call => /&tenant_id=eq\./.test(call.url)));
});

test('o banco devolve só os contatos vencidos, os mais antigos primeiro, em lote pequeno', async () => {
  const { calls } = await run({
    tenants: [{ id: 't-a', slug: 'ic_salon' }],
    contacts: { 't-a': [] },
    environment: { ...baseEnv, ...evolutionEnv('IC_SALON') },
  });
  const query = decodeURIComponent(calls.find(call => call.url.includes('/rest/v1/contacts?select=')).url);
  assert.match(query, /or=\(avatar_fetched_at\.is\.null,and\(avatar_url\.not\.is\.null,avatar_fetched_at\.lt\./);
  assert.match(query, /and\(avatar_url\.is\.null,avatar_fetched_at\.lt\./);
  assert.match(query, /order=avatar_fetched_at\.asc\.nullsfirst/);
  assert.match(query, /deleted_at=is\.null/);
  assert.ok(Number(/limit=(\d+)/.exec(query)[1]) <= 25);
});

test('respeita o teto de chamadas por execução e divide entre os tenants', async () => {
  const many = prefix => Array.from({ length: 40 }, (_, i) => contact(`${prefix}${i}`));
  const { summary } = await run({
    tenants: [{ id: 't-a', slug: 'ic_salon' }, { id: 't-b', slug: 'wesley_automoveis' }],
    contacts: { 't-a': many('a'), 't-b': many('b') },
    environment: { ...baseEnv, ...evolutionEnv('IC_SALON'), ...evolutionEnv('WESLEY_AUTOMOVEIS') },
  });
  assert.ok(summary.fetched <= 25, `fetched=${summary.fetched}`);
  assert.ok(summary.per_tenant.ic_salon.saved >= 12 && summary.per_tenant.wesley_automoveis.saved >= 12, 'rodízio justo');
});

test('sem foto grava avatar nulo; erro transitório só adia o contato e pausa o tenant após 3 falhas', async () => {
  const { summary, calls } = await run({
    tenants: [{ id: 't-a', slug: 'ic_salon' }, { id: 't-b', slug: 'wesley_automoveis' }],
    contacts: {
      't-a': [contact('a1'), contact('a2', { avatar_url: 'https://pps.whatsapp.net/old.jpg' }), contact('a3'), contact('a4'), contact('a5')],
      't-b': [contact('b1')],
    },
    evolution: request => {
      if (request.url.includes('wesley')) return { profilePictureUrl: null };
      throw Object.assign(new Error('timeout'), { httpCode: '500' });
    },
    environment: { ...baseEnv, ...evolutionEnv('IC_SALON'), ...evolutionEnv('WESLEY_AUTOMOVEIS') },
  });
  assert.equal(summary.no_photo, 1);
  assert.ok(calls.some(call => call.method === 'PATCH' && call.url.includes('id=eq.b1') && call.body.avatar_url === null && call.body.avatar_fetched_at));
  assert.deepEqual(summary.paused_tenants, ['ic_salon']);
  assert.equal(summary.per_tenant.ic_salon.failed, 3, 'para após 3 falhas seguidas');
  const deferred = calls.filter(call => call.method === 'PATCH' && call.url.includes('tenant_id=eq.t-a'));
  assert.equal(deferred.length, 3);
  assert.ok(deferred.every(call => !('avatar_url' in call.body)), 'falha não apaga a foto atual');
  const a2 = deferred.find(call => call.url.includes('id=eq.a2'));
  const ageDays = (Date.now() - Date.parse(a2.body.avatar_fetched_at)) / 86_400_000;
  assert.ok(ageDays > 5.9 && ageDays < 6.1, 'contato com foto volta à fila em ~1 dia');
});

test('404 da Evolution conta como sem foto e resposta desconhecida não apaga nada', async () => {
  const { summary, calls } = await run({
    tenants: [{ id: 't-a', slug: 'ic_salon' }],
    contacts: { 't-a': [contact('a1'), contact('a2', { avatar_url: 'https://pps.whatsapp.net/keep.jpg' })] },
    evolution: request => {
      if (request.body.number.includes('a1') || request.body.number.endsWith('00000001@s.whatsapp.net')) throw Object.assign(new Error('nf'), { httpCode: '404' });
      return { weird: true };
    },
    environment: { ...baseEnv, ...evolutionEnv('IC_SALON') },
  });
  assert.equal(summary.no_photo, 1);
  assert.equal(summary.unknown, 1);
  const a2 = calls.find(call => call.method === 'PATCH' && call.url.includes('id=eq.a2'));
  assert.ok(a2 && !('avatar_url' in a2.body));
});

test('o sufixo das variáveis da Evolution é idêntico ao do CORE', () => {
  const extract = source => {
    const body = /function tenantEnvSuffix\([^)]*\) \{([\s\S]*?)\n\}/.exec(source)[1];
    return new Function('value', 'slug', body.replace(/slug/g, 'value'));
  };
  const core = extract(fs.readFileSync(path.join(root, 'n8n/sources/noria_core.js'), 'utf8'));
  const worker = extract(code);
  for (const slug of ['ic_salon', 'clinica_nubia_oficial', 'royal-4x4', 'a__b_', 'universo prata']) {
    assert.equal(worker(slug), core(slug), slug);
  }
});

test('URL que não seja https não é salva nem apaga a foto atual', async () => {
  const { summary, calls } = await run({
    tenants: [{ id: 't-a', slug: 'ic_salon' }],
    contacts: { 't-a': [contact('a1')] },
    evolution: () => ({ profilePictureUrl: 'http://inseguro.example/a.jpg' }),
    environment: { ...baseEnv, ...evolutionEnv('IC_SALON') },
  });
  assert.equal(summary.photos_saved, 0);
  assert.equal(summary.no_photo, 0);
  assert.equal(calls.some(call => call.method === 'PATCH' && 'avatar_url' in call.body), false);
});

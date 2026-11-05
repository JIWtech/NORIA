// Regressão: a identidade da EXT Gênesis é lida uma vez por minuto (tenant+instância) e lê só as chaves que expõe.
// Rodar: node --test scripts/test_genesis_identity_cache.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const code = fs.readFileSync(path.join(__dirname, '../n8n/sources/genesis_tenant_identity.js'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const TENANT = '0b5e0000-0000-4000-8000-000000000001';
const settings = { whatsapp_processing_mode: 'conversation_core_v1', conversation_capability: 'sales_v1', sales: { stages: {} }, sdr_rules: { hot_lead_percent: 30 }, business_facts: { name: 'X' } };

async function run(memory, calls, overrides = {}) {
  const http = async ({ url }) => {
    calls.push(url);
    if (/\/tenants\?/.test(url)) return [{ id: TENANT, slug: 'wesley_automoveis', status: 'active' }];
    if (/\/tenant_settings\?/.test(url)) return [{ ...settings, ...overrides }];
    return [{ external_id: 'inst', config: {}, status: 'active' }];
  };
  return new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', code).call({ helpers: { httpRequest: http } },
    { tenant_slug: 'wesley_automoveis', noria_extension: 'genesis', noria_contract_version: '2.0', tenant_id: TENANT, instance: 'inst', remoteJid: '5500@s.whatsapp.net' },
    { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'k' }, {}, () => memory);
}

test('a primeira chamada lê 3 vezes (só as chaves expostas); as seguintes no minuto não leem nada', async () => {
  const memory = {}, calls = [];
  const first = await run(memory, calls);
  assert.equal(calls.length, 3);
  const settingsUrl = decodeURIComponent(calls.find(url => /tenant_settings/.test(url)));
  assert.ok(!/select=settings(&|$)/.test(settingsUrl) && /sales:settings->sales/.test(settingsUrl), 'o documento inteiro de settings não é lido');
  assert.equal(first.json.noria_verified_settings.whatsapp_processing_mode, 'conversation_core_v1');
  const second = await run(memory, calls);
  assert.equal(calls.length, 3, 'cache: nenhuma leitura nova');
  assert.deepEqual(JSON.parse(JSON.stringify(second.json.noria_verified_settings)), JSON.parse(JSON.stringify(first.json.noria_verified_settings)));
});

test('cache vencido é relido e uma validação que falha nunca entra no cache', async () => {
  const memory = {}, calls = [];
  await run(memory, calls);
  for (const entry of Object.values(memory.noria_identity)) entry.at -= 61000;
  await run(memory, calls);
  assert.equal(calls.length, 6, 'após 60 s a identidade é validada de novo');
  const bad = {}, badCalls = [];
  await assert.rejects(() => run(bad, badCalls, { conversation_capability: 'standard' }), /NORIA_CAPACIDADE_DIVERGENTE/);
  assert.equal(bad.noria_identity, undefined);
});

test('identidade transporta políticas comerciais para a EXT sem expor campos alheios', async () => {
  const services = [{ id: 'documentation', confirmation: 'A equipe verifica.' }];
  const catalog = { list_requires_criteria: true, max_items: 3 };
  const out = await run({}, [], {
    sales: { catalog_presentation: catalog, inventory_max_age_hours: 48, unrelated_secret: 'não transportar' },
    business_facts: { human_services: services, unrelated_private: 'não transportar' },
  });
  const verified = out.json.noria_verified_settings;
  assert.deepEqual(verified.sales.catalog_presentation, catalog);
  assert.equal(verified.sales.inventory_max_age_hours, 48);
  assert.deepEqual(verified.business_facts.human_services, services);
  assert.equal(verified.sales.unrelated_secret, undefined);
  assert.equal(verified.business_facts.unrelated_private, undefined);
});

test('cache da identidade anterior à projeção comercial é invalidado', async () => {
  const memory = { noria_identity: { [TENANT+'|inst']: { at: Date.now(), verified: { tenant_id: TENANT } } } };
  const calls = [];
  const out = await run(memory, calls);
  assert.equal(calls.length, 3);
  assert.equal(out.json.noria_verified_settings.conversation_capability, 'sales_v1');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const root = path.join(__dirname, '..');
const env = { SUPABASE_URL: 'https://db.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture' };
const id = '11111111-1111-4111-8111-111111111111';
const input = { tenant_slug: 'noria', tenant_id: id, instance: 'instancia', remoteJid: '5511@s.whatsapp.net', messageText: 'oi' };
// Política no formato real que o motor valida (noria_policy_v2); um formato qualquer seria recusado depois da EXT.
const policy = { contract: 'noria_policy_v2', profile: 'services_booking_v2', capability: 'standard', tenant_slug: 'noria', tenant_id: id,
  audio_enabled: true, modules: { turn_pipeline: { contract: 'noria_turn_pipeline_v1' } } };
async function run(file, data, overrides = {}, binary) {
  const code = fs.readFileSync(path.join(root, 'n8n/sources', file), 'utf8');
  const requests = [];
  const rows = { tenants: [{ id, slug: 'noria', status: 'active' }], channels: [{ external_id: 'instancia', status: 'active', config: {} }], tenant_settings: [{ settings: { noria_client_policy: policy } }], ...overrides };
  const out = await new AsyncFunction('$json', '$env', '$binary', code).call({ helpers: { httpRequest: async req => { requests.push(req); const table = new URL(req.url).pathname.split('/').pop(); if (rows[table] instanceof Error) throw rows[table]; return rows[table]; } } }, data, env, binary);
  return { value: out.json, binary: out.binary, requests };
}
test('router e EXT preservam o contrato e a política configurada', async () => {
  const binary = { audio: { data: 'fixture', mimeType: 'audio/ogg' } };
  const routed = await run('noria_router.js', input, {}, binary);
  assert.equal(routed.value.noria_extension, 'noria');
  assert.equal(routed.value.noria_contract_version, '1.0');
  assert.deepEqual(routed.binary, binary);
  const ext = await run('noria_extension.js', routed.value, {}, routed.binary);
  assert.deepEqual(ext.binary, binary);
  assert.deepEqual(ext.value.noria_client_policy, policy);
  assert.equal(ext.value.messageText, 'oi');
  for (const req of [...routed.requests, ...ext.requests]) {
    assert.equal(req.method, 'GET');
    const url = new URL(req.url);
    const table = url.pathname.split('/').pop();
    assert.equal(url.searchParams.get(table === 'tenants' ? 'id' : 'tenant_id'), 'eq.' + id);
  }
});
test('a política entregue pela EXT NORIA é aceita pelo contrato do motor e recusada se divergir', async () => {
  const ts = require('../app/node_modules/typescript');
  const code = fs.readFileSync(path.join(root, 'n8n/sources/noria_core.js'), 'utf8');
  const ast = ts.createSourceFile('core.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const source = ast.statements.filter(ts.isFunctionDeclaration).filter(n => n.name.text === 'validateTenantPolicyContract').map(n => n.getText(ast)).join('\n');
  const validate = (rules, inputJson = input) => new Function('tenantBusinessRules', 'tenantSlug', 'inputJson', 'salesUsesStructuredDialogue', 'allowedBusinessProfiles',
    source + '\nreturn validateTenantPolicyContract();')(rules, 'noria', inputJson, () => false,
    { nb_bronze_v1: 'standard', vehicle_sales_v1: 'sales_v1', services_booking_v2: 'standard' });
  const routed = await run('noria_router.js', input);
  const ext = await run('noria_extension.js', routed.value);
  assert.doesNotThrow(() => validate(ext.value.noria_client_policy));
  for (const bad of [{ profile: 'atual' }, { tenant_id: '22222222-2222-4222-8222-222222222222' }, { tenant_slug: 'outro' }, { capability: 'sales_v1' }, { audio_enabled: undefined },
    { modules: {} }]) {
    assert.throws(() => validate({ ...policy, ...bad }), /NORIA_POLICY_CONTRACT_MISMATCH/, JSON.stringify(bad));
  }
});
test('roteador e EXT recusam identidade ou canal incompatível', async () => {
  for (const file of ['noria_router.js', 'noria_extension.js']) {
    const data = file === 'noria_extension.js' ? { ...input, noria_extension: 'noria', noria_contract_version: '1.0' } : input;
    await assert.rejects(run(file, data, { tenants: [] }), /TENANT_INVALIDO/);
    await assert.rejects(run(file, data, { tenants: [{ id, slug: 'noria', status: 'inactive' }] }), /TENANT_INVALIDO/);
    await assert.rejects(run(file, data, { channels: [{ external_id: 'outra', status: 'active' }] }), /INSTANCIA_NAO_PERTENCE/);
    await assert.rejects(run(file, data, { channels: [{ external_id: 'instancia', status: 'inactive' }] }), /INSTANCIA_NAO_PERTENCE/);
    await assert.rejects(run(file, { ...data, tenant_id: 'inválido' }), /IDENTIDADE_INCOMPLETA/);
    await assert.rejects(run(file, data, { tenants: [{ id: '22222222-2222-4222-8222-222222222222', slug: 'noria', status: 'active' }] }), /TENANT_INVALIDO/);
  }
  await assert.rejects(run('noria_extension.js', { ...input, tenant_slug: 'outro', noria_extension: 'noria', noria_contract_version: '1.0' }), /TENANT_INCORRETO/);
});
test('EXT exige política do tenant e roteamento dinâmico de terceiros é preservado', async () => {
  const routed = await run('noria_router.js', { ...input, tenant_slug: 'outro' }, { tenants: [{ id, slug: 'outro', status: 'active' }] });
  assert.equal(routed.value.noria_extension, 'saas_dynamic');
  assert.deepEqual(routed.value.noria_client_policy, policy);
  await assert.rejects(run('noria_extension.js', { ...input, noria_extension: 'noria', noria_contract_version: '1.0' }, { tenant_settings: [{ settings: {} }] }), /SEM_EXTENSAO_CONFIGURADA/);
});

// Trava do ramo SaaS: o slug pertence ao tenant_id e a instância pertence a um canal WhatsApp ativo do mesmo tenant (cenário I&C Salon).
const salonId = '76aff8a0-0466-42b9-a80d-db186ff3d8bd';
const salon = { tenant_slug: 'ic_salon', tenant_id: salonId, instance: 'ic_saloon', remoteJid: '5511@s.whatsapp.net', messageText: 'oi' };
const salonRows = (extra = {}) => ({ tenants: [{ id: salonId, slug: 'ic_salon', status: 'active' }], channels: [{ external_id: 'ic_saloon', status: 'active', config: {} }], ...extra });
test('ramo SaaS confere no banco slug, tenant e instância antes de entregar a política', async () => {
  const ok = await run('noria_router.js', salon, salonRows());
  assert.equal(ok.value.noria_extension, 'saas_dynamic');
  assert.deepEqual(ok.value.noria_client_policy, policy);
  for (const req of ok.requests) {
    const url = new URL(req.url), table = url.pathname.split('/').pop();
    assert.equal(url.searchParams.get(table === 'tenants' ? 'id' : 'tenant_id'), 'eq.' + salonId, table);
  }
  assert.equal(new URL(ok.requests[0].url).searchParams.get('slug'), 'eq.ic_salon');
  const viaConfig = await run('noria_router.js', salon, salonRows({ channels: [{ external_id: 'outro', status: 'active', config: { instance_name: 'IC_Saloon' } }] }));
  assert.equal(viaConfig.value.noria_extension, 'saas_dynamic');
});
test('ramo SaaS recusa slug divergente, instância de outro tenant, canal ou tenant inativo e identidade malformada', async () => {
  await assert.rejects(run('noria_router.js', salon, salonRows({ tenants: [] })), /NORIA_ROTEAMENTO_TENANT_INVALIDO/);
  await assert.rejects(run('noria_router.js', salon, salonRows({ tenants: [{ id: salonId, slug: 'outro_slug', status: 'active' }] })), /NORIA_ROTEAMENTO_TENANT_INVALIDO/);
  await assert.rejects(run('noria_router.js', salon, salonRows({ tenants: [{ id: '22222222-2222-4222-8222-222222222222', slug: 'ic_salon', status: 'active' }] })), /NORIA_ROTEAMENTO_TENANT_INVALIDO/);
  await assert.rejects(run('noria_router.js', salon, salonRows({ tenants: [{ id: salonId, slug: 'ic_salon', status: 'inactive' }] })), /NORIA_ROTEAMENTO_TENANT_INVALIDO/);
  await assert.rejects(run('noria_router.js', { ...salon, instance: 'instancia_de_outro' }, salonRows()), /NORIA_ROTEAMENTO_INSTANCIA_NAO_PERTENCE/);
  await assert.rejects(run('noria_router.js', salon, salonRows({ channels: [] })), /NORIA_ROTEAMENTO_INSTANCIA_NAO_PERTENCE/);
  await assert.rejects(run('noria_router.js', salon, salonRows({ channels: [{ external_id: 'ic_saloon', status: 'inactive' }] })), /NORIA_ROTEAMENTO_INSTANCIA_NAO_PERTENCE/);
  await assert.rejects(run('noria_router.js', { ...salon, tenant_id: 'invalido' }, salonRows()), /NORIA_ROTEAMENTO_IDENTIDADE_INCOMPLETA/);
  const none = await run('noria_router.js', salon, salonRows({ tenant_settings: [{ settings: {} }] })).catch(error => error);
  assert.match(String(none.message), /NORIA_SEM_EXTENSAO_CONFIGURADA/, 'identidade válida mas sem política continua falhando fechado');
});

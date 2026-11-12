const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const root = path.join(__dirname, '..');
const env = { SUPABASE_URL: 'https://db.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture' };
const id = '11111111-1111-4111-8111-111111111111';
const input = { tenant_slug: 'noria', tenant_id: id, instance: 'instancia', remoteJid: '5511@s.whatsapp.net', messageText: 'oi' };
const policy = { profile: 'atual', modules: { example: { enabled: true } } };
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
  // O roteador confirma no banco que o slug pertence ao tenant_id ativo: o terceiro precisa existir com o slug informado.
  const routed = await run('noria_router.js', { ...input, tenant_slug: 'outro' }, { tenants: [{ id, slug: 'outro', status: 'active' }] });
  assert.equal(routed.value.noria_extension, 'saas_dynamic');
  assert.deepEqual(routed.value.noria_client_policy, policy);
  await assert.rejects(run('noria_extension.js', { ...input, noria_extension: 'noria', noria_contract_version: '1.0' }, { tenant_settings: [{ settings: {} }] }), /SEM_EXTENSAO_CONFIGURADA/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const tenant = '11111111-1111-1111-1111-111111111111';

async function run(file, slug, extension, channels) {
  const source = fs.readFileSync(path.join(__dirname, '../n8n/sources', file), 'utf8');
  const execute = new AsyncFunction('$json', '$env', '$getWorkflowStaticData', source);
  const input = { tenant_id: tenant, tenant_slug: slug, noria_extension: extension, noria_contract_version: '2.0',
    instance: 'Minha-Instancia', remoteJid: '5511', noria_dispatch_phase: 'bootstrap' };
  const httpRequest = async ({ url }) => {
    if (url.includes('/tenants?')) return [{ id: tenant, status: 'active' }];
    if (url.includes('/channels?')) return channels;
    if (url.includes('/tenant_settings?')) return extension === 'genesis'
      ? [{ whatsapp_processing_mode: 'conversation_core_v1', conversation_capability: 'sales_v1' }]
      : [{ settings: { whatsapp_processing_mode: 'conversation_core_v1' } }];
    throw new Error('consulta inesperada');
  };
  return execute.call({ helpers: { httpRequest } }, input, { SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test' }, () => null);
}

for (const [file, slug, extension] of [
  ['genesis_tenant_identity.js', 'wesley_automoveis', 'genesis'],
  ['nubia_extension.js', 'clinica_nubia_oficial', 'nubia'],
]) {
  test(`${extension}: aceita instanceId ignorando caixa`, async () => {
    assert.ok(await run(file, slug, extension, [{ config: { instanceId: 'minha-instancia' } }]));
  });
  test(`${extension}: rejeita outro canal`, async () => {
    await assert.rejects(() => run(file, slug, extension, [{ config: { instanceId: 'outra' } }]), /NORIA_INSTANCIA_NAO_PERTENCE_AO_TENANT/);
  });
}

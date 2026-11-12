// IA-24: loadTenantContext deve achar o canal por external_id ou aliases de config, sem diferenciar caixa,
// e continuar recusando instâncias que não pertencem ao tenant (isolamento).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../n8n/sources/noria_core.js'), 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('function normalizeInstanceKey(');
const end = source.indexOf('\nasync function loadRecentHistory(', start);
assert.ok(start >= 0 && end > start, 'trecho loadTenantContext ausente');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const build = new AsyncFunction('supabaseGet', 'encodeFilter', 'tenantSlug', 'inputJson', 'tenantGeminiDailyLimit', 'tenantBusinessRules',
  'let geminiTenantBudget = null;\n' + source.slice(start, end) + '\nreturn loadTenantContext;');

async function context(channels, instance) {
  const supabaseGet = async (url) => {
    if (url.startsWith('/rest/v1/tenants')) return [{ id: 't1', slug: 'nubia', status: 'active' }];
    if (url.startsWith('/rest/v1/tenant_settings')) return [{ settings: { whatsapp_processing_mode: 'conversation_core_v1', grounding_mode: 'canonical_v2' } }];
    if (url.startsWith('/rest/v1/channels')) return channels;
    throw new Error('consulta inesperada ' + url);
  };
  const load = await build(supabaseGet, encodeURIComponent, 'nubia', { tenant_id: 't1', instance }, () => 100, {});
  return load();
}

test('encontra o canal por external_id', async () => {
  const ctx = await context([{ external_id: 'nubia-01', config: {} }], 'nubia-01');
  assert.equal(ctx.channel.external_id, 'nubia-01');
});

test('encontra o canal por config.instance_name e ignora caixa', async () => {
  const ctx = await context([{ external_id: '5511', config: { instance_name: 'Nubia-Oficial' } }], 'nubia-oficial');
  assert.equal(ctx.channel.external_id, '5511');
});

test('recusa instância que não pertence ao tenant', async () => {
  await assert.rejects(() => context([{ external_id: 'nubia-01', config: { instance_name: 'nubia-01' } }], 'outra-empresa'), /Instance does not belong to tenant/);
  await assert.rejects(() => context([], 'nubia-01'), /Instance does not belong to tenant/);
});

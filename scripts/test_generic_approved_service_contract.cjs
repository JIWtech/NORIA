const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// Poda Fase 4.1 (ic_salon): groundingApprovedMessageMap e groundingApprovedReplyText pertencem ao fluxo canonical_v2 (Nubia),
// removido de clients/ic_saloon/salon_engine.js por ser inalcancavel no Salon. validateTenantPolicyContract segue coberto em ambos via noria_core e suite do Salon.
for (const file of ['n8n/sources/noria_core.js']) {
  test(`${file}: textos declarados validam catálogo e falham fechados`, async () => {
    const code = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const hook = /try \{\r?\n\s*const turnResult = await runTurn\(\);/.exec(code);
    assert.ok(hook);
    const load = async (modules, profile = 'vehicle_sales_v1', capability = 'sales_v1') => new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', code.replace(hook[0],
      'return { groundingApprovedMessageMap, groundingApprovedReplyText, validateTenantPolicyContract };\n' + hook[0])).call(
      { helpers: {} }, { tenant_id: 't', tenant_slug: 'clinic', noria_client_policy: { contract: 'noria_policy_v2', tenant_id: 't', tenant_slug: 'clinic', profile, capability, audio_enabled: false, modules } }, {}, {}, () => ({}));
    const catalog = { matches: [{ external_id: 's', active: true, price: 100 }] };
    const context = { settings: { settings: { approved_messages: { enabled: true, revision: 'nb-texts-v1', catalog_prices: { s: 100 }, blocks: { offer: { text: 'R$ 100,00', service_ids: ['s'] } } } } } };
    const enabled = await load({ approved_service_texts: true, messages: {} });
    assert.equal(enabled.groundingApprovedReplyText(context, catalog, ['offer']), 'R$ 100,00');
    assert.equal(Object.keys(enabled.groundingApprovedMessageMap(context, { matches: [] })).length, 0);
    const disabled = await load({ approved_service_texts: false, messages: {} });
    assert.equal(Object.keys(disabled.groundingApprovedMessageMap(context, catalog)).length, 0);
    assert.throws(() => disabled.validateTenantPolicyContract(), /NORIA_POLICY_CONTRACT_MISMATCH/);
    const messages = Object.fromEntries(['home_booking', 'home_info', 'clinic_prefix', 'clinic_home_note', 'home_schedule', 'spray_schedule'].map(key => [key, 'fixture']));
    const valid = await load({ approved_service_texts: false, messages });
    assert.doesNotThrow(() => valid.validateTenantPolicyContract());
    const legacyProfile = await load({ approved_service_texts: false, messages }, 'nb_bronze_v1', 'standard');
    assert.doesNotThrow(() => legacyProfile.validateTenantPolicyContract());
    const unknown = await load({}, 'unknown', 'standard');
    assert.throws(() => unknown.validateTenantPolicyContract(), /NORIA_POLICY_CONTRACT_MISMATCH/);
    const legacy = await load({});
    assert.equal(legacy.groundingApprovedReplyText(context, catalog, ['offer']), 'R$ 100,00');
  });
}

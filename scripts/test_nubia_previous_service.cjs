const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const code = fs.readFileSync(path.join(__dirname, '../n8n/sources/nubia_extension.js'), 'utf8');
const tenant = '11111111-1111-4111-8111-111111111111', token = '22222222-2222-4222-8222-222222222222';
async function run(previous_service, text = 'Seria o bronze de amigas e pode ser o que sempre faço') {
  const semantic = { contract: 'noria_services_semantic_intent_v1', primary_intent: 'booking_intent', secondary_intents: [], evidence_ids: ['m1'], confidence: 'high', services: [], info_requests: [], slots: {}, payment: { declared: false }, human: { requested: false }, conversation: { topic_change: false, requires_clarification: false }, customer_disposition: { value: 'active' }, ambiguities: [] };
  if (previous_service !== undefined) semantic.previous_service = previous_service;
  const input = { tenant_id: tenant, tenant_slug: 'clinica_nubia_oficial', instance: 'inst', remoteJid: '5511@s.whatsapp.net', noria_extension: 'nubia', noria_contract_version: '2.0', noria_phase: 'commercial_decision', noria_business_context: { session_id: 'sess', request_id: 'm1:' + token }, turn: { claimed: true, contract: 'noria_turn_lifecycle_v1', token, tenant_slug: 'clinica_nubia_oficial', instance: 'inst', boundary_id: 'sess', messages: [{ event_id: 'm1', text }] }, session_evidence: [{ id: 'old', text: 'sempre faço', direction: 'inbound', sender_type: 'contact', session_id: 'sess' }], semantic_intent: semantic };
  const rows = { tenants: [{ id: tenant, slug: 'clinica_nubia_oficial', status: 'active' }], channels: [{ external_id: 'inst', status: 'active' }], tenant_settings: [{ settings: { whatsapp_processing_mode: 'conversation_core_v1' } }], tenant_service_catalog: [], follow_up_policies: [] };
  const httpRequest = async ({ url }) => rows[new URL(url).pathname.split('/').pop()];
  return (await new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', code).call({ helpers: { httpRequest } }, input, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'fixture' }, {}, () => ({}))).json;
}
test('cliente que declara serviço anterior é encaminhada sem agendamento automático', async () => {
  const out = await run({ declared: true, evidence_ids: ['m1'] });
  assert.equal(out.commercial_decision_status, 'ok');
  assert.deepEqual(out.commercial_decision.actions.handoff, { required: true, reason: 'PREVIOUS_SERVICE_CUSTOMER' });
  assert.equal(out.commercial_decision.actions.create_reservation.allowed, false);
  assert.equal(out.commercial_decision.actions.check_availability.allowed, false);
  assert.ok(out.commercial_decision.evidence_used.includes('m1'));
});
test('serviço anterior exige evidência atual válida', async () => {
  for (const ids of [[], ['old'], ['m1', 'old'], ['inventado']]) {
    const out = await run({ declared: true, evidence_ids: ids });
    assert.equal(out.commercial_decision_status, 'refused');
  }
});
test('pedido de bronze para amigas sem declaração anterior não dispara encaminhamento', async () => {
  for (const previous of [undefined, { declared: false, evidence_ids: [] }]) {
    const out = await run(previous, 'Quero marcar um bronze pra mim e minha amiguerr');
    assert.equal(out.commercial_decision.actions.handoff.required, false);
  }
});

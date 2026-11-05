// Ano desconhecido é interpretação do Gemini; a EXT valida prova e aplica a política.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const tenant = '11111111-1111-4111-8111-111111111111';
const token = '22222222-2222-4222-8222-222222222222';
const extCode = fs.readFileSync(path.join(root, 'n8n/sources/genesis_extension.js'), 'utf8');

function semantic(yearUnknown, evidence = ['in-now']) {
  return {
    valid: true, primary_intent: 'sale', secondary_intents: [], topics: ['sale'],
    customer_disposition: { value: 'active', evidence_ids: [] },
    offer_response: { value: 'none', evidence_ids: [], offer_ref: '' },
    catalog: { requested: false, category: 'unspecified', price_min_cents: null, price_max_cents: null, preferences: [], exclusions: [], evidence_ids: [] },
    customer_vehicle: { purpose: 'independent_sale', evidence_ids: ['in-now'], year_unknown: yearUnknown, year_evidence_ids: evidence },
    references: { previous_catalog: false, selected_ordinal: null, mentioned_product_ids: [], evidence_ids: [], product_references: [], product_role: 'none' },
    conversation: { continues_previous_topic: true, changes_preference: false, requires_clarification: false, frustration: { value: 'none', evidence_ids: [] } },
    auction: { intent: 'none', product_id: null, evidence_ids: [] }, ambiguities: [], confidence: 'high',
  };
}

async function decide(text, yearUnknown, evidence) {
  const input = {
    tenant_id: tenant, tenant_slug: 'wesley_automoveis', instance: 'fixture', remoteJid: 'fixture@s.whatsapp.net',
    noria_extension: 'genesis', noria_contract_version: '2.0', operation: 'commercial.decide', noria_phase: 'commercial_decision',
    noria_verified_settings: { tenant_id: tenant, whatsapp_processing_mode: 'conversation_core_v1', conversation_capability: 'sales_v1',
      sales: { stage_keys: { appraisal: 'sales_appraisal' }, stages: { sales_appraisal: { allow_ai: false } } },
      sdr_rules: { minimum_purchase_year: 1995 }, business_facts: { vehicle_appraisal: { remote: { photos_required: true, condition_description_required: true } } } },
    turn: { claimed: true, token, boundary_id: 'session', messages: [{ id: 'msg-now', event_id: 'in-now', text }] },
    noria_business_context: { session_id: 'session', request_id: 'fixture:' + token },
    state: { intent: 'sell', transaction_mode: 'sell', sell_vehicle: { brand: 'Chevrolet', model: 'Celta', year: null },
      dialogue_context: { pending_requirement: 'sell_year' } },
    appraisal_evidence: { contract: 'noria_appraisal_evidence_v1', vehicle_photo_count: 0, description_reported: false, appraisal_channel: 'remote' },
    semantic_intent: semantic(yearUnknown, evidence), dialogue_plan: { next_requirement: 'sell_year', handoff_reason: 'none' },
  };
  const out = await new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', extCode).call(
    { helpers: { httpRequest: async () => { throw new Error('sem rede'); } } }, input,
    { SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture' }, {}, () => ({}));
  assert.equal(out.json.commercial_decision_status, 'ok', out.json.commercial_decision_error);
  return out.json.commercial_decision;
}

test('não saber se consegue visitar a loja não significa desconhecer o ano do veículo', async () => {
  const decision = await decide('Não sei se consigo passar na loja hoje', false);
  assert.equal(decision.handoff.required, false);
});

test('ano desconhecido com prova atual aciona avaliação humana sem palavras-chave', async () => {
  const decision = await decide('O ano? Boa pergunta, me fugiu completamente', true);
  assert.equal(decision.handoff.required, true);
  assert.equal(decision.handoff.reason, 'appraisal_review');
});

test('ano desconhecido sem evidência atual não autoriza transferência', async () => {
  for (const evidence of [[], ['in-old'], ['invented']]) {
    assert.equal((await decide('Não sei', true, evidence)).handoff.required, false);
  }
});

test('CORE preserva a classificação e só aceita prova inbound do turno atual', async () => {
  const code = fs.readFileSync(path.join(root, 'n8n/code/whatsapp_conversation_core.generated.js'), 'utf8');
  const hook = /try \{\r?\n\s*const turnResult = await runTurn\(\);/.exec(code);
  const core = await new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData',
    code.replace(hook[0], 'return { salesValidateSemanticIntent };\n' + hook[0])).call(
    { helpers: { httpRequest: async () => { throw new Error('sem rede'); } } },
    { tenant_slug: 'wesley_automoveis', tenant_id: tenant, instance: 'fixture', remoteJid: 'fixture@s.whatsapp.net' }, {}, {}, () => ({}));
  const current = core.salesValidateSemanticIntent(semantic(true), [], ['in-now', 'in-old'], ['in-now']);
  assert.equal(current.valid, true);
  assert.equal(current.customer_vehicle.year_unknown, true);
  for (const evidence of [[], ['in-old'], ['invented'], ['in-now', 'invented']]) {
    const result = core.salesValidateSemanticIntent(semantic(true, evidence), [], ['in-now', 'in-old'], ['in-now']);
    assert.notEqual(result.customer_vehicle?.year_unknown, true);
  }
});

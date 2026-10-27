// Gênesis 27/10 (…0563128, Rodolfo): o atendente precisou perguntar "Qual o km ?". A IA passa a perguntar o km
// UMA vez quando a loja configura (business_facts.vehicle_appraisal.remote.ask_mileage). Só pede: nunca bloqueia a
// avaliação, nunca reprova resposta por isso e nunca insiste; o atendente trata o que foi ou não respondido.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const tenant = '11111111-1111-4111-8111-111111111111';
const token = '22222222-2222-4222-8222-222222222222';
const extCode = fs.readFileSync(path.join(root, 'n8n/sources/genesis_extension.js'), 'utf8');
const core = fs.readFileSync(path.join(root, 'n8n/sources/noria_core.js'), 'utf8').replace(/\r\n/g, '\n');

const semantic = {
  valid: true, primary_intent: 'sale', secondary_intents: [], topics: ['sale'],
  customer_disposition: { value: 'active', evidence_ids: [] },
  offer_response: { value: 'none', evidence_ids: [], offer_ref: '' },
  catalog: { requested: false, category: 'unspecified', price_min_cents: null, price_max_cents: null, preferences: [], exclusions: [], evidence_ids: [] },
  customer_vehicle: { purpose: 'independent_sale', evidence_ids: ['in-now'], year_unknown: false, year_evidence_ids: [] },
  references: { previous_catalog: false, selected_ordinal: null, mentioned_product_ids: [], evidence_ids: [], product_references: [], product_role: 'none' },
  conversation: { continues_previous_topic: true, changes_preference: false, requires_clarification: false, frustration: { value: 'none', evidence_ids: [] } },
  auction: { intent: 'none', product_id: null, evidence_ids: [] }, ambiguities: [], confidence: 'high',
};

async function decide({ remote, evidence, vehicle = { brand: 'Fiat', model: 'Siena', year: 2014 }, asked }) {
  const input = {
    tenant_id: tenant, tenant_slug: 'wesley_automoveis', instance: 'fixture', remoteJid: 'fixture@s.whatsapp.net',
    noria_extension: 'genesis', noria_contract_version: '2.0', operation: 'commercial.decide', noria_phase: 'commercial_decision',
    noria_verified_settings: { tenant_id: tenant, whatsapp_processing_mode: 'conversation_core_v1', conversation_capability: 'sales_v1',
      sales: { stage_keys: { appraisal: 'sales_appraisal' }, stages: { sales_appraisal: { allow_ai: false } } },
      sdr_rules: { minimum_purchase_year: 1995 }, business_facts: { vehicle_appraisal: { remote } } },
    turn: { claimed: true, token, boundary_id: 'session', messages: [{ id: 'msg-now', event_id: 'in-now', text: 'Quero vender meu Siena 2014' }] },
    noria_business_context: { session_id: 'session', request_id: 'fixture:' + token },
    state: { intent: 'sell', transaction_mode: 'sell', sell_vehicle: vehicle, dialogue_context: { pending_requirement: '' }, ...(asked ? { optional_appraisal_asked: asked } : {}) },
    appraisal_evidence: { contract: 'noria_appraisal_evidence_v1', vehicle_photo_count: 4, description_reported: true, appraisal_channel: 'remote', ...evidence },
    semantic_intent: semantic, dialogue_plan: { next_requirement: 'none', handoff_reason: 'none' },
  };
  const out = await new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', extCode).call(
    { helpers: { httpRequest: async () => { throw new Error('sem rede'); } } }, input,
    { SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture' }, {}, () => ({}));
  assert.equal(out.json.commercial_decision_status, 'ok', out.json.commercial_decision_error);
  return out.json.commercial_decision;
}
const pendingOf = decision => decision.commercial_state?.pending_requirement || '';
const remote = { photos_required: true, condition_description_required: true, ask_mileage: true };
const missing = { vehicle_photo_count: 0, description_reported: false };

test('loja que pede km: sem km relatado, a IA pergunta uma vez e registra que perguntou', async () => {
  const decision = await decide({ remote, evidence: { ...missing, mileage_reported: false } });
  assert.equal(pendingOf(decision), 'sell_mileage');
  assert.deepEqual(decision.commercial_state.optional_appraisal_asked, ['sell_mileage']);
  assert.equal(decision.handoff.required, false);
});

test('já perguntado: não insiste, segue para fotos/estado mesmo sem resposta', async () => {
  const decision = await decide({ remote, evidence: { ...missing, mileage_reported: false }, asked: ['sell_mileage'] });
  assert.equal(pendingOf(decision), 'vehicle_photo');
  assert.deepEqual(decision.commercial_state.optional_appraisal_asked, ['sell_mileage']);
});

test('km nunca bloqueia: com fotos e estado, o carro vai para a avaliação mesmo sem km', async () => {
  const decision = await decide({ remote, evidence: { mileage_reported: false } });
  assert.notEqual(pendingOf(decision), 'sell_mileage');
  assert.equal(decision.handoff.required, true);
  assert.equal(decision.handoff.reason, 'appraisal_review');
});

test('km já relatado não é perguntado', async () => {
  assert.equal(pendingOf(await decide({ remote, evidence: { ...missing, mileage_reported: true } })), 'vehicle_photo');
});

test('sem a configuração, nada muda', async () => {
  for (const config of [{ photos_required: true, condition_description_required: true }, { ...remote, ask_mileage: false }]) {
    assert.equal(pendingOf(await decide({ remote: config, evidence: { ...missing, mileage_reported: false } })), 'vehicle_photo');
  }
});

test('modelo e ano continuam vindo antes do km', async () => {
  assert.equal(pendingOf(await decide({ remote, evidence: { ...missing, mileage_reported: false }, vehicle: { brand: 'Fiat', model: 'Siena', year: null } })), 'sell_year');
});

test('CORE só informa se o km foi relatado e não reprova resposta por causa do km', () => {
  const start = core.indexOf("contract: 'noria_appraisal_evidence_v1'");
  assert.ok(core.slice(start, start + 900).includes('mileage_reported: Number.isSafeInteger(appraisalVehicle.mileage_km) && appraisalVehicle.mileage_km >= 0'));
  assert.ok(!core.includes("'sell_mileage' ? !"));
  assert.doesNotMatch(core, /REDUNDANT_FIELD_REQUEST:sell_mileage/);
});

test('o que a EXT registra como perguntado sobrevive à junção de estado do CORE', () => {
  const merge = core.slice(core.indexOf('function salesMergeState('), core.indexOf('\n}\n', core.indexOf('function salesMergeState(')));
  assert.ok(merge.includes('...prior, ...next'));
  assert.doesNotMatch(core.slice(core.indexOf('function salesEmptyState('), core.indexOf('function salesEmptyState(') + 3000), /optional_appraisal_asked/);
});

test('km dito por extenso é aceito; ano ou número que não aparece inteiro não vira km', () => {
  const slice = name => { const start = core.indexOf('function ' + name + '('); return core.slice(start, core.indexOf('\n}\n', start) + 3); };
  const mentioned = new Function(slice('normalizeText') + slice('salesMileageMentioned') + '; return salesMileageMentioned;')();
  for (const [text, km] of [['Tá com 85 mil km', 85000], ['85.000', 85000], ['uns 85000km', 85000], ['85k rodados', 85000], ['85,5 mil', 85500], ['120mil', 120000]]) {
    assert.equal(mentioned(text, km, 2014), true, text);
  }
  for (const [text, km] of [['Siena 2014', 2014], ['Tá com 85 mil km', 58000], ['Siena 2014', 14], ['tel 21985000123', 85000], ['85 mil', null]]) {
    assert.equal(mentioned(text, km, 2014), false, text);
  }
});

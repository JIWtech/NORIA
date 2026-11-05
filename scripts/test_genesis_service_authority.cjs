const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const tenant = '11111111-1111-4111-8111-111111111111';
const code = fs.readFileSync(path.join(root, 'n8n/sources/genesis_extension.js'), 'utf8');
async function decide({ id = 'documents', valid = true, mode = 'buy', product = null, references = [], services, topics = ['other'], forged = false } = {}) {
  const input = {
    tenant_id: tenant, tenant_slug: 'wesley_automoveis', instance: 'fixture', remoteJid: 'fixture@s.whatsapp.net',
    noria_extension: 'genesis', noria_contract_version: '2.0', operation: 'commercial.decide', noria_phase: 'commercial_decision',
    noria_verified_settings: { tenant_id: tenant, conversation_capability: 'sales_v1', whatsapp_processing_mode: 'conversation_core_v1',
      sales: { stage_keys: { human: 'human', after_sales: 'after_sales', qualifying: 'qualifying' },
        stages: { human: { allow_ai: false }, after_sales: { allow_ai: false }, qualifying: { allow_ai: true } },
        catalog_presentation: { list_requires_criteria: true, max_items: 3 } },
      business_facts: { human_services: services || [{ id: 'documents', name: 'Documentação', confirmation: 'A equipe verifica a documentação.' }] } },
    turn: { claimed: true, token: '22222222-2222-4222-8222-222222222222', boundary_id: 'session', messages: [{ id: 'msg', event_id: 'in-now', text: 'Pedido de serviço' }] },
    noria_business_context: { session_id: 'session', request_id: 'request:22222222-2222-4222-8222-222222222222' },
    state: { intent: mode, transaction_mode: mode }, product, inventory: product ? [product] : [],
    semantic_intent: { valid, primary_intent: mode === 'after_sales' ? 'after_sales' : 'other', topics, references: { product_references: references } },
    dialogue_plan: { human_service_id: id, human_requested: false,
      ...(forged ? { human_service: { id: 'forged', confirmation: 'PROMESSA NÃO AUTORIZADA' } } : {}) },
  };
  const result = await new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', code).call(
    { helpers: { httpRequest: async ({ url }) => {
      if (url.includes('/genesis_inventory_vehicles?')) return product ? [{
        vehicle_id: product.id, brand: 'Marca', model: product.model, model_year: 2020,
        status: 'announced', category: 'car', price_cents: product.price_cents,
        price_source: 'sheet_authorized', availability_confirmed: false,
      }] : [];
      throw Error('sem rede');
    } } }, input,
    { SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture' }, {}, () => ({}));
  assert.equal(result.json.commercial_decision_status, 'ok', result.json.commercial_decision_error);
  return result.json.commercial_decision;
}
test('EXT autoriza serviço cadastrado sem inventar pedido humano do cliente', async () => {
  const d = await decide();
  assert.equal(d.operations.human_service.id, 'documents');
  assert.equal(d.handoff.required, true);
  assert.equal(d.handoff.reason, 'declared_service');
  assert.equal(d.stage_key, 'human');
});
test('EXT rejeita serviço não cadastrado, interpretação inválida e objeto forjado pelo CORE', async () => {
  for (const args of [{ id: 'unknown' }, { valid: false }, { id: 'unknown', forged: true }]) {
    const d = await decide(args);
    assert.equal(d.operations.human_service, null, JSON.stringify(args));
    assert.equal(d.handoff.required, false);
  }
});
test('EXT decide serviço versus pós-venda e a política de silêncio', async () => {
  const service = await decide({ mode: 'after_sales' });
  assert.equal(service.operations.after_sales.active, false);
  assert.equal(service.response_policy.silent, false);
  assert.notEqual(service.commercial_state.transaction_mode, 'after_sales');
  assert.notEqual(service.commercial_state.intent, 'after_sales');
  const complaint = await decide({ mode: 'after_sales', id: '' });
  assert.equal(complaint.operations.after_sales.active, true);
  assert.equal(complaint.response_policy.silent, true);
});
test('busca fora do estoque não se aplica à seleção/interesse atual em produto', async () => {
  const services = [{ id: 'sourcing', requires: 'no_inventory_product', confirmation: 'A equipe verifica parceiros.' }];
  const product = { id: 'car', model: 'Modelo', status: 'listed', price_cents: 100000, offerable: true };
  for (const role of ['selected', 'interest']) {
    const args = { product, references: [{ product_id: 'car', role, evidence_ids: ['in-now'] }] };
    const d = await decide({ id: 'sourcing', services, ...args });
    assert.equal(d.operations.human_service, null, JSON.stringify({ args, focus: d.inventory_focus }));
  }
});

test('foco anterior no estoque não bloqueia pedido atual de busca de outro veículo', async () => {
  const d = await decide({ id: 'sourcing',
    services: [{ id: 'sourcing', requires: 'no_inventory_product', confirmation: 'A equipe verifica parceiros.' }],
    product: { id: 'car', model: 'Modelo anterior', status: 'listed', price_cents: 100000, offerable: true } });
  assert.equal(d.operations.human_service.id, 'sourcing');
  assert.equal(d.handoff.reason, 'declared_service');
});
test('EXT publica a política do catálogo e o alvo de apresentação do atendente', async () => {
  const d = await decide();
  assert.deepEqual(d.operations.catalog_presentation, { list_requires_criteria: true, max_items: 3 });
  assert.equal(d.response_policy.assignee_label, 'um atendente');
});

test('CORE transporta a indicação e somente executa o encaminhamento autorizado pela EXT', async () => {
  const ex = require('./homolog/genesis_executor.cjs');
  const settings = ex.loadSettings();
  settings.business_facts = { ...settings.business_facts, human_services: [{ id: 'documents', confirmation: 'A equipe verifica.' }] };
  const gemini = { reply: 'A equipe verifica.', semantic_intent: { primary_intent: 'other', topics: ['other'] },
    dialogue_plan: { human_requested: false, human_service_id: 'documents' } };
  const world = ex.createWorld({ mode: 'fixtures', geminiKey: null, settings, inventory: [],
    scenarioResponses: { primary: [ex.cannedPrimaryBody(gemini)], other: [] } });
  const out = await ex.runCustomerTurn(world, 'Preciso do serviço de documentação', 0);
  assert.equal(out.intermediate.dialogue_plan.human_requested, false);
  assert.equal(out.intermediate.dialogue_plan.human_service, undefined);
  assert.equal(out.decided.commercial_decision.operations.human_service.id, 'documents');
  assert.equal(out.decided.commercial_decision.handoff.reason, 'declared_service');
});

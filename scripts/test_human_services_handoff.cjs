// Serviço atendido por humano (business_facts.human_services): quando o pedido do cliente é um serviço que o tenant
// declara, o CORE confirma com o texto do próprio tenant, transfere e atribui; nunca nega o serviço.
// Funções REAIS do CORE gerado e do EXT, executadas pelo executor de homologação com respostas do modelo simuladas.
// Rodar: node --test scripts/test_human_services_handoff.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ex = require('./homolog/genesis_executor.cjs');

const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, 'homolog/fixtures/genesis_scenarios.json'), 'utf8'));
const salesOutbound = world => world.tables.channel_events.filter(row => row.direction === 'outbound' && row.ai_provider !== 'core_error').at(-1);
// the in-memory save RPC does not lock the lead; the published one does for the human stage
const lockHuman = world => ({ ...world.rpcOverrides, magia_sales_save: (w, p) => { const r = ex.RPC.magia_sales_save(w, p); if (p.p_stage === 'sales_human') { w.tables.sales_leads.find(l => l.id === r.id).ai_locked = true; r.ai_locked = true; } return r; } });

const service = { id: 'servico_documental', name: 'Serviço documental', description: 'Serviços de documentação de veículos', confirmation: 'Fazemos sim esse serviço!' };
const settingsWith = humanServices => {
  const settings = JSON.parse(JSON.stringify(ex.loadSettings()));
  settings.sales.stages = { ...(settings.sales.stages || {}), sales_human: { allow_ai: false, closed: false } };
  settings.business_facts = { ...(settings.business_facts || {}), human_services: humanServices };
  // Atendimento dentro do horário: a mensagem de transferência não depende do relógio do teste.
  delete settings.business_facts.opening_hours;
  return settings;
};
// O modelo nega o serviço e não pede humano: só o id do serviço aponta o pedido.
const denial = serviceId => ({
  reply: 'Nós não fazemos esse serviço por aqui. Posso ajudar em algo mais?',
  response_contract: { handoff_announced: false },
  dialogue_plan: { human_requested: false, handoff_reason: 'none', human_service_id: serviceId },
  semantic_intent: { primary_intent: 'other', topics: ['other'] }
});

async function turn(serviceId, humanServices) {
  const scenario = { name: 'human_service', turns: [{ text: 'Eu queria regularizar meu documento', gemini: denial(serviceId) }], auditor_responses: [] };
  const result = await ex.runScenario(scenario, { mode: 'fixtures', geminiKey: null, settings: settingsWith(humanServices), inventory: fixtures.inventory,
    seed: w => { w.rpcOverrides = lockHuman(w); } });
  return { world: result.world, outbound: salesOutbound(result.world) };
}

test('serviço declarado pelo tenant: confirma com o texto do tenant, transfere e não nega', async () => {
  const { world, outbound } = await turn('servico_documental', [service]);
  assert.equal(outbound.handoff, true, JSON.stringify(outbound.raw_payload.handoff_execution));
  assert.equal(outbound.raw_payload.handoff_execution.executed, true);
  assert.equal(outbound.raw_payload.human_service?.id, 'servico_documental');
  assert.ok(outbound.message_text.startsWith('Fazemos sim esse serviço!'), outbound.message_text);
  assert.doesNotMatch(outbound.message_text, /não fazemos/i);
  assert.equal(world.tables.sales_leads[0].ai_locked, true);
});

test('id que o tenant não declarou não decide nada', async () => {
  const { outbound } = await turn('servico_inventado', [service]);
  assert.notEqual(outbound.handoff, true);
  assert.equal(outbound.raw_payload.human_service, undefined);
});

test('tenant sem human_services: o campo do modelo é ignorado', async () => {
  const { outbound } = await turn('servico_documental', undefined);
  assert.notEqual(outbound.handoff, true);
  assert.equal(outbound.raw_payload.human_service, undefined);
});

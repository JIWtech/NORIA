// Falhas transitórias antes do envio voltam para a fila (retry com o backoff do tenant) em vez de virar review:
// - resposta manual do atendente com origem ainda não atestada (TURN_CONTROL_ORIGIN_REQUIRED, HTTP 400 da RPC);
// - pressão do provedor Gemini (429) na geração.
// Funções REAIS do CORE gerado, executadas pelo executor de homologação.
// Rodar: node --test scripts/test_turn_transient_failures.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ex = require('./homolog/genesis_executor.cjs');

const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, 'homolog/fixtures/genesis_scenarios.json'), 'utf8'));
const raised = message => { const error = new Error('Request failed with status code 400'); error.response = { data: { message } }; return error; };
const reply = { reply: 'Temos sim, qual modelo você procura?', response_contract: { handoff_announced: false }, semantic_intent: { primary_intent: 'inventory_search', topics: ['catalog'] } };

async function run({ rpcOverrides = null, geminiOverride = null } = {}) {
  const scenario = { name: 'transient', turns: [{ text: 'Vocês têm carro automático?', gemini: reply }], auditor_responses: [] };
  const result = await ex.runScenario(scenario, { mode: 'fixtures', geminiKey: null, settings: ex.loadSettings(), inventory: fixtures.inventory,
    seed: w => { if (rpcOverrides) w.rpcOverrides = { ...(w.rpcOverrides || {}), ...rpcOverrides }; }, geminiOverride });
  return result.world;
}

test('origem da resposta manual ainda não atestada: o turno espera (retry), sem envio e com o código do banco', async () => {
  const world = await run({ rpcOverrides: { magia_turn_suppression_status: () => { throw raised('TURN_CONTROL_ORIGIN_REQUIRED'); } } });
  assert.deepEqual(world.log.failures.map(f => [f.error, f.retryable]), [['TURN_CONTROL_ORIGIN_REQUIRED', true]]);
  assert.equal(world.log.simulated_sends.length, 0);
});

test('outro erro levantado pelo banco continua permanente, mas registrado pelo token e não pela mensagem HTTP', async () => {
  const world = await run({ rpcOverrides: { magia_turn_suppression_status: () => { throw raised('SOME_CONTRACT_BROKEN'); } } });
  assert.deepEqual(world.log.failures.map(f => [f.error, f.retryable]), [['SUPABASE_RAISED:SOME_CONTRACT_BROKEN', false]]);
});

test('PostgREST em body/error serializado mantém o token e aguarda a origem antes do envio', async () => {
  for (const shape of [
    { response: { body: JSON.stringify({ message: 'TURN_CONTROL_ORIGIN_REQUIRED' }) } },
    { error: JSON.stringify({ message: 'TURN_CONTROL_ORIGIN_REQUIRED' }) },
    { cause: { response: { data: JSON.stringify({ message: 'TURN_CONTROL_ORIGIN_REQUIRED' }) } } },
  ]) {
    const world = await run({ rpcOverrides: { magia_turn_suppression_status: () => {
      throw Object.assign(new Error('Request failed with status code 400'), shape);
    } } });
    assert.deepEqual(world.log.failures.map(f => [f.error, f.retryable]), [['TURN_CONTROL_ORIGIN_REQUIRED', true]]);
    assert.equal(world.log.simulated_sends.length, 0);
  }
});

test('corpo arbitrário do provedor não é convertido em token de autorização', async () => {
  const world = await run({ rpcOverrides: { magia_turn_suppression_status: () => {
    throw Object.assign(new Error('Request failed with status code 400'), { response: { body: '{"message":"conteúdo privado do cliente"}' } });
  } } });
  assert.equal(world.log.simulated_sends.length, 0);
  assert.equal(world.log.failures[0].retryable, false);
  assert.doesNotMatch(world.log.failures[0].error, /privado|cliente/);
});

test('Gemini 429 na geração: retry pela fila, nenhuma mensagem pronta enviada ao cliente', async () => {
  const geminiOverride = (body, schema) => {
    if (!schema.properties?.semantic_intent) return undefined;
    const error = new Error('Request failed with status code 429'); error.statusCode = 429; error.response = { status: 429, headers: { 'retry-after': '120' } };
    throw error;
  };
  const world = await run({ geminiOverride });
  assert.equal(world.log.failures.length, 1, JSON.stringify(world.log.failures));
  assert.equal(world.log.failures[0].retryable, true, JSON.stringify(world.log.failures));
  assert.match(world.log.failures[0].error, /^GEMINI_/);
  assert.equal(world.log.simulated_sends.length, 0);
});

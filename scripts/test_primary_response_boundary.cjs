const test = require('node:test');
const assert = require('node:assert/strict');
const ex = require('./homolog/genesis_executor.cjs');
const fs = require('node:fs');
const path = require('node:path');
const inventory = JSON.parse(fs.readFileSync(path.join(__dirname, 'homolog/fixtures/genesis_scenarios.json'), 'utf8')).inventory;
async function run(alwaysInvalid = false, empty = false) {
  let calls = 0;
  const result = await ex.runScenario({ name: 'invalid_primary', turns: [{ text: 'Olá', gemini: {} }] }, {
    mode: 'fixtures', geminiKey: null, settings: ex.loadSettings(), inventory,
    geminiOverride: (_body, schema) => {
      if (!schema.properties?.semantic_intent) return undefined;
      calls++;
      if (empty && (alwaysInvalid || calls === 1)) return ex.cannedPrimaryBody({ reply: '',
        state: { deposit_cents: 99999999 }, dialogue_plan: { requests: [{ id: 'request_1', topic: 'other' }] },
        semantic_intent: { primary_intent: 'other', topics: ['greeting'] } });
      if (alwaysInvalid || calls === 1) return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"reply":"conteúdo sem contrato","state":{"deposit_cents":99999999}}' }] } }] };
      return ex.cannedPrimaryBody({ reply: 'Olá! Como posso ajudar?', semantic_intent: { primary_intent: 'other', topics: ['greeting'] } });
    },
  });
  return { calls, world: result.world };
}
test('resposta sem contrato pode ser regenerada uma vez antes de qualquer efeito comercial', async () => {
  const r = await run();
  assert.equal(r.calls, 2);
  assert.equal(r.world.log.simulated_sends.length, 1);
  assert.notEqual(r.world.tables.sales_leads[0]?.deposit_cents, 99999999);
});
test('segunda resposta inválida não cria loop nem envia texto sem contrato', async () => {
  const r = await run(true);
  assert.equal(r.calls, 2);
  assert.equal(r.world.log.simulated_sends.length, 0);
});

test('resposta vazia a um pedido textual é regenerada antes de aplicar estado', async () => {
  const r = await run(false, true);
  assert.equal(r.calls, 2);
  assert.equal(r.world.log.simulated_sends.length, 1);
  assert.notEqual(r.world.tables.sales_leads[0]?.deposit_cents, 99999999);
});

test('duas respostas vazias não são publicadas nem geram regeneração ilimitada', async () => {
  const r = await run(true, true);
  assert.equal(r.calls, 2);
  assert.equal(r.world.log.simulated_sends.length, 0);
});

test('duas respostas malformadas deixam diagnóstico de ambas sem guardar seu conteúdo', async () => {
  const r = await run(true);
  const event = r.world.tables.channel_events.find(e => e.raw_payload?.model_output_diagnostics?.length === 2);
  assert.ok(event, 'diagnóstico precisa chegar ao evento persistido');
  const diagnostics = event.raw_payload.model_output_diagnostics;
  assert.deepEqual(diagnostics.map(d => d.attempt), [1, 2]);
  assert.ok(diagnostics.every(d => d.finish_reason === 'STOP' && d.output_chars > 0 && d.validation_reason === 'invalid_structure'));
  assert.ok(!JSON.stringify(diagnostics).includes('conteúdo sem contrato'));
});

test('regeneração bem-sucedida preserva diagnóstico da candidata rejeitada', async () => {
  const r = await run();
  const event = r.world.tables.channel_events.find(e => e.direction === 'outbound' && e.delivery_status === 'sent');
  assert.equal(event.raw_payload.model_output_diagnostics.length, 1);
  assert.equal(event.raw_payload.model_output_diagnostics[0].attempt, 1);
});

test('JSON inválido duas vezes é distinguido de contrato incompleto', async () => {
  const result = await ex.runScenario({ name: 'malformed_json', turns: [{ text: 'Olá', gemini: {} }] }, {
    mode: 'fixtures', geminiKey: null, settings: ex.loadSettings(), inventory,
    geminiOverride: (_body, schema) => schema.properties?.semantic_intent
      ? { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"reply":' }] } }] } : undefined,
  });
  const diagnostics = result.world.tables.channel_events.find(e => e.raw_payload?.model_output_diagnostics)?.raw_payload.model_output_diagnostics;
  assert.equal(diagnostics.length, 2);
  assert.ok(diagnostics.every(d => d.validation_reason === 'invalid_json'));
  assert.equal(result.world.log.simulated_sends.length, 0);
});

test('MAX_TOKENS é registrado sem aumentar limite nem criar nova tentativa', async () => {
  let calls = 0;
  const result = await ex.runScenario({ name: 'truncated_json', turns: [{ text: 'Olá', gemini: {} }] }, {
    mode: 'fixtures', geminiKey: null, settings: ex.loadSettings(), inventory,
    geminiOverride: (_body, schema) => {
      if (!schema.properties?.semantic_intent) return undefined;
      calls++; return { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"reply":' }] } }] };
    },
  });
  const diagnostics = result.world.tables.channel_events.find(e => e.raw_payload?.model_output_diagnostics)?.raw_payload.model_output_diagnostics;
  assert.equal(calls, 1); assert.equal(diagnostics[0].finish_reason, 'MAX_TOKENS');
  assert.equal(diagnostics[0].validation_reason, 'incomplete');
});

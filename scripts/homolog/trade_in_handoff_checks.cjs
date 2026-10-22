// Troca concreta e encaminhamento para avaliação, pela EXT e pelo CORE reais com respostas do modelo enlatadas.
// Caso de 21/10 21h57-21h59 (+55 21 98519-8468): "aceitam meu veículo como entrada…?" → "Qual é o modelo, ano e
// estado?" → "Tá com manutenção em dia, é um Camaro 2007" → a IA disse "Vamos encaminhar a sua proposta… para a
// nossa equipe", mas nada foi encaminhado e o lead ficou em qualificação no kanban.
//
//   node scripts/homolog/trade_in_handoff_checks.cjs

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const exec = require('./genesis_executor.cjs');

const dir = process.env.HOMOLOG_SNAPSHOT_DIR || path.join(process.env.USERPROFILE || process.env.HOME || '', '.noria-homolog');
const load = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const MERCEDES = 'mercedes|c180|2015|';

const auditor = body => {
  const input = JSON.parse(body.contents[0].parts[0].text);
  return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ scope_key: input.scope_key, complete: true, segments: [{ text: input.reply, kind: 'non_factual', evidence: [] }] }) }] } }] };
};
const repair = text => () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ reply: text,
  response_contract: { answers: [{ request_id: 'request_1', excerpt: text.split('.')[0] + '.' }], requested_fields: [], facts: [], fact_evidence_mode: 'standard', availability_asserted: false, assignment_confirmed: false, photo_sent: false, handoff_announced: false } }) }] } }] });

const memory = { trade_in_status: 'policy_discussed', evidence_ids: ['in-1'], customer_vehicle_purpose: 'entry_inquiry', customer_vehicle_purpose_evidence_ids: ['in-1'] };
const inquiry = {
  reply: 'Sim, aceitamos seu veículo como entrada, sujeito à avaliação. Qual é o modelo, ano e estado do seu veículo?',
  semantic_intent: { primary_intent: 'trade_in', topics: ['trade_in'], customer_vehicle: { purpose: 'entry_inquiry', evidence_ids: ['in-1'] },
    references: { mentioned_product_ids: [MERCEDES], evidence_ids: ['in-1'], product_role: 'interest', product_references: [{ product_id: MERCEDES, role: 'interest', evidence_ids: ['in-1'] }] } },
  dialogue_plan: { requests: [{ id: 'r1', topic: 'trade_in', subject: 'specific_product' }], memory },
  state: { intent: 'buy', transaction_mode: 'buy_and_sell', product_id: MERCEDES, product_evidence: 'in-1' },
  response_contract: { answers: [{ request_id: 'request_1', excerpt: 'Sim, aceitamos seu veículo como entrada, sujeito à avaliação.' }] },
};
// O modelo não marca a oferta (purpose none), mas extrai o veículo, como em produção.
const answer = reply => ({
  reply,
  semantic_intent: { primary_intent: 'trade_in', topics: ['trade_in'], customer_vehicle: { purpose: 'none', evidence_ids: [] } },
  dialogue_plan: { requests: [{ id: 'r1', topic: 'trade_in', subject: 'specific_product' }], memory },
  state: { intent: 'buy', transaction_mode: 'buy_and_sell', product_id: MERCEDES, product_evidence: 'in-1',
    sell_vehicle: { category: 'car', brand: '', model: 'Camaro', year: 2007, raw_mention: 'Camaro 2007', evidence_ids: ['in-2'],
      condition_reported: true, maintenance_reported: true, auction_history: 'unknown', sinister_history: 'unknown' } },
  response_contract: { answers: [{ request_id: 'request_1', excerpt: reply.split('.')[0] + '.' }] },
});

async function main() {
  let settings, inventory, images;
  try { settings = load('genesis_settings_snapshot.json'); inventory = load('genesis_inventory_snapshot.json'); images = load('genesis_images_snapshot.json'); } catch (error) {
    console.log('FAIL snapshots unavailable in ' + dir + ': ' + String(error.message).slice(0, 120));
    process.exitCode = 1; return;
  }
  const rows = [];
  const check = (name, ok, detail) => rows.push({ name, ok: Boolean(ok), detail });

  let handoff = null;
  const r = await exec.runScenario({ name: 'trade-in-handoff', turns: [
    { text: 'Show, aceitam meu veículo como entrada mais 30 mil a vista e o resto parcelado ?', gemini: inquiry },
    { text: 'Tá com manutenção em dia, é um Camaro 2007', gemini: answer('Legal! Anotei que é um Camaro 2007 com a manutenção em dia.') },
  ], auditor_responses: Array(8).fill(auditor) }, { mode: 'fixtures', geminiKey: null, settings, inventory, images,
    turnOptions: { tamperDecision: decided => { handoff = (decided?.commercial_decision?.data || decided?.commercial_decision)?.handoff || handoff; return decided; } } });
  const lead = r.world.tables.sales_leads.at(-1);
  check('1 veículo informado depois da conversa de troca abre a avaliação (handoff appraisal_review)',
    handoff?.required === true && handoff?.reason === 'appraisal_review', { handoff, steps: r.steps.map(s => s.final?.error_code || s.stopped || null) });
  check('2 o lead sai da qualificação no kanban', lead && lead.stage_key !== 'sales_qualifying', { stage: lead?.stage_key });

  // O anúncio de encaminhamento sem encaminhamento executado nunca chega ao cliente: a reescrita retira a promessa.
  const promised = await exec.runScenario({ name: 'unexecuted-announcement', turns: [
    { text: 'Quais as opções de pagamento?', gemini: { reply: 'Trabalhamos com à vista e financiamento. Vou passar seu atendimento para a nossa equipe.',
      semantic_intent: { primary_intent: 'financing', topics: ['payment'] }, dialogue_plan: { requests: [{ id: 'r1', topic: 'financing', subject: 'unspecified' }] },
      response_contract: { answers: [{ request_id: 'request_1', excerpt: 'Trabalhamos com à vista e financiamento.' }] } } },
  ], auditor_responses: [repair('Trabalhamos com à vista e financiamento. Quer fazer uma simulação?'), auditor, auditor] },
  { mode: 'fixtures', geminiKey: null, settings, inventory, images });
  const texts = promised.world.log.simulated_sends.map(item => String(item.text || ''));
  check('3 "vou passar para a equipe" sem encaminhamento executado não é enviado', texts.length > 0 && !texts.some(t => /passar seu atendimento|nossa equipe/i.test(t)), { texts, final: promised.steps[0]?.final, events: promised.world.tables.channel_events.filter(e => e.direction === "outbound").map(e => [e.service, e.ai_error, JSON.stringify(e.raw_payload?.dialogue_repair || null)]) });

  for (const row of rows) console.log((row.ok ? 'PASS ' : 'FAIL ') + row.name + (row.ok ? '' : ' ' + JSON.stringify(row.detail)));
  console.log(`${rows.filter(r => r.ok).length}/${rows.length} trade-in handoff checks pass.`);
  if (rows.some(r => !r.ok)) process.exitCode = 1;
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 2; });

// Política de compra do veículo do cliente (sdr_rules.rejected_purchase_brands), pela EXT real.
// Caso de 21/10 21h35 (+55 21 98362-2313): "vocês compram carro também?" → "peugeout". A loja não compra
// Peugeot diretamente (só aceita como entrada numa compra), mas a IA respondeu "Sim, compramos! A gente
// avalia Peugeot". O estado guardou só a menção ("peugeout", com erro de digitação) e a marca vazia.
//
//   node scripts/homolog/purchase_policy_checks.cjs

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const exec = require('./genesis_executor.cjs');

const dir = process.env.HOMOLOG_SNAPSHOT_DIR || path.join(process.env.USERPROFILE || process.env.HOME || '', '.noria-homolog');
const load = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));

function findKey(value, key, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return undefined;
  seen.add(value);
  if (Object.prototype.hasOwnProperty.call(value, key)) return value[key];
  for (const child of Object.values(value)) { const found = findKey(child, key, seen); if (found !== undefined) return found; }
  return undefined;
}

function vehicleTurn(purpose, vehicle, extraState = {}) {
  return {
    reply: 'Certo.',
    semantic_intent: { primary_intent: purpose === 'independent_sale' ? 'sale' : 'trade_in', topics: ['sale'],
      customer_vehicle: { purpose, evidence_ids: ['in-1'] } },
    dialogue_plan: { requests: [{ id: 'r1', topic: purpose === 'independent_sale' ? 'sale' : 'trade_in', subject: 'unspecified' }] },
    state: { intent: purpose === 'independent_sale' ? 'sell' : 'buy', transaction_mode: purpose === 'independent_sale' ? 'sell' : 'buy_and_sell',
      sell_vehicle: { category: 'car', year: null, auction_history: 'unknown', sinister_history: 'unknown', evidence_ids: ['in-1'], ...vehicle }, ...extraState },
    response_contract: { answers: [] },
  };
}

async function main() {
  let settings, inventory, images;
  try { settings = load('genesis_settings_snapshot.json'); inventory = load('genesis_inventory_snapshot.json'); images = load('genesis_images_snapshot.json'); } catch (error) {
    console.log('FAIL snapshots unavailable in ' + dir + ': ' + String(error.message).slice(0, 120));
    process.exitCode = 1; return;
  }
  const rows = [];
  const check = (name, ok, detail) => rows.push({ name, ok: Boolean(ok), detail });
  const policyFor = async (text, gemini) => {
    let decision = null;
    await exec.runScenario({ name: 'purchase-policy', turns: [{ text, gemini }], auditor_responses: Array(4).fill(null).map(() => body => {
      const input = JSON.parse(body.contents[0].parts[0].text);
      return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ scope_key: input.scope_key, complete: true, segments: [{ text: input.reply, kind: 'non_factual', evidence: [] }] }) }] } }] };
    }) }, { mode: "fixtures", geminiKey: null, settings, inventory, images, turnOptions: { tamperDecision: decided => { decision = decided; return decided; } } });
    return findKey(decision, 'purchase_policy') || null;
  };

  const typo = await policyFor('peugeout', vehicleTurn('independent_sale', { brand: '', model: '', raw_mention: 'peugeout' }));
  check('1 venda direta de "peugeout" (marca só na menção, com erro) é recusada pela política', typo?.reason === 'rejected_brand', typo);

  const modeOnly = await policyFor('quero vender meu Citroen C3', vehicleTurn('independent_sale', { brand: 'Citroen', model: 'C3', raw_mention: 'Citroen C3' }));
  check('2 Citroën em venda direta é recusado', modeOnly?.reason === 'rejected_brand', modeOnly);

  const entry = await policyFor('quero dar meu Peugeot 208 de entrada na Montana', vehicleTurn('entry', { brand: 'Peugeot', model: '208', raw_mention: 'Peugeot 208' },
    { product_id: 'chevrolet|montana|2013|branca', product_evidence: 'in-1' }));
  check('3 Peugeot como entrada numa compra não é recusado (política de troca)', !entry || entry.reason !== 'rejected_brand', entry);

  const allowed = await policyFor('quero vender meu Onix 2019', vehicleTurn('independent_sale', { brand: 'Chevrolet', model: 'Onix', year: 2019, raw_mention: 'Onix 2019' }));
  check('4 marca permitida em venda direta não é recusada', allowed && allowed.reason === null, allowed);

  // Ponta a ponta: o modelo escreveu "Sim, compramos!" antes da decisão; o cliente recebe a política da EXT.
  const reply = 'Sim, compramos! Me conta o ano dele e manda uma foto.';
  const said = { ...vehicleTurn('independent_sale', { brand: '', model: '', raw_mention: 'peugeout' },
    { product_id: 'chevrolet|montana|2013|branca', product_evidence: 'in-1' }), reply, response_contract: { answers: [{ request_id: 'request_1', excerpt: 'Sim, compramos!' }] } };
  const auditor = body => {
    const input = JSON.parse(body.contents[0].parts[0].text);
    return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ scope_key: input.scope_key, complete: true, segments: [{ text: input.reply, kind: 'non_factual', evidence: [] }] }) }] } }] };
  };
  const run = await exec.runScenario({ name: 'purchase-policy-reply', turns: [{ text: 'peugeout', gemini: said }], auditor_responses: [auditor, auditor, auditor] },
    { mode: 'fixtures', geminiKey: null, settings, inventory, images });
  const texts = run.world.log.simulated_sends.map(item => String(item.text || ''));
  const lead = run.world.tables.sales_leads.at(-1);
  check('5 o cliente recebe a política (não compra Peugeot; aceita como entrada), nunca "compramos"',
    texts.length === 1 && /não compra Peugeot/.test(texts[0]) && /parte do pagamento/.test(texts[0]) && !/compramos/i.test(texts[0]),
    { texts });
  check('6 sem encaminhamento para avaliação e sem pedir ano/foto do veículo recusado',
    lead?.stage_key !== 'sales_appraisal' && !['sell_model', 'sell_year', 'vehicle_photo', 'vehicle_description'].includes(lead?.state?.dialogue_context?.pending_requirement || ''),
    { stage: lead?.stage_key, pending: lead?.state?.dialogue_context?.pending_requirement });

  // Ano obrigatório na venda direta (a loja não compra antes do ano mínimo configurado). Se o cliente não
  // souber o ano, a conversa vai para o atendente com o lead marcado como frio.
  const decisions = [];
  const sale = (reply, vehicle, extraState = {}) => ({ ...vehicleTurn('independent_sale', vehicle, extraState), reply, response_contract: { answers: [{ request_id: 'request_1', excerpt: reply.split(/[.?!]/)[0] }] } });
  const yearFlow = await exec.runScenario({ name: 'sale-year', turns: [
    { text: 'quero vender meu Onix', gemini: sale('Legal! Qual é o ano do seu Onix?', { brand: 'Chevrolet', model: 'Onix', raw_mention: 'Onix' }) },
    { text: 'não sei o ano', gemini: sale('Sem problema.', { brand: 'Chevrolet', model: 'Onix', raw_mention: 'Onix' }) },
  ], auditor_responses: Array(8).fill(auditor) }, { mode: 'fixtures', geminiKey: null, settings, inventory, images,
    turnOptions: { tamperDecision: decided => { decisions.push(decided?.commercial_decision?.data || decided?.commercial_decision || null); return decided; } } });
  check('7 venda direta sem ano: o próximo pedido ao cliente é o ano', decisions[0]?.commercial_state?.pending_requirement === 'sell_year',
    { pending: decisions[0]?.commercial_state?.pending_requirement, appraisal: findKey(decisions[0], 'independent_sale_appraisal') });
  const yearLead = yearFlow.world.tables.sales_leads.at(-1);
  check('8 "não sei o ano": vai para o atendente como lead frio', decisions[1]?.handoff?.required === true
    && decisions[1]?.lead_classification?.temperature === 'cold' && yearLead?.stage_key === 'sales_appraisal',
    { handoff: decisions[1]?.handoff, temperature: decisions[1]?.lead_classification?.temperature, stage: yearLead?.stage_key });
  const yearTexts = yearFlow.world.log.simulated_sends.map(item => String(item.text || ''));
  check('9 o cliente recebe resposta nos dois turnos', yearTexts.length === 2 && yearTexts.every(Boolean), { texts: yearTexts });
  if (process.env.HOMOLOG_DEBUG) console.log('textos:', JSON.stringify(yearTexts));

  for (const row of rows) console.log((row.ok ? 'PASS ' : 'FAIL ') + row.name + (row.ok ? '' : ' ' + JSON.stringify(row.detail)));
  console.log(`${rows.filter(r => r.ok).length}/${rows.length} purchase policy checks pass.`);
  if (rows.some(r => !r.ok)) process.exitCode = 1;
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 2; });

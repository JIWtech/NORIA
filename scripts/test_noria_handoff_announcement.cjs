'use strict';

// 21/10 21h58: "Vamos encaminhar a sua proposta… para a nossa equipe avaliar" sem nenhum encaminhamento
// executado. O modelo declarou handoff_announced=false; o texto anunciava mesmo assim.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readSource, loadFunctions, loadCoreEngine } = require('./lib/core_test_harness.cjs');
const ctx = loadFunctions(readSource(), ['salesAnnouncesHandoff'], { normalizeText: s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() });

test('anúncio de encaminhamento é detectado', () => {
  for (const reply of [
    'Legal! Anotei que é um Camaro 2007. Vamos encaminhar a sua proposta para a nossa equipe avaliar os detalhes com você.',
    'Vou passar seu atendimento para a nossa equipe.',
    'Já encaminhei para um atendente.',
    'Um atendente vai entrar em contato com você.',
    'Nossa equipe vai continuar o atendimento por aqui.',
    'Vou te transferir para um consultor.',
  ]) assert.equal(ctx.salesAnnouncesHandoff(reply), true, reply);
});

test('oferta, pergunta e outros "passar" não são anúncio', () => {
  for (const reply of [
    'Quer que eu te passe para um atendente?',
    'Se preferir, posso encaminhar para a equipe.',
    'Vou passar o valor da Mercedes: R$ 94.980,00.',
    'A equipe avalia o seu veículo na loja.',
    'Trabalhamos com à vista, financiamento e cartão.',
  ]) assert.equal(ctx.salesAnnouncesHandoff(reply), false, reply);
});

test('o validador trata o anúncio no texto como anúncio não executado', async () => {
  const { salesValidatePrimaryDialogue } = await loadCoreEngine(['salesValidatePrimaryDialogue']);
  const generated = { primary_reply: 'Vou passar seu atendimento para a nossa equipe.', state: {}, response_contract: { fact_evidence_mode: 'standard', answers: [], requested_fields: [], facts: [], handoff_announced: false } };
  const plan = { requests: [], next_requirement: 'none' };
  assert.ok(salesValidatePrimaryDialogue(generated, plan, {}, {}).issues.includes('UNEXECUTED_HANDOFF_ANNOUNCEMENT'));
  assert.ok(!salesValidatePrimaryDialogue(generated, plan, {}, { handoff_dispatched: true }).issues.includes('UNEXECUTED_HANDOFF_ANNOUNCEMENT'));
});

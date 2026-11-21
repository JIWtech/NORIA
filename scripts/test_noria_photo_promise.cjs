'use strict';

// 21/10 19h28: "Essa Honda aí, tem foto" → a IA respondeu "Vou te enviar a foto da
// Honda Tornado" sem pedido de foto registrado nem foto autorizada; nada foi enviado.
// Prometer ou anunciar foto só é válido quando há foto autorizada neste turno.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readSource, loadFunctions, loadCoreEngine } = require('./lib/core_test_harness.cjs');
const ctx = loadFunctions(readSource(), ['salesPromisesPhoto', 'salesDeniesPhoto'], { normalizeText: s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() });

test('promessa ou anúncio de foto é detectado', () => {
  for (const reply of [
    'Tem sim! Vou te enviar a foto da Honda Tornado 2025 para você dar uma olhada.',
    'Segue a foto da Honda Tornado 2025 para você dar uma olhada.',
    'Mandei a foto da Mercedes C180 para você dar uma olhada',
    'Pode deixar, vou mandar as fotos da Montana por aqui.',
    'Estou te enviando as fotos agora.',
    'Aqui estão as fotos dela.',
  ]) assert.equal(ctx.salesPromisesPhoto(reply), true, reply);
});

test('oferta, pergunta e pedido de foto ao cliente não são promessa', () => {
  for (const reply of [
    'Quer que eu te mande as fotos da Tornado?',
    'Se quiser, posso te enviar a foto dela.',
    'Qual das Hondas você quer ver: Tornado, PCX ou CB 600RR?',
    'Pode me mandar uma foto do seu carro?',
    'A Tornado 2025 está anunciada por R$ 28.980,00.',
  ]) assert.equal(ctx.salesPromisesPhoto(reply), false, reply);
});

test('o validador barra promessa sem foto autorizada e permite recomposição', async () => {
  const { salesValidatePrimaryDialogue, salesIssuesRepairable } = await loadCoreEngine(['salesValidatePrimaryDialogue', 'salesIssuesRepairable']);
  const generated = { primary_reply: 'Vou te enviar a foto da Honda Tornado.', state: {}, response_contract: { fact_evidence_mode: 'standard', answers: [], requested_fields: [], facts: [] } };
  const issues = salesValidatePrimaryDialogue(generated, { requests: [], next_requirement: 'none' }, {}, {}).issues;
  assert.ok(issues.includes('UNAUTHORIZED_PHOTO_PROMISE'));
  assert.equal(salesIssuesRepairable(['UNAUTHORIZED_PHOTO_PROMISE']), true);
});

// 21/10 21h13: foto autorizada e enviada com o texto "as fotos desta Honda Tornado não estão disponíveis".
test('negação de foto é detectada; perguntas e outros assuntos não', () => {
  for (const reply of [
    'No momento, as fotos desta Honda Tornado 300L não estão disponíveis para envio.',
    'Não tenho fotos dela agora.',
    'A imagem está indisponível no momento.',
  ]) assert.equal(ctx.salesDeniesPhoto(reply), true, reply);
  for (const reply of [
    'Pode me mandar uma foto do seu carro?',
    'Quer ver as fotos da Tornado?',
    'A Tornado não está mais disponível.',
    'A Tornado 2025 tem 12 mil km.',
  ]) assert.equal(ctx.salesDeniesPhoto(reply), false, reply);
});

test('validador identifica negativa quando existe foto autorizada', async () => {
  const { salesValidatePrimaryDialogue, salesPhotoActionProofs } = await loadCoreEngine(['salesValidatePrimaryDialogue', 'salesPhotoActionProofs']);
  const attachment = { commercial_action: { tenant_id: 't', request_ids: [] } };
  salesPhotoActionProofs.set(attachment, { snapshot: JSON.stringify(attachment), attachment: { tenant_id: 't', session_id: 'b', turn_token: 'x', product: { id: 'p' } } });
  const generated = { primary_reply: 'Não tenho fotos dela agora.', state: {}, response_contract: { fact_evidence_mode: 'standard', answers: [], requested_fields: [], facts: [] } };
  const issues = salesValidatePrimaryDialogue(generated, { requests: [], next_requirement: 'none' }, {}, { photo_attachment: attachment, product: { id: 'p' } }).issues;
  assert.ok(issues.includes('PHOTO_AVAILABILITY_CONTRADICTION'));
});

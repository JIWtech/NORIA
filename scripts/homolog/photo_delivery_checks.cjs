'use strict';

const fs = require('node:fs');
const path = require('node:path');
const exec = require('./genesis_executor.cjs');
const dir = process.env.HOMOLOG_SNAPSHOT_DIR || path.join(process.env.USERPROFILE || process.env.HOME || '', '.noria-homolog');
const load = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const ID = 'honda|pcx|2023|branca';

const auditor = body => {
  const input = JSON.parse(body.contents[0].parts[0].text), attachment = (input.attachments || [])[0];
  const report = { scope_key: input.scope_key, complete: true, segments: [attachment
    ? { text: input.reply, kind: 'attachment_caption', attachment: { id: attachment.id, product_id: attachment.product?.id, mode: 'presentation' }, evidence: [] }
    : { text: input.reply, kind: 'non_factual', evidence: [] }] };
  return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(report) }] } }] };
};
const photo = (reply, fact = false) => ({
  reply, semantic_intent: { primary_intent: 'product_details', topics: ['photos'], confidence: 'high', references: {
    mentioned_product_ids: [ID], evidence_ids: ['in-1'], product_role: 'asked_info', product_references: [{ product_id: ID, role: 'asked_info', evidence_ids: ['in-1'] }] } },
  dialogue_plan: { requests: [{ id: 'r1', topic: 'photos', subject: 'specific_product' }] }, state: { product_id: ID, product_evidence: 'in-1' },
  response_contract: { answers: [{ request_id: 'request_1', excerpt: fact ? 'Segue a foto.' : reply }],
    ...(fact ? { facts: [{ fact_id: 'official.product.color', value: 'azul', excerpt: 'é azul', source_product_id: ID }] } : {}) },
});

async function main() {
  const settings = load('genesis_settings_snapshot.json'), inventory = load('genesis_inventory_snapshot.json');
  const images = load('genesis_images_snapshot.json');
  const scenario = (gemini, auditors = [auditor, auditor]) => ({ name: 'photo-delivery', turns: [{ text: 'Queria ver a foto da PCX branca', gemini }], auditor_responses: auditors });
  const run = (gemini, opts = {}) => exec.runScenario(scenario(gemini), { mode: 'fixtures', geminiKey: null, settings, inventory, images, ...opts });
  const rows = [];
  const check = (name, ok, evidence) => rows.push({ name, ok: Boolean(ok), evidence });
  const successfulReceipt = r => r.world.tables.channel_events.find(e => e.service === 'sales_product_photo_attempt')?.raw_payload;

  const valid = await run(photo('Segue a foto.'));
  const validAttempt = successfulReceipt(valid);
  const validQueue = valid.world.tables.conversation_turn_queue[0];
  check('1 foto autorizada enviada, recibida e confirmada antes de finalizar', valid.world.log.simulated_media.length === 1
    && validAttempt?.status === 'provider_accepted' && valid.world.tables.conversation_turn_delivery_attempts[0]?.status === 'confirmed'
    && valid.world.tables.channel_events.find(e => e.service === 'sales_product_photo')?.delivery_status === 'sent'
    && validQueue?.phase === 'ready' && valid.steps[0]?.final?.delivery_ok === true, { attempt: validAttempt?.status, queue: validQueue?.phase, final: valid.steps[0]?.final });

  const noImage = await run(photo('Vou verificar.'), { images: images.filter(i => i.vehicle_id !== ID) });
  check('2 sem imagem registrada, ação não autorizada e nenhuma mídia', noImage.world.log.simulated_media.length === 0
    && !noImage.world.tables.channel_events.some(e => e.service === 'sales_product_photo_attempt'), { media: noImage.world.log.simulated_media.length });

  const rejected = await run(photo('A PCX é azul. Segue a foto.', true));
  const rejectedEvent = rejected.world.tables.channel_events.find(e => e.service === 'sales_product_photo');
  check('3 fato textual rejeitado, texto não enviado e foto independente confirmada', rejected.world.log.simulated_sends.length === 0
    && rejected.world.log.simulated_media.length === 1 && rejected.world.log.simulated_media[0].media === valid.world.log.simulated_media[0]?.media
    && rejectedEvent?.raw_payload?.delivery_attempt_id && rejected.world.tables.conversation_turn_delivery_attempts[0]?.status === 'confirmed'
    && rejected.world.tables.conversation_turn_queue[0]?.phase === 'ready'
    && rejected.steps[0]?.final?.error_code?.includes('UNSUPPORTED_FACT:'), { text: rejected.world.log.simulated_sends.length, media: rejected.world.log.simulated_media.length, receipt: successfulReceipt(rejected)?.status, attempt: rejected.world.tables.conversation_turn_delivery_attempts[0]?.status, queue: rejected.world.tables.conversation_turn_queue[0]?.phase, final: rejected.steps[0]?.final });

  const sendFailure = await run(photo('A PCX é azul. Segue a foto.', true), {
    providerFaultFor: (method, url) => method === 'POST' && url.pathname.startsWith('/message/sendMedia/') ? new Error('SIMULATED_MEDIA_FAILURE') : null,
  });
  const confirmFailure = await run(photo('A PCX é azul. Segue a foto.', true), {
    rpcOverrides: { magia_confirm_turn_delivery: () => ({ confirmed: false, reason: 'simulated_uncertain' }) },
  });
  const confirmAttempt = successfulReceipt(confirmFailure);
  check('4 falha de envio e confirmação incerta ficam retidas, sem texto, reenvio ou falso done',
    sendFailure.world.log.simulated_media.length === 0 && sendFailure.world.tables.conversation_turn_queue[0]?.phase === 'uncertain'
    && confirmFailure.world.log.simulated_media.length === 1 && confirmFailure.world.tables.conversation_turn_queue[0]?.phase === 'uncertain'
    && confirmFailure.world.tables.conversation_turn_delivery_attempts[0]?.status !== 'confirmed'
    && sendFailure.world.tables.conversation_turn_queue[0]?.claimed?.length === 1
    && confirmFailure.world.tables.conversation_turn_queue[0]?.claimed?.length === 1
    && confirmAttempt?.status === 'provider_accepted_audit_incomplete' && confirmAttempt?.requires_reconciliation === true
    && confirmFailure.world.tables.channel_events.find(e => e.service === 'sales_product_photo')?.delivery_status === 'internal'
    && sendFailure.world.log.simulated_sends.length === 0 && confirmFailure.world.log.simulated_sends.length === 0,
    { send_queue: sendFailure.world.tables.conversation_turn_queue[0]?.phase, confirm_queue: confirmFailure.world.tables.conversation_turn_queue[0]?.phase, sends: confirmFailure.world.log.simulated_sends.length, media: confirmFailure.world.log.simulated_media.length, rejected: rejected.steps[0]?.final });

  // Casos reais de 21/10: o auditor barrou só o texto que acompanhava uma foto EXT autorizada.
  // O pedido era só de foto; a foto responde sozinha e o texto barrado não é enviado.
  const identity = reply => ({ ...photo(reply), response_contract: { answers: [{ request_id: 'request_1', excerpt: reply }],
    facts: [{ fact_id: 'official.product.model', value: 'PCX', excerpt: 'PCX', source_product_id: ID }] } });
  const kindAuditor = kind => body => {
    const input = JSON.parse(body.contents[0].parts[0].text), attachment = (input.attachments || [])[0];
    const segment = kind === 'attachment_caption' && attachment
      ? { text: input.reply, kind, attachment: { id: attachment.id, product_id: attachment.product?.id, mode: 'presentation' }, evidence: [] }
      : { text: input.reply, kind, evidence: [] };
    return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ scope_key: input.scope_key, complete: true, segments: [segment] }) }] } }] };
  };
  const textOnly = [
    ['5 legenda que cita o veículo declarado', 'Segue a foto da PCX para você conferir.', 'attachment_caption', /INVALID_ATTACHMENT_CAPTION_EVIDENCE/],
    ['6 fala classificada como não factual com fato declarado', 'Pode deixar, vou te enviar as fotos da PCX.', 'non_factual', /FACT_CLASSIFIED_AS_NON_FACTUAL/],
    ['7 entrega afirmada antes de acontecer', 'Mandei a foto da PCX para você dar uma olhada.', 'unsupported', /SEMANTIC_FACT_UNSUPPORTED/],
  ];
  for (const [name, reply, kind, expected] of textOnly) {
    const auditorFor = kindAuditor(kind);
    const r = await exec.runScenario({ name: 'photo-text-only', turns: [{ text: 'Queria ver a foto da PCX branca', gemini: identity(reply) }], auditor_responses: [auditorFor, auditorFor, auditorFor] },
      { mode: 'fixtures', geminiKey: null, settings, inventory, images });
    const queue = r.world.tables.conversation_turn_queue[0];
    check(name + ': foto enviada, texto barrado não enviado, sem revisão', r.world.log.simulated_media.length === 1
      && r.world.log.simulated_sends.length === 0 && queue?.phase === 'ready'
      && expected.test(r.steps[0]?.final?.error_code || ''), { media: r.world.log.simulated_media.length, sends: r.world.log.simulated_sends.length, queue: queue?.phase, final: r.steps[0]?.final });
  }

  // Caso real de 21/10 19h28: "Essa Honda aí, tem foto" com três Hondas na lista. O modelo não
  // registrou o pedido de foto e prometeu "Vou te enviar a foto"; nenhuma foto foi autorizada.
  // A promessa não pode chegar ao cliente: a reescrita pergunta qual veículo.
  const promise = { reply: 'Tem sim! Vou te enviar a foto da Honda para você dar uma olhada.',
    semantic_intent: { primary_intent: 'product_details', topics: ['details'], confidence: 'high', references: { mentioned_product_ids: [], evidence_ids: ['in-1'], product_role: 'none', product_references: [] } },
    response_contract: { answers: [] } };
  const repair = () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ reply: 'Qual das Hondas você quer ver?',
    response_contract: { answers: [], requested_fields: [], facts: [], fact_evidence_mode: 'standard', availability_asserted: false, assignment_confirmed: false, photo_sent: false, handoff_announced: false } }) }] } }] });
  const promised = await exec.runScenario({ name: 'photo-promise', turns: [{ text: 'Essa Honda aí, tem foto', gemini: promise }], auditor_responses: [repair, auditor, auditor] },
    { mode: 'fixtures', geminiKey: null, settings, inventory, images });
  const sentTexts = promised.world.log.simulated_sends.map(item => JSON.stringify(item));
  check('8 promessa de foto sem foto autorizada é reescrita e nunca enviada', promised.world.log.simulated_media.length === 0
    && !sentTexts.some(text => /enviar a foto/i.test(text)) && sentTexts.some(text => /Qual das Hondas/.test(text)),
    { sends: sentTexts, media: promised.world.log.simulated_media.length, final: promised.steps[0]?.final });

  // Casos reais de 21/10 20h32/20h34 ("Foto do 4", "Tem foto do 1?"): a interpretação do modelo foi rejeitada
  // pela validação e a resposta veio vazia. O CORE tinha uma pergunta de esclarecimento pronta, mas a auditoria
  // reprovou a resposta vazia e o cliente ficou sem nada, com a conversa em revisão.
  // Bem formada, mas reprovada numa regra (categoria de catálogo sem evidência), como em produção.
  const invalidSemantic = { reply: '', semantic_intent: { primary_intent: 'product_details', topics: ['photos'], catalog: { category: 'cars', evidence_ids: [] } },
    dialogue_plan: { requests: [{ id: 'r1', topic: 'photos', subject: 'specific_product' }] }, response_contract: { answers: [] } };
  // Sem resposta para a reescrita: em produção ela também foi reprovada.
  const unclear = await exec.runScenario({ name: 'semantic-invalid', turns: [{ text: 'Foto do 4', gemini: invalidSemantic }], auditor_responses: [] },
    { mode: 'fixtures', geminiKey: null, settings, inventory, images });
  const unclearTexts = unclear.world.log.simulated_sends.map(item => String(item.text || ''));
  const unclearEvent = unclear.world.tables.channel_events.find(e => e.raw_payload?.intent_clarification === 'semantic_unavailable');
  check('9 interpretação inválida com resposta reprovada: cliente recebe o esclarecimento, sem revisão',
    unclearTexts.length === 1 && unclearTexts[0].length > 0 && unclear.world.tables.conversation_turn_queue[0]?.phase === 'ready'
    && Array.isArray(unclearEvent?.raw_payload?.semantic_validation_errors) && unclearEvent.raw_payload.semantic_validation_errors.length > 0,
    { texts: unclearTexts, queue: unclear.world.tables.conversation_turn_queue[0]?.phase, errors: unclearEvent?.raw_payload?.semantic_validation_errors, final: unclear.steps[0]?.final });

  for (const row of rows) console.log((row.ok ? 'PASS ' : 'FAIL ') + row.name + (row.ok ? '' : ' ' + JSON.stringify(row.evidence)));
  console.log(`${rows.filter(r => r.ok).length}/${rows.length} cenários de entrega de foto passaram.`);
  if (rows.some(r => !r.ok)) process.exitCode = 1;
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 2; });

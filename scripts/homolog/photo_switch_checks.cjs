// Photo of a SECOND vehicle in the same session, through the real EXT and CORE with canned model output.
// Reproduces the 2026-10-21 incident: after a Montana photo, "Tá e essa 4? Manda foto" asked for another
// vehicle, the EXT kept the old focus, the audit rejected the turn and the customer got a technical text.
//
//   node scripts/homolog/photo_switch_checks.cjs
//
// Snapshots: see README_HOMOLOGACAO.md. Nothing leaves the process.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const exec = require('./genesis_executor.cjs');

const dir = process.env.HOMOLOG_SNAPSHOT_DIR || path.join(process.env.USERPROFILE || process.env.HOME || '', '.noria-homolog');
const load = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const ID = { montana: 'chevrolet|montana|2013|branca', pcx2023: 'honda|pcx|2023|branca' };

const auditor = body => {
  const input = JSON.parse(body.contents[0].parts[0].text);
  const attachment = (input.attachments || [])[0];
  const segment = attachment
    ? { text: input.reply, kind: 'attachment_caption', attachment: { id: attachment.id, product_id: attachment.product?.id, mode: 'presentation' }, evidence: [] }
    : { text: input.reply, kind: 'non_factual', evidence: [] };
  return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ scope_key: input.scope_key, complete: true, segments: [segment] }) }] } }] };
};

function photoRequest(reply, productId, continuesPrevious, evidenceId) {
  return {
    reply,
    semantic_intent: { primary_intent: 'product_details', topics: ['photos'], confidence: 'high',
      conversation: { continues_previous_topic: continuesPrevious, changes_preference: !continuesPrevious, requires_clarification: false },
      references: { mentioned_product_ids: [productId], evidence_ids: [evidenceId], product_role: 'asked_info',
        product_references: [{ product_id: productId, role: 'asked_info', evidence_ids: [evidenceId] }] } },
    dialogue_plan: { requests: [{ id: 'r1', topic: 'photos', subject: 'specific_product' }] },
    state: { product_id: productId, product_evidence: evidenceId },
    response_contract: { answers: [{ request_id: 'request_1', excerpt: reply }] },
  };
}

async function main() {
  let settings, inventory, images;
  try { settings = load('genesis_settings_snapshot.json'); inventory = load('genesis_inventory_snapshot.json'); images = load('genesis_images_snapshot.json'); } catch (error) {
    console.log('FAIL snapshots unavailable in ' + dir + ': ' + String(error.message).slice(0, 120));
    process.exitCode = 1; return;
  }
  // As in production, the model keeps the previous focus in its state while the current message names another vehicle.
  const second = photoRequest('Essa é a PCX!', ID.pcx2023, true, 'in-2');
  second.state = { product_id: ID.montana, product_evidence: 'in-1' };
  const r = await exec.runScenario({ name: 'photo-switch', turns: [
    { text: 'Manda foto da Montana', gemini: photoRequest('Olha ela aqui!', ID.montana, false, 'in-1') },
    { text: 'E da PCX branca? Manda foto', gemini: second },
  ], auditor_responses: Array(8).fill(auditor) }, { mode: 'fixtures', geminiKey: null, settings, inventory, images });

  const media = r.world.log.simulated_media.map(item => String(item.media || ''));
  const texts = r.world.log.simulated_sends.map(item => String(item.text || item.body?.text || ''));
  const rows = [];
  const check = (name, ok, detail) => rows.push({ name, ok: Boolean(ok), detail });
  check('1ª foto (Montana) enviada', media.some(url => url.includes('chevrolet-montana-2013-branca')), { media });
  check('2ª foto é a da PCX pedida, não a Montana de novo', media.length === 2 && media[1].includes('honda-pcx-2023-branca'), { media, errors: r.steps.map(s => s.final?.error_code || s.stopped || null) });
  check('nenhuma mensagem de erro técnico ao cliente', !texts.some(text => /dificuldade|instabilidade|novamente|repetir/i.test(text)), { texts });
  // 21/10 20h01: depois da foto do item 4, "Quantos km?" foi respondido sobre a Montana. O veículo da
  // última foto pedida passa a ser o foco do lead, com a mensagem atual como evidência.
  const lead = r.world.tables.sales_leads.at(-1);
  check('o foco do lead passa para a PCX da última foto pedida', lead?.state?.product_id === ID.pcx2023
    && lead?.state?.product_evidence && lead?.state?.buy_interest?.product_id === ID.pcx2023,
    { product_id: lead?.state?.product_id, evidence: lead?.state?.product_evidence, buy_interest: lead?.state?.buy_interest });

  // The photo answers alone: no "segue a foto" text is required, only the image goes out.
  const noCaption = photoRequest('', ID.montana, false, 'in-1');
  noCaption.response_contract = { answers: [] };
  const alone = await exec.runScenario({ name: 'photo-alone', turns: [{ text: 'Manda foto da Montana', gemini: noCaption }],
    auditor_responses: Array(4).fill(auditor) }, { mode: 'fixtures', geminiKey: null, settings, inventory, images });
  const aloneQueue = alone.world.tables.conversation_turn_queue[0];
  check('foto sem legenda: só a imagem é enviada e o turno fecha normalmente',
    alone.world.log.simulated_media.length === 1 && alone.world.log.simulated_sends.length === 0 && aloneQueue?.phase === 'ready',
    { media: alone.world.log.simulated_media.length, sends: alone.world.log.simulated_sends.map(s => s.text), queue: aloneQueue?.phase, final: alone.steps[0]?.final });

  // Malformed model output (as INVALID_PRIMARY_REPLY;MISSING_PRIMARY_PLAN in production): silence plus operator alert, never a technical text.
  const broken = await exec.runScenario({ name: 'model-broken', turns: [{ text: 'Honda pix', gemini: { reply: '', contract: 'invalid', semantic_intent: {} } }],
    auditor_responses: Array(4).fill(auditor) }, { mode: 'fixtures', geminiKey: null, settings, inventory, images });
  const alert = broken.world.tables.channel_events.find(row => row.ai_provider === 'core_operator_review');
  check('resposta inválida do modelo: nada é enviado ao cliente e o operador é alertado',
    broken.world.log.simulated_sends.length === 0 && alert && alert.service === 'technical_error' && alert.delivery_status === 'internal'
      && broken.world.tables.conversation_turn_queue[0]?.phase === 'review',
    { sends: broken.world.log.simulated_sends.map(s => s.text), alert: alert && { service: alert.service, error: alert.ai_error }, queue: broken.world.tables.conversation_turn_queue[0]?.phase, failures: broken.world.log.failures });

  let failed = 0;
  for (const item of rows) {
    if (!item.ok) failed += 1;
    console.log((item.ok ? 'PASS ' : 'FAIL ') + item.name);
    if (!item.ok) console.log('       ' + JSON.stringify(item.detail).slice(0, 700));
  }
  console.log('\n' + (rows.length - failed) + '/' + rows.length + ' photo switch checks pass.');
  process.exitCode = failed ? 1 : 0;
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 2; });

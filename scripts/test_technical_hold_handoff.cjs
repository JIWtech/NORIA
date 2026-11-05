// Gênesis 21-27/10 (…7233 Millena, …9831, …8468): um marcador técnico do WhatsApp ([secretencrypted], [reaction]) no
// turno fazia o motor descartar tudo (19 fotos e textos) como "arquivo não suportado"; o aviso de mídia era reprovado
// pelo contrato estruturado e o turno parava em revisão, com a conversa ainda como "IA atendendo" e a etapa em qualificação.
// 1. marcadores técnicos não contam como arquivo; turno só com eles termina em silêncio;
// 2. aviso de mídia (arquivo realmente não suportado) não passa pelo contrato estruturado da resposta;
// 3. quando a IA trava sem resposta segura, a conversa vai para a etapa humana configurada e é atribuída à equipe.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = fs.readFileSync(path.join(__dirname, '../n8n/sources/noria_core.js'), 'utf8').replace(/\r\n/g, '\n');
const slice = name => { const start = core.indexOf('function ' + name + '('); assert.ok(start >= 0, name); return core.slice(start, core.indexOf('\n}\n', start) + 3); };
const capability = new Function(slice('salesAlbumEnvelope') + slice('salesMediaCapability') + '; return salesMediaCapability;')();
const msg = text => ({ text });

test('marcador técnico junto de fotos e textos não descarta o turno (Millena, 27/10)', () => {
  const turn = [msg('Google Vitor Saveiro 19/20 111km 32 mil'), ...Array.from({ length: 19 }, () => msg('[image]')), msg('[secretencrypted]'), msg('30 mil')];
  assert.equal(capability(turn).supported, true);
  assert.equal(capability([msg('Oi'), msg('[reaction]')]).supported, true);
});

test('turno só com marcador técnico é silencioso, nunca "arquivo não suportado"', () => {
  for (const turn of [[msg('[secretencrypted]')], [msg('[reaction]')], [msg('[reaction]'), msg('[secretencrypted]')]]) {
    const result = capability(turn);
    assert.equal(result.supported, false);
    assert.equal(result.kind, 'technical_only');
    assert.equal(result.reply, '');
  }
});

test('arquivo realmente não suportado continua com aviso', () => {
  assert.equal(capability([msg('[contact]')]).kind, 'contact');
  assert.equal(capability([msg('[template]')]).kind, 'unknown');
  assert.equal(capability([msg('[poll]'), msg('[secretencrypted]')]).kind, 'unknown');
  assert.equal(capability([msg('[image]'), msg('[video]')]).supported, true);
});

test('turno só técnico termina sem resposta e sem revisão', () => {
  const prepare = core.slice(core.indexOf('async function runSalesTurnPrepare('));
  const block = prepare.slice(prepare.indexOf("salesMediaCapability(turn.messages).kind === 'technical_only'"), prepare.indexOf("salesMediaCapability(turn.messages).kind === 'technical_only'") + 700);
  assert.match(block, /await commit\(\)/);
  assert.match(block, /ai_suppressed_reason: 'technical_marker_only'/);
  assert.match(block, /await complete\('done'\)/);
});

test('aviso de mídia não passa pelo contrato estruturado da resposta', () => {
  const finalize = core.slice(core.indexOf('async function runSalesTurnFinalize('));
  assert.match(finalize, /let audit = generated\.media_notice \? \{ status: 'accepted', issues: \[\], validation: 'media_notice' \}/);
  assert.match(finalize, /: generated\.media_notice \? 'media_notice' : null;/);
  // O texto aceito sai de primary_reply: o aviso precisa preenchê-lo, senão a resposta ficaria vazia.
  assert.match(core, /media_notice: mediaCapability\.kind\n\s*\};\n\s*generated\.primary_reply = generated\.reply;/);
});

test('IA travada sem resposta segura: etapa humana configurada + atribuição, com prova do banco', () => {
  const helper = slice('salesTechnicalHoldHandoff');
  assert.match(helper, /cfg\.stage_keys\?\.human/);
  assert.match(helper, /allow_ai !== false/);
  assert.match(helper, /salesPersistEmptyRecoveryState\(context, turn, chatId, \{ \.\.\.saved, stage_key: humanStage \}/);
  assert.match(helper, /persisted\.ai_locked !== true/);
  assert.match(helper, /salesResolveDefaultAssignee\(context\)/);
  assert.match(helper, /salesAssignConversation\(context, assignee, persisted\)/);
  assert.match(helper, /salesVerifyAssignmentOutcome\(/);
  const finalize = core.slice(core.indexOf('async function runSalesTurnFinalize('));
  assert.match(finalize, /await salesTechnicalHoldHandoff\(context, cfg, saved, s, generated\.product\)/);
  assert.match(finalize, /status: 'technical_hold_handoff'/);
});

test('sem etapa humana configurada, mantém o comportamento anterior (só grava o estado)', () => {
  const helper = slice('salesTechnicalHoldHandoff');
  assert.match(helper, /if \(!humanStage \|\| meta\?\.allow_ai !== false \|\| meta\.closed === true\) return null/);
});

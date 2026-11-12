// O construtor parte do motor atual e aplica as correções exclusivas do Salon no artefato isolado.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { buildSalonEngine } = require('./build_conversation_adapter.cjs');

const root = path.resolve(__dirname, '../..');
const engine = JSON.parse(fs.readFileSync(path.join(root, 'n8n/workflows/NORIA CORE _ Motor conversacional.json'), 'utf8'));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const salon = { tenant_id: '76aff8a0-0466-42b9-a80d-db186ff3d8bd', tenant_slug: 'ic_salon', instance: 'ic_saloon', remoteJid: '5511000000000@s.whatsapp.net' };

test('o Salon é regenerado a partir do artefato atual do motor e conserva a leitura de fase e contrato', async () => {
  assert.equal(engine.name, 'NORIA CORE | Motor de Atendimento');
  const built = buildSalonEngine(engine);
  assert.equal(built.name, 'NORIA EXT | I&C Salon | Motor isolado');
  assert.equal(built.active, false);
  assert.equal(built.nodes.length, 2);
  const original = engine.nodes.find(node => node.name === 'CORE | Motor conversacional').parameters.jsCode;
  const wrapped = built.nodes.find(node => node.name === 'CORE | Motor conversacional').parameters.jsCode;
  assert.ok(wrapped.includes('const NORIA_NODE_PHASE'), 'o contrato de fase é preservado');
  const run = json => new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', wrapped)
    .call({ helpers: { httpRequest: async () => { throw new Error('rede'); } } }, json, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'k' }, {}, () => ({}));
  await assert.rejects(run({ ...salon, noria_engine_phase: 'single' }), /NORIA_ENGINE_CONTRACT_MISMATCH/);
  await assert.rejects(run({ ...salon, noria_engine_phase: 'single', noria_engine_contract: 'noria_engine_phase_v0' }), /NORIA_ENGINE_CONTRACT_MISMATCH/);
  await assert.rejects(run({ ...salon, tenant_slug: 'outro', noria_engine_phase: 'single', noria_engine_contract: 'noria_engine_phase_v1' }), /IC_SALON_ADAPTER_SCOPE_INVALID/);
});

test('o construtor recusa export que não seja o motor de 2 nós', () => {
  assert.throws(() => buildSalonEngine({ ...engine, nodes: [...engine.nodes, { ...engine.nodes[0], name: 'extra' }] }), /IC_SALON_ENGINE_EXPORT_INCOMPATIBLE/);
  assert.throws(() => buildSalonEngine({ ...engine, nodes: engine.nodes.map(node => ({ ...node, name: node.name + ' x' })) }), /IC_SALON_ENGINE_EXPORT_INCOMPATIBLE/);
});

test('o Salon aplica correções de handoff e estágio sem mudar a fonte compartilhada', () => {
  const original = engine.nodes.find(node => node.name === 'CORE | Motor conversacional').parameters.jsCode;
  const code = buildSalonEngine(engine).nodes.find(node => node.name === 'CORE | Motor conversacional').parameters.jsCode;
  assert.ok(original.includes('recordTeamReviewWithoutTransfer'));
  assert.ok(!code.includes('recordTeamReviewWithoutTransfer'));
  assert.match(code, /if \(!event\.handoff && requestAction\?\.kind === 'create'/);
  assert.match(code, /appointments\.openRequest = request/);
  assert.match(code, /event\.raw_payload\.explicit_handoff/);
  assert.match(code, /event\.stage = 'Agendamento confirmado'/);
  assert.match(code, /const proseForCleanup/);
});


test('prioridade da transferência e persistência do estágio no código gerado', () => {
  const code = buildSalonEngine(engine).nodes.find(node => node.name === 'CORE | Motor conversacional').parameters.jsCode.replace(/\r\n/g, '\n');
  const start = code.indexOf("  if (!event.handoff && requestAction?.kind === 'create'");
  const decision = code.indexOf('  } else if (actions.humanRequested', start);
  const safe = code.indexOf('  if (event.raw_payload.explicit_handoff', decision);
  const end = code.indexOf('  const proseForCleanup', safe);
  assert.ok(start > 0 && decision > start && safe > decision && end > safe);
  const condition = code.slice(start, code.indexOf(' {', start) + 2);
  const evaluate = new Function('actions', 'requestAction', 'needsTeamReview', 'event', 'context', 'requestConfig', 'appointments',
    'let responseText="alterado"; let preserveLiteralReply=false; let literalReplySuffix="confirmação"; let wrote=false; const isBotFrustrationText=()=>false; const keepsAiOnTeamReview=c=>c.manual; const sessionHandoffMessage=()=>"Equipe vai conferir";\n'
    + condition + ' wrote=true; appointments.openRequest={id:"novo"};\n' + code.slice(decision, end)
    + '\nreturn {event,wrote,responseText,preserveLiteralReply,literalReplySuffix};');
  const run = (action, { handoff = false, review = false, manual = true, actions = {}, open = false, confirmed = false } = {}) =>
    evaluate(actions, action && { kind: action }, review, { handoff, stage: handoff ? 'Atendimento humano' : 'Conversas IA', raw_payload: {} },
      { manual }, { valid: true }, { openRequest: open && { id: 'p' }, futureConfirmed: confirmed && { id: 'c' } });
  for (const kind of ['update', 'cancel']) {
    const r = run(kind, { open: true });
    assert.equal(r.wrote, false); assert.equal(r.event.handoff, true);
    assert.equal(r.event.stage, 'Atendimento humano'); assert.equal(r.responseText, 'Equipe vai conferir');
    assert.equal(r.literalReplySuffix, '');
  }
  assert.equal(run('create', { confirmed: true }).event.stage, 'Aguardando confirmação');
  assert.equal(run(null, { open: true }).event.stage, 'Aguardando confirmação');
  assert.equal(run(null, { confirmed: true }).event.stage, 'Agendamento confirmado');
  assert.equal(run(null, { review: true, open: true }).event.raw_payload.team_review_requested, true);
  assert.equal(run(null, { review: true, manual: false }).event.handoff, true);
  assert.equal(run('create', { handoff: true }).wrote, false);
  assert.equal(run(null, { actions: { humanRequested: true }, open: true }).event.handoff, true);
  assert.equal(run(null, { actions: { complaint: true }, confirmed: true }).event.stage, 'Atendimento humano');
});

test('transformação recusa fonte incompatível ou ambígua', () => {
  const source = structuredClone(engine);
  const node = source.nodes.find(item => item.name === 'CORE | Motor conversacional');
  node.parameters.jsCode = node.parameters.jsCode.replace('    needsTeamReview = generated.needsTeamReview === true;', '');
  assert.throws(() => buildSalonEngine(source));
});

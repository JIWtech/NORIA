const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../app/node_modules/typescript');
const source = fs.readFileSync('clients/ic_saloon/salon_engine.js', 'utf8');
const ast = ts.createSourceFile('salon.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function fn(name) {
  const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(node, `função ${name} ausente`);
  return node.getText(ast);
}
test('decisão deve apontar proposta enviada e mensagem atual posterior', () => {
  const ctx = {}; vm.runInNewContext(fn('salonValidateSlotProposalDecision'), ctx);
  const proposal = { id: 'proposal-1', status: 'sent', sent_at: '2026-01-01T12:00:00Z' };
  const messages = [{ event_id: 'event-1', received_at: '2026-01-01T12:01:00Z' }];
  const valid = { proposal_id: proposal.id, decision: 'accept', turn_event: 'event-1' };
  assert.equal(ctx.salonValidateSlotProposalDecision(valid, proposal, messages), true);
  for (const invalid of [{...valid, proposal_id:'other'}, {...valid, turn_event:'other'}, {...valid, decision:'maybe'}])
    assert.equal(ctx.salonValidateSlotProposalDecision(invalid, proposal, messages), false);
  assert.equal(ctx.salonValidateSlotProposalDecision(valid, {...proposal, status:'sending'}, messages), false);
  assert.equal(ctx.salonValidateSlotProposalDecision(valid, {...proposal, sent_at:'2026-01-01T12:01:00Z'}, messages), false);
});
test('recupera resolução do mesmo evento e restringe a consulta por tenant e chat', async () => {
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const paths = [];
  const ctx = { settingsFor: () => ({ appointment_request: { slot_proposal_resolution_enabled: true } }),
    chatId: 'chat', encodeFilter: encodeURIComponent,
    supabaseGet: async path => { paths.push(path); return [{ id: 'appointment', metadata: { slot_proposal:
      { id: 'proposal', decision: 'accept', turn_event: id } } }]; } };
  vm.runInNewContext(fn('salonSlotProposalDecision'), ctx);
  const result = await ctx.salonSlotProposalDecision({ tenant: { id: 'tenant' } }, [], [{ event_id: id }]);
  assert.equal(result.proposal_id, 'proposal'); assert.equal(result.turn_event, id);
  assert.match(paths[0], /tenant_id=eq\.tenant/); assert.match(paths[0], /external_conversation_id=eq\.chat/);
});
test('RPC exige status correto e recebe identidade e evento reais', async () => {
  let call;
  const ctx = { chatId: 'chat', supabasePost: async (path, body) => { call = { path, body }; return { appointment: { id: 'a', status: 'pending_confirmation' } }; } };
  vm.runInNewContext(fn('salonResolveSlotProposal'), ctx);
  await ctx.salonResolveSlotProposal({ tenant: { id: 'tenant' } }, { appointment_id: 'a', proposal_id: 'p', decision: 'accept', turn_event: 'e' });
  assert.equal(call.path, '/rest/v1/rpc/magia_slot_proposal_resolve');
  assert.equal(call.body.p_tenant, 'tenant'); assert.equal(call.body.p_chat, 'chat'); assert.equal(call.body.p_turn_event, 'e');
  await assert.rejects(ctx.salonResolveSlotProposal({ tenant: { id: 'tenant' } }, { appointment_id: 'a', proposal_id: 'p', decision: 'reject', turn_event: 'e' }), /SLOT_PROPOSAL_RESOLUTION_INVALID/);
});
test('recusa de negócio da RPC não derruba o turno; erro técnico continua subindo', async () => {
  for (const code of ['SLOT_PROPOSAL_OPEN_REQUEST_EXISTS', 'SLOT_PROPOSAL_PAST', 'SLOT_PROPOSAL_NOT_SENT', 'SLOT_PROPOSAL_CHANGED',
    'SLOT_PROPOSAL_ALREADY_RESOLVED', 'SLOT_PROPOSAL_INVALID_TURN']) {
    const ctx = { supabaseErrorText: error => String(error.message),
      salonResolveSlotProposal: async () => { throw new Error('Request failed: ' + code); } };
    vm.runInNewContext(fn('salonResolveSlotProposalSafely'), ctx);
    const result = await ctx.salonResolveSlotProposalSafely({}, {});
    assert.equal(result.refused, code, code);
  }
  const ok = { supabaseErrorText: e => String(e.message), salonResolveSlotProposal: async () => ({ appointment: { id: 'a' } }) };
  vm.runInNewContext(fn('salonResolveSlotProposalSafely'), ok);
  assert.equal(JSON.stringify(await ok.salonResolveSlotProposalSafely({}, {})), JSON.stringify({ resolved: { appointment: { id: 'a' } } }));
  const technical = { supabaseErrorText: e => String(e.message), salonResolveSlotProposal: async () => { throw new Error('ETIMEDOUT'); } };
  vm.runInNewContext(fn('salonResolveSlotProposalSafely'), technical);
  await assert.rejects(technical.salonResolveSlotProposalSafely({}, {}), /ETIMEDOUT/);
  assert.match(source, /await salonResolveSlotProposalSafely\(context, slotDecision\)/, 'o turno usa a versão segura');
});

test('falhas do modelo e da busca viram "sem decisão" com motivo; falha de banco continua subindo', async () => {
  for (const code of ['SLOT_PROPOSAL_DECISION_INVALID', 'SLOT_PROPOSAL_MODEL_INCOMPLETE', 'SLOT_PROPOSAL_MODEL_UNAVAILABLE', 'SLOT_PROPOSAL_LOOKUP_UNAVAILABLE']) {
    const ctx = { salonSlotProposalDecision: async () => { throw new Error(code); } };
    vm.runInNewContext(fn('salonSlotProposalDecisionSafely') + '\n' + source.match(/const SALON_SLOT_PROPOSAL_SOFT_FAILURES[^;]+;/)[0], ctx);
    const result = await ctx.salonSlotProposalDecisionSafely({}, [], []);
    assert.equal(result.decision, null); assert.equal(result.skipped, code);
  }
  const ok = { salonSlotProposalDecision: async () => ({ decision: 'accept' }) };
  vm.runInNewContext(fn('salonSlotProposalDecisionSafely') + '\n' + source.match(/const SALON_SLOT_PROPOSAL_SOFT_FAILURES[^;]+;/)[0], ok);
  assert.equal((await ok.salonSlotProposalDecisionSafely({}, [], [])).decision.decision, 'accept');
  for (const message of ['SLOT_PROPOSAL_RECOVERY_AMBIGUOUS', 'SLOT_PROPOSAL_TURN_EVENT_MISSING', 'ETIMEDOUT']) {
    const db = { salonSlotProposalDecision: async () => { throw new Error(message); } };
    vm.runInNewContext(fn('salonSlotProposalDecisionSafely') + '\n' + source.match(/const SALON_SLOT_PROPOSAL_SOFT_FAILURES[^;]+;/)[0], db);
    await assert.rejects(db.salonSlotProposalDecisionSafely({}, [], []), new RegExp(message));
  }
  assert.match(source, /await salonSlotProposalDecisionSafely\(context, history, turn\.messages\)/, 'o turno usa a versão segura');
  assert.match(source, /slot_proposal_resolution = \{ skipped:/, 'o motivo fica em raw_payload');
});
test('proposta enviada vencida não dispara o Gemini; dentro do prazo (padrão 48h ou do tenant) dispara', async () => {
  const hoursAgo = hours => new Date(Date.now() - hours * 3600000).toISOString();
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  async function run(sentHoursAgo, ttl) {
    let geminiCalls = 0;
    const row = { id: 'a', metadata: { slot_proposal: { id: 'p', status: 'sent', sent_at: hoursAgo(sentHoursAgo), message_id: 'm' } } };
    const ctx = { chatId: 'chat', encodeFilter: encodeURIComponent, env: name => name === 'GEMINI_MODEL' ? 'gemini-test' : 'k', usageGate: () => ({ allowed: true }),
      settingsFor: () => ({ appointment_request: { slot_proposal_resolution_enabled: true, ...(ttl ? { slot_proposal_ttl_hours: ttl } : {}) } }),
      supabaseGet: async path => /slot_proposal->>turn_event/.test(path) ? [] : [row],
      httpJson: async () => { geminiCalls++; return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ proposal_id: 'p', decision: 'none', turn_event: id }) }] } }] }; } };
    vm.runInNewContext(fn('salonValidateSlotProposalDecision') + fn('salonSlotProposalDecision') + source.match(/const SALON_SLOT_PROPOSAL_DEFAULT_TTL_HOURS[^;]+;/)[0] + '\n' + fn('salonSlotProposalExpired') + fn('salonSlotProposalTtlMs'), ctx);
    const result = await ctx.salonSlotProposalDecision({ tenant: { id: 't' } }, [], [{ event_id: id, text: 'ok', received_at: new Date().toISOString() }]);
    return { result, geminiCalls };
  }
  assert.equal((await run(49)).geminiCalls, 0); assert.equal((await run(49)).result, null);
  assert.equal((await run(47)).geminiCalls, 1);
  assert.equal((await run(3, 2)).geminiCalls, 0); assert.equal((await run(1, 2)).geminiCalls, 1);
});
test('segunda geração depois da resolução não herda literalidade nem revisão e não cria pedido', () => {
  const ctx = {}; vm.runInNewContext(fn('salonRevisedTurnState'), ctx);
  const state = ctx.salonRevisedTurnState({ preserveLiteral: false, needsTeamReview: false }, false);
  assert.equal(state.preserveLiteralReply, false); assert.equal(state.needsTeamReview, false); assert.equal(state.requestActionAllowed, false);
  const handoff = ctx.salonRevisedTurnState({ preserveLiteral: true, needsTeamReview: true }, true);
  assert.equal(handoff.preserveLiteralReply, true); assert.equal(handoff.needsTeamReview, false);
  assert.match(source, /const requestAction = requestConfig && !slotResolutionTurn \? parseAppointmentRequestAction/, 'tag de agendamento ignorada no turno de resolução');
  assert.match(source, /salonRevisedTurnState\(revised, event\.handoff\)/);
});

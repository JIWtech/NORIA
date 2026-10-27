// Plano 27/10, P0-1: clientes ficaram sem resposta depois de a IA pedir a equipe (Gênesis …3451, …2928).
// A central passa a distinguir pendência aguardando resposta, atrasada (15 min) e já respondida pela equipe.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchHumanReplies, humanReplyStatus, incidentPresentation, HUMAN_REPLY_OVERDUE_MS } from '../../src/features/notifications/notificationService.js';

const opened = '2026-10-26T21:00:00.000Z';
const at = minutes => Date.parse(opened) + minutes * 60_000;
const item = (overrides = {}) => ({ id: 't1', tenant_id: 'tenant-a', phase: 'review', chat_id: '5527999990000@s.whatsapp.net', channel_type: 'whatsapp', created_at: opened, resolved_at: null, ...overrides });
const reply = (overrides = {}) => ({ tenant_id: 'tenant-a', external_conversation_id: '5527999990000@s.whatsapp.net', channel_type: 'whatsapp', direction: 'outbound',
  ai_provider: 'human_operator', sender_type: 'agent', delivery_status: 'sent', created_at: '2026-10-26T21:05:00.000Z', ...overrides });

test('pendência sem resposta da equipe aguarda e fica atrasada depois de 15 minutos', () => {
  assert.equal(HUMAN_REPLY_OVERDUE_MS, 15 * 60_000);
  assert.equal(humanReplyStatus(item(), [], 'tenant-a', at(14)), 'waiting');
  assert.equal(humanReplyStatus(item(), [], 'tenant-a', at(15)), 'overdue');
  assert.equal(humanReplyStatus(item({ phase: 'uncertain' }), [], 'tenant-a', at(30)), 'overdue');
});

test('só mensagem da equipe efetivamente enviada depois da pendência resolve', () => {
  assert.equal(humanReplyStatus(item(), [reply()], 'tenant-a', at(30)), 'answered');
  for (const other of [
    { delivery_status: 'failed' }, { delivery_status: 'uncertain' }, { ai_provider: 'sales_core', sender_type: 'assistant' },
    { ai_provider: 'core_operator_review', sender_type: 'system', delivery_status: 'internal' }, { direction: 'inbound' },
    { created_at: '2026-10-26T20:59:00.000Z' }, { created_at: opened }, { external_conversation_id: '5527888880000@s.whatsapp.net' },
    { channel_type: 'telegram' },
  ]) assert.equal(humanReplyStatus(item(), [reply(other)], 'tenant-a', at(30)), 'overdue', JSON.stringify(other));
});

test('resposta de outro tenant nunca resolve a pendência', () => {
  assert.equal(humanReplyStatus(item(), [reply({ tenant_id: 'tenant-b' })], 'tenant-a', at(30)), 'overdue');
});

test('sem dados confiáveis ou pendência encerrada, a central mantém o aviso original', () => {
  assert.equal(humanReplyStatus(item(), null, 'tenant-a', at(30)), null);
  assert.equal(humanReplyStatus(item({ resolved_at: '2026-10-26T22:00:00.000Z' }), [], 'tenant-a', at(30)), null);
  assert.equal(humanReplyStatus(item({ created_at: 'x' }), [], 'tenant-a', at(30)), null);
  assert.deepEqual(incidentPresentation(item(), null), incidentPresentation(item()));
});

test('apresentação de cada situação, sem linguagem técnica', () => {
  const waiting = incidentPresentation(item(), 'waiting');
  const overdue = incidentPresentation(item(), 'overdue');
  const answered = incidentPresentation(item(), 'answered');
  assert.equal(waiting.attention, true);
  assert.equal(overdue.attention, true);
  assert.equal(overdue.overdue, true);
  assert.equal(answered.attention, false);
  assert.notEqual(overdue.title, waiting.title);
  assert.match(overdue.description, /15 minutos/);
  for (const info of [waiting, overdue, answered]) assert.doesNotMatch(info.title + info.description, /ticket|reconcilia|backend|revisão|incidente/i);
  assert.equal(incidentPresentation(item({ resolved_at: '2026-10-26T22:00:00.000Z' }), 'overdue').kind, 'closed');
  // Entrega não confirmada mantém o alerta de conferir antes de reenviar.
  assert.equal(incidentPresentation(item({ phase: 'uncertain' }), 'waiting').kind, 'uncertain');
  assert.match(incidentPresentation(item({ phase: 'uncertain' }), 'overdue').description, /antes de enviar novamente/);
});

function fakeClient(result) {
  const calls = [];
  const builder = new Proxy({}, { get: (_, name) => name === 'then'
    ? (resolve, reject) => Promise.resolve(result).then(resolve, reject)
    : (...args) => { calls.push([name, ...args]); return builder; } });
  return { calls, client: { from: (...args) => { calls.push(['from', ...args]); return builder; } } };
}

test('consulta só leitura, filtrada por tenant, só nas conversas com pendência aberta', async () => {
  const { calls, client } = fakeClient({ data: [reply()], error: null });
  const items = [item(), item({ id: 't2', chat_id: '5527111110000@s.whatsapp.net', created_at: '2026-10-25T10:00:00.000Z' }), item({ id: 't3', chat_id: 'fechado@s.whatsapp.net', resolved_at: opened })];
  const rows = await fetchHumanReplies('tenant-a', items, undefined, client);
  assert.deepEqual(rows, [reply()]);
  const names = calls.map(call => call[0]);
  assert.ok(!names.some(name => ['insert', 'update', 'upsert', 'delete', 'rpc'].includes(name)));
  assert.deepEqual(calls.find(call => call[0] === 'from'), ['from', 'channel_events']);
  assert.ok(calls.some(call => call[0] === 'eq' && call[1] === 'tenant_id' && call[2] === 'tenant-a'));
  assert.ok(calls.some(call => call[0] === 'eq' && call[1] === 'ai_provider' && call[2] === 'human_operator'));
  assert.ok(calls.some(call => call[0] === 'eq' && call[1] === 'delivery_status' && call[2] === 'sent'));
  const ids = calls.find(call => call[0] === 'in');
  assert.deepEqual([...ids[2]].sort(), ['5527111110000@s.whatsapp.net', '5527999990000@s.whatsapp.net']);
  assert.deepEqual(calls.find(call => call[0] === 'gte'), ['gte', 'created_at', '2026-10-25T10:00:00.000Z']);
});

test('sem pendência aberta não consulta; erro ou resultado truncado não afirma ausência de resposta', async () => {
  const none = fakeClient({ data: [], error: null });
  assert.deepEqual(await fetchHumanReplies('tenant-a', [item({ resolved_at: opened })], undefined, none.client), []);
  assert.equal(none.calls.length, 0);
  assert.equal(await fetchHumanReplies('tenant-a', [item()], undefined, fakeClient({ data: null, error: { message: 'x' } }).client), null);
  assert.equal(await fetchHumanReplies('tenant-a', [item()], undefined, fakeClient({ data: Array(500).fill(reply()), error: null }).client), null);
  assert.equal(await fetchHumanReplies('tenant-a', [item()], undefined, null), null);
});

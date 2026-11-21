import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcilePendingKanbanMoves } from '../../src/services/kanban/pendingKanbanMoves.js';
import { sortKanbanCardsByConversationActivity } from '../../src/services/kanban/applyIncomingEvent.js';
import { createTeamAgentManagement } from '../../src/services/agents/teamAgentManagement.js';

test('movimento confirmado não duplica card quando servidor já prevalece', () => {
  const card = { id: 'card', salesRevision: 2, channelType: 'whatsapp', externalConversationId: '123' };
  const server = { kanbanColumns: [{ id: 'b', cards: [] }, { id: 'c', cards: [card] }] };
  const moves = new Map([['card', { card, targetColumnKey: 'b', salesRevision: 1, confirmedAt: Date.now() - 4500 }]]);
  const result = reconcilePendingKanbanMoves(server, new Map(), moves);
  assert.deepEqual(result.kanbanColumns.map((column) => column.cards.length), [0, 1]);
});

test('movimento confirmado respeita a janela e a revisão igual após quatro segundos', () => {
  const card = { id: 'card', salesRevision: 2, channelType: 'whatsapp', externalConversationId: '123' };
  const server = { kanbanColumns: [{ id: 'b', cards: [] }, { id: 'c', cards: [card] }] };
  for (const [elapsed, expected] of [[3900, [1, 0]], [4500, [0, 1]]]) {
    const moves = new Map([['card', { card, targetColumnKey: 'b', salesRevision: 2, confirmedAt: Date.now() - elapsed }]]);
    const result = reconcilePendingKanbanMoves(server, new Map(), moves);
    assert.deepEqual(result.kanbanColumns.map((column) => column.cards.length), expected);
  }
});

test('ordena conversas por atividade mesmo entre cards sem data', () => {
  const cards = [{ id: 'old', lastActivityAt: '2026-01-01' }, { id: 'missing' }, { id: 'new', lastActivityAt: '2026-02-01' }];
  assert.deepEqual(sortKanbanCardsByConversationActivity(cards).map((card) => card.id), ['new', 'old', 'missing']);
});

test('ordenação é consistente para permutações e datas inválidas', () => {
  const cards = [
    { id: 'old', lastActivityAt: '2026-01-01' },
    { id: 'invalid', lastActivityAt: 'inválida' },
    { id: 'new', lastActivityAt: '2026-02-01' },
  ];
  for (const order of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
    assert.deepEqual(sortKanbanCardsByConversationActivity(order.map((index) => cards[index])).map((card) => card.id), ['new', 'old', 'invalid']);
  }
  assert.deepEqual(sortKanbanCardsByConversationActivity([{ id: 'a' }, { id: 'b', lastActivityAt: 'inválida' }]).map((card) => card.id), ['a', 'b']);
});

test('erros de persistência dos atendentes são propagados', async () => {
  const failure = new Error('RLS');
  const client = { from(table) {
    const q = { select() { return q; }, limit() { return q; }, eq() { return q; },
      maybeSingle: async () => ({ data: { id: 'tenant-id' } }),
      insert() { return q; }, update() { return q; }, delete() { return q; },
      single: async () => ({ error: failure }),
      then(resolve) { resolve({ error: failure }); },
    }; return q;
  } };
  const api = createTeamAgentManagement({ getClient: () => client });
  await assert.rejects(api.saveTeamAgent('tenant', { name: 'Ana' }), /RLS/);
  await assert.rejects(api.updateTeamAgentStatus('agent', 'offline', 'tenant'), /RLS/);
  await assert.rejects(api.removeTeamAgent('agent', 'tenant'), /RLS/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { situationOf, attachAvatars } from '../../src/features/notifications/notificationSituations.js';

test('cada tipo de aviso cai numa situação com nome e cor próprios', () => {
  assert.equal(situationOf({ kind: 'handoff' }).key, 'waiting-team');
  assert.equal(situationOf({ kind: 'team-review' }).key, 'waiting-team');
  assert.equal(situationOf({ kind: 'deposit-review' }).key, 'payment');
  assert.equal(situationOf({ kind: 'appointment-request' }).key, 'agenda');
  assert.equal(situationOf({ kind: 'appointment', appointmentStatus: 'confirmed' }).key, 'agenda');
  assert.equal(situationOf({ kind: 'message' }).key, 'message');
  assert.equal(situationOf({ kind: 'resumed' }).key, 'ai');
  assert.equal(situationOf({ kind: 'assignment' }).key, 'assigned');
  assert.equal(situationOf({ kind: 'closed' }).key, 'done');
  assert.equal(situationOf({ kind: 'stage', category: 'leads' }).key, 'kanban');
  assert.equal(situationOf({ kind: 'delivery' }).key, 'problem');
  assert.equal(situationOf({ kind: 'desconhecido', category: 'leads' }).key, 'kanban');
  assert.equal(situationOf({}).key, 'info');
  const labels = new Set(['waiting-team', 'payment', 'agenda', 'message', 'ai', 'done', 'kanban', 'problem']
    .map(key => situationOf({ kind: { 'waiting-team': 'handoff', payment: 'payment', agenda: 'reminder', message: 'message', ai: 'resumed', done: 'closed', kanban: 'lead', problem: 'attachment' }[key] }).label));
  assert.equal(labels.size, 8, 'rótulos distintos');
});

test('pendência atrasada é marcada como urgente', () => {
  assert.equal(situationOf({ kind: 'handoff', overdue: true }).urgent, true);
});

test('a foto vem da conversa ou, se ela não estiver carregada, do card do Kanban do mesmo chat', () => {
  const conversations = [{ id: 'c1', channelType: 'whatsapp', externalConversationId: '5511999@s.whatsapp.net', avatarUrl: 'https://x/c1.jpg' }];
  const kanbanColumns = [{ cards: [{ externalConversationId: '5511888@s.whatsapp.net', channelType: 'whatsapp', avatarUrl: 'https://x/k2.jpg' }] }];
  const items = [
    { id: 'a', chatId: '5511999@s.whatsapp.net', channel: 'whatsapp' },
    { id: 'b', chatId: '5511888@s.whatsapp.net', channel: 'whatsapp' },
    { id: 'c', chatId: 'zzz', channel: 'whatsapp' },
    { id: 'd', chatId: '5511888@s.whatsapp.net', avatarUrl: 'https://x/own.jpg' },
  ];
  assert.deepEqual(attachAvatars(items, { conversations, kanbanColumns }).map(item => item.avatarUrl || null),
    ['https://x/c1.jpg', 'https://x/k2.jpg', null, 'https://x/own.jpg']);
});

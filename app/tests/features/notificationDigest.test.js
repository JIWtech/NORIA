import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNotificationDigest } from '../../src/features/notifications/notificationDigest.js';

const at = (h, m = 0, dayOffset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - dayOffset);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

test('pendências ficam em "Precisa de você", atrasadas primeiro e depois as mais antigas', () => {
  const items = [
    { id: 'a', pending: true, createdAt: at(10), contact: 'Ana', chatId: '1', kind: 'appointment-request' },
    { id: 'b', pending: true, overdue: true, createdAt: at(11), contact: 'Bia', chatId: '2', kind: 'handoff' },
    { id: 'c', pending: true, createdAt: at(9), contact: 'Caio', chatId: '3', kind: 'deposit-review' },
    { id: 'd', createdAt: at(12), contact: 'Ana', chatId: '1', kind: 'closed' },
  ];
  const digest = buildNotificationDigest(items, []);
  assert.deepEqual(digest.needsAction.map(entry => entry.item.id), ['b', 'c', 'a']);
  assert.deepEqual(digest.activity.flatMap(day => day.threads.map(thread => thread.latest.item.id)), ['d']);
});

test('eventos informativos do mesmo contato no mesmo dia viram uma única linha, mesmo de tipos diferentes', () => {
  const items = [
    { id: 'e1', kind: 'closed', createdAt: at(9, 35), contact: 'Rafael', chatId: 'r' },
    { id: 'e2', kind: 'resumed', createdAt: at(9, 34), contact: 'Rafael', chatId: 'r', unread: true },
    { id: 'e3', kind: 'assignment', createdAt: at(9, 33), contact: 'Rafael', chatId: 'r' },
    { id: 'e4', kind: 'lead', createdAt: at(9, 32), contact: 'Joana', chatId: 'j' },
    { id: 'e5', kind: 'closed', createdAt: at(15, 0, 1), contact: 'Rafael', chatId: 'r' },
  ];
  const digest = buildNotificationDigest(items, []);
  assert.equal(digest.activity.length, 2, 'hoje e ontem');
  const [today, yesterday] = digest.activity;
  assert.equal(today.label, 'Hoje');
  assert.deepEqual(today.threads.map(thread => [thread.latest.item.id, thread.entries.length]), [['e1', 3], ['e4', 1]]);
  assert.equal(today.threads[0].unread, 1);
  assert.equal(yesterday.threads[0].entries.length, 1);
});

test('avisos sem contato nem conversa não se agrupam entre si', () => {
  const items = [
    { id: 'x', kind: 'connection', createdAt: at(8) },
    { id: 'y', kind: 'connection', createdAt: at(7) },
  ];
  const digest = buildNotificationDigest(items, []);
  assert.equal(digest.activity[0].threads.length, 2);
});

test('datas inválidas são ignoradas', () => {
  const digest = buildNotificationDigest([{ id: 'z', createdAt: 'nope' }], []);
  assert.equal(digest.needsAction.length + digest.activity.length, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { inboxNotification, pendingNotifications, waitingConversationNotifications } from '../../src/features/notifications/notificationPending.js';
import { operatorEvents } from '../../src/features/notifications/operatorEvents.js';

const now = Date.parse('2026-11-07T15:00:00Z');
const appointment = (id, status, tenant = 'a') => ({
  id, status, startsAt: '2026-11-08T15:00:00Z', channelType: 'whatsapp', contactName: 'Contato',
  raw: { tenant_id: tenant, updated_at: '2026-11-07T10:00:00Z' },
});
const column = (automationKey, cards = []) => ({ automationKey, cards });
const card = (id, actionType) => ({ id: `card-${id}`, appointmentId: id, actionType });
const input = {
  tenantId: 'a', userId: 'user', role: 'operator', now,
  settings: { appointment_request: { mode: 'operator_confirmation', stale_alert_hours: 4 }, payment: { enabled: true } },
  kanbanColumns: [column('confirmar_agendamento', [card('request', 'confirm_request')]),
    column('verificar_sinal', [card('signal', 'confirm_signal')])],
  appointments: [appointment('request', 'pending_confirmation'), appointment('signal', 'payment_reported')],
};

test('pending appointment requests and reported deposits require authorized, matching current state', () => {
  const items = pendingNotifications(input);
  assert.deepEqual(items.map(item => item.kind), ['appointment-request', 'deposit-review']);
  assert.equal(items[0].overdue, true);
  assert.equal(items[0].cardId, 'card-request');
  assert.deepEqual(pendingNotifications({ ...input, role: 'viewer' }), []);
  assert.deepEqual(pendingNotifications({ ...input, userId: null }), []);
  assert.deepEqual(pendingNotifications({ ...input, tenantId: 'other' }), []);
  assert.deepEqual(pendingNotifications({ ...input, settings: { payment: { enabled: false } } }), []);
  assert.deepEqual(pendingNotifications({ ...input, appointments: [appointment('request', 'confirmed'), appointment('signal', 'pending_payment')] }), []);
});

test('a human reply stops the attention state without marking the alert read', () => {
  const item = { id: 'notice', phase: 'review', chat_id: '123', created_at: '2026-11-07T10:00:00Z', unread: true };
  const pending = inboxNotification(item, 'overdue');
  const answered = inboxNotification(item, 'answered');
  assert.equal(pending.pending, true);
  assert.equal(pending.overdue, true);
  assert.equal(answered.pending, false);
  assert.equal(answered.unread, true);
  assert.equal(inboxNotification({ ...item, resolved_at: item.created_at }, null).pending, false);
});

test('handoff notices follow the active waiting column and are scoped to an operator', () => {
  const chat = { id: 'chat', externalConversationId: '123', channelType: 'whatsapp', lastActivityAt: '2026-11-07T14:30:00Z' };
  const waiting = { ...input, kanbanColumns: [column('aguardando_humano', [chat])] };
  assert.equal(waitingConversationNotifications(waiting)[0].overdue, true);
  assert.deepEqual(waitingConversationNotifications({ ...waiting, role: 'viewer' }), []);
  assert.deepEqual(waitingConversationNotifications({ ...waiting, kanbanColumns: [column('com_humano', [chat])] }), []);
});

test('a new request is announced as awaiting confirmation', () => {
  const [notice] = operatorEvents({
    table: 'appointments', eventType: 'INSERT',
    new: { id: 'request', tenant_id: 'a', status: 'pending_confirmation' },
  }, input);
  assert.equal(notice.title, 'Pedido aguardando confirmação');
  assert.equal(notice.appointmentId, 'request');
});

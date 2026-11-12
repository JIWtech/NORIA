import test from 'node:test';
import assert from 'node:assert/strict';
import { appointmentReminders, operatorEvents, reconcileNotifications } from '../../src/features/notifications/operatorEvents.js';

const now = Date.parse('2026-11-12T20:00:00Z');
const item = (overrides) => ({ id: 'n1', tenantId: 't', kind: 'appointment', title: 'Novo agendamento', description: '', category: 'appointments', unread: true,
  createdAt: '2026-11-12T19:00:00Z', ...overrides });
const appt = (overrides) => ({ id: 'a1', status: 'confirmed', startsAt: '2026-11-13T13:00:00Z', ...overrides });
const run = (items, extra = {}) => reconcileNotifications(items, { appointments: [appt()], conversations: [], ready: true, now, ...extra });

test('aviso de agendamento excluído do banco some da lista', () => {
  assert.equal(run([item({ appointmentId: 'apagado' })]).length, 0);
  assert.equal(run([item({ appointmentId: 'a1' })]).length, 1);
});

test('aviso de agendamento que depois foi cancelado some, menos o próprio aviso de cancelamento', () => {
  const cancelled = [appt({ status: 'cancelled' })];
  assert.equal(run([item({ appointmentId: 'a1', appointmentStatus: 'confirmed' })], { appointments: cancelled }).length, 0);
  assert.equal(run([item({ appointmentId: 'a1', kind: 'reminder' })], { appointments: cancelled }).length, 0);
  assert.equal(run([item({ appointmentId: 'a1', kind: 'appointment-cancelled' })], { appointments: cancelled }).length, 1);
  assert.equal(run([item({ appointmentId: 'a1', appointmentStatus: 'cancelled', title: 'Agendamento cancelado' })], { appointments: cancelled }).length, 1);
});

test('lembrete de horário que mudou deixa de valer', () => {
  const [reminder] = appointmentReminders([{ id: 'a1', status: 'confirmed', startsAt: new Date(now + 10 * 60_000).toISOString(), contactName: 'Ana' }], 't', now);
  assert.equal(reminder.appointmentId, 'a1');
  assert.equal(run([reminder], { appointments: [appt({ startsAt: reminder.appointmentStartsAt, status: 'confirmed' })] }).length, 1);
  assert.equal(run([reminder], { appointments: [appt({ startsAt: '2026-11-14T10:00:00Z' })] }).length, 0);
});

test('sem agenda carregada nada é descartado por engano', () => {
  assert.equal(run([item({ appointmentId: 'qualquer' })], { appointments: [] }).length, 1);
  assert.equal(run([item({ appointmentId: 'qualquer' })], { ready: false }).length, 1);
});

test('aviso de evento de canal guarda o agendamento ligado a ele', () => {
  const row = { id: 'e1', tenant_id: 't', tenant_slug: 'e', service: 'appointment_cancelled', direction: 'outbound', sender_type: 'system',
    external_conversation_id: 'c1', raw_payload: { appointment_id: 'a9' } };
  const [notice] = operatorEvents({ table: 'channel_events', eventType: 'INSERT', new: row }, { tenantId: 't', tenantSlug: 'e', userId: 'u' });
  assert.equal(notice.appointmentId, 'a9');
});

test('mensagem de conversa que saiu do banco some depois da carência; mensagem recente fica', () => {
  const conversations = [{ id: 'conv-1', externalConversationId: 'c1', channelType: 'whatsapp' }];
  const message = (chatId, createdAt) => item({ id: 'm-' + chatId, kind: 'message', category: 'conversations', chatId, channel: 'whatsapp', createdAt });
  assert.equal(run([message('c1', '2026-11-12T10:00:00Z')], { conversations }).length, 1);
  assert.equal(run([message('apagada', '2026-11-12T10:00:00Z')], { conversations }).length, 0);
  assert.equal(run([message('nova', new Date(now - 30_000).toISOString())], { conversations }).length, 1, 'carência para a conversa ainda chegar');
  assert.equal(run([message('apagada', '2026-11-12T10:00:00Z')], { conversations: [] }).length, 1, 'sem conversas carregadas nada é descartado');
});

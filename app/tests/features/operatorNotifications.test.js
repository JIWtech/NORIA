import test from 'node:test';
import assert from 'node:assert/strict';
import { appointmentReminders, belongsToTenant, findNotificationConversation, followUpReminders, MAX_NOTIFICATIONS, mergeOperatorNotifications, notificationScope, operatorEvents, shouldPlayOperatorNotification } from '../../src/features/notifications/operatorEvents.js';
import { readOperatorNotifications } from '../../src/features/notifications/useOperatorNotifications.js';
import { playNotificationTone } from '../../src/features/notifications/useNotificationSound.js';
import { incidentPresentation } from '../../src/features/notifications/notificationService.js';

const scope = { tenantId: 'tenant-a', tenantSlug: 'empresa-a', userId: 'user-a' };
const event = (overrides = {}) => ({ table: 'channel_events', eventType: 'INSERT', new: { id: 'event-1', tenant_id: 'tenant-a', tenant_slug: 'empresa-a', direction: 'inbound', sender_type: 'contact', channel_type: 'whatsapp', external_conversation_id: '5511999990001', message_text: 'Quero conhecer as opções', created_at: '2026-10-20T10:00:00Z', ...overrides } });

test('tenant and user scopes are strict, including conflicting row identifiers', () => {
  assert.notEqual(notificationScope('a', 'one'), notificationScope('a', 'two'));
  assert.notEqual(notificationScope('a', 'one'), notificationScope('b', 'one'));
  assert.equal(notificationScope('a', null), null);
  assert.equal(belongsToTenant({ tenant_id: 'tenant-a', tenant_slug: 'other' }, 'tenant-a', 'empresa-a'), false);
  assert.deepEqual(operatorEvents(event({ tenant_id: 'tenant-b' }), scope), []);
  assert.deepEqual(operatorEvents({ ...event(), eventType: 'DELETE' }, scope), []);
});

test('new messages have useful media labels; reactions, internal events and metadata updates are silent', () => {
  const message = operatorEvents(event({ message_text: '[image]', raw_payload: { media: { kind: 'image', fileName: 'veiculo-catalogo.jpg' } } }), scope)[0];
  assert.equal(message.title, 'Nova mensagem de cliente');
  assert.doesNotMatch(message.description, /\.jpg|\[image\]/);
  for (const row of [{ message_text: '[reaction]' }, { service: 'reaction' }, { sender_type: 'system' }, { is_internal: true }]) assert.deepEqual(operatorEvents(event(row), scope), []);
  assert.deepEqual(operatorEvents({ ...event(), eventType: 'UPDATE', old: event().new }, scope), []);
});

for (const service of ['conversation_assigned', 'handoff_requested', 'atendimento_humano', 'resume_ai', 'conversation_closed', 'conversation_reopened', 'sales_interest', 'payment_reported', 'pagamento_sinal', 'appointment_created', 'appointment_payment_confirmed', 'appointment_cancelled', 'follow_up', 'technical_error', 'kanban_stage_changed', 'sales_stage_changed']) {
  test(`operator receives a friendly ${service} notice`, () => {
    const items = operatorEvents(event({ direction: 'outbound', service, raw_payload: { error_code: 'SECRET_PROVIDER_ERROR', assignee: { name: 'Wesley' } }, stage: 'sales_financing' }), scope);
    assert.equal(items.length, 1);
    assert.doesNotMatch(items[0].title + items[0].description, /SECRET_PROVIDER_ERROR|sales_financing|ticket|reconcilia|raw_payload/);
  });
}

test('delivery and attachment errors notify once per state without showing internal errors', () => {
  const payload = event({ direction: 'outbound', delivery_status: 'uncertain', raw_payload: { media: { status: 'download_failed' }, error: 'provider secret' } });
  const items = operatorEvents(payload, scope);
  assert.deepEqual(items.map(item => item.kind), ['delivery', 'attachment']);
  assert.doesNotMatch(JSON.stringify(items), /provider secret/);
  assert.deepEqual(operatorEvents({ ...payload, old: payload.new }, scope), []);
});

for (const stage of ['sales_human', 'sales_hot', 'sales_financing', 'sales_appraisal', 'sales_closed', 'sales_qualifying']) {
  test(`lead transition ${stage} links to the customer and uses a readable stage`, () => {
    const items = operatorEvents({ table: 'sales_leads', eventType: 'UPDATE', new: { id: 'lead-1', tenant_id: 'tenant-a', chat_id: '5511999990001', stage_key: stage, ai_locked: stage === 'sales_human', revision: 5 }, old: { stage_key: 'sales_new', ai_locked: false } }, scope);
    assert.equal(items.length, 1);
    assert.equal(items[0].chatId, '5511999990001');
    assert.equal(items[0].category, 'leads');
    assert.doesNotMatch(items[0].description, /sales_/);
  });
}

test('new leads and hot interest are covered without treating every update as a new lead', () => {
  const row = { id: 'lead-1', tenant_id: 'tenant-a', stage_key: 'sales_qualifying', hot: true, revision: 5 };
  assert.equal(operatorEvents({ table: 'sales_leads', eventType: 'INSERT', new: row }, scope)[0].kind, 'lead');
  assert.equal(operatorEvents({ table: 'sales_leads', eventType: 'UPDATE', new: row, old: { ...row, hot: false } }, scope)[0].kind, 'hot-lead');
  assert.deepEqual(operatorEvents({ table: 'sales_leads', eventType: 'UPDATE', new: row, old: row }, scope), []);
});

for (const status of ['scheduled', 'confirmed', 'cancelled', 'done', 'pending_payment', 'payment_reported', 'aguardando_verificacao']) {
  test(`appointment status ${status} produces a readable notice`, () => {
    const items = operatorEvents({ table: 'appointments', eventType: 'UPDATE', new: { id: 'appointment-1', tenant_id: 'tenant-a', starts_at: '2026-10-20T15:00:00Z', status }, old: { status: 'previous' } }, scope);
    assert.equal(items.length, 1);
    assert.equal(items[0].category, 'appointments');
    assert.doesNotMatch(items[0].title, /scheduled|payment_reported|aguardando_verificacao/);
  });
}

for (const status of ['sent', 'partial_error', 'failed', 'paused', 'cancelled']) {
  test(`campaign status ${status} notifies the team`, () => {
    const payload = { table: 'broadcast_campaigns', eventType: 'UPDATE', new: { id: 'campaign-1', tenant_id: 'tenant-a', status }, old: { status: 'sending' } };
    assert.equal(operatorEvents(payload, scope)[0].category, 'campaigns');
    assert.deepEqual(operatorEvents({ ...payload, old: payload.new }, scope), []);
  });
}

test('appointment reminders apply only in the next 15 minutes and deduplicate across timer ticks', () => {
  const now = Date.parse('2026-10-20T15:00:00Z');
  const appointment = { id: 'appointment-1', status: 'confirmed', startsAt: '2026-10-20T15:10:00Z' };
  const first = appointmentReminders([appointment], 'tenant-a', now);
  assert.equal(first.length, 1);
  assert.equal(mergeOperatorNotifications(first, appointmentReminders([appointment], 'tenant-a', now + 60_000)).length, 1);
  assert.equal(appointmentReminders([{ ...appointment, status: 'cancelled' }], 'tenant-a', now).length, 0);
  assert.equal(appointmentReminders([appointment], 'tenant-a', now + 20 * 60_000).length, 0);
});

test('follow-up due alerts ignore processing, future and old jobs', () => {
  const now = Date.parse('2026-10-20T15:00:00Z');
  const card = { id: 'followup-1', isFollowUp: true, followUpStatus: 'pending', followUpDueAt: '2026-10-20T14:00:00Z' };
  assert.equal(followUpReminders([{ cards: [card] }], 'tenant-a', now).length, 1);
  assert.equal(followUpReminders([{ cards: [{ ...card, followUpStatus: 'processing' }] }], 'tenant-a', now).length, 0);
});

test('replayed events preserve read state and the retained inbox stays bounded', () => {
  const item = operatorEvents(event(), scope)[0];
  assert.equal(mergeOperatorNotifications([{ ...item, unread: false }], [item])[0].unread, false);
  const many = Array.from({ length: MAX_NOTIFICATIONS + 30 }, (_, i) => ({ ...item, id: `event-${i}`, createdAt: new Date(i * 1000).toISOString() }));
  assert.equal(mergeOperatorNotifications([], many).length, MAX_NOTIFICATIONS);
  assert.equal(readOperatorNotifications({ getItem: () => JSON.stringify([item, { ...item, tenantId: 'tenant-b' }]) }, 'key', 'tenant-a').length, 1);
  assert.deepEqual(readOperatorNotifications({ getItem: () => 'invalid json' }, 'key', 'tenant-a'), []);
});

test('notification action resolves equivalent phone IDs but never mixes LID and phone identities', () => {
  const conversations = [{ id: 'conv-1', channelType: 'whatsapp', externalConversationId: '5511999990001@s.whatsapp.net' }];
  assert.equal(findNotificationConversation({ channel: 'whatsapp', chatId: '5511999990001' }, conversations)?.id, 'conv-1');
  assert.equal(findNotificationConversation({ channel: 'whatsapp', chatId: '5511999990001@lid' }, conversations), null);
});

test('mensagem do chat visível é registrada sem tocar, inclusive com JID equivalente', () => {
  const [message] = operatorEvents(event(), scope);
  const [messageFromHandle] = operatorEvents(event({ external_conversation_id: null, contact_handle: '5511999990001' }), scope);
  const visibleKey = 'empresa-a:whatsapp::5511999990001@s.whatsapp.net';
  assert.equal(shouldPlayOperatorNotification(message, scope.tenantSlug, visibleKey), false);
  assert.equal(shouldPlayOperatorNotification(messageFromHandle, scope.tenantSlug, visibleKey), false);
  assert.equal(mergeOperatorNotifications([], [message])[0].id, message.id);
});

test('som continua disponível para outro chat, aba oculta e avisos operacionais', () => {
  const [message] = operatorEvents(event(), scope);
  const visibleKey = 'empresa-a:whatsapp::5511999990001@s.whatsapp.net';
  for (const key of ['', 'empresa-a:whatsapp::5511999990002@s.whatsapp.net',
    'empresa-a:whatsapp::5511999990001@lid', 'empresa-a:telegram::5511999990001',
    'empresa-b:whatsapp::5511999990001@s.whatsapp.net']) {
    assert.equal(shouldPlayOperatorNotification(message, scope.tenantSlug, key), true);
  }
  assert.equal(shouldPlayOperatorNotification({ ...message, chatId: '' }, scope.tenantSlug, visibleKey), true);
  assert.equal(shouldPlayOperatorNotification({ ...message, kind: 'attachment' }, scope.tenantSlug, visibleKey), true);
});

test('notification tone requires an unlocked context and uses a short two-note envelope', () => {
  assert.equal(playNotificationTone({ state: 'suspended' }), false);
  const starts = [], stops = [], peaks = [];
  const context = { state: 'running', currentTime: 0, destination: {},
    createOscillator: () => ({ frequency: {}, connect() {}, disconnect() {}, start: t => starts.push(t), stop: t => stops.push(t) }),
    createGain: () => ({ connect() {}, disconnect() {}, gain: { setValueAtTime() {}, linearRampToValueAtTime: value => peaks.push(value), exponentialRampToValueAtTime() {} } }),
  };
  assert.equal(playNotificationTone(context), true);
  assert.deepEqual(starts, [0, 0.13]);
  assert.equal(Math.max(...stops) < 0.5, true);
  assert.equal(Math.max(...peaks) <= 0.1, true);
});

test('backend incident notices avoid technical language', () => {
  for (const item of [{ phase: 'review' }, { phase: 'uncertain' }, { resolved_at: '2026-10-20' }]) {
    const info = incidentPresentation(item);
    assert.doesNotMatch(info.title + info.description, /ticket|reconcilia|backend|revisão|incidente/i);
  }
});

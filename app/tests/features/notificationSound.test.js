import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { notificationMakesSound, operatorEvents, shouldPlayOperatorNotification } from '../../src/features/notifications/operatorEvents.js';
import { inboxNotification } from '../../src/features/notifications/notificationPending.js';

const scope = { tenantId: 'tenant-a', tenantSlug: 'empresa-a', userId: 'user-a' };
const channelEvent = (row) => ({ table: 'channel_events', eventType: 'INSERT', new: { id: 'e1', tenant_id: 'tenant-a', tenant_slug: 'empresa-a',
  channel_type: 'whatsapp', external_conversation_id: '5511999990000@s.whatsapp.net', created_at: '2026-11-12T16:19:00Z', ...row } });

test('evento informativo do sistema (atendimento encerrado, IA retomou) não toca som', () => {
  for (const service of ['conversation_closed', 'resume_ai', 'follow_up', 'appointment_payment_confirmed']) {
    const [item] = operatorEvents(channelEvent({ service, direction: 'outbound', sender_type: 'system' }), scope);
    assert.ok(item, service);
    assert.equal(notificationMakesSound(item), false, service);
    assert.equal(shouldPlayOperatorNotification(item, 'empresa-a', ''), false, service);
  }
});

test('mensagem de cliente e avisos que pedem ação continuam tocando', () => {
  const message = operatorEvents(channelEvent({ direction: 'inbound', sender_type: 'contact', message_text: 'oie' }), scope)[0];
  assert.equal(shouldPlayOperatorNotification(message, 'empresa-a', ''), true);
  for (const service of ['handoff_requested', 'conversation_assigned', 'appointment_created', 'appointment_cancelled', 'payment_reported']) {
    const [item] = operatorEvents(channelEvent({ service, direction: 'outbound', sender_type: 'system' }), scope);
    assert.equal(shouldPlayOperatorNotification(item, 'empresa-a', ''), true, service);
  }
});

test('aviso remoto de pendência resolvida ou já respondida não toca; o que aguarda a equipe toca', () => {
  const base = { id: 'i1', chat_id: 'c1', channel_type: 'whatsapp', unread: true, created_at: '2026-11-12T16:19:00Z', updated_at: '2026-11-12T16:19:00Z' };
  assert.equal(notificationMakesSound(inboxNotification({ ...base, resolved_at: '2026-11-12T16:20:00Z' }, null)), false);
  assert.equal(notificationMakesSound(inboxNotification(base, 'answered')), false);
  assert.equal(notificationMakesSound(inboxNotification(base, 'waiting')), true);
  assert.equal(notificationMakesSound(inboxNotification(base, 'overdue')), true);
});

test('o painel mostra a foto do cliente com um selo do tipo do aviso', () => {
  const panel = fs.readFileSync(new URL('../../src/features/notifications/NotificationPanel.jsx', import.meta.url), 'utf8');
  assert.match(panel, /<ContactAvatar name=\{contact \|\| conversation\?\.contact\} avatarUrl=\{conversation\?\.avatarUrl\}/);
  assert.match(panel, /notification-entry-badge/);
  assert.match(panel, /notification-entry-icon/, 'avisos sem cliente (conexão, campanha) mantêm o ícone quadrado');
});

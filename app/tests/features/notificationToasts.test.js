import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { groupToasts, MAX_VISIBLE_TOASTS } from '../../src/features/notifications/toastGroups.js';
import { operatorEvents, shouldPlayOperatorNotification } from '../../src/features/notifications/operatorEvents.js';

const message = (id, chatId, createdAt, description = 'oi') => ({ id, kind: 'message', chatId, channel: 'whatsapp', createdAt, description });

test('várias mensagens da mesma conversa viram um pop-up com contador; a mais recente aparece primeiro', () => {
  const groups = groupToasts([message('1', 'a', '2026-11-12T10:00:00Z'), message('2', 'b', '2026-11-12T10:01:00Z'), message('3', 'a', '2026-11-12T10:02:00Z', 'tudo bem?')]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].key, 'whatsapp:a');
  assert.equal(groups[0].items.length, 2);
  assert.equal(groups[0].latest.description, 'tudo bem?');
  assert.ok(MAX_VISIBLE_TOASTS >= 1);
});

test('só mensagem de cliente que também tocaria som vira pop-up; a conversa aberta na tela não', () => {
  const scope = { tenantId: 't', tenantSlug: 'e', userId: 'u' };
  const row = (extra) => ({ table: 'channel_events', eventType: 'INSERT', new: { id: 'e1', tenant_id: 't', tenant_slug: 'e', channel_type: 'whatsapp',
    external_conversation_id: '5511999990000@s.whatsapp.net', created_at: new Date().toISOString(), direction: 'inbound', sender_type: 'contact', message_text: 'oie', ...extra } });
  const [incoming] = operatorEvents(row(), scope);
  assert.equal(incoming.kind, 'message');
  assert.equal(shouldPlayOperatorNotification(incoming, 'e', ''), true);
  assert.equal(shouldPlayOperatorNotification(incoming, 'e', 'e:whatsapp::5511999990000@s.whatsapp.net'), false);
  const [closed] = operatorEvents(row({ service: 'conversation_closed', direction: 'outbound', sender_type: 'system' }), scope);
  assert.notEqual(closed.kind, 'message');
});

test('o centro de notificações monta o pop-up e a fila é limpa ao abrir ou dispensar', () => {
  const center = fs.readFileSync(new URL('../../src/features/notifications/NotificationCenter.jsx', import.meta.url), 'utf8');
  assert.match(center, /<NotificationToasts toasts=\{activity\.toasts\}/);
  assert.match(center, /activity\.dismissToasts\(group\.items\.map/);
  const hook = fs.readFileSync(new URL('../../src/features/notifications/useOperatorNotifications.js', import.meta.url), 'utf8');
  assert.match(hook, /item\.kind === 'message' && shouldPlayOperatorNotification/);
});

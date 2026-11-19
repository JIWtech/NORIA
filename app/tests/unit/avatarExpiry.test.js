import test from 'node:test';
import assert from 'node:assert/strict';
import { avatarUrlExpired } from '../../src/services/contacts/contactIdentity.js';
import { extractPayloadAvatar } from '../../src/services/contacts/contactPayload.js';
import { eventsToConversations } from '../../src/services/conversations/eventsToConversations.js';

const hex = date => Math.floor(date / 1000).toString(16).toUpperCase();
const url = (name, expiresAt) => `https://pps.whatsapp.net/v/t61/${name}.jpg?ccb=11-4&oh=x&oe=${hex(expiresAt)}&_nc_sid=5e03e0`;
const past = Date.now() - 86_400_000;
const future = Date.now() + 5 * 86_400_000;

test('link do WhatsApp com oe vencido conta como expirado; sem oe, não', () => {
  assert.equal(avatarUrlExpired(url('a', past)), true);
  assert.equal(avatarUrlExpired(url('a', future)), false);
  assert.equal(avatarUrlExpired('https://cdn.exemplo.com/foto.jpg'), false);
  assert.equal(avatarUrlExpired(null), false);
});

test('avatar vencido do payload da mensagem é ignorado', () => {
  assert.equal(extractPayloadAvatar({ raw_payload: { profilePictureUrl: url('old', past) } }), null);
  assert.equal(extractPayloadAvatar({ raw_payload: { profilePictureUrl: url('ok', future) } }), url('ok', future));
});

test('a conversa usa a foto atual do cadastro do contato, não a foto antiga e vencida do payload', () => {
  const base = { tenant_id: 't1', channel_type: 'whatsapp', external_conversation_id: '5521999998888@s.whatsapp.net', direction: 'inbound', message_text: 'oi' };
  const events = [
    { ...base, id: 'e1', created_at: '2026-11-01T10:00:00Z', raw_payload: { profilePictureUrl: url('old', past) }, avatar_url: url('contact', future) },
    { ...base, id: 'e2', created_at: '2026-11-02T10:00:00Z', raw_payload: {}, avatar_url: url('contact', future) },
  ];
  const [conversation] = eventsToConversations(events, 't1');
  assert.equal(conversation.avatarUrl, url('contact', future));
});

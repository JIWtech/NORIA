import test from 'node:test';
import assert from 'node:assert/strict';
import { extractAvatarUrlFromEvent, extractPayloadAvatar } from '../../src/dataService.js';

test('contact payload avatars: a foto do cadastro (avatar_url) vence a do payload; valores inválidos são ignorados', () => {
  const event = { avatar_url: 'https://cdn.example.com/event.png', raw_payload: { contact_avatar: { avatarUrl: 'https://cdn.example.com/payload.png' } } };
  assert.equal(extractPayloadAvatar(event), 'https://cdn.example.com/payload.png');
  assert.equal(extractAvatarUrlFromEvent(event), 'https://cdn.example.com/event.png');
  assert.equal(extractAvatarUrlFromEvent({ raw_payload: { contact_avatar: { avatarUrl: 'https://cdn.example.com/payload.png' } } }), 'https://cdn.example.com/payload.png');
  assert.equal(extractAvatarUrlFromEvent({ avatar_url: 'https://cdn.example.com/event.png', raw_payload: { avatar_url: 'http://invalid.example.com/p.png' } }), 'https://cdn.example.com/event.png');
  assert.equal(extractPayloadAvatar({ raw_payload: null }), null);
  assert.equal(extractAvatarUrlFromEvent(null), null);
});

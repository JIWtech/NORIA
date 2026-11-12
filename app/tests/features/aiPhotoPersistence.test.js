import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { eventsToConversations } from '../../src/services/conversations/eventsToConversations.js';
import { eventsToKanban } from '../../src/services/kanban/eventsToKanban.js';

test('catalog photo event persists the sent image and renders in the conversation', async () => {
  const source = fs.readFileSync(new URL('../../../n8n/sources/noria_core.js', import.meta.url), 'utf8');
  const start = source.indexOf("const storedImage = await supabasePost('/rest/v1/channel_events', {");
  const end = source.indexOf('photoEvent = Array.isArray(', start);
  assert.ok(start >= 0 && end > start);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  let saved;
  const run = new AsyncFunction('supabasePost', 'context', 'tenantSlug', 'chatId', 'imageId', 'turn', 'firstName', 'event', 'catalogPhoto', 'photoCount', 'strictPhotos', 'photoReceipt', 'deliveryAttemptId', 'sentEvent', 'url', 'mediaOnly', source.slice(start, end));
  await run(async (_, row) => { saved = { id: 'photo-event', ...row }; return [saved]; },
    { tenant: { id: 'tenant-1' } }, 'photo_test', '5511999990001', 'provider-photo',
    { messages: [{ name: 'Cliente' }], boundary_id: 'session-1' }, 'Cliente', { stage: 'Qualificação' },
    { product_id: 'car-1', caption: 'Fotos do veículo' }, 1, false, null, 'attempt-1', { id: 'reply-1' }, 'https://cdn.example.test/car.jpg', false);
  assert.equal(saved.raw_payload.media.url, 'https://cdn.example.test/car.jpg');
  const conversations = eventsToConversations([saved], 'photo_test');
  assert.equal(conversations[0].messages[0].media.url, 'https://cdn.example.test/car.jpg');
  assert.equal(conversations[0].messages[0].media.caption, 'Fotos do veículo');
  assert.equal(conversations[0].messages[0].from, 'ai');
  const cards = eventsToKanban([saved], 'photo_test').flatMap(column => column.cards);
  assert.equal(cards[0].subtitle, 'Fotos do veículo');
  const noCaption = { ...saved, raw_payload: { ...saved.raw_payload, media: { ...saved.raw_payload.media, caption: '' } } };
  assert.equal(eventsToKanban([noCaption], 'photo_test').flatMap(column => column.cards)[0].subtitle, 'Imagem');
});

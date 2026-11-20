import test from 'node:test';
import assert from 'node:assert/strict';
import { isInternalOperationalEvent, isEligibleForExternalOutbound } from '../../src/services/timeline/eventClassification.js';
import { eventsToConversations } from '../../src/services/conversations/eventsToConversations.js';
import { applyIncomingEventToConversations } from '../../src/services/conversations/applyIncomingEvent.js';
import { isSystemTimelineMessage, isHiddenTimelineSystemEvent, describeSystemEvent } from '../../src/features/conversations/utils/chatTimelineHelpers.js';
import { operatorEvents } from '../../src/features/notifications/operatorEvents.js';
import { applyIncomingEventToKanban } from '../../src/services/kanban/applyIncomingEvent.js';
import { eventsToKanban } from '../../src/services/kanban/eventsToKanban.js';

const base = { tenant_slug: 'tenant-a', tenant_id: 't1', channel_type: 'whatsapp', external_conversation_id: '5511999999999', contact_handle: '5511999999999', created_at: '2026-01-01T12:00:00Z', handoff: false };
const inbound = { ...base, id: 'in', direction: 'inbound', sender_type: 'customer', message_text: 'Olá', stage: 'sales_new' };
const notice = (status) => ({ ...base, id: 'notice', direction: 'outbound', sender_type: 'system', service: 'specialist_notice', ai_provider: 'retail_specialist_notice', raw_payload: { status } });

test('tentativas internas não aparecem, não geram notificação e não são enviáveis', () => {
  for (const service of ['specialist_notice_attempt', 'retail_product_photo_attempt']) {
    const event = { ...base, id: service, direction: 'outbound', sender_type: 'system', delivery_status: 'internal', service, raw_payload: { kanban_transition: { to_column: 'sales_human' } } };
    assert.equal(isInternalOperationalEvent(event), true);
    assert.equal(isEligibleForExternalOutbound(event), false);
    assert.equal(eventsToConversations([event], 'tenant-a').length, 0);
    const initial = eventsToConversations([inbound], 'tenant-a');
    assert.deepEqual(applyIncomingEventToConversations(initial, event, 'tenant-a'), initial);
    const columns = [{ id: 'sales_new', cards: [] }];
    assert.deepEqual(applyIncomingEventToKanban(columns, event, 'tenant-a'), columns);
    assert.deepEqual(eventsToKanban([inbound, event], 'tenant-a'), eventsToKanban([inbound], 'tenant-a'));
    assert.deepEqual(operatorEvents({ table: 'channel_events', eventType: 'INSERT', new: event }, { tenantId: 't1', tenantSlug: 'tenant-a' }), []);
  }
});

test('aviso ao especialista é evento de sistema com rótulo por resultado e sem envio externo', () => {
  for (const [status, title] of [['sent', 'Especialista avisado(a) por WhatsApp'], ['failed', 'Falha ao avisar o(a) especialista'], ['unknown', 'Aviso ao especialista incerto — conferir antes de reenviar']]) {
    const event = notice(status);
    assert.equal(isEligibleForExternalOutbound(event), false);
    const [conversation] = eventsToConversations([inbound, event], 'tenant-a');
    const message = conversation.messages.find(item => item.eventId === event.id);
    assert.equal(isSystemTimelineMessage(message), true);
    assert.equal(isHiddenTimelineSystemEvent(message), false);
    assert.equal(describeSystemEvent(message).title, title);
    const [realtime] = applyIncomingEventToConversations(eventsToConversations([inbound], 'tenant-a'), event, 'tenant-a');
    assert.equal(describeSystemEvent(realtime.messages.find(item => item.eventId === event.id)).title, title);
    assert.deepEqual(operatorEvents({ table: 'channel_events', eventType: 'INSERT', new: event }, { tenantId: 't1', tenantSlug: 'tenant-a' }), []);
  }
});

test('aviso preserva estado existente e não contamina quando aparece primeiro', () => {
  const initial = eventsToConversations([inbound], 'tenant-a');
  Object.assign(initial[0], { owner: 'Ana', ownerId: 'a1', ownerKind: 'agent', stage: 'Atendimento humano', status: 'atendimento_humano', handoff: true, unread: 3 });
  const event = { ...notice('sent'), stage: 'sales_closed', raw_payload: { status: 'sent', assigned_to: 'Outra' } };
  const [after] = applyIncomingEventToConversations(initial, event, 'tenant-a');
  for (const field of ['owner', 'ownerId', 'ownerKind', 'stage', 'status', 'handoff', 'unread']) assert.equal(after[field], initial[0][field], field);
  const [first] = eventsToConversations([{ ...event, created_at: '2025-01-01T00:00:00Z' }, inbound], 'tenant-a');
  const [baseline] = eventsToConversations([inbound], 'tenant-a');
  for (const field of ['owner', 'ownerId', 'stage', 'status', 'handoff', 'unread']) assert.equal(first[field], baseline[field], field);
  const [aiAfter] = applyIncomingEventToConversations([baseline], event, 'tenant-a');
  assert.equal(aiAfter.status, baseline.status);
  assert.equal(aiAfter.handoff, baseline.handoff);
  assert.equal(aiAfter.ownerKind, baseline.ownerKind);
  assert.deepEqual(eventsToKanban([inbound, event], 'tenant-a'), eventsToKanban([inbound], 'tenant-a'));
});

test('foto de produto e imagem comum usam mídia da IA', () => {
  const photo = { ...base, id: 'photo', direction: 'outbound', sender_type: 'assistant', service: 'retail_product_photo', raw_payload: { media: { kind: 'image', url: 'https://example.com/foto.jpg', mimeType: 'image/jpeg', fileName: 'foto.jpg', caption: 'Foto' } } };
  const [conversation] = eventsToConversations([inbound, photo], 'tenant-a');
  const message = conversation.messages.find(item => item.eventId === 'photo');
  assert.equal(message.from, 'ai');
  assert.equal(message.media.kind, 'image');
  assert.equal(message.media.url, photo.raw_payload.media.url);
  assert.equal(message.media.mimeType, 'image/jpeg');
  assert.equal(message.media.fileName, 'foto.jpg');
  assert.equal(message.media.caption, 'Foto');
  const [live] = applyIncomingEventToConversations(eventsToConversations([inbound], 'tenant-a'), photo, 'tenant-a');
  assert.deepEqual(live.messages.find(item => item.eventId === 'photo').media, message.media);
  assert.equal(isEligibleForExternalOutbound(photo), true);
  const ordinary = { ...photo, id: 'ordinary', service: 'bot_reply', raw_payload: { media: { ...photo.raw_payload.media, origin: 'assistant' } } };
  assert.equal(eventsToConversations([inbound, ordinary], 'tenant-a')[0].messages.find(item => item.eventId === 'ordinary').media.url, photo.raw_payload.media.url);
});

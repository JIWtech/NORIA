import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsToKanban } from '../../src/services/kanban/eventsToKanban.js';
import { eventsToConversations } from '../../src/services/conversations/eventsToConversations.js';
import { applyIncomingEventToConversations } from '../../src/services/conversations/applyIncomingEvent.js';
import { matchesCardConversation } from '../../src/app/hooks/useKanbanMutations.js';
import { matchesConversationCard } from '../../src/app/hooks/useAgentAssignment.js';
import { mapAppointment } from '../../src/services/appointments/appointmentPresentation.js';

const baseColumns = [
  { id: 'novas_conversas', title: 'Novas conversas', automationKey: 'novas_conversas', position: 0 },
  { id: 'conversas_ia', title: 'Conversas IA', automationKey: 'conversas_ia', position: 1 },
  { id: 'agendamentos', title: 'Agendamentos', automationKey: 'agendamentos', position: 2 },
  { id: 'confirmar_agendamento', title: 'Confirmar agendamento', automationKey: 'confirmar_agendamento', position: 3 },
];

test('C4: eventsToKanban e eventsToConversations geram a mesma canonicalKey com tenantSlug e fallback contact_handle/id', () => {
  const events = [
    {
      id: 'evt-1',
      tenant_slug: 'tenant_alpha',
      channel_type: 'whatsapp',
      external_conversation_id: '5511999990000@s.whatsapp.net',
      contact_name: 'Ana',
      message_text: 'Oi',
      direction: 'inbound',
      sender_type: 'contact',
      created_at: '2026-11-20T10:00:00Z',
    },
    {
      id: 'evt-handle-only',
      tenant_slug: 'tenant_alpha',
      channel_type: 'instagram',
      external_conversation_id: '',
      contact_handle: 'ana_insta',
      contact_name: 'Ana Insta',
      message_text: 'Olá',
      direction: 'inbound',
      sender_type: 'contact',
      created_at: '2026-11-20T10:05:00Z',
    },
  ];

  const columns = eventsToKanban(events, 'tenant_alpha', [], { columns: baseColumns });
  const conversations = eventsToConversations(events, 'tenant_alpha', [], columns);
  const cards = columns.flatMap((c) => c.cards);

  assert.equal(cards.length, 2);
  assert.equal(conversations.length, 2);
  for (const conv of conversations) {
    const card = cards.find((c) => c.canonicalKey === conv.canonicalKey);
    assert.ok(card, `Card do Kanban deveria casar com canonicalKey ${conv.canonicalKey}`);
    assert.ok(card.canonicalKey.startsWith('tenant_alpha:'));
  }
});

test('C4: eventsToKanban casa agendamentos, propostas e salesLeads usando tenantSlug na canonicalConversationKey', () => {
  const appointment = mapAppointment({
    id: 'apt-1',
    title: 'Avaliação',
    starts_at: '2026-12-20T14:00:00Z',
    status: 'pending_confirmation',
    contact_name: 'Carla',
    channel_type: 'whatsapp',
    external_conversation_id: '5511988887777@s.whatsapp.net',
    metadata: { services: ['Avaliação'] },
  });
  const event = {
    id: 'evt-2',
    tenant_slug: 'ic_salon',
    channel_type: 'whatsapp',
    external_conversation_id: '5511988887777@s.whatsapp.net',
    contact_name: 'Carla',
    message_text: 'Quero agendar',
    direction: 'inbound',
    sender_type: 'contact',
    created_at: '2026-11-20T10:00:00Z',
  };

  const columns = eventsToKanban([event], 'ic_salon', [appointment], { columns: baseColumns });
  const confirmCol = columns.find((c) => c.id === 'confirmar_agendamento');
  assert.equal(confirmCol.cards.length, 1);
  assert.equal(confirmCol.cards[0].appointmentId, 'apt-1');

  // Lead comercial no tenant wesley_automoveis também casa com evento pelo tenantSlug.
  const genesisColumns = [
    { id: 'sales_new', title: 'Novos', automationKey: 'sales_new', position: 0 },
    { id: 'sales_hot', title: 'Quentes', automationKey: 'sales_hot', position: 1 },
  ];
  const leadCols = eventsToKanban(
    [{
      id: 'evt-g1',
      tenant_slug: 'wesley_automoveis',
      channel_type: 'whatsapp',
      external_conversation_id: '5511977776666@s.whatsapp.net',
      contact_name: 'João',
      message_text: 'Tenho interesse',
      direction: 'inbound',
      sender_type: 'contact',
      created_at: '2026-11-20T10:00:00Z',
    }],
    'wesley_automoveis',
    [],
    { columns: genesisColumns },
    [],
    [{
      id: 'lead-1',
      channel_type: 'whatsapp',
      chat_id: '5511977776666@s.whatsapp.net',
      stage_key: 'sales_hot',
      hot: true,
      updated_at: '2026-11-20T10:01:00Z',
    }],
  );
  const hotCol = leadCols.find((c) => c.id === 'sales_hot');
  assert.equal(hotCol.cards.length, 1);
  assert.equal(hotCol.cards[0].salesLeadId, 'lead-1');
  assert.equal(hotCol.cards[0].canonicalKey, 'wesley_automoveis:whatsapp::5511977776666@s.whatsapp.net');
});

test('C4: fallback por externalConversationId exige o mesmo channelType em applyIncomingEvent, useKanbanMutations e useAgentAssignment', () => {
  const existingWhatsappConv = {
    id: 'conv-tenant_a:whatsapp::99999',
    canonicalKey: 'tenant_a:whatsapp::99999',
    tenantSlug: 'tenant_a',
    channelType: 'whatsapp',
    channel: 'WhatsApp',
    normalizedExternalId: '99999',
    externalConversationId: '99999',
    contactHandle: 'handle99',
    company: '@handle99',
    contact: 'Cliente WA',
    messages: [],
    tags: [],
    events: [],
    value: 0,
  };

  const incomingTelegramEvent = {
    id: 'evt-tg-1',
    tenant_slug: 'tenant_a',
    channel_type: 'telegram',
    external_conversation_id: '99999',
    contact_handle: 'handle99',
    contact_name: 'Cliente TG',
    message_text: 'Oi pelo Telegram',
    direction: 'inbound',
    sender_type: 'contact',
    created_at: '2026-11-21T12:00:00Z',
  };

  const nextConvs = applyIncomingEventToConversations([existingWhatsappConv], incomingTelegramEvent, 'tenant_a');
  assert.equal(nextConvs.length, 2, 'Evento do Telegram não pode mesclar na conversa do WhatsApp com mesmo externalConversationId');

  const tgCard = {
    id: 'card-tg-1',
    canonicalKey: 'tenant_a:telegram::99999',
    channelType: 'telegram',
    normalizedExternalId: '99999',
    externalConversationId: '99999',
  };
  const waCard = {
    id: 'card-wa-1',
    canonicalKey: 'tenant_a:whatsapp::99999',
    channelType: 'whatsapp',
    normalizedExternalId: '99999',
    externalConversationId: '99999',
  };

  assert.equal(matchesCardConversation(existingWhatsappConv, tgCard), false);
  assert.equal(matchesCardConversation(existingWhatsappConv, waCard), true);

  assert.equal(matchesConversationCard(tgCard, existingWhatsappConv), false);
  assert.equal(matchesConversationCard(waCard, existingWhatsappConv), true);
});

test('C4: identificadores ausentes e tenants distintos não identificam a mesma conversa', () => {
  assert.equal(matchesCardConversation({ channelType: 'whatsapp' }, { channelType: 'telegram' }), false);
  const conv = { tenantSlug: 'tenant_a', channelType: 'whatsapp', externalConversationId: '123' };
  const card = { tenantSlug: 'tenant_b', channelType: 'whatsapp', externalConversationId: '123' };
  assert.equal(matchesCardConversation(conv, card), false);
  assert.equal(matchesConversationCard(card, conv), false);
});

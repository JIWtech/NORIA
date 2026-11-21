import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsToConversations } from '../../src/services/conversations/eventsToConversations.js';
import { getStageLabel } from '../../src/services/kanban/stageResolution.js';
import { applyIncomingEventToConversations } from '../../src/services/conversations/applyIncomingEvent.js';
import { canonicalConversationKey, normalizeExternalConversationId } from '../../src/services/identity/conversationIdentity.js';

test('SINCRONIA KANBAN A: conversa herda a etapa da coluna do Kanban em tenant generico/legado sem sales_lead', () => {
  const events = [
    {
      id: 'evt-1',
      channel_type: 'whatsapp',
      external_conversation_id: '5511999999999',
      stage: 'Qualificacao',
      message_text: 'Olá, gostaria de informações',
      direction: 'inbound',
      created_at: '2026-10-10T10:00:00Z',
    },
  ];

  const canonicalKey = canonicalConversationKey('whatsapp', '5511999999999', 'evt-1', 'clinica_nubia');
  const kanbanColumns = [
    {
      id: 'col-agendamentos',
      automationKey: 'agendamentos',
      title: 'Agendamentos',
      cards: [
        {
          id: 'card-evt-1',
          canonicalKey,
          externalConversationId: '5511999999999',
          normalizedExternalId: normalizeExternalConversationId('whatsapp', '5511999999999'),
          targetColumnId: 'agendamentos',
          stage: 'Agendamentos',
          owner: 'Assistente IA',
          ownerKind: 'ai',
        },
      ],
    },
  ];

  const conversations = eventsToConversations(events, 'clinica_nubia', [], kanbanColumns);
  assert.equal(conversations.length, 1);
  assert.equal(conversations[0].stage, 'Agendamentos');
});

test('SINCRONIA KANBAN B: conversa herda etapa do card mesmo quando card nao possui owner definido', () => {
  const events = [
    {
      id: 'evt-2',
      channel_type: 'whatsapp',
      external_conversation_id: '5511888888888',
      stage: 'Qualificacao',
      message_text: 'Bom dia',
      direction: 'inbound',
      created_at: '2026-10-10T11:00:00Z',
    },
  ];

  const canonicalKey = canonicalConversationKey('whatsapp', '5511888888888', 'evt-2', 'clinica_nubia');
  const kanbanColumns = [
    {
      id: 'col-proposta',
      automationKey: 'proposta_enviada',
      title: 'Proposta Enviada',
      cards: [
        {
          id: 'card-evt-2',
          canonicalKey,
          externalConversationId: '5511888888888',
          normalizedExternalId: normalizeExternalConversationId('whatsapp', '5511888888888'),
          targetColumnId: 'proposta_enviada',
          stage: 'Proposta Enviada',
          owner: null,
          ownerKind: null,
        },
      ],
    },
  ];

  const conversations = eventsToConversations(events, 'clinica_nubia', [], kanbanColumns);
  assert.equal(conversations.length, 1);
  assert.equal(conversations[0].stage, 'Proposta Enviada');
});

test('SINCRONIA KANBAN C: getStageLabel resolve coluna configurada antes de qualquer fallback', () => {
  const customCols = [
    { automationKey: 'novas_conversas', title: 'Triagem Inicial' },
    { automationKey: 'sales_hot', title: 'Clientes Super Quentes' },
  ];

  assert.equal(
    getStageLabel('novas_conversas', { kanbanColumns: customCols, tenantSlug: 'wesley_automoveis' }),
    'Triagem Inicial',
  );
  assert.equal(
    getStageLabel('sales_hot', { kanbanColumns: customCols, tenantSlug: 'wesley_automoveis' }),
    'Clientes Super Quentes',
  );
});

test('SINCRONIA KANBAN D: chave snake_case com letra s nao e tratada como texto amigavel quando nao mapeada', () => {
  // Antes do fix, a regex /s/ casava com a letra 's' minúscula em vez de espaço /\s/
  const label = getStageLabel('custom_lead_status', { tenantSlug: 'tenant_teste' });
  assert.equal(label, 'Custom Lead Status');
});

test('SINCRONIA KANBAN E: applyIncomingEventToConversations resolve etapa respeitando kanbanColumns passadas', () => {
  const initial = [
    {
      id: 'conv-whatsapp:5511777777777',
      canonicalKey: 'whatsapp:5511777777777',
      channelType: 'whatsapp',
      externalConversationId: '5511777777777',
      stage: 'Qualificação',
      status: 'ia_ativa',
      messages: [],
    },
  ];

  const customCols = [
    { automationKey: 'visita_agendada', title: 'Visita na Concessionária' },
  ];

  const event = {
    id: 'evt-realtime',
    channel_type: 'whatsapp',
    external_conversation_id: '5511777777777',
    stage: 'visita_agendada',
    message_text: 'Confirmado para amanhã',
    direction: 'inbound',
    created_at: '2026-10-10T12:00:00Z',
  };

  const updated = applyIncomingEventToConversations(initial, event, 'wesley_automoveis', {
    kanbanColumns: customCols,
  });

  assert.equal(updated.length, 1);
  assert.equal(updated[0].stage, 'Visita na Concessionária');
});

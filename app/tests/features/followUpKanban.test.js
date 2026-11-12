import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyIncomingEventToKanban,
  eventsToKanban,
  getKanbanColumnKind,
  resolveTenantKanbanStage,
} from '../../src/dataService.js';
import { KANBAN_OWNER_FILTERS, matchesKanbanOwnerFilter } from '../../src/services/kanban/kanbanFilters.js';

const nubiaConfig = {
  columns: [
    { id: 'conversas_ia', name: 'Conversas IA', automation_key: 'conversas_ia', position: 1 },
    { id: 'aguardando_humano', name: 'Aguardando humano', automation_key: 'aguardando_humano', position: 2 },
    { id: 'com_humano', name: 'Com humano', automation_key: 'com_humano', position: 3 },
    { id: 'finalizadas', name: 'Finalizadas', automation_key: 'finalizadas', position: 4 },
    { id: 'conversas_abandonadas', name: 'Conversas abandonadas', automation_key: 'conversas_abandonadas', position: 5 },
    { id: 'follow', name: 'Follow Ups', automation_key: 'follow_ups', position: 6 },
  ],
};

const genesisConfig = {
  columns: [
    { id: 'qualifying', name: 'Qualificacao IA', automation_key: 'sales_qualifying', position: 1 },
    { id: 'human', name: 'Atendimento humano', automation_key: 'sales_human', position: 2 },
    { id: 'follow', name: 'Follow Ups', automation_key: 'follow_ups', position: 9 },
  ],
};

const makeEvent = (overrides = {}) => ({
  id: 'evt-1',
  tenant_slug: 'clinica_nubia_oficial',
  channel_type: 'whatsapp',
  external_conversation_id: '5511999990001@s.whatsapp.net',
  contact_name: 'Alice',
  direction: 'inbound',
  sender_type: 'contact',
  service: 'general',
  stage: 'Conversas IA',
  message_text: 'Oi, quero informações',
  handoff: false,
  created_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
  raw_payload: {},
  ...overrides,
});

const cardsIn = (columns, key) => columns.find((column) => column.automationKey === key)?.cards || [];

test('Opção B: conversa com follow-up enviado vai exclusivamente para Follow Ups e não duplica em Conversas IA', () => {
  const now = Date.now();
  const inbound = makeEvent({
    id: 'in-1',
    created_at: new Date(now - 5 * 3600_000).toISOString(),
  });
  const followUp = makeEvent({
    id: 'fu-1',
    direction: 'outbound',
    sender_type: 'assistant',
    service: 'follow_up',
    stage: 'Follow-up 3h',
    message_text: 'Oi Alice, ficou alguma dúvida?',
    created_at: new Date(now - 3600_000).toISOString(),
    raw_payload: { follow_up: { step_key: '3h' } },
  });

  const columns = eventsToKanban([inbound, followUp], 'clinica_nubia_oficial', [], nubiaConfig, []);
  const followUps = cardsIn(columns, 'follow_ups');
  const iaCards = cardsIn(columns, 'conversas_ia');

  assert.equal(getKanbanColumnKind(nubiaConfig.columns[5]), 'special_view');
  assert.equal(iaCards.length, 0);
  assert.equal(followUps.length, 1);
  assert.equal(followUps[0].isFollowUp, true);
  assert.equal(followUps[0].waitingForFollowUp, true);
  assert.equal(followUps[0].followUpLabel, '3h');
  assert.equal(followUps[0].ownerKind, 'ai');
  assert.equal(followUps[0].owner, 'Assistente IA');
  assert.equal(matchesKanbanOwnerFilter(followUps[0], KANBAN_OWNER_FILTERS.AI), true);
  assert.ok(followUps[0].lastActivityAt);
});

test('Opção B: cliente que respondeu após follow-up, atendimento humano ou encerramento não fica em Follow Ups', () => {
  const now = Date.now();
  const replied = [
    makeEvent({ id: 'r-1', external_conversation_id: 'chat-replied@s.whatsapp.net', created_at: new Date(now - 4 * 3600_000).toISOString() }),
    makeEvent({ id: 'r-2', external_conversation_id: 'chat-replied@s.whatsapp.net', direction: 'outbound', sender_type: 'assistant', service: 'follow_up', stage: 'Follow-up 3h', created_at: new Date(now - 3 * 3600_000).toISOString() }),
    makeEvent({ id: 'r-3', external_conversation_id: 'chat-replied@s.whatsapp.net', direction: 'inbound', sender_type: 'contact', message_text: 'Voltei!', created_at: new Date(now - 3600_000).toISOString() }),
  ];
  const handedOff = [
    makeEvent({ id: 'h-1', external_conversation_id: 'chat-human@s.whatsapp.net', created_at: new Date(now - 4 * 3600_000).toISOString() }),
    makeEvent({ id: 'h-2', external_conversation_id: 'chat-human@s.whatsapp.net', direction: 'outbound', sender_type: 'assistant', service: 'follow_up', stage: 'Follow-up 3h', created_at: new Date(now - 3 * 3600_000).toISOString() }),
    makeEvent({ id: 'h-3', external_conversation_id: 'chat-human@s.whatsapp.net', direction: 'outbound', sender_type: 'agent', service: 'manual_reply', stage: 'Atendimento humano', handoff: true, sent_by_user: 'Atendente', created_at: new Date(now - 1800_000).toISOString() }),
  ];
  const closed = [
    makeEvent({ id: 'c-1', external_conversation_id: 'chat-closed@s.whatsapp.net', created_at: new Date(now - 4 * 3600_000).toISOString() }),
    makeEvent({ id: 'c-2', external_conversation_id: 'chat-closed@s.whatsapp.net', direction: 'outbound', sender_type: 'assistant', service: 'follow_up', stage: 'Follow-up 3h', created_at: new Date(now - 3 * 3600_000).toISOString() }),
    makeEvent({ id: 'c-3', external_conversation_id: 'chat-closed@s.whatsapp.net', direction: 'internal', sender_type: 'system', service: 'conversation_closed', stage: 'Finalizado', created_at: new Date(now - 1800_000).toISOString() }),
  ];

  const columns = eventsToKanban([...replied, ...handedOff, ...closed], 'clinica_nubia_oficial', [], nubiaConfig, []);
  assert.equal(cardsIn(columns, 'follow_ups').length, 0);
  assert.equal(cardsIn(columns, 'conversas_ia')[0].externalConversationId, 'chat-replied@s.whatsapp.net');
  assert.equal(cardsIn(columns, 'com_humano')[0].externalConversationId, 'chat-human@s.whatsapp.net');
  assert.equal(cardsIn(columns, 'finalizadas')[0].externalConversationId, 'chat-closed@s.whatsapp.net');
});

test('Opção B: follow-up antigo (>24h) sem resposta permanece em Follow Ups e coluna ordena por atividade recente', () => {
  const now = Date.now();
  const older = [
    makeEvent({ id: 'o-1', external_conversation_id: 'chat-old@s.whatsapp.net', contact_name: 'Antiga', created_at: new Date(now - 50 * 3600_000).toISOString() }),
    makeEvent({ id: 'o-2', external_conversation_id: 'chat-old@s.whatsapp.net', contact_name: 'Antiga', direction: 'outbound', sender_type: 'assistant', service: 'follow_up', stage: 'Follow-up 24h', created_at: new Date(now - 30 * 3600_000).toISOString() }),
  ];
  const newer = [
    makeEvent({ id: 'n-1', external_conversation_id: 'chat-new@s.whatsapp.net', contact_name: 'Recente', created_at: new Date(now - 4 * 3600_000).toISOString() }),
    makeEvent({ id: 'n-2', external_conversation_id: 'chat-new@s.whatsapp.net', contact_name: 'Recente', direction: 'outbound', sender_type: 'assistant', service: 'follow_up', stage: 'Follow-up 15d', created_at: new Date(now - 1800_000).toISOString() }),
  ];

  const columns = eventsToKanban([...older, ...newer], 'clinica_nubia_oficial', [], nubiaConfig, []);
  const followUps = cardsIn(columns, 'follow_ups');
  assert.deepEqual(followUps.map((card) => card.title), ['Recente', 'Antiga']);
  assert.deepEqual(followUps.map((card) => card.followUpLabel), ['15 dias', '1 dia']);
  assert.equal(cardsIn(columns, 'conversas_abandonadas').length, 0);
});

test('Opção B Realtime: card entra em Follow Ups ao enviar follow-up e retorna a Conversas IA ao cliente responder', () => {
  const now = Date.now();
  const chat = '5511888880001@s.whatsapp.net';
  const initialInbound = makeEvent({ id: 'rt-1', external_conversation_id: chat, created_at: new Date(now - 3 * 3600_000).toISOString() });
  const followUpEvent = makeEvent({
    id: 'rt-2',
    external_conversation_id: chat,
    direction: 'outbound',
    sender_type: 'assistant',
    service: 'follow_up',
    stage: 'Follow-up 3h',
    message_text: 'Posso ajudar com algo mais?',
    created_at: new Date(now - 1200_000).toISOString(),
  });
  const replyEvent = makeEvent({
    id: 'rt-3',
    external_conversation_id: chat,
    direction: 'inbound',
    sender_type: 'contact',
    stage: 'Conversas IA',
    message_text: 'Sim, quero agendar!',
    created_at: new Date(now - 600_000).toISOString(),
  });

  const initialBoard = eventsToKanban([initialInbound], 'clinica_nubia_oficial', [], nubiaConfig, []);
  assert.equal(cardsIn(initialBoard, 'conversas_ia').length, 1);

  const afterFollowUp = applyIncomingEventToKanban(initialBoard, followUpEvent, 'clinica_nubia_oficial');
  assert.equal(cardsIn(afterFollowUp, 'conversas_ia').length, 0);
  assert.equal(cardsIn(afterFollowUp, 'follow_ups').length, 1);
  assert.equal(cardsIn(afterFollowUp, 'follow_ups')[0].isFollowUp, true);
  assert.equal(cardsIn(afterFollowUp, 'follow_ups')[0].ownerKind, 'ai');
  assert.equal(cardsIn(afterFollowUp, 'follow_ups')[0].followUpLabel, '3h');

  const afterReply = applyIncomingEventToKanban(afterFollowUp, replyEvent, 'clinica_nubia_oficial');
  assert.equal(cardsIn(afterReply, 'follow_ups').length, 0);
  assert.equal(cardsIn(afterReply, 'conversas_ia').length, 1);
  assert.equal(cardsIn(afterReply, 'conversas_ia')[0].isFollowUp, false);
});

test('Genesis também suporta Follow Ups enviados na Opção B enquanto pagamento prioriza Verificar Sinal', () => {
  const now = Date.now();
  const genesisLead = [{
    id: 'lead-1',
    channel_type: 'whatsapp',
    chat_id: 'test@s.whatsapp.net',
    stage_key: 'sales_qualifying',
    revision: 2,
    ai_locked: false,
  }];
  const genesisEvents = [
    makeEvent({ id: 'g-1', tenant_slug: 'wesley_automoveis', external_conversation_id: 'test@s.whatsapp.net', stage: 'sales_qualifying', created_at: new Date(now - 3 * 3600_000).toISOString() }),
    makeEvent({ id: 'g-2', tenant_slug: 'wesley_automoveis', external_conversation_id: 'test@s.whatsapp.net', direction: 'outbound', sender_type: 'assistant', service: 'follow_up', stage: 'Follow-up 24h', created_at: new Date(now - 1800_000).toISOString() }),
  ];

  const genesisBoard = eventsToKanban(genesisEvents, 'wesley_automoveis', [], genesisConfig, [], genesisLead);
  assert.equal(cardsIn(genesisBoard, 'sales_qualifying').length, 0);
  assert.equal(cardsIn(genesisBoard, 'follow_ups').length, 1);
  assert.equal(cardsIn(genesisBoard, 'follow_ups')[0].followUpLabel, '1 dia');

  const signalPriority = resolveTenantKanbanStage({
    tenantSlug: 'clinica_nubia_oficial',
    event: { service: 'pagamento_sinal', handoff: true, stage: 'Atendimento humano' },
    conversationState: { status: 'atendimento_humano' },
  });
  assert.deepEqual(signalPriority, ['verificar_sinal', 'aguardando_humano']);
});

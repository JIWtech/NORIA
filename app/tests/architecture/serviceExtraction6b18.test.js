import test from 'node:test';
import assert from 'node:assert/strict';

import { eventsToKanban as eventsToKanbanFacade } from '../../src/dataService.js';
import { eventsToKanban } from '../../src/services/kanban/eventsToKanban.js';

const event = (overrides = {}) => ({
  id: 'kanban-event-1', tenant_slug: 'wesley_automoveis', channel_type: 'whatsapp',
  external_conversation_id: '5511999990001@s.whatsapp.net', contact_handle: '5511999990001',
  contact_name: 'Cliente Genesis', direction: 'inbound', sender_type: 'contact', service: 'sales',
  stage: 'sales_appraisal', message_text: 'Tenho carro para troca', created_at: '2026-10-09T10:00:00.000Z', raw_payload: {},
  ...overrides,
});

test('6B.18: extracted builder matches facade for Genesis commercial stages, owner and configured column', () => {
  const events = [event()];
  const config = { columns: [{ id: 'db-appraisal', board_id: 'board-1', name: 'Avaliação Genesis', automation_key: 'sales_appraisal', position: 1 }] };
  const leads = [{ id: 'lead-1', channel_type: 'whatsapp', chat_id: '5511999990001@s.whatsapp.net', stage_key: 'sales_appraisal', revision: 4, ai_locked: false, tenant_slug: 'wesley_automoveis' }];

  const direct = eventsToKanban(events, 'wesley_automoveis', [], config, [], leads, []);
  const facade = eventsToKanbanFacade(events, 'wesley_automoveis', [], config, [], leads, []);

  assert.deepEqual(direct, facade);
  assert.equal(direct[0].cards[0].salesStageKey, 'sales_appraisal');
  assert.equal(direct[0].cards[0].stage, 'Avaliação Genesis');
  assert.equal(direct[0].cards[0].owner, 'Sem responsável');
});

test('6B.18: extracted builder preserves Núbia appointments, follow-up and tenant isolation', () => {
  const nubiaEvent = event({ id: 'nubia-event-1', tenant_slug: 'clinica_nubia_oficial', stage: 'Qualificação', contact_name: 'Paciente Núbia', external_conversation_id: '5511888880002@s.whatsapp.net' });
  const followUpChat = '5511888880003@s.whatsapp.net';
  const nubiaFollowUpInbound = event({ id: 'nubia-fu-in', tenant_slug: 'clinica_nubia_oficial', stage: 'Qualificação', contact_name: 'Paciente Follow-up', external_conversation_id: followUpChat, created_at: '2026-10-09T09:00:00.000Z' });
  const nubiaFollowUpOutbound = event({ id: 'nubia-fu-out', tenant_slug: 'clinica_nubia_oficial', direction: 'outbound', sender_type: 'assistant', service: 'follow_up', stage: 'Follow-up 24h', contact_name: 'Paciente Follow-up', external_conversation_id: followUpChat, created_at: '2026-10-09T11:00:00.000Z' });
  const appointment = {
    id: 'appointment-1', title: 'Avaliação', contactName: 'Paciente Núbia', when: '09/10 14:00', startsAt: '2026-10-09T14:00:00.000Z',
    channelType: 'whatsapp', channelLabel: 'WhatsApp', externalConversationId: '5511888880002@s.whatsapp.net', status: 'confirmed', statusLabel: 'Confirmado', raw: {},
  };
  const config = { columns: [
    { id: 'andamento', name: 'Em andamento', automation_key: 'conversas_andamento', position: 1 },
    { id: 'agenda', name: 'Agenda', automation_key: 'agendamentos', position: 2 },
    { id: 'follow', name: 'Follow-up', automation_key: 'follow_ups', position: 3 },
  ] };

  const direct = eventsToKanban([nubiaEvent, nubiaFollowUpInbound, nubiaFollowUpOutbound], 'clinica_nubia_oficial', [appointment], config, []);
  const facade = eventsToKanbanFacade([nubiaEvent, nubiaFollowUpInbound, nubiaFollowUpOutbound], 'clinica_nubia_oficial', [appointment], config, []);

  assert.deepEqual(direct, facade);
  assert.equal(direct.flatMap((column) => column.cards).some((card) => card.appointmentId === 'appointment-1'), true);
  assert.equal(direct.find((column) => column.automationKey === 'follow_ups').cards.some((card) => card.externalConversationId === followUpChat && card.isFollowUp), true);
  assert.equal(direct.flatMap((column) => column.cards).every((card) => card.title !== 'Cliente Genesis'), true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { applyIncomingEventToConversations } from '../../src/services/conversations/applyIncomingEvent.js';
import { eventsToConversations } from '../../src/services/conversations/eventsToConversations.js';
import { formatConversationCardOrigin } from '../../src/services/timeline/conversationFilters.js';
import { groupTimelineMessages, resolveTimelineSender } from '../../src/features/conversations/utils/chatTimelineHelpers.js';

const tenant = 'tenant_teste';
const inbound = {
  id: 'inbound', tenant_slug: tenant, channel_type: 'whatsapp', external_conversation_id: '5511999999999@s.whatsapp.net',
  direction: 'inbound', sender_type: 'user', message_text: 'Gostaria de agendar um horário.', created_at: '2026-11-09T18:00:00Z',
};
const outbound = {
  ...inbound, id: 'outbound', direction: 'outbound', sender_type: 'system', ai_provider: 'operator_confirmation',
  sent_by_user: 'conta@example.com', delivery_status: 'sent', created_at: '2026-11-09T18:01:00Z',
};

const projections = {
  histórico: (event) => eventsToConversations([inbound, event], tenant)[0],
  'tempo real': (event) => applyIncomingEventToConversations(eventsToConversations([inbound], tenant), event, tenant)[0],
};

const replies = {
  appointment_request_confirmed: 'Seu horário está confirmado!',
  appointment_request_rejected: 'Esse horário está ocupado. Qual horário funciona melhor?',
  appointment_payment_confirmed: 'Pagamento confirmado! Seu horário está reservado.',
  // Contraproposta de horário da equipe (Sugerir outro horário): é mensagem enviada à cliente, não evento do sistema.
  appointment_slot_proposed: 'O horário das 13h não está livre. Pode ser sábado, 14 de novembro, às 14h?',
};

for (const [mode, project] of Object.entries(projections)) {
  test(`${mode}: mensagens de agendamento enviadas aparecem como IA, sem expor a conta`, () => {
    for (const [service, message_text] of Object.entries(replies)) {
      const conversation = project({ ...outbound, service, message_text });
      const message = groupTimelineMessages(conversation.messages).find((item) => item.eventId === outbound.id);
      assert.equal(message.text, message_text);
      assert.equal(message.sent_by, null);
      assert.equal(message.isSystem, false);
      assert.equal(message.isAi, true);
      assert.equal(message.senderLabel, 'Assistente IA');
      assert.equal(conversation.lastMessageSender, 'IA');
      assert.equal(formatConversationCardOrigin(conversation), 'IA');
    }
  });

  test(`${mode}: falha de envio e evento de sistema continuam distintos de uma resposta da IA`, () => {
    for (const event of [
      { ...outbound, service: 'appointment_request_confirmed', delivery_status: 'failed', message_text: 'Falha na confirmação.' },
      { ...outbound, service: 'system', message_text: 'Evento operacional.' },
    ]) {
      const conversation = project(event);
      const message = conversation.messages.find((item) => item.eventId === outbound.id);
      assert.equal(resolveTimelineSender({ message }).senderLabel, 'Sistema');
      assert.equal(conversation.lastMessageSender, 'Sistema');
    }
  });

  test(`${mode}: mensagem manual continua humana e esconde o identificador da conta`, () => {
    const conversation = project({ ...outbound, sender_type: 'agent', service: 'manual_reply', message_text: 'Olá!' });
    const message = conversation.messages.find((item) => item.eventId === outbound.id);
    const sender = resolveTimelineSender({ message, selectedOwner: outbound.sent_by_user });
    assert.equal(conversation.lastMessageSender, 'Atendente');
    assert.equal(sender.senderType, 'agent');
    assert.ok(!sender.senderLabel.includes('@'));
  });
}

test('prévia de conversa antiga oculta o e-mail armazenado no campo de remetente', () => {
  assert.equal(formatConversationCardOrigin({ lastMessageSenderType: 'agent', lastMessageSender: outbound.sent_by_user }), 'Atendente');
});

test('tempo real: atualização de entrega reclassifica a mesma mensagem sem duplicar', () => {
  const event = { ...outbound, service: 'appointment_request_confirmed', message_text: 'Seu horário está confirmado!' };
  const before = eventsToConversations([inbound, { ...event, delivery_status: 'pending' }], tenant);
  const [after] = applyIncomingEventToConversations(before, event, tenant);
  const messages = groupTimelineMessages(after.messages).filter((message) => message.eventId === event.id);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].senderLabel, 'Assistente IA');
  assert.equal(after.lastMessageSender, 'IA');
});

for (const [mode, project] of Object.entries(projections)) {
  test(`${mode}: confirmação pendente já aparece como bolha da IA`, () => {
    for (const [service, message_text] of Object.entries(replies)) {
      const conversation = project({ ...outbound, service, delivery_status: 'pending', message_text });
      const message = groupTimelineMessages(conversation.messages).find((item) => item.eventId === outbound.id);
      assert.equal(message.isSystem, false);
      assert.equal(message.isAi, true);
      assert.equal(message.sent_by, null);
      assert.equal(conversation.lastMessageSender, 'IA');
    }
  });

  test(`${mode}: confirmação interna continua como evento de sistema`, () => {
    for (const event of [
      { ...outbound, service: 'appointment_request_confirmed', is_internal: true, message_text: 'Interno.' },
      { ...outbound, service: 'appointment_request_confirmed', raw_payload: { is_internal: true }, message_text: 'Interno.' },
    ]) {
      const message = project(event).messages.find((item) => item.eventId === outbound.id);
      assert.equal(resolveTimelineSender({ message }).senderLabel, 'Sistema');
    }
  });
}

for (const [from, to, expected] of [['pending', 'sent', 'Assistente IA'], ['pending', 'failed', 'Sistema'], ['sent', 'failed', 'Sistema'], ['failed', 'sent', 'Assistente IA']]) {
  test(`tempo real: atualização ${from} para ${to} reclassifica sem duplicar`, () => {
    const event = { ...outbound, service: 'appointment_request_confirmed', message_text: 'Seu horário está confirmado!' };
    const before = eventsToConversations([inbound, { ...event, delivery_status: from }], tenant);
    const [after] = applyIncomingEventToConversations(before, { ...event, delivery_status: to }, tenant);
    const messages = after.messages.filter((message) => message.eventId === event.id);
    assert.equal(messages.length, 1);
    assert.equal(resolveTimelineSender({ message: messages[0] }).senderLabel, expected);
    assert.equal(messages[0].status, to);
  });
}

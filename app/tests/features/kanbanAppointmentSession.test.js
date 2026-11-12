import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsToKanban } from '../../src/services/kanban/eventsToKanban.js';
import { applyIncomingEventToKanban } from '../../src/services/kanban/applyIncomingEvent.js';
import { mapAppointment } from '../../src/services/appointments/appointmentPresentation.js';

// Pedido de agendamento aberto + atendimento finalizado + nova conversa: o card da nova conversa não pode sumir
// dentro do card do pedido antigo, nem herdar o estado dele.
const tenant = 'ic_salon';
const chat = '5521985198468@s.whatsapp.net';
const base = Date.now() - 3 * 60 * 60 * 1000;
const iso = (minutes) => new Date(base + minutes * 60 * 1000).toISOString();
const event = (id, minutes, overrides = {}) => ({ id, tenant_slug: tenant, channel_type: 'whatsapp', external_conversation_id: chat, created_at: iso(minutes),
  stage: 'Conversas IA', handoff: false, direction: 'inbound', sender_type: 'contact', contact_name: 'João Victor Santos', message_text: 'oi', ...overrides });
const closeEvent = (minutes) => event('close', minutes, { direction: 'outbound', sender_type: 'system', service: 'conversation_closed', stage: 'Finalizado', message_text: 'Atendimento encerrado pela interface' });
const config = { columns: ['conversas_ia', 'aguardando_humano', 'com_humano', 'verificar_sinal', 'confirmar_agendamento', 'agendamentos', 'finalizadas', 'conversas_abandonadas']
  .map((key, position) => ({ id: key, automation_key: key, name: key, position })) };
const appointment = (status = 'pending_confirmation') => mapAppointment({ id: 'appt-1', title: 'Design de sobrancelha', status, starts_at: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString(),
  created_at: iso(10), updated_at: iso(10), channel_type: 'whatsapp', external_conversation_id: chat, contact_name: 'Louzania Santos', metadata: { services: ['Design de sobrancelha'] } });
const columnOf = (columns, predicate) => columns.find((column) => column.cards.some(predicate))?.automationKey;
const cardsOf = (columns) => columns.flatMap((column) => column.cards);

test('sem finalizar, o pedido aberto continua absorvendo o card da conversa (comportamento atual)', () => {
  const columns = eventsToKanban([event('e1', 0), event('e2', 12, { direction: 'outbound', sender_type: 'assistant' })], tenant, [appointment()], config);
  assert.equal(cardsOf(columns).length, 1);
  assert.equal(columnOf(columns, (card) => card.appointmentId === 'appt-1'), 'confirmar_agendamento');
});

test('depois de finalizar e começar outra conversa: dois cards, cada um com o seu estado', () => {
  const events = [event('e1', 0), event('e2', 12, { direction: 'outbound', sender_type: 'assistant' }), closeEvent(20), event('e3', 30, { message_text: 'Oiire, boa noite' })];
  const columns = eventsToKanban(events, tenant, [appointment()], config);
  const appointmentCard = cardsOf(columns).find((card) => card.appointmentId === 'appt-1');
  assert.ok(appointmentCard, 'o pedido continua à espera da equipe');
  assert.equal(columnOf(columns, (card) => card.appointmentId === 'appt-1'), 'confirmar_agendamento');
  const conversationCard = cardsOf(columns).find((card) => !card.appointmentId);
  assert.ok(conversationCard, 'a nova conversa aparece no quadro');
  assert.equal(columnOf(columns, (card) => card === conversationCard), 'conversas_ia');
  assert.equal(cardsOf(columns).length, 2);
  assert.equal(appointmentCard.title, 'João Victor Santos', 'o card do pedido mostra o contato da conversa, não o nome do serviço');
});

test('atendimento finalizado com pedido aberto: a conversa fica em Finalizadas e o pedido na coluna de confirmação', () => {
  const columns = eventsToKanban([event('e1', 0), closeEvent(20)], tenant, [appointment()], config);
  assert.equal(columnOf(columns, (card) => card.appointmentId === 'appt-1'), 'confirmar_agendamento');
  assert.equal(columnOf(columns, (card) => !card.appointmentId), 'finalizadas');
});

test('mensagem nova em tempo real atualiza o card da conversa, não o card do pedido', () => {
  const events = [event('e1', 0), closeEvent(20), event('e3', 30)];
  let columns = eventsToKanban(events, tenant, [appointment()], config);
  const incoming = event('e4', 31, { message_text: 'Fazem loiro?' });
  columns = applyIncomingEventToKanban(columns, incoming, tenant);
  const requestCard = cardsOf(columns).find((card) => card.appointmentId === 'appt-1');
  const conversationCard = cardsOf(columns).find((card) => !card.appointmentId);
  assert.equal(requestCard.lastActivityAt === incoming.created_at, false, 'o card do pedido não recebe a mensagem nova');
  assert.ok(conversationCard);
  assert.equal(conversationCard.lastActivityAt, incoming.created_at);
});

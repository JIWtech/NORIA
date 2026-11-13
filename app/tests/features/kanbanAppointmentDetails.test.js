import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsToKanban } from '../../src/services/kanban/eventsToKanban.js';
import { applyIncomingEventToKanban } from '../../src/services/kanban/applyIncomingEvent.js';
import { kanbanAppointmentDetails } from '../../src/services/kanban/kanbanAppointmentDetails.js';
import { kanbanCardLabels } from '../../src/services/kanban/kanbanCardReason.js';
import { mapAppointment } from '../../src/services/appointments/appointmentPresentation.js';

const timeZone = 'America/Sao_Paulo';
const confirmedCard = {
  id: 'conversation-1',
  appointmentId: 'appt-1',
  appointmentStatus: 'confirmed',
  appointmentStatusLabel: 'Confirmado',
  appointmentStartsAt: '2026-11-20T16:00:00Z',
  appointmentTitle: 'Corte',
  appointmentMetadata: { services: ['Corte', 'Escova'], professional: 'Ana', first_visit: 'Sim', duration_minutes: 60 },
};

test('detalhes do agendamento confirmado mostram serviços, dia, hora, profissional e primeira vez', () => {
  const details = kanbanAppointmentDetails(confirmedCard, { timeZone });
  assert.equal(details.services, 'Corte + Escova');
  assert.match(details.when, /sex/i);
  assert.match(details.when, /20\/11/);
  assert.match(details.when, /13:00/);
  assert.equal(details.professional, 'Ana');
  assert.equal(details.firstVisit, 'Sim');
  assert.equal(details.durationUnknown, false);

  const fallback = kanbanAppointmentDetails({ ...confirmedCard, appointmentMetadata: {} }, { timeZone });
  assert.equal(fallback.services, 'Corte');
  assert.equal(fallback.durationUnknown, true);

  // O bloco já mostra a hora: o resumo de status não repete a data.
  assert.equal(kanbanCardLabels(confirmedCard, { id: 'agendamentos', title: 'Agendamentos' }).appointmentDate, '');
});

test('sem agendamento ou com agendamento cancelado não há detalhes', () => {
  assert.equal(kanbanAppointmentDetails({ id: 'conversation-1' }, { timeZone }), null);
  assert.equal(kanbanAppointmentDetails({ ...confirmedCard, appointmentStatus: 'cancelled' }, { timeZone }), null);
  assert.equal(kanbanAppointmentDetails({ ...confirmedCard, appointmentStatus: 'canceled' }, { timeZone }), null);
});

test('card de agendamento (appointment-*) não repete a hora que já está no subtítulo', () => {
  const details = kanbanAppointmentDetails({ ...confirmedCard, id: 'appointment-appt-1' }, { timeZone });
  assert.equal(details.when, '');
  assert.equal(details.services, 'Corte + Escova');
});

const tenant = 'tenant_teste';
const chat = '5521000000009@s.whatsapp.net';
const config = { columns: ['conversas_ia', 'aguardando_humano', 'com_humano', 'confirmar_agendamento', 'agendamentos', 'finalizadas']
  .map((key, position) => ({ id: key, automation_key: key, name: key, position })) };
const iso = (offsetMinutes) => new Date(Date.now() + offsetMinutes * 60000).toISOString();
const event = (overrides = {}) => ({
  id: 'event-1', tenant_slug: tenant, channel_type: 'whatsapp', external_conversation_id: chat,
  created_at: iso(-120), stage: 'Conversas IA', handoff: false, direction: 'inbound', sender_type: 'contact',
  message_text: 'Quero marcar um corte', ...overrides,
});
const appointment = ({ startsAt = iso(2 * 24 * 60), updatedAt = iso(-60), status = 'confirmed' } = {}) => mapAppointment({
  id: 'appt-1', title: 'Corte', status, starts_at: startsAt, created_at: iso(-90), updated_at: updatedAt,
  channel_type: 'whatsapp', external_conversation_id: chat,
  metadata: { services: ['Corte'], professional: 'Ana' },
});
const cardsOfChat = (columns) => columns.flatMap((column) => column.cards
  .filter((card) => card.externalConversationId === chat)
  .map((card) => ({ ...card, columnKey: column.automationKey || column.id })));

test('confirmado com "Obrigada" posterior ou anterior fica em agendamentos com os detalhes', () => {
  for (const thanksAt of [iso(-30), iso(-75)]) {
    const thanks = event({ id: 'thanks', created_at: thanksAt, message_text: 'Obrigada' });
    const cards = cardsOfChat(eventsToKanban([event(), thanks], tenant, [appointment()], config));
    assert.equal(cards.length, 1, thanksAt);
    assert.equal(cards[0].columnKey, 'agendamentos', thanksAt);
    assert.equal(cards[0].appointmentTitle, 'Corte');
    assert.equal(kanbanAppointmentDetails(cards[0], { timeZone }).professional, 'Ana');
  }
});

test('confirmado com pedido de atendimento humano posterior não vai para agendamentos', () => {
  const handoff = event({ id: 'handoff', created_at: iso(-30), service: 'handoff_requested', handoff: true, stage: 'Atendimento humano' });
  const [card] = cardsOfChat(eventsToKanban([event(), handoff], tenant, [appointment()], config));
  assert.notEqual(card.columnKey, 'agendamentos');
  assert.equal(card.appointmentStatus, 'confirmed');
  assert.equal(card.appointmentTitle, 'Corte');
});

test('agendamento confirmado já passado não puxa o card com conversa mais recente', () => {
  const thanks = event({ id: 'thanks', created_at: iso(-30), message_text: 'Obrigada' });
  const past = appointment({ startsAt: iso(-24 * 60) });
  const [card] = cardsOfChat(eventsToKanban([event(), thanks], tenant, [past], config));
  assert.equal(card.columnKey, 'conversas_ia');
});

test('tempo real: "Obrigada" não tira de agendamentos o card confirmado e futuro', () => {
  const board = eventsToKanban([event()], tenant, [appointment()], config);
  assert.equal(cardsOfChat(board)[0].columnKey, 'agendamentos');
  const thanks = event({ id: 'thanks', created_at: iso(-1), message_text: 'Obrigada' });
  const [card] = cardsOfChat(applyIncomingEventToKanban(board, thanks, tenant));
  assert.equal(card.columnKey, 'agendamentos');
  assert.equal(card.appointmentTitle, 'Corte');
});

test('tempo real: pedido de atendimento humano tira o card confirmado de agendamentos', () => {
  const board = eventsToKanban([event()], tenant, [appointment()], config);
  const handoff = event({ id: 'handoff', created_at: iso(-1), service: 'handoff_requested', handoff: true, stage: 'Atendimento humano' });
  const [card] = cardsOfChat(applyIncomingEventToKanban(board, handoff, tenant));
  assert.notEqual(card.columnKey, 'agendamentos');
});

test('tempo real: agendamento confirmado já passado não segura o card', () => {
  const past = appointment({ startsAt: iso(-24 * 60), updatedAt: iso(-60) });
  const board = eventsToKanban([event()], tenant, [past], config);
  assert.equal(cardsOfChat(board)[0].columnKey, 'agendamentos');
  const thanks = event({ id: 'thanks', created_at: iso(-1), message_text: 'Obrigada' });
  assert.equal(cardsOfChat(applyIncomingEventToKanban(board, thanks, tenant))[0].columnKey, 'conversas_ia');
});

test('tempo real: IA reassumindo conversa com agendamento confirmado futuro leva o card para agendamentos', () => {
  const handoff = event({ id: 'handoff', created_at: iso(-30), service: 'handoff_requested', handoff: true, stage: 'Atendimento humano' });
  const board = eventsToKanban([event(), handoff], tenant, [appointment()], config);
  assert.notEqual(cardsOfChat(board)[0].columnKey, 'agendamentos');
  const resume = event({ id: 'resume', created_at: iso(-1), service: 'resume_ai', direction: 'outbound', sender_type: 'system', stage: 'Conversas IA' });
  const loaded = cardsOfChat(eventsToKanban([event(), handoff, resume], tenant, [appointment()], config))[0].columnKey;
  assert.equal(cardsOfChat(applyIncomingEventToKanban(board, resume, tenant))[0].columnKey, loaded);
});

test('pedido de avaliação presencial aparece como "Avaliação: serviço" no card', () => {
  const details = kanbanAppointmentDetails({ id: 'card-1', appointmentId: 'a1', appointmentStatus: 'pending_confirmation',
    appointmentMetadata: { services: ['Mechas loiras'], evaluation_visit: true } });
  assert.equal(details.services, 'Avaliação: Mechas loiras');
  assert.equal(details.durationUnknown, true);
});

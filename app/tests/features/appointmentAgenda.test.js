import test from 'node:test';
import assert from 'node:assert/strict';
import { appointmentAgendaItem, appointmentSections, matchesAppointmentSearch } from '../../src/services/appointments/appointmentAgenda.js';
import { mapAppointment } from '../../src/services/appointments/appointmentPresentation.js';

const timeZone = 'America/Sao_Paulo';
const NOW = Date.parse('2026-11-11T15:00:00Z'); // quarta, 12:00 em São Paulo
const row = (id, status, startsAt, extra = {}) => mapAppointment({
  id, status, starts_at: startsAt, title: `Serviço ${id}`, contact_name: `Cliente ${id}`,
  channel_type: 'whatsapp', external_conversation_id: `55${id}@s.whatsapp.net`, ...extra,
});

const appointments = [
  row('pedido', 'pending_confirmation', '2026-11-14T13:00:00Z'),
  row('hoje-tarde', 'confirmed', '2026-11-11T20:00:00Z'),
  row('hoje-manha-passado', 'confirmed', '2026-11-11T12:00:00Z'),
  row('amanha', 'scheduled', '2026-11-12T13:00:00Z'),
  row('semana-que-vem', 'pending_payment', '2026-11-18T13:00:00Z'),
  row('ontem-sem-desfecho', 'reserved', '2026-11-10T13:00:00Z'),
  row('cancelado-futuro', 'cancelled', '2026-11-20T13:00:00Z'),
  row('compareceu', 'completed', '2026-11-05T13:00:00Z'),
  row('faltou', 'no_show', '2026-11-04T13:00:00Z'),
  row('tarde-da-noite-local', 'confirmed', '2026-11-12T02:30:00Z'), // 23:30 de hoje em São Paulo
];

test('agenda separa pedidos, hoje, próximos, aguardando desfecho e histórico recolhido', () => {
  const sections = appointmentSections(appointments, { now: NOW, timeZone });
  const ids = Object.fromEntries(sections.map((section) => [section.key, section.items.map((item) => item.id)]));
  assert.deepEqual(sections.map((section) => section.key), ['pending', 'today', 'upcoming', 'awaiting_outcome', 'history']);
  assert.deepEqual(sections.map((section) => section.title), ['Aguardando confirmação', 'Hoje', 'Próximos', 'Aguardando desfecho', 'Histórico']);
  assert.deepEqual(ids.pending, ['pedido']);
  assert.deepEqual(ids.today, ['hoje-tarde', 'tarde-da-noite-local']);
  assert.deepEqual(ids.upcoming, ['amanha', 'semana-que-vem']);
  assert.deepEqual(ids.awaiting_outcome, ['ontem-sem-desfecho', 'hoje-manha-passado']);
  assert.deepEqual(ids.history, ['cancelado-futuro', 'compareceu', 'faltou']);
  assert.equal(sections.find((section) => section.key === 'history').collapsed, true);
  assert.equal(sections.filter((section) => section.collapsed).length, 1);
});

test('busca por nome ignora acentos e maiúsculas e filtra todas as seções', () => {
  const list = [...appointments, row('joana', 'confirmed', '2026-11-13T13:00:00Z', { contact_name: 'Joana Conceição' })];
  assert.equal(matchesAppointmentSearch(list.at(-1), 'conceicao'), true);
  assert.equal(matchesAppointmentSearch(list.at(-1), '  JOANA '), true);
  assert.equal(matchesAppointmentSearch(list.at(-1), 'maria'), false);
  const sections = appointmentSections(list, { now: NOW, timeZone, query: 'joana' });
  assert.deepEqual(sections.flatMap((section) => section.items.map((item) => item.id)), ['joana']);
  assert.equal(appointmentSections(list, { now: NOW, timeZone, query: '' }).flatMap((section) => section.items).length, list.length);
});

test('item da agenda mostra serviços, dia da semana, data, hora, profissional, primeira visita e status', () => {
  const appointment = row('detalhe', 'confirmed', '2026-11-13T17:30:00Z', {
    title: 'Corte + Escova - Ana',
    metadata: { services: ['Corte', 'Escova'], professional: 'Bia', first_visit: 'Sim' },
  });
  const item = appointmentAgendaItem(appointment, { timeZone });
  assert.equal(item.client, 'Cliente detalhe');
  assert.equal(item.services, 'Corte + Escova');
  assert.match(item.weekday, /sexta/i);
  assert.equal(item.date, '13/11/2026');
  assert.equal(item.time, '14:30');
  assert.equal(item.professional, 'Bia');
  assert.equal(item.firstVisit, 'Sim');
  assert.equal(item.statusLabel, 'Confirmado');

  const plain = appointmentAgendaItem(row('simples', 'scheduled', '2026-11-13T17:30:00Z', { contact_name: '' }), { timeZone });
  assert.equal(plain.services, 'Serviço simples');
  assert.equal(plain.client, 'Sem nome');
  assert.equal(plain.professional, '');
});

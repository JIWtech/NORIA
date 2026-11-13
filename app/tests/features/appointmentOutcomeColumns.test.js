import test from 'node:test';
import assert from 'node:assert/strict';
import { appointmentSectionKey } from '../../src/services/appointments/appointmentAgenda.js';
import { availableOutcomes } from '../../src/services/appointments/appointmentOutcome.js';
import { withAppointmentOutcomeColumn } from '../../src/services/kanban/appointmentOutcomeColumns.js';

test('Agenda e Kanban aguardam o fim e preservam a ação de verificar sinal', () => {
  const startsAt = '2026-11-14T16:00:00Z';
  const endsAt = '2026-11-14T17:00:00Z';
  const appointment = { status: 'confirmed', startsAt, endsAt };
  const card = { appointmentId: 'ana', appointmentStatus: 'confirmed', appointmentStartsAt: startsAt, appointmentEndsAt: endsAt };
  const signal = { ...card, appointmentId: 'sinal', appointmentStatus: 'payment_reported', actionType: 'confirm_signal' };
  const board = [{ id: 'agendamentos', cards: [card] }, { id: 'verificar_sinal', cards: [signal] }];
  const before = Date.parse(endsAt) - 1;
  assert.notEqual(appointmentSectionKey(appointment, { now: before }), 'awaiting_outcome');
  assert.deepEqual(availableOutcomes(appointment, before), []);
  assert.deepEqual(withAppointmentOutcomeColumn(board, before)[1].cards, []);
  const due = Date.parse(endsAt);
  assert.equal(appointmentSectionKey(appointment, { now: due }), 'awaiting_outcome');
  assert.deepEqual(availableOutcomes(appointment, due), ['attended', 'no_show']);
  const next = withAppointmentOutcomeColumn(board, due);
  assert.deepEqual(next.map(column => column.cards.map(item => item.appointmentId)), [[], ['ana'], ['sinal']]);
  assert.equal(board[0].cards.length, 1);
});

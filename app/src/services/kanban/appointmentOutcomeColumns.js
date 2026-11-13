import { isAwaitingAppointmentOutcome } from '../appointments/appointmentOutcome.js';

export const AWAITING_OUTCOME_COLUMN = 'aguardando_desfecho';

export function withAppointmentOutcomeColumn(columns, now) {
  const keyOf = column => column.automationKey || column.id;
  const configured = columns.find(column => keyOf(column) === AWAITING_OUTCOME_COLUMN);
  const waiting = [];
  const board = columns.flatMap(column => {
    if (keyOf(column) === AWAITING_OUTCOME_COLUMN) {
      waiting.push(...(column.cards || []));
      return [];
    }
    const cards = (column.cards || []).filter(card => {
      if (!card.appointmentId || card.actionType === 'confirm_signal' || !isAwaitingAppointmentOutcome({
        status: card.appointmentStatus,
        startsAt: card.appointmentStartsAt,
        endsAt: card.appointmentEndsAt,
      }, now)) return true;
      waiting.push({ ...card, targetColumnId: AWAITING_OUTCOME_COLUMN });
      return false;
    });
    return [{ ...column, cards }];
  });
  const position = board.findIndex(column => keyOf(column) === 'agendamentos');
  board.splice(position < 0 ? board.length : position + 1, 0, {
    id: AWAITING_OUTCOME_COLUMN,
    automationKey: AWAITING_OUTCOME_COLUMN,
    title: 'Aguardando desfecho',
    icon: 'calendar-check',
    description: 'Registre a presença ou a falta.',
    ...configured,
    cards: waiting.sort((left, right) => Date.parse(left.appointmentStartsAt) - Date.parse(right.appointmentStartsAt)),
  });
  return board;
}

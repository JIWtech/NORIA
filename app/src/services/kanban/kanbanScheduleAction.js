// Regra do item "Agendar" no menu do card do Kanban, igual para todos os tenants.
// Não oferece novo agendamento quando o card já tem um agendamento ativo com início futuro
// ou quando já está numa coluna de agenda.

export const ACTIVE_APPOINTMENT_STATUSES = new Set(['confirmed', 'pending_confirmation', 'scheduled', 'reserved', 'pending_payment']);
const SCHEDULE_COLUMNS = new Set(['agendamentos', 'confirmar_agendamento']);

export function hasUpcomingActiveAppointment(card, now = Date.now()) {
  if (!card?.appointmentId) return false;
  const status = String(card.appointmentStatus || '').trim().toLowerCase();
  return ACTIVE_APPOINTMENT_STATUSES.has(status) && Date.parse(card.appointmentStartsAt || '') > now;
}

export function shouldOfferScheduleAction(card, columnKey, { onOpenAppointment, hasAgendamentosColumn, now = Date.now() } = {}) {
  if (!onOpenAppointment || !hasAgendamentosColumn) return false;
  if (SCHEDULE_COLUMNS.has(String(columnKey || ''))) return false;
  return !hasUpcomingActiveAppointment(card, now);
}

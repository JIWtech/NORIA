import { asObject } from '../../utils/asObject.js';

const CANCELLED_STATUSES = new Set(['cancelled', 'canceled']);

function formatAppointmentWhen(startsAt, timeZone) {
  const date = new Date(startsAt || '');
  if (Number.isNaN(date.getTime())) return '';
  const options = timeZone ? { timeZone } : {};
  try {
    const day = new Intl.DateTimeFormat('pt-BR', { ...options, weekday: 'short', day: '2-digit', month: '2-digit' }).format(date);
    const time = new Intl.DateTimeFormat('pt-BR', { ...options, hour: '2-digit', minute: '2-digit' }).format(date);
    return `${day} às ${time}`;
  } catch {
    return '';
  }
}

// Detalhes do agendamento mostrados no card do Kanban, iguais para todos os tenants.
// Cards appointment-* já trazem dia e hora no subtítulo: aqui a data é omitida para não repetir.
export function kanbanAppointmentDetails(card, { timeZone } = {}) {
  if (!card?.appointmentId || CANCELLED_STATUSES.has(String(card.appointmentStatus || '').toLowerCase())) return null;
  const metadata = asObject(card.appointmentMetadata);
  const services = (Array.isArray(metadata.services) ? metadata.services : [])
    .map((service) => String(service || '').trim())
    .filter(Boolean);
  const isAppointmentCard = String(card.id || '').startsWith('appointment-');
  return {
    services: services.length ? services.join(' + ') : String(card.appointmentTitle || '').trim(),
    when: isAppointmentCard ? '' : formatAppointmentWhen(card.appointmentStartsAt, timeZone),
    professional: String(metadata.professional || '').trim(),
    firstVisit: metadata.first_visit ? String(metadata.first_visit) : '',
    durationUnknown: !metadata.duration_minutes,
  };
}

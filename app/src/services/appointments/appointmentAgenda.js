import { asObject } from '../../utils/asObject.js';
import { isAwaitingAppointmentOutcome } from './appointmentOutcome.js';

// Organização da tela de Agendamentos, igual para todos os tenants. Recebe agendamentos já mapeados
// por mapAppointment e devolve seções prontas para exibir.

const OPEN_STATUSES = new Set(['scheduled', 'confirmed', 'reserved', 'pending_payment', 'payment_reported', 'aguardando_verificacao']);

const SECTION_DEFINITIONS = [
  { key: 'pending', title: 'Aguardando confirmação', order: 'asc' },
  { key: 'today', title: 'Hoje', order: 'asc' },
  { key: 'upcoming', title: 'Próximos', order: 'asc' },
  { key: 'awaiting_outcome', title: 'Aguardando desfecho', order: 'asc' },
  { key: 'history', title: 'Histórico', order: 'desc', collapsed: true },
];

export function normalizeSearchText(value) {
  return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function matchesAppointmentSearch(appointment, query) {
  const wanted = normalizeSearchText(query);
  if (!wanted) return true;
  return normalizeSearchText(appointment?.contactName).includes(wanted);
}

function dayKey(epoch, timeZone) {
  const options = { year: 'numeric', month: '2-digit', day: '2-digit' };
  try {
    return new Intl.DateTimeFormat('en-CA', timeZone ? { ...options, timeZone } : options).format(new Date(epoch));
  } catch {
    return new Intl.DateTimeFormat('en-CA', options).format(new Date(epoch));
  }
}

function startsAtEpoch(appointment) {
  const epoch = Date.parse(appointment?.startsAt || '');
  return Number.isFinite(epoch) ? epoch : null;
}

export function appointmentSectionKey(appointment, { now = Date.now(), timeZone } = {}) {
  const status = String(appointment?.status || '').trim().toLowerCase();
  if (status === 'pending_confirmation') return 'pending';
  if (!OPEN_STATUSES.has(status)) return 'history';
  const start = startsAtEpoch(appointment);
  if (start === null) return 'upcoming';
  if (isAwaitingAppointmentOutcome(appointment, now)) return 'awaiting_outcome';
  return dayKey(start, timeZone) === dayKey(now, timeZone) ? 'today' : 'upcoming';
}

export function appointmentSections(appointments = [], { now = Date.now(), timeZone, query = '' } = {}) {
  const buckets = new Map(SECTION_DEFINITIONS.map((definition) => [definition.key, []]));
  for (const appointment of Array.isArray(appointments) ? appointments : []) {
    if (!matchesAppointmentSearch(appointment, query)) continue;
    buckets.get(appointmentSectionKey(appointment, { now, timeZone })).push(appointment);
  }
  return SECTION_DEFINITIONS.map(({ key, title, order, collapsed = false }) => {
    const items = buckets.get(key).slice().sort((a, b) => {
      const left = startsAtEpoch(a) ?? Number.MAX_SAFE_INTEGER;
      const right = startsAtEpoch(b) ?? Number.MAX_SAFE_INTEGER;
      return order === 'desc' ? right - left : left - right;
    });
    return { key, title, collapsed, items };
  });
}

function formatPart(epoch, timeZone, options) {
  try {
    return new Intl.DateTimeFormat('pt-BR', timeZone ? { ...options, timeZone } : options).format(new Date(epoch));
  } catch {
    return new Intl.DateTimeFormat('pt-BR', options).format(new Date(epoch));
  }
}

export function appointmentServicesLabel(appointment) {
  const metadata = asObject(appointment?.raw?.metadata);
  const services = (Array.isArray(metadata.services) ? metadata.services : [])
    .map((service) => String(service || '').trim())
    .filter(Boolean);
  return services.length ? services.join(' + ') : String(appointment?.title || '').trim();
}

export function appointmentAgendaItem(appointment, { timeZone } = {}) {
  const metadata = asObject(appointment?.raw?.metadata);
  const start = startsAtEpoch(appointment);
  return {
    id: appointment?.id,
    client: String(appointment?.contactName || '').trim() || 'Sem nome',
    services: appointmentServicesLabel(appointment),
    weekday: start === null ? '' : formatPart(start, timeZone, { weekday: 'long' }),
    date: start === null ? 'Sem data' : formatPart(start, timeZone, { day: '2-digit', month: '2-digit', year: 'numeric' }),
    time: start === null ? '' : formatPart(start, timeZone, { hour: '2-digit', minute: '2-digit' }),
    professional: String(metadata.professional || '').trim(),
    firstVisit: metadata.first_visit ? String(metadata.first_visit) : '',
    status: String(appointment?.status || ''),
    statusLabel: appointment?.statusLabel || '',
  };
}

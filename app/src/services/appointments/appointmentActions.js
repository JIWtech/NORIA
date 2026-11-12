import { asObject } from '../../utils/asObject.js';
import { availableOutcomes } from './appointmentOutcome.js';

// Editar, cancelar e arquivar um agendamento pelo painel. Nenhuma dessas ações avisa a cliente.
// As RPCs ficam em supabase/migrations/034_appointment_manage_actions.sql (aplicada em 11/11/2026).

const EDITABLE_STATUSES = new Set(['scheduled', 'confirmed', 'reserved', 'pending_payment', 'payment_reported', 'aguardando_verificacao']);

const ERROR_MESSAGES = [
  [/PGRST202|Could not find the function|function .* does not exist/i, 'Esta ação precisa de uma atualização do banco que ainda não foi aplicada. Avise o suporte.'],
  [/SLOT_UNAVAILABLE|INVALID_SESSION_SLOT|LEGACY_BOOKING_REQUIRES_REVIEW/, 'Esse horário não está disponível na agenda. Escolha outro.'],
  [/APPOINTMENT_EDIT_INVALID_STATUS|APPOINTMENT_CLOSE_INVALID_STATUS/, 'Este agendamento não pode mais ser alterado. Atualize a tela.'],
  [/APPOINTMENT_REQUEST_BUSY/, 'O envio da confirmação ainda está em andamento. Aguarde e tente de novo.'],
  [/APPOINTMENT_EDIT_PAST/, 'Escolha uma data e hora futuras.'],
  [/APPOINTMENT_ACTION_FORBIDDEN/, 'Você não tem permissão para alterar este agendamento.'],
  [/APPOINTMENT_NOT_FOUND/, 'Agendamento não encontrado. Atualize a tela e tente de novo.'],
];

function formatParts(epoch, timeZone) {
  const options = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' };
  const parts = new Intl.DateTimeFormat('en-US', timeZone ? { ...options, timeZone } : options).formatToParts(new Date(epoch));
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
}

// Converte data e hora "de parede" do fuso do tenant para ISO em UTC, sem bibliotecas.
export function zonedDateTimeToIso(date, time, timeZone) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(String(time || ''));
  if (!dateMatch || !timeMatch) return null;
  const wall = Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]), Number(timeMatch[1]), Number(timeMatch[2]));
  let guess = wall;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = formatParts(guess, timeZone);
    const shown = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    guess = wall - (shown - guess);
  }
  return new Date(guess).toISOString();
}

function cleanServices(services) {
  return (Array.isArray(services) ? services : []).map((service) => String(service || '').trim()).filter(Boolean);
}

export function appointmentEditDraft(appointment, { timeZone } = {}) {
  const metadata = asObject(appointment?.raw?.metadata);
  const start = Date.parse(appointment?.startsAt || '');
  const parts = Number.isFinite(start) ? formatParts(start, timeZone) : null;
  const pad = (value) => String(value).padStart(2, '0');
  const services = cleanServices(metadata.services);
  return {
    date: parts ? `${parts.year}-${pad(parts.month)}-${pad(parts.day)}` : '',
    time: parts ? `${pad(parts.hour)}:${pad(parts.minute)}` : '',
    services: services.length ? services : cleanServices([appointment?.title]),
    professional: String(metadata.professional || ''),
    notes: String(appointment?.notes || ''),
  };
}

export function buildAppointmentUpdate(appointment, draft, { timeZone } = {}) {
  const startsAt = zonedDateTimeToIso(draft?.date, draft?.time, timeZone);
  if (!startsAt) throw new Error('Informe a data e a hora do agendamento.');
  const services = cleanServices(draft?.services);
  if (!services.length) throw new Error('Informe ao menos um serviço.');
  const current = appointmentEditDraft(appointment, { timeZone });
  const changes = {};
  if (Date.parse(startsAt) !== Date.parse(appointment?.startsAt || '')) changes.p_starts_at = startsAt;
  if (JSON.stringify(services) !== JSON.stringify(current.services)) changes.p_services = services;
  const professional = String(draft?.professional || '').trim();
  if (professional !== current.professional.trim()) changes.p_professional = professional;
  const notes = String(draft?.notes || '').trim();
  if (notes !== current.notes.trim()) changes.p_notes = notes;
  return changes;
}

export function appointmentActionsFor(appointment, { now = Date.now(), outcomeTracking = false } = {}) {
  const status = String(appointment?.status || '').trim().toLowerCase();
  const actions = [];
  if (status === 'pending_confirmation') actions.push('cancel');
  if (EDITABLE_STATUSES.has(status)) {
    actions.push('edit', 'cancel');
    const start = Date.parse(appointment?.startsAt || '');
    if (Number.isFinite(start) && start <= now) actions.push('archive');
  }
  if (outcomeTracking) actions.push(...availableOutcomes(appointment, now));
  return actions;
}

function friendlyError(error, fallback) {
  const text = `${error?.code || ''} ${error?.message || ''}`;
  return ERROR_MESSAGES.find(([pattern]) => pattern.test(text))?.[1] || error?.message || fallback;
}

export function createAppointmentActions({ getClient }) {
  async function call(name, args, fallback) {
    const supabase = getClient();
    if (!supabase) throw new Error('Supabase não configurado.');
    const { data, error } = await supabase.rpc(name, args);
    if (error) throw new Error(friendlyError(error, fallback));
    return data;
  }

  return {
    async updateAppointment(appointmentId, changes = {}) {
      if (!Object.keys(changes).length) throw new Error('Nada para salvar.');
      return call('magia_update_appointment', { p_appointment: appointmentId, ...changes }, 'Não foi possível salvar o agendamento.');
    },
    cancelAppointment(appointmentId, note = '') {
      return call('magia_close_appointment', { p_appointment: appointmentId, p_action: 'cancel', p_note: String(note || '').trim() || null },
        'Não foi possível cancelar o agendamento.');
    },
    archiveAppointment(appointmentId, note = '') {
      return call('magia_close_appointment', { p_appointment: appointmentId, p_action: 'archive', p_note: String(note || '').trim() || null },
        'Não foi possível arquivar o agendamento.');
    },
  };
}

import { canonicalConversationKey } from '../identity/conversationIdentity.js';

// Desfecho de um agendamento: "cliente compareceu" (attended) ou "cliente não veio" (no_show).
// A regra de negócio (quem faltou passa a exigir sinal) mora no banco: ver
// supabase/migrations/030_appointment_outcomes_no_show.sql.

const OPEN_STATUSES = new Set(['scheduled', 'confirmed', 'pending_payment', 'payment_reported', 'reserved']);
const OUTCOMES = new Set(['attended', 'no_show']);

const ERROR_MESSAGES = {
  APPOINTMENT_NOT_STARTED: 'O horário deste agendamento ainda não começou.',
  APPOINTMENT_OUTCOME_FORBIDDEN: 'Você não tem permissão para registrar este desfecho.',
  APPOINTMENT_NOT_FOUND: 'Agendamento não encontrado. Atualize a tela e tente de novo.',
  APPOINTMENT_OUTCOME_INVALID_STATUS: 'Este agendamento não aceita esse desfecho no status atual.',
  APPOINTMENT_OUTCOME_INVALID: 'Desfecho inválido.',
};

// O recurso só aparece para tenants que o ligaram (settings.appointment_outcome_tracking === true),
// para que o painel dos demais clientes continue exatamente como está.
export function isOutcomeTrackingEnabled(tenantSettings) {
  return tenantSettings?.settings?.appointment_outcome_tracking === true;
}

export function availableOutcomes(appointment, now = Date.now()) {
  if (!appointment) return [];
  const startsAt = Date.parse(appointment.startsAt || appointment.starts_at || '');
  if (!Number.isFinite(startsAt) || startsAt > now) return [];
  const status = String(appointment.status || '').trim().toLowerCase();
  if (OPEN_STATUSES.has(status)) return ['attended', 'no_show'];
  if (status === 'no_show') return ['attended'];
  if (status === 'completed' || status === 'done') return ['no_show'];
  return [];
}

export function buildDepositRequiredIndex(rows) {
  const index = new Map();
  for (const item of Array.isArray(rows) ? rows : []) {
    if (!item?.external_conversation_id) continue;
    index.set(canonicalConversationKey(item.channel_type, item.external_conversation_id), {
      appointmentId: item.appointment_id || null,
      lastNoShowAt: item.last_no_show_at || null,
    });
  }
  return index;
}

export function isDepositRequired(index, channelType, externalConversationId) {
  if (!(index instanceof Map) || !index.size || !externalConversationId) return null;
  return index.get(canonicalConversationKey(channelType, externalConversationId)) || null;
}

export function createMarkAppointmentOutcome({ getClient }) {
  async function markAppointmentOutcome(appointmentId, outcome, note = '') {
    if (!OUTCOMES.has(outcome)) throw new Error(ERROR_MESSAGES.APPOINTMENT_OUTCOME_INVALID);
    const supabase = getClient();
    if (!supabase) throw new Error('Supabase não configurado.');
    const { data, error } = await supabase.rpc('magia_mark_appointment_outcome', {
      p_appointment: appointmentId,
      p_outcome: outcome,
      p_note: String(note || '').trim() || null,
    });
    if (error) {
      const known = Object.keys(ERROR_MESSAGES).find((code) => String(error.message || '').includes(code));
      throw new Error(known ? ERROR_MESSAGES[known] : (error.message || 'Não foi possível registrar o desfecho.'));
    }
    return data;
  }
  return markAppointmentOutcome;
}

// Nunca derruba a tela: qualquer falha vira "ninguém exige sinal" e o painel segue funcionando.
export function createLoadDepositRequired({ getClient, loadTenant }) {
  async function loadDepositRequired(activeTenantSlug) {
    try {
      const supabase = getClient();
      if (!supabase) return new Map();
      const tenant = await loadTenant(activeTenantSlug);
      if (!tenant?.id) return new Map();
      const { data, error } = await supabase.rpc('magia_deposit_required_contacts', { p_tenant: tenant.id });
      if (error) {
        console.warn('Deposit-required fallback:', error.message);
        return new Map();
      }
      return buildDepositRequiredIndex(data);
    } catch (error) {
      console.warn('Deposit-required fallback:', error?.message || error);
      return new Map();
    }
  }
  return loadDepositRequired;
}

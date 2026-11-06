import { userFacingError } from '../../utils/userFacingError.js';

// Pedido de agendamento aguardando confirmação do dono (status pending_confirmation, migração 031).
// O servidor confere versão e horário de novo: aqui só se decide o que o cartão mostra.

export function appointmentRequestState({ startsAt, metadata } = {}, { now = Date.now(), staleHours = 0 } = {}) {
  const data = metadata || {};
  const version = Number(data.request_version) || 0;
  const expired = Date.parse(startsAt || '') <= now;
  const uncertain = Boolean(data.confirmation_state);
  const updatedAt = Date.parse(data.request_updated_at || '');
  const stale = Number(staleHours) > 0 && Number.isFinite(updatedAt) && now - updatedAt >= Number(staleHours) * 3600000;
  return {
    services: Array.isArray(data.services) ? data.services : [],
    professional: data.professional || '',
    firstVisit: data.first_visit || '',
    durationUnknown: !data.duration_minutes,
    version,
    expired,
    stale,
    uncertain,
    canConfirm: !expired && !uncertain,
    canReject: !uncertain,
  };
}

// Os motivos de recusa do comando ajudam o dono a decidir; qualquer outro erro continua genérico.
const REFUSALS = [
  [/alterado pela cliente/, 'A cliente mudou este pedido. Confira os dados e tente de novo.'],
  [/alterado por outro operador|alterado simultaneamente/, 'Outra pessoa alterou este pedido. Confira os dados e tente de novo.'],
  [/entrega (?:nao comprovada|incerta)/i, 'Não deu para comprovar a entrega. Veja no WhatsApp se a mensagem chegou.'],
  [/horario deste pedido ja passou/, 'O horário deste pedido já passou. Sugira outro horário à cliente.'],
  [/nao esta mais aguardando confirmacao/, 'Este pedido já foi resolvido.'],
];

export function appointmentRequestErrorMessage(error, fallback) {
  const message = String(error?.message || '');
  return REFUSALS.find(([pattern]) => pattern.test(message))?.[1] || userFacingError(error, fallback);
}

// A leitura geral para em 200 agendamentos: pedidos abertos entram por consulta própria.
export function mergeOpenAppointmentRequests(appointments = [], openRequests = []) {
  const known = new Set(appointments.map((item) => item.id));
  return [...appointments, ...openRequests.filter((item) => !known.has(item.id))];
}

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

// A leitura geral para em 200 agendamentos: pedidos abertos entram por consulta própria.
export function mergeOpenAppointmentRequests(appointments = [], openRequests = []) {
  const known = new Set(appointments.map((item) => item.id));
  return [...appointments, ...openRequests.filter((item) => !known.has(item.id))];
}

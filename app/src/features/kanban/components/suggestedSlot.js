import { zonedDateTimeToIso } from '../../../services/appointments/appointmentActions.js';

// Valida no painel o que o servidor valida de novo: data e hora futuras no fuso do tenant.
export function buildSuggestedSlot(mode, date, time, suggestionEnabled = false, { timeZone, now = Date.now() } = {}) {
  if (mode === 'ask' || !suggestionEnabled) return {};
  if (mode !== 'propose' || !date || !time) throw new Error('Informe a data e hora da sugestão.');
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null;
  const realDate = Boolean(parsed) && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
  const iso = realDate && /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? zonedDateTimeToIso(date, time, timeZone) : null;
  if (!iso || Number.isNaN(Date.parse(iso))) throw new Error('Data ou hora inválida. Confira os campos.');
  if (Date.parse(iso) <= now) throw new Error('Escolha uma data e hora futuras.');
  return { suggested_date: date, suggested_time: time };
}

// Agendamento escolhido pelo operador (campo datetime-local, no fuso do navegador) convertido para ISO.
// É só a intenção do operador: o servidor aplica max(agendamento, agora) com o relógio do banco.
export function scheduleInputToIso(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(text)) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

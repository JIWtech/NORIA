// Estado da proposta de horário para a equipe ver no Kanban depois do envio (o pedido cancelado some do quadro).
// O banco guarda o estado em appointments.metadata.slot_proposal; aqui só se escolhe o texto do selo.
// Prazo padrão igual ao do banco e do motor: appointment_request.slot_proposal_ttl_hours (padrão 48 h).

export const SLOT_PROPOSAL_DEFAULT_TTL_HOURS = 48;
// Respostas já resolvidas ficam visíveis por pouco tempo; depois disso o selo sai para não poluir o cartão.
const RESOLVED_VISIBLE_HOURS = 72;
const HOUR = 3600000;

function ttlHours(value) {
  const hours = Number(value);
  return Number.isFinite(hours) && hours > 0 ? hours : SLOT_PROPOSAL_DEFAULT_TTL_HOURS;
}

// Para propostas de pedidos cancelados (enviada, recusada, substituída) e para o pedido reaberto por aceite.
export function slotProposalBadge(proposal, { now = Date.now(), ttl } = {}) {
  if (!proposal || typeof proposal !== 'object' || !proposal.status) return null;
  const slot = [proposal.date && String(proposal.date).split('-').reverse().slice(0, 2).join('/'), proposal.time].filter(Boolean).join(' às ');
  const detail = slot ? ` (${slot})` : '';
  const at = (field) => Date.parse(proposal[field] || '');
  const recent = (field) => { const stamp = at(field); return !Number.isFinite(stamp) || now - stamp <= RESOLVED_VISIBLE_HOURS * HOUR; };
  if (proposal.status === 'sent') {
    const sent = at('sent_at');
    if (Number.isFinite(sent) && now - sent > ttlHours(ttl) * HOUR) {
      return recent('sent_at') ? { key: 'expired', tone: 'neutral', label: `Proposta expirada sem resposta${detail}` } : null;
    }
    return { key: 'awaiting', tone: 'info', label: `Proposta enviada, aguardando resposta${detail}` };
  }
  if (proposal.status === 'rejected') return recent('resolved_at') ? { key: 'declined', tone: 'warning', label: `Proposta recusada pela pessoa${detail}` } : null;
  if (proposal.status === 'superseded') return recent('sent_at') ? { key: 'superseded', tone: 'neutral', label: `Proposta substituída${detail}` } : null;
  if (proposal.status === 'accepted') return { key: 'accepted', tone: 'success', label: `Pedido reaberto: a pessoa aceitou a proposta${detail}` };
  return null;
}

const SHOWN_ON_CANCELLED = new Set(['sent', 'rejected', 'superseded']);

// Último agendamento cancelado de cada conversa que carrega uma proposta. A chave de conversa vem de quem chama.
export function latestSlotProposalByConversation(appointments, keyOf) {
  const latest = new Map();
  for (const appointment of appointments || []) {
    if (!['cancelled', 'canceled'].includes(appointment?.status)) continue;
    const proposal = appointment.raw?.metadata?.slot_proposal;
    if (!proposal || !SHOWN_ON_CANCELLED.has(proposal.status)) continue;
    const key = keyOf(appointment);
    const stamp = Date.parse(proposal.resolved_at || proposal.sent_at || appointment.raw?.updated_at || '') || 0;
    const current = latest.get(key);
    if (!current || (proposal.status === 'sent' && current.proposal.status !== 'sent')
      || ((proposal.status === 'sent') === (current.proposal.status === 'sent') && stamp > current.stamp)) {
      latest.set(key, { stamp, proposal: { ...proposal, appointmentId: appointment.id } });
    }
  }
  return new Map([...latest].map(([key, value]) => [key, value.proposal]));
}

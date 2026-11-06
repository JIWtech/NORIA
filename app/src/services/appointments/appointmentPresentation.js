import { formatDate } from '../../utils/dateFormatting.js';
import { normalizeChannel } from '../identity/conversationIdentity.js';

export function mapAppointment(row) {
  const starts = row.starts_at ? new Date(row.starts_at) : null;
  const ends = row.ends_at ? new Date(row.ends_at) : null;
  return {
    id: row.id,
    title: row.title,
    contactName: row.contact_name || row.metadata?.contact_name || '',
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    when: starts ? formatDate(row.starts_at) : 'Sem data',
    dateKey: starts ? starts.toISOString().slice(0, 10) : '',
    timeLabel: starts ? starts.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '',
    endTimeLabel: ends ? ends.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '',
    status: row.status || 'scheduled',
    statusLabel: statusAppointmentLabel(row.status),
    unitName: row.metadata?.unit_name || '',
    notes: row.notes || '',
    channelType: row.channel_type || 'manual',
    channelLabel: normalizeChannel(row.channel_type || 'manual').label,
    externalConversationId: row.external_conversation_id || '',
    raw: row,
  };
}

function statusAppointmentLabel(status) {
  const labels = {
    scheduled: 'Agendado', confirmed: 'Confirmado', pending_payment: 'Aguardando sinal', done: 'Concluido',
    cancelled: 'Cancelado', payment_reported: 'Pagamento informado', aguardando_verificacao: 'Pagamento informado',
    no_show: 'Não compareceu', completed: 'Compareceu', pending_confirmation: 'Aguardando confirmação',
  };
  return labels[status] || status || 'Agendado';
}

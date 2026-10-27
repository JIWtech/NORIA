import { getAuthClient } from '../../services/auth/authService.js';

export const INBOX_CONTRACT = 'noria_turn_inbox_v1';

export function notificationError(error) {
  if (error?.code === 'PGRST202' || error?.code === '42883') {
    return 'O histórico de avisos de atendimento está temporariamente indisponível.';
  }
  if (error?.message?.includes('TURN_REVIEW_FORBIDDEN') || error?.code === '42501') {
    return 'Sua conta não tem acesso ao histórico de avisos desta empresa.';
  }
  return 'Não foi possível sincronizar as notificações. Tentaremos reconectar.';
}

export async function inboxRpc(name, params, signal) {
  const client = getAuthClient();
  if (!client) throw new Error('INBOX_NOT_CONFIGURED');
  const { data, error } = await client.rpc(name, params).abortSignal(signal);
  if (error) throw error;
  if (data?.contract !== INBOX_CONTRACT) throw new Error('INBOX_CONTRACT_MISMATCH');
  return data;
}

export function validateInboxPage(data, tenantId, pageSize = 100) {
  if (data?.tenant_id !== tenantId || !Array.isArray(data.items)
    || !Number.isSafeInteger(data.unread_count) || data.unread_count < 0
    || typeof data.has_more !== 'boolean' || !Number.isFinite(Date.parse(data.as_of))
    || data.items.length > pageSize || new Set(data.items.map((item) => item.id)).size !== data.items.length
    || data.items.some((item) => item.tenant_id !== tenantId || !item.id
      || !Number.isSafeInteger(item.revision) || item.revision < 1
      || !Number.isSafeInteger(item.ticket_revision) || item.ticket_revision < 1
      || !['review', 'uncertain'].includes(item.phase)
      || (item.resolved_at !== null && !Number.isFinite(Date.parse(item.resolved_at)))
      || typeof item.unread !== 'boolean' || !Number.isFinite(Date.parse(item.created_at)))) {
    throw new Error('INBOX_CONTRACT_MISMATCH');
  }
  return data;
}

export function validateInboxRead(data, tenantId) {
  if (data?.tenant_id !== tenantId || data.read !== true
    || !Number.isSafeInteger(data.count) || data.count < 0
    || !Number.isSafeInteger(data.unread_count) || data.unread_count < 0) {
    throw new Error('INBOX_READ_NOT_CONFIRMED');
  }
  return data;
}

export const HUMAN_REPLY_OVERDUE_MS = 15 * 60_000;
const HUMAN_REPLY_LIMIT = 500;
const openPending = (item) => !item.resolved_at && item.chat_id && Number.isFinite(Date.parse(item.created_at));

// Só uma mensagem da equipe efetivamente enviada conta como resposta; envio técnico, da IA ou com falha não resolve.
function isHumanReply(row, tenantId) {
  return row?.tenant_id === tenantId && row.direction === 'outbound' && row.ai_provider === 'human_operator'
    && row.sender_type === 'agent' && row.delivery_status === 'sent' && Number.isFinite(Date.parse(row.created_at));
}

// Somente leitura: respostas da equipe nas conversas com pendência aberta da página exibida.
// Retorna null quando não dá para afirmar a ausência de resposta (erro ou resultado truncado).
export async function fetchHumanReplies(tenantId, items, signal, client = getAuthClient()) {
  const open = items.filter(openPending);
  if (!open.length) return [];
  if (!client || !tenantId) return null;
  const since = new Date(Math.min(...open.map((item) => Date.parse(item.created_at)))).toISOString();
  let query = client.from('channel_events')
    .select('tenant_id,external_conversation_id,channel_type,direction,ai_provider,sender_type,delivery_status,created_at')
    .eq('tenant_id', tenantId).eq('direction', 'outbound').eq('ai_provider', 'human_operator')
    .eq('sender_type', 'agent').eq('delivery_status', 'sent')
    .in('external_conversation_id', [...new Set(open.map((item) => item.chat_id))])
    .gte('created_at', since).order('created_at', { ascending: false }).limit(HUMAN_REPLY_LIMIT);
  if (signal) query = query.abortSignal(signal);
  try {
    const { data, error } = await query;
    if (error || !Array.isArray(data) || data.length >= HUMAN_REPLY_LIMIT) return null;
    return data;
  } catch { return null; }
}

// waiting | overdue | answered; null mantém o aviso original (sem dados confiáveis ou pendência encerrada).
export function humanReplyStatus(item, replies, tenantId, now = Date.now()) {
  if (!Array.isArray(replies) || !openPending(item)) return null;
  const opened = Date.parse(item.created_at);
  const channel = item.channel_type || 'whatsapp';
  const answered = replies.some((row) => isHumanReply(row, tenantId) && row.external_conversation_id === item.chat_id
    && (row.channel_type || 'whatsapp') === channel && Date.parse(row.created_at) > opened);
  if (answered) return 'answered';
  return now - opened >= HUMAN_REPLY_OVERDUE_MS ? 'overdue' : 'waiting';
}

export function incidentPresentation(item, replyStatus = null) {
  if (item.resolved_at) return {
    title: 'Pendência de atendimento resolvida', status: 'Resolvido', kind: 'closed',
    description: 'A pendência foi encerrada. Abra a conversa para acompanhar o atendimento.',
  };
  if (replyStatus === 'answered') return {
    title: 'Equipe já respondeu o cliente', status: 'Respondido', kind: 'answered', attention: false,
    description: 'Uma pessoa da equipe enviou mensagem depois do pedido. Abra a conversa para acompanhar.',
  };
  if (replyStatus === 'overdue') return {
    title: 'Cliente sem resposta da equipe', status: 'Precisa de atenção', kind: 'overdue', attention: true, overdue: true,
    description: item.phase === 'uncertain'
      ? 'A entrega não foi confirmada e ninguém da equipe respondeu há mais de 15 minutos. Confira a conversa antes de enviar novamente.'
      : 'Ninguém da equipe respondeu há mais de 15 minutos. Abra a conversa para atender o cliente.',
  };
  if (replyStatus === 'waiting' && item.phase !== 'uncertain') return {
    title: 'Cliente aguardando a equipe', status: 'Precisa de atenção', kind: 'waiting', attention: true,
    description: 'A IA pediu ajuda da equipe e o cliente ainda não recebeu resposta. Abra a conversa para atender.',
  };
  if (item.phase === 'uncertain') return {
    title: 'Confira o envio da mensagem', status: 'Precisa de atenção', kind: 'uncertain',
    description: 'A entrega ainda não foi confirmada. Confira a conversa antes de enviar novamente.',
  };
  return {
    title: 'Atendimento precisa da equipe', status: 'Precisa de atenção', kind: 'review',
    description: 'A IA não conseguiu continuar este atendimento. Abra a conversa para ajudar o cliente.',
  };
}

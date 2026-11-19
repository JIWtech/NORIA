import { normalizeExternalConversationId } from '../../services/identity/conversationIdentity.js';

// Identidade visual por situação: o atendente reconhece o caso pela cor e pelo rótulo, sem ler o texto.
// Cada situação tem um tom (classe CSS data-situation) e um rótulo curto.
export const SITUATIONS = {
  'waiting-team': { label: 'Aguardando equipe', icon: 'headset' },
  payment: { label: 'Pagamento', icon: 'receipt' },
  agenda: { label: 'Agenda', icon: 'calendar' },
  message: { label: 'Mensagem', icon: 'message' },
  ai: { label: 'IA', icon: 'bot' },
  assigned: { label: 'Atribuída', icon: 'user' },
  done: { label: 'Concluído', icon: 'check' },
  kanban: { label: 'Kanban', icon: 'kanban' },
  problem: { label: 'Falha', icon: 'alert' },
  info: { label: 'Aviso', icon: 'bell' },
};

const byKind = {
  handoff: 'waiting-team', 'team-review': 'waiting-team', waiting: 'waiting-team', overdue: 'waiting-team', review: 'waiting-team',
  payment: 'payment', 'deposit-review': 'payment', 'payment-confirmed': 'payment',
  'appointment-request': 'agenda', reminder: 'agenda', 'appointment-cancelled': 'agenda', appointment: 'agenda',
  message: 'message',
  resumed: 'ai',
  assignment: 'assigned',
  closed: 'done', answered: 'done', reopened: 'assigned',
  stage: 'kanban', 'lead-stage': 'kanban', lead: 'kanban', 'hot-lead': 'kanban', followup: 'kanban', 'followup-due': 'kanban',
  delivery: 'problem', uncertain: 'problem', attachment: 'problem', interrupted: 'problem', connection: 'problem',
};
const byCategory = { leads: 'kanban', appointments: 'agenda', attention: 'waiting-team', conversations: 'message', campaigns: 'info' };

export function situationOf(item = {}) {
  const status = item.appointmentStatus;
  const key = (['pending_payment', 'payment_reported', 'aguardando_verificacao'].includes(status) && 'payment')
    || byKind[item.kind] || byCategory[item.category] || 'info';
  return { key, ...SITUATIONS[key], urgent: Boolean(item.overdue) };
}

// Completa a foto do cliente: conversa carregada primeiro e, se não houver, o card do Kanban do mesmo chat.
export function attachAvatars(items, { conversations = [], kanbanColumns = [] } = {}) {
  const avatars = new Map();
  const keyOf = (channel, chatId) => chatId && `${channel || 'whatsapp'}:${normalizeExternalConversationId(channel || 'whatsapp', chatId)}`;
  for (const card of kanbanColumns.flatMap(column => column.cards || [])) {
    const key = keyOf(card.channelType, card.externalConversationId);
    if (key && card.avatarUrl) avatars.set(key, card.avatarUrl);
  }
  for (const conversation of conversations) {
    const key = keyOf(conversation.channelType, conversation.externalConversationId);
    if (key && conversation.avatarUrl) avatars.set(key, conversation.avatarUrl);
  }
  return items.map(item => {
    if (item.avatarUrl) return item;
    const avatarUrl = avatars.get(keyOf(item.channel, item.chatId));
    return avatarUrl ? { ...item, avatarUrl } : item;
  });
}

import { isConversationClosed } from '../conversations/conversationLifecycle.js';
import { visibleAgentName } from '../agents/agentNames.js';

export function isConversationWaitingForFollowUp(conv = {}) {
  const status = String(conv.status || '').toLowerCase();
  const stage = String(conv.stage || '').toLowerCase();
  if (status === 'finalizado' || stage === 'finalizado') {
    return false;
  }
  const followUpAt = conv.latestFollowUpAt;
  if (!followUpAt) return false;
  const followUpTime = Date.parse(followUpAt);
  if (Number.isNaN(followUpTime) || followUpTime <= 0) return false;

  const inboundAt = conv.latestCustomerInboundAt;
  if (!inboundAt) {
    return true;
  }
  const inboundTime = Date.parse(inboundAt);
  if (Number.isNaN(inboundTime) || inboundTime <= 0) {
    return true;
  }

  return followUpTime > inboundTime;
}

export function isCustomerInboundEvent(event = {}, isInternalOperationalEvent = () => false) {
  if (!event || isInternalOperationalEvent(event)) return false;
  return String(event.direction || '').toLowerCase() === 'inbound' && String(event.sender_type || '').toLowerCase() !== 'system';
}

export function isFollowUpOutboundEvent(event = {}, isInternalOperationalEvent = () => false) {
  if (!event || isInternalOperationalEvent(event)) return false;
  const service = String(event.service || '').toLowerCase().trim();
  return String(event.direction || '').toLowerCase() === 'outbound' && (service === 'follow_up' || service === 'follow-up');
}

export function formatWaitingDuration(isoString, now = Date.now()) {
  if (!isoString) return 'Aguardando cliente';
  const ts = typeof isoString === 'number' ? isoString : Date.parse(isoString);
  if (Number.isNaN(ts) || ts <= 0) return 'Aguardando cliente';
  const diffMs = Math.max(0, now - ts);
  const diffMins = Math.floor(diffMs / (60 * 1000));
  if (diffMins < 1) return 'Aguardando cliente';
  if (diffMins < 60) return `Aguardando cliente há ${diffMins}m`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `Aguardando cliente há ${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  return `Aguardando cliente há ${diffDays}d`;
}

export function matchesResponsibleFilter(conversation = {}, filter = 'todos') {
  if (!filter || filter === 'todos') return true;

  const isHuman = conversation.status === 'atendimento_humano'
    || conversation.ownerKind === 'agent'
    || (Boolean(conversation.owner) && conversation.owner !== 'Assistente IA' && !['Operador NORIA', 'Disparo NORIA'].includes(conversation.owner));

  const isAi = !isHuman && (
    conversation.status === 'ia_ativa'
    || conversation.ownerKind === 'ai'
    || conversation.owner === 'Assistente IA'
    || !conversation.owner
  );

  if (filter === 'ia') return isAi;
  if (filter === 'humano' || filter === 'humanas') return isHuman;

  if (filter) {
    const filterStr = String(filter).trim().toLowerCase();
    const ownerName = String(conversation.owner || '').trim().toLowerCase();
    const ownerId = String(conversation.ownerId || '').trim().toLowerCase();
    if (ownerName === filterStr || ownerId === filterStr) return true;
    if (isHuman && (!ownerName || ['atendimento humano', 'atendente', 'operador noria', 'operador mag.ia'].includes(ownerName))) {
      return true;
    }
    return false;
  }

  return true;
}

export function matchesConversationTab(conversation, tab = 'ativas') {
  if (!conversation) return false;
  const closed = isConversationClosed(conversation);

  if (tab === 'encerradas') {
    return closed;
  }

  // Conversas encerradas NUNCA pertencem a ativas, nao_lidas ou follow_up
  if (closed) {
    return false;
  }

  if (tab === 'ativas') {
    return !conversation.waitingForFollowUp;
  }

  if (tab === 'nao_lidas') {
    return (conversation.unread || 0) > 0;
  }

  if (tab === 'follow_up') {
    return Boolean(conversation.waitingForFollowUp);
  }

  return true;
}

export function sortConversationsForTab(conversations = [], tab = 'ativas') {
  if (!Array.isArray(conversations)) return [];
  return [...conversations].sort((a, b) => {
    if (tab === 'follow_up') {
      const tA = Date.parse(a.waitingSince || a.latestFollowUpAt || a.lastActivityAt || 0) || 0;
      const tB = Date.parse(b.waitingSince || b.latestFollowUpAt || b.lastActivityAt || 0) || 0;
      if (tB !== tA) return tB - tA;
    }
    if (tab === 'encerradas') {
      const tA = Date.parse(a.lastActivityAt || a.closedAt || 0) || 0;
      const tB = Date.parse(b.lastActivityAt || b.closedAt || 0) || 0;
      if (tB !== tA) return tB - tA;
    }
    const tA = Date.parse(a.lastActivityAt || 0) || 0;
    const tB = Date.parse(b.lastActivityAt || 0) || 0;
    return tB - tA;
  });
}

export function getConversationTabCounts(conversations = []) {
  if (!Array.isArray(conversations)) {
    return { ativas: 0, naoLidas: 0, encerradas: 0, followUp: 0, activeCount: 0, unreadCount: 0, closedCount: 0, followUpCount: 0 };
  }
  let ativas = 0;
  let naoLidas = 0;
  let followUp = 0;
  let encerradas = 0;

  for (const c of conversations) {
    if (isConversationClosed(c)) {
      encerradas += 1;
      continue;
    }
    if (c.waitingForFollowUp) {
      followUp += 1;
    } else {
      ativas += 1;
    }
    if ((c.unread || 0) > 0) {
      naoLidas += 1;
    }
  }

  return {
    ativas,
    naoLidas,
    followUp,
    encerradas,
    activeCount: ativas,
    unreadCount: naoLidas,
    closedCount: encerradas,
    followUpCount: followUp,
  };
}

export function formatConversationCardOrigin(conversation = {}) {
  if (conversation.waitingForFollowUp && conversation.lastMessageSenderType === 'ai') {
    return 'Follow-up';
  }
  const senderType = conversation.lastMessageSenderType;
  const rawSender = conversation.lastMessageSender;
  const sender = visibleAgentName(rawSender);

  if (senderType === 'contact' || sender === 'Cliente') {
    return 'Cliente';
  }
  if (senderType === 'ai' || sender === 'IA') {
    return 'IA';
  }
  if (senderType === 'agent' || senderType === 'human' || sender === 'Atendente') {
    return sender || (rawSender ? 'Atendente' : 'Você');
  }
  if (senderType === 'system') return 'Sistema';
  if (sender) return sender;
  return 'Cliente';
}

export function formatMediaPreviewWithIcon(previewText) {
  const text = String(previewText || '').trim();
  const lower = text.toLowerCase();

  if (lower === 'áudio' || lower === '[audio]' || lower === 'audio') {
    return { icon: '🎤', text: 'Áudio' };
  }
  if (lower === 'imagem' || lower === '[image]' || lower === 'imagem' || lower === 'foto') {
    return { icon: '📷', text: 'Imagem' };
  }
  if (lower === 'localização' || lower === '[location]' || lower === 'localizacao') {
    return { icon: '📍', text: 'Localização' };
  }
  if (lower === 'figurinha' || lower === '[sticker]') {
    return { icon: '👾', text: 'Figurinha' };
  }
  if (lower === 'documento' || lower === '[document]') {
    return { icon: '📄', text: 'Documento' };
  }
  if (lower.startsWith('áudio:') || lower.startsWith('[audio]:')) {
    return { icon: '🎤', text: text.replace(/^(\[audio\]|áudio):\s*/i, '') };
  }
  if (lower.startsWith('imagem:') || lower.startsWith('[image]:')) {
    return { icon: '📷', text: text.replace(/^(\[image\]|imagem):\s*/i, '') };
  }
  return { icon: null, text };
}

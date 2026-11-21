import { canEventMoveOwnershipToAi, eventSessionId } from './ownershipEvidence.js';

function payloadOf(event) {
  if (typeof event.raw_payload !== 'string') return event.raw_payload || {};
  try { return JSON.parse(event.raw_payload); } catch { return {}; }
}

// Events arrive oldest first. A delayed outbound must not reopen a closed session.
export function applyConversationLifecycle(conversation, event, stage) {
  const closed = stage === 'Finalizado' || event.service === 'conversation_closed'
    || event.ai_provider === 'conversation_closed';
  const session = eventSessionId(event);

  if (closed) {
    conversation.status = 'finalizado';
    conversation.stage = 'Finalizado';
    conversation.closedEventId = event.id || event.external_message_id;
    conversation.closedSessionId = session || conversation.currentSessionId || 'initial';
    conversation.currentSessionId = null;
    conversation.owner = null;
    conversation.ownerId = null;
    conversation.ownerKind = null;
    conversation.handoff = false;
    conversation.currentAssignee = null;
    conversation.currentAssigneeId = null;
    return;
  }

  // Eventos atrasados da sessão que já foi encerrada não podem reabrir nem alterar o atendimento.
  if (session && conversation.closedSessionId && session === conversation.closedSessionId) return;

  const inbound = event.direction === 'inbound' && event.sender_type !== 'system';
  if (conversation.status === 'finalizado' && !inbound) return;
  if (inbound) {
    conversation.lastInboundId = event.id || event.external_message_id || event.created_at;
    if (conversation.status === 'finalizado') {
      conversation.status = 'ia_ativa';
      // O estágio "Finalizado" não pode sobreviver à reabertura: eventos em
      // buffer não o sobrescrevem e o cabeçalho continuaria "encerrado".
      if (String(conversation.stage || '').toLowerCase() === 'finalizado'
        || String(conversation.stage || '').toLowerCase() === 'finalizada') conversation.stage = '';
      conversation.owner = null;
      conversation.ownerId = null;
      conversation.ownerKind = null;
      conversation.handoff = false;
      conversation.currentAssignee = null;
      conversation.currentAssigneeId = null;
    }
  }
  if (session) conversation.currentSessionId = session;
  // A persisted commercial event with AI control is authoritative for the
  // current session. It must supersede an assignee retained from an older
  // handoff; otherwise a reopened conversation keeps showing that agent.
  if (canEventMoveOwnershipToAi(conversation, event, stage)) {
    conversation.status = 'ia_ativa';
    conversation.handoff = false;
    conversation.owner = 'Assistente IA';
    conversation.ownerId = null;
    conversation.ownerKind = 'ai';
    conversation.currentAssignee = null;
    conversation.currentAssigneeId = null;
  }
  if (
    event.handoff
    || stage === 'Atendimento humano'
    || event.stage === 'Atendimento humano'
    || stage === 'sales_human'
    || event.stage === 'sales_human'
    || event.service === 'manual_reply'
    || event.sender_type === 'agent'
    || event.ai_provider === 'human_operator'
    || payloadOf(event)?.magia_operator?.source === 'whatsapp_fromMe'
  ) {
    conversation.status = 'atendimento_humano';
  }
  const isBuffering = stage === 'Buffering' || event.stage === 'Buffering' || event.ai_provider === 'buffer';
  if (!isBuffering && stage) {
    conversation.stage = stage;
  }
}

export function isConversationClosed(conversation) {
  if (!conversation) return false;
  const status = String(conversation.status || '').toLowerCase();
  const stage = String(conversation.stage || '').toLowerCase();
  return status === 'finalizado'
    || stage === 'finalizado'
    || conversation.service === 'conversation_closed'
    || conversation.ai_provider === 'conversation_closed';
}

export function canCloseConversation(conversation, pendingClose) {
  if (!conversation) return false;
  if (isConversationClosed(conversation)) return false;

  const isActive = conversation.status === 'ia_ativa'
    || conversation.status === 'atendimento_humano'
    || Boolean(conversation.handoff)
    || conversation.stage === 'Atendimento humano'
    || conversation.stage === 'sales_human';

  if (!isActive) return false;
  if (!pendingClose) return true;
  // Wait for both the persisted boundary and a new inbound, not just a refresh.
  return Boolean(conversation.closedEventId
    && conversation.closedEventId !== pendingClose.closedEventId
    && conversation.lastInboundId
    && conversation.lastInboundId !== pendingClose.lastInboundId);
}
// "Assumir" só vale com o evento gravado pelo roteador: é ele que pausa a IA no CORE.
// Na revisão da equipe (sem pausar a IA), o roteador grava atendimento_humano.
export function requirePersistedAssignment(result, { reviewOnly = false } = {}) {
  const expected = reviewOnly ? 'atendimento_humano' : 'conversation_assigned';
  // O RPC de controle pode devolver uma linha ou uma lista; o insert REST devolve lista.
  const rows = Array.isArray(result?.saved) ? result.saved : (result?.saved ? [result.saved] : []);
  const event = rows.find(item => item?.id && item.service === expected);
  if (result?.ok !== true || !event) {
    throw new Error('A atribuição não foi confirmada pelo servidor. A IA pode continuar respondendo; tente novamente.');
  }
  return event;
}

export function requirePersistedClosure(result) {
  const closed = result?.saved?.find?.(event => event.id && event.service === 'conversation_closed');
  if (result?.ok !== true || !closed) {
    throw new Error('O encerramento não foi confirmado pelo servidor. Atualize a conversa e tente novamente.');
  }
  return closed;
}

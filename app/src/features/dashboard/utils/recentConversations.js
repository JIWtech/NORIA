import { isConversationClosed } from '../../../services/conversations/conversationLifecycle.js';
import { getStageLabel } from '../../../services/kanban/stageResolution.js';

/**
 * Resolve os rótulos operacionais de uma linha de RecentConversationsTable.
 */
export function resolveRecentConversationRow(item = {}, { kanbanColumns = [], tenantSettings = null, tenantSlug = '' } = {}) {
  const stageLabel = getStageLabel(item?.stage || item?.salesStageKey, { kanbanColumns, tenantSettings, tenantSlug });
  const lowerStage = String(stageLabel || '').trim().toLowerCase();
  const lowerStatus = String(item?.status || '').trim().toLowerCase();

  const isClosed = isConversationClosed(item)
    || lowerStatus === 'finalizada'
    || lowerStatus === 'encerrada'
    || lowerStatus === 'encerrado'
    || lowerStage === 'finalizado'
    || lowerStage === 'finalizada'
    || lowerStage.includes('encerrad');

  const ownerRaw = String(item?.owner || '').trim();
  const ownerLower = ownerRaw.toLowerCase();
  const ownerIsPerson = Boolean(
    ownerRaw
    && ownerRaw !== 'Assistente IA'
    && !ownerLower.includes('sem responsável'),
  );

  const isHuman = !isClosed && (
    lowerStatus === 'atendimento_humano'
    || item?.handoff === true
    || item?.salesAiLocked === true
    || item?.salesLead?.ai_locked === true
    || item?.stage === 'sales_human'
    || item?.salesStageKey === 'sales_human'
    || lowerStage.includes('humano')
    || (ownerIsPerson && item?.ownerKind === 'agent')
  );

  const isExplicitNoOwner = ownerLower.includes('sem responsável')
    || item?.ownerKind === 'none'
    || lowerStatus === 'comercial'
    || lowerStage.includes('abandonad');

  let statusLabel = 'IA ativa';
  let statusTone = 'ia';
  let statusTitle = stageLabel || 'Atendimento por IA';
  if (isClosed) {
    statusLabel = 'Finalizada';
    statusTone = 'closed';
    statusTitle = stageLabel || 'Atendimento finalizado';
  } else if (isHuman) {
    statusLabel = 'Humano';
    statusTone = 'human';
    statusTitle = stageLabel || 'Atendimento humano';
  } else if (isExplicitNoOwner) {
    statusLabel = 'Sem responsável';
    statusTone = 'neutral';
    statusTitle = stageLabel || 'Sem responsável';
  }

  let ownerName = 'Assistente';
  if (isClosed || isHuman) {
    ownerName = ownerIsPerson ? ownerRaw : 'Sem responsável';
  } else if (isExplicitNoOwner) {
    ownerName = 'Sem responsável';
  } else if (ownerIsPerson) {
    ownerName = ownerRaw;
  }

  const senderType = String(item?.lastMessageSenderType || '').trim().toLowerCase();
  const senderNameRaw = String(item?.lastMessageSender || '').trim();
  const senderName = senderNameRaw.toLowerCase();

  const isSystem = senderType === 'system' || senderName === 'sistema';
  const isClient = !isSystem && (
    senderType === 'contact'
    || senderName === 'cliente'
    || senderName === 'contato'
    || senderName.includes('cliente')
    || senderName.includes('contato')
  );
  const isAi = !isSystem && !isClient && (
    senderType === 'ai'
    || senderType === 'assistant'
    || senderType === 'bot'
    || senderName === 'ia'
    || senderName === 'assistente ia'
    || senderName === 'assistente'
    || senderName === 'bot'
  );
  const isAgent = !isSystem && !isClient && !isAi && (
    senderType === 'agent'
    || senderType === 'human'
    || senderType === 'operator'
    || senderType === 'atendente'
    || senderName.includes('atendente')
    || senderName === 'equipe'
    || Boolean(senderName)
  );

  let originLabel = isHuman ? 'Equipe' : 'IA';
  let originTone = isHuman ? 'atendente' : 'ia';
  if (isSystem) {
    originLabel = 'Sistema';
    originTone = 'sistema';
  } else if (isClient) {
    originLabel = 'Cliente';
    originTone = 'cliente';
  } else if (isAi) {
    originLabel = 'IA';
    originTone = 'ia';
  } else if (isAgent) {
    originLabel = 'Equipe';
    originTone = 'atendente';
  }

  return {
    stageLabel,
    isClosed,
    isHuman,
    statusLabel,
    statusTone,
    statusTitle,
    ownerName,
    originLabel,
    originTone,
  };
}

import { asObject } from '../../utils/asObject.js';
import { formatDate } from '../../utils/dateFormatting.js';
import { isInternalOperationalEvent } from '../timeline/eventClassification.js';
import { TECHNICAL_MEDIA_LABELS } from '../../utils/audioUtils.js';
import { canonicalConversationKey, normalizeChannel, normalizeExternalConversationId } from '../identity/conversationIdentity.js';
import { normalizeStage, normalizeLocation, resolveConversationOwnerDetails } from '../conversations/conversationPresentation.js';
import { normalizeMedia } from '../media/mediaNormalization.js';
import { isGeneratedMediaLabel, mediaPreview } from '../media/mediaPresentation.js';
import { extractPayloadAvatar } from '../contacts/contactPayload.js';
import { normalizeAvatarUrl } from '../contacts/contactIdentity.js';
import { cleanAgentName } from '../agents/agentNames.js';
import { canEventMoveOwnershipToAi } from '../conversations/ownershipEvidence.js';

import { findKanbanColumn } from './stageResolution.js';
import { closedColumnReason, isClosedKanbanColumn } from './kanbanCardReason.js';
import { isGenesisSalesTenant } from './commercialStages.js';

function resolveEventTargetColumn(event, card, resolvedTenant, columns) {
  const payload = asObject(event?.raw_payload);
  const isGenesis = isGenesisSalesTenant(resolvedTenant);

  // 1. Explicit manual transition in raw_payload
  const manualTransition = payload?.kanban_transition?.to_column;
  if (manualTransition) {
    const col = findKanbanColumn(columns, manualTransition);
    if (col) return col;
  }

  // 2. Closed conversation
  const isClosed = normalizeStage(event?.stage) === 'Finalizado'
    || event?.service === 'conversation_closed'
    || event?.ai_provider === 'conversation_closed'
    || payload?.event_type === 'conversation_closed';
  if (isClosed) {
    // Mesma regra da carga completa: falta registrada vai para "Não compareceu" quando o quadro tem a coluna.
    if (!isGenesis && payload?.close_reason === 'no_show') {
      const missedCol = findKanbanColumn(columns, 'nao_compareceu');
      if (missedCol) return missedCol;
    }
    const closedKey = isGenesis ? 'sales_closed' : 'finalizadas';
    const col = findKanbanColumn(columns, closedKey);
    if (col) return col;
  }

  // 3. Sales stage from raw_payload (e.g. sales_financing, sales_human, sales_appraisal, sales_hot, sales_qualifying)
  const rawSalesStage = payload?.sales_stage;
  if (rawSalesStage) {
    const col = findKanbanColumn(columns, rawSalesStage);
    if (col) return col;
  }

  // 4. Handoff or assignment to human
  const isHandoff = Boolean(event?.handoff)
    || event?.service === 'handoff_requested'
    || event?.service === 'conversation_assigned'
    || normalizeStage(event?.stage) === 'Atendimento humano'
    || event?.stage === 'sales_human';
  if (isHandoff) {
    const humanKey = isGenesis ? 'sales_human' : 'conversas_humanos';
    const col = findKanbanColumn(columns, humanKey) || findKanbanColumn(columns, 'com_humano');
    if (col) return col;
  }

  // 5. Stage specified in event.stage (if present and maps to a column)
  if (event?.stage) {
    const col = findKanbanColumn(columns, event.stage);
    if (col) return col;
  }

  return null;
}

export function applyIncomingEventToKanban(columns = [], event, tenantSlug = '', teamAgents = []) {
  if (!event || isInternalOperationalEvent(event) || !Array.isArray(columns)) return columns;
  const channelType = normalizeChannel(event.channel_type);
  const resolvedTenant = tenantSlug || event.tenant_slug || '';
  const canonicalKey = canonicalConversationKey(
    channelType.type,
    event.external_conversation_id,
    event.contact_handle || event.id,
    resolvedTenant,
  );
  const conversationId = `conv-${canonicalKey}`;
  const legacyConversationId = `conv-${event.channel_type || 'unknown'}:${event.external_conversation_id || event.contact_handle || event.id}`;
  const normalizedExtId = normalizeExternalConversationId(
    channelType.type,
    event.external_conversation_id,
    event.contact_handle,
  );
  const trimmedText = String(event.message_text || '').trim().toLowerCase();
  const service = String(event.service || '').toLowerCase();
  const payload = asObject(event.raw_payload);
  const isReaction = service === 'reaction'
    || String(payload?.messageType || '').toLowerCase() === 'reactionmessage'
    || String(payload?.event || '').toLowerCase() === 'messages.reaction'
    || Boolean(payload?.reaction)
    || Boolean(payload?.magia_normalized?.reaction)
    || trimmedText === 'reaction'
    || trimmedText === '[reaction]';
  const isSecret = trimmedText === '[secretencrypted]';

  const location = normalizeLocation(event.raw_payload, event);
  const media = normalizeMedia(event.raw_payload, event);
  const isLocation = Boolean(location)
    || trimmedText === '[location]'
    || trimmedText === 'location'
    || String(payload?.messageType || '').toLowerCase() === 'locationmessage';

  let text = '';
  if (isLocation) {
    text = location?.name || location?.address || 'Localização';
  } else {
    const caption = String(media?.caption || '').trim();
    const eventText = String(event.message_text || '').trim();
    const hasRealCaption = caption && !isGeneratedMediaLabel(caption) && !Object.prototype.hasOwnProperty.call(TECHNICAL_MEDIA_LABELS, caption.toLowerCase());
    text = hasRealCaption ? caption : (eventText || media?.caption || '');
  }
  const lastAt = formatDate(event.created_at);

  let sourceColIndex = -1;
  let cardIndex = -1;
  let matchedCard = null;

  for (let cIdx = 0; cIdx < columns.length; cIdx += 1) {
    const col = columns[cIdx];
    const idx = (col.cards || []).findIndex((card) => (
      card.id === `card-${event.id}` ||
      card.id === conversationId ||
      card.id === legacyConversationId ||
      (card.canonicalKey && card.canonicalKey === canonicalKey) ||
      (normalizedExtId && card.normalizedExternalId && card.normalizedExternalId === normalizedExtId) ||
      (event.external_conversation_id && (card.externalConversationId === event.external_conversation_id || card.normalizedExternalId === normalizedExtId)) ||
      (event.contact_handle && card.contactHandle === event.contact_handle)
    ));
    if (idx >= 0) {
      sourceColIndex = cIdx;
      cardIndex = idx;
      matchedCard = col.cards[idx];
      break;
    }
  }

  if (!matchedCard) return columns;

  const incomingPayloadAvatar = extractPayloadAvatar(event);
  const incomingEventAvatar = normalizeAvatarUrl(event.avatar_url);

  const assignee = asObject(payload.assignee);
  const candidateAssignee = assignee.name || payload.assigned_to || (event.service === 'conversation_assigned' ? event.sent_by_user : null);
  const newAssigneeName = cleanAgentName(candidateAssignee);
  const hasExplicitAssignment = Boolean(newAssigneeName);

  const isHandoff = Boolean(event.handoff)
    || event.service === 'handoff_requested'
    || event.service === 'conversation_assigned'
    || normalizeStage(event.stage) === 'Atendimento humano'
    || payload?.kanban_transition?.to_column === 'sales_human'
    || payload?.kanban_transition?.to_column === 'com_humano'
    || payload?.kanban_transition?.to_column === 'conversas_humanos';
  const eventTime = Date.parse(event.created_at || '');
  const cardTime = Date.parse(matchedCard.lastActivityAt || '');
  const isNewerControl = !Number.isFinite(cardTime)
    || (Number.isFinite(eventTime) && eventTime >= cardTime);

  let nextOwner = matchedCard.owner;
  let nextOwnerId = matchedCard.ownerId;
  let nextOwnerKind = matchedCard.ownerKind;

  if (isNewerControl && canEventMoveOwnershipToAi({
    status: matchedCard.ownerKind === 'agent' ? 'atendimento_humano' : 'ia_ativa',
    handoff: matchedCard.ownerKind === 'agent',
    currentSessionId: matchedCard.sessionId || null,
  }, event, event.stage)) {
    nextOwner = 'Assistente IA';
    nextOwnerId = null;
    nextOwnerKind = 'ai';
  } else if (isNewerControl && hasExplicitAssignment) {
    nextOwner = newAssigneeName;
    nextOwnerId = assignee.id ? String(assignee.id) : null;
    nextOwnerKind = 'agent';
  } else if (isNewerControl && isHandoff && (matchedCard.ownerKind === 'ai' || matchedCard.owner === 'Assistente IA')) {
    let activeAgents = Array.isArray(teamAgents) && teamAgents.length ? teamAgents : null;
    if (!activeAgents && typeof window !== 'undefined' && window.localStorage && resolvedTenant) {
      try {
        const cached = window.localStorage.getItem(`magia:team-agents:${resolvedTenant}`);
        if (cached) activeAgents = JSON.parse(cached);
      } catch (_) {}
    }
    const resolvedAgents = Array.isArray(activeAgents) ? activeAgents : [];
    const humanFallback = resolveConversationOwnerDetails({
      explicitOwner: null,
      activeAgents: resolvedAgents,
      isHumanControlled: true,
    });
    nextOwner = humanFallback.name;
    nextOwnerId = humanFallback.id;
    nextOwnerKind = humanFallback.kind;
  }

  const updatedCard = {
    ...matchedCard,
    subtitle: (isReaction || isSecret) ? matchedCard.subtitle : (text || mediaPreview(media) || matchedCard.subtitle),
    avatarUrl: incomingPayloadAvatar || matchedCard.avatarUrl || incomingEventAvatar || null,
    owner: nextOwner,
    ownerId: nextOwnerId,
    ownerKind: nextOwnerKind,
    lastAt: lastAt || matchedCard.lastAt,
    lastActivityAt: event.created_at || matchedCard.lastActivityAt,
  };

  const targetCol = resolveEventTargetColumn(event, updatedCard, resolvedTenant, columns);
  const targetColIndex = targetCol ? columns.findIndex((col) => col.id === targetCol.id) : -1;

  if (targetColIndex >= 0 && targetColIndex !== sourceColIndex) {
    const isGenesis = isGenesisSalesTenant(resolvedTenant);
    const targetKey = targetCol.automationKey || targetCol.id;
    updatedCard.stage = targetCol.title || targetCol.name || updatedCard.stage;
    // A coluna e a etiqueta acompanham o card: sem isso o painel acha que ele ainda está na coluna
    // antiga (arrasto na mesma coluna vira movimento) e o card encerrado segue "IA conduzindo a conversa".
    updatedCard.targetColumnId = targetKey;
    if (isClosedKanbanColumn(targetKey)) {
      updatedCard.aiReason = closedColumnReason(targetKey);
    } else if (isHandoff && updatedCard.aiReason === 'IA conduzindo a conversa') {
      updatedCard.aiReason = '';
    }
    if (isGenesis) {
      updatedCard.salesStageKey = targetKey;
    }

    const nextColumns = columns.map((col, cIdx) => {
      if (cIdx === sourceColIndex) {
        const remainingCards = col.cards.filter((_, idx) => idx !== cardIndex);
        return {
          ...col,
          cards: sortKanbanCardsByConversationActivity(remainingCards),
        };
      }
      if (cIdx === targetColIndex) {
        const newCards = [updatedCard, ...col.cards];
        return {
          ...col,
          cards: sortKanbanCardsByConversationActivity(newCards),
        };
      }
      return col;
    });

    return nextColumns;
  }

  const nextColumns = columns.map((col, cIdx) => {
    if (cIdx === sourceColIndex) {
      const updatedCards = [...col.cards];
      updatedCards[cardIndex] = updatedCard;
      return {
        ...col,
        cards: sortKanbanCardsByConversationActivity(updatedCards),
      };
    }
    return col;
  });

  return nextColumns;
}

export function sortKanbanCardsByConversationActivity(cards = []) {
  if (!Array.isArray(cards)) return [];
  return [...cards].sort((left, right) => {
    const leftAt = Date.parse(left?.lastActivityAt || '');
    const rightAt = Date.parse(right?.lastActivityAt || '');
    if (!Number.isFinite(leftAt) || !Number.isFinite(rightAt)) return 0;
    return rightAt - leftAt;
  });
}

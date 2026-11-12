import { asObject } from '../../utils/asObject.js';
import { formatDate } from '../../utils/dateFormatting.js';
import { isInternalOperationalEvent } from '../timeline/eventClassification.js';
import { TECHNICAL_MEDIA_LABELS } from '../../utils/audioUtils.js';
import { canonicalConversationKey, normalizeChannel, normalizeExternalConversationId } from '../identity/conversationIdentity.js';
import { normalizeLocation, resolveConversationOwnerDetails } from '../conversations/conversationPresentation.js';
import { normalizeMedia } from '../media/mediaNormalization.js';
import { isGeneratedMediaLabel, mediaPreview } from '../media/mediaPresentation.js';
import { extractPayloadAvatar } from '../contacts/contactPayload.js';
import { normalizeAvatarUrl } from '../contacts/contactIdentity.js';
import { cleanAgentName } from '../agents/agentNames.js';
import { canEventMoveOwnershipToAi, eventSessionId, isExplicitAiOwnershipTransition } from '../conversations/ownershipEvidence.js';
import { isCustomerInboundEvent, isFollowUpOutboundEvent } from '../conversations/conversationEventState.js';
import { technicalEventPresentation } from '../conversations/technicalEventPresentation.js';
import { isConversationWaitingForFollowUp } from '../timeline/conversationFilters.js';

import { findKanbanColumn } from './stageResolution.js';
import { closedColumnReason, isClosedKanbanColumn } from './kanbanCardReason.js';
import { GENESIS_SALES_STAGE_KEYS, isGenesisSalesTenant } from './commercialStages.js';
import { canonicalKanbanKey } from './kanbanHelpers.js';
import {
  AI_KANBAN_COLUMNS,
  conversationKanbanCandidates,
  extractFollowUpStepKey,
  findKanbanDestination,
  followUpCardReason,
  followUpStepLabel,
  humanKanbanStage,
  isKanbanClosed,
  nextTeamReviewRequestedAt,
} from './cardRouting.js';

function resolveEventTargetColumn(event, columns, card, humanStage, isGenesis, { waitingForFollowUp = false, wasFollowUp = false } = {}) {
  const payload = asObject(event.raw_payload);
  const manualColumn = findKanbanColumn(columns, payload.kanban_transition?.to_column);
  if (manualColumn) return manualColumn;
  if (isGenesis) {
    if (isKanbanClosed(event)) return null;
    const stage = canonicalKanbanKey(payload.sales_stage || event.stage);
    if (humanStage) return findKanbanColumn(columns, 'sales_human');
    if (waitingForFollowUp && (!stage || ['sales_new', 'sales_qualifying', 'sales_hot'].includes(stage))) {
      const followUpCol = findKanbanColumn(columns, 'follow_ups');
      if (followUpCol) return followUpCol;
    }
    if (GENESIS_SALES_STAGE_KEYS.has(stage)) return findKanbanColumn(columns, stage);
    return wasFollowUp && !waitingForFollowUp ? findKanbanColumn(columns, card.salesStageKey || 'sales_qualifying') : null;
  }
  if (card.actionType === 'confirm_signal') return null;
  if (card.actionType === 'confirm_request' && !humanStage) return null;
  const destination = findKanbanDestination(columns, conversationKanbanCandidates(event, {
    humanStage,
    columns,
    live: true,
    waitingForFollowUp,
    resumedFromFollowUp: wasFollowUp && !waitingForFollowUp,
  }));
  // Igual à carga completa: agendamento confirmado e futuro segura o card enquanto a conversa só iria para a IA.
  if (!humanStage && hasUpcomingConfirmedAppointment(card)
    && AI_KANBAN_COLUMNS.has(destination?.automationKey || destination?.id)) {
    return findKanbanColumn(columns, 'agendamentos') || destination;
  }
  return destination;
}

function hasUpcomingConfirmedAppointment(card) {
  return Boolean(card.appointmentId) && card.appointmentStatus === 'confirmed'
    && Date.parse(card.appointmentStartsAt || '') > Date.now();
}

export function applyIncomingEventToKanban(columns = [], event, tenantSlug = '', teamAgents = []) {
  if (!event || !Array.isArray(columns)) return columns;
  if (tenantSlug && event.tenant_slug && event.tenant_slug !== tenantSlug) return columns;
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
  if (isInternalOperationalEvent(event) && !payload.kanban_transition?.to_column) return columns;
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
    const idx = (col.cards || []).findIndex((card) =>
      (!card.channelType || normalizeChannel(card.channelType).type === channelType.type) && (
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

  const eventTime = Date.parse(event.created_at || '');
  const cardTime = Date.parse(matchedCard.lastControlAt || matchedCard.lastActivityAt || '');
  const isNewerControl = !Number.isFinite(cardTime)
    || (Number.isFinite(eventTime) && eventTime >= cardTime);
  const wasClosed = matchedCard.isClosed || isClosedKanbanColumn(columns[sourceColIndex].automationKey || columns[sourceColIndex].id);
  const isCloseEvent = isKanbanClosed(event);
  const isGenesis = isGenesisSalesTenant(resolvedTenant);
  const incomingSession = eventSessionId(event);
  const reopens = wasClosed && isNewerControl && event.direction === 'inbound' && event.sender_type !== 'system'
    && (!incomingSession || incomingSession !== matchedCard.closedSessionId);
  if (wasClosed && !reopens && !isCloseEvent && !payload.kanban_transition?.to_column) return columns;

  const incomingPayloadAvatar = extractPayloadAvatar(event);
  const incomingEventAvatar = normalizeAvatarUrl(event.avatar_url);

  const assignee = asObject(payload.assignee);
  const candidateAssignee = assignee.name || payload.assigned_to || (event.service === 'conversation_assigned' ? event.sent_by_user : null);
  const newAssigneeName = cleanAgentName(candidateAssignee);
  const hasExplicitAssignment = Boolean(newAssigneeName);

  const requestedHumanStage = isGenesis && event.sender_type === 'agent' && !event.handoff
    && !hasExplicitAssignment && !['manual_reply', 'conversation_assigned'].includes(event.service)
    ? '' : humanKanbanStage(event);
  let humanStage = matchedCard.humanKanbanStage || '';
  if (isNewerControl) {
    if (isCloseEvent || reopens || isExplicitAiOwnershipTransition(event)) humanStage = '';
    else if (requestedHumanStage && (!humanStage || requestedHumanStage !== 'aguardando_humano' || event.service === 'handoff_requested')) {
      humanStage = requestedHumanStage;
    }
  }
  const isHandoff = Boolean(requestedHumanStage);
  const sourceColKey = columns[sourceColIndex].automationKey || columns[sourceColIndex].id;
  const wasAbandoned = sourceColKey === 'conversas_abandonadas';
  const wasFollowUp = Boolean(matchedCard.isFollowUp || sourceColKey === 'follow_ups');
  const resumesFromInactivity = wasAbandoned && event.direction === 'inbound' && event.sender_type !== 'system';

  const nextLatestInboundAt = isNewerControl && isCustomerInboundEvent(event) && event.created_at
    ? event.created_at
    : matchedCard.latestCustomerInboundAt || null;
  const incomingIsFollowUp = isFollowUpOutboundEvent(event);
  const fallbackFollowUpAt = matchedCard.isFollowUp ? (matchedCard.lastActivityAt || matchedCard.lastControlAt || null) : null;
  const nextLatestFollowUpAt = isNewerControl && incomingIsFollowUp && event.created_at
    ? event.created_at
    : matchedCard.latestFollowUpAt || fallbackFollowUpAt;
  const nextFollowUpStepKey = isNewerControl && incomingIsFollowUp
    ? extractFollowUpStepKey(event)
    : matchedCard.followUpStepKey || '';
  const willBeHuman = Boolean(isHandoff || hasExplicitAssignment || (matchedCard.ownerKind === 'agent' && !reopens && !isExplicitAiOwnershipTransition(event)));
  const willBeClosed = Boolean(isCloseEvent || (wasClosed && !reopens));
  const nextWaitingForFollowUp = !willBeHuman && !willBeClosed && isConversationWaitingForFollowUp({
    status: willBeClosed ? 'finalizado' : (willBeHuman ? 'atendimento_humano' : 'ia_ativa'),
    stage: event.stage || matchedCard.stage,
    latestFollowUpAt: nextLatestFollowUpAt,
    latestCustomerInboundAt: nextLatestInboundAt,
  });

  const targetCol = isNewerControl
    ? resolveEventTargetColumn(event, columns, matchedCard, humanStage, isGenesis, { waitingForFollowUp: nextWaitingForFollowUp, wasFollowUp })
      || ((reopens || resumesFromInactivity || (wasFollowUp && !nextWaitingForFollowUp && !isHandoff && !isCloseEvent)) && findKanbanDestination(columns, ['conversas_ia', 'conversas_andamento', 'novas_conversas']))
    : null;
  const targetKey = targetCol?.automationKey || targetCol?.id;
  const closes = isNewerControl && (isClosedKanbanColumn(targetKey) || isCloseEvent);
  const isClosed = closes || (wasClosed && !reopens && !targetCol);

  let nextOwner = matchedCard.owner;
  let nextOwnerId = matchedCard.ownerId;
  let nextOwnerKind = matchedCard.ownerKind;

  if (isClosed) {
    nextOwner = 'Sem responsável';
    nextOwnerId = null;
    nextOwnerKind = 'none';
  } else if (isNewerControl && ['aguardando_humano', 'conversas_abandonadas'].includes(targetKey)) {
    nextOwner = 'Sem responsável';
    nextOwnerId = null;
    nextOwnerKind = 'none';
  } else if ((isNewerControl && (reopens || resumesFromInactivity || targetKey === 'follow_ups' || (wasFollowUp && !nextWaitingForFollowUp)) && !isHandoff && !hasExplicitAssignment) || (isNewerControl && canEventMoveOwnershipToAi({
    status: matchedCard.ownerKind === 'agent' ? 'atendimento_humano' : 'ia_ativa',
    handoff: matchedCard.ownerKind === 'agent',
    currentSessionId: matchedCard.sessionId || null,
  }, event, event.stage))) {
    nextOwner = 'Assistente IA';
    nextOwnerId = null;
    nextOwnerKind = 'ai';
  } else if (isNewerControl && hasExplicitAssignment) {
    nextOwner = newAssigneeName;
    nextOwnerId = assignee.id ? String(assignee.id) : null;
    nextOwnerKind = 'agent';
  } else if (isNewerControl && isHandoff && matchedCard.ownerKind !== 'agent') {
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

  const effectiveColumnKey = targetKey || sourceColKey;
  const nextIsFollowUpCard = !isClosed && !isHandoff && !hasExplicitAssignment && nextOwnerKind !== 'agent'
    && nextWaitingForFollowUp && effectiveColumnKey === 'follow_ups';
  const resolvedFollowUpLabel = nextIsFollowUpCard ? followUpStepLabel(nextFollowUpStepKey) : '';

  const technicalReview = technicalEventPresentation(event);
  const updatePreview = !isReaction && !isSecret;
  let aiReason = matchedCard.aiReason;
  if (closes) {
    aiReason = closedColumnReason(targetKey) || closedColumnReason(payload.close_reason === 'no_show' ? 'nao_compareceu' : 'finalizadas');
  } else if (nextIsFollowUpCard) {
    aiReason = followUpCardReason(resolvedFollowUpLabel);
  } else if (isNewerControl && (reopens || technicalReview || nextOwnerKind !== matchedCard.ownerKind
    || (targetKey && targetKey !== matchedCard.targetColumnId) || wasFollowUp)) {
    aiReason = '';
  }
  const updatedCard = {
    ...matchedCard,
    subtitle: updatePreview ? (technicalReview?.title || text || mediaPreview(media) || matchedCard.subtitle) : matchedCard.subtitle,
    avatarUrl: incomingPayloadAvatar || matchedCard.avatarUrl || incomingEventAvatar || null,
    owner: nextOwner,
    ownerId: nextOwnerId,
    ownerKind: nextOwnerKind,
    humanKanbanStage: humanStage,
    teamReviewRequestedAt: isNewerControl ? nextTeamReviewRequestedAt(matchedCard.teamReviewRequestedAt, event) : matchedCard.teamReviewRequestedAt,
    needsReview: isNewerControl && updatePreview ? Boolean(technicalReview) : matchedCard.needsReview,
    isClosed,
    isFollowUp: nextIsFollowUpCard,
    waitingForFollowUp: nextIsFollowUpCard,
    followUpLabel: resolvedFollowUpLabel,
    followUpStepKey: nextIsFollowUpCard ? nextFollowUpStepKey : '',
    latestFollowUpAt: nextLatestFollowUpAt,
    latestCustomerInboundAt: nextLatestInboundAt,
    closedSessionId: closes ? incomingSession || matchedCard.closedSessionId : matchedCard.closedSessionId,
    lastControlAt: isNewerControl ? event.created_at || matchedCard.lastControlAt : matchedCard.lastControlAt,
    aiReason,
    lastAt: lastAt || matchedCard.lastAt,
    lastActivityAt: event.created_at || matchedCard.lastActivityAt,
  };

  const targetColIndex = targetCol ? columns.findIndex((col) => col.id === targetCol.id) : -1;

  if (targetColIndex >= 0 && targetColIndex !== sourceColIndex) {
    updatedCard.stage = targetCol.title || targetCol.name || updatedCard.stage;
    updatedCard.targetColumnId = targetKey;
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

import { technicalEventPresentation } from './technicalEventPresentation.js';
import { asObject } from '../../utils/asObject.js';
import { formatDate } from '../../utils/dateFormatting.js';
import { applyConversationLifecycle } from './conversationLifecycle.js';
import { isInternalOperationalEvent } from '../timeline/eventClassification.js';
import { canonicalConversationKey, normalizeChannel, normalizeExternalConversationId } from '../identity/conversationIdentity.js';
import { findKanbanColumn, getStageLabel } from '../kanban/stageResolution.js';
import { mergeMediaDescriptors, normalizeMedia } from '../media/mediaNormalization.js';
import { normalizeAudioTranscription, normalizeLocation, normalizeStage, resolveConversationOwnerDetails, resolveEventMessagePreview, resolveEventVisibleText } from './conversationPresentation.js';
import { cleanAgentName } from '../agents/agentNames.js';
import { getUsefulTrustedContactName, isUsefulContactName } from '../contacts/contactNames.js';
import { conversationPhoneFallback } from '../contacts/contactPhones.js';
import { extractPayloadAvatar } from '../contacts/contactPayload.js';
import { resolveConversationDisplayName } from '../contacts/contactDisplayName.js';
import { normalizeAvatarUrl } from '../contacts/contactIdentity.js';
import { isUnreadInboundEvent } from '../reads/readsService.js';
import { isConversationWaitingForFollowUp } from '../timeline/conversationFilters.js';
import { sortConversationsByRecentActivity } from '../timeline/conversationOrdering.js';
import { eventsToConversations } from './eventsToConversations.js';
import { isCustomerInboundEvent, isFollowUpOutboundEvent, isGenericLeadInquiry, isShortlyAfter, isSubstantiveInboundFollowUp } from './conversationEventState.js';
import { resolveContactCategory } from '../contacts/contactCategory.js';

export function applyIncomingEventToConversations(conversations = [], event, tenantSlug = '', { markIncomingAsRead = false, kanbanColumns = [], tenantSettings = null, teamAgents = [] } = {}) {
  if (!event || isInternalOperationalEvent(event)) return conversations;
  if (tenantSlug && event.tenant_slug && event.tenant_slug !== tenantSlug) return conversations;

  const stageName = getStageLabel(event.stage, { kanbanColumns, tenantSettings, tenantSlug });
  const channelType = normalizeChannel(event.channel_type);
  const resolvedTenant = tenantSlug || event.tenant_slug || '';
  const targetKey = canonicalConversationKey(
    channelType.type,
    event.external_conversation_id,
    event.contact_handle || event.id,
    resolvedTenant,
  );
  const targetId = `conv-${targetKey}`;
  const normalizedIncomingExternalId = normalizeExternalConversationId(
    channelType.type,
    event.external_conversation_id,
    event.contact_handle,
  );

  const existingIndex = (conversations || []).findIndex(
    (c) => c.id === targetId
      || (c.canonicalKey && c.canonicalKey === targetKey)
      || (normalizedIncomingExternalId && c.normalizedExternalId && c.normalizedExternalId === normalizedIncomingExternalId)
      || (event.external_conversation_id && (c.externalConversationId === event.external_conversation_id || c.normalizedExternalId === normalizedIncomingExternalId))
      || (c.id === `conv-${event.external_conversation_id}`)
      || (event.contact_handle && (c.contactHandle === event.contact_handle || c.company === `@${event.contact_handle}`)),
  );

  const media = normalizeMedia(event.raw_payload, event);
  const audioTranscription = normalizeAudioTranscription(event.raw_payload, event);
  const location = normalizeLocation(event.raw_payload, event);
  const visibleText = resolveEventVisibleText(event, media);
  const at = formatDate(event.created_at);
  const payload = asObject(event.raw_payload);

  if (existingIndex >= 0) {
    const prevConv = conversations[existingIndex];
    const newMessages = [...(prevConv.messages || [])];
    const incomingEventAlreadyPresent = newMessages.some((message) => event.id && message.eventId === event.id);

    if (event.direction !== 'outbound' && isSubstantiveInboundFollowUp(event)) {
      for (let index = newMessages.length - 1; index >= 0; index -= 1) {
        const previousMessage = newMessages[index];
        if (previousMessage.from !== 'contact' || !isGenericLeadInquiry(previousMessage)) continue;
        if (isShortlyAfter(previousMessage.createdAt, event.created_at)) newMessages.splice(index, 1);
        break;
      }
    }

    if (event.direction === 'outbound') {
      const isOperator = ['agent', 'human', 'operator', 'atendente'].includes(event.sender_type);
      const msg = {
        from: isOperator ? 'agent' : event.sender_type === 'system' ? 'system' : 'ai',
        sent_by: event.sent_by_user || (isOperator ? 'Operador' : null),
        text: technicalEventPresentation(event)?.title || visibleText || event.response_text || '',
        systemEvent: technicalEventPresentation(event),
        at,
        status: event.delivery_status,
        media,
        audioTranscription,
        location,
        eventId: event.id,
        createdAt: event.created_at || null,
        sessionId: payload?.conversation_session_id || null,
      };
      const existingMsgIndex = event.id
        ? newMessages.findIndex((m) => m.eventId === event.id)
        : newMessages.findIndex((m) => !m.eventId
          && m.text === msg.text
          && m.createdAt === msg.createdAt
          && m.from === msg.from);
      if (existingMsgIndex >= 0) {
        const prevMedia = newMessages[existingMsgIndex].media;
        const mergedMedia = mergeMediaDescriptors(prevMedia, media);
        newMessages[existingMsgIndex] = {
          ...newMessages[existingMsgIndex],
          status: event.delivery_status || newMessages[existingMsgIndex].status,
          text: msg.text || newMessages[existingMsgIndex].text,
          systemEvent: msg.systemEvent || newMessages[existingMsgIndex].systemEvent,
          media: mergedMedia,
          audioTranscription: audioTranscription || newMessages[existingMsgIndex].audioTranscription || null,
          location: (location || newMessages[existingMsgIndex].location) ? {
            ...(newMessages[existingMsgIndex].location || {}),
            ...(location || {}),
          } : null,
        };
      } else {
        newMessages.push(msg);
      }
    } else {
      const msg = {
        from: 'contact',
        text: visibleText,
        at,
        media,
        audioTranscription,
        location,
        eventId: event.id,
        createdAt: event.created_at || null,
        sessionId: payload?.conversation_session_id || null,
      };
      const existingMsgIndex = event.id
        ? newMessages.findIndex((m) => m.eventId === event.id)
        : newMessages.findIndex((m) => !m.eventId
          && m.text === msg.text
          && m.createdAt === msg.createdAt
          && m.from === 'contact');
      if (existingMsgIndex >= 0) {
        const prevMedia = newMessages[existingMsgIndex].media;
        const mergedMedia = mergeMediaDescriptors(prevMedia, media);
        newMessages[existingMsgIndex] = {
          ...newMessages[existingMsgIndex],
          status: event.delivery_status || newMessages[existingMsgIndex].status,
          text: msg.text || newMessages[existingMsgIndex].text,
          media: mergedMedia,
          audioTranscription: audioTranscription || newMessages[existingMsgIndex].audioTranscription || null,
          location: (location || newMessages[existingMsgIndex].location) ? {
            ...(newMessages[existingMsgIndex].location || {}),
            ...(location || {}),
          } : null,
        };
      } else {
        newMessages.push(msg);
      }

      if (event.response_text) {
        const aiMsg = {
          from: 'ai',
          text: event.response_text,
          at,
          eventId: event.id ? `${event.id}-response` : null,
          createdAt: event.created_at || null,
          sessionId: payload?.conversation_session_id || null,
        };
        const existingAiIndex = newMessages.findIndex(
          (m) => (aiMsg.eventId && m.eventId === aiMsg.eventId) || (m.text === aiMsg.text && m.at === at && m.from === 'ai'),
        );
        if (existingAiIndex < 0) {
          newMessages.push(aiMsg);
        }
      }
    }

    const eventTime = event.created_at ? Date.parse(event.created_at) : NaN;
    const currentActivityTime = prevConv.lastActivityAt ? Date.parse(prevConv.lastActivityAt) : NaN;
    const isNewer = Number.isNaN(currentActivityTime) || (!Number.isNaN(eventTime) && eventTime >= currentActivityTime);

    const incomingPreview = resolveEventMessagePreview(event, prevConv.owner);
    const shouldUpdateLastMessage = Boolean(isNewer && incomingPreview);

    const trustedContactName = getUsefulTrustedContactName(event);
    const resolvedTenant = tenantSlug || event.tenant_slug || prevConv.tenantSlug || '';
    const displayName = resolveConversationDisplayName(event, `Contato ${channelType.label}`);
    const previousNameIsTrusted = prevConv.contactNameIsTrusted ?? isUsefulContactName(prevConv.contact, '', resolvedTenant);
    const canonicalContactName = String(event.contact_name_canonical || event.contact?.name || '').trim();
    const hasCanonicalContactName = isUsefulContactName(canonicalContactName, conversationPhoneFallback(event), resolvedTenant);
    const previousNameIsCanonical = Boolean(prevConv.contactNameIsCanonical);
    const updatedContact = hasCanonicalContactName
      ? canonicalContactName
      : trustedContactName && !previousNameIsCanonical
        ? trustedContactName
      : displayName && (!prevConv.contact || prevConv.contact.startsWith('Contato ') || prevConv.contact === 'Contato' || prevConv.contact.includes('@') || !isUsefulContactName(prevConv.contact, '', resolvedTenant))
        ? displayName
        : prevConv.contact;

    // Atualiza avatar se o novo evento trouxer um avatar válido; caso contrário, preserva o avatar existente
    const incomingPayloadAvatar = extractPayloadAvatar(event);
    const incomingEventAvatar = normalizeAvatarUrl(event.avatar_url);
    const nextAvatarUrl = incomingPayloadAvatar
      || prevConv.avatarUrl
      || incomingEventAvatar
      || null;

    const unreadIncrement = isUnreadInboundEvent(event, {
      eventAlreadyPresent: incomingEventAlreadyPresent,
      markIncomingAsRead,
    }) ? 1 : 0;

    const incomingIsCustomerInbound = isCustomerInboundEvent(event);
    const incomingIsFollowUp = isFollowUpOutboundEvent(event);

    let nextCustomerInboundAt = prevConv.latestCustomerInboundAt || null;
    if (incomingIsCustomerInbound && event.created_at) {
      if (!nextCustomerInboundAt || Date.parse(event.created_at) >= Date.parse(nextCustomerInboundAt)) {
        nextCustomerInboundAt = event.created_at;
      }
    }

    let nextFollowUpAt = prevConv.latestFollowUpAt || null;
    if (incomingIsFollowUp && event.created_at) {
      if (!nextFollowUpAt || Date.parse(event.created_at) >= Date.parse(nextFollowUpAt)) {
        nextFollowUpAt = event.created_at;
      }
    }

    const updated = {
      ...prevConv,
      contact: updatedContact,
      contactNameIsTrusted: trustedContactName ? true : previousNameIsTrusted,
      contactNameIsCanonical: hasCanonicalContactName || previousNameIsCanonical,
      avatarUrl: nextAvatarUrl,
      messages: newMessages,
      lastMessage: shouldUpdateLastMessage ? incomingPreview.text : prevConv.lastMessage,
      lastMessageSender: shouldUpdateLastMessage ? incomingPreview.sender : (prevConv.lastMessageSender || null),
      lastMessageSenderType: shouldUpdateLastMessage ? incomingPreview.senderType : (prevConv.lastMessageSenderType || null),
      lastAt: isNewer ? at : prevConv.lastAt,
      lastActivityAt: isNewer ? (event.created_at || prevConv.lastActivityAt) : prevConv.lastActivityAt,
      unread: (prevConv.unread || 0) + unreadIncrement,
      latestCustomerInboundAt: nextCustomerInboundAt,
      latestFollowUpAt: nextFollowUpAt,
    };

    // Realtime can deliver old assignment events after newer AI activity. They
    // remain in the timeline, but must not replace the current control state.
    if (isNewer || Number.isNaN(eventTime)) {
      applyConversationLifecycle(updated, event, stageName);

      const assignee = asObject(payload.assignee);
      const candidateAssignee = assignee.name || payload.assigned_to || (event.service === 'conversation_assigned' ? event.sent_by_user : null);
      const newAssigneeName = cleanAgentName(candidateAssignee);
      if (newAssigneeName) {
        updated.owner = newAssigneeName;
        updated.ownerId = assignee.id ? String(assignee.id) : (payload.assignee_id ? String(payload.assignee_id) : updated.ownerId);
        updated.ownerKind = 'agent';
        updated.status = 'atendimento_humano';
      } else {
        const isHumanHandoff = Boolean(event.handoff)
          || event.service === 'handoff_requested'
          || event.service === 'conversation_assigned'
          || normalizeStage(event.stage) === 'Atendimento humano'
          || event.stage === 'sales_human';
        if (isHumanHandoff && (updated.ownerKind === 'ai' || updated.owner === 'Assistente IA' || !updated.owner)) {
          const resolvedOwner = resolveConversationOwnerDetails({
            explicitOwner: null,
            activeAgents: teamAgents,
            isHumanControlled: true,
          });
          if (resolvedOwner?.name) {
            updated.owner = resolvedOwner.name;
            updated.ownerId = resolvedOwner.id || null;
            updated.ownerKind = resolvedOwner.kind;
          }
        }
      }

      const stageKey = payload?.sales_stage || payload?.sales_stage_key || event.salesStageKey;
      if (stageKey) {
        updated.salesStageKey = stageKey;
        const matchingCol = findKanbanColumn(kanbanColumns, stageKey);
        if (matchingCol) {
          updated.stage = matchingCol.title || matchingCol.name || updated.stage;
        }
      }
    }

    if (payload?.payment_mode === 'financing' || payload?.state?.payment_mode === 'financing' || payload?.financing || payload?.sales_stage === 'sales_financing' || payload?.sales_stage_key === 'sales_financing' || event.service === 'sales_financing' || event.stage === 'sales_financing' || event.stage === 'Fila de financiamento') {
      updated.tags = Array.from(new Set([...(updated.tags || []), 'Financiamento'])).filter(Boolean);
    }

    updated.waitingForFollowUp = isConversationWaitingForFollowUp(updated);
    updated.waitingSince = updated.waitingForFollowUp ? updated.latestFollowUpAt : null;
    const cat = resolveContactCategory(updated);
    updated.contactCategory = cat.category;
    updated.contactCategoryLabel = cat.label;
    if (cat.category === 'commercial') {
      updated.status = 'comercial';
      updated.stage = 'Número comercial';
      if (updated.ownerKind === 'ai' || updated.owner === 'Assistente IA') {
        updated.owner = null;
        updated.ownerKind = null;
      }
    }

    const nextConversations = [...conversations];
    nextConversations[existingIndex] = updated;
    return sortConversationsByRecentActivity(nextConversations);
  }

  const [created] = eventsToConversations([event], resolvedTenant, teamAgents, kanbanColumns);
  if (created) {
    created.unread = isUnreadInboundEvent(event, { markIncomingAsRead }) ? 1 : 0;
    return sortConversationsByRecentActivity([created, ...(conversations || [])]);
  }

  return conversations;
}

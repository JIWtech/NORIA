import { technicalEventPresentation } from './technicalEventPresentation.js';
import { asObject } from '../../utils/asObject.js';
import { formatDate } from '../../utils/dateFormatting.js';
import { prepareConversationEvents } from './conversationEvents.js';
import { applyConversationLifecycle } from './conversationLifecycle.js';
import { isInternalOperationalEvent } from '../timeline/eventClassification.js';
import { canonicalConversationKey, normalizeChannel, normalizeExternalConversationId } from '../identity/conversationIdentity.js';
import { estimatedValue, sentimentFromEvent as sentimentFromEventWithStage } from './conversationDerived.js';
import { getUsefulTrustedContactName, isUsefulContactName } from '../contacts/contactNames.js';
import { conversationPhoneFallback } from '../contacts/contactPhones.js';
import { extractAvatarUrlFromEvent, extractPayloadAvatar } from '../contacts/contactPayload.js';
import { resolveConversationDisplayName } from '../contacts/contactDisplayName.js';
import { normalizeAvatarUrl } from '../contacts/contactIdentity.js';
import { normalizeAudioTranscription, normalizeLocation, normalizeStage, resolveConversationOwnerDetails, resolveEventMessagePreview, resolveEventVisibleText } from './conversationPresentation.js';
import { isConversationWaitingForFollowUp } from '../timeline/conversationFilters.js';
import { sortConversationsByRecentActivity } from '../timeline/conversationOrdering.js';
import { mediaPreview } from '../media/mediaPresentation.js';
import { normalizeMedia } from '../media/mediaNormalization.js';
import { resolveSalesControlMode } from '../leads/leadDataReads.js';
import { getStageLabel, findKanbanColumn } from '../kanban/stageResolution.js';
import { shouldHideGenericLeadInquiry, isGenericLeadInquiry, isCustomerInboundEvent, isFollowUpOutboundEvent } from './conversationEventState.js';
import { resolveContactCategory } from '../contacts/contactCategory.js';

export function eventsToConversations(events = [], tenantSlug = '', teamAgents = [], kanbanColumns = []) {
  if (!Array.isArray(events)) return [];

  const byChat = new Map();

  const preparedEvents = prepareConversationEvents(events);
  const sortedChronological = [...preparedEvents].sort((a, b) => {
    const tA = a.created_at ? Date.parse(a.created_at) : 0;
    const tB = b.created_at ? Date.parse(b.created_at) : 0;
    return (Number.isNaN(tA) ? 0 : tA) - (Number.isNaN(tB) ? 0 : tB);
  });

  for (let eventIndex = 0; eventIndex < sortedChronological.length; eventIndex += 1) {
    const event = sortedChronological[eventIndex];
    if (tenantSlug && event.tenant_slug && event.tenant_slug !== tenantSlug) continue;
    if (isGenericLeadInquiry(event) && shouldHideGenericLeadInquiry(event, sortedChronological.slice(eventIndex + 1))) continue;
    // Mantém o evento em channel_events para auditoria, mas não materializa
    // operações internas como mensagens da conversa.
    if (isInternalOperationalEvent(event)) continue;

    const channelType = normalizeChannel(event.channel_type);
    const stageName = getStageLabel(event.stage, { kanbanColumns, tenantSlug });
    const resolvedTenant = tenantSlug || event.tenant_slug || '';
    const key = canonicalConversationKey(
      channelType.type,
      event.external_conversation_id,
      event.contact_handle || event.id,
      resolvedTenant,
    );
    const normalizedExtId = normalizeExternalConversationId(
      channelType.type,
      event.external_conversation_id,
      event.contact_handle,
    );
    const payload = asObject(event.raw_payload);
    const isHumanTransfer = Boolean(
      (event.handoff && (normalizeStage(event.stage) === 'Atendimento humano' || event.service === 'manual_reply'))
      || event.service === 'manual_reply'
      || event.ai_provider === 'human_operator'
      || event.sender_type === 'agent'
      || payload?.magia_operator?.source === 'whatsapp_fromMe'
      || normalizeStage(event.stage) === 'Atendimento humano'
      || event.stage === 'sales_human'
    );
    const isClosed = stageName === 'Finalizado' || normalizeStage(event.stage) === 'Finalizado' || event.service === 'conversation_closed' || event.ai_provider === 'conversation_closed';
    const eventAssignee = payload?.assignee;
    const initialOwner = eventAssignee?.name || payload?.assigned_to || (
      event.sent_by_user && !['Operador NORIA', 'Operador Mag.IA', 'Disparo NORIA'].includes(event.sent_by_user)
        ? event.sent_by_user
        : null
    );
    const initialOwnerId = eventAssignee?.id || payload?.assignee_id || null;

    if (!byChat.has(key)) {
      const fallbackName = `Contato ${channelType.label}`;
      const trustedContactName = getUsefulTrustedContactName(event);
      const canonicalContactName = String(event.contact_name_canonical || event.contact?.name || '').trim();
      const hasCanonicalContactName = isUsefulContactName(canonicalContactName, conversationPhoneFallback(event), resolvedTenant);
      const contactName = resolveConversationDisplayName(event, fallbackName);
      const initialAvatar = extractAvatarUrlFromEvent(event);
      const initialPreview = resolveEventMessagePreview(event, initialOwner);
      byChat.set(key, {
        id: `conv-${key}`,
        canonicalKey: key,
        tenantSlug: resolvedTenant,
        normalizedExternalId: normalizedExtId,
        externalConversationId: event.external_conversation_id || normalizedExtId || key,
        contact: contactName,
        contactNameIsTrusted: Boolean(trustedContactName),
        contactNameIsCanonical: hasCanonicalContactName,
        company: event.contact_handle ? `@${event.contact_handle}` : channelType.label,
        channel: channelType.label,
        channelType: channelType.type,
        status: isClosed ? 'finalizado' : isHumanTransfer ? 'atendimento_humano' : 'ia_ativa',
        stage: stageName,
        owner: initialOwner,
        ownerId: initialOwnerId,
        unread: 0,
        lastMessage: technicalEventPresentation(event)?.title || initialPreview?.text || event.message_text || mediaPreview(normalizeMedia(event.raw_payload, event)) || '',
        lastMessageSender: initialPreview?.sender || null,
        lastMessageSenderType: initialPreview?.senderType || null,
        lastAt: formatDate(event.created_at),
        lastActivityAt: event.created_at || null,
        tags: [event.service, stageName, (payload?.payment_mode === 'financing' || payload?.state?.payment_mode === 'financing' || payload?.financing || payload?.sales_stage === 'sales_financing' || event.service === 'sales_financing') ? 'Financiamento' : null].filter(Boolean),
        sentiment: sentimentFromEventWithStage(event, normalizeStage),
        value: estimatedValue(event),
        messages: [],
        events: [],
        avatarUrl: initialAvatar || null,
        // Ponto preparado para presença em tempo real.
        // O Supabase e as APIs de canais (ex: WhatsApp) não fornecem presença de contatos;
        // o campo permanece null para não simular um status falso de 'online'.
        presence: null,
        latestFollowUpAt: null,
        latestCustomerInboundAt: null,
        waitingForFollowUp: false,
        waitingSince: null,
      });
    }

    const conversation = byChat.get(key);

    // Se o contato começou com nome genérico/fallback ("Contato WhatsApp") e agora temos um contact_name real:
    const trustedContactName = getUsefulTrustedContactName(event);
    const displayName = resolveConversationDisplayName(event, `Contato ${channelType.label}`);
    if (!conversation.contactNameIsCanonical && trustedContactName) {
      conversation.contact = trustedContactName;
      conversation.contactNameIsTrusted = true;
    } else if (displayName && (!conversation.contact || conversation.contact.startsWith('Contato ') || conversation.contact === 'Contato' || conversation.contact.includes('@') || !isUsefulContactName(conversation.contact, '', resolvedTenant))) {
      conversation.contact = displayName;
    }

    // Se o evento cronológico trouxer avatar válido no payload, atualiza;
    // evento posterior sem avatar NUNCA apaga avatar já conhecido.
    const candidatePayloadAvatar = extractPayloadAvatar(event);
    if (candidatePayloadAvatar) {
      conversation.avatarUrl = candidatePayloadAvatar;
    } else if (!conversation.avatarUrl && event.avatar_url) {
      conversation.avatarUrl = normalizeAvatarUrl(event.avatar_url) || conversation.avatarUrl;
    }

    const previewInfo = resolveEventMessagePreview(event, conversation.owner || initialOwner);
    if (previewInfo) {
      conversation.lastMessage = previewInfo.text;
      conversation.lastMessageSender = previewInfo.sender;
      conversation.lastMessageSenderType = previewInfo.senderType;
    }
    const media = normalizeMedia(event.raw_payload, event);
    const audioTranscription = normalizeAudioTranscription(event.raw_payload, event);
    const location = normalizeLocation(event.raw_payload, event);
    const visibleText = resolveEventVisibleText(event, media);
    const eventTime = event.created_at ? Date.parse(event.created_at) : NaN;
    const currentActivityTime = conversation.lastActivityAt ? Date.parse(conversation.lastActivityAt) : NaN;
    if (!Number.isNaN(eventTime) && (Number.isNaN(currentActivityTime) || eventTime >= currentActivityTime)) {
      conversation.lastActivityAt = event.created_at;
      conversation.lastAt = formatDate(event.created_at);
    } else if (!conversation.lastActivityAt && event.created_at) {
      conversation.lastActivityAt = event.created_at;
      conversation.lastAt = formatDate(event.created_at);
    }
    if (isCustomerInboundEvent(event)) {
      const time = event.created_at;
      if (time && (!conversation.latestCustomerInboundAt || Date.parse(time) >= Date.parse(conversation.latestCustomerInboundAt))) {
        conversation.latestCustomerInboundAt = time;
      }
    } else if (isFollowUpOutboundEvent(event)) {
      const time = event.created_at;
      if (time && (!conversation.latestFollowUpAt || Date.parse(time) >= Date.parse(conversation.latestFollowUpAt))) {
        conversation.latestFollowUpAt = time;
      }
    }
    applyConversationLifecycle(conversation, event, stageName);
    if (isClosed) {
      conversation.owner = null;
      conversation.ownerId = null;
    } else if (initialOwner) {
      conversation.owner = initialOwner;
      conversation.ownerId = initialOwnerId;
    }
    conversation.value = Math.max(conversation.value, estimatedValue(event));
    conversation.tags = Array.from(new Set([...conversation.tags, event.service, stageName, (payload?.payment_mode === 'financing' || payload?.state?.payment_mode === 'financing' || payload?.financing || payload?.sales_stage === 'sales_financing' || event.service === 'sales_financing') ? 'Financiamento' : null].filter(Boolean)));
    if (event.direction === 'outbound') {
      const isOperator = ['agent', 'human', 'operator', 'atendente'].includes(event.sender_type);
      conversation.messages.push({
        from: isOperator ? 'agent' : event.sender_type === 'system' ? 'system' : 'ai',
        sent_by: event.sent_by_user || (isOperator ? 'Operador' : null),
        text: technicalEventPresentation(event)?.title || visibleText || event.response_text || '',
        systemEvent: technicalEventPresentation(event),
        at: formatDate(event.created_at),
        status: event.delivery_status,
        media,
        audioTranscription,
        location,
        eventId: event.id,
        createdAt: event.created_at || null,
        sessionId: payload?.conversation_session_id || null,
      });
    } else {
      conversation.messages.push({
        from: 'contact',
        text: visibleText,
        at: formatDate(event.created_at),
        media,
        audioTranscription,
        location,
        eventId: event.id,
        createdAt: event.created_at || null,
        sessionId: payload?.conversation_session_id || null,
      });
    }
    if (event.direction !== 'outbound' && event.response_text) {
      conversation.messages.push({
        from: 'ai',
        text: event.response_text,
        at: formatDate(event.created_at),
        eventId: event.id ? `${event.id}-response` : null,
        createdAt: event.created_at || null,
        sessionId: payload?.conversation_session_id || null,
      });
    }
    conversation.events.push(`Serviço: ${event.service || 'geral'} - Etapa: ${stageName}`);
  }

  const kanbanCardByChat = new Map();
  if (Array.isArray(kanbanColumns)) {
    for (const column of kanbanColumns) {
      for (const card of (column.cards || [])) {
        if (card.canonicalKey && !kanbanCardByChat.has(card.canonicalKey)) {
          kanbanCardByChat.set(card.canonicalKey, card);
        }
        if (card.normalizedExternalId && !kanbanCardByChat.has(card.normalizedExternalId)) {
          kanbanCardByChat.set(card.normalizedExternalId, card);
        }
        if (card.externalConversationId && !kanbanCardByChat.has(card.externalConversationId)) {
          kanbanCardByChat.set(card.externalConversationId, card);
        }
        if (card.id && !kanbanCardByChat.has(card.id)) {
          kanbanCardByChat.set(card.id, card);
        }
      }
    }
  }

  for (const conversation of byChat.values()) {
    const matchingCard = kanbanCardByChat.get(conversation.canonicalKey)
      || (conversation.normalizedExternalId && kanbanCardByChat.get(conversation.normalizedExternalId))
      || (conversation.externalConversationId && kanbanCardByChat.get(conversation.externalConversationId))
      || kanbanCardByChat.get(conversation.id);

    if (matchingCard) {
      if (matchingCard.owner) {
        if (conversation.status === 'ia_ativa' && !conversation.handoff && matchingCard.ownerKind === 'agent' && normalizeStage(conversation.stage) !== 'Atendimento humano' && conversation.stage !== 'sales_human') {
          conversation.owner = 'Assistente IA';
          conversation.ownerId = null;
          conversation.ownerKind = 'ai';
        } else {
          conversation.owner = matchingCard.owner;
          conversation.ownerId = matchingCard.ownerKind === 'ai' ? null : matchingCard.ownerId || conversation.ownerId || null;
          conversation.ownerKind = matchingCard.ownerKind || null;
        }
      } else {
        const isHumanControlled = conversation.status === 'atendimento_humano'
          || normalizeStage(conversation.stage) === 'Atendimento humano'
          || String(conversation.stage || '').toLowerCase().includes('humano');

        const resolvedOwner = resolveConversationOwnerDetails({
          explicitOwner: conversation.owner,
          explicitOwnerId: conversation.ownerId,
          activeAgents: teamAgents,
          isHumanControlled,
          isAiControlled: !isHumanControlled && conversation.status !== 'finalizado',
          stage: conversation.stage,
        });

        conversation.owner = resolvedOwner.name;
        conversation.ownerId = resolvedOwner.id || conversation.ownerId || null;
        conversation.ownerKind = resolvedOwner.kind;
      }

      if (matchingCard.salesStageKey) {
        conversation.salesStageKey = matchingCard.salesStageKey;
        conversation.salesAiLocked = matchingCard.salesAiLocked;
        const controlMode = resolveSalesControlMode({
          stage_key: matchingCard.salesStageKey,
          ai_locked: matchingCard.salesAiLocked,
        });
        if (conversation.status !== 'finalizado' && (controlMode === 'ai' || controlMode === 'human')) {
          conversation.status = controlMode === 'ai' ? 'ia_ativa' : 'atendimento_humano';
          conversation.owner = matchingCard.owner;
          conversation.ownerId = controlMode === 'ai' ? null : matchingCard.ownerId || null;
          conversation.ownerKind = matchingCard.ownerKind;
          const matchingColumn = findKanbanColumn(kanbanColumns, matchingCard.salesStageKey || matchingCard.targetColumnId);
          conversation.stage = matchingColumn?.title || matchingCard.stage || getStageLabel(matchingCard.salesStageKey, { kanbanColumns, tenantSlug });
        }
      } else if (matchingCard.stage || matchingCard.targetColumnId) {
        const matchingColumn = findKanbanColumn(kanbanColumns, matchingCard.targetColumnId || matchingCard.stage);
        if (conversation.status !== 'finalizado') {
          conversation.stage = matchingColumn?.title || matchingCard.stage || getStageLabel(matchingCard.stage, { kanbanColumns, tenantSlug });
        }
      }
      if (matchingCard.salesLead?.state?.payment_mode === 'financing' || matchingCard.subtitle?.includes('Financiamento') || matchingCard.salesStageKey === 'sales_financing') {
        conversation.tags = Array.from(new Set([...conversation.tags, 'Financiamento'])).filter(Boolean);
      }
    } else {
      const isHumanControlled = conversation.status === 'atendimento_humano'
        || normalizeStage(conversation.stage) === 'Atendimento humano'
        || String(conversation.stage || '').toLowerCase().includes('humano');

      const resolvedOwner = resolveConversationOwnerDetails({
        explicitOwner: conversation.owner,
        explicitOwnerId: conversation.ownerId,
        activeAgents: teamAgents,
        isHumanControlled,
        isAiControlled: !isHumanControlled && conversation.status !== 'finalizado',
        stage: conversation.stage,
      });

      conversation.owner = resolvedOwner.name;
      conversation.ownerId = resolvedOwner.id || conversation.ownerId || null;
      conversation.ownerKind = resolvedOwner.kind;
    }
    conversation.waitingForFollowUp = isConversationWaitingForFollowUp(conversation);
    conversation.waitingSince = conversation.waitingForFollowUp ? conversation.latestFollowUpAt : null;
    const cat = resolveContactCategory(conversation);
    conversation.contactCategory = cat.category;
    conversation.contactCategoryLabel = cat.label;
    if (cat.category === 'commercial') {
      conversation.status = 'comercial';
      conversation.stage = 'Número comercial';
      if (conversation.ownerKind === 'ai' || conversation.owner === 'Assistente IA') {
        conversation.owner = null;
        conversation.ownerKind = null;
      }
    }
  }

  return sortConversationsByRecentActivity(Array.from(byChat.values()));
}

import { technicalEventPresentation } from './technicalEventPresentation.js';
import { isConversationClosed } from './conversationLifecycle.js';
import { isInternalOperationalEvent } from '../timeline/eventClassification.js';
import { cleanAgentName } from '../agents/agentNames.js';
import { canonicalKanbanKey } from '../kanban/kanbanHelpers.js';
import { TECHNICAL_MEDIA_LABELS } from '../../utils/audioUtils.js';
import { mediaPreview, isGeneratedMediaLabel } from '../media/mediaPresentation.js';
import { normalizeMedia } from '../media/mediaNormalization.js';
import { resolveSalesControlMode } from '../leads/leadDataReads.js';
import { asObject } from '../../utils/asObject.js';
import { isMediaPlaceholderForKind } from '../../utils/audioUtils.js';

export function normalizeStage(stage) {
  const s = String(stage || '').toLowerCase().trim();
  if (s === 'reset' || s === '/reset' || s === 'buffering') return 'Qualificação';
  if (s.includes('aguardando') && (s.includes('final') || s.includes('pagamento'))) return 'Aguardando finalizacao';
  if (s.includes('finaliz') || s.includes('encerr') || s === 'sales_closed') return 'Finalizado';
  if (s.includes('verificar sinal')) return 'Verificar Sinal';
  if (s.includes('sinal informado')) return 'Sinal informado';
  if (s.includes('produto') && (s.includes('apresent') || s.includes('catalog') || s.includes('foto'))) return 'Produtos apresentados';
  if (s.includes('interesse') && s.includes('compra')) return 'Interesse em compra';
  if (s.includes('venda') && s.includes('conclu')) return 'Venda concluida';
  if (s.includes('agendamento confirmado')) return 'Agendamento confirmado';
  if (s.includes('qualific') || s === 'qualificacao' || s === 'sales_qualifying') return 'Qualificação';
  if (s.includes('agend') || s === 'agendamento') return 'Agendamento';
  if (s.includes('brief') || s.includes('briefing')) return 'Briefing necessário';
  if (s.includes('suport') || s.includes('suporte')) return 'Suporte técnico';
  if (s.includes('orc') || s.includes('orç') || s.includes('orcamento')) return 'Orçamento solicitado';
  if (s.includes('human') || s.includes('atendimento_humano') || s.includes('atendimento humano') || s === 'sales_human') return 'Atendimento humano';
  if (s.includes('diagnos') || s.includes('diagnostico')) return 'Diagnóstico';
  if (s.includes('negoc') || s.includes('negociacao')) return 'Negociação';
  if (s.includes('fechad') || s.includes('fechado')) return 'Cliente fechado';
  if (s.includes('propost') || s.includes('proposta')) return 'Proposta';
  if (s.includes('fora de contexto')) return 'Fora de contexto';
  return stage || 'Qualificação';
}

const locationDetailsCache = new Map();

export function normalizeLocation(rawPayload, event = null) {
  const payload = asObject(rawPayload); const ev = asObject(event);
  const loc = payload.locationMessage || payload.data?.message?.locationMessage || payload.message?.locationMessage || payload.data?.locationMessage || payload.location || payload.magia_normalized?.location || ev.location || (payload.degreesLatitude !== undefined && payload.degreesLongitude !== undefined ? payload : null) || (payload.latitude !== undefined && payload.longitude !== undefined ? payload : null) || (ev.latitude !== undefined && ev.longitude !== undefined ? ev : null);
  let lat = loc?.degreesLatitude ?? loc?.latitude ?? ev.latitude ?? null; let lng = loc?.degreesLongitude ?? loc?.longitude ?? ev.longitude ?? null; let name = String(loc?.name || ev.location_name || ev.name || '').trim(); let address = String(loc?.address || ev.location_address || ev.address || '').trim();
  const validLat = lat != null && !Number.isNaN(Number(lat)) ? Number(lat) : null; const validLng = lng != null && !Number.isNaN(Number(lng)) ? Number(lng) : null;
  const trimmedText = String(ev.message_text || payload.message_text || '').trim().toLowerCase();
  const isLocationText = trimmedText === '[location]' || trimmedText === 'location' || trimmedText === '[localização]' || trimmedText === '[localizacao]' || trimmedText === '[livelocation]' || trimmedText === 'livelocation';
  const isLocationMsg = String(payload.messageType || payload.data?.messageType || ev.message_type || ev.service || '').toLowerCase().includes('location') || isLocationText || Boolean(loc);
  if (!isLocationMsg && validLat == null && validLng == null && !name && !address) return null;
  return {
    latitude: validLat,
    longitude: validLng,
    name,
    address,
    url: loc?.url || (validLat != null && validLng != null ? `https://www.google.com/maps?q=${validLat},${validLng}` : ''),
    isResolving: false,
  };
}

export function normalizeAudioTranscription(rawPayload, event = null) {
  const payload = asObject(rawPayload); const eventId = String(event?.id || '').trim(); if (!eventId) return null;
  let record = null; const transcriptions = payload.audio_transcriptions;
  if (transcriptions && typeof transcriptions === 'object' && !Array.isArray(transcriptions)) { const candidate = transcriptions[eventId]; if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) record = candidate; }
  if (!record && payload.audio_processing && typeof payload.audio_processing === 'object' && !Array.isArray(payload.audio_processing)) { const isAudioMessage = isMediaPlaceholderForKind(event?.message_text, 'audio') || String(payload.content_type || '').toLowerCase() === 'audio'; if (isAudioMessage && String(payload.audio_processing.status || '').toLowerCase() === 'transcribed') record = payload.audio_processing; }
  if (!record) return null; const status = String(record.status || '').trim().toLowerCase(); const text = String(record.text || '').trim(); const version = String(record.version || '').trim(); const model = String(record.model || '').trim(); if (status !== 'transcribed' || !text) return null;
  return { status: 'transcribed', text, version: version || 'whatsapp_audio_v1', model: model || null, transcribedAt: record.transcribed_at || null };
}

function pushInteractiveText(target, value) {
  const text = String(value || '').trim();
  if (text && !target.includes(text)) target.push(text);
}

// WhatsApp stores the useful content of button/list messages inside the raw
// payload. Persisted message_text may legitimately be only "[buttons]".
export function extractInteractiveMessageText(rawPayload) {
  const payload = asObject(rawPayload);
  let message = payload?.data?.message || payload?.message || payload?.data?.msg || null;
  for (let depth = 0; message && depth < 5; depth += 1) {
    if (message.ephemeralMessage?.message) message = message.ephemeralMessage.message;
    else if (message.viewOnceMessage?.message) message = message.viewOnceMessage.message;
    else if (message.viewOnceMessageV2?.message) message = message.viewOnceMessageV2.message;
    else if (message.documentWithCaptionMessage?.message) message = message.documentWithCaptionMessage.message;
    else break;
  }
  if (!message || typeof message !== 'object') return '';

  const parts = [];
  const buttons = message.buttonsMessage || {};
  pushInteractiveText(parts, buttons.contentText);
  pushInteractiveText(parts, buttons.footerText);
  for (const button of buttons.buttons || []) pushInteractiveText(parts, button?.buttonText?.displayText || button?.displayText || button?.title);

  const template = message.templateMessage?.hydratedTemplate || message.templateMessage || message.hydratedTemplate || {};
  pushInteractiveText(parts, template.hydratedTitleText || template.titleText);
  pushInteractiveText(parts, template.hydratedContentText || template.contentText);
  pushInteractiveText(parts, template.hydratedFooterText || template.footerText);
  for (const button of template.templateButtons || template.buttons || []) {
    pushInteractiveText(parts, button?.quickReplyButton?.displayText || button?.urlButton?.displayText || button?.callButton?.displayText || button?.displayText || button?.title);
  }

  const list = message.listMessage || {};
  pushInteractiveText(parts, list.title);
  pushInteractiveText(parts, list.description);
  pushInteractiveText(parts, list.buttonText);
  for (const section of list.sections || []) {
    pushInteractiveText(parts, section.title);
    for (const row of section.rows || []) pushInteractiveText(parts, row.title || row.description);
  }

  const interactive = message.interactiveMessage || {};
  pushInteractiveText(parts, interactive.header?.title || interactive.header?.text);
  pushInteractiveText(parts, interactive.body?.text);
  pushInteractiveText(parts, interactive.footer?.text);
  for (const button of interactive.nativeFlowMessage?.buttons || []) {
    try {
      const params = typeof button.buttonParamsJson === 'string' ? JSON.parse(button.buttonParamsJson) : button.buttonParamsJson;
      pushInteractiveText(parts, params?.display_text || params?.title);
    } catch {
      // Provider data is optional and must never break the conversation UI.
    }
  }

  return parts.join('\n');
}

export function resolveEventVisibleText(event, media = null) {
  const text = String(event?.message_text || media?.caption || '').trim();
  if (/^\[(?:buttons?|list|interactive)\]$/i.test(text)) {
    return extractInteractiveMessageText(event?.raw_payload) || 'Mensagem interativa recebida';
  }
  return media && isGeneratedMediaLabel(text) ? '' : text;
}

export function resolveConversationOwnerDetails(paramsOrOwner = {}, activeAgentsList = [], isHumanControlledParam = null) {
  let explicitOwner = null;
  let explicitOwnerId = null;
  let activeAgents = [];
  let isHumanControlled = null;
  let isAiControlled = null;
  let stage = null;
  let targetColumnId = null;
  let aiLocked = null;
  let handoff = null;
  let currentControlMode = null;

  if (paramsOrOwner && typeof paramsOrOwner === 'object' && !Array.isArray(paramsOrOwner) && (
    'explicitOwner' in paramsOrOwner
    || 'activeAgents' in paramsOrOwner
    || 'isHumanControlled' in paramsOrOwner
    || 'isAiControlled' in paramsOrOwner
    || 'salesLead' in paramsOrOwner
    || 'stage' in paramsOrOwner
    || 'handoff' in paramsOrOwner
    || 'aiLocked' in paramsOrOwner
    || 'salesAiLocked' in paramsOrOwner
    || 'currentControlMode' in paramsOrOwner
  )) {
    explicitOwner = paramsOrOwner.explicitOwner;
    explicitOwnerId = paramsOrOwner.explicitOwnerId || null;
    activeAgents = paramsOrOwner.activeAgents || [];
    isHumanControlled = paramsOrOwner.isHumanControlled ?? null;
    isAiControlled = paramsOrOwner.isAiControlled ?? null;
    stage = paramsOrOwner.stage || paramsOrOwner.salesStageKey || null;
    targetColumnId = paramsOrOwner.targetColumnId || null;
    aiLocked = paramsOrOwner.aiLocked ?? paramsOrOwner.salesAiLocked ?? paramsOrOwner.salesLead?.ai_locked ?? null;
    handoff = paramsOrOwner.handoff ?? null;
    currentControlMode = paramsOrOwner.currentControlMode ?? resolveSalesControlMode(
      paramsOrOwner.salesLead || (paramsOrOwner.salesStageKey ? {
        stage_key: paramsOrOwner.salesStageKey,
        ai_locked: paramsOrOwner.salesAiLocked,
      } : null),
    );
  } else {
    explicitOwner = paramsOrOwner;
    activeAgents = activeAgentsList;
    isHumanControlled = isHumanControlledParam;
  }

  // O controle comercial atual vence responsáveis e handoffs de períodos anteriores.
  if (currentControlMode === 'ai') return { name: 'Assistente IA', id: null, kind: 'ai' };
  if (currentControlMode === 'none') return { name: 'Sem responsável', id: null, kind: 'none' };
  if (currentControlMode === 'human') {
    isHumanControlled = true;
    isAiControlled = false;
  }

  // 1. RESPONSÁVEL HUMANO EXPLÍCITO
  const cleanExplicit = cleanAgentName(explicitOwner);
  if (cleanExplicit) {
    return {
      name: cleanExplicit,
      id: explicitOwnerId ? String(explicitOwnerId) : null,
      kind: 'agent',
    };
  }

  // Determinar se a conversa está sob responsabilidade humana ou se a IA está conduzindo
  const rawStage = String(stage || targetColumnId || '').trim();
  const canonicalStage = canonicalKanbanKey(rawStage);

  const humanStages = new Set([
    'sales_human',
    'com_humano',
    'conversas_humanos',
    'aguardando_humano',
  ]);

  const aiStages = new Set([
    'sales_new',
    'sales_qualifying',
    'sales_hot',
    'novas_conversas',
    'conversas_ia',
    'conversas_andamento',
  ]);

  const isExplicitHuman = isHumanControlled === true
    || handoff === true
    || aiLocked === true
    || humanStages.has(canonicalStage)
    || rawStage.toLowerCase().includes('humano');

  const isExplicitAi = isAiControlled === true
    || isHumanControlled === false
    || (!isExplicitHuman && aiLocked === false)
    || (!isExplicitHuman && aiStages.has(canonicalStage));

  // 2. IA CONDUZINDO A CONVERSA
  if (isExplicitAi && !isExplicitHuman) {
    return {
      name: 'Assistente IA',
      id: null,
      kind: 'ai',
    };
  }

  // 3. ATENDIMENTO HUMANO
  if (isExplicitHuman) {
    const validActiveAgents = (Array.isArray(activeAgents) ? activeAgents : [])
      .filter((agent) => {
        if (!agent) return false;
        if (typeof agent === 'object') {
          if (agent.is_active === false) return false;
          if (agent.status === 'inactive') return false;
        }
        return true;
      });

    const cleanedAgents = validActiveAgents
      .map((agent) => {
        const rawName = typeof agent === 'string' ? agent : agent?.name;
        const cleanName = cleanAgentName(rawName);
        if (!cleanName) return null;
        return {
          name: cleanName,
          id: typeof agent === 'object' && agent?.id ? String(agent.id) : null,
        };
      })
      .filter(Boolean);

    if (cleanedAgents.length === 1) {
      return {
        name: cleanedAgents[0].name,
        id: cleanedAgents[0].id,
        kind: 'agent',
      };
    }

    return {
      name: 'Sem responsável',
      id: null,
      kind: 'none',
    };
  }

  // 4. SEM RESPONSÁVEL (quando não for possível determinar IA nem humano)
  return {
    name: 'Sem responsável',
    id: null,
    kind: 'none',
  };
}

export function resolveConversationOwner(paramsOrOwner = {}, activeAgentsList = [], isHumanControlledParam = null) {
  const details = resolveConversationOwnerDetails(paramsOrOwner, activeAgentsList, isHumanControlledParam);
  return details.name;
}

export function resolveConversationHeaderOwner(conversation, matchingCard = null, activeAgents = []) {
  if (!conversation) return { name: 'Sem responsável', id: null, kind: 'none' };
  if (isConversationClosed(conversation) || conversation.status === 'finalizado') {
    return { name: 'Sem responsável', id: null, kind: 'none' };
  }
  if (conversation.status === 'ia_ativa' && !conversation.handoff) {
    return { name: 'Assistente IA', id: null, kind: 'ai' };
  }
  const current = matchingCard || conversation;
  const currentControlMode = resolveSalesControlMode(current.salesStageKey ? {
    stage_key: current.salesStageKey,
    ai_locked: current.salesAiLocked,
  } : null);
  const isCurrentAi = currentControlMode === 'ai' || (currentControlMode === null && (
    current.ownerKind === 'ai' || current.owner === 'Assistente IA'
  ));
  if (isCurrentAi || currentControlMode === 'none') {
    return resolveConversationOwnerDetails({ currentControlMode: isCurrentAi ? 'ai' : 'none' });
  }
  const owner = current.owner || conversation.owner;
  const ownerId = matchingCard ? matchingCard.ownerId || null : conversation.ownerId;
  const agents = Array.isArray(activeAgents) ? activeAgents : [];
  const matchedAgent = (ownerId && agents.find((agent) => String(agent.id) === String(ownerId)))
    || (cleanAgentName(owner) && agents.find((agent) => agent.name?.trim().toLowerCase() === owner.trim().toLowerCase()));
  const isHumanControlled = currentControlMode === 'human' || current.ownerKind === 'agent'
    || conversation.status === 'atendimento_humano'
    || normalizeStage(conversation.stage) === 'Atendimento humano';

  return resolveConversationOwnerDetails({
    currentControlMode,
    explicitOwner: matchedAgent?.name || (isHumanControlled ? owner : null),
    explicitOwnerId: matchedAgent?.id || ownerId,
    activeAgents: agents,
    isHumanControlled,
    isAiControlled: !isHumanControlled && (conversation.status === 'ia_ativa' || owner === 'Assistente IA'),
    stage: conversation.stage,
  });
}

export function resolveMessageSender(event = {}, fallbackOwner = '') {
  const direction = String(event.direction || '').toLowerCase();
  const senderType = String(event.sender_type || '').toLowerCase();
  const aiProvider = String(event.ai_provider || '').toLowerCase();
  const service = String(event.service || '').toLowerCase();
  const rawPayload = asObject(event.raw_payload);

  // 1. Inbound do cliente
  if (direction === 'inbound') {
    if (senderType === 'system') {
      return { type: 'system', label: 'Sistema' };
    }
    return { type: 'contact', label: 'Cliente' };
  }

  // 2. Outbound explícito de IA (nunca associar a atendente humano)
  const isExplicitAi = senderType === 'assistant'
    || ['gemini', 'openai', 'anthropic', 'ia', 'ai', 'bot'].includes(aiProvider)
    || service === 'ia_active'
    || service === 'bot_reply';

  if (isExplicitAi) {
    return { type: 'ai', label: 'IA' };
  }

  // 3. Outbound de atendente humano
  const isFromMe = Boolean(
    rawPayload?.data?.key?.fromMe
    || rawPayload?.fromMe
    || rawPayload?.magia_operator?.source === 'whatsapp_fromMe'
  );

  const isHumanAgent = [
    'agent',
    'human',
    'operator',
    'atendente',
  ].includes(senderType)
    || service === 'manual_reply'
    || aiProvider === 'human_operator'
    || isFromMe
    || Boolean(cleanAgentName(event.sent_by_user));

  if (isHumanAgent) {
    const rawSentBy = event.sent_by_user
      || rawPayload?.magia_operator?.operator_name
      || rawPayload?.assignee?.name
      || '';
    const cleanSentBy = cleanAgentName(rawSentBy);
    const cleanFallback = cleanAgentName(fallbackOwner);
    const label = cleanSentBy || cleanFallback || 'Atendente';
    return { type: 'agent', label };
  }

  if (senderType === 'system') {
    return { type: 'system', label: 'Sistema' };
  }

  // 4. Default outbound (se não for explicitamente humano, assume IA para automações de canal)
  return { type: 'ai', label: 'IA' };
}

export function resolveEventMessagePreview(event, fallbackOwner = '') {
  if (!event || isInternalOperationalEvent(event)) return null;
  const technical = technicalEventPresentation(event);
  if (technical) return { text: technical.title, sender: 'Sistema', senderType: 'system' };
  const payload = asObject(event.raw_payload);
  if (event.direction === 'internal' || event.is_internal === true || payload.is_internal === true) {
    return null;
  }

  const trimmedText = String(event.message_text || '').trim().toLowerCase();
  if (trimmedText === '[secretencrypted]') {
    return null;
  }

  const service = String(event.service || '').toLowerCase();
  const isReaction = service === 'reaction'
    || String(payload?.messageType || '').toLowerCase() === 'reactionmessage'
    || String(payload?.event || '').toLowerCase() === 'messages.reaction'
    || Boolean(payload?.reaction)
    || Boolean(payload?.magia_normalized?.reaction)
    || trimmedText === 'reaction'
    || trimmedText === '[reaction]';
  if (isReaction) {
    return null;
  }

  const aiProvider = String(event.ai_provider || '').toLowerCase();
  const command = String(payload?.command || '').toLowerCase();
  const operationalIndicators = [
    'conversation_closed',
    'conversation_assigned',
    'resume_ai',
    'close_conversation',
    'assign_conversation',
    'kanban_stage_changed',
    'kanban_move',
  ];
  if (
    operationalIndicators.includes(service)
    || operationalIndicators.includes(aiProvider)
    || operationalIndicators.includes(command)
  ) {
    return null;
  }

  // Se for evento legado com resposta da IA embutida no inbound
  if (event.direction !== 'outbound' && event.response_text) {
    return {
      text: event.response_text,
      sender: 'IA',
      senderType: 'ai',
    };
  }

  const location = normalizeLocation(event.raw_payload, event);
  const isLocation = Boolean(location)
    || trimmedText === '[location]'
    || trimmedText === 'location'
    || String(payload?.messageType || '').toLowerCase() === 'locationmessage';

  let preview = '';
  if (isLocation) {
    const usefulName = location?.name || location?.address;
    preview = usefulName || 'Localização';
  } else {
    const media = normalizeMedia(event.raw_payload, event);
    const caption = String(media?.caption || '').trim();
    const eventText = resolveEventVisibleText(event, media);
    const hasRealCaption = caption && !isGeneratedMediaLabel(caption) && !Object.prototype.hasOwnProperty.call(TECHNICAL_MEDIA_LABELS, caption.toLowerCase());

    let text = '';
    if (hasRealCaption) {
      text = caption;
    } else if (eventText && !isGeneratedMediaLabel(eventText)) {
      text = eventText;
    }

    const audioTranscription = normalizeAudioTranscription(event.raw_payload, event);
    if ((!text || isMediaPlaceholderForKind(text, 'audio')) && audioTranscription?.text) {
      text = audioTranscription.text;
    }

    preview = text || mediaPreview(media) || (event.direction === 'outbound' ? event.response_text : '') || '';
  }

  if (!preview) return null;

  const senderInfo = resolveMessageSender(event, fallbackOwner);
  return {
    text: preview,
    sender: senderInfo.label,
    senderType: senderInfo.type,
  };
}


import { asObject } from '../../utils/asObject.js';
import { formatDate, compareDateLabel } from '../../utils/dateFormatting.js';
import { appointmentTimestamp, isMoreRecentRecord } from '../../utils/recordRecency.js';
import { prepareConversationEvents } from '../conversations/conversationEvents.js';
import { applyConversationLifecycle, isConversationClosed } from '../conversations/conversationLifecycle.js';
import { isCustomerInboundEvent, isFollowUpOutboundEvent } from '../conversations/conversationEventState.js';
import { eventSessionId, isExplicitAiOwnershipTransition } from '../conversations/ownershipEvidence.js';
import { isConversationWaitingForFollowUp } from '../timeline/conversationFilters.js';
import { isInternalOperationalEvent } from '../timeline/eventClassification.js';
import { getTenantSchedulingLink } from '../appointments/schedulingLinks.js';
import { canonicalConversationKey, normalizeChannel, normalizeExternalConversationId } from '../identity/conversationIdentity.js';
import { latestSlotProposalByConversation } from '../appointments/slotProposalStatus.js';
import { estimatedValue } from '../conversations/conversationDerived.js';
import { getUsefulTrustedContactName } from '../contacts/contactNames.js';
import { extractAvatarUrlFromEvent } from '../contacts/contactPayload.js';
import { resolveConversationDisplayName } from '../contacts/contactDisplayName.js';
import { cleanAgentName } from '../agents/agentNames.js';
import { normalizeStage, resolveConversationOwnerDetails } from '../conversations/conversationPresentation.js';
import { emptyKanban, OFFICIAL_KANBAN_COLUMNS, canonicalKanbanKey, normalizeKey } from './kanbanHelpers.js';
import { GENESIS_SALES_STAGE_BY_KEY, GENESIS_SALES_STAGE_KEYS, isGenesisSalesTenant } from './commercialStages.js';
import { findKanbanColumn, getStageLabel } from './stageResolution.js';
import { sortKanbanCardsByConversationActivity } from './applyIncomingEvent.js';
import { emptyFunnel, formatCurrency } from '../funnel/funnelHelpers.js';
import { buildSalesLeadIndex as buildSalesLeadIndexWithHelpers, resolveSalesControlMode } from '../leads/leadDataReads.js';
import { resolveContactCategory } from '../contacts/contactCategory.js';
import { normalizeMedia } from '../media/mediaNormalization.js';
import { mediaPreview } from '../media/mediaPresentation.js';
import { formatConversationPreview } from '../../utils/audioUtils.js';
import { technicalEventPresentation } from '../conversations/technicalEventPresentation.js';
import { closedColumnReason, isClosedKanbanColumn } from './kanbanCardReason.js';
import {
  AI_KANBAN_COLUMNS, HUMAN_KANBAN_COLUMNS, conversationKanbanCandidates, extractFollowUpStepKey, findKanbanDestination,
  followUpCardReason, followUpStepLabel, humanKanbanStage, isKanbanAssignedToHuman, isKanbanClosed, isKanbanWaitingHuman, nextTeamReviewRequestedAt,
} from './cardRouting.js';

const HUMAN_HELD_COLUMNS = new Set(['aguardando_humano', 'com_humano', 'conversas_humanos']);

export function eventsToKanban(
  events,
  tenantSlug = 'clinica_nubia',
  appointments = [],
  kanbanConfig = null,
  followUpJobs = [],
  salesLeads = [],
  teamAgents = [],
) {
  let activeAgents = Array.isArray(teamAgents) && teamAgents.length ? teamAgents : null;
  if (!activeAgents && typeof window !== 'undefined' && window.localStorage && tenantSlug) {
    try {
      const cached = window.localStorage.getItem(`magia:team-agents:${tenantSlug}`);
      if (cached) activeAgents = JSON.parse(cached);
    } catch (_) {}
  }
  const resolvedActiveAgents = Array.isArray(activeAgents) ? activeAgents : [];

  const columns = buildKanbanColumns(kanbanConfig, tenantSlug);
  const salesLeadsByConversation = buildSalesLeadIndexWithHelpers(
    isGenesisSalesTenant(tenantSlug) ? salesLeads : [], canonicalConversationKey, isMoreRecentRecord,
  );
  const latestByChat = new Map();
  const latestConversationActivityByChat = new Map();
  const latestNamedContactByChat = new Map();
  const explicitOwnerByChat = new Map();
  const explicitOwnerIdByChat = new Map();
  const eventCountsByChat = new Map();
  const conversationStatesByChat = new Map();
  const closeEventsByChat = new Map();
  const latestInboundAtByChat = new Map();
  const latestFollowUpEventByChat = new Map();
  const appointmentsById = new Map(appointments.map((appointment) => [appointment.id, appointment]));
  const eventCardsByConversation = new Map();

  for (const event of prepareConversationEvents(events).sort((a, b) => compareDateLabel(a.created_at, b.created_at))) {
    if (tenantSlug && event.tenant_slug && event.tenant_slug !== tenantSlug) continue;
    if (isKnownKanbanTestArtifact(event)) continue;
    if (isInternalOperationalEvent(event) && !asObject(event.raw_payload).kanban_transition?.to_column) continue;
    const key = canonicalConversationKey(event.channel_type, event.external_conversation_id, event.id);
    if (!conversationStatesByChat.has(key)) conversationStatesByChat.set(key, { status: 'ia_ativa' });
    const state = conversationStatesByChat.get(key);
    const humanStage = humanKanbanStage(event);
    const closed = isKanbanClosed(event);
    let lifecycleStage = event.stage;
    if (closed) lifecycleStage = 'Finalizado';
    else if (humanStage) lifecycleStage = 'Atendimento humano';
    else if (canonicalKanbanKey(event.stage) !== 'sales_closed') lifecycleStage = normalizeStage(event.stage);
    applyConversationLifecycle(state, event, lifecycleStage);
    const session = eventSessionId(event);
    if (closed || (state.status !== 'finalizado' && (!session || session !== state.closedSessionId))) {
      state.teamReviewRequestedAt = nextTeamReviewRequestedAt(state.teamReviewRequestedAt, event);
    }
    if (closed) closeEventsByChat.set(key, event);
    if (state.status !== 'atendimento_humano') state.humanKanbanStage = '';
    else if (humanStage && (!state.humanKanbanStage || humanStage !== 'aguardando_humano' || event.service === 'handoff_requested')) {
      state.humanKanbanStage = humanStage;
    }
  }

  // Atribuições precisam ser lidas em ordem temporal, independentemente da ordem da query.
  for (const event of [...events].sort((a, b) => compareDateLabel(a.created_at, b.created_at))) {
    if (tenantSlug && event.tenant_slug && event.tenant_slug !== tenantSlug) continue;
    if (isKnownKanbanTestArtifact(event)) continue;
    const key = canonicalConversationKey(event.channel_type, event.external_conversation_id, event.id);
    // O pin do pipeline é só um marcador interno: o primeiro loop e o tempo real o ignoram, e a recarga também.
    if (isInternalOperationalEvent(event) && !asObject(event.raw_payload).kanban_transition?.to_column) continue;
    eventCountsByChat.set(key, (eventCountsByChat.get(key) || 0) + 1);
    const current = latestByChat.get(key);
    if (!current || isMoreRecentRecord(event, current)) latestByChat.set(key, event);
    if (isCustomerInboundEvent(event) && event.created_at) {
      const prevInbound = latestInboundAtByChat.get(key);
      if (!prevInbound || Date.parse(event.created_at) >= Date.parse(prevInbound)) {
        latestInboundAtByChat.set(key, event.created_at);
      }
    } else if (isFollowUpOutboundEvent(event) && event.created_at) {
      const prevFollowUp = latestFollowUpEventByChat.get(key);
      if (!prevFollowUp || Date.parse(event.created_at) >= Date.parse(prevFollowUp.created_at)) {
        latestFollowUpEventByChat.set(key, event);
      }
    }

    const payload = asObject(event.raw_payload);
    const assignee = asObject(payload.assignee);
    if (isExplicitAiOwnershipTransition(event) || (isGenesisSalesTenant(tenantSlug) && event.service === 'resume_ai')) {
      explicitOwnerByChat.delete(key);
      explicitOwnerIdByChat.delete(key);
      continue;
    }
    if (isConversationClosed(event) || event.service === 'conversation_closed') {
      explicitOwnerByChat.delete(key);
      explicitOwnerIdByChat.delete(key);
    }
    const candidateName = cleanAgentName(assignee.name || payload.assigned_to);
    const candidateId = assignee.id || payload.assignee_id || null;
    if (candidateName) {
      explicitOwnerByChat.set(key, candidateName);
      if (candidateId) explicitOwnerIdByChat.set(key, candidateId);
      else explicitOwnerIdByChat.delete(key);
    } else if (event.service === 'conversation_assigned' && event.sent_by_user) {
      const cleanSent = cleanAgentName(event.sent_by_user);
      if (cleanSent) {
        explicitOwnerByChat.set(key, cleanSent);
        explicitOwnerIdByChat.delete(key);
      }
    }

    // Eventos de operação determinam a etapa, mas não representam uma nova
    // mensagem da conversa. Mantemos a identidade e a recência independentes.
    if (isKanbanOperationalEvent(event)) continue;
    const currentActivity = latestConversationActivityByChat.get(key);
    if (!currentActivity || isMoreRecentRecord(event, currentActivity)) {
      latestConversationActivityByChat.set(key, event);
    }
    if (getUsefulTrustedContactName(event)) {
      const currentNamedContact = latestNamedContactByChat.get(key);
      if (!currentNamedContact || isMoreRecentRecord(event, currentNamedContact)) {
        latestNamedContactByChat.set(key, event);
      }
    }
  }

  const defaultSchedulingUrl = getTenantSchedulingLink(tenantSlug);

  for (const [key, lead] of salesLeadsByConversation) {
    if (latestByChat.has(key)) continue;
    latestByChat.set(key, {
      id: `sales-${lead.id}`,
      channel_type: lead.channel_type,
      external_conversation_id: lead.chat_id,
      contact_name_canonical: lead.state?.customer_name,
      message_text: lead.product?.name || 'Lead comercial',
      direction: 'internal',
      created_at: lead.updated_at,
    });
  }

  for (const [key, latestEvent] of latestByChat) {
    const conversationState = conversationStatesByChat.get(key);
    const event = conversationState?.status === 'finalizado' ? closeEventsByChat.get(key) || latestEvent : latestEvent;
    const channelType = normalizeChannel(event.channel_type);
    const salesLead = salesLeadsByConversation.get(key);
    const activityEvent = latestConversationActivityByChat.get(key) || event;
    const identityEvent = latestNamedContactByChat.get(key) || activityEvent;
    const payload = asObject(event.raw_payload);
    const relatedAppointmentId = payload.payment_signal?.appointment_update?.appointment?.id
      || payload.appointment_id || payload.appointment_creation?.appointment?.id || '';
    const relatedAppointment = appointmentsById.get(relatedAppointmentId);
    const latestCustomerInboundAt = latestInboundAtByChat.get(key) || null;
    const latestFollowUpEvent = latestFollowUpEventByChat.get(key) || null;
    const waitingForFollowUp = isConversationWaitingForFollowUp({
      status: conversationState?.status,
      stage: event.stage,
      latestFollowUpAt: latestFollowUpEvent?.created_at || null,
      latestCustomerInboundAt,
    });
    const targetCandidates = resolveTenantKanbanStage({
      tenantSlug,
      salesLead,
      event,
      conversationState,
      context: {
        columns,
        direction: event.direction,
        isFirstContact: (eventCountsByChat.get(key) || 0) <= 1,
        paymentResolved: relatedAppointment && !isAppointmentPaymentReported(relatedAppointment.status),
        waitingForFollowUp,
      },
    });
    const column = findKanbanDestination(columns, targetCandidates) || findKanbanDestination(columns, AI_KANBAN_COLUMNS) || columns[0];
    const target = column.automationKey || column.id;
    const isFollowUpCard = target === 'follow_ups' && waitingForFollowUp;
    const followUpStepKey = isFollowUpCard ? extractFollowUpStepKey(latestFollowUpEvent) : '';
    const resolvedFollowUpLabel = isFollowUpCard ? followUpStepLabel(followUpStepKey) : '';

    const currentControlMode = resolveSalesControlMode(salesLead);
    const technicalReview = technicalEventPresentation(event);
    const isHumanControlled = currentControlMode !== null ? currentControlMode === 'human' : (Boolean(event.handoff)
      || conversationState?.status === 'atendimento_humano'
      || normalizeStage(event.stage) === 'Atendimento humano'
      || isKanbanAssignedToHuman(event)
      || HUMAN_KANBAN_COLUMNS.has(target));
    let aiReason = isHumanControlled ? '' : 'IA conduzindo a conversa';
    if (currentControlMode === 'none') aiReason = '';
    if (!isHumanControlled && target === 'follow_ups') {
      aiReason = followUpCardReason(resolvedFollowUpLabel);
    } else if (!isHumanControlled && target === 'agendamentos') {
      aiReason = 'Registro operacional do sistema';
    } else if (!isHumanControlled && target === 'verificar_sinal') {
      aiReason = 'Sinal informado pela cliente';
    } else if (!isHumanControlled && target === 'produtos_apresentados') {
      aiReason = 'Catalogo ou fotos apresentados';
    } else if (!isHumanControlled && target === 'interesse_compra') {
      aiReason = 'Cliente demonstrou interesse de compra';
    } else if (!isHumanControlled && target === 'aguardando_finalizacao') {
      aiReason = 'Aguardando finalizacao do pedido';
    } else if (!isHumanControlled && isClosedKanbanColumn(target)) {
      aiReason = closedColumnReason(target);
    } else if (!isHumanControlled && target === 'conversas_abandonadas') {
      aiReason = 'Conversa sem encerramento recente';
    } else if (!isHumanControlled && target === 'novas_conversas') {
      aiReason = 'Primeiro contato recebido';
    }

    const isClosedConv = conversationState?.status === 'finalizado' || isKanbanClosed(event) || isClosedKanbanColumn(target);
    if (isClosedConv) {
      aiReason = closedColumnReason(target)
        || closedColumnReason(asObject(event.raw_payload).close_reason === 'no_show' ? 'nao_compareceu' : 'finalizadas');
    }
    const chatExplicitOwner = isClosedConv ? null : (explicitOwnerByChat.get(key)
      || cleanAgentName(asObject(event.raw_payload)?.assignee?.name)
      || cleanAgentName(asObject(event.raw_payload)?.human_dispatch?.assignee_name)
      || cleanAgentName(salesLead?.state?.human_dispatch?.assignee_name)
      || cleanAgentName(asObject(event.raw_payload)?.assigned_to)
      || null);
    const chatExplicitOwnerId = isClosedConv ? null : (explicitOwnerIdByChat.get(key)
      || asObject(event.raw_payload)?.assignee?.id
      || asObject(event.raw_payload)?.human_dispatch?.assignee_id
      || salesLead?.state?.human_dispatch?.assignee_id
      || asObject(event.raw_payload)?.assignee_id
      || null);

    const ownerMetadata = resolveConversationOwnerDetails(isClosedConv || ['aguardando_humano', 'conversas_abandonadas'].includes(target) ? { currentControlMode: 'none' } : {
      explicitOwner: chatExplicitOwner,
      explicitOwnerId: chatExplicitOwnerId,
      currentControlMode,
      activeAgents: resolvedActiveAgents,
      isHumanControlled,
      isAiControlled: !isHumanControlled && !isClosedKanbanColumn(target),
      aiLocked: Boolean(salesLead?.ai_locked),
      handoff: Boolean(event.handoff),
      stage: salesLead?.stage_key || event.stage,
      targetColumnId: target,
    });

    const contactCategory = resolveContactCategory({
      ...identityEvent,
      ...activityEvent,
      ...event,
      contact_name: resolveConversationDisplayName(identityEvent, ''),
    });

    // Contatos comerciais / não-clientes não devem poluir o funil de vendas do Kanban
    if (contactCategory.category === 'commercial' || event.service === 'non_customer' || event.ai_provider === 'non_customer_suppression') {
      continue;
    }

    const rawPayload = asObject(event.raw_payload);
    const outsideBusinessHours = rawPayload?.human_dispatch?.within_business_hours === false
      || (rawPayload?.business_hours && rawPayload.business_hours.is_open === false)
      || Boolean(salesLead?.state?.business_hours && salesLead.state.business_hours.is_open === false);
    const nextBusinessSession = rawPayload?.human_dispatch?.next_opening
      || rawPayload?.business_hours?.next_opening?.formatted
      || salesLead?.state?.business_hours?.next_opening
      || null;

    const dispatchStatus = rawPayload?.human_dispatch?.status || salesLead?.state?.human_dispatch?.status || null;
    if (!isClosedConv && isHumanControlled && dispatchStatus === 'dispatch_failed') {
      aiReason = 'Falha no encaminhamento para fila humana';
    } else if (!isClosedConv && isHumanControlled && dispatchStatus === 'dispatch_uncertain') {
      aiReason = 'Atendimento com status incerto - requer intervenção manual';
    } else if (!isClosedConv && outsideBusinessHours && isHumanControlled) {
      aiReason = nextBusinessSession
        ? `Aguardando próximo expediente (${nextBusinessSession})`
        : 'Aguardando próximo expediente comercial';
    } else if (!isClosedConv && outsideBusinessHours && ownerMetadata.kind === 'ai' && target !== 'agendamentos' && target !== 'verificar_sinal' && target !== 'follow_ups') {
      aiReason = 'IA atendendo fora do horário comercial';
    }

    const card = {
      id: `card-${event.id}`,
      canonicalKey: key,
      normalizedExternalId: normalizeExternalConversationId(channelType.type, event.external_conversation_id),
      externalConversationId: event.external_conversation_id,
      title: resolveConversationDisplayName(identityEvent, `Contato ${channelType.label}`),
      subtitle: salesFinancingSummary(salesLead, tenantSlug)
        // Evento técnico (erro do motor) não tem texto: mostra o aviso legível, nunca o nome interno do serviço.
        || technicalEventPresentation(activityEvent)?.title
        || activityEvent.message_text
        || (() => {
          const media = normalizeMedia(activityEvent.raw_payload, activityEvent);
          return formatConversationPreview(media?.caption || (media?.kind === 'image' ? '[image]' : mediaPreview(media)));
        })()
        || (!['sales_stage_changed', 'kanban_stage_changed', 'kanban_move', 'resume_ai', 'conversation_assigned', 'conversation_closed', 'handoff_requested'].includes(activityEvent.service) && activityEvent.service)
        || 'Mensagem recente',
      channel: channelType.label,
      channelType: channelType.type,
      stage: getStageLabel(salesLead?.stage_key || event.stage, { kanbanColumns: columns, tenantSlug }),
      targetColumnId: target,
      value: formatCurrency(estimatedValue(event)),
      owner: ownerMetadata.name,
      ownerId: ownerMetadata.id,
      ownerKind: ownerMetadata.kind,
      needsReview: Boolean(technicalReview),
      humanKanbanStage: conversationState?.humanKanbanStage || '',
      teamReviewRequestedAt: conversationState?.teamReviewRequestedAt || null,
      closedSessionId: conversationState?.closedSessionId || null,
      isClosed: isClosedConv,
      lastControlAt: event.created_at || null,
      contactCategory: contactCategory.category,
      contactCategoryLabel: contactCategory.label,
      salesLeadId: salesLead?.id || null,
      salesStageKey: salesLead?.stage_key || null,
      salesRevision: Number.isInteger(salesLead?.revision) ? salesLead.revision : null,
      salesIntent: salesLead?.state?.intent || null,
      salesHot: Boolean(salesLead?.hot),
      salesAiLocked: Boolean(salesLead?.ai_locked),
      salesInterestRegistered: Boolean(salesLead?.interest_registered),
      salesTemperature: salesLead?.state?.temperature || salesLead?.state?.financing?.temperature || (salesLead?.hot ? 'hot' : null),
      salesPaymentMode: salesLead?.state?.payment_mode || null,
      salesDepositCents: Number.isSafeInteger(salesLead?.deposit_cents) ? salesLead.deposit_cents : (Number.isSafeInteger(salesLead?.state?.deposit_cents) ? salesLead.state.deposit_cents : null),
      humanDispatchStatus: rawPayload?.human_dispatch?.status || salesLead?.state?.human_dispatch?.status || null,
      outsideBusinessHours,
      nextBusinessSession,
      aiReason,
      isFollowUp: isFollowUpCard,
      waitingForFollowUp: isFollowUpCard,
      followUpLabel: resolvedFollowUpLabel,
      followUpStepKey: followUpStepKey || '',
      latestFollowUpAt: latestFollowUpEvent?.created_at || null,
      latestCustomerInboundAt,

      appointmentId: relatedAppointmentId,
      appointmentStatus: relatedAppointment?.status || '',
      appointmentStatusLabel: relatedAppointment?.statusLabel || '',
      appointmentStartsAt: relatedAppointment?.startsAt,
      actionType: target === 'verificar_sinal' && relatedAppointmentId && (!relatedAppointment || isAppointmentPaymentReported(relatedAppointment.status)) ? 'confirm_signal' : '',
      schedulingLink: defaultSchedulingUrl,
      hasSchedulingLink: Boolean(defaultSchedulingUrl) && (target === 'agendamentos' || hasSchedulingSignal(event.message_text)),
      lastAt: formatDate(activityEvent.created_at),
      lastActivityAt: activityEvent.created_at || null,
      avatarUrl: extractAvatarUrlFromEvent(activityEvent) || extractAvatarUrlFromEvent(identityEvent) || null,
    };
    column.cards.push(card);
    eventCardsByConversation.set(key, { card, column, occurredAt: event.created_at });
  }

  const latestAppointmentsByConversation = new Map();
  const extraAppointments = [];
  for (const appointment of appointments) {
    if (['cancelled', 'canceled'].includes(appointment.status)) continue;
    const key = canonicalConversationKey(
      appointment.channelType || appointment.channel_type,
      appointment.externalConversationId || appointment.external_conversation_id,
      `appointment-${appointment.id}`,
    );
    const current = latestAppointmentsByConversation.get(key);
    const priority = appointmentKanbanPriority(appointment.status);
    const currentPriority = appointmentKanbanPriority(current?.status);
    const replaces = !current || priority > currentPriority
      || (priority === currentPriority && isMoreRecentRecord(appointment, current));
    // Cada pedido pendente ou confirmado mantém seu cartão, mesmo quando a conversa está vinculada a outro agendamento.
    const displaced = replaces ? current : appointment;
    if (displaced && (appointmentKanbanPriority(displaced.status) > 0 || displaced.status === 'no_show')) {
      extraAppointments.push(displaced);
    }
    if (replaces) latestAppointmentsByConversation.set(key, appointment);
  }

  const toAppointmentCard = (appointment) => ({
      id: `appointment-${appointment.id}`,
      appointmentId: appointment.id,
      appointmentTitle: appointment.title || '',
      title: appointment.title,
      subtitle: appointment.contactName ? `${appointment.contactName} - ${appointment.when}` : appointment.when,
      // Nome e horário separados para o card destacar cada um (o subtítulo acima continua para quem o usa).
      appointmentContactName: appointment.contactName || '',
      appointmentWhen: appointment.when || '',
      channel: appointment.channelLabel,
      channelType: appointment.channelType,
      value: 'Agenda',
      owner: appointment.statusLabel,
      appointmentStatus: appointment.status,
      appointmentStatusLabel: appointment.statusLabel,
      appointmentStartsAt: appointment.startsAt,
      appointmentEndsAt: appointment.endsAt,
      appointmentMetadata: appointment.raw?.metadata || {},
      externalConversationId: appointment.externalConversationId,
      // 'nao_compareceu' só existe em quadros que a criaram; nos demais o cartão cai em 'agendamentos' (fallback abaixo).
      targetColumnId: isAppointmentPaymentReported(appointment.status) ? 'verificar_sinal'
        : appointment.status === 'no_show' ? 'nao_compareceu'
          : appointment.status === 'pending_confirmation' ? 'confirmar_agendamento' : 'agendamentos',
      actionType: isAppointmentPaymentReported(appointment.status) ? 'confirm_signal'
        : appointment.status === 'pending_confirmation' ? 'confirm_request' : '',
      aiReason: isAppointmentPaymentReported(appointment.status)
        ? 'Sinal informado. Aguardando verificação humana.'
        : '',
    });
  const appointmentCards = [...latestAppointmentsByConversation.values()]
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))
    .map(toAppointmentCard);

  for (const appointmentCard of appointmentCards) {
    const key = canonicalConversationKey(
      appointmentCard.channelType,
      appointmentCard.externalConversationId,
      appointmentCard.id,
    );
    const matchingEvent = eventCardsByConversation.get(key);
    const targetColumn = findKanbanColumn(columns, appointmentCard.targetColumnId) || findKanbanColumn(columns, 'agendamentos');

    if (matchingEvent) {
      const appointment = latestAppointmentsByConversation.get(key);
      // Pedido aberto fica na coluna mesmo com mensagem nova, salvo se a conversa estiver com humano.
      const openRequest = appointment.status === 'pending_confirmation';
      const heldByHuman = openRequest && HUMAN_HELD_COLUMNS.has(matchingEvent.column.automationKey || matchingEvent.column.id);
      if (targetColumn && appointment.status === 'no_show') {
        if (matchingEvent.column === targetColumn && closeEventsByChat.get(key)?.raw_payload?.appointment_id === appointment.id) {
          matchingEvent.column.cards = matchingEvent.column.cards.filter(card => card.id !== matchingEvent.card.id);
        }
        targetColumn.cards.push(detachedAppointmentCard(appointmentCard, matchingEvent.card, targetColumn));
        continue;
      }
      // Agendamento confirmado e futuro também puxa o card que só está com a IA (ex.: "Obrigada" depois da confirmação).
      const upcomingConfirmed = appointment.status === 'confirmed'
        && Date.parse(appointment.startsAt || '') > Date.now()
        && AI_KANBAN_COLUMNS.has(matchingEvent.column.automationKey || matchingEvent.column.id);
      const actionable = openRequest || upcomingConfirmed || appointmentCard.actionType === 'confirm_signal';
      // Atendimento finalizado depois do pedido: a conversa (finalizada ou já em outra sessão) segue o próprio caminho no
      // quadro e o pedido fica sozinho na coluna dele, sem herdar nem esconder o estado da conversa.
      const closeEvent = closeEventsByChat.get(key);
      const closedAfterRequest = Boolean(closeEvent)
        && Date.parse(closeEvent.created_at) > Date.parse(appointmentTimestamp(appointment) || appointment.createdAt || 0);
      if (targetColumn && closedAfterRequest && !heldByHuman) {
        targetColumn.cards.push(detachedAppointmentCard(appointmentCard, matchingEvent.card, targetColumn));
        continue;
      }
      if (targetColumn && (actionable || isMoreRecentRecord(appointment, { updated_at: matchingEvent.occurredAt })) && !heldByHuman) {
        matchingEvent.column.cards = matchingEvent.column.cards.filter((card) => card.id !== matchingEvent.card.id);
        const canonicalCard = mergeAppointmentCard(appointmentCard, matchingEvent.card, targetColumn);
        targetColumn.cards.push(canonicalCard);
        eventCardsByConversation.set(key, {
          card: canonicalCard,
          column: targetColumn,
          occurredAt: appointmentTimestamp(appointment),
        });
      } else {
        Object.assign(matchingEvent.card, enrichCardWithAppointment(matchingEvent.card, appointmentCard));
      }
      continue;
    }

    if (targetColumn) {
      targetColumn.cards.push({ ...appointmentCard, targetColumnId: targetColumn.automationKey || targetColumn.id });
    }
  }

  // Os demais agendamentos ficam na própria coluna, vinculados ao contato apenas para exibição e acesso ao chat.
  for (const appointment of extraAppointments) {
    const appointmentCard = toAppointmentCard(appointment);
    const targetColumn = findKanbanColumn(columns, appointmentCard.targetColumnId) || findKanbanColumn(columns, 'agendamentos');
    if (!targetColumn) continue;
    const key = canonicalConversationKey(appointmentCard.channelType, appointmentCard.externalConversationId, appointmentCard.id);
    const conversationCard = eventCardsByConversation.get(key)?.card;
    targetColumn.cards.push(conversationCard
      ? detachedAppointmentCard(appointmentCard, conversationCard, targetColumn)
      : { ...appointmentCard, detachedFromConversation: true, targetColumnId: targetColumn.automationKey || targetColumn.id });
  }

  if (appointmentCards.some((card) => card.targetColumnId === 'agendamentos') && !kanbanConfig?.columns?.length && !findKanbanColumn(columns, 'agendamentos')) {
    columns.push({
      id: 'agendamentos',
      title: 'Agendamentos',
      automationKey: 'agendamentos',
      cards: appointmentCards.filter((card) => card.targetColumnId === 'agendamentos'),
    });
  }

  // Estado da proposta de horário: o pedido cancelado não vira cartão, então o selo vai no cartão da conversa.
  const proposalsByConversation = latestSlotProposalByConversation(appointments, (appointment) => canonicalConversationKey(
    appointment.channelType || appointment.channel_type,
    appointment.externalConversationId || appointment.external_conversation_id,
    `appointment-${appointment.id}`,
  ));
  const visibleProposals = new Set();
  for (const column of columns) {
    for (const card of column.cards) {
      const own = card.appointmentStatus === 'pending_confirmation' ? card.appointmentMetadata?.slot_proposal : null;
      if (card.appointmentId && card.appointmentStatus !== 'pending_confirmation') continue;
      let proposal = own?.status === 'accepted'
        ? own
        : proposalsByConversation.get(canonicalConversationKey(card.channelType, card.externalConversationId, card.id));
      // Pedido pendente registrado depois da proposta (a pessoa recusou e pediu outro horário): o selo antigo não descreve este pedido.
      if (proposal && proposal !== own && card.appointmentStatus === 'pending_confirmation') {
        const requestedAt = Date.parse(card.appointmentMetadata?.request_updated_at || '');
        const proposalAt = Date.parse(proposal.resolved_at || proposal.sent_at || '');
        if (Number.isFinite(requestedAt) && Number.isFinite(proposalAt) && requestedAt > proposalAt) proposal = null;
      }
      if (proposal?.status === 'sent' && card.appointmentId) continue;
      if (proposal) {
        card.slotProposal = { id: proposal.id, appointmentId: proposal.appointmentId, status: proposal.status, date: proposal.date, time: proposal.time, sent_at: proposal.sent_at, resolved_at: proposal.resolved_at };
        visibleProposals.add(proposal.id);
      }
    }
  }
  const proposalColumn = findKanbanColumn(columns, 'confirmar_agendamento') || findKanbanColumn(columns, 'agendamentos');
  if (proposalColumn) {
    for (const proposal of proposalsByConversation.values()) {
      if (proposal.status !== 'sent' || visibleProposals.has(proposal.id)) continue;
      const appointment = appointmentsById.get(proposal.appointmentId);
      const card = toAppointmentCard(appointment);
      proposalColumn.cards.push({
        id: `proposal-${appointment.id}`,
        title: appointment.contactName || appointment.title,
        subtitle: appointment.title,
        channel: card.channel,
        channelType: card.channelType,
        externalConversationId: card.externalConversationId,
        targetColumnId: proposalColumn.automationKey || proposalColumn.id,
        detachedFromConversation: true,
        slotProposal: proposal,
      });
    }
  }

  for (const column of columns) {
    column.cards = sortKanbanCardsByConversationActivity(column.cards);
  }

  return columns;
}

function isKanbanOperationalEvent(event = {}) {
  if (isInternalOperationalEvent(event)) return true;
  return [
    'conversation_assigned',
    'resume_ai',
    'conversation_closed',
    'handoff_requested',
  ].includes(String(event.service || '').trim().toLowerCase());
}

function enrichCardWithAppointment(card, appointmentCard) {
  return {
    ...card,
    appointmentId: appointmentCard.appointmentId,
    appointmentTitle: appointmentCard.appointmentTitle,
    appointmentContactName: appointmentCard.appointmentContactName,
    appointmentStatus: appointmentCard.appointmentStatus,
    appointmentStatusLabel: appointmentCard.appointmentStatusLabel,
    appointmentStartsAt: appointmentCard.appointmentStartsAt,
    appointmentEndsAt: appointmentCard.appointmentEndsAt,
    appointmentMetadata: appointmentCard.appointmentMetadata,
    actionType: appointmentCard.actionType,
    hasSchedulingLink: card.hasSchedulingLink || appointmentCard.targetColumnId === 'agendamentos',
  };
}

function isAppointmentPaymentReported(status) {
  return status === 'payment_reported' || status === 'aguardando_verificacao';
}

function appointmentKanbanPriority(status) {
  if (isAppointmentPaymentReported(status)) return 3;
  if (status === 'pending_confirmation') return 2;
  if (['scheduled', 'confirmed', 'reserved', 'pending_payment'].includes(status)) return 1;
  return 0;
}

// Card do pedido quando a conversa já seguiu outro caminho: mostra o contato e a foto da conversa, mas nada do estado dela
// (responsável, etapa, encerramento, última atividade).
function detachedAppointmentCard(appointmentCard, eventCard, targetColumn) {
  return {
    ...appointmentCard,
    targetColumnId: targetColumn.automationKey || targetColumn.id,
    detachedFromConversation: true,
    title: eventCard.title || appointmentCard.title,
    channel: eventCard.channel || appointmentCard.channel,
    channelType: eventCard.channelType || appointmentCard.channelType,
    avatarUrl: eventCard.avatarUrl || appointmentCard.avatarUrl || null,
    externalConversationId: eventCard.externalConversationId || appointmentCard.externalConversationId,
    contactCategory: eventCard.contactCategory || appointmentCard.contactCategory || 'customer',
    contactCategoryLabel: eventCard.contactCategoryLabel || appointmentCard.contactCategoryLabel || 'Cliente',
  };
}

function mergeAppointmentCard(appointmentCard, eventCard, targetColumn) {
  return {
    ...appointmentCard,
    targetColumnId: targetColumn.automationKey || targetColumn.id,
    title: eventCard.title || appointmentCard.title,
    channel: eventCard.channel || appointmentCard.channel,
    channelType: eventCard.channelType || appointmentCard.channelType,
    externalConversationId: eventCard.externalConversationId || appointmentCard.externalConversationId,
    owner: eventCard.owner || appointmentCard.owner,
    ownerId: eventCard.ownerId || null,
    ownerKind: eventCard.ownerKind || null,
    needsReview: eventCard.needsReview,
    humanKanbanStage: eventCard.humanKanbanStage,
    teamReviewRequestedAt: eventCard.teamReviewRequestedAt,
    isClosed: eventCard.isClosed,
    closedSessionId: eventCard.closedSessionId,
    lastControlAt: eventCard.lastControlAt,
    // A foto do contato vem do card da conversa; o card do agendamento não tem foto própria.
    avatarUrl: eventCard.avatarUrl || appointmentCard.avatarUrl || null,
    contactCategory: eventCard.contactCategory || appointmentCard.contactCategory || 'customer',
    contactCategoryLabel: eventCard.contactCategoryLabel || appointmentCard.contactCategoryLabel || 'Cliente',
    schedulingLink: eventCard.schedulingLink,
    hasSchedulingLink: eventCard.hasSchedulingLink || appointmentCard.targetColumnId === 'agendamentos',
    isFollowUp: false,
    waitingForFollowUp: false,
    followUpLabel: '',
    followUpStepKey: '',
  };
}

function isKnownKanbanTestArtifact(event) {
  return String(event?.contact_name || '').trim() === 'Test'
    && String(event?.message_text || '').trim() === 'Test kanban move';
}

export function salesFinancingSummary(lead, tenantSlug) {
  if (!isGenesisSalesTenant(tenantSlug)) return '';
  const qualification = lead?.state?.financing_qualification;

  const labels = {
    ready: 'Entrada e documentos recebidos',
    documents_pending: 'Documentação pendente',
    deposit_insufficient: 'Entrada abaixo de 30%',
    deposit_unknown: 'Entrada não informada',
    vehicle_pending: 'Veículo a definir',
  };
  const money = (cents) => (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });

  if (['deposit_30_and_financing_documents_v1', 'deposit_and_financing_documents_v2'].includes(qualification?.rule)) {
    const amount = Number.isSafeInteger(qualification.deposit_cents)
      ? `Entrada: ${money(qualification.deposit_cents)}`
      : '';
    const minimum = Number.isSafeInteger(qualification.minimum_deposit_cents)
      ? `Mínimo: ${money(qualification.minimum_deposit_cents)}`
      : '';
    return [labels[qualification.status], amount, minimum].filter(Boolean).join(' | ');
  }

  if (lead?.state?.payment_mode === 'financing' || Number.isSafeInteger(lead?.deposit_cents) || Number.isSafeInteger(lead?.state?.deposit_cents)) {
    const depCents = Number.isSafeInteger(lead?.deposit_cents) ? lead.deposit_cents : lead?.state?.deposit_cents;
    const amount = Number.isSafeInteger(depCents) ? `Entrada: ${money(depCents)}` : '';
    const temp = lead?.state?.temperature || lead?.state?.financing?.temperature || (lead?.hot ? 'hot' : null);
    const tempLabel = temp === 'hot' ? 'Quente' : temp === 'warm' ? 'Morno' : temp === 'cold' ? 'Frio' : '';
    return ['Financiamento', tempLabel, amount].filter(Boolean).join(' | ');
  }

  return '';
}

export function resolveTenantKanbanStage({ tenantSlug, salesLead, event, conversationState, context = {} }) {
  const manualTarget = asObject(event?.raw_payload).kanban_transition?.to_column;
  if (!isGenesisSalesTenant(tenantSlug)) {
    if (manualTarget && (!context.columns || findKanbanColumn(context.columns, manualTarget))) return [manualTarget];
    const humanStage = conversationState?.humanKanbanStage || humanKanbanStage(event);
    return conversationKanbanCandidates(event, { ...context, humanStage });
  }

  const persistedStage = canonicalKanbanKey(salesLead?.stage_key);
  if (persistedStage === 'sales_qualifying' && salesLead?.state?.payment_mode === 'financing' && salesLead?.state?.financing?.review_status === 'ready_for_human') {
    return ['sales_financing'];
  }
  if (context.waitingForFollowUp && (!persistedStage || ['sales_new', 'sales_qualifying', 'sales_hot'].includes(persistedStage))
    && !salesLead?.ai_locked && conversationState?.status !== 'atendimento_humano'
    && conversationState?.status !== 'finalizado' && !humanKanbanStage(event)
    && !isKanbanClosed(event) && (!manualTarget || !GENESIS_SALES_STAGE_KEYS.has(canonicalKanbanKey(manualTarget)))
    && findKanbanColumn(context.columns, 'follow_ups')) {
    return ['follow_ups'];
  }
  if (GENESIS_SALES_STAGE_KEYS.has(persistedStage)) return [persistedStage];

  // Sem etapa comercial persistida, sinais operacionais e o contexto do lead são
  // apenas um fallback. Uma conversa encerrada nunca se torna venda concluída.
  if (manualTarget && GENESIS_SALES_STAGE_KEYS.has(canonicalKanbanKey(manualTarget))) return [canonicalKanbanKey(manualTarget)];
  const eventStage = canonicalKanbanKey(asObject(event?.raw_payload).sales_stage || event?.stage);
  if (GENESIS_SALES_STAGE_KEYS.has(eventStage)) return [eventStage];
  if (salesLead?.ai_locked || conversationState?.status === 'atendimento_humano' || isKanbanWaitingHuman(event)) {
    return ['sales_human'];
  }

  const intent = String(salesLead?.state?.intent || '').trim().toLowerCase();
  if (intent === 'after_sales') return ['sales_after_sales'];
  if (intent === 'sell') return ['sales_appraisal'];
  if (salesLead?.hot) return ['sales_hot'];
  if (salesLead?.state?.payment_mode === 'financing' && (salesLead?.state?.financing?.review_status === 'ready_for_human' || salesLead?.stage_key === 'sales_financing')) {
    return ['sales_financing'];
  }
  if (context.isFirstContact && context.direction !== 'outbound') return ['sales_new'];

  if (humanKanbanStage(event)) return ['sales_human'];
  return ['sales_qualifying'];
}


function buildKanbanColumns(kanbanConfig, tenantSlug = '') {
  const configuredColumns = kanbanConfig?.columns;
  if (!Array.isArray(configuredColumns) || !configuredColumns.length) {
    return emptyKanban();
  }

  const seen = new Set();
  const columns = configuredColumns
    .slice()
    .sort((left, right) => Number(left.position || 0) - Number(right.position || 0))
    .map((column) => {
      const canonicalKey = (column.automation_key && canonicalKanbanKey(column.automation_key))
        || (column.name && canonicalKanbanKey(column.name))
        || canonicalKanbanKey(column.id);
      const officialColumn = OFFICIAL_KANBAN_COLUMNS.find((item) => item.automationKey === canonicalKey);
      const rawKey = column.automation_key || column.name || column.id;
      const finalKey = canonicalKey || normalizeKey(column.name) || normalizeKey(rawKey) || String(column.id);
      const colId = canonicalKey || String(column.id || column.name);
      return {
        ...(officialColumn || {}),
        ...(GENESIS_SALES_STAGE_BY_KEY.get(canonicalKey) || {}),
        id: colId,
        title: column.name || officialColumn?.title || rawKey || 'Etapa',
        automationKey: finalKey,
        boardId: column.board_id,
        boardColumnId: column.id,
        position: column.position,
        icon: column.icon || null,
        tone: column.tone || null,
        ownerRole: column.owner_role || null,
        shortLabel: column.short_label || null,
        description: column.description || null,
        cards: [],
      };
    })
    .filter((column) => {
      const uniqueKey = column.id || column.automationKey;
      if (!uniqueKey || seen.has(uniqueKey)) return false;
      seen.add(uniqueKey);
      return true;
    });
  return orderKanbanColumnsForTenant(columns, tenantSlug);
}

function hasSchedulingSignal(messageText = '') {
  const text = String(messageText || '').toLowerCase();
  return text.includes('agendar') || text.includes('horario') || text.includes('horário') || text.includes('tuaagenda') || text.includes('link');
}

export function orderKanbanColumnsForTenant(columns = [], tenantSlug = '') {
  const sorted = [...columns].sort((left, right) => Number(left.position || 0) - Number(right.position || 0));
  if (!isGenesisSalesTenant(tenantSlug)) return sorted;

  return sorted.sort((left, right) => {
    const leftIndex = GENESIS_SALES_STAGE_BY_KEY.get(canonicalKanbanKey(left.automationKey || left.id))?.index;
    const rightIndex = GENESIS_SALES_STAGE_BY_KEY.get(canonicalKanbanKey(right.automationKey || right.id))?.index;
    return (leftIndex ?? Number.MAX_SAFE_INTEGER) - (rightIndex ?? Number.MAX_SAFE_INTEGER);
  });
}

export function ownerMetadataFromKanbanEvent(target, event, activeAgents = []) {
  const payload = asObject(event?.raw_payload);
  const assignee = asObject(payload?.assignee);
  const assigneeId = assignee?.id || payload?.assignee_id || null;
  const candidateName = assignee?.name || payload?.assigned_to || (isKanbanAssignedToHuman(event) ? event?.sent_by_user : null);

  return resolveConversationOwnerDetails({
    explicitOwner: candidateName,
    explicitOwnerId: assigneeId,
    activeAgents,
  });
}

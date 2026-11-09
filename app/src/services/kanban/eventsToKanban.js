import { asObject } from '../../utils/asObject.js';
import { formatDate, compareDateLabel } from '../../utils/dateFormatting.js';
import { appointmentTimestamp, isMoreRecentRecord } from '../../utils/recordRecency.js';
import { prepareConversationEvents } from '../conversations/conversationEvents.js';
import { applyConversationLifecycle, isConversationClosed } from '../conversations/conversationLifecycle.js';
import { isInternalOperationalEvent } from '../timeline/eventClassification.js';
import { getTenantSchedulingLink } from '../appointments/schedulingLinks.js';
import { canonicalConversationKey, normalizeChannel, normalizeExternalConversationId } from '../identity/conversationIdentity.js';
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
  const appointmentsById = new Map(appointments.map((appointment) => [appointment.id, appointment]));
  const eventCardsByConversation = new Map();

  for (const event of prepareConversationEvents(events).reverse()) {
    if (tenantSlug && event.tenant_slug && event.tenant_slug !== tenantSlug) continue;
    if (isKnownKanbanTestArtifact(event)) continue;
    if (isInternalOperationalEvent(event)) continue;
    const key = canonicalConversationKey(event.channel_type, event.external_conversation_id, event.id);
    if (!conversationStatesByChat.has(key)) conversationStatesByChat.set(key, { status: 'ia_ativa' });
    applyConversationLifecycle(conversationStatesByChat.get(key), event, normalizeStage(event.stage));
  }

  // Atribuições precisam ser lidas em ordem temporal, independentemente da ordem da query.
  for (const event of [...events].sort((a, b) => compareDateLabel(a.created_at, b.created_at))) {
    if (tenantSlug && event.tenant_slug && event.tenant_slug !== tenantSlug) continue;
    if (isKnownKanbanTestArtifact(event)) continue;
    const key = canonicalConversationKey(event.channel_type, event.external_conversation_id, event.id);
    eventCountsByChat.set(key, (eventCountsByChat.get(key) || 0) + 1);
    const current = latestByChat.get(key);
    if (!current || isMoreRecentRecord(event, current)) latestByChat.set(key, event);

    const payload = asObject(event.raw_payload);
    const assignee = asObject(payload.assignee);
    if (isGenesisSalesTenant(tenantSlug) && event.service === 'resume_ai') {
      explicitOwnerByChat.delete(key);
      explicitOwnerIdByChat.delete(key);
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

  for (const [key, event] of latestByChat) {
    const channelType = normalizeChannel(event.channel_type);
    const conversationState = conversationStatesByChat.get(key);
    const salesLead = salesLeadsByConversation.get(key);
    const activityEvent = latestConversationActivityByChat.get(key) || event;
    const identityEvent = latestNamedContactByChat.get(key) || activityEvent;
    const targetCandidates = resolveTenantKanbanStage({
      tenantSlug,
      salesLead,
      event,
      conversationState,
      context: {
        direction: event.direction,
        isFirstContact: (eventCountsByChat.get(key) || 0) <= 1,
      },
    });
    const target = targetCandidates.find((candidate) => findKanbanColumn(columns, candidate)) || targetCandidates[0];
    const column = findKanbanColumn(columns, target) || columns[0];
    const relatedAppointmentId = event.raw_payload?.payment_signal?.appointment_update?.appointment?.id
      || event.raw_payload?.appointment_id
      || event.raw_payload?.appointment_creation?.appointment?.id
      || '';
    const relatedAppointment = appointmentsById.get(relatedAppointmentId);

    if (target === 'verificar_sinal' && relatedAppointment) {
      continue;
    }

    const currentControlMode = resolveSalesControlMode(salesLead);
    const isHumanControlled = currentControlMode !== null ? currentControlMode === 'human' : (Boolean(event.handoff)
      || conversationState?.status === 'atendimento_humano'
      || normalizeStage(event.stage) === 'Atendimento humano'
      || isKanbanAssignedToHuman(event)
      || ['com_humano', 'conversas_humanos', 'aguardando_humano', 'sales_human'].includes(target));
    let aiReason = isHumanControlled ? '' : 'IA conduzindo a conversa';
    if (currentControlMode === 'none') aiReason = '';
    if (!isHumanControlled && target === 'agendamentos') {
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

    const isClosedConv = conversationState?.status === 'finalizado' || isClosedKanbanColumn(target);
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

    const ownerMetadata = resolveConversationOwnerDetails({
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
    if (dispatchStatus === 'dispatch_failed') {
      aiReason = 'Falha no encaminhamento para fila humana';
    } else if (dispatchStatus === 'dispatch_uncertain') {
      aiReason = 'Atendimento com status incerto - requer intervenção manual';
    } else if (outsideBusinessHours && isHumanControlled) {
      aiReason = nextBusinessSession
        ? `Aguardando próximo expediente (${nextBusinessSession})`
        : 'Aguardando próximo expediente comercial';
    } else if (outsideBusinessHours && !isHumanControlled && !aiReason) {
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

      appointmentId: relatedAppointmentId,
      appointmentStatus: relatedAppointment?.status || '',
      actionType: target === 'verificar_sinal' && relatedAppointmentId ? 'confirm_signal' : '',
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
  for (const appointment of appointments.filter((item) => item.status !== 'cancelled')) {
    const key = canonicalConversationKey(
      appointment.channelType || appointment.channel_type,
      appointment.externalConversationId || appointment.external_conversation_id,
      `appointment-${appointment.id}`,
    );
    const current = latestAppointmentsByConversation.get(key);
    // Pedido aberto é a pendência da conversa: vale mais que um agendamento já resolvido, mesmo mais recente.
    const replaces = !current || appointment.status === 'pending_confirmation'
      || (current.status !== 'pending_confirmation' && isMoreRecentRecord(appointment, current));
    if (replaces) latestAppointmentsByConversation.set(key, appointment);
  }

  const appointmentCards = [...latestAppointmentsByConversation.values()]
    .filter((appointment) => appointment.status !== 'cancelled')
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))
    .map((appointment) => ({
      id: `appointment-${appointment.id}`,
      appointmentId: appointment.id,
      title: appointment.title,
      subtitle: appointment.contactName ? `${appointment.contactName} - ${appointment.when}` : appointment.when,
      channel: appointment.channelLabel,
      channelType: appointment.channelType,
      value: 'Agenda',
      owner: appointment.statusLabel,
      appointmentStatus: appointment.status,
      appointmentStartsAt: appointment.startsAt,
      appointmentMetadata: appointment.raw?.metadata || {},
      externalConversationId: appointment.externalConversationId,
      // 'nao_compareceu' só existe em quadros que a criaram; nos demais o cartão cai em 'agendamentos' (fallback abaixo).
      targetColumnId: appointment.status === 'payment_reported' ? 'verificar_sinal'
        : appointment.status === 'no_show' ? 'nao_compareceu'
          : appointment.status === 'pending_confirmation' ? 'confirmar_agendamento' : 'agendamentos',
      actionType: appointment.status === 'payment_reported' ? 'confirm_signal'
        : appointment.status === 'pending_confirmation' ? 'confirm_request' : '',
      aiReason: appointment.status === 'payment_reported'
        ? 'Sinal informado. Aguardando verificação humana.'
        : '',
    }));

  for (const appointmentCard of appointmentCards) {
    const key = canonicalConversationKey(
      appointmentCard.channelType,
      appointmentCard.externalConversationId,
      appointmentCard.id,
    );
    const matchingEvent = eventCardsByConversation.get(key);

    if (matchingEvent) {
      const appointment = latestAppointmentsByConversation.get(key);
      // Pedido aberto fica na coluna mesmo com mensagem nova, salvo se a conversa estiver com humano.
      const openRequest = appointment.status === 'pending_confirmation';
      const heldByHuman = openRequest && HUMAN_HELD_COLUMNS.has(matchingEvent.column.automationKey || matchingEvent.column.id);
      if ((openRequest || isMoreRecentRecord(appointment, { updated_at: matchingEvent.occurredAt })) && !heldByHuman) {
        matchingEvent.column.cards = matchingEvent.column.cards.filter((card) => card.id !== matchingEvent.card.id);
        const targetColumn = findKanbanColumn(columns, appointmentCard.targetColumnId) || findKanbanColumn(columns, 'agendamentos');
        if (targetColumn) {
          const canonicalCard = mergeAppointmentCard(appointmentCard, matchingEvent.card);
          targetColumn.cards.push(canonicalCard);
          eventCardsByConversation.set(key, {
            card: canonicalCard,
            column: targetColumn,
            occurredAt: appointmentTimestamp(appointment),
          });
        }
      } else {
        Object.assign(matchingEvent.card, enrichCardWithAppointment(matchingEvent.card, appointmentCard));
      }
      continue;
    }

    const targetColumn = findKanbanColumn(columns, appointmentCard.targetColumnId) || findKanbanColumn(columns, 'agendamentos');
    if (targetColumn) {
      targetColumn.cards.push(appointmentCard);
    }
  }

  if (appointmentCards.some((card) => card.targetColumnId === 'agendamentos') && !kanbanConfig?.columns?.length && !findKanbanColumn(columns, 'agendamentos')) {
    columns.push({
      id: 'agendamentos',
      title: 'Agendamentos',
      automationKey: 'agendamentos',
      cards: appointmentCards.filter((card) => card.targetColumnId === 'agendamentos'),
    });
  }

  addFollowUpCards(columns, followUpJobs, latestByChat, tenantSlug);

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
    appointmentStatus: appointmentCard.appointmentStatus,
    appointmentStartsAt: appointmentCard.appointmentStartsAt,
    appointmentMetadata: appointmentCard.appointmentMetadata,
    actionType: appointmentCard.actionType || card.actionType,
    hasSchedulingLink: card.hasSchedulingLink || appointmentCard.targetColumnId === 'agendamentos',
  };
}

function mergeAppointmentCard(appointmentCard, eventCard) {
  return {
    ...appointmentCard,
    title: eventCard.title || appointmentCard.title,
    channel: eventCard.channel || appointmentCard.channel,
    channelType: eventCard.channelType || appointmentCard.channelType,
    externalConversationId: eventCard.externalConversationId || appointmentCard.externalConversationId,
    owner: eventCard.owner || appointmentCard.owner,
    ownerId: eventCard.ownerId || null,
    ownerKind: eventCard.ownerKind || null,
    contactCategory: eventCard.contactCategory || appointmentCard.contactCategory || 'customer',
    contactCategoryLabel: eventCard.contactCategoryLabel || appointmentCard.contactCategoryLabel || 'Cliente',
    schedulingLink: eventCard.schedulingLink,
    hasSchedulingLink: eventCard.hasSchedulingLink || appointmentCard.targetColumnId === 'agendamentos',
  };
}

function addFollowUpCards(columns, followUpJobs, latestByChat, tenantSlug) {
  if (tenantSlug !== 'clinica_nubia_oficial' && !isGenesisSalesTenant(tenantSlug)) return;
  const column = findKanbanColumn(columns, 'follow_ups');
  if (!column) return;

  const nextJobByConversation = new Map();
  for (const job of followUpJobs) {
    if (!['pending', 'processing'].includes(job.status)) continue;
    const key = canonicalConversationKey(job.channel_type || 'whatsapp', job.external_conversation_id, job.id);
    if (!job.external_conversation_id) continue;
    const current = nextJobByConversation.get(key);
    // A claimed job is the active execution; otherwise show the earliest pending step.
    if (!current || (job.status === 'processing' && current.status !== 'processing')
      || (job.status === current.status && Date.parse(job.due_at) < Date.parse(current.due_at))) {
      nextJobByConversation.set(key, job);
    }
  }

  for (const [key, job] of nextJobByConversation) {
    const latestEvent = latestByChat.get(key);
    const channelType = normalizeChannel(job.channel_type);
    const label = followUpLabel(job.step_key);
    column.cards.push({
      id: `follow-up-${job.id}`,
      externalConversationId: job.external_conversation_id,
      title: job.contact_name || latestEvent?.contact_name || `Contato ${channelType.label}`,
      subtitle: job.objective || 'Retomada automática programada.',
      channel: channelType.label,
      channelType: channelType.type,
      stage: `Follow-up ${label}`,
      targetColumnId: 'follow_ups',
      owner: 'Assistente IA',
      aiReason: job.status === 'processing' ? 'IA preparando o follow-up' : 'Follow-up programado',
      followUpLabel: label,
      followUpStatus: job.status,
      followUpDueAt: job.due_at,
      isFollowUp: true,
      lastAt: formatDate(job.due_at || job.created_at),
    });
  }
}

function followUpLabel(stepKey) {
  const key = String(stepKey || '').trim().toLowerCase();
  if (key === '3h') return '3h';
  if (key === '24h' || key === '1d' || key === '1dia') return '1 dia';
  if (key === '15d' || key === '15dias') return '15 dias';
  return stepKey || 'Programado';
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
  const manualTarget = canonicalKanbanKey(event?.raw_payload?.kanban_transition?.to_column);
  if (!isGenesisSalesTenant(tenantSlug)) {
    if (manualTarget) return [manualTarget];
    if (isKanbanPaymentSignal(event)) return ['verificar_sinal', 'aguardando_humano'];
    if (conversationState?.status === 'atendimento_humano') return ['com_humano', 'conversas_humanos', 'aguardando_humano'];
    return pickColumn(event?.stage, event?.handoff, event?.message_text, { ...context, event });
  }

  const persistedStage = canonicalKanbanKey(salesLead?.stage_key);
  if (persistedStage === 'sales_qualifying' && salesLead?.state?.payment_mode === 'financing' && salesLead?.state?.financing?.review_status === 'ready_for_human') {
    return ['sales_financing'];
  }
  if (GENESIS_SALES_STAGE_KEYS.has(persistedStage)) return [persistedStage];

  // Sem etapa comercial persistida, sinais operacionais e o contexto do lead são
  // apenas um fallback. Uma conversa encerrada nunca se torna venda concluída.
  if (manualTarget && GENESIS_SALES_STAGE_KEYS.has(manualTarget)) return [manualTarget];
  const eventStage = canonicalKanbanKey(event?.stage);
  if (GENESIS_SALES_STAGE_KEYS.has(eventStage)) return [eventStage];
  if (salesLead?.ai_locked || conversationState?.status === 'atendimento_humano' || isKanbanWaitingHuman(event, event?.handoff)) {
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

  const genericTarget = pickColumn(event?.stage, event?.handoff, event?.message_text, { ...context, event })[0];
  if (['com_humano', 'conversas_humanos', 'aguardando_humano'].includes(genericTarget)) return ['sales_human'];
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

function pickColumn(stage, handoff, messageText = '', context = {}) {
  const norm = normalizeStage(stage);
  const text = String(messageText || '').toLowerCase();
  const event = context.event || {};
  const manualTarget = canonicalKanbanKey(event?.raw_payload?.kanban_transition?.to_column);

  if (manualTarget) return [manualTarget];

  if (isKanbanClosed(event, norm)) {
    // Encerramento por "cliente não veio": coluna própria quando o quadro a tem; senão, Finalizadas como sempre.
    return event?.raw_payload?.close_reason === 'no_show'
      ? ['nao_compareceu', 'finalizadas', 'conversas_andamento']
      : ['finalizadas', 'conversas_andamento'];
  }
  if (isKanbanPaymentSignal(event, norm)) return ['verificar_sinal', 'aguardando_humano', 'conversas_humanos'];
  if (norm === 'Produtos apresentados') return ['produtos_apresentados', 'conversas_andamento'];
  if (norm === 'Interesse em compra') return ['interesse_compra', 'conversas_andamento'];
  if (norm === 'Aguardando finalizacao') return ['aguardando_finalizacao', 'conversas_andamento'];
  if (norm === 'Venda concluida') return ['finalizadas', 'conversas_andamento'];
  if (norm === 'Agendamento confirmado' || text.includes('confirmado') || text.includes('agendado')) return ['agendamentos'];
  if (isKanbanAssignedToHuman(event)) return ['com_humano', 'conversas_humanos'];
  if (isKanbanWaitingHuman(event, handoff, norm)) return ['aguardando_humano', 'conversas_humanos'];
  if (isKanbanAbandoned(event, context)) return ['conversas_abandonadas', 'conversas_andamento'];
  if (context.isFirstContact && context.direction !== 'outbound') return ['conversas_ia', 'novas_conversas', 'conversas_andamento'];
  return ['conversas_ia', 'conversas_andamento'];
}

function isKanbanClosed(event, normalizedStage = normalizeStage(event?.stage)) {
  return normalizedStage === 'Finalizado'
    || event?.service === 'conversation_closed'
    || event?.ai_provider === 'conversation_closed'
    || event?.delivery_status === 'closed';
}

function isKanbanAssignedToHuman(event) {
  return event?.sender_type === 'agent'
    || event?.service === 'manual_reply'
    || event?.service === 'conversation_assigned'
    || Boolean(event?.raw_payload?.assignee);
}

function isKanbanPaymentSignal(event, normalizedStage = normalizeStage(event?.stage)) {
  return normalizedStage === 'Verificar Sinal'
    || normalizedStage === 'Sinal informado'
    || event?.service === 'pagamento_sinal'
    || event?.ai_provider === 'payment_signal'
    || Boolean(event?.raw_payload?.payment_signal);
}

function isKanbanWaitingHuman(event, handoff, normalizedStage = normalizeStage(event?.stage)) {
  return Boolean(handoff)
    || normalizedStage === 'Atendimento humano'
    || event?.ai_provider === 'human_lock'
    || event?.raw_payload?.internal_actions?.ready_to_schedule
    || event?.raw_payload?.internal_actions?.complaint_handoff;
}

function isKanbanAbandoned(event, context = {}) {
  if (context.direction === 'outbound') return false;
  if (context.isFirstContact) return false;
  if (!event?.created_at) return false;
  const createdAt = Date.parse(event.created_at);
  if (!Number.isFinite(createdAt)) return false;
  const abandonedAfterHours = Number(event.raw_payload?.kanban_abandoned_after_hours || 24);
  return Date.now() - createdAt > abandonedAfterHours * 60 * 60 * 1000;
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

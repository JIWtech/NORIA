import { incidentPresentation, HUMAN_REPLY_OVERDUE_MS } from './notificationService.js';
import { appointmentRequestState } from '../../services/appointments/appointmentRequest.js';

const operatorRoles = new Set(['owner', 'admin', 'manager', 'agent', 'operator']);
export const canOperateNotifications = role => operatorRoles.has(role);

export function pendingNotifications({ tenantId, userId, role, settings, kanbanColumns, appointments, now }) {
  if (!tenantId || !userId || !canOperateNotifications(role)) return [];
  const cards = new Map(kanbanColumns.flatMap(column => column.cards || [])
    .filter(card => card.appointmentId).map(card => [card.appointmentId, card]));
  const request = settings?.appointment_request;
  const canReviewDeposit = settings && settings.payment?.enabled !== false
    && kanbanColumns.some(column => (column.automationKey || column.id) === 'verificar_sinal');

  return appointments.flatMap(appointment => {
    if (appointment.raw?.tenant_id !== tenantId) return [];
    const card = cards.get(appointment.id);
    const needsConfirmation = request?.mode === 'operator_confirmation' && appointment.status === 'pending_confirmation';
    const needsDeposit = canReviewDeposit && appointment.status === 'payment_reported';
    if (!needsConfirmation && !needsDeposit) return [];
    const createdAt = appointment.raw.updated_at || appointment.raw.created_at || appointment.startsAt;
    if (!Number.isFinite(Date.parse(createdAt))) return [];
    const requestState = needsConfirmation && appointmentRequestState({
      startsAt: appointment.startsAt,
      metadata: { request_updated_at: createdAt, ...appointment.raw.metadata },
    }, { now, staleHours: request?.stale_alert_hours });
    const overdue = Boolean(requestState && (requestState.expired || requestState.stale));
    const kind = needsConfirmation ? 'appointment-request' : 'deposit-review';
    const expectedAction = needsConfirmation ? 'confirm_request' : 'confirm_signal';
    const sending = needsConfirmation ? appointment.raw.metadata?.confirmation_state
      : appointment.raw.metadata?.signal_confirmation_state;

    return [{
      id: `pending:${kind}:${appointment.id}:${createdAt}`,
      tenantId, kind, category: 'appointments', pending: true, tracked: true, overdue, unread: true,
      appointmentId: appointment.id, cardId: card?.actionType === expectedAction ? card.id : null,
      chatId: appointment.externalConversationId, channel: appointment.channelType, createdAt,
      contact: appointment.contactName, title: needsConfirmation ? 'Pedido aguardando confirmação' : 'Sinal aguardando conferência',
      description: sending === 'uncertain' ? 'Confira a entrega da confirmação antes de tentar novamente.'
        : needsConfirmation ? [appointment.title, appointment.when].filter(Boolean).join(' · ')
          : 'Confira o comprovante antes de confirmar o sinal.',
    }];
  });
}

export function waitingConversationNotifications({ tenantId, userId, role, kanbanColumns, now }) {
  if (!tenantId || !userId || !canOperateNotifications(role)) return [];
  return kanbanColumns.flatMap(column => (column.cards || []).flatMap(card => {
      const teamReview = Boolean(card.teamReviewRequestedAt);
      if (!teamReview && (column.automationKey || column.id) !== 'aguardando_humano') return [];
      const createdAt = card.teamReviewRequestedAt || card.lastActivityAt;
      if (!card.externalConversationId || !Number.isFinite(Date.parse(createdAt))) return [];
      const identity = teamReview ? `${card.channelType || 'whatsapp'}:${card.externalConversationId}` : card.id;
      const overdue = now - Date.parse(createdAt) >= HUMAN_REPLY_OVERDUE_MS;
      return [{
        id: `pending:handoff:${identity}:${createdAt}`, tenantId, kind: teamReview ? 'team-review' : 'handoff', category: 'conversations',
        chatId: card.externalConversationId, channel: card.channelType, createdAt, contact: card.title,
        pending: true, tracked: true, overdue, unread: true,
        title: teamReview ? 'Solicitação para a equipe' : 'Cliente aguardando a equipe',
        description: teamReview ? 'A IA continua respondendo até a equipe enviar uma mensagem.' : 'Abra a conversa para dar continuidade ao atendimento.',
      }];
    }));
}

export function inboxNotification(item, replyStatus) {
  const presentation = incidentPresentation(item, replyStatus);
  return {
    id: `inbox:${item.id}`, remote: item, title: presentation.title, description: presentation.description,
    category: 'attention', kind: presentation.kind, pending: !item.resolved_at && replyStatus !== 'answered',
    overdue: Boolean(presentation.overdue), attention: presentation.attention, unread: item.unread, chatId: item.chat_id, channel: item.channel_type,
    createdAt: item.updated_at || item.created_at, resolved: Boolean(item.resolved_at) || replyStatus === 'answered',
    resolutionLabel: replyStatus === 'answered' && !item.resolved_at ? 'Respondida' : 'Resolvida',
  };
}

const STUCK_SENDING_MS = 2 * 60 * 1000;

export function canNotifyCancellation(appointment) {
  return String(appointment?.channelType || '').toLowerCase() === 'whatsapp'
    && Boolean(String(appointment?.externalConversationId || '').trim());
}

// Estado do aviso gravado no agendamento. Incerto, ou preso em envio há mais de 2 minutos, só sai pela conferência humana.
export function noticeState(metadata, now = Date.now()) {
  const state = String(metadata?.cancellation_notice_state || '');
  const startedAt = Date.parse(metadata?.cancellation_notice_at || '');
  const stuck = state === 'sending' && Number.isFinite(startedAt) && now - startedAt > STUCK_SENDING_MS;
  return { state, canReconcile: state === 'uncertain' || stuck };
}

// O servidor devolve textos de entrega incerta ou de envio já em andamento; ambos pedem conferência, não novo envio.
const UNCERTAIN_NOTICE = /entrega (?:nao comprovada|incerta)|envio em andamento/i;

function payloadFor(appointment, cancellationReason) {
  return {
    appointment_id: appointment.id,
    channel_type: appointment.channelType,
    external_conversation_id: appointment.externalConversationId,
    contact_name: appointment.contactName || 'Cliente',
    cancellation_reason: cancellationReason,
  };
}

export async function cancelAndNotify({ appointment, tenantSlug, reason, cancel, send, alreadyCancelled = false }) {
  const cancellationReason = String(reason || '').trim();
  if (!appointment?.id || !tenantSlug || !canNotifyCancellation(appointment) || !cancellationReason) {
    throw new Error('Informe o motivo do cancelamento e confira o canal vinculado antes de enviar.');
  }
  if (!alreadyCancelled) await cancel(appointment.id, cancellationReason);
  try {
    const result = await send('notify_appointment_cancellation', payloadFor(appointment, cancellationReason), tenantSlug);
    if (result?.ok === false) throw new Error(result.error || 'Falha no envio.');
    return { alreadySent: result?.already_sent === true };
  } catch (cause) {
    const uncertain = UNCERTAIN_NOTICE.test(String(cause?.message || ''));
    const error = new Error(uncertain
      ? 'Agendamento cancelado. A entrega do aviso não foi comprovada: confira a conversa no WhatsApp e informe se a mensagem chegou.'
      : 'Agendamento cancelado, mas o aviso não foi enviado. Você pode pedir o envio da IA de novo.');
    error.cancelled = true;
    error.noticeUncertain = uncertain;
    error.cause = cause;
    throw error;
  }
}

// Conferência do aviso com entrega incerta: registra o resultado sem enviar nada.
export async function reconcileNotice({ appointment, tenantSlug, reason, resolution, send }) {
  const cancellationReason = String(reason || '').trim();
  if (!appointment?.id || !tenantSlug || !canNotifyCancellation(appointment) || !cancellationReason || !['delivered', 'not_delivered'].includes(resolution)) {
    throw new Error('Não foi possível conferir o aviso: faltam dados do agendamento.');
  }
  const result = await send('notify_appointment_cancellation', { ...payloadFor(appointment, cancellationReason), notice_resolution: resolution }, tenantSlug);
  if (result?.ok === false) throw new Error(result.error || 'Não foi possível registrar a conferência.');
  return result;
}

/**
 * broadcastStateMachine.js
 *
 * Máquina de estados explícita e regras de idempotência para Broadcasts NORIA.
 * Garante que:
 * 1. Cada tentativa possui idempotency_key determinística (campaign_id + recipient_id/external_id).
 * 2. Transições de estados seguem invariantes estritas:
 *    - 'sent' é terminal e imutável.
 *    - 'unknown' exige reconciliação e NUNCA é reenviado automaticamente.
 *    - Falhas após início de envio de rede sem confirmação são classificadas como 'unknown'.
 *    - Cancelamento afeta apenas 'queued' e 'claimed'.
 */

export const RECIPIENT_STATUS = Object.freeze({
  QUEUED: 'queued',
  CLAIMED: 'claimed',
  SENDING: 'sending',
  SENT: 'sent',
  FAILED: 'failed',
  UNKNOWN: 'unknown',
  CANCELLED: 'cancelled',
  SKIPPED: 'skipped',
});

export const CAMPAIGN_STATUS = Object.freeze({
  DRAFT: 'draft',
  QUEUED: 'queued',
  SENDING: 'sending',
  PAUSED: 'paused',
  SENT: 'sent',
  PARTIAL_ERROR: 'partial_error',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});

/**
 * Gera chave de idempotência durável para a operação de envio.
 */
export function computeIdempotencyKey(campaignId, externalConversationId) {
  const cleanCampaign = String(campaignId || '').trim();
  const cleanExternal = String(externalConversationId || '').trim().replace(/@s\.whatsapp\.net$/i, '');
  if (!cleanCampaign || !cleanExternal) {
    throw new Error('campaignId e externalConversationId são obrigatórios para a chave de idempotência');
  }
  return `bcast:${cleanCampaign}:${cleanExternal}`;
}

/**
 * Validação rigorosa de transição de estado de destinatário.
 */
export function canTransitionRecipient(currentStatus, nextStatus) {
  const current = String(currentStatus || 'queued').toLowerCase();
  const next = String(nextStatus || '').toLowerCase();

  if (current === next) return true;

  // 'sent' é terminal: nada pode sobrescrever um envio já aceito
  if (current === RECIPIENT_STATUS.SENT) {
    return false;
  }

  // 'cancelled' é terminal
  if (current === RECIPIENT_STATUS.CANCELLED) {
    return false;
  }

  switch (current) {
    case RECIPIENT_STATUS.QUEUED:
      return [
        RECIPIENT_STATUS.CLAIMED,
        RECIPIENT_STATUS.CANCELLED,
        RECIPIENT_STATUS.SKIPPED,
      ].includes(next);

    case RECIPIENT_STATUS.CLAIMED:
      // Pode iniciar envio, ser cancelado ou ser devolvido para a fila se a lease expirar antes de qualquer chamada HTTP
      return [
        RECIPIENT_STATUS.SENDING,
        RECIPIENT_STATUS.QUEUED,
        RECIPIENT_STATUS.CANCELLED,
      ].includes(next);

    case RECIPIENT_STATUS.SENDING:
      // Operação iniciada: SÓ pode ir para 'sent', 'failed' (se rejeição prévia comprovada) ou 'unknown'.
      // JAMAIS pode voltar para 'queued' diretamente!
      return [
        RECIPIENT_STATUS.SENT,
        RECIPIENT_STATUS.FAILED,
        RECIPIENT_STATUS.UNKNOWN,
      ].includes(next);

    case RECIPIENT_STATUS.UNKNOWN:
      // Destinatário incerto: só pode ser resolvido por reconciliação explícita
      return [
        RECIPIENT_STATUS.SENT,
        RECIPIENT_STATUS.FAILED,
        RECIPIENT_STATUS.CANCELLED,
      ].includes(next);

    case RECIPIENT_STATUS.FAILED:
      // Falhas definitivas só podem ser reenfileiradas por ação expressa de operador
      return [
        RECIPIENT_STATUS.QUEUED,
        RECIPIENT_STATUS.CANCELLED,
      ].includes(next);

    default:
      return false;
  }
}

/**
 * Classifica o resultado de um envio.
 * Distingue falhas com garantia de não-entrega de falhas de transporte/rede onde a mensagem pode ter sido entregue.
 */
export function classifySendOutcome(error, result) {
  if (result && (result.ok === true || result.already_sent === true || result.external_message_id)) {
    return {
      status: RECIPIENT_STATUS.SENT,
      externalMessageId: result.external_message_id || null,
      alreadySent: Boolean(result.already_sent),
      error: null,
    };
  }

  if (!error) {
    return {
      status: RECIPIENT_STATUS.UNKNOWN,
      externalMessageId: null,
      error: 'Resposta nula ou incompleta do provedor de envio',
    };
  }

  const message = String(error.message || error || '').toLowerCase();

  // Erros comprovadamente prévios à entrega física (rejeição formal sem envio)
  const isDefinitivePreSendRejection =
    message.includes('telefone invalido') ||
    message.includes('destinatario invalido') ||
    message.includes('numero invalido') ||
    message.includes('sessao expirada') ||
    message.includes('usuario sem permissao') ||
    message.includes('tenant inativo') ||
    message.includes('credenciais') ||
    message.includes('nao configurado');

  if (isDefinitivePreSendRejection) {
    return {
      status: RECIPIENT_STATUS.FAILED,
      externalMessageId: null,
      error: error.message || String(error),
      uncertain: false,
    };
  }

  // Falhas de transporte de rede, timeout, perda de socket ou 5xx após disparo:
  // A Evolution API pode ter recebido a mensagem e despachado.
  // Regra de segurança: SEMPRE 'unknown' para impedir duplicação.
  return {
    status: RECIPIENT_STATUS.UNKNOWN,
    externalMessageId: null,
    error: error.message || String(error),
    uncertain: true,
  };
}

/**
 * Calcula estatísticas agregadas de uma lista de destinatários.
 */
export function calculateCampaignCounters(recipients = []) {
  let queued = 0;
  let claimed = 0;
  let sending = 0;
  let sent = 0;
  let failed = 0;
  let unknown = 0;
  let cancelled = 0;
  let skipped = 0;

  for (const r of recipients) {
    const s = String(r.status || 'queued').toLowerCase();
    if (s === RECIPIENT_STATUS.SENT) sent += 1;
    else if (s === RECIPIENT_STATUS.FAILED) failed += 1;
    else if (s === RECIPIENT_STATUS.UNKNOWN) unknown += 1;
    else if (s === RECIPIENT_STATUS.CLAIMED) claimed += 1;
    else if (s === RECIPIENT_STATUS.SENDING) sending += 1;
    else if (s === RECIPIENT_STATUS.CANCELLED) cancelled += 1;
    else if (s === RECIPIENT_STATUS.SKIPPED) skipped += 1;
    else queued += 1;
  }

  const total = recipients.length;
  const processed = sent + failed + unknown + cancelled + skipped;

  return {
    total,
    processed,
    queued,
    claimed,
    sending,
    sent,
    failed,
    unknown,
    cancelled,
    skipped,
    hasUnknown: unknown > 0,
    hasPending: queued > 0 || claimed > 0,
    isComplete: total > 0 && processed === total,
  };
}

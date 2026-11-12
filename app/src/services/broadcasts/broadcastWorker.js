/**
 * broadcastWorker.js
 *
 * Motor de execução de campanhas desacoplado do ciclo de vida da interface.
 * Opera via aquisição atômica por leases (FOR UPDATE SKIP LOCKED), garantindo que:
 * - Múltiplas abas ou múltiplos workers nunca concorram pelo mesmo destinatário.
 * - Falhas de transporte/resposta desconhecida resultem em 'unknown' (nunca reenvio cego).
 * - Desconexões ou fechamento da aba deixam a campanha em estado perfeitamente recuperável no Supabase.
 */

import {
  RECIPIENT_STATUS,
  CAMPAIGN_STATUS,
  computeIdempotencyKey,
  classifySendOutcome,
  calculateCampaignCounters,
} from './broadcastStateMachine.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateLeaseToken() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'lease-' + Math.random().toString(36).substring(2, 15) + '-' + Date.now();
}

/**
 * Executa uma campanha de forma segura, durável e atômica.
 */
export async function executeBroadcastCampaign({
  campaignId,
  tenantSlug,
  messageText,
  defaultChannel = 'whatsapp',
  sendCommand,
  operations,
  onProgress,
  abortSignal,
  batchSize = 10,
  delayMs = 1200,
}) {
  if (!campaignId || !operations || typeof sendCommand !== 'function') {
    throw new Error('Parâmetros inválidos para executeBroadcastCampaign');
  }

  const leaseToken = generateLeaseToken();

  // 1. Recupera quaisquer leases órfãs de execuções anteriores interrompidas
  try {
    await operations.recoverStaleLeases(campaignId);
  } catch (error) {
    console.warn('[BroadcastWorker] Aviso ao recuperar leases órfãs:', error);
  }

  // 2. Garante que a campanha está em status 'sending'
  await operations.updateBroadcastCampaign(campaignId, {
    status: CAMPAIGN_STATUS.SENDING,
  });

  let running = true;

  while (running) {
    if (abortSignal?.aborted) {
      break;
    }

    // 3. Adquire lote atômico via lease
    const batch = await operations.claimBroadcastBatch(campaignId, leaseToken, batchSize);

    // Se não há mais destinatários queued/claimed, a campanha terminou o processamento ativo
    if (!batch || batch.length === 0) {
      running = false;
      break;
    }

    for (let i = 0; i < batch.length; i += 1) {
      if (abortSignal?.aborted) {
        running = false;
        break;
      }

      const recipient = batch[i];
      const externalId = recipient.external_conversation_id;
      const idempotencyKey = recipient.idempotency_key || computeIdempotencyKey(campaignId, externalId);

      // Marca como 'sending' imediatamente antes da chamada externa
      await operations.markRecipientSending(recipient.id, leaseToken);

      onProgress?.({
        phase: 'sending',
        recipient,
        message: 'Aguardando próximo envio...',
      });

      let outcome;
      try {
        const result = await sendCommand(
          'broadcast_send',
          {
            channel_type: recipient.channel_type || defaultChannel,
            external_conversation_id: externalId,
            contact_name: recipient.contact_name || 'Contato',
            message_text: messageText,
            sent_by_user: 'Disparo NORIA',
            idempotency_key: idempotencyKey,
            command_id: idempotencyKey,
          },
          tenantSlug
        );
        outcome = classifySendOutcome(null, result);
      } catch (error) {
        // Classifica a falha: se for erro de rede/timeout, classifica como 'unknown' para evitar duplicatas
        outcome = classifySendOutcome(error, null);
      }

      // Registra o resultado persistido
      await operations.recordRecipientResult(recipient.id, leaseToken, {
        status: outcome.status,
        externalMessageId: outcome.externalMessageId,
        error: outcome.error,
      });

      onProgress?.({
        phase: 'item_completed',
        recipient,
        outcome,
      });

      // Cadência operacional com mensagem informativa transparente (sem alegar "anti-bloqueio")
      if (delayMs > 0 && (i < batch.length - 1 || running)) {
        onProgress?.({
          phase: 'pacing',
          message: 'Aguardando próximo envio...',
        });
        await sleep(delayMs);
      }
    }
  }

  // 4. Consolidação final do estado da campanha
  const allRecipients = await operations.getBroadcastCampaignRecipients(campaignId);
  const counters = calculateCampaignCounters(allRecipients);

  let finalCampaignStatus;
  if (abortSignal?.aborted) {
    finalCampaignStatus = CAMPAIGN_STATUS.PAUSED;
  } else if (counters.hasUnknown) {
    finalCampaignStatus = CAMPAIGN_STATUS.PARTIAL_ERROR;
  } else if (counters.failed > 0) {
    finalCampaignStatus = CAMPAIGN_STATUS.PARTIAL_ERROR;
  } else if (counters.isComplete) {
    finalCampaignStatus = CAMPAIGN_STATUS.SENT;
  } else {
    finalCampaignStatus = CAMPAIGN_STATUS.SENDING;
  }

  await operations.updateBroadcastCampaign(campaignId, {
    status: finalCampaignStatus,
    sent_count: counters.sent,
    failed_count: counters.failed,
    unknown_count: counters.unknown,
    sent_at: finalCampaignStatus === CAMPAIGN_STATUS.SENT ? new Date().toISOString() : undefined,
  });

  onProgress?.({
    phase: 'completed',
    counters,
    status: finalCampaignStatus,
  });

  return {
    campaignId,
    status: finalCampaignStatus,
    counters,
  };
}

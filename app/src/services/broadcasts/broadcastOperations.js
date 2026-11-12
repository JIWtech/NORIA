import {
  computeIdempotencyKey,
  RECIPIENT_STATUS,
  CAMPAIGN_STATUS,
  canTransitionRecipient,
} from './broadcastStateMachine.js';

export function createBroadcastOperations({ getClient, loadTenant, currentUserId }) {
  async function upsertBroadcastContacts(activeTenantSlug, contacts) {
    const supabase = getClient();
    if (!supabase) throw new Error('Supabase nao configurado');
    const tenant = await loadTenant(activeTenantSlug);
    if (!tenant) throw new Error('Tenant nao encontrado');
    const clean = contacts
      .map((contact) => ({
        tenant_id: tenant.id,
        name: contact.name || 'Contato',
        channel_type: contact.channelType || contact.channel_type || 'telegram',
        external_conversation_id: String(contact.externalConversationId || contact.external_conversation_id || '').trim(),
        phone: contact.phone || null,
        email: contact.email || null,
        source: contact.source || 'manual',
        tags: contact.tags || [],
        metadata: contact.metadata || {},
      }))
      .filter((contact) => contact.external_conversation_id);
    if (!clean.length) return [];
    const { data, error } = await supabase
      .from('broadcast_contacts')
      .upsert(clean, { onConflict: 'tenant_id,channel_type,external_conversation_id' })
      .select('*');
    if (error) throw error;
    return data || [];
  }

  async function createBroadcastCampaign(activeTenantSlug, campaign, recipients) {
    const supabase = getClient();
    if (!supabase) throw new Error('Supabase nao configurado');
    const tenant = await loadTenant(activeTenantSlug);
    if (!tenant) throw new Error('Tenant nao encontrado');
    const userId = await currentUserId();
    const { data: campaignRow, error: campaignError } = await supabase
      .from('broadcast_campaigns')
      .insert({
        tenant_id: tenant.id,
        name: campaign.name,
        channel_type: campaign.channelType || 'telegram',
        message_text: campaign.messageText || campaign.message_template || '',
        status: campaign.status || 'queued',
        total_recipients: recipients.length,
        unknown_count: 0,
        created_by: userId,
      })
      .select('*')
      .single();
    if (campaignError) throw campaignError;

    const campaignId = campaignRow.id;
    const recipientRows = recipients.map((recipient) => {
      const extId = String(recipient.external_conversation_id || recipient.externalConversationId || '').trim();
      return {
        tenant_id: tenant.id,
        campaign_id: campaignId,
        contact_id: recipient.id || null,
        channel_type: recipient.channel_type || recipient.channelType || campaign.channelType || 'telegram',
        external_conversation_id: extId,
        contact_name: recipient.name || recipient.contact_name || 'Contato',
        status: RECIPIENT_STATUS.QUEUED,
        idempotency_key: computeIdempotencyKey(campaignId, extId),
        attempt_count: 0,
      };
    }).filter((recipient) => recipient.external_conversation_id);

    if (recipientRows.length) {
      const { error: recipientsError } = await supabase
        .from('broadcast_campaign_recipients')
        .insert(recipientRows);
      if (recipientsError) throw recipientsError;
    }

    return campaignRow;
  }

  async function updateBroadcastCampaign(campaignId, patch) {
    const supabase = getClient();
    if (!supabase) throw new Error('Supabase nao configurado');
    const { data, error } = await supabase
      .from('broadcast_campaigns')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', campaignId)
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }

  async function updateBroadcastRecipient(campaignId, externalConversationId, patch) {
    const supabase = getClient();
    if (!supabase) throw new Error('Supabase nao configurado');
    let query = supabase
      .from('broadcast_campaign_recipients')
      .update(patch)
      .eq('campaign_id', campaignId)
      .eq('external_conversation_id', externalConversationId);

    // Proteção rigorosa: se o registro já estiver como 'sent', nunca rebaixar para outro status
    if (typeof query.neq === 'function' && patch?.status && patch.status !== RECIPIENT_STATUS.SENT) {
      query = query.neq('status', RECIPIENT_STATUS.SENT);
    }

    const { error } = await query;
    if (error) throw error;
  }

  async function getBroadcastCampaignRecipients(campaignId) {
    const supabase = getClient();
    if (!supabase) return [];
    const { data, error } = await supabase
      .from('broadcast_campaign_recipients')
      .select('*')
      .eq('campaign_id', campaignId);
    if (error) throw error;
    return data || [];
  }

  /**
   * Reserva atômica de lote de destinatários (Lease).
   * Tenta RPC broadcast_claim_batch com FOR UPDATE SKIP LOCKED;
   * com fallback transparente para ambientes sem a RPC migrada.
   */
  async function claimBroadcastBatch(campaignId, leaseToken, batchSize = 10, leaseSeconds = 120) {
    const supabase = getClient();
    if (!supabase) throw new Error('Supabase nao configurado');

    if (typeof supabase.rpc === 'function') {
      try {
        const { data, error } = await supabase.rpc('broadcast_claim_batch', {
          p_campaign_id: campaignId,
          p_lease_token: leaseToken,
          p_batch_size: batchSize,
          p_lease_seconds: leaseSeconds,
        });
        if (!error && Array.isArray(data)) return data;
      } catch {
        // Fallback para query manual
      }
    }

    // Fallback: busca destinatários em 'queued'
    const { data: candidates, error: selectError } = await supabase
      .from('broadcast_campaign_recipients')
      .select('*')
      .eq('campaign_id', campaignId)
      .eq('status', RECIPIENT_STATUS.QUEUED)
      .limit(batchSize);

    if (selectError || !candidates || !candidates.length) return [];

    const claimed = [];
    const lockedUntil = new Date(Date.now() + leaseSeconds * 1000).toISOString();

    for (const item of candidates) {
      const { data: updated, error: updateError } = await supabase
        .from('broadcast_campaign_recipients')
        .update({
          status: RECIPIENT_STATUS.CLAIMED,
          lease_token: leaseToken,
          locked_until: lockedUntil,
          claimed_at: new Date().toISOString(),
          attempt_count: (item.attempt_count || 0) + 1,
          last_attempt_at: new Date().toISOString(),
        })
        .eq('id', item.id)
        .eq('status', RECIPIENT_STATUS.QUEUED)
        .select('*');

      if (!updateError && updated && updated.length > 0) {
        claimed.push(updated[0]);
      }
    }

    return claimed;
  }

  /**
   * Marca o destinatário como 'sending' imediatamente antes do disparo de rede.
   */
  async function markRecipientSending(recipientId, leaseToken) {
    const supabase = getClient();
    if (!supabase) throw new Error('Supabase nao configurado');

    if (typeof supabase.rpc === 'function') {
      try {
        const { data, error } = await supabase.rpc('broadcast_mark_sending', {
          p_recipient_id: recipientId,
          p_lease_token: leaseToken,
        });
        if (!error) return Boolean(data);
      } catch {
        // Fallback
      }
    }

    let query = supabase
      .from('broadcast_campaign_recipients')
      .update({ status: RECIPIENT_STATUS.SENDING })
      .eq('id', recipientId);

    if (typeof query.eq === 'function' && leaseToken) {
      query = query.eq('lease_token', leaseToken);
    }

    const { error } = await query;
    return !error;
  }

  /**
   * Grava o resultado com proteção de imutabilidade de 'sent'.
   */
  async function recordRecipientResult(recipientId, leaseToken, { status, externalMessageId = null, error = null }) {
    const supabase = getClient();
    if (!supabase) throw new Error('Supabase nao configurado');

    if (typeof supabase.rpc === 'function') {
      try {
        const { data, error: rpcError } = await supabase.rpc('broadcast_record_result', {
          p_recipient_id: recipientId,
          p_lease_token: leaseToken,
          p_status: status,
          p_external_message_id: externalMessageId,
          p_error: error,
        });
        if (!rpcError && data?.ok) return data;
      } catch {
        // Fallback
      }
    }

    const patch = {
      status,
      external_message_id: externalMessageId,
      error,
      lease_token: null,
      locked_until: null,
    };
    if (status === RECIPIENT_STATUS.SENT) {
      patch.sent_at = new Date().toISOString();
    }

    let query = supabase
      .from('broadcast_campaign_recipients')
      .update(patch)
      .eq('id', recipientId);

    if (typeof query.neq === 'function' && status !== RECIPIENT_STATUS.SENT) {
      query = query.neq('status', RECIPIENT_STATUS.SENT);
    }

    const { data, error: updateError } = await query.select('*');
    if (updateError) throw updateError;
    return { ok: true, status, recipient: data?.[0] };
  }

  /**
   * Recupera leases expiradas com regra de segurança:
   * - 'claimed' -> 'queued'
   * - 'sending' -> 'unknown'
   */
  async function recoverStaleLeases(campaignId) {
    const supabase = getClient();
    if (!supabase) return { requeued: 0, marked_unknown: 0 };

    if (typeof supabase.rpc === 'function') {
      try {
        const { data, error } = await supabase.rpc('broadcast_recover_stale_leases', {
          p_campaign_id: campaignId,
        });
        if (!error && data) return data;
      } catch {
        // Fallback
      }
    }

    const now = new Date().toISOString();

    // 1. Destinatários claimed expirados -> voltam para queued
    let requeued = 0;
    try {
      const { data } = await supabase
        .from('broadcast_campaign_recipients')
        .update({ status: RECIPIENT_STATUS.QUEUED, lease_token: null, locked_until: null })
        .eq('campaign_id', campaignId)
        .eq('status', RECIPIENT_STATUS.CLAIMED)
        .lt('locked_until', now)
        .select('id');
      requeued = (data || []).length;
    } catch {}

    // 2. Destinatários sending expirados -> transicionam para unknown por segurança contra duplicidade
    let marked_unknown = 0;
    try {
      const { data } = await supabase
        .from('broadcast_campaign_recipients')
        .update({
          status: RECIPIENT_STATUS.UNKNOWN,
          lease_token: null,
          locked_until: null,
          error: 'Timeout de confirmacao externa: resultado incerto para prevenir duplicacao',
        })
        .eq('campaign_id', campaignId)
        .eq('status', RECIPIENT_STATUS.SENDING)
        .lt('locked_until', now)
        .select('id');
      marked_unknown = (data || []).length;
    } catch {}

    return { requeued, marked_unknown };
  }

  /**
   * Cancela com segurança: só afeta 'queued' e 'claimed'.
   */
  async function cancelBroadcastCampaign(campaignId) {
    const supabase = getClient();
    if (!supabase) throw new Error('Supabase nao configurado');

    if (typeof supabase.rpc === 'function') {
      try {
        const { data, error } = await supabase.rpc('broadcast_cancel_campaign', {
          p_campaign_id: campaignId,
        });
        if (!error && data?.ok) return data;
      } catch {
        // Fallback
      }
    }

    await supabase
      .from('broadcast_campaigns')
      .update({ status: CAMPAIGN_STATUS.CANCELLED, updated_at: new Date().toISOString() })
      .eq('id', campaignId);

    const { data } = await supabase
      .from('broadcast_campaign_recipients')
      .update({ status: RECIPIENT_STATUS.CANCELLED, lease_token: null, locked_until: null })
      .eq('campaign_id', campaignId)
      .in('status', [RECIPIENT_STATUS.QUEUED, RECIPIENT_STATUS.CLAIMED])
      .select('id');

    return { ok: true, cancelled_recipients: (data || []).length };
  }

  /**
   * Reconcilia destinatário em estado incerto ('unknown').
   */
  async function reconcileUnknownRecipient(campaignId, recipientId, targetStatus, notes = '') {
    const supabase = getClient();
    if (!supabase) throw new Error('Supabase nao configurado');

    if (![RECIPIENT_STATUS.SENT, RECIPIENT_STATUS.FAILED, RECIPIENT_STATUS.CANCELLED].includes(targetStatus)) {
      throw new Error(`Status de reconciliação inválido: ${targetStatus}`);
    }

    const patch = {
      status: targetStatus,
      error: notes ? `Reconciliado manualmente: ${notes}` : 'Reconciliado manualmente pelo operador',
      lease_token: null,
      locked_until: null,
    };
    if (targetStatus === RECIPIENT_STATUS.SENT) {
      patch.sent_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from('broadcast_campaign_recipients')
      .update(patch)
      .eq('id', recipientId)
      .eq('campaign_id', campaignId)
      .eq('status', RECIPIENT_STATUS.UNKNOWN);

    if (error) throw error;
    return { ok: true, recipientId, targetStatus };
  }

  return {
    upsertBroadcastContacts,
    createBroadcastCampaign,
    updateBroadcastCampaign,
    updateBroadcastRecipient,
    getBroadcastCampaignRecipients,
    claimBroadcastBatch,
    markRecipientSending,
    recordRecipientResult,
    recoverStaleLeases,
    cancelBroadcastCampaign,
    reconcileUnknownRecipient,
  };
}

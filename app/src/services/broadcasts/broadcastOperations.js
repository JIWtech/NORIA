/**
 * Operações de disparo do painel.
 *
 * O painel só cria a campanha (rascunho + destinatários), enfileira com consentimento e controla
 * (pausar/retomar/cancelar). O envio é feito pelo worker do servidor (n8n, "Processar Disparos"),
 * com leases atômicas e horários do banco. Nenhum horário de envio sai do relógio do navegador.
 */
import {
  computeIdempotencyKey,
  RECIPIENT_STATUS,
  CAMPAIGN_STATUS,
} from './broadcastStateMachine.js';

const CONTROL_ACTIONS = new Set(['pause', 'resume', 'cancel']);

export function createBroadcastOperations({ getClient, loadTenant, currentUserId }) {
  function client() {
    const supabase = getClient();
    if (!supabase) throw new Error('Supabase nao configurado');
    return supabase;
  }

  async function upsertBroadcastContacts(activeTenantSlug, contacts) {
    const supabase = client();
    const tenant = await loadTenant(activeTenantSlug);
    if (!tenant) throw new Error('Tenant nao encontrado');
    const clean = contacts
      .map((contact) => {
        const row = {
          tenant_id: tenant.id,
          channel_type: contact.channelType || contact.channel_type || 'telegram',
          external_conversation_id: String(contact.externalConversationId || contact.external_conversation_id || '').trim(),
        };
        for (const field of ['name', 'phone', 'email', 'source', 'tags', 'metadata']) {
          const value = contact[field];
          if (value == null || value === '' || (Array.isArray(value) && !value.length)
            || (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length)) continue;
          row[field] = value;
        }
        return row;
      })
      .filter((contact) => contact.external_conversation_id);
    if (!clean.length) return [];
    // Cada lote tem as mesmas colunas: o PostgREST atualiza apenas as colunas enviadas.
    const batches = new Map();
    for (const row of clean) {
      const key = Object.keys(row).sort().join(',');
      if (!batches.has(key)) batches.set(key, []);
      batches.get(key).push(row);
    }
    const saved = [];
    for (const rows of batches.values()) {
      const { data, error } = await supabase
        .from('broadcast_contacts')
        .upsert(rows, { onConflict: 'tenant_id,channel_type,external_conversation_id', defaultToNull: false })
        .select('*');
      if (error) throw error;
      saved.push(...(data || []));
    }
    return saved;
  }

  // Sempre cria em rascunho: o worker só enxerga a campanha depois de broadcast_enqueue_campaign.
  async function createBroadcastCampaign(activeTenantSlug, campaign, recipients) {
    const supabase = client();
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
        status: CAMPAIGN_STATUS.DRAFT,
        total_recipients: recipients.length,
        created_by: userId,
      })
      .select('*')
      .single();
    if (campaignError) throw campaignError;

    const campaignId = campaignRow.id;
    const seen = new Set();
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
        idempotency_key: extId ? computeIdempotencyKey(campaignId, extId) : null,
        attempt_count: 0,
      };
    }).filter((recipient) => {
      if (!recipient.external_conversation_id || seen.has(recipient.idempotency_key)) return false;
      seen.add(recipient.idempotency_key);
      return true;
    });

    if (recipientRows.length) {
      const { error: recipientsError } = await supabase
        .from('broadcast_campaign_recipients')
        .insert(recipientRows);
      if (recipientsError) throw recipientsError;
    }

    return campaignRow;
  }

  // Enfileira no servidor: consentimento, autor e horário registrados pelo banco.
  async function enqueueBroadcastCampaign(campaignId, { consentConfirmed = false, scheduledAt = null } = {}) {
    if (consentConfirmed !== true) throw new Error('Confirme o consentimento dos contatos antes de enviar');
    const { data, error } = await client().rpc('broadcast_enqueue_campaign', {
      p_campaign_id: campaignId,
      p_scheduled_at: scheduledAt || null,
      p_consent_confirmed: true,
    });
    if (error) throw error;
    return data;
  }

  async function controlBroadcastCampaign(campaignId, action) {
    if (!CONTROL_ACTIONS.has(action)) throw new Error('Acao de campanha invalida: ' + action);
    const { data, error } = await client().rpc('broadcast_control_campaign', {
      p_campaign_id: campaignId,
      p_action: action,
    });
    if (error) throw error;
    return data;
  }

  // Lista de bloqueio (opt-out) do tenant ativo. A RLS limita aos membros; o filtro explicita o tenant.
  async function listBroadcastOptOuts(activeTenantSlug) {
    const supabase = client();
    const tenant = await loadTenant(activeTenantSlug);
    if (!tenant) throw new Error('Tenant nao encontrado');
    const { data, error } = await supabase
      .from('broadcast_opt_outs')
      .select('channel_type, contact_key, source, reason, created_at')
      .eq('tenant_id', tenant.id);
    if (error) throw error;
    return data || [];
  }

  // Bloquear vale para qualquer operador; desbloquear, só gestores (validado no servidor).
  async function setBroadcastOptOut(activeTenantSlug, contact, optedOut, reason = null) {
    const supabase = client();
    const tenant = await loadTenant(activeTenantSlug);
    if (!tenant) throw new Error('Tenant nao encontrado');
    const { data, error } = await supabase.rpc('broadcast_set_opt_out', {
      p_tenant_id: tenant.id,
      p_channel: contact?.channelType || contact?.channel_type || 'whatsapp',
      p_external: String(contact?.externalConversationId || contact?.external_conversation_id || '').trim(),
      p_opted_out: optedOut === true,
      p_reason: reason || null,
    });
    if (error) throw error;
    return data;
  }

  async function updateBroadcastCampaign(campaignId, patch) {
    const { data, error } = await client()
      .from('broadcast_campaigns')
      .update(patch)
      .eq('id', campaignId)
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }

  async function updateBroadcastRecipient(campaignId, externalConversationId, patch) {
    let query = client()
      .from('broadcast_campaign_recipients')
      .update(patch)
      .eq('campaign_id', campaignId)
      .eq('external_conversation_id', externalConversationId);

    // 'sent' é terminal: nunca rebaixar um envio confirmado.
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
   * Reconcilia destinatário em estado incerto ('unknown') por decisão do operador.
   */
  async function reconcileUnknownRecipient(campaignId, recipientId, targetStatus, notes = '') {
    if (![RECIPIENT_STATUS.SENT, RECIPIENT_STATUS.FAILED, RECIPIENT_STATUS.CANCELLED].includes(targetStatus)) {
      throw new Error(`Status de reconciliação inválido: ${targetStatus}`);
    }

    const { error } = await client()
      .from('broadcast_campaign_recipients')
      .update({
        status: targetStatus,
        error: notes ? `Reconciliado manualmente: ${notes}` : 'Reconciliado manualmente pelo operador',
        lease_token: null,
        locked_until: null,
      })
      .eq('id', recipientId)
      .eq('campaign_id', campaignId)
      .eq('status', RECIPIENT_STATUS.UNKNOWN);

    if (error) throw error;
    return { ok: true, recipientId, targetStatus };
  }

  return {
    upsertBroadcastContacts,
    createBroadcastCampaign,
    enqueueBroadcastCampaign,
    controlBroadcastCampaign,
    listBroadcastOptOuts,
    setBroadcastOptOut,
    updateBroadcastCampaign,
    updateBroadcastRecipient,
    getBroadcastCampaignRecipients,
    reconcileUnknownRecipient,
  };
}

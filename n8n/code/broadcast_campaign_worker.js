async function main(helpers) {
  const input = $json || {};
  if (input.command !== 'broadcast_campaign' || !input.campaign_id) {
    return { ok: true, skipped: true, reason: 'not_a_broadcast_campaign' };
  }

  function env(name, fallback = '') {
    let envValue = '';
    let varsValue = '';
    try { envValue = $env[name] || ''; } catch (error) {}
    try { varsValue = $vars?.[name] || ''; } catch (error) {}
    return envValue || varsValue || fallback;
  }

  function envSuffix(value) {
    return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '_');
  }

  function config() {
    const base = env('SUPABASE_URL').replace(/\/$/, '');
    const key = env('SUPABASE_SERVICE_ROLE_KEY');
    if (!base || !key) throw new Error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY nao configuradas');
    return { base, key };
  }

  function headers(prefer) {
    const { key } = config();
    return { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}) };
  }

  async function request(method, url, payload = null, prefer = '') {
    return helpers.httpRequest({ method, url, headers: headers(prefer),
      ...(payload === null ? {} : { body: payload }), json: true, timeout: 45000 });
  }

  function tokenFor(slug, channel) {
    const suffix = envSuffix(slug);
    if (channel === 'telegram') return env('TELEGRAM_BOT_TOKEN_' + suffix);
    if (channel === 'instagram' || channel === 'instagram_direct') return env('INSTAGRAM_PAGE_ACCESS_TOKEN_' + suffix);
    return '';
  }

  async function send(channel, slug, recipient, text) {
    if (channel === 'telegram') {
      const result = await request('POST', 'https://api.telegram.org/bot' + tokenFor(slug, channel) + '/sendMessage',
        { chat_id: recipient, text, disable_web_page_preview: true });
      if (!result || result.ok === false || !result.result?.message_id) throw new Error(result?.description || 'Telegram nao confirmou o envio');
      return String(result.result.message_id);
    }
    if (channel === 'whatsapp') {
      const suffix = envSuffix(slug);
      const base = env('EVOLUTION_API_URL_' + suffix).replace(/\/$/, '');
      const key = env('EVOLUTION_API_KEY_' + suffix);
      const instance = env('EVOLUTION_INSTANCE_' + suffix);
      if (!base || !key || !instance) throw new Error('Credenciais Evolution nao configuradas para o tenant');
      const result = await helpers.httpRequest({ method: 'POST', url: base + '/message/sendText/' + encodeURIComponent(instance),
        headers: { apikey: key, 'Content-Type': 'application/json' },
        body: { number: String(recipient).replace(/@s\.whatsapp\.net$/, ''), text }, json: true, timeout: 45000 });
      const messageId = result?.key?.id || result?.message?.key?.id || result?.id;
      if (!messageId || result?.error) throw new Error(result?.message || result?.error || 'Evolution nao confirmou o envio');
      return String(messageId);
    }
    if (channel === 'instagram' || channel === 'instagram_direct') {
      const token = tokenFor(slug, channel);
      if (!token) throw new Error('Token do Instagram nao configurado para o tenant');
      const result = await helpers.httpRequest({ method: 'POST',
        url: 'https://graph.facebook.com/v18.0/me/messages',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: { recipient: { id: recipient }, message: { text } }, json: true, timeout: 45000 });
      if (!result || result.error || !result.message_id) throw new Error(result?.error?.message || 'Instagram nao confirmou o envio');
      return String(result.message_id);
    }
    throw new Error('Canal nao suportado: ' + channel);
  }

  const { base } = config();
  const slug = String(input.tenant_slug || '').toLowerCase();
  const tenantId = String(input.tenant_id || '');
  const campaignId = String(input.campaign_id);
  if (!slug || !tenantId) throw new Error('Tenant ausente na execucao da campanha');
  const campaignPath = base + '/rest/v1/broadcast_campaigns?tenant_id=eq.' + encodeURIComponent(tenantId)
    + '&id=eq.' + encodeURIComponent(campaignId);
  const rows = await request('GET', campaignPath + '&select=*');
  const campaign = Array.isArray(rows) ? rows[0] : null;
  if (!campaign || campaign.status !== 'sending' || !campaign.consent_confirmed_at) {
    throw new Error('Campanha nao esta liberada para processamento');
  }

  const recipientsUrl = base + '/rest/v1/broadcast_campaign_recipients?tenant_id=eq.' + encodeURIComponent(tenantId)
    + '&campaign_id=eq.' + encodeURIComponent(campaignId) + '&status=eq.queued&select=*'
    + '&order=created_at.asc&limit=500';
  const recipients = await request('GET', recipientsUrl);
  let sentCount = Number(campaign.sent_count || 0);
  let failedCount = Number(campaign.failed_count || 0);
  const intervalMs = Math.max(2000, Math.min(Number(campaign.send_interval_seconds || 3), 10) * 1000);

  for (let index = 0; index < recipients.length; index += 1) {
    const recipient = recipients[index];
    if (index > 0) await new Promise(resolve => setTimeout(resolve, intervalMs));
    const recipientPath = base + '/rest/v1/broadcast_campaign_recipients?tenant_id=eq.' + encodeURIComponent(tenantId)
      + '&campaign_id=eq.' + encodeURIComponent(campaignId) + '&id=eq.' + encodeURIComponent(recipient.id)
      + '&status=eq.queued';
    const claimed = await request('PATCH', recipientPath, { status: 'sending', error: null }, 'return=representation');
    if (!Array.isArray(claimed) || claimed.length !== 1) continue;

    const channel = String(recipient.channel_type || campaign.channel_type || '').toLowerCase();
    const normalizedChannel = channel === 'instagram_direct' ? 'instagram' : channel;
    const contactName = String(recipient.contact_name || 'Contato').trim() || 'Contato';
    const messageText = String(campaign.message_text || '').replace(/\{\{\s*nome\s*\}\}/gi, contactName).trim();
    const commandId = slug + ':broadcast:' + campaignId + ':' + recipient.id;
    try {
      if (!messageText) throw new Error('Mensagem da campanha vazia');
      const messageId = await send(channel, slug, recipient.external_conversation_id, messageText);
      await request('PATCH', recipientPath.replace('&status=eq.queued', '&status=eq.sending'), {
        status: 'sent', sent_at: new Date().toISOString(), external_message_id: messageId, error: null,
      });
      sentCount += 1;
      await request('POST', base + '/rest/v1/channel_events', {
        tenant_id: tenantId, tenant_slug: slug, channel_type: normalizedChannel,
        external_conversation_id: recipient.external_conversation_id, external_message_id: messageId,
        direction: 'outbound', sender_type: 'agent', contact_name: contactName, message_text: messageText,
        service: 'broadcast', stage: 'Disparo', handoff: false, response_text: null,
        ai_provider: 'broadcast_campaign', sent_by_user: input.sent_by_user || 'NORIA', delivery_status: 'sent',
        command_id: commandId, raw_payload: { campaign_id: campaignId, campaign_name: campaign.name,
          recipient_id: recipient.id, consent_confirmed_at: campaign.consent_confirmed_at },
      }, 'return=minimal').catch(() => {});
    } catch (error) {
      failedCount += 1;
      await request('PATCH', recipientPath.replace('&status=eq.queued', '&status=eq.sending'), {
        status: 'failed', error: String(error.message || error).slice(0, 300),
      }).catch(() => {});
    }

    await request('PATCH', campaignPath + '&status=eq.sending', {
      sent_count: sentCount, failed_count: failedCount, updated_at: new Date().toISOString(),
    });
  }

  const queued = await request('GET', base + '/rest/v1/broadcast_campaign_recipients?tenant_id=eq.'
    + encodeURIComponent(tenantId) + '&campaign_id=eq.' + encodeURIComponent(campaignId)
    + '&status=eq.queued&select=id&limit=1');
  if (Array.isArray(queued) && queued.length) {
    return { ok: true, campaign_id: campaignId, status: 'sending', sent_count: sentCount,
      failed_count: failedCount, remaining: true };
  }

  const finalStatus = failedCount ? (sentCount ? 'partial_error' : 'failed') : 'sent';
  await request('PATCH', campaignPath + '&status=eq.sending', {
    status: finalStatus, sent_count: sentCount, failed_count: failedCount,
    sent_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });
  return { ok: true, campaign_id: campaignId, status: finalStatus, sent_count: sentCount, failed_count: failedCount };
}

try {
  return { json: await main(this.helpers) };
} catch (error) {
  try {
    const input = $json || {};
    let supabaseUrl = '';
    let serviceKey = '';
    try { supabaseUrl = $env.SUPABASE_URL || ''; } catch (ignored) {}
    try { supabaseUrl = supabaseUrl || $vars?.SUPABASE_URL || ''; } catch (ignored) {}
    try { serviceKey = $env.SUPABASE_SERVICE_ROLE_KEY || ''; } catch (ignored) {}
    try { serviceKey = serviceKey || $vars?.SUPABASE_SERVICE_ROLE_KEY || ''; } catch (ignored) {}
    const base = String(supabaseUrl).replace(/\/$/, '');
    const key = serviceKey;
    if (base && key && input.tenant_id && input.campaign_id) {
      await this.helpers.httpRequest({ method: 'PATCH',
        url: base + '/rest/v1/broadcast_campaigns?tenant_id=eq.' + encodeURIComponent(input.tenant_id)
          + '&id=eq.' + encodeURIComponent(input.campaign_id) + '&status=eq.sending',
        headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: { status: 'partial_error', last_error: String(error.message || error).slice(0, 300),
          updated_at: new Date().toISOString() }, json: true, timeout: 15000 });
    }
  } catch (ignored) {}
  return { json: { ok: false, error: String(error.message || error).slice(0, 300) } };
}

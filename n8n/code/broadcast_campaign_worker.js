// NORIA CORE | Disparos (broadcasts) executados pelo servidor.
// Roda no schedule de 1 minuto do workflow de Entrada (nó "Processar Disparos"), projetado pelo
// scripts/build_noria_workflows.cjs. O painel só cria e enfileira a campanha.
//
// Garantias:
// - Campanha reivindicada com lease no banco (broadcast_claim_due_campaigns): uma por tenant por vez.
// - Destinatário reivindicado com lease (broadcast_claim_batch) e marcado 'sending' antes da chamada externa;
//   contato na lista de bloqueio do tenant é pulado nesse mesmo passo (broadcast_begin_send).
// - Falha de transporte ou resposta sem confirmação vira 'unknown' e nunca é reenviada automaticamente.
// - Horários (início, envio, próximo envio, conclusão) vêm do relógio do banco, nunca deste processo.
// - Toda leitura de tabela filtra por tenant_id; credenciais são as do próprio tenant.
function env(name, fallback = '') {
  try { const value = $env[name]; return String(value === undefined || value === null ? fallback : value).trim(); } catch (_) { return fallback; }
}
function suffix(value) { return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '_'); }
function newLeaseToken() {
  try { if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID(); } catch (_) {}
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16));
  hex[12] = '4'; hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].map(part => part.join('')).join('-');
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));

// >>> broadcast_template (mesma regra em app/src/features/broadcasts/utils/broadcastTemplate.js)
// Renderização técnica do modelo: {nome} ou {{nome}} vira o primeiro nome do contato. Sem nome
// utilizável (vazio, telefone, JID ou o rótulo genérico), a variável sai junto com a pontuação colada.
const BROADCAST_NAME_TOKEN = /\{\{\s*nome\s*\}\}|\{\s*nome\s*\}/.source;
const BROADCAST_NAME_ANY = new RegExp('(?:' + BROADCAST_NAME_TOKEN + ')', 'giu');
const BROADCAST_NAME_SENTENCE_START = new RegExp(/(^|[.!?]\s+)/.source + '(?:' + BROADCAST_NAME_TOKEN + ')' + /\s*[,;:]?\s*(\S)/.source, 'giu');
const BROADCAST_NAME_INLINE = new RegExp(/\s*/.source + '(?:' + BROADCAST_NAME_TOKEN + ')', 'giu');
function broadcastFirstName(value) {
  const name = String(value || '').trim();
  if (!name || name.includes('@') || /^\+?[\d\s().-]+$/.test(name) || name.toLowerCase() === 'contato') return '';
  const first = name.split(/\s+/)[0];
  return first.charAt(0).toLocaleUpperCase('pt-BR') + first.slice(1);
}
function renderBroadcastMessage(template, contactName) {
  const text = String(template || '');
  const name = broadcastFirstName(contactName);
  if (name) return text.replace(BROADCAST_NAME_ANY, name).trim();
  return text
    .replace(BROADCAST_NAME_SENTENCE_START, (_, start, next) => start + next.toLocaleUpperCase('pt-BR'))
    .replace(BROADCAST_NAME_INLINE, '')
    .trim();
}
// <<< broadcast_template

const supabaseUrl = env('SUPABASE_URL').replace(/\/$/, '');
const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
if (!supabaseUrl || !serviceKey) throw new Error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausente');
const dbHeaders = { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Content-Type': 'application/json' };
const http = options => this.helpers.httpRequest({ json: true, timeout: 30000, ...options });
const rpc = (name, body) => http({ method: 'POST', url: supabaseUrl + '/rest/v1/rpc/' + name, headers: dbHeaders, body });
const get = path => http({ method: 'GET', url: supabaseUrl + '/rest/v1/' + path, headers: dbHeaders });
const post = (path, body) => http({ method: 'POST', url: supabaseUrl + '/rest/v1/' + path, headers: { ...dbHeaders, Prefer: 'return=minimal' }, body });
const q = value => encodeURIComponent(String(value));

// Orçamento de uma execução: o schedule roda a cada minuto; a lease cobre execuções mais longas.
const budgetMs = Math.max(0, Number(env('BROADCAST_WORKER_BUDGET_SECONDS', '45')) || 0) * 1000;
const runStartedMs = Date.now();
const elapsedMs = () => Date.now() - runStartedMs;

// Cadência do tenant (broadcast_protection_settings): intervalo aleatório entre o mínimo e o máximo.
function pacingDelaySeconds(protection) {
  const min = Number(protection.min_interval_seconds);
  const max = Math.max(min, Number(protection.max_interval_seconds));
  return min + Math.random() * (max - min);
}

// Credenciais do canal do próprio tenant. Sem credencial válida a campanha pausa, sem tentar enviar.
async function resolveSender(campaign) {
  const channel = String(campaign.channel_type || '').toLowerCase();
  const tenantSuffix = suffix(campaign.tenant_slug);
  if (channel === 'whatsapp') {
    const base = env('EVOLUTION_API_URL_' + tenantSuffix).replace(/\/$/, '');
    const key = env('EVOLUTION_API_KEY_' + tenantSuffix);
    const instance = env('EVOLUTION_INSTANCE_' + tenantSuffix);
    const rows = await get('channels?select=external_id&tenant_id=eq.' + q(campaign.tenant_id) + '&type=eq.whatsapp&status=eq.active&limit=1');
    if (!base || !key || !instance || rows?.[0]?.external_id !== instance) return { error: 'whatsapp_credentials_missing' };
    return {
      channel,
      request: (recipient, text) => ({ method: 'POST', url: base + '/message/sendText/' + encodeURIComponent(instance),
        headers: { apikey: key, 'Content-Type': 'application/json' },
        body: { number: String(recipient).replace(/@s\.whatsapp\.net$/, ''), text } }),
      messageId: body => body?.key?.id || body?.message?.key?.id || body?.id || null,
    };
  }
  if (channel === 'telegram') {
    const token = env('TELEGRAM_BOT_TOKEN_' + tenantSuffix);
    if (!token) return { error: 'telegram_credentials_missing' };
    return {
      channel,
      request: (recipient, text) => ({ method: 'POST', url: 'https://api.telegram.org/bot' + token + '/sendMessage',
        headers: { 'Content-Type': 'application/json' }, body: { chat_id: recipient, text, disable_web_page_preview: true } }),
      messageId: body => (body?.ok === true && body?.result?.message_id ? body.result.message_id : null),
    };
  }
  if (channel === 'instagram' || channel === 'instagram_direct') {
    const token = env('INSTAGRAM_PAGE_ACCESS_TOKEN_' + tenantSuffix);
    if (!token) return { error: 'instagram_credentials_missing' };
    return {
      channel: 'instagram',
      request: (recipient, text) => ({ method: 'POST', url: 'https://graph.facebook.com/v18.0/me/messages',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: { recipient: { id: recipient }, message: { text } } }),
      messageId: body => body?.message_id || null,
    };
  }
  return { error: 'channel_not_supported' };
}

// Classificação estruturada pela resposta HTTP e pelo formato do corpo, nunca pelo texto do erro:
// - 2xx com id = enviado; 2xx sem id = incerto.
// - 401/403/404/429: o provedor recusou antes da entrega por motivo do canal (credencial, instância,
//   limite): o destinatário volta para a fila e a campanha pausa ('requeue').
// - Outros 4xx: recusa do destinatário (ex.: número sem WhatsApp) = falha definitiva.
// - 5xx, sem status ou falha de transporte: a mensagem pode ter saído = incerto, nunca reenviado.
const CHANNEL_REJECTION_STATUS = new Set([401, 403, 404, 429]);
function numberNotOnWhatsApp(body) {
  const entries = body?.response?.message;
  return Array.isArray(entries) && entries.some(entry => entry && typeof entry === 'object' && entry.exists === false);
}
function classifyDelivery({ statusCode, body, transportError }, sender) {
  if (transportError) return { status: 'unknown', reason: 'transport_' + String(transportError.code || 'error').toLowerCase() };
  const code = Number(statusCode) || 0;
  if (code >= 200 && code < 300) {
    const id = sender.messageId(body);
    return id ? { status: 'sent', messageId: String(id) } : { status: 'unknown', reason: 'no_message_id' };
  }
  if (CHANNEL_REJECTION_STATUS.has(code)) return { status: 'requeue', reason: 'provider_rejected_http_' + code };
  if (code >= 400 && code < 500) {
    return { status: 'failed', reason: sender.channel === 'whatsapp' && numberNotOnWhatsApp(body) ? 'number_not_on_whatsapp' : 'http_' + code };
  }
  return { status: 'unknown', reason: 'http_' + (code || 'none') };
}

async function deliver(sender, recipient, text) {
  try {
    const response = await http({ ...sender.request(recipient.external_conversation_id, text),
      returnFullResponse: true, ignoreHttpStatusErrors: true });
    return classifyDelivery({ statusCode: response?.statusCode, body: response?.body }, sender);
  } catch (error) {
    return classifyDelivery({ transportError: error }, sender);
  }
}

async function processCampaign(campaign, leaseToken) {
  const report = { campaign_id: campaign.id, tenant_slug: campaign.tenant_slug, sent: 0, failed: 0, unknown: 0, requeue: 0 };
  let pauseReason = null;
  try {
    await rpc('broadcast_recover_stale_leases', { p_campaign_id: campaign.id });
    const sender = await resolveSender(campaign);
    if (sender.error) { pauseReason = sender.error; return report; }
    const text = String(campaign.message_text || '').trim();
    if (!text) { pauseReason = 'empty_message'; return report; }
    const protection = await rpc('broadcast_protection_settings', { p_tenant_id: campaign.tenant_id });
    if (!protection || !Number(protection.min_interval_seconds)) throw new Error('Configuracao de protecao indisponivel');

    while (true) {
      const quota = await rpc('broadcast_daily_quota', { p_campaign_id: campaign.id, p_lease_token: leaseToken });
      if (!quota?.ok) break;
      if (Number(quota.remaining) <= 0) { report.daily_limit_reached = true; break; }
      const batch = await rpc('broadcast_claim_batch', { p_campaign_id: campaign.id, p_lease_token: leaseToken, p_batch_size: 1, p_lease_seconds: 120 });
      const recipient = Array.isArray(batch) ? batch[0] : null;
      if (!recipient || recipient.tenant_id !== campaign.tenant_id) break;
      // Contato bloqueado (opt-out) é pulado no mesmo passo que abre o envio.
      const begin = await rpc('broadcast_begin_send', { p_recipient_id: recipient.id, p_lease_token: leaseToken });
      if (begin === 'skipped_opt_out') { report.skipped_opt_out = (report.skipped_opt_out || 0) + 1; continue; }
      if (begin !== 'sending') break;

      const message = renderBroadcastMessage(text, recipient.contact_name);
      const outcome = message ? await deliver(sender, recipient, message) : { status: 'failed', reason: 'empty_rendered_message' };
      report[outcome.status] += 1;
      if (outcome.status === 'requeue') {
        await rpc('broadcast_requeue_recipient', { p_recipient_id: recipient.id, p_lease_token: leaseToken, p_reason: outcome.reason });
        pauseReason = outcome.reason;
        break;
      }
      await rpc('broadcast_record_result', { p_recipient_id: recipient.id, p_lease_token: leaseToken, p_status: outcome.status,
        p_external_message_id: outcome.messageId || null, p_error: outcome.reason || null });
      if (outcome.status === 'sent') {
        await post('channel_events', {
          tenant_id: campaign.tenant_id, tenant_slug: campaign.tenant_slug, channel_type: sender.channel,
          external_conversation_id: recipient.external_conversation_id, external_message_id: outcome.messageId,
          direction: 'outbound', sender_type: 'agent', contact_name: recipient.contact_name || 'Contato', message_text: message,
          service: 'broadcast', stage: 'Disparo', handoff: false, ai_provider: 'broadcast_campaign', sent_by_user: 'Disparo NORIA',
          delivery_status: 'sent', command_id: recipient.idempotency_key || ('bcast:' + campaign.id + ':' + recipient.id),
          raw_payload: { campaign_id: campaign.id, campaign_name: campaign.name, recipient_id: recipient.id },
        }).catch(() => {});
      } else {
        const failures = await rpc('broadcast_consecutive_failures', { p_tenant_id: campaign.tenant_id });
        if (Number(failures) >= Number(protection.max_consecutive_failures)) { pauseReason = 'consecutive_failures'; break; }
      }

      const schedule = await rpc('broadcast_schedule_next', { p_campaign_id: campaign.id, p_lease_token: leaseToken,
        p_delay_seconds: pacingDelaySeconds(protection) });
      if (!schedule?.ok) break;
      const waitMs = new Date(schedule.next_send_at).getTime() - new Date(schedule.db_now).getTime();
      if (elapsedMs() + waitMs > budgetMs) break;
      await sleep(waitMs);
    }
    return report;
  } catch (error) {
    report.error = String(error?.message || error).slice(0, 300);
    return report;
  } finally {
    const released = await rpc('broadcast_release_campaign', { p_campaign_id: campaign.id, p_lease_token: leaseToken,
      p_pause_reason: pauseReason }).catch(error => ({ ok: false, reason: String(error?.message || error).slice(0, 200) }));
    report.status = released?.status || null;
    if (pauseReason) report.paused = pauseReason;
  }
}

const leaseToken = newLeaseToken();
let campaigns;
try {
  campaigns = await rpc('broadcast_claim_due_campaigns', { p_lease_token: leaseToken, p_limit: 5, p_lease_seconds: 120 });
} catch (error) {
  // Não derruba a execução do schedule (que também processa follow-ups); o próximo minuto tenta de novo.
  return [{ json: { ok: false, stage: 'claim_due_campaigns', error: String(error?.message || error).slice(0, 300) } }];
}
const outcome = [];
for (const campaign of Array.isArray(campaigns) ? campaigns : []) outcome.push(await processCampaign(campaign, leaseToken));
return outcome.map(item => ({ json: item }));

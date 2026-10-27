// Runs from the shared schedule workflow. All writes are fenced by the lease
// returned by magia_claim_followup_jobs, so concurrent n8n executions cannot send twice.
function env(name, fallback = '') {
  try { return String($env[name] || fallback).trim(); } catch (_) { return fallback; }
}
function suffix(value) { return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '_'); }
function trimText(value, limit = 900) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit); }
// The generator may decline (action skip): an empty reply is never sent. The old shape ({reply}) still sends.
function parseReply(value) {
  const text = String(value || '').trim();
  try {
    const parsed = JSON.parse(text);
    if (parsed.action === 'skip') return '';
    return trimText(parsed.reply || parsed.text || '');
  } catch (_) {
    const match = text.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/s);
    return trimText(match ? JSON.parse('"' + match[1] + '"') : text.replace(/^```(?:json)?|```$/g, ''));
  }
}
async function request(method, url, headers = {}, body = undefined) {
  return this.helpers.httpRequest({ method, url, headers, ...(body === undefined ? {} : { body }), json: true, timeout: 30000 });
}

const supabaseUrl = env('SUPABASE_URL').replace(/\/$/, '');
const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
if (!supabaseUrl || !serviceKey) throw new Error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausente');
const headers = { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Content-Type': 'application/json' };
const rpc = (name, payload) => request.call(this, 'POST', supabaseUrl + '/rest/v1/rpc/' + name, headers, payload);
const get = path => request.call(this, 'GET', supabaseUrl + '/rest/v1/' + path, headers);
const post = (path, body) => request.call(this, 'POST', supabaseUrl + '/rest/v1/' + path, { ...headers, Prefer: 'return=representation' }, body);
const patch = (path, body) => request.call(this, 'PATCH', supabaseUrl + '/rest/v1/' + path, { ...headers, Prefer: 'return=representation' }, body);

async function finish(job, status, eventId = null, error = '') {
  return rpc('magia_finish_followup_job', { p_job: job.id, p_lease: job.lease_token, p_status: status, p_event: eventId, p_error: error });
}

// No follow-up is sent inside the quiet window, in the tenant's time zone: 21:00-06:00 by default,
// settings.follow_up_quiet_hours = { start: 'HH:MM', end: 'HH:MM' } overrides it. A job claimed inside
// the window goes back to pending, due when the window ends; nothing is generated or sent.
const DEFAULT_FOLLOW_UP_QUIET_HOURS = { start: '21:00', end: '06:00' };
function clockMinutes(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || '').trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}
function localMinutes(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  return Number(parts.find(part => part.type === 'hour').value) * 60 + Number(parts.find(part => part.type === 'minute').value);
}
function quietWindowEnd(settings, now = new Date()) {
  const configured = settings.follow_up_quiet_hours;
  const custom = [clockMinutes(configured?.start), clockMinutes(configured?.end)];
  const [start, end] = custom.every(value => value !== null) ? custom
    : [clockMinutes(DEFAULT_FOLLOW_UP_QUIET_HOURS.start), clockMinutes(DEFAULT_FOLLOW_UP_QUIET_HOURS.end)];
  if (start === end) return null;
  let current;
  try { current = localMinutes(now, String(settings.timezone || '').trim() || 'America/Sao_Paulo'); }
  catch (_) { current = localMinutes(now, 'America/Sao_Paulo'); }
  const inside = start < end ? current >= start && current < end : current >= start || current < end;
  if (!inside) return null;
  const due = new Date(now.getTime() + ((end - current + 1440) % 1440) * 60000);
  due.setUTCSeconds(0, 0);
  return due;
}
async function deferForQuietHours(job, settings) {
  const due = quietWindowEnd(settings);
  if (!due) return null;
  const rows = await patch('follow_up_jobs?id=eq.' + encodeURIComponent(job.id) + '&lease_token=eq.' + encodeURIComponent(job.lease_token)
    + '&status=eq.processing', { status: 'pending', due_at: due.toISOString(), lease_token: null, locked_until: null,
      error: 'quiet_hours_deferred', updated_at: new Date().toISOString() });
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('FOLLOW_UP_QUIET_HOURS_DEFER_FAILED');
  return due;
}

async function conversationChanged(job) {
  const rows = await get('channel_events?select=direction,sender_type,handoff,service,ai_provider,created_at'
    + '&tenant_id=eq.' + encodeURIComponent(job.tenant_id)
    + '&channel_type=eq.' + encodeURIComponent(job.channel_type)
    + '&external_conversation_id=eq.' + encodeURIComponent(job.external_conversation_id)
    + '&created_at=gt.' + encodeURIComponent(job.anchor_created_at)
    + '&order=created_at.asc&limit=100');
  return Array.isArray(rows) && rows.some(row =>
    (row.direction === 'inbound' && row.sender_type === 'contact') || row.handoff === true
    || row.service === 'conversation_closed' || row.ai_provider === 'conversation_closed');
}

// The reply the job is anchored to carries the customer's validated end of conversation (CORE grounding).
async function customerEnded(job) {
  const rows = await get('channel_events?select=raw_payload&id=eq.' + encodeURIComponent(job.anchor_event_id)
    + '&tenant_id=eq.' + encodeURIComponent(job.tenant_id) + '&limit=1');
  const value = rows?.[0]?.raw_payload?.grounding?.customer_disposition?.value;
  return ['closed', 'declined', 'deferred'].includes(value) ? value : '';
}

async function hasFutureAppointment(job) {
  const inactive = '(cancelled,canceled,cancelado,cancelada,completed,done,no_show)';
  const rows = await get('appointments?select=id,status,starts_at'
    + '&tenant_id=eq.' + encodeURIComponent(job.tenant_id)
    + '&channel_type=eq.' + encodeURIComponent(job.channel_type)
    + '&external_conversation_id=eq.' + encodeURIComponent(job.external_conversation_id)
    + '&starts_at=gt.' + encodeURIComponent(new Date().toISOString())
    + '&status=not.in.' + encodeURIComponent(inactive)
    + '&limit=1');
  return Array.isArray(rows) && rows.length > 0;
}

async function protectedEligibility(job, settings) {
  if (settings.conversation_capability === 'sales_v1') {
    const result = await rpc('magia_validate_sales_followup', { p_job: job.id, p_lease: job.lease_token });
    return result?.allowed === true;
  }
  if (settings.contact_exclusion_enabled === true || settings.contact_exclusion_enabled === 'true') {
    const result = await rpc('magia_contact_exclusion_status', { p_tenant: job.tenant_id, p_chat: job.external_conversation_id });
    return result?.blocked === false;
  }
  return true;
}

function salesFollowUp(job, settings) {
  // Neutral tenant-approved messages avoid interpreting documents or inventing stock/credit facts.
  const text = settings.sales_follow_up?.messages?.[job.step_key];
  if (typeof text !== 'string' || !text.trim() || text.length > 900) throw new Error('Sales follow-up message missing');
  return { reply: text.trim(), model: null, usage: {} };
}

// Same durable reservation contract as the CORE (magia_gemini_reserve): the
// tenant's daily Gemini budget and, when configured, the shared RPM/TPM/RPD/
// concurrency controller. No Gemini HTTP call happens without a reservation.
function geminiFollowUpRateConfig() {
  const scope = env('GEMINI_RATE_SCOPE');
  const maxRpm = Number(env('GEMINI_MAX_RPM', '0')), maxTpm = Number(env('GEMINI_MAX_TPM', '0')), maxRpd = Number(env('GEMINI_MAX_RPD', '0'));
  const required = env('GEMINI_RATE_CONTROL_REQUIRED', 'false').toLowerCase() === 'true';
  const distributed = /^[a-zA-Z0-9._:-]{1,120}$/.test(scope) && [maxRpm, maxTpm, maxRpd].every(value => Number.isFinite(value) && value > 0);
  return { scope, maxRpm, maxTpm, maxRpd, required, distributed };
}
async function reserveGeminiFollowUp(job, settings, model, payload) {
  const config = geminiFollowUpRateConfig();
  // Every pre-send quota/controller refusal carries the same marker so deferred jobs are queryable
  // (follow_up_jobs.error like 'GEMINI_QUOTA_DEFERRED:%'). The job is NOT retried or resent automatically.
  if (config.required && !config.distributed) throw new Error('GEMINI_QUOTA_DEFERRED:controller_not_configured');
  const configuredLimit = Number(settings.gemini_daily_limit ?? 500);
  const dailyLimit = Number.isFinite(configuredLimit) ? Math.trunc(configuredLimit) : 500;
  const leaseId = 'followup:' + String(job.id) + ':' + Date.now() + ':' + Math.random().toString(36).slice(2, 10);
  const leaseTtlMs = Math.max(20000, Math.min(Number(env('GEMINI_LEASE_TTL_MS', '30000')) || 30000, 120000));
  const cooldownMs = Math.max(1000, Math.min(Number(env('GEMINI_CIRCUIT_COOLDOWN_MS', '30000')) || 30000, 300000));
  let estimated = 1000;
  try {
    estimated = Math.max(1, Math.ceil(JSON.stringify(payload || {}).length / 3.5)
      + Math.min(Math.max(Number(payload?.generationConfig?.maxOutputTokens || 512), 1), 8192));
  } catch (_) { }
  let result;
  try {
    result = await rpc('magia_gemini_reserve', {
    p_tenant_id: job.tenant_id, p_daily_limit: dailyLimit, p_model: model, p_lease_id: leaseId, p_estimated_tokens: estimated,
    ...(config.distributed ? {
      p_scope: config.scope, p_max_concurrent: Math.max(1, Math.min(Number(env('GEMINI_MAX_CONCURRENT_CALLS', '2')) || 2, 20)),
      p_max_rpm: config.maxRpm, p_max_tpm: config.maxTpm, p_max_rpd: config.maxRpd,
      p_lease_ttl_ms: leaseTtlMs, p_probe_cooldown_ms: cooldownMs,
    } : {}),
    });
  } catch (_) { throw new Error('GEMINI_QUOTA_DEFERRED:controller_unavailable'); }
  if (!result || result.allowed !== true) throw new Error('GEMINI_QUOTA_DEFERRED:' + String(result?.reason || 'unavailable').slice(0, 60));
  return config.distributed ? { scope: config.scope, model, lease_id: leaseId } : null;
}
async function releaseGeminiFollowUp(lease, outcome) {
  if (!lease) return;
  try {
    await rpc('magia_gemini_release', { p_scope: lease.scope, p_model: lease.model, p_lease_id: lease.lease_id, p_outcome: outcome, p_cooldown_ms: 30000 });
  } catch (_) { }
}

async function generate(job, settings, history) {
  const model = String(settings.ai_model || env('GEMINI_MODEL', 'gemini-2.5-flash')).trim();
  const apiKey = env('GEMINI_API_KEY');
  const prompt = String(settings.system_prompt || '').trim();
  if (!apiKey || !prompt || !/^gemini-[a-z0-9.-]+$/i.test(model)) throw new Error('Prompt, modelo ou GEMINI_API_KEY ausente');
  const input = {
    mode: 'follow_up', step: job.step_key, objective: job.objective, contact_name: job.contact_name || '',
    conversation: history.map(row => ({ direction: row.direction, text: row.message_text, at: row.created_at })),
    rules: [
      'Este envio e uma retomada da conversa, horas depois: nao responda a ultima mensagem como se fosse agora.',
      'Nunca escreva despedida ou agradecimento (por nada, obrigada pela preferencia, tenha um otimo dia): isso nao e retomada.',
      'Se o cliente encerrou, recusou ou disse que volta depois, ou se nao houver o que retomar, retorne action skip com reply vazio.',
      'Escreva uma unica mensagem curta, em portugues do Brasil.',
      'Respeite integralmente a personalidade, fatos e limites do system prompt.',
      'Nao invente preco, disponibilidade, desconto, endereco ou pagamento.',
      'Nao diga que o cliente sumiu e nao mencione tempo de espera.',
      'Nao envie se a conversa exigir humano, pagamento, cancelamento ou remarcacao: retorne action skip.',
      'Retorne JSON com action (send ou skip) e reply.'
    ],
  };
  const geminiPayload = {
      system_instruction: { parts: [{ text: prompt }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(input) }] }],
      generationConfig: { temperature: 0.35, maxOutputTokens: 500, responseMimeType: 'application/json',
        responseSchema: { type: 'OBJECT', properties: { action: { type: 'STRING', enum: ['send', 'skip'] }, reply: { type: 'STRING' } }, required: ['action', 'reply'] } },
  };
  const geminiLease = await reserveGeminiFollowUp(job, settings, model, geminiPayload);
  let body;
  try {
    body = await request.call(this, 'POST', 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
      { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, geminiPayload);
  } catch (error) {
    await releaseGeminiFollowUp(geminiLease, 'released');
    throw error;
  }
  await releaseGeminiFollowUp(geminiLease, 'success');
  const candidate = body?.candidates?.[0];
  if (!candidate || candidate.finishReason !== 'STOP') throw new Error('Gemini nao concluiu o follow-up');
  const text = candidate.content?.parts?.filter(part => !part.thought).map(part => part.text || '').join('') || '';
  const reply = parseReply(text);
  if (!reply) return { skip: true, model, usage: body.usageMetadata || {} };
  if (reply.length > 900 || /\[HUMANO_SOLICITADO\]|\[ACAO:/i.test(reply)) throw new Error('Resposta de follow-up invalida');
  return { reply, model, usage: body.usageMetadata || {} };
}

const jobs = await rpc('magia_claim_followup_jobs', { p_limit: 20 });
const outcome = [];
for (const job of Array.isArray(jobs) ? jobs : []) {
  let sendAttempted = false;
  try {
    const settingsRows = await get('tenant_settings?select=settings&tenant_id=eq.' + encodeURIComponent(job.tenant_id) + '&limit=1');
    const settings = settingsRows?.[0]?.settings || {};
    const sales = settings.conversation_capability === 'sales_v1';
    const quietUntil = await deferForQuietHours(job, settings);
    if (quietUntil) {
      outcome.push({ id: job.id, status: 'deferred', reason: 'quiet_hours', due_at: quietUntil.toISOString() });
      continue;
    }
    if (!await protectedEligibility(job, settings)) {
      await finish(job, 'cancelled', null, 'contact_or_sales_blocked');
      outcome.push({ id: job.id, status: 'cancelled', reason: 'contact_or_sales_blocked' });
      continue;
    }
    if (await conversationChanged(job)) {
      await finish(job, 'cancelled', null, 'conversation_control_changed');
      outcome.push({ id: job.id, status: 'cancelled' });
      continue;
    }
    const ended = await customerEnded(job);
    if (ended) {
      await finish(job, 'cancelled', null, 'customer_' + ended);
      outcome.push({ id: job.id, status: 'cancelled', reason: 'customer_' + ended });
      continue;
    }
    if (!sales && await hasFutureAppointment(job)) {
      await finish(job, 'cancelled', null, 'appointment_exists');
      outcome.push({ id: job.id, status: 'cancelled', reason: 'appointment_exists' });
      continue;
    }
    const [history, channelRows] = await Promise.all([
      sales ? [] : get('channel_events?select=direction,message_text,created_at&tenant_id=eq.' + encodeURIComponent(job.tenant_id)
        + '&channel_type=eq.whatsapp&external_conversation_id=eq.' + encodeURIComponent(job.external_conversation_id)
        + '&order=created_at.desc&limit=16'),
      get('channels?select=external_id,config&tenant_id=eq.' + encodeURIComponent(job.tenant_id)
        + '&type=eq.whatsapp&status=eq.active&limit=1'),
    ]);
    const channel = channelRows?.[0];
    if (!channel?.external_id) throw new Error('Canal WhatsApp ativo nao encontrado');
    const generated = sales ? salesFollowUp(job, settings)
      : await generate.call(this, job, settings, Array.isArray(history) ? history.reverse() : []);
    if (generated.skip) {
      await finish(job, 'cancelled', null, 'follow_up_not_applicable');
      outcome.push({ id: job.id, status: 'cancelled', reason: 'follow_up_not_applicable' });
      continue;
    }
    if (await conversationChanged(job)) {
      await finish(job, 'cancelled', null, 'conversation_control_changed_before_send');
      outcome.push({ id: job.id, status: 'cancelled' });
      continue;
    }
    if (!sales && await hasFutureAppointment(job)) {
      await finish(job, 'cancelled', null, 'appointment_exists_before_send');
      outcome.push({ id: job.id, status: 'cancelled', reason: 'appointment_exists' });
      continue;
    }
    const tenantSuffix = suffix(job.tenant_slug);
    const base = env('EVOLUTION_API_URL_' + tenantSuffix).replace(/\/$/, '');
    const key = env('EVOLUTION_API_KEY_' + tenantSuffix);
    const instance = env('EVOLUTION_INSTANCE_' + tenantSuffix);
    if (!base || !key || instance !== channel.external_id) throw new Error('Credenciais Evolution do tenant nao configuradas');
    if (!await protectedEligibility(job, settings)) {
      await finish(job, 'cancelled', null, 'contact_or_sales_blocked_before_send');
      outcome.push({ id: job.id, status: 'cancelled', reason: 'contact_or_sales_blocked_before_send' });
      continue;
    }
    // The window may have started while the message was being prepared.
    const quietBeforeSend = await deferForQuietHours(job, settings);
    if (quietBeforeSend) {
      outcome.push({ id: job.id, status: 'deferred', reason: 'quiet_hours', due_at: quietBeforeSend.toISOString() });
      continue;
    }
    sendAttempted = true;
    const sent = await request.call(this, 'POST', base + '/message/sendText/' + encodeURIComponent(instance),
      { apikey: key, 'Content-Type': 'application/json' }, { number: String(job.external_conversation_id).replace(/@s\.whatsapp\.net$/, ''), text: generated.reply });
    const messageId = sent?.key?.id || sent?.message?.key?.id || sent?.id;
    if (!messageId) throw new Error('Evolution nao retornou o id da mensagem');
    const saved = await post('channel_events', {
      tenant_id: job.tenant_id, tenant_slug: job.tenant_slug, channel_type: 'whatsapp', external_conversation_id: job.external_conversation_id,
      external_message_id: String(messageId), direction: 'outbound', sender_type: 'assistant', contact_name: job.contact_name || 'Contato',
      message_text: generated.reply, service: 'follow_up', stage: 'Follow-up ' + job.step_key, handoff: false,
      ai_provider: sales ? 'configured_follow_up' : 'gemini_follow_up', ai_model: generated.model, ai_usage: generated.usage, delivery_status: 'sent',
      raw_payload: { follow_up: { job_id: job.id, step_key: job.step_key, objective: job.objective, anchor_event_id: job.anchor_event_id } },
    });
    const event = Array.isArray(saved) ? saved[0] : saved;
    await finish(job, 'sent', event?.id || null);
    outcome.push({ id: job.id, status: 'sent', step: job.step_key });
  } catch (error) {
    const message = String(error?.message || error).slice(0, 500);
    // Sending can have unknown delivery after a transport failure; do not retry it blindly.
    const status = sendAttempted ? 'uncertain' : 'failed';
    await finish(job, status, null, message).catch(() => {});
    outcome.push({ id: job.id, status, error: message });
  }
}
return outcome.map(item => ({ json: item }));

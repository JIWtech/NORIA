function env(name, fallback = '') {
  try { return $env[name] || fallback; } catch { return fallback; }
}
function text(value) { return String(value || '').trim(); }
function normalizeSlug(value) { return text(value).toLowerCase().replace(/[^a-z0-9_-]/g, ''); }
function normalizeEvent(value) { return text(value).toLowerCase().replace(/_/g, '.'); }

const input = typeof $json.body === 'string' ? JSON.parse($json.body || '{}') : ($json.body || $json);
const eventRaw = text(input.event || input.type);
const event = normalizeEvent(eventRaw);
const data = input.data || input;
const key = data.key || data.message?.key || {};
const remoteJid = text(key.remoteJid || key.remoteJidAlt || data.remoteJid);
const message = data.message || {};
const messageType = text(data.messageType || Object.keys(message)[0] || 'conversation');
const fromMe = key.fromMe === true || data.fromMe === true;

// Extrai texto real descompactando containers (templateMessage, interactiveMessage, buttons, ephemeral, viewOnce)
function extractMessageContent(msg = {}, mType = '') {
  let current = msg;
  for (let depth = 0; depth < 5; depth++) {
    if (current.ephemeralMessage?.message) current = current.ephemeralMessage.message;
    else if (current.viewOnceMessage?.message) current = current.viewOnceMessage.message;
    else if (current.viewOnceMessageV2?.message) current = current.viewOnceMessageV2.message;
    else if (current.documentWithCaptionMessage?.message) current = current.documentWithCaptionMessage.message;
    else break;
  }

  // 1. Texto direto ou legendas
  const direct = text(
    current.conversation ||
    current.extendedTextMessage?.text ||
    current.imageMessage?.caption ||
    current.videoMessage?.caption ||
    current.documentMessage?.caption
  );
  if (direct) return { text: direct, type: 'text' };

  // 2. Template Message (Meta HSM / Evolution Template)
  const tm = current.templateMessage || current.hydratedTemplate || current.fourRowTemplate || current.hydratedFourRowTemplate;
  if (tm) {
    const hydrated = tm.hydratedTemplate || tm;
    const bodyText = text(
      hydrated.hydratedContentText ||
      hydrated.contentText ||
      tm.hydratedContentText ||
      tm.contentText
    );
    const titleText = text(
      hydrated.hydratedTitleText ||
      hydrated.titleText ||
      tm.hydratedTitleText ||
      tm.titleText
    );
    const footerText = text(
      hydrated.hydratedFooterText ||
      hydrated.footerText ||
      tm.hydratedFooterText
    );
    const buttons = [];
    const rawButtons = hydrated.templateButtons || hydrated.buttons || tm.buttons || [];
    for (const btn of rawButtons) {
      const btnText = text(
        btn.quickReplyButton?.displayText ||
        btn.urlButton?.displayText ||
        btn.callButton?.displayText ||
        btn.displayText ||
        btn.title
      );
      if (btnText) buttons.push('[' + btnText + ']');
    }
    const parts = [titleText, bodyText, footerText].filter(Boolean);
    if (buttons.length) parts.push(buttons.join(' '));
    const full = parts.join('\n').trim();
    if (full) return { text: full, type: 'template' };
  }

  // 3. Mensagens Interativas (botoes, lista, card)
  const im = current.interactiveMessage || current.interactiveResponseMessage;
  if (im) {
    const header = text(im.header?.title || im.header?.text);
    const body = text(im.body?.text);
    const footer = text(im.footer?.text);
    const parts = [header, body, footer].filter(Boolean);
    const full = parts.join('\n').trim();
    if (full) return { text: full, type: 'interactive' };
  }

  // 4. Resposta de fluxo nativo (listas, formulários e botões modernos do
  // WhatsApp). Evolution expõe a seleção em paramsJson; manter o identificador
  // quando não houver rótulo é preferível ao placeholder [nativeflowresponse].
  const nativeFlow = current.nativeFlowResponseMessage || current.interactiveResponseMessage?.nativeFlowResponseMessage;
  if (nativeFlow) {
    let params = {};
    const rawParams = text(nativeFlow.paramsJson || nativeFlow.params_json || nativeFlow.params);
    if (rawParams) {
      try { params = JSON.parse(rawParams); } catch {}
    }
    const selected = text(
      params.display_text || params.displayText || params.title || params.name ||
      params.description || params.id || params.selection || params.selectedId ||
      nativeFlow.name || nativeFlow.id
    );
    if (selected) return { text: selected, type: 'native_flow_response' };
  }

  // 5. Respostas de botão
  const buttonReply = current.templateButtonReplyMessage || current.buttonsResponseMessage;
  if (buttonReply) {
    const btnText = text(buttonReply.selectedDisplayText || buttonReply.selectedButtonId || buttonReply.selectedId);
    if (btnText) return { text: btnText, type: 'button_reply' };
  }

  // 6. Respostas de lista
  const listReply = current.listResponseMessage;
  if (listReply) {
    const title = text(listReply.title || listReply.singleSelectReply?.selectedRowId);
    const desc = text(listReply.description);
    const full = [title, desc].filter(Boolean).join('\n').trim();
    if (full) return { text: full, type: 'list_reply' };
  }

  return { text: '', type: '' };
}

const extracted = extractMessageContent(message, messageType);
let messageText = extracted.text;
let contentType = extracted.type || 'text';
let base64 = text(data.base64 || message.base64 || message.audioMessage?.base64);

if (!messageText && messageType.toLowerCase().includes('audio')) {
  contentType = 'audio';
  messageText = '[audio]';
} else if (!messageText) {
  contentType = messageType.replace(/Message$/i, '').toLowerCase() || 'unknown';
  messageText = '[' + contentType + ']';
}

const phone = remoteJid.split('@')[0].split(':')[0].replace(/\D/g, '');
const instance = text(input.instance || input.instanceName || input.instanceId || data.instance || data.instanceName || data.instanceId || env('EVOLUTION_INSTANCE_JIW'));
const fallbackTenant = normalizeSlug(env('WHATSAPP_TENANT_SLUG', env('DEFAULT_TENANT_SLUG', 'jiw'))) || 'jiw';
let tenantSlug = fallbackTenant;
let tenantResolution = { tenant_slug: fallbackTenant, source: 'env_fallback' };
const supabaseUrl = text(env('SUPABASE_URL')).replace(/\/$/, '');
const serviceKey = text(env('SUPABASE_SERVICE_ROLE_KEY'));
const isEvolutionOwnerSaved = data.isMyContact === true
  || data.contact?.isMyContact === true
  || input.isMyContact === true;

if (!supabaseUrl || !serviceKey || !instance) throw new Error('NORIA_CHANNEL_RESOLUTION_UNAVAILABLE');
{
  let rows;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      rows = await this.helpers.httpRequest({ method: 'GET', url: `${supabaseUrl}/rest/v1/channels?select=external_id,status,config,tenants(slug,status)&type=eq.whatsapp&limit=201`, headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }, json: true, timeout: 7000 });
      break;
    } catch (error) {
      const status = Number(error?.statusCode || error?.response?.status || error?.cause?.statusCode || 0);
      const errorCode = String(error?.code || error?.cause?.code || '');
      const transient = status === 408 || status === 429 || status >= 500 && status <= 599
        || !status && (['ECONNABORTED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH', 'ECONNREFUSED'].includes(errorCode)
          || /timeout|timed out/i.test(String(error?.message || '')));
      if (attempt !== 0 || !transient) throw new Error('NORIA_CHANNEL_RESOLUTION_UNAVAILABLE');
    }
  }
  // Registro truncado não comprova ausência da instância. Falha ou ambiguidade
  // não pode chegar ao fallback de tenant nem à gravação do contato.
  if (!Array.isArray(rows) || rows.length >= 201) throw new Error('NORIA_CHANNEL_RESOLUTION_UNAVAILABLE');
  const expected = normalizeSlug(instance);
  const matches = rows.filter(channel => {
    const config = channel?.config && typeof channel.config === 'object' ? channel.config : {};
    return [channel?.external_id, config.instance_name, config.instance, config.evolution_instance, config.instance_id, config.instanceId]
      .filter(Boolean).map(normalizeSlug).includes(expected);
  });
  if (matches.length > 1) throw new Error('NORIA_CHANNEL_AMBIGUOUS');
  const match = matches[0];
  if (match) {
    if (match.status !== 'active' || match.tenants?.status !== 'active' || !normalizeSlug(match.tenants?.slug)) throw new Error('NORIA_CHANNEL_INACTIVE');
    tenantSlug = normalizeSlug(match.tenants.slug);
    tenantResolution = { tenant_slug: tenantSlug, source: 'channels.config', channel: match };
  }
}

// Per-tenant ingress forwarding credential. Other existing routes remain opt-in.
// The tenant must come from the channel registry, never a body-supplied slug.
const ingressForwardToken = text(env('NORIA_INGRESS_FORWARD_TOKEN_' + tenantSlug.toUpperCase().replace(/[^A-Z0-9]/g, '_')));
if (ingressForwardToken) {
  const authorization = text($json.headers?.authorization || $json.headers?.Authorization);
  if (tenantResolution.source !== 'channels.config' || authorization !== 'Bearer ' + ingressForwardToken) {
    throw new Error('AUTHENTICATED_INGRESS_REQUIRED');
  }
}

// Classificação de tipo de contato: comercial, salvo ou cliente
const isLandline = (phone.startsWith('55') && phone.length === 12 && ['2', '3', '4', '5'].includes(phone[4]))
  || (phone.length === 10 && ['2', '3', '4', '5'].includes(phone[2]));

const isBusinessAccount = Boolean(
  data.isBusiness ||
  data.isEnterprise ||
  data.verifiedName ||
  data.businessProfile
);

let contactCategory = 'customer';
let contactCategoryLabel = 'Cliente';

if (isLandline || isBusinessAccount) {
  contactCategory = 'commercial';
  contactCategoryLabel = 'Número comercial';
} else if (isEvolutionOwnerSaved) {
  contactCategory = 'saved';
  contactCategoryLabel = 'Contato salvo';
}

const KNOWN_TENANT_BUSINESS_PATTERNS = {
  wesley_automoveis: [
    /^(?:g[eê]nesis|wesley)\s*(?:autom[oó]veis|ve[ií]culos|multimarcas|motors|auto)\b/i,
    /^(?:g[eê]nesis\s+autom[oó]veis|wesley\s+autom[oó]veis|wesley_automoveis)$/i,
  ],
  '74b57037-9349-4a9e-889c-b65fb63c983a': [
    /^(?:g[eê]nesis|wesley)\s*(?:autom[oó]veis|ve[ií]culos|multimarcas|motors|auto)\b/i,
    /^(?:g[eê]nesis\s+autom[oó]veis|wesley\s+autom[oó]veis|wesley_automoveis)$/i,
  ],
  clinica_nubia_oficial: [
    /^(?:cl[ií]nica\s+n[uú]bia(?:\s+oficial)?|n[uú]bia\s+oficial|clinica_nubia_oficial)$/i,
  ],
  royal_4x4: [
    /^royal\s+4x4(?:\s+ve[ií]culos)?$/i,
  ],
};

const GENERIC_SYSTEM_ROLES = /^(?:atendente|operador|operadora|suporte|sac|central(?:\s+de\s+atendimento)?|sistema|administrador|admin|bot|robo|noria)$/i;

function isBusinessOrTenantName(candidate, slug = '', inst = '') {
  const trimmed = String(candidate || '').trim();
  if (!trimmed) return false;
  const norm = trimmed.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (GENERIC_SYSTEM_ROLES.test(norm)) return true;

  const slugNorm = String(slug || '').trim().toLowerCase();
  const instNorm = String(inst || '').trim().toLowerCase();

  if (slugNorm && (norm === slugNorm || norm === slugNorm.replace(/_/g, ' '))) return true;
  if (instNorm && (norm === instNorm || norm === instNorm.replace(/_/g, ' '))) return true;

  if (slugNorm) {
    const patterns = KNOWN_TENANT_BUSINESS_PATTERNS[slugNorm];
    if (patterns && patterns.some((re) => re.test(trimmed))) return true;
  }
  if (instNorm) {
    const patterns = KNOWN_TENANT_BUSINESS_PATTERNS[instNorm];
    if (patterns && patterns.some((re) => re.test(trimmed))) return true;
  }

  if (slugNorm || instNorm) {
    if (/\b(?:atendimento|assistente\s+virtual|inteligencia\s+artificial)\b/i.test(norm)) {
      return true;
    }
  }
  return false;
}

const eventSupported = !event || ['messages.upsert', 'messages.update'].includes(event);
// Reações, apagamentos/edições e votos são eventos de protocolo, não mensagens:
// não abrem turno da IA nem contam como resposta manual do atendente.
const nonConversational = ['reactionMessage', 'protocolMessage', 'pollUpdateMessage', 'senderKeyDistributionMessage', 'keepInChatMessage', 'pinInChatMessage']
  .some(type => messageType === type || (Object.keys(message).length > 0 && Object.keys(message).every(key => key === type || key === 'messageContextInfo')));
const ignoredReason = !eventSupported ? 'event_not_supported' : !remoteJid ? 'missing_remote_jid' : nonConversational ? 'non_conversational_message' : remoteJid.includes('@g.us') || remoteJid === 'status@broadcast' ? 'group_or_status' : !phone ? 'missing_phone' : '';
const candidatePush = fromMe ? '' : text(data.pushName || data.senderName);
const safeContactName = (!fromMe && candidatePush && !isBusinessOrTenantName(candidatePush, tenantSlug, instance))
  ? candidatePush
  : (fromMe ? '' : phone);

return { json: {
  shouldProcess: !ignoredReason, ignoredReason, event, eventRaw, tenant_slug: tenantSlug, tenant_resolution: tenantResolution,
  instance, remoteJid, phone, messageId: text(key.id || data.id || remoteJid + ':' + Date.now()),
  contactName: safeContactName, messageText, contentType, base64,
  contact_category: contactCategory, contact_category_label: contactCategoryLabel,
  isMyContact: isEvolutionOwnerSaved,
  is_manual_whatsapp_outbound: fromMe, raw_payload: input, channel_type: 'whatsapp',
} };

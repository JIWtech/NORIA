// Canonical, fail-soft identity sync for every valid inbound WhatsApp message.
// This node runs before the legacy/core branch so contact identity never depends
// on AI, human handoff, debounce, or the message content type.
function env(name, fallback = '') {
  try { return $env[name] || fallback; } catch { return fallback; }
}
function objectValue(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
}
function normalizeWhatsappHandle(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  const bare = raw.replace(/:(\d+)(?=@)/, '');
  if (/@lid$/i.test(bare)) return bare;
  const digits = bare.replace(/@(s\.whatsapp\.net|c\.us)$/i, '').replace(/\D/g, '');
  return digits.length >= 8 ? `${digits}@s.whatsapp.net` : bare;
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

function usefulName(value, phone = '', context = {}) {
  const name = String(value || '').trim();
  if (!name) return false;
  const normalized = name.toLowerCase();
  if (/^(?:unknown|undefined|null|n\/a|na)$/i.test(name)) return false;
  if (/^\+?\d+(?:@(s\.whatsapp\.net|c\.us))?$/i.test(name) || /@(s\.whatsapp\.net|c\.us|g\.us|lid|broadcast)$/i.test(name)) return false;
  if (/^[\s._\-–—]+$/u.test(name)) return false;
  const digits = name.replace(/\D/g, '');
  const phoneDigits = String(phone || '').replace(/\D/g, '');
  if ((digits.length >= 8 && digits === name.replace(/\D/g, '')) || (phoneDigits && digits === phoneDigits)) return false;
  if (isBusinessOrTenantName(name, context.tenant_slug || context.tenantSlug, context.instance)) return false;
  // Emoji-only push names are intentional WhatsApp display names. Punctuation-only
  // markers are rejected above, while names need either a letter or a pictogram.
  return /\p{L}|\p{Extended_Pictographic}/u.test(name);
}
function profilePictureFromPayload(payload) {
  const source = objectValue(payload);
  const data = objectValue(source.data);
  const contact = objectValue(source.contact || data.contact);
  const candidates = [source.profilePictureUrl, source.profilePicUrl, source.avatarUrl, source.pictureUrl,
    data.profilePictureUrl, data.profilePicUrl, data.avatarUrl, contact.profilePictureUrl, contact.profilePicUrl];
  return candidates.find((value) => /^https:\/\//i.test(String(value || '').trim())) || null;
}
function tenantEnvSuffix(value) { return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '_'); }
function avatarFresh(value, ttlMs) {
  const timestamp = Date.parse(value || '');
  return Number.isFinite(timestamp) && Date.now() - timestamp < ttlMs;
}
function noPhotoResponse(response) {
  const payload = objectValue(response);
  const status = Number(payload.status || payload.statusCode || 0);
  if ([401, 403, 404].includes(status)) return true;
  const message = String(payload.message || payload.error || payload.reason || '').toLowerCase();
  return /no[ _-]?(profile[ _-]?)?picture|not found|privacy|private|sem foto|foto privada/.test(message)
    || payload.profilePictureUrl === null || payload.profilePicUrl === null;
}

const input = $json;
const supabaseUrl = String(env('SUPABASE_URL')).replace(/\/$/, '');
const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };
const handle = normalizeWhatsappHandle(input.remoteJid);
const phone = String(input.phone || handle.split('@')[0] || '').replace(/\D/g, '');
const candidateName = String(input.contactName || '').trim();
const now = new Date().toISOString();
const photoTtlMs = 14 * 24 * 60 * 60 * 1000;
const noPhotoTtlMs = 24 * 60 * 60 * 1000;
let sync = { status: 'skipped', avatarUrl: null, source: 'unresolved' };
let isOwnerSaved = false;
let ownerSavedSource = null;

async function request(options) { return this.helpers.httpRequest({ ...options, json: true, timeout: 3500 }); }
async function syncWhatsappContact() {
  if (!supabaseUrl || !serviceKey || !input.tenant_slug || !handle) {
    sync = { status: 'skipped', avatarUrl: null, source: 'missing_identity_context' };
    return;
  }
  try {
    const tenants = await request.call(this, {
      method: 'GET', url: `${supabaseUrl}/rest/v1/tenants?select=id&slug=eq.${encodeURIComponent(input.tenant_slug)}&limit=1`, headers,
    });
    const tenantId = Array.isArray(tenants) ? tenants[0]?.id : null;
    if (!tenantId) { sync = { status: 'skipped', avatarUrl: null, source: 'tenant_not_found' }; return; }

    const filter = `&tenant_id=eq.${encodeURIComponent(tenantId)}&source_channel=eq.whatsapp&external_handle=eq.${encodeURIComponent(handle)}&deleted_at=is.null&order=created_at.asc,id.asc&limit=2`;
    let rows = await request.call(this, {
      method: 'GET', url: `${supabaseUrl}/rest/v1/contacts?select=id,name,phone,external_handle,source_channel,avatar_url,avatar_fetched_at,metadata${filter}`, headers,
    });
    let contact = Array.isArray(rows) ? rows[0] || null : null;
    const hasDuplicates = Array.isArray(rows) && rows.length > 1;
    const isOutbound = Boolean(input.is_manual_whatsapp_outbound || input.fromMe || input.direction === 'outbound');
    const candidateName = isOutbound ? '' : String(input.contactName || '').trim();
    const incomingName = usefulName(candidateName, phone, input) ? candidateName : null;

    let metadata = objectValue(contact?.metadata);
    // v2.1.3: never trust the legacy Evolution isSaved marker as an owner-saved proof.
    if (metadata.whatsapp_owner_saved_source === 'evolution_findContacts:isSaved') {
      metadata = { ...metadata };
      delete metadata.whatsapp_owner_saved;
      delete metadata.whatsapp_owner_saved_source;
      delete metadata.whatsapp_owner_saved_at;
    }
    isOwnerSaved = metadata.whatsapp_owner_saved === true;
    ownerSavedSource = metadata.whatsapp_owner_saved_source || null;

    async function checkOwnerSavedFromDb(tenantId, rawPhone) {
      const digits = String(rawPhone || '').replace(/\D/g, '');
      if (!digits || digits.length < 8) return null;
      const local = digits.replace(/^55/, '');
      const candidatePhones = [...new Set([digits, local, '55' + local].filter((p) => p.length >= 8))];
      const orFilter = candidatePhones.map((p) => `phone.eq.${p}`).join(',');
      try {
        const excluded = await request.call(this, {
          method: 'GET',
          url: `${supabaseUrl}/rest/v1/tenant_ai_excluded_contacts?select=phone,source&tenant_id=eq.${encodeURIComponent(tenantId)}&or=(${orFilter})&limit=1`,
          headers,
        });
        return Array.isArray(excluded) && excluded.length > 0 ? (excluded[0].source || 'tenant_ai_excluded_contacts') : null;
      } catch {
        return null;
      }
    }

    async function resolveOwnerSavedSource(tenantId, rawPhone) {
      // Only authoritative sources may suppress AI. Evolution findContacts/isSaved
      // means the instance knows the contact; it does NOT prove the owner saved it.
      return await checkOwnerSavedFromDb.call(this, tenantId, rawPhone);
    }

    if (!contact) {
      const excludedSource = await resolveOwnerSavedSource.call(this, tenantId, phone || handle);
      if (excludedSource) {
        isOwnerSaved = true;
        ownerSavedSource = excludedSource;
      }
      const initialMetadata = isOwnerSaved ? {
        whatsapp_owner_saved: true,
        whatsapp_owner_saved_source: ownerSavedSource,
        whatsapp_owner_saved_at: now,
      } : {};
      const created = await request.call(this, {
        method: 'POST', url: `${supabaseUrl}/rest/v1/contacts`, headers: { ...headers, Prefer: 'return=representation' },
        body: { tenant_id: tenantId, name: incomingName, phone: phone || null, external_handle: handle, source_channel: 'whatsapp', metadata: initialMetadata },
      });
      contact = Array.isArray(created) ? created[0] || null : created || null;
      // A concurrent first message may have won a database constraint race. Reuse
      // the deterministic oldest contact if it already exists; never create again.
      if (!contact) {
        rows = await request.call(this, { method: 'GET', url: `${supabaseUrl}/rest/v1/contacts?select=id,name,phone,external_handle,source_channel,avatar_url,avatar_fetched_at,metadata${filter}`, headers });
        contact = Array.isArray(rows) ? rows[0] || null : null;
      }
      if (!contact) throw new Error('contact_create_unavailable');
    } else if (!isOwnerSaved) {
      const excludedSource = await resolveOwnerSavedSource.call(this, tenantId, phone || contact.phone || handle);
      if (excludedSource) {
        isOwnerSaved = true;
        ownerSavedSource = excludedSource;
        const updatedMetadata = {
          ...metadata,
          whatsapp_owner_saved: true,
          whatsapp_owner_saved_source: ownerSavedSource,
          whatsapp_owner_saved_at: now,
        };
        await request.call(this, {
          method: 'PATCH', url: `${supabaseUrl}/rest/v1/contacts?id=eq.${encodeURIComponent(contact.id)}&tenant_id=eq.${encodeURIComponent(tenantId)}`,
          headers, body: { metadata: updatedMetadata },
        }).catch(() => {});
        contact.metadata = updatedMetadata;
      }
    }

    sync.is_owner_saved = isOwnerSaved;
    sync.owner_saved_source = ownerSavedSource;

    const currentName = String(contact.name || '').trim();
    const currentIsUseful = usefulName(currentName, contact.phone || phone, input);
    const incomingIsUseful = Boolean(incomingName);
    let chosenName = currentName;
    if (!currentIsUseful && incomingIsUseful) {
      chosenName = incomingName;
    } else if (currentIsUseful) {
      chosenName = currentName;
    } else {
      chosenName = incomingName || null;
    }
    const identityPatch = {
      phone: phone || contact.phone || null,
      external_handle: handle,
      source_channel: 'whatsapp',
      ...(chosenName && chosenName !== currentName ? { name: chosenName } : {}),
    };
    if (Object.values(identityPatch).some((value) => value !== undefined)) {
      await request.call(this, {
        method: 'PATCH', url: `${supabaseUrl}/rest/v1/contacts?id=eq.${encodeURIComponent(contact.id)}&tenant_id=eq.${encodeURIComponent(tenantId)}`,
        headers, body: identityPatch,
      }).catch(() => {});
      contact = { ...contact, ...identityPatch };
    }

    const webhookAvatar = profilePictureFromPayload(input.raw_payload);
    const cachedAvatar = profilePictureFromPayload({ profilePictureUrl: contact.avatar_url });
    if (webhookAvatar) {
      await request.call(this, {
        method: 'PATCH', url: `${supabaseUrl}/rest/v1/contacts?id=eq.${encodeURIComponent(contact.id)}&tenant_id=eq.${encodeURIComponent(tenantId)}`,
        headers, body: { avatar_url: webhookAvatar, avatar_fetched_at: now },
      }).catch(() => {});
      sync = { status: hasDuplicates ? 'updated_historical_duplicate' : 'updated', avatarUrl: webhookAvatar, source: 'webhook', contactId: contact.id, tenantId };
      return;
    }
    if (cachedAvatar && avatarFresh(contact.avatar_fetched_at, photoTtlMs)) {
      sync = { status: hasDuplicates ? 'updated_historical_duplicate' : 'updated', avatarUrl: cachedAvatar, source: 'cache', contactId: contact.id, tenantId };
      return;
    }
    metadata = objectValue(contact.metadata);
    if (!cachedAvatar && avatarFresh(metadata.whatsapp_avatar_negative_fetched_at, noPhotoTtlMs)) {
      sync = { status: hasDuplicates ? 'updated_historical_duplicate' : 'updated', avatarUrl: null, source: 'negative_cache', contactId: contact.id, tenantId };
      return;
    }
    const suffix = tenantEnvSuffix(input.tenant_slug);
    const baseUrl = String(env(`EVOLUTION_API_URL_${suffix}`)).replace(/\/$/, '');
    const apiKey = env(`EVOLUTION_API_KEY_${suffix}`);
    const instance = String(input.instance || env(`EVOLUTION_INSTANCE_${suffix}`)).trim();
    if (!baseUrl || !apiKey || !instance) {
      sync = { status: 'updated', avatarUrl: cachedAvatar || null, source: 'provider_not_configured', contactId: contact.id, tenantId };
      return;
    }
    let response;
    try {
      response = await request.call(this, {
        method: 'POST', url: `${baseUrl}/chat/fetchProfilePictureUrl/${encodeURIComponent(instance)}`,
        headers: { apikey: apiKey, 'Content-Type': 'application/json' }, body: { number: handle },
      });
    } catch {
      // Transient provider failures deliberately do not touch avatar_fetched_at.
      sync = { status: 'updated', avatarUrl: cachedAvatar || null, source: 'evolution_error', contactId: contact.id, tenantId };
      return;
    }
    const avatarUrl = profilePictureFromPayload(response);
    if (avatarUrl) {
      await request.call(this, {
        method: 'PATCH', url: `${supabaseUrl}/rest/v1/contacts?id=eq.${encodeURIComponent(contact.id)}&tenant_id=eq.${encodeURIComponent(tenantId)}`,
        headers, body: { avatar_url: avatarUrl, avatar_fetched_at: now },
      }).catch(() => {});
      sync = { status: 'updated', avatarUrl, source: 'evolution', contactId: contact.id, tenantId };
      return;
    }
    if (noPhotoResponse(response)) {
      await request.call(this, {
        method: 'PATCH', url: `${supabaseUrl}/rest/v1/contacts?id=eq.${encodeURIComponent(contact.id)}&tenant_id=eq.${encodeURIComponent(tenantId)}`,
        headers, body: { avatar_url: null, avatar_fetched_at: now, metadata: { ...metadata, whatsapp_avatar_negative_fetched_at: now } },
      }).catch(() => {});
      sync = { status: 'updated', avatarUrl: null, source: 'negative_cache', contactId: contact.id, tenantId };
      return;
    }
    // A malformed/unknown provider payload is not proof of no photo.
    sync = { status: 'updated', avatarUrl: cachedAvatar || null, source: 'evolution_unconfirmed', contactId: contact.id, tenantId };
  } catch {
    // Contacts and profile pictures are enrichment only: message persistence and
    // customer response must proceed even when this integration is unavailable.
    sync = { status: 'error', avatarUrl: null, source: 'contact_sync_error' };
  }
}

await syncWhatsappContact.call(this);
sync.is_owner_saved = isOwnerSaved;
sync.owner_saved_source = ownerSavedSource;
return { json: {
  ...input,
  remoteJid: handle || input.remoteJid,
  phone: phone || input.phone,
  tenant_id: sync.tenantId || input.tenant_id,
  contact_id: sync.contactId || input.contact_id,
  is_owner_saved: Boolean(sync.is_owner_saved),
  owner_saved_source: sync.owner_saved_source || null,
  contact_sync: sync,
  avatarUrl: sync.avatarUrl || input.avatarUrl || null,
  raw_payload: {
    ...objectValue(input.raw_payload),
    contact_sync: sync,
    is_owner_saved: Boolean(sync.is_owner_saved),
    owner_saved_source: sync.owner_saved_source || null,
  },
} };

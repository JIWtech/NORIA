// NORIA UTIL | WhatsApp | Fotos de Perfil
// Renova a foto de perfil dos contatos WhatsApp de TODOS os tenants ativos, fora do caminho da mensagem.
// Os links do WhatsApp (pps.whatsapp.net) vencem cerca de 9,8 dias depois de emitidos; renovamos com 7 dias de folga.
// Projetado para ser leve no n8n: orçamento fixo por execução, consultas pequenas filtradas no banco,
// nada paginado em memória, saída mínima. Tenants futuros entram sozinhos ao configurar
// EVOLUTION_API_URL_<SLUG>, EVOLUTION_API_KEY_<SLUG> e EVOLUTION_INSTANCE_<SLUG> no ambiente do n8n.

const LIMITS = {
  maxFetchesPerRun: 25,        // chamadas à Evolution por execução, somando todos os tenants
  maxRunMs: 40_000,            // a execução encerra sozinha antes disso
  requestTimeoutMs: 6_000,
  delayBetweenCallsMs: 250,
  refreshAfterDays: 7,         // foto existente: renova antes de o link vencer
  noPhotoRetryDays: 3,         // contato sem foto (ou privada): confere de novo depois disso
  maxConsecutiveFailures: 3,   // pausa o tenant nesta execução se a Evolution dele estiver instável
  maxTenants: 50,
};

function env(name, fallback = '') {
  let value = '';
  try { value = $env[name] || ''; } catch { value = ''; }
  return String(value || fallback).trim();
}
// Mesma convenção do CORE (n8n/sources/noria_core.js): a mesma variável que o CORE usa para enviar mensagens.
function tenantEnvSuffix(slug) {
  return String(slug || '').toUpperCase().replace(/[^A-Z0-9]/g, '_');
}
function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
// Aceita só https sem espaços nem caracteres de controle; não depende do global URL (ausente em alguns runtimes do n8n).
function httpsUrl(value) {
  const text = String(value || '').trim();
  if (!text || text.length > 4096 || /[\s\u0000-\u001F\u007F]/.test(text)) return null;
  return /^https:\/\/[a-z0-9.-]+(?::\d{1,5})?(?:[/?#]|$)/i.test(text) ? text : null;
}
const PICTURE_FIELDS = ['profilePictureUrl', 'profilePicUrl', 'profile_picture_url'];
// Interpreta a resposta da Evolution: foto, "sem foto" confirmado, ou desconhecido (não grava nada).
function readPicture(response) {
  const body = objectValue(response);
  const data = objectValue(body.data);
  const status = Number(body.status || body.statusCode || 0);
  for (const source of [body, data]) {
    for (const field of PICTURE_FIELDS) {
      const url = httpsUrl(source[field]);
      if (url) return { kind: 'photo', url };
    }
  }
  // Só um campo de foto explicitamente vazio prova "sem foto"; um valor inválido (ex.: http) é desconhecido.
  const declared = [body, data].some(source => PICTURE_FIELDS.some(field => Object.prototype.hasOwnProperty.call(source, field)
    && (source[field] === null || source[field] === '')));
  const message = String(body.message || body.error || body.reason || '').toLowerCase();
  if (declared || status === 404 || /no[ _-]?(profile[ _-]?)?picture|not found|privacy|private|sem foto/.test(message)) {
    return { kind: 'none' };
  }
  return { kind: 'unknown' };
}

const supabaseUrl = env('SUPABASE_URL').replace(/\/$/, '');
const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
if (!supabaseUrl || !serviceKey) throw new Error('Supabase environment unavailable');
const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };
const encode = value => encodeURIComponent(String(value ?? ''));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const helpers = this.helpers;
const startedAt = Date.now();
const nowMs = startedAt;
const iso = ms => new Date(ms).toISOString();
const timeLeft = () => LIMITS.maxRunMs - (Date.now() - startedAt);

async function supabase(method, pathname, body) {
  return helpers.httpRequest({
    method, url: supabaseUrl + pathname, headers, json: true, timeout: 10_000,
    ...(body === undefined ? {} : { body }),
  });
}

// 1. Tenants ativos com Evolution configurada.
const tenantRows = await supabase('GET', '/rest/v1/tenants?select=id,slug&status=eq.active&deleted_at=is.null&order=slug.asc'
  + `&limit=${LIMITS.maxTenants}`);
const tenants = (Array.isArray(tenantRows) ? tenantRows : []).flatMap(row => {
  const suffix = tenantEnvSuffix(row.slug);
  const evolution = {
    url: env(`EVOLUTION_API_URL_${suffix}`).replace(/\/$/, ''),
    key: env(`EVOLUTION_API_KEY_${suffix}`),
    instance: env(`EVOLUTION_INSTANCE_${suffix}`),
  };
  if (!row.id || !suffix) return [];
  return [{ id: row.id, slug: row.slug, evolution, configured: Boolean(evolution.url && evolution.key && evolution.instance) }];
});

const summary = {
  tenants_active: tenants.length,
  tenants_without_evolution: tenants.filter(tenant => !tenant.configured).map(tenant => tenant.slug),
  fetched: 0, photos_saved: 0, no_photo: 0, unknown: 0, failures: 0, paused_tenants: [], per_tenant: {},
  budget_exhausted: false,
};
const active = tenants.filter(tenant => tenant.configured);

// 2. Divide o orçamento entre os tenants e busca no banco só os contatos vencidos de cada um, em lote pequeno.
const refreshBefore = iso(nowMs - LIMITS.refreshAfterDays * 86_400_000);
const noPhotoBefore = iso(nowMs - LIMITS.noPhotoRetryDays * 86_400_000);
const share = active.length ? Math.max(1, Math.ceil(LIMITS.maxFetchesPerRun / active.length)) : 0;
const queues = [];
for (const tenant of active) {
  if (timeLeft() <= 0) break;
  // Devido: nunca buscado; foto com mais de 7 dias; ou sem foto há mais de 3 dias.
  const due = `or=(avatar_fetched_at.is.null,and(avatar_url.not.is.null,avatar_fetched_at.lt.${encode(refreshBefore)}),`
    + `and(avatar_url.is.null,avatar_fetched_at.lt.${encode(noPhotoBefore)}))`;
  const rows = await supabase('GET', '/rest/v1/contacts?select=id,external_handle,avatar_url'
    + `&tenant_id=eq.${encode(tenant.id)}&source_channel=eq.whatsapp&deleted_at=is.null&external_handle=not.is.null`
    + `&${due}&order=avatar_fetched_at.asc.nullsfirst,id.asc&limit=${share}`).catch(() => []);
  const contacts = (Array.isArray(rows) ? rows : []).filter(row => row.id && /@(s\.whatsapp\.net|lid)$/i.test(String(row.external_handle || '')));
  summary.per_tenant[tenant.slug] = { due_in_batch: contacts.length, saved: 0, none: 0, failed: 0 };
  if (contacts.length) queues.push({ tenant, contacts, failures: 0 });
}

// 3. Rodízio entre tenants: um contato de cada por vez, até o orçamento de chamadas ou de tempo acabar.
async function fetchPicture(tenant, handle) {
  const { url, key, instance } = tenant.evolution;
  return helpers.httpRequest({
    method: 'POST', url: `${url}/chat/fetchProfilePictureUrl/${encode(instance)}`,
    headers: { apikey: key, 'Content-Type': 'application/json' }, body: { number: handle },
    json: true, timeout: LIMITS.requestTimeoutMs,
  });
}
// Sempre filtrado por id E tenant_id: um contato nunca é gravado fora do próprio tenant.
const contactPath = (tenant, contactId) => `/rest/v1/contacts?id=eq.${encode(contactId)}&tenant_id=eq.${encode(tenant.id)}`;
async function saveContact(tenant, contactId, avatarUrl) {
  await supabase('PATCH', contactPath(tenant, contactId), { avatar_url: avatarUrl, avatar_fetched_at: iso(Date.now()) });
}
// Falha ou resposta desconhecida: mantém a foto atual e só adia o contato ~1 dia. Sem isso ele voltaria
// primeiro em toda execução e um número problemático travaria a fila do tenant.
async function deferContact(tenant, contact) {
  const days = contact.avatar_url ? LIMITS.refreshAfterDays : LIMITS.noPhotoRetryDays;
  await supabase('PATCH', contactPath(tenant, contact.id), { avatar_fetched_at: iso(Date.now() - (days - 1) * 86_400_000) })
    .catch(() => {});
}

let progressed = true;
while (progressed) {
  progressed = false;
  for (const queue of queues) {
    if (summary.fetched >= LIMITS.maxFetchesPerRun || timeLeft() < LIMITS.requestTimeoutMs + 1_000) {
      summary.budget_exhausted = true; progressed = false; break;
    }
    if (!queue.contacts.length || queue.failures >= LIMITS.maxConsecutiveFailures) continue;
    const contact = queue.contacts.shift();
    const stats = summary.per_tenant[queue.tenant.slug];
    progressed = true;
    summary.fetched += 1;
    let result;
    try {
      result = readPicture(await fetchPicture(queue.tenant, contact.external_handle));
    } catch (error) {
      const status = Number(error?.httpCode || error?.statusCode || error?.response?.status || 0);
      // 404 da Evolution = número sem foto acessível; demais erros são transitórios e não tocam o cadastro.
      result = status === 404 ? { kind: 'none' } : { kind: 'error' };
    }
    try {
      if (result.kind === 'photo') { await saveContact(queue.tenant, contact.id, result.url); summary.photos_saved += 1; stats.saved += 1; queue.failures = 0; }
      else if (result.kind === 'none') { await saveContact(queue.tenant, contact.id, null); summary.no_photo += 1; stats.none += 1; queue.failures = 0; }
      else if (result.kind === 'unknown') { await deferContact(queue.tenant, contact); summary.unknown += 1; queue.failures = 0; }
      else { await deferContact(queue.tenant, contact); summary.failures += 1; stats.failed += 1; queue.failures += 1; }
    } catch {
      await deferContact(queue.tenant, contact);
      summary.failures += 1; stats.failed += 1; queue.failures += 1;
    }
    if (queue.failures >= LIMITS.maxConsecutiveFailures && !summary.paused_tenants.includes(queue.tenant.slug)) {
      summary.paused_tenants.push(queue.tenant.slug);
    }
    await sleep(LIMITS.delayBetweenCallsMs);
  }
}

summary.duration_ms = Date.now() - startedAt;
return [{ json: summary }];

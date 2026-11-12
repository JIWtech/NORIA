// NORIA CORE — resolução de extensão do tenant (fonte canônica; gerada no nó "CORE - Resolver extensão do tenant").
// Tenants legados mantêm o roteamento anterior. Para o tenant legado de contrato 1.0 que declara
// settings.noria_turn_pipeline, a versão (1.0 ou 2.0) é escolhida aqui, por configuração validada, e fica FIXA enquanto houver
// um lote em andamento: um turno nunca muda de versão no meio. Sem declaração válida e habilitada, o resultado é idêntico ao anterior.
const v = $json || {};
function required(x, label) { if (typeof x !== 'string' || !x.trim()) throw new Error('NORIA_ROTEAMENTO: '+label+' ausente'); return x.trim(); }
const tenant_slug = required(v.tenant_slug, 'tenant_slug');
const tenant_id = required(v.tenant_id, 'tenant_id');
required(v.instance, 'instance');
const remoteJid = required(v.remoteJid, 'remoteJid');

const base = String($env.SUPABASE_URL || '').replace(new RegExp('/$'), '');
const key = String($env.SUPABASE_SERVICE_ROLE_KEY || '');
const get = endpoint => this.helpers.httpRequest({ method: 'GET', url: base + '/rest/v1/' + endpoint,
  headers: { apikey: key, Authorization: 'Bearer ' + key }, json: true, timeout: 7000 });
const enc = encodeURIComponent;

// A rota dedicada só é selecionada após confirmar a identidade no banco.
if (tenant_slug === 'noria') {
  const instance = required(v.instance, 'instance');
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(tenant_id)) throw new Error('NORIA_IDENTIDADE_INCOMPLETA');
  if (!base || !key) throw new Error('NORIA_ROTEAMENTO_SEM_CREDENCIAIS_DB');
  const tenants = await get('tenants?select=id,slug,status&id=eq.' + enc(tenant_id) + '&slug=eq.noria&limit=1');
  if (!Array.isArray(tenants) || tenants.length !== 1 || tenants[0].id !== tenant_id || tenants[0].slug !== 'noria' || tenants[0].status !== 'active') throw new Error('NORIA_TENANT_INVALIDO');
  const channels = await get('channels?select=external_id,config,status&tenant_id=eq.' + enc(tenant_id) + '&type=eq.whatsapp&status=eq.active&limit=25');
  if (!Array.isArray(channels) || !channels.some(c => c.status === 'active' && [c.external_id, c.config?.instance_name, c.config?.instance, c.config?.evolution_instance, c.config?.instance_id].filter(Boolean).includes(instance))) throw new Error('NORIA_INSTANCIA_NAO_PERTENCE_AO_TENANT');
  return { json: { ...v, noria_extension: 'noria', noria_contract_version: '1.0', noria_router: 'noria_v1', noria_dispatch_phase: 'bootstrap' },
    ...(typeof $binary !== 'undefined' && $binary ? { binary: $binary } : {}) };
}

const byTenant = { clinica_nubia_oficial: 'nubia', wesley_automoveis: 'genesis' };
const contractVersionByTenant = { wesley_automoveis: '2.0' };
const legacyExtension = byTenant[tenant_slug];
if (legacyExtension) {
  const legacy = { ...v, noria_extension: legacyExtension, noria_contract_version: contractVersionByTenant[tenant_slug] || '1.0', noria_router: 'core_3wf_v1', noria_dispatch_phase: 'bootstrap' };
  // A contract line that already has its own version (Gênesis) never takes part in the services pipeline selection.
  if (contractVersionByTenant[tenant_slug]) return { json: legacy };
  if (!base || !key) throw new Error('NORIA_ROTEAMENTO_SEM_CREDENCIAIS_DB');
  const digits = value => String(value || '').replace(/\D/g, '');
  // Pilot identity: only a phone JID (<digits>@s.whatsapp.net) of the authenticated ingress can match. LID, group and broadcast
  // identifiers never match a configured number, even if their digits coincide.
  const phoneOf = jid => { const m = /^(\d{8,15})(?::\d+)?@s\.whatsapp\.net$/.exec(String(jid || '')); return m ? m[1] : ''; };
  const validContact = item => typeof item === 'string' && /^\d{8,15}$/.test(digits(item));
  const PIPELINE_VERSIONS = ['2.0'];
  try {
    const rows = await get('tenant_settings?select=settings&tenant_id=eq.' + enc(tenant_id) + '&limit=1');
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error('settings');
    const declared = rows[0].settings?.noria_turn_pipeline;
    // 1. An in-flight batch stays with the pipeline that started it (the dispatcher leaves a pin on the batch).
    const queue = await get('conversation_turn_queue?select=claimed&tenant_id=eq.' + enc(tenant_id) + '&channel_type=eq.whatsapp&chat_id=eq.' + enc(remoteJid) + '&limit=1');
    const claimed = Array.isArray(queue) && Array.isArray(queue[0]?.claimed) ? queue[0].claimed : [];
    let pinned = false;
    if (claimed.length) {
      const keys = claimed.map(item => String(item?.event_id || item?.id || '')).filter(Boolean)
        .flatMap(id => PIPELINE_VERSIONS.map(version => 'noria_pin_' + version + '_' + id));
      const pins = keys.length ? await get('channel_events?select=external_message_id&tenant_id=eq.' + enc(tenant_id) + '&channel_type=eq.whatsapp&external_conversation_id=eq.' + enc(remoteJid)
        + '&external_message_id=in.(' + keys.map(enc).join(',') + ')&limit=1') : [];
      if (!Array.isArray(pins)) throw new Error('pin');
      pinned = pins.length > 0;
      if (!pinned) return { json: legacy };
      return { json: { ...legacy, noria_contract_version: PIPELINE_VERSIONS[0], noria_router: 'services_v2_pinned', noria_pipeline: 'services_v1' } };
    }
    // 2. No batch in flight: an explicit, valid and enabled declaration selects the pipeline; anything else keeps 1.0.
    if (declared === undefined || declared === null) return { json: legacy };
    if (typeof declared !== 'object' || Array.isArray(declared)) throw new Error('NORIA_ROTEAMENTO_PIPELINE_CONFIG_INVALIDA');
    if (declared.enabled !== true) return { json: legacy };
    const scoped = declared.rollout === 'all' || (declared.rollout === 'pilot' && Array.isArray(declared.pilot?.allowed_contacts)
      && declared.pilot.allowed_contacts.length > 0 && declared.pilot.allowed_contacts.every(validContact));
    if (declared.contract !== 'noria_turn_pipeline_v1' || declared.capability !== 'services_v1' || !PIPELINE_VERSIONS.includes(declared.contract_version) || !scoped) {
      throw new Error('NORIA_ROTEAMENTO_PIPELINE_CONFIG_INVALIDA');
    }
    const allowed = declared.rollout === 'all' || (phoneOf(remoteJid) !== '' && declared.pilot.allowed_contacts.some(item => digits(item) === phoneOf(remoteJid)));
    return { json: allowed ? { ...legacy, noria_contract_version: declared.contract_version, noria_router: 'services_v2', noria_pipeline: 'services_v1', noria_pipeline_rollout: declared.rollout } : legacy };
  } catch (error) {
    if (/^NORIA_ROTEAMENTO_/.test(String(error?.message))) throw error;
    // Fail closed: no silent fallback between incompatible versions. The message stays queued and the recovery loop retries.
    throw new Error('NORIA_ROTEAMENTO_PIPELINE_INDISPONIVEL');
  }
}

// Para novos tenants SaaS autônomos, busca noria_client_policy diretamente em tenant_settings
if (!base || !key) throw new Error('NORIA_ROTEAMENTO_SEM_CREDENCIAIS_DB');

const rows = await get('tenant_settings?select=settings&tenant_id=eq.' + encodeURIComponent(tenant_id) + '&limit=1');

const s = rows?.[0]?.settings || {};
if (!s.noria_client_policy) {
  throw new Error('NORIA_SEM_EXTENSAO_CONFIGURADA: ' + tenant_slug);
}

return {
  json: {
    ...v,
    noria_extension: 'saas_dynamic',
    noria_client_policy: s.noria_client_policy,
    noria_contract_version: '1.0',
    noria_router: 'saas_dynamic_v1',
  },
};

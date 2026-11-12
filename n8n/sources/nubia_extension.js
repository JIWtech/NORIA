// NORIA EXT Núbia (NB Bronze) — decisão comercial v2.
// Fonte canônica ISOLADA: ainda não é gerada nem publicada por scripts/build_noria_workflows.cjs
// e não substitui a EXT v1 (nb_bronze_v1, contrato 1.0). Contrato: docs/architecture/nubia_ext_v2_contract.md
//
// Papel: AUTORIZAR ou RECUSAR decisões comerciais. Só lê (GET) tenants, tenant_settings, channels,
// tenant_service_catalog e follow_up_policies. Não escreve no Supabase, não envia mensagens, não reserva,
// não altera pagamento, não cria follow-ups, não faz handoff e não chama o Gemini.
// Nenhum preço, nome de serviço, duração, capacidade, percentual de sinal ou texto comercial vive aqui:
// tudo é lido do tenant. Nenhuma regex decide significado: a intenção vem do contrato semântico do Gemini.

const input = $json || {};
const EXPECTED_SLUG = 'clinica_nubia_oficial';
const CONTRACT_VERSION = '2.0';
const SEMANTIC_CONTRACT = 'noria_services_semantic_intent_v1';
const DECISION_CONTRACT = 'noria_services_decision_v2';
const PROVENANCE = 'nubia_extension_commercial_decide_v1';
const PROFILE = 'services_booking_v2';
const PIPELINE_CAPABILITY = 'services_v1';

// Enums do contrato (vocabulário técnico, não decisões comerciais).
const INTENTS = ['info_inquiry', 'comparison', 'availability_request', 'booking_intent', 'slot_change', 'reschedule',
  'cancellation', 'payment_report', 'human_request', 'complaint', 'other', 'ambiguous'];
const ACTIONABLE_INTENTS = ['availability_request', 'booking_intent', 'slot_change', 'reschedule', 'cancellation',
  'payment_report', 'human_request', 'complaint'];
const ROLES = ['mentioned', 'asked_about', 'compared', 'interested', 'selected', 'booking_target'];
const ACTIONABLE_ROLES = ['interested', 'selected', 'booking_target'];
const TOPICS = ['presentation', 'price', 'preparation', 'what_to_bring', 'general_info', 'catalog', 'location', 'payment_terms', 'health_or_safety', 'audience'];
const DISPOSITIONS = ['active', 'declined', 'closed_by_customer', 'resolved'];
const CONFIDENCE = ['low', 'medium', 'high'];
const AMBIGUITY_KINDS = ['service', 'date', 'time', 'unit', 'other'];
// Estados técnicos de agendamento escritos pelas RPCs (não são política comercial).
const PENDING_PAYMENT_STATES = ['pending_payment', 'reserved', 'payment_requested'];
const INACTIVE_STATES = ['cancelled', 'canceled', 'cancelado', 'cancelada', 'completed', 'done', 'no_show', 'deleted'];

const isObj = value => value && typeof value === 'object' && !Array.isArray(value);
const asStrings = value => (Array.isArray(value) ? value : []).filter(item => typeof item === 'string' && item.trim()).map(item => item.trim());
const uniq = list => [...new Set(list)];
const normalizeText = value => String(value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const truthy = value => value === true || value === 'true';

const turn = isObj(input.turn) ? input.turn : {};
const business = isObj(input.noria_business_context) ? input.noria_business_context : {};
const identity = {
  tenant_id: String(input.tenant_id || ''), tenant_slug: String(input.tenant_slug || ''), instance: String(input.instance || ''),
  remote_jid: String(input.remoteJid || ''), session_id: String(business.session_id || turn.boundary_id || ''),
  request_id: String(business.request_id || ''), turn_token: String(turn.token || ''),
};
const refuse = code => ({
  json: { ...input, noria_phase: 'finalize', commercial_decision: null, commercial_decision_status: 'error',
    commercial_decision_error: code, commercial_identity: identity }
});

const base = String($env.SUPABASE_URL || '').replace(/\/$/, '');
const key = String($env.SUPABASE_SERVICE_ROLE_KEY || '');
const headers = { apikey: key, Authorization: 'Bearer ' + key };
const get = endpoint => this.helpers.httpRequest({ method: 'GET', url: base + '/rest/v1/' + endpoint, headers, json: true, timeout: 7000 });
const enc = encodeURIComponent;
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;

// ------------------------------------------------- bootstrap: política do pipeline
// Antes do claim do turno. Só valida tenant, instância e motor, e DECLARA o pipeline de serviços que esta EXT sabe decidir.
// O CORE só o usa se a configuração explícita do tenant (settings.noria_turn_pipeline) declarar exatamente os mesmos valores.
if (input.noria_dispatch_phase === 'bootstrap') {
  if (identity.tenant_slug !== EXPECTED_SLUG || String(input.noria_extension || '') !== 'nubia') throw new Error('NORIA_EXTENSAO_TENANT_INCORRETO');
  if (String(input.noria_contract_version || '') !== CONTRACT_VERSION) throw new Error('NORIA_EXTENSAO_CONTRACT_VERSION_MISMATCH');
  if (!UUID.test(identity.tenant_id) || !identity.instance || !identity.remote_jid) throw new Error('NORIA_IDENTIDADE_INCOMPLETA');
  if (!base || !key) throw new Error('NORIA_CREDENCIAIS_SUPABASE_AUSENTES');
  const tenantRows = await get('tenants?select=id,slug,status&id=eq.' + enc(identity.tenant_id) + '&slug=eq.' + enc(EXPECTED_SLUG) + '&limit=1');
  if (!Array.isArray(tenantRows) || tenantRows.length !== 1 || tenantRows[0].status !== 'active') throw new Error('NORIA_TENANT_INVALIDO');
  const channelRows = await get('channels?select=external_id,config,status&tenant_id=eq.' + enc(identity.tenant_id) + '&type=eq.whatsapp&status=eq.active&limit=25');
  if (!Array.isArray(channelRows) || !channelRows.some(c => [c.external_id, c.config?.instance_name, c.config?.instance, c.config?.evolution_instance, c.config?.instance_id]
    .filter(Boolean).includes(identity.instance))) throw new Error('NORIA_INSTANCIA_NAO_PERTENCE_AO_TENANT');
  const bootRows = await get('tenant_settings?select=settings&tenant_id=eq.' + enc(identity.tenant_id) + '&limit=1');
  const bootSettings = Array.isArray(bootRows) && bootRows.length === 1 && isObj(bootRows[0].settings) ? bootRows[0].settings : null;
  if (!bootSettings || bootSettings.whatsapp_processing_mode !== 'conversation_core_v1') throw new Error('NORIA_MOTOR_INATIVO_TENANT');
  return { json: { ...input, noria_client_policy: {
    contract: 'noria_policy_v2', tenant_id: identity.tenant_id, tenant_slug: EXPECTED_SLUG, profile: PROFILE, capability: 'standard',
    audio_enabled: bootSettings.whatsapp_audio_enabled === true, scheduling_enabled: bootSettings.appointment_scheduling?.enabled === true,
    modules: { turn_pipeline: { contract: 'noria_turn_pipeline_v1', capability: PIPELINE_CAPABILITY, contract_version: CONTRACT_VERSION,
      semantic_contract: SEMANTIC_CONTRACT, decision_contract: DECISION_CONTRACT, decision_provenance: PROVENANCE,
      // O vocabulário do contrato semântico pertence à EXT; o CORE apenas monta o schema do Gemini a partir dele.
      semantic_vocabulary: { intents: INTENTS, roles: ROLES, topics: TOPICS, dispositions: DISPOSITIONS, ambiguity_kinds: AMBIGUITY_KINDS, confidence: CONFIDENCE } } },
  } } };
}
if (!base || !key) return refuse('NORIA_CREDENCIAIS_SUPABASE_AUSENTES');

// ---------------------------------------------------------------- identidade
if (input.noria_phase !== 'commercial_decision') return refuse('NUBIA_PHASE_UNSUPPORTED');
if (identity.tenant_slug !== EXPECTED_SLUG || String(input.noria_extension || '') !== 'nubia') return refuse('NORIA_EXTENSAO_TENANT_INCORRETO');
if (String(input.noria_contract_version || '') !== CONTRACT_VERSION) return refuse('COMMERCIAL_CONTRACT_VERSION_MISMATCH');
if (!UUID.test(identity.tenant_id) || !identity.instance || !identity.remote_jid) return refuse('NORIA_IDENTIDADE_INCOMPLETA');
// Contrato emitido pelo CORE: magia_claim_turn devolve {claimed, token (uuid), messages, boundary_id, instance, tenant_slug, contract}
// e o despachante compõe request_id = <event_id da última mensagem do turno>:<token>. Cada componente é verificado explicitamente.
const lastTurnMessage = Array.isArray(turn.messages) && turn.messages.length ? turn.messages[turn.messages.length - 1] : null;
const lastEventId = String(lastTurnMessage?.event_id || lastTurnMessage?.id || '');
if (turn.claimed !== true || turn.contract !== 'noria_turn_lifecycle_v1'
  || !UUID.test(identity.turn_token)
  || String(turn.tenant_slug || '') !== EXPECTED_SLUG || String(turn.instance || '') !== identity.instance
  || !identity.session_id || identity.session_id !== String(turn.boundary_id || '') || !lastEventId
  || identity.request_id !== lastEventId + ':' + identity.turn_token) return refuse('COMMERCIAL_TURN_IDENTITY_MISMATCH');

let tenants, settingsRows, channels, catalogRows, followUpRows;
try {
  tenants = await get('tenants?select=id,slug,status&id=eq.' + enc(identity.tenant_id) + '&slug=eq.' + enc(EXPECTED_SLUG) + '&limit=1');
  if (!Array.isArray(tenants) || tenants.length !== 1 || tenants[0].status !== 'active') return refuse('NORIA_TENANT_INVALIDO');
  channels = await get('channels?select=external_id,config,status&tenant_id=eq.' + enc(identity.tenant_id) + '&type=eq.whatsapp&status=eq.active&limit=25');
  if (!Array.isArray(channels) || !channels.some(c => [c.external_id, c.config?.instance_name, c.config?.instance, c.config?.evolution_instance, c.config?.instance_id]
    .filter(Boolean).includes(identity.instance))) return refuse('NORIA_INSTANCIA_NAO_PERTENCE_AO_TENANT');
  settingsRows = await get('tenant_settings?select=settings&tenant_id=eq.' + enc(identity.tenant_id) + '&limit=1');
  catalogRows = await get('tenant_service_catalog?select=external_id,name,category,active,price,metadata&tenant_id=eq.' + enc(identity.tenant_id) + '&limit=200');
  followUpRows = await get('follow_up_policies?select=enabled,steps&tenant_id=eq.' + enc(identity.tenant_id) + '&channel_type=eq.whatsapp&enabled=eq.true&limit=1');
} catch (error) { return refuse('NUBIA_SOURCE_UNAVAILABLE'); }
if (!Array.isArray(settingsRows) || settingsRows.length !== 1) return refuse('NORIA_SETTINGS_INVALIDAS');
const settings = isObj(settingsRows[0].settings) ? settingsRows[0].settings : {};
if (settings.whatsapp_processing_mode !== 'conversation_core_v1') return refuse('NORIA_MOTOR_INATIVO_TENANT');
if (!Array.isArray(catalogRows) || catalogRows.length >= 200) return refuse('NUBIA_CATALOG_UNAVAILABLE');

// ---------------------------------------------------- fontes comerciais oficiais
const configIssues = [];
const services = new Map();
for (const row of catalogRows) {
  const id = String(row?.external_id || '').trim();
  if (!id || services.has(id)) { if (id) configIssues.push('CATALOG_DUPLICATE_SERVICE_ID'); continue; }
  const price = row.price === null || row.price === undefined || row.price === '' ? NaN : Number(row.price);
  services.set(id, { id, name: String(row.name || ''), category: String(row.category || ''), active: row.active === true,
    price: Number.isFinite(price) && price >= 0 ? price : null, metadata: isObj(row.metadata) ? row.metadata : {} });
}

const sched = isObj(settings.appointment_scheduling) ? settings.appointment_scheduling : {};
const schedUnits = isObj(sched.units) ? sched.units : {};
const schedResources = isObj(sched.service_resources) ? sched.service_resources : {};
const schedulingEnabled = sched.enabled === true && Object.keys(schedUnits).length > 0;
const unitIds = Object.keys(schedUnits).filter(id => isObj(schedUnits[id]));
const defaultUnitId = unitIds.length === 1 ? unitIds[0] : '';
const lifecycleSessions = settings.attendance_lifecycle === 'session_v2';

const payment = isObj(settings.payment) ? settings.payment : {};
const explicitPayment = settings.payment_signal_enabled ?? payment.enabled;
const paymentEnabled = truthy(explicitPayment);
const paymentTrigger = String(settings.appointment_payment_trigger || payment.signal_trigger || '').trim();
const depositPercentage = [payment.deposit_percentage, settings.deposit_percentage].map(Number).find(n => Number.isFinite(n) && n > 0 && n <= 100) ?? null;

const facts = isObj(settings.business_facts) ? settings.business_facts : {};
const guidance = isObj(facts.service_guidance) ? facts.service_guidance : {};
const audience = isObj(facts.audience) ? facts.audience : {};
const audiencePolicy = typeof audience.exclusive_to === 'string' && audience.exclusive_to.trim()
  ? { exclusive_to: audience.exclusive_to.trim(), allow_proxy_booking_for_female: audience.allow_proxy_booking_for_female === true,
    policy: typeof audience.policy === 'string' ? audience.policy : '' } : null;
const guidanceGroupsFor = serviceId => Object.entries(guidance)
  .filter(([, group]) => isObj(group) && Array.isArray(group.services) && group.services.includes(serviceId))
  .map(([groupId, group]) => ({ groupId, group }));

// approved_messages: um bloco só é autorizável se revisão, preços e serviços forem coerentes com o catálogo vivo.
const approved = isObj(settings.approved_messages) ? settings.approved_messages : {};
const approvedUsable = approved.enabled === true && typeof approved.revision === 'string' && approved.revision.trim() !== '' && isObj(approved.blocks);
const catalogPrices = isObj(approved.catalog_prices) ? approved.catalog_prices : {};
const cents = value => Math.round(Number(value) * 100);
const moneyInText = text => [...String(text).matchAll(/R\$\s*([0-9][0-9.,]*)/g)].map(match => {
  const token = match[1];
  const decimal = token.includes(',') ? token.replace(/\./g, '').replace(',', '.') : /\.\d{2}$/.test(token) ? token : token.replace(/\./g, '');
  return cents(decimal);
});
// Taxas configuradas do tenant (business_facts.fees) também são valores monetários autorizados em um bloco aprovado.
const feeCents = new Set(Object.values(isObj(facts.fees) ? facts.fees : {}).filter(fee => fee !== null && fee !== '' && Number.isFinite(Number(fee))).map(cents));
const validBlocks = new Map();
const invalidBlocks = [];
if (approvedUsable) {
  for (const [blockKey, block] of Object.entries(approved.blocks)) {
    const text = isObj(block) && typeof block.text === 'string' ? block.text.trim() : '';
    const ids = isObj(block) && Array.isArray(block.service_ids) ? block.service_ids.filter(id => typeof id === 'string') : null;
    let ok = Boolean(text) && ids !== null && !/\[(?:ACAO|AÇÃO|HUMANO_SOLICITADO)/i.test(text);
    if (ok) {
      for (const id of ids) {
        const service = services.get(id);
        if (!service || !service.active || service.price === null || !Object.prototype.hasOwnProperty.call(catalogPrices, id)
          || cents(catalogPrices[id]) !== cents(service.price)) ok = false;
      }
      const allowed = new Set([...ids.filter(id => services.get(id)?.price !== null && services.get(id)).map(id => cents(services.get(id).price)), ...feeCents]);
      if (moneyInText(text).some(value => !allowed.has(value))) ok = false;
    }
    if (ok) validBlocks.set(blockKey, { key: blockKey, service_ids: ids, text_length: text.length, topics: asStrings(block.topics) });
    else invalidBlocks.push(blockKey);
  }
} else configIssues.push('APPROVED_MESSAGES_UNAVAILABLE');

const followUpPolicy = Array.isArray(followUpRows) && followUpRows[0] ? followUpRows[0] : null;
const followUpActions = isObj(settings.commercial_follow_up?.disposition_actions) ? settings.commercial_follow_up.disposition_actions : {};

// --------------------------------------------------------- evidências do turno
const currentMessages = (Array.isArray(turn.messages) ? turn.messages : []).map(m => ({ id: String(m?.event_id || m?.id || ''), text: String(m?.text || '') })).filter(m => m.id);
// Histórico só vale como prova se for mensagem do CLIENTE (inbound, contato) da MESMA sessão; o resto é descartado e
// qualquer evidência que o cite falha como EVIDENCE_UNKNOWN. O turno atual vem do claim (inbound por construção).
const sessionMessages = (Array.isArray(input.session_evidence) ? input.session_evidence : [])
  .filter(m => isObj(m) && m.direction === 'inbound' && m.sender_type === 'contact' && String(m.session_id || '') === identity.session_id)
  .map(m => ({ id: String(m.id || ''), text: String(m.text || '') })).filter(m => m.id);
const currentIds = new Set(currentMessages.map(m => m.id));
const evidenceText = new Map([...sessionMessages, ...currentMessages].map(m => [m.id, m.text]));

// ------------------------------------------------- validação do contrato semântico
const explicitOtherSession = value => value !== undefined && value !== null && String(value) !== '' && String(value) !== identity.session_id;
function validateSemantic(raw) {
  const errors = [];
  if (!isObj(raw)) return { valid: false, errors: ['SEMANTIC_MISSING'], v: null };
  if (raw.contract !== SEMANTIC_CONTRACT) errors.push('SEMANTIC_CONTRACT_MISMATCH');
  const evidence = (list, label, { required = true, current = false } = {}) => {
    const ids = uniq(asStrings(list));
    if (required && !ids.length) errors.push('EVIDENCE_MISSING_' + label);
    if (ids.some(id => !evidenceText.has(id))) errors.push('EVIDENCE_UNKNOWN_' + label);
    if (current && ids.length && !ids.some(id => currentIds.has(id))) errors.push('EVIDENCE_NOT_CURRENT_' + label);
    return ids;
  };
  const primary = INTENTS.includes(raw.primary_intent) ? raw.primary_intent : null;
  if (!primary) errors.push('INVALID_PRIMARY_INTENT');
  const secondary = asStrings(raw.secondary_intents);
  if (secondary.some(intent => !INTENTS.includes(intent))) errors.push('INVALID_SECONDARY_INTENT');
  const intents = uniq([primary, ...secondary].filter(Boolean));
  const actionable = intents.some(intent => ACTIONABLE_INTENTS.includes(intent));
  const intentEvidence = evidence(raw.evidence_ids, 'INTENT', { required: primary !== 'other', current: actionable });
  const confidence = CONFIDENCE.includes(raw.confidence) ? raw.confidence : null;
  if (!confidence) errors.push('INVALID_CONFIDENCE');

  const refs = [];
  if (!Array.isArray(raw.services)) errors.push('INVALID_SERVICES');
  else {
    if (raw.services.length > 8) errors.push('TOO_MANY_SERVICE_REFERENCES');
    for (const ref of raw.services.slice(0, 8)) {
      if (!isObj(ref) || typeof ref.service_id !== 'string' || !services.has(ref.service_id)) { errors.push('UNKNOWN_SERVICE_ID'); continue; }
      if (!ROLES.includes(ref.role)) { errors.push('INVALID_SERVICE_ROLE'); continue; }
      // A escolha do serviço pode ter sido feita antes, na mesma sessão (o turno atual traz dia/hora). A intenção acionável continua
      // exigindo evidência do turno atual. A prova de sessão é a própria evidência (sessionMessages só traz a sessão atual); o modelo
      // não precisa ecoar session_id, mas um session_id explícito de outra sessão continua recusado.
      const ids = evidence(ref.evidence_ids, 'SERVICE');
      if (explicitOtherSession(ref.session_id)) errors.push('SERVICE_SESSION_MISMATCH');
      refs.push({ service_id: ref.service_id, role: ref.role, evidence_ids: ids });
    }
  }
  const infoRequests = [];
  for (const request of Array.isArray(raw.info_requests) ? raw.info_requests : []) {
    if (!isObj(request) || !TOPICS.includes(request.topic)) { errors.push('INVALID_INFO_TOPIC'); continue; }
    const ids = asStrings(request.service_ids);
    if (ids.some(id => !services.has(id))) errors.push('UNKNOWN_SERVICE_ID');
    infoRequests.push({ topic: request.topic, service_ids: uniq(ids), evidence_ids: evidence(request.evidence_ids, 'INFO') });
  }
  const slotsRaw = isObj(raw.slots) ? raw.slots : {};
  const slots = { unit_id: '', date: '', time: '', customer_name: '', evidence_ids: [], name_evidence_ids: [] };
  if (slotsRaw.unit_id) {
    if (typeof slotsRaw.unit_id === 'string' && unitIds.includes(slotsRaw.unit_id)) slots.unit_id = slotsRaw.unit_id; else errors.push('INVALID_UNIT');
  }
  if (slotsRaw.date) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(slotsRaw.date));
    const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
    if (d && d.toISOString().slice(0, 10) === slotsRaw.date) slots.date = slotsRaw.date; else errors.push('INVALID_DATE');
  }
  if (slotsRaw.time) { if (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(slotsRaw.time))) slots.time = slotsRaw.time; else errors.push('INVALID_TIME'); }
  if (slotsRaw.customer_name) {
    slots.customer_name = String(slotsRaw.customer_name).trim().slice(0, 160);
  }
  if (slots.unit_id || slots.date || slots.time) slots.evidence_ids = evidence(slotsRaw.evidence_ids, 'SLOTS');
  // O nome é provado por evidência PRÓPRIA (turno atual ou histórico da mesma sessão): o texto da mensagem do cliente
  // deve conter o nome literalmente; um nome inferido pelo modelo não tem prova e é recusado.
  if (slots.customer_name) {
    slots.name_evidence_ids = evidence(slotsRaw.name_evidence_ids, 'NAME');
    if (!slots.name_evidence_ids.some(id => normalizeText(evidenceText.get(id)).includes(normalizeText(slots.customer_name)))) errors.push('NAME_WITHOUT_EVIDENCE');
    if (explicitOtherSession(slotsRaw.session_id)) errors.push('NAME_SESSION_MISMATCH');
  }
  const paymentRaw = isObj(raw.payment) ? raw.payment : {};
  const paymentDeclared = paymentRaw.declared === true;
  const paymentEvidence = paymentDeclared ? evidence(paymentRaw.evidence_ids, 'PAYMENT', { current: true }) : [];
  const humanRaw = isObj(raw.human) ? raw.human : {};
  const humanRequested = humanRaw.requested === true;
  const humanEvidence = humanRequested ? evidence(humanRaw.evidence_ids, 'HUMAN', { current: true }) : [];
  const previousRaw = raw.previous_service;
  if (previousRaw !== undefined && (!isObj(previousRaw) || typeof previousRaw.declared !== 'boolean')) errors.push('INVALID_PREVIOUS_SERVICE');
  const previousDeclared = isObj(previousRaw) && previousRaw.declared === true;
  const previousEvidence = previousDeclared ? evidence(previousRaw.evidence_ids, 'PREVIOUS_SERVICE', { current: true }) : [];
  if (previousEvidence.some(id => !currentIds.has(id))) errors.push('EVIDENCE_NOT_CURRENT_PREVIOUS_SERVICE');
  const convRaw = isObj(raw.conversation) ? raw.conversation : null;
  if (!convRaw || typeof convRaw.topic_change !== 'boolean' || typeof convRaw.requires_clarification !== 'boolean') errors.push('INVALID_CONVERSATION');
  const correctionRaw = isObj(convRaw?.intent_correction) ? convRaw.intent_correction : { corrects_previous: false };
  const correction = { corrects_previous: correctionRaw.corrects_previous === true,
    evidence_ids: correctionRaw.corrects_previous === true ? evidence(correctionRaw.evidence_ids, 'CORRECTION', { current: true }) : [] };
  const dispositionRaw = isObj(raw.customer_disposition) ? raw.customer_disposition : { value: 'active' };
  const disposition = DISPOSITIONS.includes(dispositionRaw.value) ? dispositionRaw.value : null;
  if (!disposition) errors.push('INVALID_DISPOSITION');
  const dispositionEvidence = disposition && disposition !== 'active' ? evidence(dispositionRaw.evidence_ids, 'DISPOSITION', { current: true }) : [];
  const ambiguities = [];
  for (const item of Array.isArray(raw.ambiguities) ? raw.ambiguities : []) {
    if (!isObj(item) || !AMBIGUITY_KINDS.includes(item.kind)) { errors.push('INVALID_AMBIGUITY'); continue; }
    const candidates = asStrings(item.candidate_service_ids);
    if (candidates.some(id => !services.has(id))) errors.push('UNKNOWN_SERVICE_ID');
    ambiguities.push({ kind: item.kind, candidate_service_ids: uniq(candidates) });
  }
  if (primary === 'ambiguous' && !ambiguities.length && !convRaw?.requires_clarification) errors.push('AMBIGUITY_WITHOUT_DETAIL');
  const uniqueErrors = uniq(errors);
  return { valid: !uniqueErrors.length, errors: uniqueErrors, v: uniqueErrors.length ? null : {
    primary_intent: primary, intents, confidence, evidence_ids: intentEvidence, services: refs, info_requests: infoRequests, slots,
    payment_declared: paymentDeclared, payment_evidence_ids: paymentEvidence, human_requested: humanRequested, human_evidence_ids: humanEvidence,
    previous_service_declared: previousDeclared, previous_service_evidence_ids: previousEvidence,
    topic_change: convRaw.topic_change, requires_clarification: convRaw.requires_clarification, intent_correction: correction,
    disposition, disposition_evidence_ids: dispositionEvidence, ambiguities,
  } };
}

// ------------------------------------------------------ política por serviço
function servicePolicy(serviceId) {
  const service = services.get(serviceId);
  if (!service.active) return { schedulable_by: 'none', booking_mode: 'inactive', resource: null, reason: 'SERVICE_INACTIVE' };
  const groups = guidanceGroupsFor(serviceId);
  const humanGroup = groups.some(({ group }) => group.booking === 'human');
  const resource = typeof schedResources[serviceId] === 'string' ? schedResources[serviceId] : null;
  const resourceUsable = Boolean(resource) && schedulingEnabled && unitIds.some(id => Number(schedUnits[id]?.capacities?.[resource]) >= 1);
  if (humanGroup) return { schedulable_by: 'human', booking_mode: 'human', resource, reason: 'BOOKING_MODE_HUMAN' };
  if (!resourceUsable) return { schedulable_by: 'human', booking_mode: 'no_schedule_resource', resource, reason: 'NO_SCHEDULE_RESOURCE' };
  return { schedulable_by: 'ai', booking_mode: 'ai', resource, reason: null };
}

// -------------------------------------------- resolução dinâmica de blocos aprovados
const sameOrSuperset = (ids, wanted) => wanted.every(id => ids.includes(id));
function minimalBlocks(wanted) {
  const covering = [...validBlocks.values()].filter(b => b.service_ids.length && sameOrSuperset(b.service_ids, wanted));
  if (!covering.length) return [];
  const smallest = Math.min(...covering.map(b => b.service_ids.length));
  return covering.filter(b => b.service_ids.length === smallest);
}
function resolveBlocks(topic, serviceIds) {
  const picked = [], notes = [];
  // applies_to_service_ids: the services this block was authorised FOR in this decision (lets the auditor tie preparation to the procedure).
  const add = (block, purpose, appliesTo = []) => {
    if (!block) return;
    const found = picked.find(p => p.key === block.key);
    if (found) found.applies_to_service_ids = uniq([...found.applies_to_service_ids, ...appliesTo]);
    else picked.push({ key: block.key, purpose, service_ids: block.service_ids, applies_to_service_ids: uniq(appliesTo), literal: true });
  };
  if (!approvedUsable) return { picked, notes: ['APPROVED_MESSAGES_UNAVAILABLE'] };
  if (topic === 'presentation' || topic === 'price') {
    if (!serviceIds.length) return { picked, notes: ['SERVICE_REQUIRED'] };
    const candidates = minimalBlocks(serviceIds);
    if (candidates.length === 1) add(candidates[0], topic, serviceIds);
    else if (candidates.length > 1) notes.push('AMBIGUOUS_APPROVED_BLOCK');
    else notes.push('NO_APPROVED_BLOCK_FOR_SERVICES');
  } else if (topic === 'catalog') {
    const offerable = [...services.values()].filter(s => s.active && s.price !== null).map(s => s.id);
    const candidates = minimalBlocks(offerable);
    if (candidates.length === 1) add(candidates[0], 'catalog'); else notes.push(candidates.length ? 'AMBIGUOUS_APPROVED_BLOCK' : 'NO_CURRENT_CATALOG_BLOCK');
  } else if (topic === 'preparation' || topic === 'what_to_bring' || topic === 'general_info') {
    if (!serviceIds.length) return { picked, notes: ['SERVICE_REQUIRED'] };
    const field = topic === 'what_to_bring' ? 'bring_message' : 'before_message';
    for (const id of serviceIds) for (const { group } of guidanceGroupsFor(id)) {
      const blockKey = typeof group[field] === 'string' ? group[field] : '';
      const text = blockKey && isObj(approved.blocks?.[blockKey]) ? String(approved.blocks[blockKey].text || '').trim() : '';
      if (text && !/\[(?:ACAO|AÇÃO|HUMANO_SOLICITADO)/i.test(text) && Array.isArray(approved.blocks[blockKey].service_ids) && !approved.blocks[blockKey].service_ids.length) {
        add({ key: blockKey, service_ids: [] }, topic, [id]);
      }
    }
    if (!picked.length) notes.push('NO_GUIDANCE_BLOCK_FOR_SERVICES');
  }
  // Vínculo tópico -> bloco declarado pelo próprio tenant (approved_messages.blocks.<chave>.topics); nenhum nome de bloco vive no código.
  for (const block of validBlocks.values()) if (block.topics.includes(topic)) add(block, topic, serviceIds);
  return { picked, notes };
}

// ------------------------------------------------------------------- decisão
const compact = value => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
// The tenant's configured operational command is deterministic: an exact line match of the configured trigger (no extra phrases).
const commandMessages = paymentEnabled && compact(paymentTrigger) !== ''
  ? currentMessages.filter(m => m.text.split('\n').some(line => compact(line) === compact(paymentTrigger))) : [];
let semantic = validateSemantic(input.semantic_intent);
if (!semantic.valid && commandMessages.length) {
  // The model is not consulted for a configured command; the decision rests on the command itself, bound to its message evidence.
  const ids = commandMessages.map(m => m.id);
  semantic = { valid: true, errors: [], via_configured_command: true, v: { primary_intent: 'payment_report', intents: ['payment_report'], confidence: 'high', evidence_ids: ids, services: [], info_requests: [],
    slots: { unit_id: '', date: '', time: '', customer_name: '', evidence_ids: [], name_evidence_ids: [] }, payment_declared: true, payment_evidence_ids: ids, human_requested: false, human_evidence_ids: [],
    topic_change: false, requires_clarification: false, intent_correction: { corrects_previous: false, evidence_ids: [] }, disposition: 'active', disposition_evidence_ids: [], ambiguities: [] } };
}
const decision = {
  contract: DECISION_CONTRACT, status: 'ok', provenance: PROVENANCE, noria_contract_version: CONTRACT_VERSION,
  ...identity,
  config: { approved_messages_revision: approvedUsable ? approved.revision : null, attendance_lifecycle: settings.attendance_lifecycle || null,
    scheduling_enabled: schedulingEnabled, payment_enabled: paymentEnabled, invalid_approved_blocks: invalidBlocks, issues: uniq(configIssues) },
  semantic: { valid: semantic.valid, validation_errors: semantic.errors, primary_intent: semantic.v?.primary_intent || null,
    intents: semantic.v?.intents || [], topic_change: semantic.v?.topic_change ?? null, intent_correction: semantic.v?.intent_correction?.corrects_previous ?? null,
    previous_service_declared: semantic.v?.previous_service_declared === true },
  services: [], ambiguous_references: [], facts: [], approved_blocks: [], reservation_state: [], reason_codes: [], evidence_used: [],
  actions: {
    present_information: { allowed: false, topics: [], service_ids: [], block_keys: [], notes: [] },
    check_availability: { allowed: false, reason: 'NOT_REQUESTED', params: null, missing: [] },
    create_reservation: { allowed: false, reason: 'NOT_REQUESTED', params: null, missing: [], requires: [] },
    forward_payment_declaration: { allowed: false, reason: 'NOT_REQUESTED', appointment_id: null },
    confirm_payment: { allowed: false, reason: 'HUMAN_VERIFICATION_REQUIRED' },
    handoff: { required: false, reason: null },
  },
  follow_up: { action: 'none', reason: 'NOT_EVALUATED', scope: 'commercial_resumption',
    policy: { enabled: Boolean(followUpPolicy), step_keys: followUpPolicy ? asStrings((followUpPolicy.steps || []).map(s => s?.key)) : [], source: 'follow_up_policies' } },
};
const A = decision.actions;
A.create_reservation.audience_policy = audiencePolicy;
const addFact = (fact_id, value, source) => { if (!decision.facts.some(f => f.fact_id === fact_id)) decision.facts.push({ fact_id, value: String(value), source }); };
// Fatos de público (política do tenant): emitidos apenas quando o turno trata de elegibilidade/público ou quando há bloqueio de público.
const addAudienceFacts = () => {
  if (!audiencePolicy) return;
  addFact('audience.exclusive_to', audiencePolicy.exclusive_to, 'business_facts.audience');
  if (audiencePolicy.policy.trim()) addFact('audience.policy', audiencePolicy.policy.trim(), 'business_facts.audience');
};
const finish = status => {
  decision.status = status;
  decision.evidence_used = uniq(decision.evidence_used);
  decision.reason_codes = uniq(decision.reason_codes);
  return { json: { ...input, noria_phase: 'finalize', commercial_decision: decision, commercial_decision_status: status,
    commercial_decision_error: null, commercial_identity: identity } };
};

if (!semantic.valid) {
  decision.reason_codes.push('SEMANTIC_CONTRACT_INVALID', ...semantic.errors);
  return finish('refused');
}
const v = semantic.v;
decision.evidence_used.push(...v.evidence_ids);
if (v.previous_service_declared) {
  A.handoff = { required: true, reason: 'PREVIOUS_SERVICE_CUSTOMER' };
  decision.evidence_used.push(...v.previous_service_evidence_ids);
  decision.follow_up.reason = 'BOOKING_PAYMENT_OR_HANDOFF_FLOW_OUT_OF_SCOPE';
  decision.follow_up.disposition = v.disposition;
  return finish('ok');
}
const lowConfidence = v.confidence === 'low' || v.requires_clarification || v.ambiguities.length > 0 || v.primary_intent === 'ambiguous';
if (lowConfidence) decision.reason_codes.push('CLARIFICATION_REQUIRED');

// Duração/permanência: o catálogo prevalece; sem ela, usa o grupo de service_guidance do próprio serviço (dado do tenant).
const positive = value => { const n = Number(value); return value !== null && value !== '' && Number.isFinite(n) && n > 0 ? n : null; };
const rangeText = value => {
  if (Array.isArray(value) && value.length === 2 && positive(value[0]) !== null && positive(value[1]) !== null) return positive(value[0]) + '-' + positive(value[1]);
  if (isObj(value) && positive(value.min) !== null && positive(value.max) !== null) return positive(value.min) + '-' + positive(value.max);
  return positive(value) !== null ? String(positive(value)) : null;
};
function addGuidanceDurations(id) {
  for (const { group } of guidanceGroupsFor(id)) {
    const procedure = positive(group.procedure_minutes_min) !== null && positive(group.procedure_minutes_max) !== null
      ? rangeText({ min: group.procedure_minutes_min, max: group.procedure_minutes_max }) : rangeText(group.procedure_minutes);
    if (procedure) addFact('service.' + id + '.procedure_minutes', procedure, 'business_facts.service_guidance');
    const stay = rangeText(isObj(group.stay_minutes) && Object.prototype.hasOwnProperty.call(group.stay_minutes, id) ? group.stay_minutes[id]
      : isObj(group.stay_minutes) && !('min' in group.stay_minutes) ? null : group.stay_minutes);
    if (stay) addFact('service.' + id + '.stay_minutes', stay, 'business_facts.service_guidance');
  }
}
// Atendimento a domicílio: somente informa o estado configurado; a reserva automática continua sujeita ao modo de agendamento do grupo.
function addGuidanceHomeService(id) {
  for (const { group } of guidanceGroupsFor(id)) {
    if (!isObj(group.home_service)) continue;
    for (const [field, value] of Object.entries(group.home_service)) {
      if (['boolean', 'string'].includes(typeof value) && String(value).trim() && field !== 'source') addFact('service.' + id + '.home_service.' + field, value, 'business_facts.service_guidance');
    }
  }
}

// Serviços referenciados: validados contra o catálogo vivo; papel preservado, nunca promovido.
const refIds = uniq([...v.services.map(r => r.service_id), ...v.info_requests.flatMap(r => r.service_ids)]);
for (const id of refIds) {
  const service = services.get(id), policy = servicePolicy(id);
  const roles = uniq(v.services.filter(r => r.service_id === id).map(r => r.role));
  const offerable = service.active && service.price !== null;
  decision.services.push({ service_id: id, name: service.name, roles, active: service.active, offerable, price: offerable ? service.price.toFixed(2) : null,
    schedulable_by: policy.schedulable_by, booking_mode: policy.booking_mode, schedule_resource: policy.resource,
    evidence_ids: uniq(v.services.filter(r => r.service_id === id).flatMap(r => r.evidence_ids)) });
  addFact('service.' + id + '.active', service.active, 'tenant_service_catalog');
  if (offerable) {
    addFact('service.' + id + '.name', service.name, 'tenant_service_catalog');
    addFact('service.' + id + '.price', service.price.toFixed(2), 'tenant_service_catalog');
    if (depositPercentage !== null) addFact('service.' + id + '.deposit_amount', (service.price * depositPercentage / 100).toFixed(2), 'tenant_service_catalog+settings.payment');
    const min = Number(service.metadata.procedure_minutes_min), max = Number(service.metadata.procedure_minutes_max);
    if (Number.isFinite(min) && Number.isFinite(max)) addFact('service.' + id + '.procedure_minutes', min + '-' + max, 'tenant_service_catalog.metadata');
    else addGuidanceDurations(id);
  } else decision.reason_codes.push(service.active ? 'SERVICE_WITHOUT_AUTHORIZED_PRICE' : 'SERVICE_INACTIVE');
  addGuidanceHomeService(id);
  addFact('service.' + id + '.schedulable_by', policy.schedulable_by, 'settings.appointment_scheduling+business_facts.service_guidance');
}
for (const item of v.ambiguities) decision.ambiguous_references.push(item);

// Informação: autorizada por tópico + serviço + bloco aprovado associado; nunca por palavra-chave.
const informational = v.intents.some(i => ['info_inquiry', 'comparison'].includes(i)) || v.info_requests.length > 0;
if (informational && !lowConfidence) {
  for (const request of v.info_requests) {
    if (request.topic === 'health_or_safety') {
      // No tenant source authorises statements about health, contraindications or safety: nothing is presented and a human answers.
      decision.reason_codes.push('NO_AUTHORIZED_SOURCE_FOR_TOPIC');
      A.present_information.notes.push('NO_AUTHORIZED_SOURCE_FOR_TOPIC');
      A.handoff = { required: true, reason: 'NO_AUTHORIZED_SOURCE_FOR_TOPIC' };
      decision.evidence_used.push(...request.evidence_ids);
      continue;
    }
    const ids = request.service_ids.length ? request.service_ids : v.services.filter(r => ['asked_about', 'compared', 'mentioned', 'interested', 'selected'].includes(r.role)).map(r => r.service_id);
    const usable = uniq(ids).filter(id => services.get(id).active);
    A.present_information.topics.push(request.topic);
    A.present_information.service_ids.push(...usable);
    decision.evidence_used.push(...request.evidence_ids);
    if (request.topic === 'audience') {
      // Elegibilidade/público só entra como fato quando a cliente trata disso no turno (sinal semântico do Gemini); nunca por padrão.
      addAudienceFacts();
    } else if (request.topic === 'location') {
      for (const row of Array.isArray(facts.locations) ? facts.locations : []) if (row?.verified === true && row.address) addFact('location.' + row.id + '.address', row.address, 'business_facts.locations');
    } else if (request.topic === 'payment_terms') {
      if (paymentEnabled && depositPercentage !== null) addFact('payment.deposit_percentage', depositPercentage, 'settings.payment');
      if (paymentEnabled && payment.pix_key && payment.pix_holder) {
        for (const field of ['pix_key', 'pix_holder', 'pix_institution']) if (typeof payment[field] === 'string' && payment[field].trim()) addFact('payment.' + field, payment[field].trim(), 'settings.payment');
        if (paymentTrigger) addFact('payment.signal_trigger', paymentTrigger, 'settings.appointment_payment_trigger');
      }
      if (Array.isArray(payment.accepted_payment_methods)) addFact('payment.accepted_methods', payment.accepted_payment_methods.join(','), 'settings.payment');
      for (const [feeKey, fee] of Object.entries(isObj(facts.fees) ? facts.fees : {})) if (Number.isFinite(Number(fee))) addFact('fee.' + feeKey, Number(fee).toFixed(2), 'business_facts.fees');
      (Array.isArray(facts.policies) ? facts.policies : []).forEach((text, index) => typeof text === 'string' && addFact('policy.' + index, text, 'business_facts.policies'));
      const termsBlocks = resolveBlocks('payment_terms', usable);
      for (const block of termsBlocks.picked) if (!decision.approved_blocks.some(b => b.key === block.key)) decision.approved_blocks.push(block);
    } else {
      const resolved = resolveBlocks(request.topic, request.topic === 'catalog' ? [] : usable);
      for (const block of resolved.picked) if (!decision.approved_blocks.some(b => b.key === block.key)) decision.approved_blocks.push(block);
      A.present_information.notes.push(...resolved.notes);
    }
  }
  A.present_information.service_ids = uniq(A.present_information.service_ids);
  A.present_information.topics = uniq(A.present_information.topics);
  A.present_information.block_keys = decision.approved_blocks.map(b => b.key);
  A.present_information.allowed = A.present_information.topics.length > 0;
  A.present_information.notes = uniq(A.present_information.notes);
}

// Estado de reservas (entrada do CORE): nunca escolhido arbitrariamente.
const reservations = (Array.isArray(input.reservations) ? input.reservations : []).filter(r => isObj(r) && r.id && !INACTIVE_STATES.includes(normalizeText(r.status)));
decision.reservation_state = reservations.map(r => ({ appointment_id: String(r.id), service_id: r.service_id || null, starts_at: r.starts_at || null,
  state: PENDING_PAYMENT_STATES.includes(r.status) ? 'pending_payment' : r.status === 'payment_reported' ? 'awaiting_verification' : r.status === 'confirmed' ? 'confirmed' : 'other' }));

// Agendamento: o serviço-alvo precisa ter papel acionável. A escolha citada no turno atual prevalece; sem ela, vale a escolha
// feita antes na mesma sessão (mais de uma escolha anterior vira pedido de esclarecimento).
const changeRequested = v.intents.some(intent => ['cancellation', 'reschedule', 'slot_change'].includes(intent));
const wantsAvailability = !changeRequested && (v.intents.includes('availability_request') || v.intents.includes('booking_intent'));
const wantsBooking = v.intents.includes('booking_intent');
const targetRefs = v.services.filter(r => ['selected', 'booking_target'].includes(r.role));
const currentTargets = uniq(targetRefs.filter(r => r.evidence_ids.some(id => currentIds.has(id))).map(r => r.service_id));
const targets = currentTargets.length ? currentTargets : uniq(targetRefs.map(r => r.service_id));
if (wantsAvailability) {
  if (lowConfidence) { A.check_availability.reason = 'CLARIFICATION_REQUIRED'; A.create_reservation.reason = 'CLARIFICATION_REQUIRED'; }
  else {
    const missing = [];
    if (targets.length !== 1) missing.push(targets.length > 1 ? 'service_choice' : 'service');
    const policy = targets.length === 1 ? servicePolicy(targets[0]) : null;
    const unitId = v.slots.unit_id || defaultUnitId;
    if (policy && policy.schedulable_by !== 'ai') {
      A.check_availability.reason = policy.reason; A.create_reservation.reason = policy.reason;
      A.handoff = { required: policy.schedulable_by === 'human', reason: policy.reason };
    } else {
      if (!unitId) missing.push('unit');
      if (!v.slots.date) missing.push('date');
      A.check_availability.missing = [...missing];
      if (!schedulingEnabled) { A.check_availability.reason = 'SCHEDULING_NOT_CONFIGURED'; A.create_reservation.reason = 'SCHEDULING_NOT_CONFIGURED'; }
      else if (missing.length) { A.check_availability.reason = 'MISSING_DATA'; A.create_reservation.reason = 'MISSING_DATA'; A.create_reservation.missing = [...missing]; }
      else {
        A.check_availability = { allowed: true, reason: 'AUTHORIZED', missing: [], params: { operation: 'magia_appointment_availability', unit_id: unitId, service_id: targets[0], date: v.slots.date, time: v.slots.time || '' } };
        decision.evidence_used.push(...v.slots.evidence_ids, ...v.slots.name_evidence_ids, ...v.services.filter(r => r.service_id === targets[0]).flatMap(r => r.evidence_ids));
        // Reserva: exige intenção explícita de agendar, horário, nome e disponibilidade verificada pela RPC neste mesmo turno.
        const create = A.create_reservation;
        create.requires = ['booking_intent_current_turn', 'time', 'full_name_with_evidence', 'availability_proof_bound_to_request', 'rpc_receipt_before_completion_claim'];
        if (!wantsBooking) create.reason = 'BOOKING_INTENT_NOT_EXPRESSED';
        else {
          if (!v.slots.time) create.missing.push('time');
          const nameParts = v.slots.customer_name.split(/\s+/).filter(part => part.length >= 2);
          if (nameParts.length < 2) create.missing.push('full_name');
          if (!create.missing.length) create.candidate = { service_id: targets[0], unit_id: unitId, date: v.slots.date, time: v.slots.time, customer_name: v.slots.customer_name };
          const av = isObj(input.availability) ? input.availability : null;
          // A prova de disponibilidade é a saída da RPC executada pelo CORE NESTE turno e presa a todos os eixos da solicitação.
          const availabilityBound = av && av.source === 'magia_appointment_availability' && av.tenant_id === identity.tenant_id
            && av.remote_jid === identity.remote_jid && av.session_id === identity.session_id && av.request_id === identity.request_id
            && av.turn_token === identity.turn_token && av.unit_id === unitId && av.service_id === targets[0] && av.date === v.slots.date
            && av.time === v.slots.time && Array.isArray(av.available_starts);
          if (create.missing.length) create.reason = 'MISSING_DATA';
          else if (!availabilityBound) create.reason = 'AVAILABILITY_NOT_VERIFIED';
          else if (!av.available_starts.includes(v.slots.time)) create.reason = 'SLOT_NOT_AVAILABLE';
          else if (reservations.some(r => r.service_id === targets[0] && r.requested_date === v.slots.date && r.requested_time === v.slots.time)) {
            create.reason = 'DUPLICATE_RESERVATION_CANDIDATE'; A.handoff = { required: true, reason: 'DUPLICATE_RESERVATION_CANDIDATE' };
          } else if (reservations.some(r => !(Date.parse(r.starts_at || '') <= Date.now()))) {
            // Já há outra reserva futura ativa conhecida deste contato: a nova reserva é atendida pela equipe, não automaticamente.
            create.reason = 'EXISTING_FUTURE_RESERVATION'; A.handoff = { required: true, reason: 'EXISTING_FUTURE_RESERVATION' };
          } else {
            const auth = isObj(input.booking_authorization) ? input.booking_authorization : null;
            const scoped = auth && auth.contract === 'current_booking_authorization_v1' && isObj(auth.identity) && isObj(auth.proposal)
              && ['tenant_id', 'instance', 'remote_jid', 'session_id', 'request_id', 'turn_token'].every(k => auth.identity[k] === identity[k])
              && Object.keys(create.candidate).every(k => auth.proposal[k] === create.candidate[k])
              && Array.isArray(auth.evidence_ids) && auth.evidence_ids.length > 0 && auth.evidence_ids.every(id => currentIds.has(id));
            if (!auth) create.reason = 'BOOKING_AUTHORIZATION_REQUIRED';
            else if (!scoped || !['accepted', 'blocked_real_name', 'blocked_audience'].includes(auth.status)) {
              create.reason = 'BOOKING_AUTHORIZATION_UNAVAILABLE'; A.handoff = { required: true, reason: create.reason };
            } else if (auth.status !== 'accepted') {
              create.reason = auth.status.toUpperCase();
              const specific = auth.status === 'blocked_real_name' ? audience.invalid_name_message : audience.ineligible_booking_message;
              // Sem mensagem específica configurada, vale a política de público oficial do tenant.
              const message = typeof specific === 'string' && specific.trim() ? specific : audience.policy;
              if (typeof message === 'string' && message.trim()) addFact('booking.block_message', message.trim(), 'settings.business_facts.audience');
              if (auth.status === 'blocked_audience') addAudienceFacts();
            }
            else {
              create.allowed = true; create.reason = 'AUTHORIZED';
              create.params = { operation: lifecycleSessions ? 'magia_reserve_session_appointment' : 'magia_reserve_appointment', unit_id: unitId,
                service_id: targets[0], date: v.slots.date, time: v.slots.time, customer_name: v.slots.customer_name, session_id: identity.session_id };
              create.expected_initial_state = 'pending_payment';
              // A EXT só autoriza a tentativa. Concorrência e capacidade são da RPC; "reservado" só pode ser dito com o recibo dela.
              create.idempotency_key = 'whatsapp:' + lastEventId;
              create.completion_claim_allowed = false;
              create.completion_requires = 'rpc_receipt_with_appointment_id';
            }
          }
        }
      }
    }
  }
}

// Taxas condicionadas a horário/dia (business_facts.fee_rules): avaliadas só sobre a data/hora pedidas; feriado só se cadastrado.
if (wantsAvailability && !lowConfidence && v.slots.date) {
  const weekday = new Date(v.slots.date + 'T00:00:00Z').getUTCDay();
  for (const [feeKey, rule] of Object.entries(isObj(facts.fee_rules) ? facts.fee_rules : {})) {
    const amount = Number(facts.fees?.[feeKey]);
    if (!isObj(rule) || !Number.isFinite(amount)) continue;
    const byDay = (Array.isArray(rule.weekdays) && rule.weekdays.includes(weekday)) || asStrings(rule.holiday_dates).includes(v.slots.date);
    const afterTime = typeof rule.after_time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(rule.after_time) ? rule.after_time : '';
    const byTime = Boolean(afterTime && v.slots.time && v.slots.time > afterTime);
    const applies = byDay || byTime;
    if (!applies && afterTime && !v.slots.time) continue; // ainda indeterminado: depende do horário
    addFact('booking.fee.' + feeKey + '.applies', applies, 'business_facts.fee_rules');
    if (applies) addFact('booking.fee.' + feeKey + '.amount', amount.toFixed(2), 'business_facts.fees');
  }
}

// Pagamento: a EXT autoriza apenas o ENCAMINHAMENTO da declaração; confirmar é sempre humano.
const commandMatched = commandMessages.length > 0;
if (paymentEnabled && (v.payment_declared || commandMatched) && (!lowConfidence || commandMatched)) {
  decision.evidence_used.push(...v.payment_evidence_ids, ...commandMessages.map(m => m.id));
  const pending = decision.reservation_state.filter(r => r.state === 'pending_payment');
  const forward = A.forward_payment_declaration;
  if (pending.length === 1) { forward.allowed = true; forward.reason = commandMatched ? 'CONFIGURED_COMMAND' : 'CUSTOMER_DECLARATION'; forward.appointment_id = pending[0].appointment_id; forward.resulting_state = 'awaiting_verification'; }
  else if (pending.length > 1) forward.reason = 'AMBIGUOUS_PENDING_RESERVATIONS';
  else if (decision.reservation_state.some(r => r.state === 'awaiting_verification')) forward.reason = 'ALREADY_AWAITING_VERIFICATION';
  else if (decision.reservation_state.some(r => r.state === 'confirmed')) forward.reason = 'ALREADY_CONFIRMED';
  else forward.reason = 'NO_PENDING_RESERVATION';
  if (forward.allowed || !['ALREADY_AWAITING_VERIFICATION', 'ALREADY_CONFIRMED'].includes(forward.reason)) A.handoff = { required: true, reason: forward.allowed ? 'PAYMENT_VERIFICATION' : forward.reason };
} else if (v.payment_declared && !paymentEnabled) { A.forward_payment_declaration.reason = 'PAYMENT_NOT_CONFIGURED'; A.handoff = { required: true, reason: 'PAYMENT_NOT_CONFIGURED' }; }

// Handoff: só operações sem execução automática disponível ou pedido explícito com evidência do turno atual.
if (!A.handoff.required) {
  const reason = v.human_requested ? 'HUMAN_REQUESTED' : v.intents.includes('complaint') ? 'COMPLAINT'
    : v.intents.includes('cancellation') ? 'NO_AUTOMATED_OPERATION_CANCELLATION' : v.intents.some(i => ['reschedule', 'slot_change'].includes(i)) ? 'NO_AUTOMATED_OPERATION_RESCHEDULE' : null;
  if (reason) { A.handoff = { required: true, reason }; decision.evidence_used.push(...v.human_evidence_ids, ...v.evidence_ids); }
}
if (Array.isArray(settings.handoff_rules) && settings.handoff_rules.length) addFact('config.handoff_rules.configured', true, 'settings.handoff_rules');
if (schedulingEnabled) addFact('scheduling.block_minutes', sched.duration_minutes ?? '', 'settings.appointment_scheduling');
if (paymentEnabled && depositPercentage !== null) addFact('payment.deposit_percentage', depositPercentage, 'settings.payment');
if (paymentEnabled && paymentTrigger) addFact('payment.signal_trigger', paymentTrigger, 'settings.appointment_payment_trigger');

// Follow-up comercial: disposição estruturada; o banco mantém as proteções (reserva futura, inbound, handoff, encerramento).
const flow = A.create_reservation.allowed || A.forward_payment_declaration.allowed || decision.reservation_state.length > 0 || A.handoff.required;
if (flow) { decision.follow_up.action = 'none'; decision.follow_up.reason = 'BOOKING_PAYMENT_OR_HANDOFF_FLOW_OUT_OF_SCOPE'; }
else {
  const configured = followUpActions[v.disposition];
  if (['keep', 'cancel'].includes(configured)) { decision.follow_up.action = configured; decision.follow_up.reason = 'CONFIGURED_DISPOSITION_ACTION'; decision.evidence_used.push(...v.disposition_evidence_ids); }
  else { decision.follow_up.action = 'none'; decision.follow_up.reason = 'DISPOSITION_ACTION_NOT_CONFIGURED'; }
}
decision.follow_up.disposition = v.disposition;

return finish('ok');

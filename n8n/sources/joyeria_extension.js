// NORIA EXT JOYERÍA — decisão comercial da venda consultiva (capability retail_v1).
// Fonte canônica ISOLADA: ainda não é gerada nem publicada por scripts/build_noria_workflows.cjs.
// Contrato: docs/operations/retail_pipeline_v1.md
//
// Papel: AUTORIZAR ou RECUSAR ações comerciais do turno. Só lê (GET) tenants, channels, tenant_settings,
// product_catalog_items e product_catalog_item_images. Não escreve no Supabase, não envia mensagens,
// não avisa ninguém, não chama o Gemini. O CORE executa apenas o que esta decisão autorizar.
// Nenhum produto, preço, número de telefone ou critério de material vive aqui: tudo vem do cadastro do
// tenant (settings.retail_policy e catálogo). A intenção vem do contrato semântico do Gemini, nunca de regex.

const input = $json || {};
const EXPECTED_SLUG = 'joyeria';
const CONTRACT_VERSION = '1.0';
const SEMANTIC_CONTRACT = 'noria_retail_semantic_intent_v1';
const DECISION_CONTRACT = 'noria_retail_decision_v1';
const PROVENANCE = 'joyeria_extension_commercial_decide_v1';
const PROFILE = 'retail_consultative_v1';
const PIPELINE_CAPABILITY = 'retail_v1';

// Vocabulário técnico do contrato (não são decisões comerciais).
const INTENTS = ['product_inquiry', 'price_inquiry', 'browsing', 'purchase_intent', 'exchange_request', 'home_visit_request',
  'care_or_warranty', 'store_info', 'human_request', 'complaint', 'other', 'ambiguous'];
const ROLES = ['mentioned', 'asked_about', 'compared', 'interested', 'selected'];
const INTEREST_ROLES = ['asked_about', 'compared', 'interested', 'selected'];
const MATERIALS = ['ouro_macico', 'material_nobre', 'blend', 'banhado_revestido', 'prata', 'aco', 'outro', 'desconhecido', 'none'];
const DECISIONS = ['decided', 'exploring', 'undefined'];
const CONFIDENCE = ['low', 'medium', 'high'];
const SPECIALIST_REASONS = ['blend', 'alto_padrao', 'cliente_decidido'];
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;

const isObj = value => value && typeof value === 'object' && !Array.isArray(value);
const asStrings = value => Array.isArray(value) ? value.filter(item => typeof item === 'string' && item) : [];
const uniq = list => [...new Set(list)];

// ------------------------------------------------------------------- identidade do turno
const tenantId = String(input.tenant_id || '');
const instance = String(input.instance || '');
const remoteJid = String(input.remoteJid || '');
if (input.tenant_slug !== EXPECTED_SLUG) throw new Error('JOYERIA_EXT_TENANT_INCORRETO');
if (input.noria_contract_version !== CONTRACT_VERSION) throw new Error('JOYERIA_EXT_CONTRACT_VERSION_MISMATCH');
if (input.noria_phase !== 'commercial_decision') throw new Error('JOYERIA_EXT_FASE_INVALIDA');
if (!UUID.test(tenantId) || !instance.trim() || !remoteJid.trim()) throw new Error('JOYERIA_EXT_IDENTIDADE_INCOMPLETA');
const turn = isObj(input.turn) ? input.turn : null;
const messages = Array.isArray(turn?.messages) ? turn.messages : [];
const lastEventId = String(messages.at(-1)?.event_id || messages.at(-1)?.id || '');
const token = String(turn?.token || '');
const sessionId = String(input.noria_business_context?.session_id || '');
// request_id é rederivado do claim, nunca aceito do modelo ou da entrada sem conferência.
const requestId = lastEventId + ':' + token;
if (!turn || turn.claimed === false || !lastEventId || !token || !sessionId || turn.boundary_id !== sessionId
  || turn.tenant_slug !== EXPECTED_SLUG || turn.instance !== instance
  || String(input.noria_business_context?.request_id || '') !== requestId) throw new Error('JOYERIA_EXT_TURNO_INVALIDO');
const identity = { tenant_id: tenantId, tenant_slug: EXPECTED_SLUG, instance, remote_jid: remoteJid,
  session_id: sessionId, request_id: requestId, turn_token: token };

// ------------------------------------------------------------------- leitura do cadastro (somente GET)
const base = String($env.SUPABASE_URL || '').replace(/\/$/, '');
const key = String($env.SUPABASE_SERVICE_ROLE_KEY || '');
if (!base || !key) throw new Error('JOYERIA_EXT_CREDENCIAIS_AUSENTES');
const enc = encodeURIComponent;
const get = endpoint => this.helpers.httpRequest({ method: 'GET', url: base + '/rest/v1/' + endpoint,
  headers: { apikey: key, Authorization: 'Bearer ' + key }, json: true, timeout: 7000 });
const channelKey = value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');

const tenants = await get('tenants?select=id,slug,status&id=eq.' + enc(tenantId) + '&slug=eq.' + enc(EXPECTED_SLUG) + '&limit=1');
if (!Array.isArray(tenants) || tenants.length !== 1 || tenants[0].id !== tenantId || tenants[0].status !== 'active') throw new Error('JOYERIA_EXT_TENANT_INVALIDO');
const channels = await get('channels?select=external_id,config,status&tenant_id=eq.' + enc(tenantId) + '&type=eq.whatsapp&status=eq.active&limit=25');
if (!Array.isArray(channels) || !channels.some(c => [c.external_id, c.config?.instance_name, c.config?.instance, c.config?.evolution_instance, c.config?.instance_id]
  .filter(Boolean).map(channelKey).includes(channelKey(instance)))) throw new Error('JOYERIA_EXT_INSTANCIA_NAO_PERTENCE');
const settingsRows = await get('tenant_settings?select=settings&tenant_id=eq.' + enc(tenantId) + '&limit=1');
const settings = Array.isArray(settingsRows) && isObj(settingsRows[0]?.settings) ? settingsRows[0].settings : null;
if (!settings) throw new Error('JOYERIA_EXT_SETTINGS_AUSENTES');
const policyDoc = settings.noria_client_policy;
if (!isObj(policyDoc) || policyDoc.profile !== PROFILE || policyDoc.modules?.turn_pipeline?.capability !== PIPELINE_CAPABILITY) {
  throw new Error('JOYERIA_EXT_POLITICA_INCOMPATIVEL');
}

// Política comercial do tenant. Valores ausentes desligam a ação correspondente (falha fechada).
const retail = isObj(settings.retail_policy) ? settings.retail_policy : {};
const specialistCfg = isObj(retail.specialist) ? retail.specialist : {};
const specialistEnabled = specialistCfg.enabled === true;
const highEndMaterials = asStrings(specialistCfg.high_end_materials).filter(m => MATERIALS.includes(m) && !['desconhecido', 'none', 'banhado_revestido'].includes(m));
const specialistMaterials = asStrings(specialistCfg.own_rule_materials).filter(m => MATERIALS.includes(m) && !['desconhecido', 'none'].includes(m));
const notifyDecided = specialistCfg.decided_customer === true;
const maxPhotos = Number.isInteger(retail.max_photos_per_turn) ? Math.min(Math.max(retail.max_photos_per_turn, 0), 3) : 0;
const siteLinkEnabled = retail.site_link?.enabled === true;
const configIssues = [];
if (specialistEnabled && !isObj(settings.specialist_notification)) configIssues.push('SPECIALIST_RECIPIENT_NOT_CONFIGURED');

// ------------------------------------------------------------------- contrato semântico
const currentIds = new Set(messages.map(m => String(m.event_id || m.id || '')).filter(Boolean));
const sessionIds = new Set([...currentIds, ...(Array.isArray(input.session_evidence) ? input.session_evidence.map(row => String(row?.id || '')) : [])]);
function evidence(value, field, errors, { required = false } = {}) {
  const ids = asStrings(value?.evidence_ids);
  if (ids.some(id => !sessionIds.has(id))) errors.push(field + '_EVIDENCE_OUTSIDE_SESSION');
  if (required && !ids.length) errors.push(field + '_EVIDENCE_MISSING');
  return ids;
}
function validateSemantic(raw) {
  const errors = [];
  if (!isObj(raw) || raw.contract !== SEMANTIC_CONTRACT) return { valid: false, errors: ['SEMANTIC_CONTRACT_MISMATCH'] };
  if (!INTENTS.includes(raw.primary_intent)) errors.push('PRIMARY_INTENT_INVALID');
  if (!CONFIDENCE.includes(raw.confidence)) errors.push('CONFIDENCE_INVALID');
  const evidenceIds = evidence(raw, 'TURN', errors, { required: true });
  const products = (Array.isArray(raw.products) ? raw.products : []).map(p => {
    if (!UUID.test(String(p?.item_id || '')) || !ROLES.includes(p?.role)) errors.push('PRODUCT_REFERENCE_INVALID');
    return { item_id: String(p?.item_id || ''), role: p?.role, evidence_ids: evidence(p, 'PRODUCT', errors, { required: true }) };
  });
  const flag = (name, extra = {}) => {
    const v = isObj(raw[name]) ? raw[name] : {};
    const on = v.requested === true || v.present === true;
    return { on, evidence_ids: evidence(v, name.toUpperCase(), errors, { required: on }), ...extra };
  };
  const material = isObj(raw.material_requested) ? raw.material_requested : {};
  if (!MATERIALS.includes(material.value)) errors.push('MATERIAL_INVALID');
  const decision = isObj(raw.customer_decision) ? raw.customer_decision : {};
  if (!DECISIONS.includes(decision.value)) errors.push('CUSTOMER_DECISION_INVALID');
  const conversation = isObj(raw.conversation) ? raw.conversation : {};
  const homeVisit = isObj(raw.home_visit) ? raw.home_visit : {};
  const v = {
    primary_intent: raw.primary_intent, confidence: raw.confidence, evidence_ids: evidenceIds, products,
    material: { value: material.value, evidence_ids: evidence(material, 'MATERIAL', errors, { required: !['none', undefined].includes(material.value) }) },
    decision: { value: decision.value, evidence_ids: evidence(decision, 'CUSTOMER_DECISION', errors, { required: decision.value === 'decided' }) },
    interest: flag('commercial_interest'), photos: flag('wants_photos'), human: flag('human'), exchange: flag('exchange'),
    home_visit: { ...flag('home_visit'), locality_known: typeof homeVisit.locality === 'string' && homeVisit.locality.trim() !== '' },
    topic_change: conversation.topic_change === true, requires_clarification: conversation.requires_clarification === true,
    ambiguous: raw.primary_intent === 'ambiguous' || (Array.isArray(raw.ambiguities) && raw.ambiguities.length > 0),
  };
  return { valid: errors.length === 0, errors: uniq(errors), v };
}

// ------------------------------------------------------------------- decisão
const decision = {
  contract: DECISION_CONTRACT, status: 'ok', provenance: PROVENANCE, noria_contract_version: CONTRACT_VERSION, ...identity,
  config: { issues: configIssues, max_photos_per_turn: maxPhotos, site_link_enabled: siteLinkEnabled, specialist_enabled: specialistEnabled },
  semantic: null, products: [], facts: [], reason_codes: [], evidence_used: [],
  actions: {
    present_information: { allowed: false, item_ids: [] },
    send_product_media: { allowed: false, item_id: null, asset_ids: [], reason: 'NOT_REQUESTED' },
    send_site_link: { allowed: false, item_id: null, reason: 'NOT_REQUESTED' },
    notify_specialist: { required: false, reasons: [], reason: null },
    handoff: { required: false, reason: null },
  },
};
const A = decision.actions;
const finish = status => {
  decision.status = status;
  decision.reason_codes = uniq(decision.reason_codes);
  decision.evidence_used = uniq(decision.evidence_used);
  return { json: { ...input, noria_phase: 'finalize', commercial_decision: decision, commercial_decision_status: status,
    commercial_decision_error: null, commercial_identity: identity } };
};

const semantic = validateSemantic(input.semantic_intent);
decision.semantic = { valid: semantic.valid, validation_errors: semantic.errors, primary_intent: semantic.v?.primary_intent || null };
if (!semantic.valid) {
  decision.reason_codes.push('SEMANTIC_CONTRACT_INVALID', ...semantic.errors);
  return finish('refused');
}
const v = semantic.v;
decision.evidence_used.push(...v.evidence_ids);

// Itens citados: relidos do catálogo do próprio tenant; referência a item de outro tenant ou inexistente é descartada.
const referencedIds = uniq(v.products.map(p => p.item_id)).slice(0, 10);
let items = [];
if (referencedIds.length) {
  items = await get('product_catalog_items?select=id,tenant_id,item_code,name,category,material_class,offerable,active,price_cents,currency,price_status,sale_unit,width_mm,site_url'
    + '&tenant_id=eq.' + enc(tenantId) + '&id=in.(' + referencedIds.map(enc).join(',') + ')&limit=10');
  if (!Array.isArray(items)) throw new Error('JOYERIA_EXT_CATALOGO_INDISPONIVEL');
  items = items.filter(item => item.tenant_id === tenantId);
}
const byId = new Map(items.map(item => [item.id, item]));
const unknownRefs = referencedIds.filter(id => !byId.has(id));
if (unknownRefs.length) decision.reason_codes.push('PRODUCT_REFERENCE_NOT_IN_CATALOG');
const roleOf = id => v.products.filter(p => p.item_id === id).map(p => p.role);
const interestedItems = items.filter(item => roleOf(item.id).some(role => INTEREST_ROLES.includes(role)));
decision.products = items.map(item => ({ item_id: item.id, item_code: item.item_code, roles: roleOf(item.id), offerable: item.offerable === true,
  material_class: item.material_class }));
for (const p of v.products) if (byId.has(p.item_id)) decision.evidence_used.push(...p.evidence_ids);

// 1. Atendimento humano genérico: pedido explícito, troca, reclamação ou visita domiciliar com localidade informada.
//    Visita sem localidade: a IA pergunta antes de encaminhar (decisão do tenant: coletar localidade e necessidade).
if (v.human.on || v.primary_intent === 'complaint') {
  A.handoff = { required: true, reason: v.human.on ? 'HUMAN_REQUESTED' : 'COMPLAINT' };
  decision.evidence_used.push(...v.human.evidence_ids);
} else if (v.exchange.on) {
  A.handoff = { required: true, reason: 'EXCHANGE_REQUEST' };
  decision.evidence_used.push(...v.exchange.evidence_ids);
} else if (v.home_visit.on) {
  if (v.home_visit.locality_known) {
    A.handoff = { required: true, reason: 'HOME_VISIT_REQUEST' };
    decision.evidence_used.push(...v.home_visit.evidence_ids);
  } else decision.reason_codes.push('HOME_VISIT_LOCALITY_MISSING');
}

// 2. Aviso ao especialista (a IA continua atendendo). Critérios lidos da política do tenant:
//    material com regra própria (ex.: blend) ou material de alto padrão, sempre com interesse comercial evidenciado;
//    cliente decidido, inclusive quem se decide durante a conversa. Composição desconhecida nunca conta como alto padrão.
const reasons = [];
if (specialistEnabled && !A.handoff.required) {
  // Dúvida informativa (ex.: cuidados com a peça) não é interesse comercial: "asked_about" sozinho não aciona o aviso.
  const interest = v.interest.on || v.decision.value === 'decided'
    || items.some(item => roleOf(item.id).some(role => ['interested', 'selected'].includes(role)));
  const materialsInPlay = uniq([...interestedItems.map(item => item.material_class), v.material.value]);
  if (interest && materialsInPlay.some(m => specialistMaterials.includes(m))) reasons.push('blend');
  if (interest && materialsInPlay.some(m => highEndMaterials.includes(m))) reasons.push('alto_padrao');
  if (notifyDecided && v.decision.value === 'decided') reasons.push('cliente_decidido');
  if (reasons.length) {
    A.notify_specialist = { required: true, reasons: SPECIALIST_REASONS.filter(r => reasons.includes(r)), reason: SPECIALIST_REASONS.find(r => reasons.includes(r)) };
    decision.evidence_used.push(...v.interest.evidence_ids, ...v.material.evidence_ids, ...v.decision.evidence_ids);
    if (configIssues.includes('SPECIALIST_RECIPIENT_NOT_CONFIGURED')) decision.reason_codes.push('SPECIALIST_RECIPIENT_NOT_CONFIGURED');
  }
}

// 3. Informação de produto: só itens do catálogo, ativos e ofertáveis (preço aprovado). O resto não vira afirmação.
const presentable = interestedItems.filter(item => item.offerable === true && item.active === true && item.price_status === 'aprovado');
if (presentable.length) {
  A.present_information = { allowed: true, item_ids: presentable.slice(0, 3).map(item => item.id) };
  for (const item of presentable.slice(0, 3)) {
    decision.facts.push({ item_id: item.id, name: item.name, price_cents: Number(item.price_cents), currency: item.currency,
      sale_unit: item.sale_unit, width_mm: item.width_mm === null ? null : Number(item.width_mm), material_class: item.material_class });
  }
}
if (interestedItems.some(item => !presentable.includes(item))) decision.reason_codes.push('PRODUCT_NOT_OFFERABLE');

// 4. Fotos: um único item em foco, ofertável, com imagens aprovadas; pedido explícito ou primeira apresentação do item.
const focus = presentable.length === 1 ? presentable[0] : null;
if (maxPhotos > 0 && focus && !A.handoff.required && (v.photos.on || ['product_inquiry', 'purchase_intent'].includes(v.primary_intent))) {
  const links = await get('product_catalog_item_images?select=asset_id,display_order,review_status&tenant_id=eq.' + enc(tenantId)
    + '&item_id=eq.' + enc(focus.id) + '&review_status=eq.aprovada&order=display_order.asc&limit=' + maxPhotos);
  if (!Array.isArray(links)) throw new Error('JOYERIA_EXT_IMAGENS_INDISPONIVEIS');
  const assetIds = links.filter(link => link.review_status === 'aprovada' && UUID.test(String(link.asset_id || ''))).map(link => link.asset_id).slice(0, maxPhotos);
  if (assetIds.length) {
    A.send_product_media = { allowed: true, item_id: focus.id, asset_ids: assetIds, reason: v.photos.on ? 'PHOTOS_REQUESTED' : 'PRODUCT_PRESENTATION' };
    decision.evidence_used.push(...v.photos.evidence_ids);
  } else A.send_product_media.reason = 'NO_APPROVED_IMAGES';
} else if (v.photos.on) A.send_product_media.reason = focus ? 'PHOTOS_DISABLED_OR_HANDOFF' : 'NO_SINGLE_PRODUCT_IN_FOCUS';

// 5. Link do site: cliente orientado pela IA, sem critério de especialista nem handoff, com um item em foco e link cadastrado.
if (siteLinkEnabled && focus && !A.notify_specialist.required && !A.handoff.required && v.interest.on) {
  if (typeof focus.site_url === 'string' && /^https:\/\/[^/\s]+\/\S*$/.test(focus.site_url)) A.send_site_link = { allowed: true, item_id: focus.id, reason: 'GUIDED_PURCHASE' };
  else A.send_site_link.reason = 'NO_SITE_URL';
} else if (A.notify_specialist.required) A.send_site_link.reason = 'SPECIALIST_FLOW';

if (v.ambiguous || v.requires_clarification || v.confidence === 'low') decision.reason_codes.push('CLARIFICATION_REQUIRED');
if (v.topic_change) decision.reason_codes.push('TOPIC_CHANGE');
return finish('ok');

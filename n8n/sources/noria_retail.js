// NORIA — capability retail_v1 (venda consultiva de produtos): funções puras do CORE.
// Fonte canônica. O gerador (scripts/build_noria_workflows.cjs) projeta este arquivo na região retail_v1 de noria_core.js.
// Contrato: docs/operations/retail_pipeline_v1.md
//
// Regras deste arquivo:
// - Nenhuma função faz I/O, lê variável global do motor ou conhece tenant, produto, número ou regra comercial.
//   Tudo chega por parâmetro; o motor faz as chamadas de rede e grava os eventos que estas funções descrevem.
// - Recusa por padrão: dado malformado, de outro tenant ou fora do contrato não autoriza efeito nenhum.

const RETAIL_SEMANTIC_CONTRACT = 'noria_retail_semantic_intent_v1';
const RETAIL_MEDIA_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const RETAIL_MAX_MEDIA = 3;
const RETAIL_UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const RETAIL_SPECIALIST_REASONS = ['material_regra_propria', 'alto_padrao', 'cliente_decidido'];
const RETAIL_NOTICE_CONTRACT = 'noria_specialist_notice_v1';
const RETAIL_PHOTO_SERVICE = 'retail_product_photo';

const retailIsObj = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const retailStrings = value => Array.isArray(value) ? value.filter(item => typeof item === 'string' && item) : [];

// ------------------------------------------------------------------- interpretação (fase prepare)

// Regras de leitura do Gemini. Genéricas: descrevem COMO interpretar, nunca o que o negócio vende ou decide.
const RETAIL_SEMANTIC_RULES = [
  'Você só interpreta o que o cliente escreveu. Não decide encaminhamento, preço, desconto, prazo ou envio.',
  'Use somente ids de mensagens de customer_messages como evidência; cada campo marcado como verdadeiro precisa de evidência.',
  'products: cite apenas item_id da lista catalog; nunca invente item. Se o cliente descreve algo que não está na lista, deixe products vazio e registre o material pedido em material_requested.',
  'role: mentioned (citou de passagem), asked_about (perguntou informação), compared (comparou), interested (demonstrou interesse comercial), selected (escolheu).',
  'commercial_interest: verdadeiro quando o cliente quer comprar, saber preço, medida, prazo ou condição de pagamento. Dúvida sobre cuidados, garantia ou uso não é interesse comercial.',
  'customer_decision: refere-se a uma compra NOVA nesta conversa. decided quando o cliente já sabe exatamente o que quer comprar agora, seja desde a primeira mensagem ou depois de conversar; exploring quando está escolhendo; undefined quando não há sinal ou quando fala de uma peça que já comprou (pós-venda, cuidados, troca).',
  'Use model e width_mm de cada item de catalog para casar o pedido do cliente (ex.: abaulada x reta); não cite item de outro modelo.',
  'material_requested: material que o próprio cliente pediu (ex.: ouro maciço). Peça banhada, folheada, revestida ou encapada nunca é ouro maciço. Sem pedido de material, use none.',
  'human: só verdadeiro quando o cliente pede expressamente para falar com uma pessoa, atendente ou humano. Querer fechar a compra ou perguntar "como faço o pedido" NÃO é pedido de humano.',
  'wants_photos: só verdadeiro quando o cliente pede para ver ou receber foto. Perguntar sobre uma foto já enviada (ex.: "essa da foto é a de 6 mm?") não é pedido de nova foto.',
  'Perguntar se há alguém atendendo ("tem alguém aí?", "oi??") não é pedido de humano: é o cliente checando se foi ouvido.',
  'complaint só para reclamação de pedido, entrega, defeito ou atendimento. Citar preço visto em anúncio, site ou Instagram, ou pedir desconto, não é reclamação.',
  'home_visit só quando o cliente quer atendimento na casa dele. Agendar ida ao showroom ou à loja não é home_visit.',
  'human (complemento): pedido explícito para falar com uma pessoa. exchange: pedido de troca. home_visit: pedido de atendimento em casa; preencha locality só se o cliente disse a cidade ou bairro.',
  'Marque requires_clarification ou ambiguities quando não for possível saber a que produto ou pedido o cliente se refere. Na dúvida, prefira confidence low.',
];

function retailSemanticSchema(vocabulary, itemIds) {
  const str = { type: 'STRING' }, bool = { type: 'BOOLEAN' }, ids = { type: 'ARRAY', items: str };
  const enumOf = values => ({ type: 'STRING', enum: values });
  const itemId = Array.isArray(itemIds) && itemIds.length ? enumOf(itemIds) : str;
  const flag = (name, extra = {}) => ({ type: 'OBJECT', properties: { [name]: bool, ...extra, evidence_ids: ids }, required: [name, 'evidence_ids'] });
  return {
    type: 'OBJECT',
    properties: {
      primary_intent: enumOf(vocabulary.intents), confidence: enumOf(vocabulary.confidence), evidence_ids: ids,
      products: { type: 'ARRAY', items: { type: 'OBJECT', properties: { item_id: itemId, role: enumOf(vocabulary.roles), evidence_ids: ids }, required: ['item_id', 'role', 'evidence_ids'] } },
      material_requested: { type: 'OBJECT', properties: { value: enumOf(vocabulary.materials), evidence_ids: ids }, required: ['value', 'evidence_ids'] },
      customer_decision: { type: 'OBJECT', properties: { value: enumOf(vocabulary.decisions), evidence_ids: ids }, required: ['value', 'evidence_ids'] },
      commercial_interest: flag('present'), wants_photos: flag('requested'), human: flag('requested'), exchange: flag('requested'),
      home_visit: flag('requested', { locality: str }),
      conversation: { type: 'OBJECT', properties: { topic_change: bool, requires_clarification: bool }, required: ['topic_change', 'requires_clarification'] },
      ambiguities: { type: 'ARRAY', items: { type: 'OBJECT', properties: { kind: str }, required: ['kind'] } },
    },
    required: ['primary_intent', 'confidence', 'evidence_ids', 'products', 'material_requested', 'customer_decision', 'commercial_interest',
      'wants_photos', 'human', 'exchange', 'home_visit', 'conversation', 'ambiguities'],
  };
}

// Vocabulário declarado pela EXT; incompleto = configuração inválida (o pipeline não roda).
function retailVocabulary(offered) {
  const keys = ['intents', 'roles', 'materials', 'decisions', 'confidence'];
  const vocab = retailIsObj(offered) ? offered.semantic_vocabulary : null;
  const out = {};
  for (const key of keys) {
    const list = retailStrings(vocab?.[key]);
    if (!list.length || list.length !== (vocab[key] || []).length) throw new Error('NORIA_RETAIL_VOCABULARY_INVALID');
    out[key] = list;
  }
  return out;
}

// Consulta de candidatos: só itens do tenant, ativos e ofertáveis, em ordem determinística. Uma linha a mais detecta corte.
function retailCandidatePath(tenantId, limit) {
  if (!RETAIL_UUID.test(String(tenantId || ''))) throw new Error('NORIA_RETAIL_TENANT_INVALID');
  const max = Number.isInteger(limit) && limit > 0 && limit <= 500 ? limit : 250;
  return 'product_catalog_items?select=id,tenant_id,name,category,product_line,model,width_mm,material_class'
    + '&tenant_id=eq.' + encodeURIComponent(tenantId) + '&active=eq.true&offerable=eq.true'
    + '&order=category.asc,name.asc,id.asc&limit=' + (max + 1);
}

function retailCandidates(rows, tenantId, limit) {
  if (!Array.isArray(rows)) throw new Error('NORIA_RETAIL_CATALOG_UNAVAILABLE');
  const max = Number.isInteger(limit) && limit > 0 && limit <= 500 ? limit : 250;
  const own = rows.filter(row => row && row.tenant_id === tenantId && RETAIL_UUID.test(String(row.id || '')));
  return {
    complete: rows.length <= max,
    items: own.slice(0, max).map(row => ({ item_id: row.id, name: String(row.name || ''), category: row.category || null,
      line: row.product_line || null, model: row.model || null,
      width_mm: row.width_mm === null || row.width_mm === undefined ? null : Number(row.width_mm) })),
  };
}

// Estado das fotos nesta sessão, a partir das reservas e resultados gravados em channel_events.
// - sentItemIds: itens com foto confirmada pelo provedor.
// - pendingAssetIds/pendingItemIds: reserva sem resultado ou com resultado desconhecido. Exigem reconciliação: a foto
//   pode ter chegado ao cliente, então nunca é reenviada automaticamente, em nenhum turno.
// Para a EXT, item pendente conta como já apresentado (não repete a apresentação automática).
function retailMediaState(rows, sessionId) {
  const inSession = (Array.isArray(rows) ? rows : []).filter(row => row?.direction === 'outbound'
    && String(row.raw_payload?.conversation_session_id || '') === String(sessionId || ''));
  const reservations = inSession.filter(row => row.service === RETAIL_PHOTO_SERVICE + '_attempt' && row.raw_payload?.status === 'reserved');
  const outcomes = inSession.filter(row => row.raw_payload?.reservation_event_id);
  const resolved = new Set(outcomes.filter(row => ['sent', 'failed'].includes(row.raw_payload.status)).map(row => String(row.raw_payload.reservation_event_id)));
  const pending = [
    ...reservations.filter(row => !resolved.has(String(row.id))),
    ...outcomes.filter(row => row.raw_payload.status === 'unknown'),
  ];
  const ids = (list, key) => [...new Set(list.map(row => String(row.raw_payload?.[key] || '')).filter(id => RETAIL_UUID.test(id)))];
  const sentItemIds = ids(outcomes.filter(row => row.service === RETAIL_PHOTO_SERVICE && row.raw_payload.status === 'sent'), 'item_id');
  const pendingItemIds = ids(pending, 'item_id');
  return { sentItemIds, pendingItemIds, pendingAssetIds: ids(pending, 'asset_id'),
    presentedItemIds: [...new Set([...sentItemIds, ...pendingItemIds])] };
}

// ------------------------------------------------------------------- decisão da EXT (fase finalize)

function retailVerifiedDecision(inputDecision, inputStatus, pipeline, identity) {
  const decision = inputDecision;
  if (inputStatus === 'error' || !retailIsObj(decision)) throw new Error('COMMERCIAL_DECISION_UNAVAILABLE');
  if (decision.contract !== pipeline.decision_contract || decision.provenance !== pipeline.decision_provenance
    || decision.noria_contract_version !== pipeline.contract_version || !['ok', 'refused'].includes(decision.status)
    || inputStatus !== decision.status) throw new Error('COMMERCIAL_DECISION_PROVENANCE_INVALID');
  const same = ['tenant_id', 'tenant_slug', 'instance', 'remote_jid', 'session_id', 'request_id', 'turn_token']
    .every(field => String(decision[field] || '') === String(identity[field] || '') && String(identity[field] || '') !== '');
  if (!same) throw new Error('COMMERCIAL_DECISION_IDENTITY_MISMATCH');
  return decision;
}

// Visão estrita do que a decisão autoriza. Qualquer formato inesperado vira "não autorizado".
function retailAuthorized(decision) {
  const none = { present_item_ids: [], media: null, site_link: null, notify: null, handoff: null };
  if (decision?.status !== 'ok' || !retailIsObj(decision.actions)) return none;
  const a = decision.actions;
  const uuids = list => retailStrings(list).filter(id => RETAIL_UUID.test(id));
  const out = { ...none };
  if (a.present_information?.allowed === true) out.present_item_ids = [...new Set(uuids(a.present_information.item_ids))].slice(0, 3);
  const media = a.send_product_media;
  if (media?.allowed === true && RETAIL_UUID.test(String(media.item_id || ''))) {
    const assets = [...new Set(uuids(media.asset_ids))].slice(0, RETAIL_MAX_MEDIA);
    if (assets.length) out.media = { item_id: media.item_id, asset_ids: assets };
  }
  if (a.send_site_link?.allowed === true && RETAIL_UUID.test(String(a.send_site_link.item_id || ''))) out.site_link = { item_id: a.send_site_link.item_id };
  const notify = a.notify_specialist;
  if (notify?.required === true && RETAIL_SPECIALIST_REASONS.includes(notify.reason)) {
    // Frase aprovada pelo tenant para o cliente; sem link, telefone ou texto longo (vai literal na resposta).
    const message = typeof notify.customer_message === 'string' ? notify.customer_message.trim() : '';
    const safeMessage = message && message.length <= 300 && !/https?:\/\/|www\.|\d{8,}/i.test(message) ? message : null;
    out.notify = { reason: notify.reason, reasons: retailStrings(notify.reasons).filter(r => RETAIL_SPECIALIST_REASONS.includes(r)),
      materials: retailStrings(notify.materials).slice(0, 5), customer_message: safeMessage };
  }
  if (a.handoff?.required === true && typeof a.handoff.reason === 'string' && a.handoff.reason) out.handoff = { reason: a.handoff.reason };
  // Link de compra nunca acompanha o fluxo do especialista nem o handoff.
  if (out.notify || out.handoff) out.site_link = null;
  return out;
}

// ------------------------------------------------------------------- fotos do produto

// Recebe o item, os vínculos e os arquivos relidos do banco pelo motor e devolve só o que pode ser enviado.
function retailMediaPlan({ tenantId, storageOrigin, authorized, item, links, assets }) {
  const skipped = [];
  if (!authorized) return { send: [], skipped: ['NOT_AUTHORIZED'] };
  if (!retailIsObj(item) || item.id !== authorized.item_id || item.tenant_id !== tenantId) return { send: [], skipped: ['ITEM_NOT_IN_TENANT'] };
  if (item.active !== true || item.offerable !== true) return { send: [], skipped: ['ITEM_NOT_OFFERABLE'] };
  const origin = String(storageOrigin || '').replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(origin)) return { send: [], skipped: ['STORAGE_ORIGIN_INVALID'] };
  const approved = new Map((Array.isArray(links) ? links : [])
    .filter(link => link?.tenant_id === tenantId && link.item_id === item.id && link.review_status === 'aprovada')
    .map(link => [link.asset_id, link]));
  const byId = new Map((Array.isArray(assets) ? assets : []).filter(asset => asset?.tenant_id === tenantId).map(asset => [asset.id, asset]));
  const send = [];
  for (const assetId of authorized.asset_ids) {
    const link = approved.get(assetId), asset = byId.get(assetId);
    if (!link) { skipped.push('LINK_NOT_APPROVED:' + assetId); continue; }
    if (!asset) { skipped.push('ASSET_NOT_IN_TENANT:' + assetId); continue; }
    const expectedUrl = origin + '/storage/v1/object/public/' + asset.storage_bucket + '/' + asset.storage_path;
    if (!RETAIL_MEDIA_MIME[asset.mime_type] || !/^[a-f0-9]{64}$/.test(String(asset.sha256 || ''))
      || asset.public_url !== expectedUrl || !String(asset.storage_path || '').startsWith('catalog/' + tenantId + '/')) {
      skipped.push('ASSET_INVALID:' + assetId); continue;
    }
    send.push({ asset_id: asset.id, url: asset.public_url, mime_type: asset.mime_type, sha256: asset.sha256,
      display_order: link.display_order, shared_note: link.shared_note || null });
  }
  // Ordena pela exibição cadastrada e só então numera o nome do arquivo (neutro, sem nome de produto).
  send.sort((x, y) => x.display_order - y.display_order);
  return { send: send.slice(0, RETAIL_MAX_MEDIA).map((entry, index) => ({ ...entry,
    file_name: 'produto-' + (index + 1) + '.' + RETAIL_MEDIA_MIME[entry.mime_type] })), skipped };
}

// ------------------------------------------------------------------- aviso ao especialista

// Número do lead a partir do JID de telefone. LID, grupo ou broadcast não têm número utilizável.
function retailLeadPhone(remoteJid) {
  const match = /^(\d{10,15})(?::\d+)?@s\.whatsapp\.net$/.exec(String(remoteJid || ''));
  return match ? match[1] : null;
}

// Destino só vem do cadastro do tenant. Recusa número inválido ou igual ao do próprio lead.
function retailSpecialistRecipient(settings, remoteJid) {
  const cfg = retailIsObj(settings?.specialist_notification) ? settings.specialist_notification : null;
  if (!cfg || cfg.enabled === false) return { ok: false, code: 'SPECIALIST_RECIPIENT_NOT_CONFIGURED' };
  const digits = String(cfg.recipient || '').replace(/\D/g, '');
  if (!/^\d{10,15}$/.test(digits) || String(cfg.recipient || '').replace(/[\s()+-]/g, '') !== digits) return { ok: false, code: 'SPECIALIST_RECIPIENT_INVALID' };
  const lead = retailLeadPhone(remoteJid);
  if (lead && lead === digits) return { ok: false, code: 'SPECIALIST_RECIPIENT_IS_LEAD' };
  return { ok: true, number: digits };
}

// Chave de idempotência: um aviso por conversa, sessão e motivo. A conversa entra na própria chave porque a sessão inicial
// de toda conversa se chama "initial" e nem todo índice único de channel_events inclui a conversa (o da migration 003 não).
function retailSpecialistNoticeKey(sessionId, reason, chatId) {
  if (!RETAIL_SPECIALIST_REASONS.includes(reason)) throw new Error('NORIA_RETAIL_NOTICE_REASON_INVALID');
  const session = String(sessionId || '').replace(/[^A-Za-z0-9_-]/g, '');
  if (!session) throw new Error('NORIA_RETAIL_NOTICE_SESSION_INVALID');
  const chat = String(chatId || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!chat) throw new Error('NORIA_RETAIL_NOTICE_CHAT_INVALID');
  return 'specialist_notice_' + chat + '_' + session + '_' + reason;
}

const RETAIL_REASON_LABEL = {
  material_regra_propria: 'interesse em material com atendimento especializado',
  alto_padrao: 'interesse em joia de alto padrão',
  cliente_decidido: 'cliente já sabe o que quer',
};

// Resumo fiel: só fatos do catálogo, da decisão e as próprias palavras do cliente (citadas, encurtadas). Nada é inferido.
function retailSpecialistMessage({ reasons, materials, leadName, leadPhone, items, customerQuotes, template }) {
  const motive = retailStrings(reasons).filter(r => RETAIL_REASON_LABEL[r]).map(r => RETAIL_REASON_LABEL[r]).join('; ') || 'não informado';
  const product = (Array.isArray(items) ? items : []).slice(0, 3).map(item => {
    const price = Number.isSafeInteger(item?.price_cents)
      ? 'R$ ' + (item.price_cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (item.sale_unit ? ' (' + item.sale_unit + ')' : '')
      : 'preço não informado';
    return '- ' + String(item?.name || 'item sem nome') + ': ' + price;
  });
  const quotes = retailStrings(customerQuotes).slice(-3).map(text => {
    const clean = text.replace(/\s+/g, ' ').trim();
    return '- "' + (clean.length > 220 ? clean.slice(0, 217) + '...' : clean) + '"';
  });
  const fields = {
    motivo: motive,
    materiais: retailStrings(materials).join(', ') || 'não informado',
    nome: String(leadName || '').trim() || 'não informado',
    contato: leadPhone ? '+' + leadPhone : 'não disponível (verificar no NORIA)',
    produtos: product.length ? product.join('\n') : 'nenhum produto do catálogo identificado',
    mensagens: quotes.length ? quotes.join('\n') : 'não disponíveis',
  };
  const base = typeof template === 'string' && template.includes('{contato}') ? template
    : 'Novo atendimento para você no NORIA.\nMotivo: {motivo}\nMaterial: {materiais}\nCliente: {nome}\nContato: {contato}\nProdutos:\n{produtos}\nÚltimas mensagens do cliente:\n{mensagens}\nA IA continua atendendo até você clicar em Assumir no NORIA.';
  return base.replace(/\{(motivo|materiais|nome|contato|produtos|mensagens)\}/g, (_, key) => fields[key]);
}

// Classifica o retorno do provedor: só um ID de mensagem prova envio. Timeout, rede ou 5xx = resultado desconhecido.
function retailProviderOutcome(response, error) {
  if (error) {
    const status = Number(error.statusCode || error.status || error.response?.status || 0);
    if (status >= 400 && status < 500 && status !== 408 && status !== 429) return { status: 'failed', code: 'PROVIDER_HTTP_' + status };
    return { status: 'unknown', code: status ? 'PROVIDER_HTTP_' + status : 'PROVIDER_NO_RESPONSE' };
  }
  const id = response?.key?.id || response?.message?.key?.id || response?.id;
  return id ? { status: 'sent', provider_message_id: String(id) } : { status: 'unknown', code: 'PROVIDER_ID_MISSING' };
}

// Frase ao cliente sobre o especialista: só no turno em que este aviso foi reservado pela primeira vez
// (reserva duplicada = já avisado antes nesta sessão) e nunca quando a entrega ao lead foi cancelada.
function retailSpecialistCustomerLine(authorized, reservation) {
  if (!authorized?.notify?.customer_message) return null;
  return reservation?.status === 'reserved_now' ? authorized.notify.customer_message : null;
}

// Registros em channel_events da conversa do LEAD. A reserva é inserida (nunca upsert) antes da chamada ao provedor;
// se já existir, o aviso não é repetido. Nenhum registro pausa a IA (handoff=false).
function retailNoticeReservation({ tenantId, tenantSlug, chatId, sessionId, requestId, reason, reasons, materials }) {
  const key = retailSpecialistNoticeKey(sessionId, reason, chatId);
  return {
    tenant_id: tenantId, tenant_slug: tenantSlug, channel_type: 'whatsapp', external_conversation_id: chatId,
    external_message_id: key, direction: 'outbound', sender_type: 'system', message_text: '',
    service: 'specialist_notice_attempt', stage: null, handoff: false, ai_provider: 'retail_specialist_notice', delivery_status: 'internal',
    raw_payload: { contract: RETAIL_NOTICE_CONTRACT, status: 'reserved', idempotency_key: key, conversation_session_id: sessionId,
      request_id: requestId, reason, reasons: retailStrings(reasons), materials: retailStrings(materials), requires_reconciliation: true },
  };
}

function retailNoticeOutcome({ tenantId, tenantSlug, chatId, sessionId, reservationId, reason, outcome }) {
  const key = retailSpecialistNoticeKey(sessionId, reason, chatId);
  return {
    tenant_id: tenantId, tenant_slug: tenantSlug, channel_type: 'whatsapp', external_conversation_id: chatId,
    external_message_id: key + '_' + outcome.status, direction: 'outbound', sender_type: 'system',
    message_text: outcome.status === 'sent' ? 'Especialista avisado(a) por WhatsApp.' : outcome.status === 'failed'
      ? 'Falha ao avisar o(a) especialista por WhatsApp.' : 'Aviso ao especialista com resultado desconhecido; conferir antes de reenviar.',
    service: 'specialist_notice', stage: null, handoff: false, ai_provider: 'retail_specialist_notice',
    delivery_status: outcome.status === 'sent' ? 'sent' : 'internal',
    raw_payload: { contract: RETAIL_NOTICE_CONTRACT, status: outcome.status, idempotency_key: key, reservation_event_id: reservationId,
      conversation_session_id: sessionId, reason, provider_message_id: outcome.provider_message_id || null, code: outcome.code || null,
      requires_reconciliation: outcome.status === 'unknown' },
  };
}

// === fim das funções do retail_v1 projetadas no motor (o bloco abaixo só existe para os testes) ===
if (typeof module === 'object' && module && module.exports) {
  module.exports = {
    RETAIL_SEMANTIC_CONTRACT, RETAIL_SEMANTIC_RULES, RETAIL_SPECIALIST_REASONS, RETAIL_NOTICE_CONTRACT, RETAIL_PHOTO_SERVICE,
    retailSemanticSchema, retailVocabulary, retailCandidatePath, retailCandidates, retailMediaState,
    retailVerifiedDecision, retailAuthorized, retailMediaPlan, retailLeadPhone, retailSpecialistRecipient,
    retailSpecialistNoticeKey, retailSpecialistMessage, retailProviderOutcome, retailNoticeReservation, retailNoticeOutcome,
    retailSpecialistCustomerLine,
  };
}

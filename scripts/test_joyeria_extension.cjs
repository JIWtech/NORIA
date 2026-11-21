// Verificações locais (sem rede) da EXT JOYERÍA (retail_v1). Executa a fonte real via AsyncFunction com um
// httpRequest falso. Rodar: node --test scripts/test_joyeria_extension.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const code = fs.readFileSync(path.join(__dirname, '../n8n/sources/joyeria_extension.js'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const TENANT = 'aaaaaaaa-1111-4222-8333-444444444444';
const OTHER = 'bbbbbbbb-1111-4222-8333-444444444444';
const TOKEN = '7c1f0a52-3b8e-4d6a-9f21-0a5b6c7d8e9f';
const id = n => '00000000-0000-4000-8000-00000000000' + n;
const BLEND = id(1), SEMIJOIA = id(2), SEM_PRECO = id(3), DESCONHECIDO = id(4), OUTRO_TENANT = id(5);
const ASSETS = [id(6), id(7)];

// Dados sintéticos: nenhum deles aparece na fonte da EXT.
const settings = (overrides = {}) => ({
  noria_client_policy: { profile: 'retail_consultative_v1', modules: { turn_pipeline: { capability: 'retail_v1' } } },
  specialist_notification: { recipient: '5500000000000' },
  retail_policy: { specialist: { enabled: true, own_rule_materials: ['blend'], high_end_materials: ['ouro_macico', 'material_nobre'], decided_customer: true,
    customer_message: 'Frase aprovada de teste.' },
    max_photos_per_turn: 2, site_link: { enabled: true } },
  ...overrides,
});
const item = (itemId, extra) => ({ id: itemId, tenant_id: TENANT, item_code: 'c' + itemId.slice(-1), name: 'Item ' + itemId.slice(-1), category: 'x',
  material_class: 'blend', offerable: true, active: true, price_cents: 98000, currency: 'BRL', price_status: 'aprovado', sale_unit: 'par', width_mm: '2.00', site_url: null, ...extra });
const catalog = [
  item(BLEND),
  item(SEMIJOIA, { material_class: 'banhado_revestido', sale_unit: 'unidade', site_url: 'https://loja.exemplo/semijoia' }),
  item(SEM_PRECO, { offerable: false, price_status: 'nao_informado', price_cents: null }),
  item(DESCONHECIDO, { material_class: 'desconhecido', site_url: 'https://loja.exemplo/peca' }),
  { ...item(OUTRO_TENANT), tenant_id: OTHER },
];

async function run({ semantic, cfg = settings(), images = ASSETS.map((asset_id, i) => ({ asset_id, display_order: i, review_status: 'aprovada' })), extra = {} } = {}) {
  const requests = [];
  const httpRequest = async ({ url, method }) => {
    requests.push({ url, method });
    if (method !== 'GET') throw new Error('EXT só pode ler');
    if (url.includes('/tenants?')) return [{ id: TENANT, slug: 'joyeria', status: 'active' }];
    if (url.includes('/channels?')) return [{ external_id: 'joyeria', status: 'active' }];
    if (url.includes('/tenant_settings?')) return [{ settings: cfg }];
    if (url.includes('/product_catalog_items?')) {
      const ids = decodeURIComponent(/id=in\.\(([^)]*)\)/.exec(url)[1]).split(',');
      // Simula o filtro tenant_id=eq.<tenant> do banco, mas devolve também a linha estranha para provar a dupla checagem.
      return catalog.filter(row => ids.includes(row.id));
    }
    if (url.includes('/product_catalog_item_images?')) return images;
    throw new Error('requisição inesperada ' + url);
  };
  const input = {
    noria_phase: 'commercial_decision', noria_extension: 'joyeria', noria_contract_version: '1.0', tenant_id: TENANT, tenant_slug: 'joyeria',
    instance: 'joyeria', remoteJid: '5522000000000@s.whatsapp.net',
    turn: { claimed: true, tenant_slug: 'joyeria', instance: 'joyeria', token: TOKEN, boundary_id: 'initial', messages: [{ event_id: 'm1', text: 'mensagem' }] },
    noria_business_context: { session_id: 'initial', request_id: 'm1:' + TOKEN },
    session_evidence: [{ id: 'm0' }],
    semantic_intent: semantic === null ? undefined : {
      contract: 'noria_retail_semantic_intent_v1', primary_intent: 'product_inquiry', confidence: 'high', evidence_ids: ['m1'], products: [],
      material_requested: { value: 'none', evidence_ids: [] }, customer_decision: { value: 'exploring', evidence_ids: [] },
      commercial_interest: { present: false, evidence_ids: [] }, wants_photos: { requested: false, evidence_ids: [] },
      human: { requested: false, evidence_ids: [] }, exchange: { requested: false, evidence_ids: [] }, home_visit: { requested: false, evidence_ids: [] },
      conversation: { topic_change: false, requires_clarification: false }, ambiguities: [], ...semantic },
    ...extra,
  };
  const out = await new AsyncFunction('$json', '$env', code).call({ helpers: { httpRequest } }, input,
    { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'k' });
  return { d: out.json.commercial_decision, out: out.json, requests };
}
const ref = (item_id, role, evidence_ids = ['m1']) => ({ item_id, role, evidence_ids });
const on = (evidence_ids = ['m1']) => ({ present: true, requested: true, evidence_ids });

test('interesse comercial em aliança blend avisa o especialista, apresenta o item e envia fotos aprovadas, sem link do site', async () => {
  const { d, requests } = await run({ semantic: { primary_intent: 'purchase_intent', products: [ref(BLEND, 'interested')], commercial_interest: on() } });
  assert.equal(d.status, 'ok');
  assert.deepEqual(d.actions.notify_specialist, { required: true, reasons: ['material_regra_propria'], reason: 'material_regra_propria', materials: ['blend'],
    customer_message: 'Frase aprovada de teste.' });
  assert.equal(d.actions.handoff.required, false, 'aviso ao especialista não pausa a IA');
  assert.deepEqual(d.actions.present_information.item_ids, [BLEND]);
  assert.deepEqual(d.actions.send_product_media.asset_ids, ASSETS);
  assert.equal(d.actions.send_site_link.allowed, false);
  assert.equal(d.actions.send_site_link.reason, 'SPECIALIST_FLOW');
  assert.equal(d.facts[0].price_cents, 98000);
  assert.ok(requests.every(r => r.method === 'GET'));
});

test('dúvida sobre cuidados com a blend, sem interesse comercial, não avisa o especialista', async () => {
  const { d } = await run({ semantic: { primary_intent: 'care_or_warranty', products: [ref(BLEND, 'asked_about')] } });
  assert.equal(d.actions.notify_specialist.required, false);
});

test('cliente decidido em item comprável no site (semijoia) recebe o link e não aciona o especialista', async () => {
  const { d } = await run({ semantic: { primary_intent: 'purchase_intent', products: [ref(SEMIJOIA, 'selected')],
    customer_decision: { value: 'decided', evidence_ids: ['m1'] }, commercial_interest: on() } });
  assert.equal(d.actions.notify_specialist.required, false);
  assert.equal(d.actions.send_site_link.allowed, true);
});

test('comparou uma blend e escolheu a peça do site: decisão pelo escolhido (link, sem especialista)', async () => {
  const { d } = await run({ semantic: { primary_intent: 'purchase_intent', products: [ref(BLEND, 'compared'), ref(SEMIJOIA, 'selected')],
    customer_decision: { value: 'decided', evidence_ids: ['m1'] }, commercial_interest: on() } });
  assert.equal(d.actions.notify_specialist.required, false);
  assert.equal(d.actions.send_site_link.allowed, true);
  assert.equal(d.actions.send_site_link.item_id, SEMIJOIA);
  // Sem escolha, a blend comparada com interesse continua acionando o especialista.
  const sem = await run({ semantic: { primary_intent: 'purchase_intent', products: [ref(BLEND, 'compared'), ref(SEMIJOIA, 'compared')], commercial_interest: on() } });
  assert.equal(sem.d.actions.notify_specialist.required, true);
});

test('cliente decidido em item sem link de compra continua indo ao especialista', async () => {
  const { d } = await run({ semantic: { primary_intent: 'purchase_intent', products: [ref(DESCONHECIDO, 'selected')],
    customer_decision: { value: 'decided', evidence_ids: ['m1'] }, commercial_interest: on() },
    cfg: settings({ retail_policy: { specialist: { enabled: true, own_rule_materials: ['blend'], high_end_materials: ['ouro_macico'], decided_customer: true }, site_link: { enabled: false }, max_photos_per_turn: 2 } }) });
  assert.deepEqual(d.actions.notify_specialist.reasons, ['cliente_decidido']);
});

test('pós-venda lido como "decidido" (sem interesse numa compra) não avisa o especialista', async () => {
  const { d } = await run({ semantic: { primary_intent: 'care_or_warranty', material_requested: { value: 'blend', evidence_ids: ['m1'] },
    customer_decision: { value: 'decided', evidence_ids: ['m1'] } } });
  assert.equal(d.actions.notify_specialist.required, false);
});

test('pedido de ouro maciço sem produto cadastrado avisa como alto padrão', async () => {
  const { d } = await run({ semantic: { primary_intent: 'product_inquiry', material_requested: { value: 'ouro_macico', evidence_ids: ['m1'] }, commercial_interest: on() } });
  assert.deepEqual(d.actions.notify_specialist.reasons, ['alto_padrao']);
  assert.equal(d.actions.present_information.allowed, false);
});

test('peça banhada e composição desconhecida não contam como alto padrão', async () => {
  const banhada = await run({ semantic: { primary_intent: 'purchase_intent', products: [ref(SEMIJOIA, 'interested')], commercial_interest: on() } });
  assert.equal(banhada.d.actions.notify_specialist.required, false);
  const desconhecida = await run({ semantic: { primary_intent: 'purchase_intent', products: [ref(DESCONHECIDO, 'interested')], commercial_interest: on() } });
  assert.equal(desconhecida.d.actions.notify_specialist.required, false);
});

test('cliente indeciso com interesse em produto comum recebe link do site do item em foco', async () => {
  const { d } = await run({ semantic: { primary_intent: 'product_inquiry', products: [ref(SEMIJOIA, 'interested')], commercial_interest: on() } });
  assert.deepEqual(d.actions.send_site_link, { allowed: true, item_id: SEMIJOIA, reason: 'GUIDED_PURCHASE' });
});

test('item sem preço aprovado não é apresentado; item de outro tenant é descartado', async () => {
  const { d } = await run({ semantic: { products: [ref(SEM_PRECO, 'interested'), ref(OUTRO_TENANT, 'interested')], commercial_interest: on() } });
  assert.equal(d.actions.present_information.allowed, false);
  assert.ok(d.reason_codes.includes('PRODUCT_NOT_OFFERABLE'));
  assert.ok(d.reason_codes.includes('PRODUCT_REFERENCE_NOT_IN_CATALOG'));
  assert.ok(!d.products.some(p => p.item_id === OUTRO_TENANT));
});

test('comparação: o item escolhido entre dois apresentáveis recebe as fotos', async () => {
  const { d } = await run({ semantic: { primary_intent: 'product_inquiry', products: [ref(BLEND, 'selected'), ref(SEMIJOIA, 'compared')], wants_photos: on() } });
  assert.equal(d.actions.send_product_media.allowed, true);
  assert.equal(d.actions.send_product_media.item_id, BLEND);
});

test('sem imagens aprovadas não há envio de mídia', async () => {
  const { d } = await run({ semantic: { primary_intent: 'product_inquiry', products: [ref(BLEND, 'interested')], wants_photos: on() }, images: [] });
  assert.equal(d.actions.send_product_media.allowed, false);
  assert.equal(d.actions.send_product_media.reason, 'NO_APPROVED_IMAGES');
});

test('troca e pedido de humano viram handoff genérico, sem aviso ao especialista', async () => {
  const troca = await run({ semantic: { primary_intent: 'exchange_request', products: [ref(BLEND, 'interested')], exchange: on(), commercial_interest: on() } });
  assert.deepEqual(troca.d.actions.handoff, { required: true, reason: 'EXCHANGE_REQUEST' });
  assert.equal(troca.d.actions.notify_specialist.required, false);
  assert.equal(troca.d.actions.send_product_media.allowed, false);
  const humano = await run({ semantic: { primary_intent: 'human_request', human: on() } });
  assert.equal(humano.d.actions.handoff.reason, 'HUMAN_REQUESTED');
});

test('pedido de pessoa num caso de especialista avisa o especialista e também faz o handoff', async () => {
  const { d } = await run({ semantic: { primary_intent: 'human_request', products: [ref(BLEND, 'interested')], human: on(), commercial_interest: on() } });
  assert.equal(d.actions.handoff.reason, 'HUMAN_REQUESTED');
  assert.equal(d.actions.notify_specialist.required, true);
  assert.deepEqual(d.actions.notify_specialist.materials, ['blend']);
});

test('interpretação incerta não avisa, não envia foto nem link; pede esclarecimento', async () => {
  for (const extra of [{ confidence: 'low' }, { primary_intent: 'ambiguous' }, { conversation: { topic_change: false, requires_clarification: true } }, { ambiguities: [{ kind: 'product' }] }]) {
    const { d } = await run({ semantic: { primary_intent: 'purchase_intent', products: [ref(BLEND, 'interested')], commercial_interest: on(), wants_photos: on(), ...extra } });
    assert.equal(d.actions.notify_specialist.required, false, JSON.stringify(extra));
    assert.equal(d.actions.send_product_media.allowed, false, JSON.stringify(extra));
    assert.equal(d.actions.send_site_link.allowed, false, JSON.stringify(extra));
    assert.ok(d.reason_codes.includes('CLARIFICATION_REQUIRED'));
  }
});

test('fotos de um item vão uma vez por sessão: nem a apresentação nem o pedido explícito reenviam', async () => {
  const repetida = await run({ semantic: { primary_intent: 'product_inquiry', products: [ref(BLEND, 'interested')] }, extra: { retail_context: { media_sent_item_ids: [BLEND] } } });
  assert.equal(repetida.d.actions.send_product_media.allowed, false);
  assert.equal(repetida.d.actions.send_product_media.reason, 'ALREADY_SENT_IN_SESSION');
  const pedida = await run({ semantic: { primary_intent: 'product_inquiry', products: [ref(BLEND, 'interested')], wants_photos: on() }, extra: { retail_context: { media_sent_item_ids: [BLEND] } } });
  assert.equal(pedida.d.actions.send_product_media.allowed, false);
  assert.equal(pedida.d.actions.send_product_media.reason, 'ALREADY_SENT_IN_SESSION');
  const primeira = await run({ semantic: { primary_intent: 'product_inquiry', products: [ref(BLEND, 'interested')], wants_photos: on() } });
  assert.equal(primeira.d.actions.send_product_media.allowed, true);
});

test('pedido de fotos de mais de um produto: uma foto de cada, até o limite; o já enviado na sessão fica de fora', async () => {
  const two = [ref(BLEND, 'asked_about'), ref(DESCONHECIDO, 'asked_about')];
  const { d } = await run({ semantic: { primary_intent: 'product_inquiry', products: two, wants_photos: on() } });
  const media = d.actions.send_product_media;
  assert.equal(media.allowed, true);
  assert.equal(media.reason, 'PHOTOS_REQUESTED');
  assert.deepEqual(media.items.map(entry => entry.item_id), [BLEND, DESCONHECIDO]);
  assert.ok(media.items.every(entry => entry.asset_ids.length === 1));
  const partial = await run({ semantic: { primary_intent: 'product_inquiry', products: two, wants_photos: on() }, extra: { retail_context: { media_sent_item_ids: [BLEND] } } });
  assert.deepEqual(partial.d.actions.send_product_media.items.map(entry => entry.item_id), [DESCONHECIDO]);
  assert.equal(partial.d.actions.send_product_media.items[0].asset_ids.length, 2);
  // Sem pedido explícito, vários produtos não disparam fotos automáticas.
  const auto = await run({ semantic: { primary_intent: 'product_inquiry', products: two } });
  assert.equal(auto.d.actions.send_product_media.allowed, false);
});

test('material de regra própria vem da política: outro material configurado usa o mesmo motivo genérico', async () => {
  const cfg = settings();
  cfg.retail_policy.specialist.own_rule_materials = ['prata'];
  const { d } = await run({ cfg, semantic: { primary_intent: 'purchase_intent', products: [ref(BLEND, 'interested')], commercial_interest: on() } });
  assert.equal(d.actions.notify_specialist.required, false, 'blend não é mais regra própria nessa política');
});

test('frase ao cliente vem só da configuração; sem ela, o aviso segue e a falta é sinalizada', async () => {
  const cfg = settings();
  delete cfg.retail_policy.specialist.customer_message;
  const { d } = await run({ cfg, semantic: { primary_intent: 'purchase_intent', products: [ref(BLEND, 'interested')], commercial_interest: on() } });
  assert.equal(d.actions.notify_specialist.required, true);
  assert.equal(d.actions.notify_specialist.customer_message, null);
  assert.ok(d.reason_codes.includes('SPECIALIST_CUSTOMER_MESSAGE_NOT_CONFIGURED'));
});

test('visita domiciliar só encaminha com localidade; sem ela, a IA pergunta', async () => {
  const sem = await run({ semantic: { primary_intent: 'home_visit_request', home_visit: on() } });
  assert.equal(sem.d.actions.handoff.required, false);
  assert.ok(sem.d.reason_codes.includes('HOME_VISIT_LOCALITY_MISSING'));
  const com = await run({ semantic: { primary_intent: 'home_visit_request', home_visit: { requested: true, locality: 'Macaé', evidence_ids: ['m1'] } } });
  assert.deepEqual(com.d.actions.handoff, { required: true, reason: 'HOME_VISIT_REQUEST' });
});

test('política desligada ou ausente não autoriza aviso, fotos nem link (falha fechada)', async () => {
  const { d } = await run({ cfg: settings({ retail_policy: {} }),
    semantic: { primary_intent: 'purchase_intent', products: [ref(BLEND, 'interested')], commercial_interest: on(), wants_photos: on() } });
  assert.equal(d.actions.notify_specialist.required, false);
  assert.equal(d.actions.send_product_media.allowed, false);
  assert.equal(d.actions.send_site_link.allowed, false);
});

test('contrato semântico inválido ou evidência fora da sessão recusa a decisão', async () => {
  assert.equal((await run({ semantic: null })).d.status, 'refused');
  const fora = await run({ semantic: { products: [ref(BLEND, 'interested', ['m-de-outra-sessao'])] } });
  assert.equal(fora.d.status, 'refused');
  assert.ok(fora.d.reason_codes.includes('PRODUCT_EVIDENCE_OUTSIDE_SESSION'));
});

test('identidade do turno divergente ou outro tenant é rejeitada antes de ler o banco', async () => {
  // Falha vira erro estruturado (nunca exceção): o CORE recebe status 'error', recusa a decisão e fecha o turno para revisão.
  for (const [args, code] of [
    [{ semantic: {}, extra: { noria_business_context: { session_id: 'initial', request_id: 'm1:outro-token' } } }, 'JOYERIA_EXT_TURNO_INVALIDO'],
    [{ semantic: {}, extra: { tenant_slug: 'outro' } }, 'JOYERIA_EXT_TENANT_INCORRETO'],
    [{ semantic: {}, cfg: settings({ noria_client_policy: { profile: 'services_booking_v2' } }) }, 'JOYERIA_EXT_POLITICA_INCOMPATIVEL'],
  ]) {
    const { out } = await run(args);
    assert.equal(out.commercial_decision_status, 'error', code);
    assert.equal(out.commercial_decision, null);
    assert.equal(out.commercial_decision_error, code);
    assert.equal(out.noria_phase, 'finalize');
  }
});

test('a fonte da EXT não contém número de telefone, preço ou nome de produto', () => {
  assert.doesNotMatch(code, /\b55\d{10,11}\b|\b9\d{4}-?\d{4}\b/);
  assert.doesNotMatch(code, /R\$\s*\d|\b98000\b|188500|Elegance|Essence|Prisma/i);
});

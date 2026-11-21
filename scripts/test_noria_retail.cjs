// Testes locais (sem rede) das funções puras da capability retail_v1. Rodar: node --test scripts/test_noria_retail.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../n8n/sources/noria_retail.js');

const T = 'aaaaaaaa-1111-4222-8333-444444444444';
const OTHER = 'bbbbbbbb-1111-4222-8333-444444444444';
const id = n => '00000000-0000-4000-8000-0000000000' + String(n).padStart(2, '0');
const ORIGIN = 'https://proj.supabase.co';

// Vocabulário igual ao validado pela EXT JOYERÍA (lido da própria fonte da EXT, para as duas pontas não divergirem).
const extCode = fs.readFileSync(path.join(__dirname, '../n8n/sources/joyeria_extension.js'), 'utf8');
const extList = name => JSON.parse(new RegExp('const ' + name + " = (\\[[^\\]]*\\]);").exec(extCode)[1].replace(/'/g, '"').replace(/\s+/g, ' '));
const VOCAB = { intents: extList('INTENTS'), roles: extList('ROLES'), materials: extList('MATERIALS'), decisions: extList('DECISIONS'), confidence: extList('CONFIDENCE') };

test('esquema semântico usa o vocabulário declarado e restringe item_id aos candidatos', () => {
  const schema = R.retailSemanticSchema(VOCAB, [id(1), id(2)]);
  assert.deepEqual(schema.properties.primary_intent.enum, VOCAB.intents);
  assert.deepEqual(schema.properties.products.items.properties.item_id.enum, [id(1), id(2)]);
  assert.deepEqual(schema.properties.material_requested.properties.value.enum, VOCAB.materials);
  assert.ok(schema.required.includes('commercial_interest') && schema.required.includes('home_visit'));
  // Campos que a EXT lê precisam existir no esquema com o nome exato.
  for (const field of ['commercial_interest', 'wants_photos', 'human', 'exchange', 'home_visit', 'customer_decision', 'material_requested', 'conversation', 'ambiguities']) {
    assert.ok(extCode.includes("'" + field + "'") || extCode.includes('raw.' + field), 'EXT não lê ' + field);
  }
});

test('catálogo grande: item_id sem lista fechada no esquema', () => {
  const many = Array.from({ length: 200 }, (_, i) => 'c' + (i + 1));
  const schema = R.retailSemanticSchema(VOCAB, many);
  assert.equal(schema.properties.products.items.properties.item_id.enum, undefined);
  assert.equal(schema.properties.products.items.properties.item_id.type, 'STRING');
});

// ------------------------------------------------------------------- recorte do catálogo (pré-filtro)
// Catálogo genérico: 50 itens "comuns" com a mesma palavra e alguns itens com nomes próprios, larguras e variações.
const uid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const CAT = [
  ...Array.from({ length: 50 }, (_, i) => ({ item_id: uid(i + 1), name: 'Camiseta Lisa ' + (i + 1), category: 'vestuario', line: null, model: null, width_mm: null })),
  { item_id: uid(101), name: 'Pulseira Elegance 4 mm', category: 'acessorio', line: 'Premium', model: 'Elegance', width_mm: 4 },
  { item_id: uid(102), name: 'Pulseira Elegance 6 mm', category: 'acessorio', line: 'Premium', model: 'Elegance', width_mm: 6 },
  { item_id: uid(103), name: 'Pulseira Prisma 4 mm', category: 'acessorio', line: 'Premium', model: 'Prisma', width_mm: 4 },
  { item_id: uid(104), name: 'Bolsa Abaulada Couro', category: 'bolsa', line: null, model: null, width_mm: null },
  { item_id: uid(105), name: 'Bolsa Abaulada Couro', category: 'bolsa', line: null, model: null, width_mm: null },
];
const names = list => list.map(item => item.name);

test('recorte: catálogo pequeno ou recorte desligado envia tudo, com códigos curtos', () => {
  const small = R.retailCatalogShortlist(CAT.slice(48), { current: ['oi'] });
  assert.equal(small.mode, 'all');
  assert.equal(small.items.length, 7);
  assert.deepEqual(small.items.map(item => item.code), ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7']);
  const off = R.retailCatalogShortlist(CAT, { current: ['Elegance'] }, { limit: 0 });
  assert.equal(off.mode, 'all');
  assert.equal(off.items.length, CAT.length);
});

test('recorte: tolera erro de digitação e prioriza a largura citada', () => {
  const r = R.retailCatalogShortlist(CAT, { current: ['quanto custa a Eleganci de 6mm?'] });
  assert.equal(r.mode, 'match');
  assert.equal(r.items[0].item_id, uid(102));
  assert.ok(names(r.items).includes('Pulseira Elegance 4 mm'));
  assert.ok(!r.items.some(item => item.name.startsWith('Camiseta')));
  const p = R.retailCatalogShortlist(CAT, { current: ['e a Prizma de 4,0 mm?'] });
  assert.equal(p.items[0].item_id, uid(103));
});

test('recorte: largura pedida na mensagem atual traz os itens dessa largura, mesmo com outro modelo no contexto', () => {
  const r = R.retailCatalogShortlist(CAT, { current: ['e vocês têm de 6 mm?'], context: ['gostei da Prisma'] });
  assert.equal(r.mode, 'match');
  assert.ok(r.items.some(item => item.item_id === uid(102)), 'Elegance 6 mm entra pela largura');
  assert.ok(r.items.some(item => item.item_id === uid(103)), 'Prisma do contexto continua');
});

test('recorte: variações com o mesmo nome entram juntas', () => {
  const r = R.retailCatalogShortlist(CAT, { current: ['tem a bolsa abalada?'] });
  assert.equal(r.mode, 'match');
  assert.deepEqual(r.items.filter(item => item.name === 'Bolsa Abaulada Couro').map(item => item.item_id), [uid(104), uid(105)]);
});

test('recorte: contexto da sessão e itens já apresentados continuam no recorte', () => {
  const ctx = R.retailCatalogShortlist(CAT, { current: ['manda as fotos dela'], context: ['gostei da Prisma'] });
  assert.equal(ctx.mode, 'match');
  assert.equal(ctx.items[0].item_id, uid(103));
  const kept = R.retailCatalogShortlist(CAT, { current: ['e a Elegance?'] }, { keepIds: [uid(7)] });
  assert.ok(kept.items.some(item => item.item_id === uid(7)));
});

test('recorte: mensagem vaga ou só com palavra comum a muitos itens envia o catálogo inteiro', () => {
  assert.equal(R.retailCatalogShortlist(CAT, { current: ['qual o mais barato?'] }).mode, 'all');
  const common = R.retailCatalogShortlist(CAT, { current: ['tem camiseta?'] });
  assert.equal(common.mode, 'all');
  assert.equal(common.items.length, CAT.length);
});

test('recorte: nunca passa do limite da lista fechada do esquema', () => {
  // 27 itens casam com "Elegance" e 15 já foram apresentados: o total passaria de 40.
  const crowded = [...CAT, ...Array.from({ length: 25 }, (_, i) => ({ item_id: uid(200 + i), name: 'Pulseira Elegance Variante', category: 'acessorio', line: null, model: 'Elegance', width_mm: null }))];
  const keepIds = Array.from({ length: 15 }, (_, i) => uid(i + 1));
  const r = R.retailCatalogShortlist(crowded, { current: ['Elegance'] }, { keepIds });
  assert.equal(r.mode, 'match');
  assert.equal(r.items.length, R.RETAIL_ENUM_LIMIT);
  assert.ok(keepIds.every(itemId => r.items.some(item => item.item_id === itemId)));
  assert.ok(R.retailSemanticSchema(VOCAB, r.items.map(item => item.code)).properties.products.items.properties.item_id.enum);
});

test('códigos curtos voltam ao item_id; código inventado ou item fora do recorte é descartado', () => {
  const r = R.retailCatalogShortlist(CAT, { current: ['Elegance'] });
  const catalog = R.retailCatalogForModel(r.items);
  assert.ok(catalog.every(entry => /^c\d+$/.test(entry.item_id)));
  assert.ok(!JSON.stringify(catalog).includes(uid(101)));
  const code = r.items.find(item => item.item_id === uid(101)).code;
  const out = R.retailResolveProducts({ products: [{ item_id: code, role: 'selected' }, { item_id: 'c999' }, { item_id: uid(7) }, { item_id: uid(102) }, {}] }, r.items);
  assert.deepEqual(out.products, [{ item_id: uid(101), role: 'selected' }, { item_id: uid(102) }]);
  assert.equal(out.discarded_products, 3);
  assert.equal(R.retailResolveProducts(null, r.items), null);
});

test('vocabulário incompleto ou com item inválido é configuração inválida', () => {
  assert.deepEqual(R.retailVocabulary({ semantic_vocabulary: VOCAB }), VOCAB);
  assert.throws(() => R.retailVocabulary({ semantic_vocabulary: { ...VOCAB, roles: [] } }), /VOCABULARY_INVALID/);
  assert.throws(() => R.retailVocabulary({ semantic_vocabulary: { ...VOCAB, intents: ['ok', 3] } }), /VOCABULARY_INVALID/);
  assert.throws(() => R.retailVocabulary(null), /VOCABULARY_INVALID/);
});

test('candidatos: consulta filtrada por tenant, ativos e ofertáveis; descarta linha de outro tenant; detecta corte', () => {
  const p = R.retailCandidatePath(T, 2);
  assert.match(p, /tenant_id=eq\.aaaaaaaa/);
  assert.match(p, /active=eq\.true&offerable=eq\.true/);
  assert.match(p, /limit=3$/);
  assert.throws(() => R.retailCandidatePath('x'), /TENANT_INVALID/);
  const rows = [{ id: id(1), tenant_id: T, name: 'A' }, { id: id(2), tenant_id: OTHER, name: 'B' }, { id: id(3), tenant_id: T, name: 'C' }];
  const out = R.retailCandidates(rows, T, 2);
  assert.equal(out.complete, false);
  assert.deepEqual(out.items.map(i => i.item_id), [id(1), id(3)]);
  assert.equal(R.retailCandidates(rows.slice(0, 1), T, 2).complete, true);
  // 191 itens cabem inteiros no limite padrão (o CORE atual corta em 100 no catálogo de serviços).
  const many = Array.from({ length: 191 }, (_, i) => ({ id: id(i % 99 + 1).slice(0, 34) + String(i).padStart(2, '0').slice(-2), tenant_id: T, name: 'P' + i }));
  assert.equal(R.retailCandidates(many, T).complete, true);
});

test('estado das fotos: enviadas, pendentes (sem resultado ou desconhecido) e falhas, só na sessão atual', () => {
  const res = (rid, item, asset, session = 's1') => ({ id: rid, service: 'retail_product_photo_attempt', direction: 'outbound',
    raw_payload: { status: 'reserved', item_id: item, asset_id: asset, conversation_session_id: session } });
  const out = (rid, status, item, asset, session = 's1') => ({ id: 'o' + rid, service: status === 'sent' ? 'retail_product_photo' : 'retail_product_photo_attempt',
    direction: 'outbound', raw_payload: { status, reservation_event_id: rid, item_id: item, asset_id: asset, conversation_session_id: session } });
  const rows = [
    res('r1', id(1), id(11)), out('r1', 'sent', id(1), id(11)),          // enviada
    res('r2', id(2), id(12)), out('r2', 'unknown', id(2), id(12)),       // desconhecida: pendente
    res('r3', id(3), id(13)),                                            // reserva sem resultado: pendente
    res('r4', id(4), id(14)), out('r4', 'failed', id(4), id(14)),        // falha definitiva: pode tentar de novo
    res('r5', id(5), id(15), 's0'), out('r5', 'sent', id(5), id(15), 's0'), // outra sessão
    { id: 'x', service: 'sales_product_photo', direction: 'outbound', raw_payload: { status: 'sent', reservation_event_id: 'r9', item_id: id(6), conversation_session_id: 's1' } },
  ];
  const state = R.retailMediaState(rows, 's1');
  assert.deepEqual(state.sentItemIds, [id(1)]);
  assert.deepEqual(state.pendingAssetIds.sort(), [id(12), id(13)].sort());
  assert.deepEqual(state.presentedItemIds.sort(), [id(1), id(2), id(3)].sort());
  assert.ok(!state.presentedItemIds.includes(id(4)), 'falha definitiva não bloqueia nova tentativa');
});

const pipeline = { decision_contract: 'noria_retail_decision_v1', decision_provenance: 'joyeria_extension_commercial_decide_v1', contract_version: '1.0' };
const identity = { tenant_id: T, tenant_slug: 'joyeria', instance: 'joyeria', remote_jid: '5522999990000@s.whatsapp.net', session_id: 's1', request_id: 'm1:tok', turn_token: 'tok' };
const decision = (actions = {}, extra = {}) => ({ contract: pipeline.decision_contract, provenance: pipeline.decision_provenance, noria_contract_version: '1.0',
  status: 'ok', ...identity, actions, ...extra });

test('decisão só vale com contrato, proveniência e identidade do turno idênticos', () => {
  assert.ok(R.retailVerifiedDecision(decision(), 'ok', pipeline, identity));
  assert.throws(() => R.retailVerifiedDecision(decision({}, { request_id: 'm1:outro' }), 'ok', pipeline, identity), /IDENTITY_MISMATCH/);
  assert.throws(() => R.retailVerifiedDecision(decision({}, { provenance: 'x' }), 'ok', pipeline, identity), /PROVENANCE_INVALID/);
  assert.throws(() => R.retailVerifiedDecision(decision(), 'refused', pipeline, identity), /PROVENANCE_INVALID/);
  assert.throws(() => R.retailVerifiedDecision(null, 'ok', pipeline, identity), /UNAVAILABLE/);
  assert.throws(() => R.retailVerifiedDecision(null, 'error', pipeline, identity, 'LOJA_EXT_CATALOGO_INDISPONIVEL'), /^Error: LOJA_EXT_CATALOGO_INDISPONIVEL$/);
  assert.throws(() => R.retailVerifiedDecision(null, 'error', pipeline, identity, 'falha com https://x'), /^Error: COMMERCIAL_DECISION_UNAVAILABLE$/);
  assert.throws(() => R.retailVerifiedDecision(decision(), 'ok', pipeline, { ...identity, turn_token: '' }), /IDENTITY_MISMATCH/);
});

test('autorização estrita: recusada não autoriza nada; link nunca acompanha especialista ou handoff', () => {
  assert.deepEqual(R.retailAuthorized(decision({ present_information: { allowed: true, item_ids: [id(1)] } }, { status: 'refused' })).present_item_ids, []);
  const full = R.retailAuthorized(decision({
    present_information: { allowed: true, item_ids: [id(1), id(1), 'x', id(2), id(3), id(4)] },
    send_product_media: { allowed: true, item_id: id(1), asset_ids: [id(5), id(6), id(7), id(8)] },
    send_site_link: { allowed: true, item_id: id(1) },
    notify_specialist: { required: true, reason: 'material_regra_propria', reasons: ['material_regra_propria', 'inventado'], materials: ['blend'] },
  }));
  assert.deepEqual(full.present_item_ids, [id(1), id(2), id(3)]);
  assert.equal(full.media.asset_ids.length, 4);
  assert.equal(full.site_link, null);
  assert.deepEqual(full.notify.reasons, ['material_regra_propria']);
  assert.equal(R.retailAuthorized(decision({ notify_specialist: { required: true, reason: 'qualquer' } })).notify, null);
  assert.equal(R.retailAuthorized(decision({ send_site_link: { allowed: true, item_id: id(1) } })).site_link.item_id, id(1));
});

test('fotos de vários produtos: cada produto e cada foto uma vez, total limitado, item inválido descartado', () => {
  const media = R.retailAuthorized(decision({ send_product_media: { allowed: true, item_id: id(1), asset_ids: [id(5)],
    items: [{ item_id: id(1), asset_ids: [id(5)] }, { item_id: 'x', asset_ids: [id(6)] }, { item_id: id(2), asset_ids: [id(5), id(6)] },
      { item_id: id(1), asset_ids: [id(7)] }, { item_id: id(3), asset_ids: [id(8), id(9)] }] } })).media;
  assert.deepEqual(media.items, [{ item_id: id(1), asset_ids: [id(5)] }, { item_id: id(2), asset_ids: [id(6)] }, { item_id: id(3), asset_ids: [id(8), id(9)] }]);
  assert.equal(media.item_id, id(1));
});

const asset = (n, extra = {}) => {
  const storage_path = 'catalog/' + T + '/' + 'a'.repeat(63) + n + '.png';
  return { id: id(n), tenant_id: T, storage_bucket: 'product-catalog', storage_path, sha256: 'a'.repeat(63) + n, mime_type: 'image/png',
    public_url: ORIGIN + '/storage/v1/object/public/product-catalog/' + storage_path, ...extra };
};
const item = { id: id(1), tenant_id: T, active: true, offerable: true };
const link = (n, extra = {}) => ({ tenant_id: T, item_id: id(1), asset_id: id(n), review_status: 'aprovada', display_order: n, ...extra });

test('plano de mídia envia só imagens aprovadas, do tenant, com URL do Storage do projeto e MIME real', () => {
  const plan = R.retailMediaPlan({ tenantId: T, storageOrigin: ORIGIN, authorized: { item_id: id(1), asset_ids: [id(3), id(2)] }, item,
    links: [link(2), link(3)], assets: [asset(2), asset(3, { mime_type: 'image/jpeg' })] });
  assert.deepEqual(plan.send.map(s => s.asset_id), [id(2), id(3)], 'ordem de exibição');
  assert.equal(plan.send[1].mime_type, 'image/jpeg');
  assert.equal(plan.send[0].file_name, 'produto-1.png');
  assert.ok(!JSON.stringify(plan).includes('veiculo'));
});

test('plano de mídia recusa item de outro tenant, não ofertável, vínculo não aprovado, asset estranho e URL externa', () => {
  const base = { tenantId: T, storageOrigin: ORIGIN, authorized: { item_id: id(1), asset_ids: [id(2)] }, links: [link(2)], assets: [asset(2)] };
  assert.deepEqual(R.retailMediaPlan({ ...base, item: { ...item, tenant_id: OTHER } }).skipped, ['ITEM_NOT_IN_TENANT']);
  assert.deepEqual(R.retailMediaPlan({ ...base, item: { ...item, offerable: false } }).skipped, ['ITEM_NOT_OFFERABLE']);
  assert.equal(R.retailMediaPlan({ ...base, item, links: [link(2, { review_status: 'rejeitada' })] }).send.length, 0);
  assert.equal(R.retailMediaPlan({ ...base, item, assets: [asset(2, { tenant_id: OTHER })] }).send.length, 0);
  assert.equal(R.retailMediaPlan({ ...base, item, assets: [asset(2, { public_url: 'https://evil.example/x.png' })] }).send.length, 0);
  assert.equal(R.retailMediaPlan({ ...base, item, assets: [asset(2, { mime_type: 'image/gif' })] }).send.length, 0);
  assert.equal(R.retailMediaPlan({ ...base, item, storageOrigin: 'http://proj.supabase.co' }).send.length, 0);
  assert.deepEqual(R.retailMediaPlan({ ...base, item, authorized: null }).skipped, ['NOT_AUTHORIZED']);
});

test('destino do aviso só do cadastro; recusa ausente, inválido ou igual ao lead', () => {
  const lead = '5522999990000@s.whatsapp.net';
  assert.deepEqual(R.retailSpecialistRecipient({ specialist_notification: { recipient: '+55 (22) 99796-0000' } }, lead), { ok: true, number: '5522997960000' });
  assert.equal(R.retailSpecialistRecipient({ specialist_notification: { recipient: '55 22 9979x0000' } }, lead).code, 'SPECIALIST_RECIPIENT_INVALID');
  assert.equal(R.retailSpecialistRecipient({ specialist_notification: { recipient: '5522997960000', enabled: false } }, lead).code, 'SPECIALIST_RECIPIENT_NOT_CONFIGURED');
  assert.deepEqual(R.retailSpecialistRecipient({ specialist_notification: { recipient: '5522997960000' } }, lead), { ok: true, number: '5522997960000' });
  assert.equal(R.retailSpecialistRecipient({}, lead).code, 'SPECIALIST_RECIPIENT_NOT_CONFIGURED');
  assert.equal(R.retailSpecialistRecipient({ specialist_notification: { recipient: '5522999990000' } }, lead).code, 'SPECIALIST_RECIPIENT_IS_LEAD');
  assert.equal(R.retailSpecialistRecipient({ specialist_notification: { recipient: '123' } }, lead).code, 'SPECIALIST_RECIPIENT_INVALID');
  assert.equal(R.retailLeadPhone('123456789012345678@lid'), null);
  assert.equal(R.retailLeadPhone(lead), '5522999990000');
});

test('chave do aviso é por conversa, sessão e motivo: duas conversas na sessão "initial" não colidem', () => {
  const a = R.retailSpecialistNoticeKey('initial', 'alto_padrao', '5522999990000@s.whatsapp.net');
  const b = R.retailSpecialistNoticeKey('initial', 'alto_padrao', '5522888880000@s.whatsapp.net');
  assert.equal(a, 'specialist_notice_5522999990000swhatsappnet_initial');
  assert.notEqual(a, b);
  assert.equal(R.retailSpecialistNoticeKey('initial', 'cliente_decidido', '5522999990000@s.whatsapp.net'), a, 'um aviso por sessão, qualquer motivo');
  assert.throws(() => R.retailSpecialistNoticeKey('s1', 'blend', 'x@s.whatsapp.net'), /REASON_INVALID/);
  assert.throws(() => R.retailSpecialistNoticeKey('', 'alto_padrao', 'x@s.whatsapp.net'), /SESSION_INVALID/);
  assert.throws(() => R.retailSpecialistNoticeKey('s1', 'alto_padrao', ''), /CHAT_INVALID/);
});

test('mensagem ao especialista usa só fatos e citações; ausências aparecem como não informado', () => {
  const text = R.retailSpecialistMessage({ reasons: ['material_regra_propria'], materials: ['blend'], leadName: 'Ana', leadPhone: '5522999990000',
    items: [{ name: 'Aliança X 2 mm', price_cents: 98000, sale_unit: 'par' }], customerQuotes: ['quero essa  de 2mm', 'x'.repeat(300)] });
  assert.match(text, /Contato: \+5522999990000/);
  assert.match(text, /Aliança X 2 mm: R\$ 980,00 \(par\)/);
  assert.match(text, /"quero essa de 2mm"/);
  assert.match(text, /\.\.\."/);
  assert.match(text, /Assumir/);
  const empty = R.retailSpecialistMessage({ reasons: ['cliente_decidido'] });
  assert.match(empty, /Cliente: não informado/);
  assert.match(empty, /Contato: não disponível/);
  assert.match(R.retailSpecialistMessage({ reasons: [], template: 'Lead {nome} {contato}', leadName: 'B', leadPhone: '551199' }), /^Lead B \+551199$/);
});

test('resultado do provedor: só ID prova envio; timeout e 5xx são desconhecidos; 4xx definitivo é falha', () => {
  assert.deepEqual(R.retailProviderOutcome({ key: { id: 'ABC' } }), { status: 'sent', provider_message_id: 'ABC' });
  assert.equal(R.retailProviderOutcome({}).status, 'unknown');
  assert.equal(R.retailProviderOutcome(null, { code: 'ETIMEDOUT' }).status, 'unknown');
  assert.equal(R.retailProviderOutcome(null, { statusCode: 502 }).status, 'unknown');
  assert.equal(R.retailProviderOutcome(null, { statusCode: 429 }).status, 'unknown');
  assert.equal(R.retailProviderOutcome(null, { statusCode: 400 }).status, 'failed');
});

test('registros do aviso ficam na conversa do lead, não pausam a IA e usam a chave única', () => {
  const args = { tenantId: T, tenantSlug: 'joyeria', chatId: '5522999990000@s.whatsapp.net', sessionId: 's1', requestId: 'm1:tok', reason: 'alto_padrao' };
  const r = R.retailNoticeReservation({ ...args, reasons: ['alto_padrao'], materials: ['ouro_macico'] });
  assert.equal(r.external_message_id, 'specialist_notice_5522999990000swhatsappnet_s1');
  assert.equal(r.raw_payload.reason, 'alto_padrao');
  assert.equal(r.handoff, false);
  assert.equal(r.external_conversation_id, args.chatId);
  assert.ok(!JSON.stringify(r).includes('recipient'), 'número do especialista não fica no evento');
  for (const status of ['sent', 'failed', 'unknown']) {
    const o = R.retailNoticeOutcome({ ...args, reservationId: 'e1', outcome: { status, provider_message_id: status === 'sent' ? 'P' : undefined } });
    assert.equal(o.handoff, false);
    assert.equal(o.external_message_id, 'specialist_notice_5522999990000swhatsappnet_s1_' + status);
    assert.equal(o.raw_payload.requires_reconciliation, status === 'unknown');
  }
});

test('frase ao cliente: validada na autorização e dita só quando o aviso é reservado pela primeira vez', () => {
  const auth = msg => R.retailAuthorized(decision({ notify_specialist: { required: true, reason: 'alto_padrao', reasons: ['alto_padrao'], customer_message: msg } }));
  assert.equal(auth('  Frase aprovada.  ').notify.customer_message, 'Frase aprovada.');
  assert.equal(auth('veja https://x.com').notify.customer_message, null);
  assert.equal(auth('ligue 5522999990000').notify.customer_message, null);
  assert.equal(auth('x'.repeat(301)).notify.customer_message, null);
  const ok = auth('Frase aprovada.');
  assert.equal(R.retailSpecialistCustomerLine(ok, { status: 'reserved_now' }), 'Frase aprovada.');
  assert.equal(R.retailSpecialistCustomerLine(ok, { status: 'already_reserved' }), null);
  assert.equal(R.retailSpecialistCustomerLine(ok, null), null);
  assert.equal(R.retailSpecialistCustomerLine(auth(undefined), { status: 'reserved_now' }), null);
});

test('o retail_v1 do CORE é genérico: nenhum termo de um ramo de negócio (joalheria) no módulo nem nas fases do motor', () => {
  const core = fs.readFileSync(path.join(__dirname, '../n8n/sources/noria_core.js'), 'utf8');
  const start = core.indexOf('// ===================================================================== retail_v1');
  const end = core.indexOf('function sessionHandoffMessage(', start);
  assert.ok(start > 0 && end > start, 'trecho retail_v1 do motor encontrado');
  const retailCode = fs.readFileSync(path.join(__dirname, '../n8n/sources/noria_retail.js'), 'utf8') + core.slice(start, end);
  assert.doesNotMatch(retailCode, /ouro|alian[cç]a|banhad|folhead|revestid|encapad|abaulad|chanfrad|\bjoias?\b|\bblend\b|\d+ ?mm\b/i);
});

test('o módulo não conhece tenant, número, produto nem faz I/O', () => {
  const code = fs.readFileSync(path.join(__dirname, '../n8n/sources/noria_retail.js'), 'utf8');
  assert.doesNotMatch(code, /joyeria|blend|99796|99923|Elegance/i);
  assert.doesNotMatch(code, /httpRequest|fetch\(|\$env|supabaseGet|supabasePost/);
});

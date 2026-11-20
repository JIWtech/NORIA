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

test('fotos já enviadas são contadas só na sessão atual', () => {
  const history = [
    { service: 'retail_product_photo', direction: 'outbound', raw_payload: { conversation_session_id: 's1', item_id: id(1) } },
    { service: 'retail_product_photo', direction: 'outbound', raw_payload: { conversation_session_id: 's0', item_id: id(2) } },
    { service: 'sales_product_photo', direction: 'outbound', raw_payload: { conversation_session_id: 's1', item_id: id(3) } },
  ];
  assert.deepEqual(R.retailMediaSentItemIds(history, 's1'), [id(1)]);
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
  assert.equal(full.media.asset_ids.length, 3);
  assert.equal(full.site_link, null);
  assert.deepEqual(full.notify.reasons, ['material_regra_propria']);
  assert.equal(R.retailAuthorized(decision({ notify_specialist: { required: true, reason: 'qualquer' } })).notify, null);
  assert.equal(R.retailAuthorized(decision({ send_site_link: { allowed: true, item_id: id(1) } })).site_link.item_id, id(1));
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

test('chave do aviso é por sessão e motivo; motivo fora do contrato é recusado', () => {
  assert.equal(R.retailSpecialistNoticeKey('s-1', 'alto_padrao'), 'specialist_notice_s-1_alto_padrao');
  assert.throws(() => R.retailSpecialistNoticeKey('s1', 'blend'), /REASON_INVALID/);
  assert.throws(() => R.retailSpecialistNoticeKey('', 'alto_padrao'), /SESSION_INVALID/);
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
  assert.equal(r.external_message_id, 'specialist_notice_s1_alto_padrao');
  assert.equal(r.handoff, false);
  assert.equal(r.external_conversation_id, args.chatId);
  assert.ok(!JSON.stringify(r).includes('recipient'), 'número do especialista não fica no evento');
  for (const status of ['sent', 'failed', 'unknown']) {
    const o = R.retailNoticeOutcome({ ...args, reservationId: 'e1', outcome: { status, provider_message_id: status === 'sent' ? 'P' : undefined } });
    assert.equal(o.handoff, false);
    assert.equal(o.external_message_id, 'specialist_notice_s1_alto_padrao_' + status);
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

test('o módulo não conhece tenant, número, produto nem faz I/O', () => {
  const code = fs.readFileSync(path.join(__dirname, '../n8n/sources/noria_retail.js'), 'utf8');
  assert.doesNotMatch(code, /joyeria|blend|99796|99923|Elegance/i);
  assert.doesNotMatch(code, /httpRequest|fetch\(|\$env|supabaseGet|supabasePost/);
});

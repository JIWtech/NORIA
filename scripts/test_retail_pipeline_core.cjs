// Fases retail_v1 do CORE com funções REAIS do motor (região retail_v1 + funções do CORE), sem rede, banco ou Gemini.
// Rodar: node --test scripts/test_retail_pipeline_core.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../app/node_modules/typescript');
const { extractRetailRegion } = require('./lib/retail_region.cjs');

const coreCode = fs.readFileSync(path.join(__dirname, '../n8n/sources/noria_core.js'), 'utf8').replace(/\r\n/g, '\n');
const region = extractRetailRegion(coreCode);

function loadCore(names, globals, { withRegion = true } = {}) {
  const ast = ts.createSourceFile('core.js', coreCode, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const source = ast.statements.filter(ts.isFunctionDeclaration).filter(n => names.includes(n.name.text)).map(n => n.getText(ast)).join('\n');
  const keys = Object.keys(globals);
  return new Function(...keys, (withRegion ? region + '\n' : '') + source + '\nreturn {' + names.join(',') + '};')(...keys.map(key => globals[key]));
}

const T = 'aaaaaaaa-1111-4222-8333-444444444444';
const id = n => '00000000-0000-4000-8000-0000000000' + String(n).padStart(2, '0');
const VOCAB = { intents: ['product_inquiry'], roles: ['interested'], materials: ['blend', 'none'], decisions: ['decided'], confidence: ['high'] };
const retailOffered = { contract: 'noria_turn_pipeline_v1', capability: 'retail_v1', contract_version: '1.0', semantic_contract: 'sem_r', decision_contract: 'dec_r',
  decision_provenance: 'prov_r', semantic_vocabulary: VOCAB };
const retailDeclared = { enabled: true, rollout: 'all', contract: 'noria_turn_pipeline_v1', capability: 'retail_v1', contract_version: '1.0', semantic_contract: 'sem_r', decision_contract: 'dec_r', decision_provenance: 'prov_r' };
const retailPolicy = { contract: 'noria_policy_v2', profile: 'retail_consultative_v1', capability: 'standard', modules: { turn_pipeline: retailOffered } };
const servicesOffered = { ...retailOffered, capability: 'services_v1', contract_version: '2.0', semantic_vocabulary: { intents: ['a'], roles: ['b'], topics: ['c'], dispositions: ['d'], ambiguity_kinds: ['e'], confidence: ['f'] } };
const servicesDeclared = { ...retailDeclared, capability: 'services_v1', contract_version: '2.0' };
const servicesPolicy = { contract: 'noria_policy_v2', profile: 'services_booking_v2', capability: 'standard', modules: { turn_pipeline: servicesOffered } };
const PIPE = { TURN_PIPELINE_CONTRACT: 'noria_turn_pipeline_v1', TURN_PIPELINE_CAPABILITIES: ['services_v1', 'retail_v1'],
  TURN_PIPELINE_FIELDS: ['contract', 'capability', 'contract_version', 'semantic_contract', 'decision_contract', 'decision_provenance'] };
// routed=true simula o turno que o roteador marcou com noria_pipeline = 'retail_v1'.
const selector = (policy, settings, version, routed = true) => {
  const core = loadCore(['settingsFor', 'salesEnabled', 'turnPipelineFor'], { tenantBusinessRules: policy,
    inputJson: { noria_contract_version: version, ...(routed ? { noria_pipeline: 'retail_v1' } : {}) }, ...PIPE });
  return () => core.turnPipelineFor({ settings: { settings } });
};

test('etapa 2: retail_v1 é selecionado só com o perfil de venda consultiva e vocabulário próprio completo', () => {
  const pipe = selector(retailPolicy, { noria_turn_pipeline: retailDeclared }, '1.0')();
  assert.equal(pipe.capability, 'retail_v1');
  assert.deepEqual(pipe.semantic_vocabulary, VOCAB);
  assert.throws(selector({ ...retailPolicy, profile: 'services_booking_v2' }, { noria_turn_pipeline: retailDeclared }, '1.0'), /CONFIG_INVALID/, 'retail com perfil de serviços');
  assert.throws(selector({ ...servicesPolicy, profile: 'retail_consultative_v1' }, { noria_turn_pipeline: servicesDeclared }, '2.0'), /CONFIG_INVALID/, 'serviços com perfil retail');
  const incomplete = { ...retailPolicy, modules: { turn_pipeline: { ...retailOffered, semantic_vocabulary: { ...VOCAB, materials: [] } } } };
  assert.throws(selector(incomplete, { noria_turn_pipeline: retailDeclared }, '1.0'), /CONFIG_INVALID/);
  assert.equal(selector(retailPolicy, {}, '1.0')(), null, 'sem declaração continua no legado');
  assert.equal(selector(retailPolicy, { noria_turn_pipeline: retailDeclared }, '1.0', false)(), null, 'turno não roteado não entra no pipeline');
});

test('etapa 2: services_v1 continua idêntico (mesma seleção e vocabulário de serviços)', () => {
  const pipe = selector(servicesPolicy, { noria_turn_pipeline: servicesDeclared }, '2.0')();
  assert.equal(pipe.capability, 'services_v1');
  assert.deepEqual(pipe.semantic_vocabulary.topics, ['c']);
  assert.equal(selector({ contract: 'noria_policy_v2', profile: 'vehicle_sales_v1', capability: 'sales_v1', modules: {} }, { conversation_capability: 'sales_v1' }, '2.0')(), null);
});

test('auditoria da redação: preço não autorizado, link e telefone são recusados', () => {
  const { retailAuditReply } = loadCore(['retailAuditReply'], {}, { withRegion: false });
  const items = [{ price_cents: 98000 }, { price_cents: 188500 }];
  assert.deepEqual(retailAuditReply('O par sai por R$ 980,00 e o outro por R$ 1.885,00.', items), []);
  assert.deepEqual(retailAuditReply('Fica R$ 880,00.', items), ['PRICE_NOT_AUTHORIZED']);
  assert.deepEqual(retailAuditReply('Veja em https://loja.com/x', items), ['URL_NOT_ALLOWED']);
  assert.deepEqual(retailAuditReply('Chame no 22 99999-0000', items), ['PHONE_NOT_ALLOWED']);
  assert.deepEqual(retailAuditReply('Prazo de até 10 dias úteis, 2 mm.', items), []);
  assert.deepEqual(retailAuditReply('   ', items), ['EMPTY_REPLY']);
  assert.deepEqual(retailAuditReply('O link para finalizar está abaixo.', items, { linkAppended: false }), ['LINK_CLAIM_WITHOUT_LINK']);
  assert.deepEqual(retailAuditReply('Estou enviando as fotos.', items, { photosSent: false }), ['PHOTO_CLAIM_WITHOUT_PHOTO']);
  assert.deepEqual(retailAuditReply('Estou enviando as fotos e o link.', items, { linkAppended: true, photosSent: true }), []);
  for (const claim of ['Vou enviar as fotos dos dois juntos.', 'Claro, mando sim a foto.', 'A foto da Versati está chegando para você.', 'Vou reenviar a foto exclusiva.', 'Aqui estão as fotos das duas.', 'As fotos dos dois modelos vão logo abaixo.', 'Esta foto mostra a Prisma de 6 mm.']) {
    assert.deepEqual(retailAuditReply(claim, items, { photosSent: false }), ['PHOTO_CLAIM_WITHOUT_PHOTO'], claim);
  }
  assert.deepEqual(retailAuditReply('As fotos já foram enviadas aqui na conversa.', items, { photosSent: false, photosAlready: true }), []);
  assert.deepEqual(retailAuditReply('A foto já está aqui na conversa.', items, { photosSent: false, photosAlready: true }), []);
  assert.deepEqual(retailAuditReply('Vou enviar novamente a foto da Versati, e já seguimos para as medidas.', items, { photosSent: false, photosAlready: true }),
    ['PHOTO_CLAIM_WITHOUT_PHOTO']);
  assert.deepEqual(retailAuditReply('As fotos já foram enviadas aqui na conversa.', items, { photosSent: false }), ['PHOTO_CLAIM_WITHOUT_PHOTO']);
  assert.deepEqual(retailAuditReply('Gostou da foto? O modelo é lindo.', items, { photosSent: false }), []);
  assert.deepEqual(retailAuditReply('São dois modelos lindos. De qual deles você quer que eu envie a foto primeiro?', items, { photosSent: false }), []);
  assert.deepEqual(retailAuditReply('Vou enviar a foto. Qual largura prefere?', items, { photosSent: false }), ['PHOTO_CLAIM_WITHOUT_PHOTO']);
  for (const fine of ['A foto vai ser verificada com a equipe.', 'Vou verificar a foto para você.', 'O modelo vai bem no dia a dia; a foto do catálogo é ilustrativa.']) {
    assert.deepEqual(retailAuditReply(fine, items, { photosSent: false }), [], fine);
  }
  assert.deepEqual(retailAuditReply('Alguém da equipe vai continuar por aqui.', items, { teamHandoff: false }), ['TEAM_CLAIM_WITHOUT_HANDOFF']);
  assert.deepEqual(retailAuditReply('Alguém da equipe vai continuar por aqui.', items, { teamHandoff: true }), []);
  assert.deepEqual(retailAuditReply('Ola. Alguem pode ajudar voce.', items), ['ACCENT_MISSING']);
  assert.deepEqual(retailAuditReply('Olá. Essa joia é linda e a equipe confirma o valor.', items), []);
  assert.deepEqual(retailAuditReply('Não temos esses itens, só alianças.', items), ['UNAVAILABILITY_CLAIM']);
  assert.deepEqual(retailAuditReply('Nós não trabalhamos com relógios.', items), ['UNAVAILABILITY_CLAIM']);
  assert.deepEqual(retailAuditReply('São feitas sob medida: não temos pronta entrega.', items), []);
});

// ------------------------------------------------------------------- finalize com efeitos simulados
const LEAD = '5522999990000@s.whatsapp.net';
const ORIGIN = 'https://proj.supabase.co';
const ITEM = { id: id(1), tenant_id: T, name: 'Aliança Teste 2 mm', description: 'desc', price_cents: 98000, currency: 'BRL', sale_unit: 'par', width_mm: '2.00',
  material_class: 'blend', site_url: 'https://loja.exemplo/a', offerable: true, active: true, price_status: 'aprovado' };
const assetRow = n => ({ id: id(n), tenant_id: T, storage_bucket: 'product-catalog', storage_path: 'catalog/' + T + '/' + 'a'.repeat(63) + n + '.png',
  public_url: ORIGIN + '/storage/v1/object/public/product-catalog/catalog/' + T + '/' + 'a'.repeat(63) + n + '.png', sha256: 'a'.repeat(63) + n, mime_type: 'image/png' });

function finalizeHarness({ actions = {}, status = 'ok', settings = {}, notified = false, cancelled = false, replies = ['Segue o modelo, R$ 980,00 o par.'], mediaResponse = null,
  mediaHistory = [], reservationFails = false, leaseLost = false, composeError = null } = {}) {
  const log = { inserts: [], provider: [], delivered: null, completed: false, events: [], composeInputs: [] };
  const identity = { tenant_id: T, tenant_slug: 'loja', instance: 'loja', remote_jid: LEAD, session_id: 's1', request_id: 'm1:tok', turn_token: 'tok', last_event_id: 'm1' };
  const decision = { contract: 'dec_r', provenance: 'prov_r', noria_contract_version: '1.0', status, ...identity, reason_codes: [], evidence_used: ['m1'], actions };
  let replyIndex = 0;
  const globals = {
    inputJson: { commercial_decision: decision, commercial_decision_status: status, instance: 'loja', session_evidence: [{ id: 'm0', text: 'quero a blend de 2mm' }] },
    turn: { token: 'tok', messages: [{ event_id: 'm1', text: 'quero essa', name: 'Ana' }] }, chatId: LEAD, tenantSlug: 'loja', firstName: 'Ana',
    workflowStartedAtMs: Date.now() - 1000,
    pipelineIdentity: () => identity, commit: async () => true, complete: async () => { log.completed = true; },
    settingsFor: () => ({ specialist_notification: { recipient: '5522997960000' }, ...settings }),
    saveEvent: async event => { log.events.push(JSON.parse(JSON.stringify(event))); },
    sendChannelMessage: async (context, text) => { log.delivered = text; return cancelled ? { cancelled: true } : { sent: true }; },
    sessionHandoffMessage: () => 'CONTINGENCIA', servicesHasRecentBusiness: () => true, audioHistoryText: row => row.message_text || '',
    tenantBusinessHoursStatus: () => ({ configured: true, is_open: true }), cleanReplyText: text => text,
    turnFailureIsTransient: diagnostic => diagnostic.category === 'rate_limit',
    salesSafeFailureDiagnostics: error => ({ category: /RATE_LIMIT/.test(String(error?.message)) ? 'rate_limit' : 'other' }),
    servicesGeminiJson: async (context, label, input, schema, rules) => { if (composeError) throw new Error(composeError);
      log.composeInputs.push(input); (log.composeRules ||= []).push(rules);
      return { value: { reply: replies[Math.min(replyIndex++, replies.length - 1)] }, model: 'gemini-x', usage: {} }; },
    turnQueueState: async () => ({ token: leaseLost ? 'outro' : 'tok', lease_until: new Date(Date.now() + 60000).toISOString() }),
    env: name => ({ SUPABASE_URL: ORIGIN, EVOLUTION_API_URL_LOJA: 'https://evo.test', EVOLUTION_API_KEY_LOJA: 'k', EVOLUTION_INSTANCE_LOJA: 'loja' }[name] || ''),
    tenantEnvSuffix: slug => slug.toUpperCase(), encodeFilter: value => encodeURIComponent(String(value)),
    supabaseGet: async url => {
      if (url.includes('/product_catalog_items?')) return [ITEM, { ...ITEM, id: id(9), tenant_id: 'outro' }];
      if (url.includes('/product_catalog_item_images?')) return [2, 3].map(n => ({ tenant_id: T, item_id: id(1), asset_id: id(n), display_order: n, review_status: 'aprovada', shared_note: null }));
      if (url.includes('/product_catalog_assets?')) return [assetRow(2), assetRow(3)];
      if (url.includes('external_message_id=eq.specialist_notice_')) return notified ? [{ id: 'old' }] : [];
      if (url.includes('/channel_events?') && url.includes('retail_product_photo')) return mediaHistory;
      if (url.includes('/channel_events?')) return [];
      throw new Error('GET inesperado ' + url);
    },
    supabasePost: async (url, row) => {
      if (reservationFails && row.service === 'specialist_notice_attempt') throw new Error('banco indisponível');
      log.inserts.push(row); return [{ id: 'ev' + log.inserts.length, ...row }];
    },
    httpJson: async (method, url, headers, body) => {
      log.provider.push({ url, body });
      if (mediaResponse && url.includes('/sendMedia/')) return mediaResponse;
      return { key: { id: 'P' + log.provider.length } };
    },
  };
  const core = loadCore(['retailTenantPath', 'retailLoadItems', 'retailFormatPrice', 'retailAuditReply', 'retailAuditHint', 'retailComposeReply', 'retailInsertEvent', 'retailCanContinue',
    'retailEvolution', 'retailSendProductMedia', 'retailPlanProductMedia', 'retailLoadMediaState', 'retailNoticeAlreadyReserved', 'retailSendSpecialistNotice', 'runRetailTurnFinalize', 'salesMediaHttpsLocation'], globals);
  const pipeline = { contract: 'noria_turn_pipeline_v1', contract_version: '1.0', decision_contract: 'dec_r', decision_provenance: 'prov_r' };
  return { run: () => core.runRetailTurnFinalize({ tenant: { id: T } }, pipeline, [], { raw_payload: {} }, {}), log };
}
const notifyAction = { notify_specialist: { required: true, reason: 'material_regra_propria', reasons: ['material_regra_propria'], materials: ['blend'], customer_message: 'Uma frase aprovada.' } };
const present = { present_information: { allowed: true, item_ids: [id(1)] } };

test('caso de especialista: resposta com a frase aprovada uma vez, reserva antes do envio ao número do cadastro, IA não pausada', async () => {
  const h = finalizeHarness({ actions: { ...present, ...notifyAction } });
  const result = await h.run();
  assert.match(h.log.delivered, /R\$ 980,00/);
  assert.equal(h.log.delivered.split('Uma frase aprovada.').length - 1, 1);
  assert.equal(h.log.events[0].handoff, undefined, 'evento do turno sem handoff');
  const notice = h.log.provider.find(p => p.url.includes('/sendText/'));
  assert.equal(notice.body.number, '5522997960000');
  assert.match(notice.body.text, /\+5522999990000/);
  const reservationIndex = h.log.inserts.findIndex(row => row.service === 'specialist_notice_attempt');
  assert.ok(reservationIndex >= 0 && h.log.inserts.every(row => row.handoff === false));
  assert.equal(h.log.inserts[reservationIndex].external_message_id, 'specialist_notice_5522999990000swhatsappnet_s1');
  assert.equal(result.retail_execution.notice.status, 'sent');
  assert.ok(h.log.completed);
});

test('especialista já avisado na sessão: sem frase e sem novo envio', async () => {
  const h = finalizeHarness({ actions: { ...present, ...notifyAction }, notified: true });
  await h.run();
  assert.doesNotMatch(h.log.delivered, /Uma frase aprovada/);
  assert.equal(h.log.provider.filter(p => p.url.includes('/sendText/')).length, 0);
});

test('destino igual ao lead ou ausente: não promete especialista nem envia', async () => {
  for (const settings of [{ specialist_notification: { recipient: '5522999990000' } }, { specialist_notification: null }]) {
    const h = finalizeHarness({ actions: { ...present, ...notifyAction }, settings });
    const result = await h.run();
    assert.doesNotMatch(h.log.delivered, /Uma frase aprovada/);
    assert.equal(h.log.provider.length, 0);
    assert.equal(result.retail_execution.notice.status, 'not_configured');
  }
});

test('entrega ao lead cancelada (Assumir ou novo lote): nenhuma foto e nenhum aviso', async () => {
  const h = finalizeHarness({ actions: { ...present, ...notifyAction, send_product_media: { allowed: true, item_id: id(1), asset_ids: [id(2)] } }, cancelled: true });
  await h.run();
  assert.equal(h.log.provider.length, 0);
  assert.equal(h.log.inserts.length, 0);
});

test('fotos: reserva por foto, MIME real e nome neutro, só do tenant, depois do texto', async () => {
  const h = finalizeHarness({ actions: { ...present, send_product_media: { allowed: true, item_id: id(1), asset_ids: [id(3), id(2)] } } });
  const result = await h.run();
  const media = h.log.provider.filter(p => p.url.includes('/sendMedia/'));
  assert.equal(media.length, 2);
  assert.deepEqual(media.map(m => [m.body.mimetype, m.body.fileName]), [['image/png', 'produto-1.png'], ['image/png', 'produto-2.png']]);
  assert.ok(!JSON.stringify(media).includes('veiculo'));
  assert.equal(result.retail_execution.media.sent, 2);
  assert.equal(h.log.inserts.filter(row => row.service === 'retail_product_photo_attempt').length, 2);
  assert.equal(h.log.inserts.filter(row => row.service === 'retail_product_photo').length, 2);
});

test('foto com resultado desconhecido fica interna, não aparece como enviada e interrompe as próximas', async () => {
  // Provedor responde sem ID de mensagem = resultado desconhecido (pode ter sido entregue).
  const h = finalizeHarness({ actions: { ...present, send_product_media: { allowed: true, item_id: id(1), asset_ids: [id(2), id(3)] } }, mediaResponse: {} });
  const out = await h.run();
  assert.equal(out.retail_execution.media.status, 'stopped_unknown');
  assert.equal(h.log.provider.filter(p => p.url.includes('/sendMedia/')).length, 1, 'não tenta a segunda foto');
  assert.equal(h.log.inserts.filter(row => row.service === 'retail_product_photo').length, 0);
  const internal = h.log.inserts.filter(row => row.service === 'retail_product_photo_attempt');
  assert.equal(internal.length, 2, 'reserva + resultado desconhecido, ambos internos');
  assert.ok(internal.every(row => row.sender_type === 'system' && row.delivery_status === 'internal'));
  assert.equal(internal[1].raw_payload.requires_reconciliation, true);
});

test('foto pendente de reconciliação em turno anterior não é reenviada nem anunciada no texto', async () => {
  const pending = [{ id: 'r1', service: 'retail_product_photo_attempt', direction: 'outbound',
    raw_payload: { status: 'reserved', item_id: id(1), asset_id: id(2), conversation_session_id: 's1' } },
  { id: 'o1', service: 'retail_product_photo_attempt', direction: 'outbound',
    raw_payload: { status: 'unknown', reservation_event_id: 'r1', item_id: id(1), asset_id: id(2), conversation_session_id: 's1' } }];
  const h = finalizeHarness({ actions: { ...present, send_product_media: { allowed: true, item_id: id(1), asset_ids: [id(2)] } }, mediaHistory: pending });
  const out = await h.run();
  assert.equal(h.log.provider.filter(p => p.url.includes('/sendMedia/')).length, 0);
  assert.equal(h.log.composeInputs[0].photos_being_sent, null, 'texto não anuncia foto que não sairá');
  assert.equal(out.retail_execution.media.status, 'not_sent');
  assert.deepEqual(out.retail_execution.media.skipped, ['PENDING_RECONCILIATION:' + id(2)]);
  // A outra foto do mesmo item, sem pendência, continua elegível.
  const h2 = finalizeHarness({ actions: { ...present, send_product_media: { allowed: true, item_id: id(1), asset_ids: [id(2), id(3)] } }, mediaHistory: pending });
  await h2.run();
  assert.equal(h2.log.provider.filter(p => p.url.includes('/sendMedia/')).length, 1);
  assert.equal(h2.log.composeInputs[0].photos_being_sent.count, 1);
});

test('falha de banco ao reservar o aviso fica registrada como falha (visível no painel), sem envio', async () => {
  const h = finalizeHarness({ actions: { ...present, ...notifyAction }, reservationFails: true });
  const out = await h.run();
  assert.equal(out.retail_execution.notice.status, 'failed');
  assert.equal(h.log.provider.filter(p => p.url.includes('/sendText/')).length, 0);
  const failure = h.log.inserts.find(row => row.service === 'specialist_notice');
  assert.equal(failure.raw_payload.status, 'failed');
  assert.equal(failure.raw_payload.code, 'NOTICE_RESERVATION_FAILED');
});

test('link do site anexado pelo sistema; decisão recusada e auditoria reprovada viram contingência sem efeitos', async () => {
  const link = finalizeHarness({ actions: { ...present, send_site_link: { allowed: true, item_id: id(1) } }, replies: ['Ótima escolha, R$ 980,00 o par.'] });
  await link.run();
  assert.match(link.log.delivered, /https:\/\/loja\.exemplo\/a$/);
  const refused = finalizeHarness({ actions: { ...present, ...notifyAction }, status: 'refused' });
  await refused.run();
  assert.equal(refused.log.delivered, 'CONTINGENCIA');
  assert.equal(refused.log.provider.length, 0);
  assert.equal(refused.log.events[0].handoff, true);
  const bad = finalizeHarness({ actions: { ...present, ...notifyAction }, replies: ['Sai por R$ 880,00.', 'Agora R$ 700,00.'] });
  const result = await bad.run();
  assert.equal(bad.log.delivered, 'CONTINGENCIA');
  assert.equal(bad.log.provider.length, 0);
  assert.match(bad.log.events[0].ai_error, /RETAIL_AUDIT_FAILED/);
  assert.equal(result.retail_execution.handoff.executed, true);
  const fixed = finalizeHarness({ actions: { ...present }, replies: ['Sai por R$ 880,00.', 'Sai por R$ 980,00 o par.'] });
  await fixed.run();
  assert.match(fixed.log.delivered, /R\$ 980,00/);
});

test('handoff genérico pausa a IA (evento com handoff) e não envia fotos', async () => {
  const h = finalizeHarness({ actions: { handoff: { required: true, reason: 'EXCHANGE_REQUEST' }, send_product_media: { allowed: true, item_id: id(1), asset_ids: [id(2)] } },
    replies: ['Alguém da equipe vai continuar por aqui.'] });
  await h.run();
  assert.equal(h.log.events[0].handoff, true);
  assert.equal(h.log.provider.filter(p => p.url.includes('/sendMedia/')).length, 0);
});

test('revisão da redação explica a falha em português e cita a versão anterior; persistindo só falha suave, a resposta segue', async () => {
  const h = finalizeHarness({ actions: present, replies: ['Não temos esse modelo, R$ 980,00 o par.', 'Vou verificar esse modelo, R$ 980,00 o par.'] });
  await h.run();
  assert.match(h.log.delivered, /^Vou verificar esse modelo/);
  const revision = h.log.composeRules[1].at(-1);
  assert.match(revision, /não afirme que o negócio não tem/);
  assert.match(revision, /Não temos esse modelo/);
  const stubborn = finalizeHarness({ actions: present, replies: ['Não temos esse modelo, R$ 980,00 o par.'] });
  await stubborn.run();
  assert.match(stubborn.log.delivered, /^Não temos esse modelo/);
});

test('EXT com erro estruturado: o finalize recusa antes de qualquer efeito (o CORE fecha o turno para revisão)', async () => {
  const h = finalizeHarness({ status: 'error', actions: present });
  await assert.rejects(h.run(), /COMMERCIAL_DECISION_UNAVAILABLE/);
  assert.equal(h.log.delivered, null);
  assert.equal(h.log.provider.length, 0);
  assert.equal(h.log.inserts.length, 0);
});

test('áudio que não pode ser transcrito no retail: avisa a cliente, chama a equipe e fecha o turno (não derruba)', async () => {
  const log = { sent: [], events: [], completed: null };
  const core = loadCore(['runRetailTurnPrepare'], {
    normalized: 'oi', turn: { messages: [{ event_id: 'm1', text: '[audio]' }] }, chatId: '5522999990000@s.whatsapp.net',
    pipelineIdentity: () => ({ session_id: 's1' }), settingsFor: () => ({ ai_enabled: true, whatsapp_audio_enabled: false }),
    transcribeTurnAudio: async () => { throw new Error('audio_disabled_for_tenant'); },
    commit: async () => true, saveEvent: async event => { log.events.push({ ...event }); }, recordTeamReviewWithoutTransfer: () => {},
    composeMediaNotice: async (context, history, kind, fallback) => fallback,
    sendChannelMessage: async (context, text) => { log.sent.push(text); return { sent: true }; },
    complete: async status => { log.completed = status; }, servicesTerminal: value => ({ ...value, noria_terminal: true }),
    usageGate: () => { throw new Error('não deveria seguir'); },
  });
  const result = await core.runRetailTurnPrepare({ tenant: { id: 't' } }, {}, [], { raw_payload: {} }, {});
  assert.equal(result.noria_terminal, true);
  assert.equal(result.handoff, true);
  assert.equal(log.completed, 'done');
  assert.match(log.sent[0], /Recebi seu áudio/);
  assert.equal(log.events[0].ai_provider, 'audio_handoff');
});

test('falha passageira do Gemini na interpretação retail volta para a fila; falha definitiva segue para a EXT recusar', async () => {
  const build = transient => loadCore(['runRetailTurnPrepare'], {
    normalized: 'oi', turn: { messages: [{ event_id: 'm1', text: 'quero a prisma' }] }, chatId: '5522999990000@s.whatsapp.net',
    tenantSlug: 'loja', tenantBusinessRules: {}, inputJson: { noria_extension: 'loja' }, RETAIL_DEFAULT_CANDIDATES: 250,
    pipelineIdentity: () => ({ session_id: 's1', tenant_id: T, instance: 'loja', request_id: 'm1:tok', turn_token: 'tok' }),
    settingsFor: () => ({ ai_enabled: true }), transcribeTurnAudio: async () => {}, usageGate: () => ({ allowed: true }),
    supabaseGet: async () => [], retailLoadMediaState: async () => ({ presentedItemIds: [] }), audioHistoryText: row => row.message_text || '',
    servicesGeminiJson: async () => { throw new Error(transient ? 'GEMINI_RATE_LIMIT' : 'GEMINI_SCHEMA_REJECTED'); },
    salesSafeFailureDiagnostics: () => ({ category: transient ? 'rate_limit' : 'invalid_request' }),
    turnFailureIsTransient: diagnostic => diagnostic.category === 'rate_limit',
  });
  const pipeline = { semantic_vocabulary: { intents: ['x'], roles: ['x'], materials: ['x'], decisions: ['x'], confidence: ['x'] }, semantic_contract: 'c', contract_version: '1.0' };
  await assert.rejects(build(true).runRetailTurnPrepare({ tenant: { id: T } }, pipeline, [], { raw_payload: {} }, {}), /GEMINI_RATE_LIMIT/);
  const out = await build(false).runRetailTurnPrepare({ tenant: { id: T } }, pipeline, [], { raw_payload: {} }, {});
  assert.equal(out.semantic_intent, null);
  assert.match(out.semantic_failure, /GEMINI_SCHEMA_REJECTED/);
});

test('turno que perdeu a vez não reserva o aviso ao especialista (a sessão não fica travada)', async () => {
  const h = finalizeHarness({ actions: { ...present, ...notifyAction }, leaseLost: true });
  const result = await h.run();
  assert.equal(h.log.inserts.filter(row => String(row.service || '').startsWith('specialist_notice')).length, 0);
  assert.equal(h.log.provider.filter(p => p.url.includes('/sendText/')).length, 0);
  assert.equal(result.retail_execution?.notice?.status ?? 'stopped_control_changed', 'stopped_control_changed');
});

test('conferência de fotos: 15 frases reais (revisão do Gemini) e casos anteriores', () => {
  const { retailAuditReply } = loadCore(['retailAuditReply'], {}, { withRegion: false });
  const claim = (text, opts = {}) => retailAuditReply(text, [], { photosSent: false, ...opts }).includes('PHOTO_CLAIM_WITHOUT_PHOTO');
  // Com foto saindo neste turno, nada é barrado.
  assert.equal(claim('Seguem as fotos logo abaixo para você ver a delicadeza do modelo.', { photosSent: true }), false);
  assert.equal(claim('Esta foto mostra o modelo Prisma chanfrado.', { photosSent: true }), false);
  // Sem foto: permitidos.
  for (const text of [
    'Temos a Classic e a Versati em 4 mm. De qual modelo você quer que eu envie a foto primeiro?',
    'A foto desse modelo vai ser verificada pela equipe para você.',
    'As alianças em ouro maciço são feitas sob consulta, por isso não consigo enviar fotos delas por aqui.',
    'Para a equipe avaliar o ajuste da sua peça, você pode enviar uma foto dela por aqui mesmo.',
    'Nessa foto que você mandou o acabamento é reto chanfrado, muito próximo da nossa linha Prisma.',
    'Vou verificar a foto para você.',
    'Claro, quer que eu envie a foto da Elegance?',
  ]) assert.equal(claim(text), false, text);
  for (const text of [
    'As fotos da aliança Elegance de 6 mm já estão aí na conversa para você conferir o friso lateral.',
    'Sim, nessa foto da aliança Prisma você consegue ver o brilho do chanfrado nas bordas.',
    'As fotos da aliança Harmony de 3 mm já te foram enviadas logo acima na conversa.',
  ]) assert.equal(claim(text, { photosAlready: true }), false, text);
  // Sem foto: promessas que precisam ser barradas.
  for (const text of [
    'Vou te enviar as fotos da aliança Elegance agora mesmo, você prefere ver a de 4 mm ou a de 6 mm?',
    'Seguem logo abaixo as imagens para você ver a presença dela na mão.',
    'Vou te mostrar as fotos da aliança Classic de 5 mm logo abaixo para ajudar na escolha do casal.',
    'Veja nas fotos abaixo o acabamento reto e polido da peça.',
    'As fotos da aliança Essence de 3 mm vão agora na sequência para você comparar a largura.',
    'Esta foto mostra a Prisma de 6 mm.',
    'Vou enviar as fotos dos dois juntos.',
  ]) assert.equal(claim(text), true, text);
  assert.equal(claim('Vou enviar novamente a foto da Versati, e já seguimos para as medidas.', { photosAlready: true }), true);
});

test('plano de fotos permite promessa futura, mas não afirma envio concluído', () => {
  const { retailAuditReply } = loadCore(['retailAuditReply'], {}, { withRegion: false });
  const audit = text => retailAuditReply(text, [], { photosSent: false, photosPlanned: true });
  for (const text of ['Enviei a foto.', 'Mandei as fotos.', 'Segue a foto.', 'Já encaminhei as fotos.', 'Aqui estão as fotos.'])
    assert.ok(audit(text).includes('PHOTO_CLAIM_WITHOUT_PHOTO'), text);
  assert.deepEqual(audit('Vou enviar as fotos.'), []);
});

test('finalização revisa afirmação prematura antes de tentar enviar fotos', async () => {
  const h = finalizeHarness({ actions: { ...present, send_product_media: { allowed: true, item_id: id(1), asset_ids: [id(2)] } },
    replies: ['Enviei a foto.', 'Vou enviar a foto.'], mediaResponse: {} });
  const result = await h.run();
  assert.equal(h.log.composeInputs.length, 2);
  assert.equal(h.log.delivered, 'Vou enviar a foto.');
  assert.equal(result.retail_execution.media.status, 'stopped_unknown');
});

test('redação com falha passageira volta para a fila sem gravar nem enviar; falha definitiva vira contingência', async () => {
  const transient = finalizeHarness({ actions: present, composeError: 'GEMINI_RATE_LIMIT' });
  await assert.rejects(transient.run(), /GEMINI_RATE_LIMIT/);
  assert.equal(transient.log.delivered, null);
  assert.equal(transient.log.events.length, 0);
  const definitive = finalizeHarness({ actions: present, composeError: 'GEMINI_SCHEMA_REJECTED' });
  await definitive.run();
  assert.equal(definitive.log.delivered, 'CONTINGENCIA');
  assert.equal(definitive.log.events[0].handoff, true);
});

// Proteção contra contato automático e laço de respostas nos pipelines em fases (retail_v1 e services_v1).
// Caso real: em 25/11 a IA da Joyería respondeu 250 vezes ao robô de atendimento de uma operadora em 1h40.
// Usa as funções REAIS do motor, sem rede, banco ou Gemini. Rodar: node --test scripts/test_pipeline_contact_guard.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../app/node_modules/typescript');
const { extractRetailRegion } = require('./lib/retail_region.cjs');

const coreCode = fs.readFileSync(path.join(__dirname, '../n8n/sources/noria_core.js'), 'utf8').replace(/\r\n/g, '\n');
const region = extractRetailRegion(coreCode);

function loadCore(names, globals) {
  const ast = ts.createSourceFile('core.js', coreCode, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const found = ast.statements.filter(ts.isFunctionDeclaration).filter(n => names.includes(n.name.text));
  assert.equal(found.length, names.length, 'funções ausentes no motor: ' + names.filter(n => !found.some(f => f.name.text === n)).join(', '));
  const source = found.map(n => n.getText(ast)).join('\n');
  const keys = Object.keys(globals);
  return new Function(...keys, region + '\n' + source + '\nreturn {' + names.join(',') + '};')(...keys.map(key => globals[key]));
}

const T = 'aaaaaaaa-1111-4222-8333-444444444444';
const CHAT = '5511999910621@s.whatsapp.net';
const normalizeText = value => String(value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const BOT_MESSAGES = [
  { event_id: 'm1', text: 'Olá, eu sou da Claro e este é o nosso canal oficial no WhatsApp. A chance de regularizar a linha está encerrando.', raw: { content_type: 'text' } },
  { event_id: 'm2', text: 'Acessar o site Minha Claro', raw: { content_type: 'buttons' } },
];
const automated = (ids = ['m1', 'm2'], extra = {}) => ({ kind: 'external_automated_contact', other_business: 'Claro', evidence_ids: ids,
  quoted_or_forwarded: false, contains_customer_request: false, ...extra });
const customer = { kind: 'customer', other_business: '', evidence_ids: [], quoted_or_forwarded: false, contains_customer_request: true };

const RETAIL_PIPE = { capability: 'retail_v1', contract_version: '1.0', semantic_contract: 'sem_r',
  semantic_vocabulary: { intents: ['product_inquiry'], roles: ['interested'], materials: ['none'], decisions: ['decided'], confidence: ['high'] } };
const SERVICES_PIPE = { capability: 'services_v1', contract_version: '2.0', semantic_contract: 'sem_s',
  semantic_vocabulary: { intents: ['a'], roles: ['b'], topics: ['c'], dispositions: ['d'], ambiguity_kinds: ['e'], confidence: ['f'] } };

const MOTOR = ['groundingAutomatedContactVerdict', 'ignoreAutomatedContact', 'pipelineWithContactContext', 'pipelineSemanticMessage',
  'pipelineLoopGuardConfig', 'pipelineLoopGuardTrip', 'pipelineStopForLoopGuard', 'pipelineContactRepetition', 'pipelineAutomatedContact',
  'pipelineRecentlyIgnoredBusinesses'];
const minutesAgo = n => new Date(Date.now() - n * 60000).toISOString();
// Histórico com o robô repetindo dois textos de menu (como em 25/11) e as respostas da IA no meio.
const LOGIN = 'Claro\nPara fazer login, clique no link abaixo ⬇️';
const MENU = 'Identifiquei que você ainda não fez o login, você prefere: 1- Tentar fazer o login novamente 2- Ajuda com cadastro/senha 3- Voltar para o Menu';
const botHistory = (count, startMinutes = 20) => Array.from({ length: count }, (_, i) => [
  { id: 'h' + i, direction: 'inbound', sender_type: 'contact', message_text: i % 2 ? MENU : LOGIN, created_at: minutesAgo(startMinutes - i) },
  { id: 'a' + i, direction: 'outbound', sender_type: 'assistant', message_text: 'Que alegria! Você busca alianças?', created_at: minutesAgo(startMinutes - i) },
]).flat();

// recent: respostas da IA que a consulta de contagem devolve (o banco aplica a janela; aqui só importa a quantidade e o filtro).
function harness(kind, { semanticValue, recent = 0, settings = {}, history = [], messages = BOT_MESSAGES, geminiError = null } = {}) {
  const log = { sent: [], events: [], completed: null, rpc: [], gemini: [], gets: [] };
  const globals = {
    normalized: 'oi', turn: { messages, token: 'tok-1' }, chatId: CHAT, tenantSlug: 'loja', tenantBusinessRules: {},
    inputJson: { noria_extension: 'loja', tenant_id: T }, RETAIL_DEFAULT_CANDIDATES: 250,
    SERVICES_SEMANTIC_RULES: ['regra de serviços'], normalizeText,
    pipelineIdentity: () => ({ session_id: 's1', tenant_id: T, instance: 'loja', request_id: 'm1:tok-1', turn_token: 'tok-1' }),
    settingsFor: () => ({ ai_enabled: true, ai_model: 'gemini-fixture', ...settings }), transcribeTurnAudio: async () => {}, usageGate: () => ({ allowed: true }),
    encodeFilter: value => encodeURIComponent(String(value)),
    supabaseGet: async url => {
      log.gets.push(url);
      if (url.startsWith('/rest/v1/channel_events')) return Array.from({ length: recent }, (_, i) => ({ id: 'a' + i }));
      return [];
    },
    supabasePost: async (url, body) => { log.rpc.push({ url, body }); return { contract: 'noria_semantic_contact_ignore_v1', finished: true, outcome: 'done' }; },
    retailLoadMediaState: async () => ({ presentedItemIds: [] }), audioHistoryText: row => row.message_text || '',
    loadCatalogContext: async () => ({ matches: [{ external_id: 'svc1', name: 'Serviço' }] }), servicesLoadReservations: async () => [],
    servicesPaymentCommand: () => null, buildDateContext: () => ({}), servicesMessageLocalDate: () => '2026-11-25', turnAdContext: () => null,
    servicesGeminiJson: async (context, label, input, schema, rules, options = {}) => {
      log.gemini.push({ label, input, schema, rules });
      if (geminiError) throw new Error(geminiError);
      return { value: semanticValue, model: options.model || 'gemini-fixture', usage: { totalTokenCount: 10 } };
    },
    salesSafeFailureDiagnostics: () => ({ category: 'invalid_request' }), turnFailureIsTransient: () => false,
    commit: async () => true, saveEvent: async event => { log.events.push(JSON.parse(JSON.stringify(event))); },
    complete: async status => { log.completed = status; },
    sendChannelMessage: async (context, text) => { log.sent.push(text); return { sent: true }; },
    servicesTerminal: value => ({ ...value, noria_terminal: true }),
    sessionHandoffMessage: () => 'Recebi sua mensagem e deixei seu atendimento encaminhado para a equipe.',
    turnFinished: false,
  };
  const fn = kind === 'retail' ? 'runRetailTurnPrepare' : 'runServicesTurnPrepare';
  const core = loadCore([fn, 'servicesSemanticSchema', ...MOTOR], globals);
  const pipeline = kind === 'retail' ? RETAIL_PIPE : SERVICES_PIPE;
  return { log, run: () => core[fn]({ tenant: { id: T, name: 'JOYERÍA' } }, pipeline, history, { raw_payload: {} }, {}) };
}

const retailValue = contact => ({ primary_intent: 'product_inquiry', confidence: 'high', evidence_ids: ['m1'], products: [], material_requested: { value: 'none', evidence_ids: [] },
  customer_decision: { value: 'decided', evidence_ids: [] }, commercial_interest: { present: false, evidence_ids: [] }, wants_photos: { requested: false, evidence_ids: [] },
  human: { requested: false, evidence_ids: [] }, exchange: { requested: false, evidence_ids: [] }, home_visit: { requested: false, locality: '', evidence_ids: [] },
  conversation: { topic_change: false, requires_clarification: false }, ambiguities: [], contact_context: contact });
const servicesValue = contact => ({ primary_intent: 'a', secondary_intents: [], evidence_ids: ['m1'], confidence: 'f', services: [], info_requests: [],
  slots: { unit_id: '', date: '', time: '', customer_name: '', evidence_ids: [], name_evidence_ids: [] }, payment: { declared: false, evidence_ids: [] },
  human: { requested: false, evidence_ids: [] }, conversation: { topic_change: false, requires_clarification: false, intent_correction: { corrects_previous: false, evidence_ids: [] } },
  customer_disposition: { value: 'd', evidence_ids: [] }, ambiguities: [], contact_context: contact });

for (const kind of ['retail', 'services']) {
  const value = kind === 'retail' ? retailValue : servicesValue;

  test(`${kind}: robô de outra empresa é ignorado na própria interpretação, sem resposta e sem seguir para a EXT`, async () => {
    const h = harness(kind, { semanticValue: value(automated()) });
    const out = await h.run();
    assert.equal(out.noria_terminal, true);
    assert.equal(out.reason, 'automated_contact_ignored');
    assert.equal(out.semantic_intent, undefined, 'nada vai para a decisão comercial');
    assert.deepEqual(h.log.sent, [], 'nenhuma mensagem ao contato');
    assert.equal(h.log.gemini.length, 1, 'uma única chamada: a interpretação que já existia');
    assert.equal(h.log.rpc.length, 1);
    assert.equal(h.log.rpc[0].url, '/rest/v1/rpc/magia_ignore_automated_turn');
    assert.equal(h.log.rpc[0].body.p_tenant, T);
    assert.equal(h.log.rpc[0].body.p_chat, CHAT);
    assert.equal(h.log.rpc[0].body.p_token, 'tok-1');
    assert.equal(h.log.rpc[0].body.p_proof.other_business, 'Claro');
  });

  test(`${kind}: a interpretação pede contact_context e recebe o formato técnico de cada mensagem atual`, async () => {
    const h = harness(kind, { semanticValue: value(customer) });
    await h.run();
    const call = h.log.gemini[0];
    assert.ok(call.schema.required.includes('contact_context'));
    assert.deepEqual(call.schema.properties.contact_context.properties.kind.enum, ['customer', 'external_automated_contact', 'uncertain']);
    assert.ok(call.rules.some(rule => /contact_context/.test(rule)), 'regra de leitura do contact_context presente');
    const current = call.input.customer_messages.filter(m => m.scope === 'current');
    assert.deepEqual(current.map(m => m.content_type), ['text', 'buttons']);
  });

  test(`${kind}: cliente real segue o fluxo normal e o contact_context não vaza para a EXT`, async () => {
    const h = harness(kind, { semanticValue: value(customer) });
    const out = await h.run();
    assert.equal(out.noria_terminal, undefined);
    assert.equal(out.noria_phase, 'commercial_decision');
    assert.ok(out.semantic_intent);
    assert.equal('contact_context' in out.semantic_intent, false);
    assert.deepEqual(h.log.rpc, []);
  });

  test(`${kind}: veredito incompleto não ignora (mensagem sem evidência, encaminhada, com pedido ou empresa ausente do texto)`, async () => {
    for (const contact of [automated(['m1']), automated(['m1', 'm2'], { quoted_or_forwarded: true }), automated(['m1', 'm2'], { contains_customer_request: true }),
      automated(['m1', 'm2'], { other_business: 'Operadora X' }), automated(['m1', 'm2'], { other_business: 'JOYERÍA' }), { ...automated(), kind: 'uncertain' }]) {
      const h = harness(kind, { semanticValue: value(contact) });
      const out = await h.run();
      assert.equal(out.noria_phase, 'commercial_decision', JSON.stringify(contact));
      assert.deepEqual(h.log.rpc, []);
    }
  });

  test(`${kind}: trava de laço pausa a IA sem chamar o Gemini quando o limite de respostas na janela é atingido`, async () => {
    const h = harness(kind, { semanticValue: value(customer), recent: 30 });
    const out = await h.run();
    assert.equal(out.noria_terminal, true);
    assert.equal(out.reason, 'conversation_loop_guard');
    assert.equal(h.log.gemini.length, 0, 'nenhum token gasto');
    assert.deepEqual(h.log.sent, ['Recebi sua mensagem e deixei seu atendimento encaminhado para a equipe.'], 'um único aviso padrão, sem IA');
    assert.equal(h.log.completed, 'done');
    const saved = h.log.events.at(-1);
    assert.equal(saved.handoff, true, 'a conversa fica com a equipe (próximas mensagens caem na trava humana)');
    assert.equal(saved.stage, 'Atendimento humano');
    assert.equal(saved.ai_provider, 'conversation_loop_guard');
    assert.equal(saved.ai_error, 'CONVERSATION_LOOP_GUARD');
    assert.deepEqual(saved.raw_payload.loop_guard, { replies_in_window: 30, max_assistant_replies: 30, window_minutes: 30, trigger: 'volume', repeated_messages: 0 });
    const count = h.log.gets.find(url => url.startsWith('/rest/v1/channel_events'));
    for (const part of ['tenant_id=eq.' + T, 'external_conversation_id=eq.' + encodeURIComponent(CHAT), 'direction=eq.outbound', 'sender_type=eq.assistant', 'created_at=gte.', 'limit=31']) {
      assert.ok(count.includes(part), 'consulta escopada: ' + part);
    }
  });

  test(`${kind}: abaixo do limite a conversa segue normalmente`, async () => {
    const h = harness(kind, { semanticValue: value(customer), recent: 29 });
    const out = await h.run();
    assert.equal(out.noria_phase, 'commercial_decision');
    assert.equal(h.log.gemini.length, 1);
  });
}

// 21/11: no caminho padrão (tenant noria), a IA respondeu 7 vezes em 4 min ao robô de uma operadora repetindo o mesmo menu.
test('caminho padrão: a trava de laço roda depois da trava humana e antes do áudio e do Gemini', () => {
  const ast = ts.createSourceFile('core.js', coreCode, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const runTurn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name.text === 'runTurn').getText(ast);
  const lock = runTurn.indexOf("event.ai_provider = 'human_lock'; event.handoff = true;");
  const guard = runTurn.indexOf('const loopTrip = await pipelineLoopGuardTrip(context, history);', lock);
  const stop = runTurn.indexOf('if (loopTrip) return pipelineStopForLoopGuard(context, event, loopTrip, null);', guard);
  const audio = runTurn.indexOf('await transcribeTurnAudio(context);', lock);
  const gemini = runTurn.indexOf('await callGemini(', lock);
  assert.ok(lock > 0 && guard > lock && stop > guard && audio > stop && gemini > stop, 'ordem: trava humana → trava de laço → áudio → Gemini');
});

test('caminho padrão: parada pela trava de laço devolve o formato do runTurn (sem campos de pipeline)', async () => {
  const log = { sent: [], events: [], completed: null };
  const { pipelineStopForLoopGuard } = loadCore(['pipelineStopForLoopGuard'], {
    commit: async () => true, saveEvent: async event => { log.events.push(event); }, complete: async status => { log.completed = status; },
    sendChannelMessage: async (context, text) => { log.sent.push(text); return { sent: true }; },
    sessionHandoffMessage: () => 'Encaminhado.', servicesTerminal: () => { throw new Error('não é pipeline'); } });
  const trip = { replies_in_window: 10, max_assistant_replies: 10, window_minutes: 30, trigger: 'repetition', repeated_messages: 9 };
  const out = await pipelineStopForLoopGuard({}, { raw_payload: {} }, trip, null);
  assert.deepEqual(out, { ok: true, handoff: true, reason: 'conversation_loop_guard', sent: true });
  assert.equal(log.events[0].ai_provider, 'conversation_loop_guard');
  assert.deepEqual(log.events[0].raw_payload.loop_guard, trip);
  assert.deepEqual(log.sent, ['Encaminhado.']);
  assert.equal(log.completed, 'done');
});

test('trava de laço: limites do tenant, desligamento explícito e configuração inválida usa o padrão', () => {
  const { pipelineLoopGuardConfig } = loadCore(['pipelineLoopGuardConfig'], { settingsFor: context => context.settings });
  const of = guard => pipelineLoopGuardConfig({ settings: guard === undefined ? {} : { conversation_loop_guard: guard } });
  const DEFAULTS = { max_assistant_replies: 30, window_minutes: 30, repeated_max_assistant_replies: 10, min_repeated_messages: 5 };
  assert.deepEqual(of(undefined), { enabled: true, ...DEFAULTS });
  assert.deepEqual(of({ max_assistant_replies: 12, window_minutes: 10 }), { enabled: true, ...DEFAULTS, max_assistant_replies: 12, window_minutes: 10, repeated_max_assistant_replies: 10 });
  assert.deepEqual(of({ repeated_max_assistant_replies: 8, min_repeated_messages: 4 }), { enabled: true, ...DEFAULTS, repeated_max_assistant_replies: 8, min_repeated_messages: 4 });
  assert.deepEqual(of({ enabled: false }), { enabled: false, ...DEFAULTS });
  assert.deepEqual(of({ max_assistant_replies: 1, window_minutes: 9999 }), { enabled: true, ...DEFAULTS });
  assert.deepEqual(of({ max_assistant_replies: '20', window_minutes: 2.5, repeated_max_assistant_replies: 1, min_repeated_messages: 99 }), { enabled: true, ...DEFAULTS });
  // O limite com repetição nunca passa do limite absoluto.
  assert.equal(of({ max_assistant_replies: 8, window_minutes: 30 }).repeated_max_assistant_replies, 8);
});

test('repetição: conta textos idênticos do contato na janela; ignora curtos, mídia, outra direção e o que já saiu da janela', () => {
  const { pipelineContactRepetition } = loadCore(['pipelineContactRepetition'], { normalizeText });
  const rows = [
    ...botHistory(6),
    { id: 'old1', direction: 'inbound', sender_type: 'contact', message_text: MENU, created_at: minutesAgo(90) },
    { id: 'ok1', direction: 'inbound', sender_type: 'contact', message_text: 'ok', created_at: minutesAgo(5) },
    { id: 'ok2', direction: 'inbound', sender_type: 'contact', message_text: 'ok', created_at: minutesAgo(4) },
    { id: 'img1', direction: 'inbound', sender_type: 'contact', message_text: '[image] [image] [image] [image]', created_at: minutesAgo(4) },
    { id: 'img2', direction: 'inbound', sender_type: 'contact', message_text: '[image] [image] [image] [image]', created_at: minutesAgo(3) },
  ];
  const out = pipelineContactRepetition(rows, [{ event_id: 'm1', text: 'Claro  para fazer LOGIN, clique no link abaixo ⬇️' }], 30);
  // 6 mensagens do robô (3 de cada texto) + a atual: 2 primeiras são novas, 5 repetem.
  assert.deepEqual(out, { repeated_messages: 5, current_messages_repeated: true, window_minutes: 30 });
  const fresh = pipelineContactRepetition(rows, [{ event_id: 'm1', text: 'Quero uma aliança de ouro 18k para noivado' }], 30);
  assert.equal(fresh.current_messages_repeated, false);
  assert.equal(fresh.repeated_messages, 4);
  // Linha da mensagem atual já presente no histórico não conta duas vezes.
  const dup = pipelineContactRepetition([{ id: 'm1', direction: 'inbound', sender_type: 'contact', message_text: MENU, created_at: minutesAgo(1) }], [{ event_id: 'm1', text: MENU }], 30);
  assert.equal(dup.repeated_messages, 0);
});

for (const kind of ['retail', 'services']) {
  const value = kind === 'retail' ? retailValue : servicesValue;

  test(`${kind}: robô repetindo o mesmo texto para com cerca de 10 respostas da IA`, async () => {
    const h = harness(kind, { semanticValue: value(customer), recent: 10, history: botHistory(10), messages: [{ event_id: 'm1', text: MENU, raw: {} }] });
    const out = await h.run();
    assert.equal(out.reason, 'conversation_loop_guard');
    assert.equal(h.log.gemini.length, 0);
    assert.deepEqual(h.log.events.at(-1).raw_payload.loop_guard, { replies_in_window: 10, max_assistant_replies: 10, window_minutes: 30, trigger: 'repetition', repeated_messages: 9 });
  });

  test(`${kind}: cliente real ativo (sem repetição) com 10 respostas segue normalmente`, async () => {
    const talk = Array.from({ length: 10 }, (_, i) => ({ id: 'c' + i, direction: 'inbound', sender_type: 'contact', message_text: 'Pergunta diferente número ' + i + ' sobre a aliança de ouro', created_at: minutesAgo(20 - i) }));
    const h = harness(kind, { semanticValue: value(customer), recent: 10, history: talk });
    const out = await h.run();
    assert.equal(out.noria_phase, 'commercial_decision');
  });

  test(`${kind}: a interpretação recebe a medida de repetição do contato`, async () => {
    const h = harness(kind, { semanticValue: value(customer), recent: 2, history: botHistory(3), messages: [{ event_id: 'm1', text: MENU, raw: {} }] });
    await h.run();
    assert.deepEqual(h.log.gemini[0].input.contact_repetition, { repeated_messages: 2, current_messages_repeated: true, window_minutes: 30 });
    assert.ok(h.log.gemini[0].rules.some(rule => /contact_repetition/.test(rule)));
  });

  test(`${kind}: robô que repete menu sem citar a empresa é ignorado quando o nome aparece nas mensagens dele da janela`, async () => {
    const contact = automated(['m1']);
    const h = harness(kind, { semanticValue: value(contact), recent: 2, history: botHistory(3), messages: [{ event_id: 'm1', text: MENU, raw: {} }] });
    const out = await h.run();
    assert.equal(out.reason, 'automated_contact_ignored');
    assert.equal(h.log.rpc[0].body.p_proof.other_business, 'Claro');
  });

  test(`${kind}: mensagem nova (não repetida) sem o nome da empresa não é ignorada só pelo histórico`, async () => {
    const h = harness(kind, { semanticValue: value(automated(['m1'])), recent: 2, history: botHistory(3),
      messages: [{ event_id: 'm1', text: 'Sua fatura vence amanhã, evite o bloqueio do serviço', raw: {} }] });
    const out = await h.run();
    assert.equal(out.noria_phase, 'commercial_decision');
    assert.deepEqual(h.log.rpc, []);
  });

  // 26/11, Núbia: o robô de pedidos de um restaurante foi ignorado na 1ª mensagem (com o nome) e respondido na 2ª (sem o nome).
  const ignoredProof = (minutes, extra = {}) => ({ id: 'ig' + minutes, direction: 'outbound', sender_type: 'system', ai_provider: 'automated_contact_ignored',
    created_at: minutesAgo(minutes), raw_payload: { contact_context: { contract: 'noria_semantic_contact_ignore_v1', kind: 'external_automated_contact',
      other_business: 'BRUTUS SANTA RITA', evidence_ids: ['x1'], quoted_or_forwarded: false, contains_customer_request: false, ...extra } } });
  const ORDER = [{ event_id: 'm1', text: 'Seu #H70MT3, já está em produção. 😋 Avisaremos quando ele estiver pronto!', raw: {} }];

  test(`${kind}: continuação de automação já ignorada na conversa, sem o nome da empresa, é ignorada`, async () => {
    const h = harness(kind, { semanticValue: value(automated(['m1'], { other_business: 'BRUTUS SANTA RITA' })), history: [ignoredProof(1)], messages: ORDER });
    const out = await h.run();
    assert.equal(out.reason, 'automated_contact_ignored');
    assert.equal(h.log.rpc[0].body.p_proof.other_business, 'BRUTUS SANTA RITA');
    assert.deepEqual(h.log.gemini[0].input.recently_ignored_businesses, ['BRUTUS SANTA RITA']);
    assert.ok(h.log.gemini[0].rules.some(rule => /recently_ignored_businesses/.test(rule)));
  });

  test(`${kind}: prova antiga, de outra empresa ou inválida não serve de nome para ignorar`, async () => {
    for (const history of [[ignoredProof(90)], [ignoredProof(1, { contract: 'outro' })], [{ ...ignoredProof(1), ai_provider: 'services_pipeline' }]]) {
      const h = harness(kind, { semanticValue: value(automated(['m1'], { other_business: 'BRUTUS SANTA RITA' })), history, messages: ORDER });
      const out = await h.run();
      assert.equal(out.noria_phase, 'commercial_decision', JSON.stringify(history[0]));
      assert.deepEqual(h.log.rpc, []);
    }
    const other = harness(kind, { semanticValue: value(automated(['m1'], { other_business: 'Outra Loja' })), history: [ignoredProof(1)], messages: ORDER });
    assert.equal((await other.run()).noria_phase, 'commercial_decision');
  });

  test(`${kind}: cliente que escreve depois de uma automação ignorada segue o fluxo normal`, async () => {
    const h = harness(kind, { semanticValue: value(customer), history: [ignoredProof(1)], messages: [{ event_id: 'm1', text: 'Oi, quero agendar amanhã', raw: {} }] });
    const out = await h.run();
    assert.equal(out.noria_phase, 'commercial_decision');
    assert.deepEqual(h.log.rpc, []);
  });
}

test('retail: interpretação com o semantic_model do tenant é aceita pela RPC (migração 20261126125941)', async () => {
  const h = harness('retail', { semanticValue: retailValue(automated()), settings: { semantic_model: 'gemini-interpretacao' } });
  const out = await h.run();
  assert.equal(out.reason, 'automated_contact_ignored');
  assert.equal(h.log.rpc[0].body.p_model, 'gemini-interpretacao');
});

test('veredito com modelo que não é do tenant não chama a RPC e segue marcado para a EXT', () => {
  const { pipelineAutomatedContact } = loadCore(['pipelineAutomatedContact', 'groundingAutomatedContactVerdict', 'pipelineRecentlyIgnoredBusinesses'], {
    turn: { messages: BOT_MESSAGES }, normalizeText, settingsFor: () => ({ ai_model: 'gemini-a', semantic_model: 'gemini-b' }) });
  const context = { tenant: { id: T, name: 'JOYERÍA' } };
  const repetition = { repeated_messages: 0, current_messages_repeated: false, window_minutes: 30 };
  assert.equal(pipelineAutomatedContact(automated(), context, repetition, [], 'gemini-b').verdict.other_business, 'Claro');
  assert.deepEqual(pipelineAutomatedContact(automated(), context, repetition, [], 'gemini-c'), { verdict: null, unconfirmed: 'MODEL_NOT_ACCEPTED_BY_IGNORE_RPC' });
  assert.deepEqual(pipelineAutomatedContact(automated(), context, repetition, [], ''), { verdict: null, unconfirmed: 'MODEL_NOT_ACCEPTED_BY_IGNORE_RPC' });
});

test('trava de laço desligada pelo tenant não consulta o banco', async () => {
  const h = harness('retail', { semanticValue: retailValue(customer), recent: 99, settings: { conversation_loop_guard: { enabled: false } } });
  const out = await h.run();
  assert.equal(out.noria_phase, 'commercial_decision');
  assert.equal(h.log.gets.some(url => url.startsWith('/rest/v1/channel_events')), false);
});

test('trava de laço conta só depois que a equipe devolveu a conversa para a IA', async () => {
  const resumedAt = '2026-11-25T18:00:00.000Z';
  const h = harness('retail', { semanticValue: retailValue(customer), recent: 0,
    history: [{ id: 'r1', direction: 'outbound', sender_type: 'system', ai_provider: 'resume_ai', service: 'resume_ai', created_at: resumedAt }] });
  await h.run();
  const count = h.log.gets.find(url => url.startsWith('/rest/v1/channel_events'));
  const since = decodeURIComponent(count.match(/created_at=gte\.([^&]+)/)[1]);
  assert.ok(Date.parse(since) >= Date.parse(resumedAt), 'janela começa na devolução quando ela é mais recente');
});

test('trava de laço com falha na contagem não bloqueia o atendimento (falha aberta)', async () => {
  for (const supabaseGet of [async () => { throw new Error('HTTP 503'); }, async () => ({ message: 'erro' })]) {
    const { pipelineLoopGuardTrip } = loadCore(['pipelineLoopGuardTrip', 'pipelineLoopGuardConfig', 'pipelineContactRepetition'], {
      settingsFor: () => ({}), chatId: CHAT, encodeFilter: v => encodeURIComponent(String(v)), supabaseGet, normalizeText, turn: { messages: [] },
    });
    assert.equal(await pipelineLoopGuardTrip({ tenant: { id: T } }, []), null);
  }
});

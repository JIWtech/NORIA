'use strict';
// A interpretação da fala do cliente e da resposta da IA é do Gemini, num campo estruturado (Núbia e I&C Salon).
// Cada teste abaixo falhava enquanto a decisão vinha de regex ou lista de palavras e passa quando vem do campo/tag do Gemini.
// Roda sobre as FONTES: n8n/sources/noria_core.js (Núbia, caminho comum) e clients/ic_saloon/salon_engine.js (Salon).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const SOURCES = {
  core: path.join(ROOT, 'n8n/sources/noria_core.js'),
  salon: path.join(ROOT, 'clients/ic_saloon/salon_engine.js'),
};
const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

function between(code, start, end) {
  const i = code.indexOf(start);
  assert.ok(i >= 0, 'trecho ausente: ' + start);
  const j = code.indexOf(end, i + start.length);
  assert.ok(j > i, 'fim ausente: ' + end);
  return code.slice(i, j);
}

// ---- Carrega funções internas do motor (mesmo gancho de test_booking_authorization.cjs) -------------------------------------
async function loadEngine(file, names, { turnText = 'Como funciona?', settings = {} } = {}) {
  const code = read(file);
  const hook = /try \{\n\s*const turnResult = await runTurn\(\);/.exec(code);
  assert.ok(hook, 'gancho do runTurn ausente');
  const exposed = names.join(',');
  const engine = await new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', code.replace(hook[0],
    `geminiTenantBudget={tenant_id:'tenant',daily_limit:100};turn={token:'token',boundary_id:'session',messages:[{event_id:'now',text:${JSON.stringify(turnText)},received_at:'2026-10-23T22:01:00-03:00'}]};return {${exposed}};\n` + hook[0]))
    .call({ helpers: { httpRequest: async () => { throw new Error('rede proibida'); } } },
      { tenant_slug: 'fixture', tenant_id: 'tenant', text: turnText },
      { GEMINI_API_KEY: 'fixture', GEMINI_ENABLED: 'true', SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture' }, {}, () => ({}));
  return engine;
}

const CONTEXT = {
  tenant: { id: 'tenant', slug: 'fixture', name: 'Fixture' },
  settings: { settings: { system_prompt: 'Fixture', prompt_revision: 'fixture', ai_model: 'gemini-3.5-flash-lite' } },
};
const CATALOG = { matches: [{ external_id: 'comfort', name: 'Comfort', price: 179.99, active: true }] };
const STATE = { customer_name: '', service_id: '', date: '', time: '', unit_id: '', unit_evidence: '',
  name_evidence: '', service_evidence: '', date_evidence: '', time_evidence: '' };
const ASSERTIONS = { states_address: false, memory_excuse: false, claims_booking_or_payment_done: false };
const reply = (overrides = {}) => ({ action: 'reply', reply: 'Claro, posso ajudar.', message_keys: [], price_claims: [], state: { ...STATE },
  reference_intent: 'none', reply_assertions: { ...ASSERTIONS }, ...overrides });

// ======================================================================================================================
// Núbia: caminho grounded (canonical_v2) em noria_core.js
// ======================================================================================================================
test('[nubia] esquema grounded pede reference_intent e reply_assertions ao Gemini (mesma chamada, sem chamada nova)', async () => {
  const { groundingResponseSchema } = await loadEngine(SOURCES.core, ['groundingResponseSchema']);
  const schema = groundingResponseSchema(CONTEXT, CATALOG);
  assert.deepEqual(schema.properties.reference_intent.enum, ['none', 'recall', 'other_contact', 'change_booking']);
  assert.deepEqual(Object.keys(schema.properties.reply_assertions.properties).sort(), ['claims_booking_or_payment_done', 'memory_excuse', 'states_address']);
  assert.ok(schema.required.includes('reference_intent') && schema.required.includes('reply_assertions'));
  assert.deepEqual(schema.properties.reply_assertions.required.slice().sort(), ['claims_booking_or_payment_done', 'memory_excuse', 'states_address']);
});

test('[nubia] recall: quem decide é o campo reference_intent, não o regex da fala do cliente', async () => {
  const { groundingValidateResponse } = await loadEngine(SOURCES.core, ['groundingValidateResponse'], { turnText: 'ok, pode ser' });
  const recall = groundingValidateResponse(reply({ action: 'recall_previous', reply: '', reference_intent: 'recall' }), CONTEXT, [], CATALOG, { rows: [] });
  assert.equal(recall.recallRequested, true);
  const wrong = groundingValidateResponse(reply({ action: 'recall_previous', reply: '', reference_intent: 'none' }), CONTEXT, [], CATALOG, { rows: [] });
  assert.match(wrong.text, /HUMANO_SOLICITADO/, 'recall sem reference_intent=recall vai à equipe');
});

test('[nubia] alterar/cancelar reserva ou outro contato: reference_intent leva à equipe, sem regex', async () => {
  const { groundingValidateResponse } = await loadEngine(SOURCES.core, ['groundingValidateResponse'], { turnText: 'quero outra coisa' });
  for (const intent of ['change_booking', 'other_contact']) {
    const out = groundingValidateResponse(reply({ reply: 'Posso mudar sim, já troquei.', reference_intent: intent }), CONTEXT, [], CATALOG, { rows: [] });
    assert.equal(out.handoff, true, intent);
    assert.match(out.text, /HUMANO_SOLICITADO/);
    assert.doesNotMatch(out.text, /troquei/);
  }
  const normal = groundingValidateResponse(reply(), CONTEXT, [], CATALOG, { rows: [] });
  assert.equal(normal.text, 'Claro, posso ajudar.');
});

test('[nubia] reply_assertions: endereço, desculpa de memória e reserva concluída são declarados pelo Gemini', async () => {
  const { groundingValidateResponse } = await loadEngine(SOURCES.core, ['groundingValidateResponse']);
  const validate = (value, appointments = { rows: [] }) => groundingValidateResponse(value, CONTEXT, [], CATALOG, appointments);
  // Frase com palavras de endereço, mas o Gemini diz que não afirma endereço: passa (antes um regex a desviava).
  assert.equal(validate(reply({ reply: 'Temos uma rua de acesso fácil e um bairro tranquilo.' })).text, 'Temos uma rua de acesso fácil e um bairro tranquilo.');
  // Endereço sem palavra-chave, declarado pelo Gemini: não vai como texto livre.
  const address = validate(reply({ reply: 'Fica ao lado da padaria.', reply_assertions: { ...ASSERTIONS, states_address: true } }));
  assert.match(address.text, /HUMANO_SOLICITADO/, 'sem endereço oficial verificado, equipe confirma');
  assert.throws(() => validate(reply({ reply: 'Desculpe, não consigo recordar da nossa conversa.', reply_assertions: { ...ASSERTIONS, memory_excuse: true } })), /Memory excuse blocked/);
  assert.equal(validate(reply({ reply: 'Esqueci de dizer: temos estacionamento.' })).text, 'Esqueci de dizer: temos estacionamento.');
  assert.throws(() => validate(reply({ reply: 'Pronto, deixei seu horário combinado.', reply_assertions: { ...ASSERTIONS, claims_booking_or_payment_done: true } })), /Unexecuted action claim/);
  assert.equal(validate(reply({ reply: 'Seu agendamento confirmado será revisado.' })).text, 'Seu agendamento confirmado será revisado.');
});

test('[nubia] campos novos ausentes ou fora do contrato falham fechado', async () => {
  const { groundingValidateResponse } = await loadEngine(SOURCES.core, ['groundingValidateResponse']);
  const validate = value => groundingValidateResponse(value, CONTEXT, [], CATALOG, { rows: [] });
  const base = reply();
  delete base.reply_assertions;
  assert.throws(() => validate(base), /Invalid structured reply/);
  assert.throws(() => validate(reply({ reply_assertions: { states_address: false, memory_excuse: false } })), /Invalid structured reply/);
  assert.throws(() => validate(reply({ reply_assertions: { ...ASSERTIONS, states_address: 'false' } })), /Invalid structured reply/);
  assert.throws(() => validate(reply({ reference_intent: 'talvez' })), /Invalid structured reply/);
});

test('[nubia] pergunta de endereço não é desviada por regex antes do Gemini (action=location do esquema resolve)', async () => {
  const { groundingDirectReply } = await loadEngine(SOURCES.core, ['groundingDirectReply']);
  assert.equal(groundingDirectReply(CONTEXT, 'Qual o endereço de vocês?', []), null);
  assert.equal(groundingDirectReply(CONTEXT, 'onde fica a clínica?', []), null);
  assert.equal(groundingDirectReply(CONTEXT, '[audio]', []).source, 'unsupported_media', 'placeholder técnico continua');
});

test('[nubia] declaração de pagamento: só o gatilho configurado é comando; frases prontas saíram', async () => {
  const withTrigger = { settings: { settings: { payment_signal_enabled: true, appointment_payment_trigger: 'SINAL PAGO' } } };
  for (const file of Object.values(SOURCES)) {
    const { isPaymentSignalPaidText } = await loadEngine(file, ['isPaymentSignalPaidText']);
    assert.equal(isPaymentSignalPaidText('SINAL PAGO', withTrigger), true);
    assert.equal(isPaymentSignalPaidText('sinal   pago', withTrigger), true);
    for (const phrase of ['paguei o sinal', 'já paguei o sinal', 'pix realizado', 'pagamento realizado']) {
      assert.equal(isPaymentSignalPaidText(phrase, withTrigger), false, phrase);
    }
  }
});

test('[nubia] composição de desfecho: validade vem de outcome_check do Gemini, não de regex na prosa', async () => {
  for (const file of Object.values(SOURCES)) {
    const { composeSchedulingOutcomeReply } = await loadEngine(file, ['composeSchedulingOutcomeReply']);
    const code = read(file);
    const composerSchema = between(code, 'async function schedulingComposeReply(', 'async function composeSchedulingOutcomeReply(');
    assert.match(composerSchema, /outcome_check/);
    for (const key of ['says_unavailable', 'says_deposit_pending', 'says_payment_confirmed', 'asks_full_name']) assert.match(composerSchema, new RegExp(key));
    const runTurn = between(code, 'async function runTurn()', 'try {\n  const turnResult');
    assert.doesNotMatch(runTurn, /indisponivel\|ocupad/, 'regex de indisponível');
    assert.doesNotMatch(runTurn, /nome completo\/i\.test/, 'regex de nome completo');
    assert.doesNotMatch(runTurn, /\\b\(\?:sinal\|pendente\)/, 'regex de sinal pendente');
    assert.equal(typeof composeSchedulingOutcomeReply, 'function');
  }
});

test('[nubia] composeSchedulingOutcomeReply entrega outcome_check ao validador e cai no texto fixo se o Gemini negar', async () => {
  for (const file of Object.values(SOURCES)) {
    const code = read(file);
    const hook = /try \{\n\s*const turnResult = await runTurn\(\);/.exec(code);
    let composed = { reply: 'Esse horário não está livre.', price_claims: [], outcome_check: { says_unavailable: true, says_deposit_pending: false, says_payment_confirmed: false, asks_full_name: false } };
    const engine = await new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', code.replace(hook[0],
      `geminiTenantBudget={tenant_id:'tenant',daily_limit:100};turn={token:'token',boundary_id:'session',messages:[{event_id:'now',text:'oi',received_at:'2026-10-23T22:01:00-03:00'}]};return {composeSchedulingOutcomeReply};\n` + hook[0]))
      .call({ helpers: { httpRequest: async options => {
        if (options.url.endsWith('/rpc/magia_gemini_reserve')) return { allowed: true };
        if (options.url.endsWith('/rpc/magia_gemini_release')) return {};
        assert.ok(options.url.includes('generativelanguage.googleapis.com'));
        const system = (options.body.system_instruction?.parts || []).map(part => part.text || '').join(' ');
        const input = JSON.parse(options.body.contents[0].parts[0].text);
        const answer = system.includes('NORIA_SERVICE_PRICE_AUDIT')
          ? { scope_key: input.scope_key, complete: true, segments: [{ text: input.reply, kind: 'non_factual', evidence: [] }] } : composed;
        return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(answer) }] } }] };
      } } }, { tenant_slug: 'fixture', tenant_id: 'tenant', text: 'oi' },
      { GEMINI_API_KEY: 'fixture', GEMINI_ENABLED: 'true', SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture' }, {}, () => ({}));
    const ctx = { tenant: { id: 'tenant', name: 'Fixture' }, settings: { settings: { grounding_mode: 'canonical_v2', system_prompt: 'Fixture', ai_model: 'gemini-3.5-flash-lite' } } };
    const valid = (text, check) => check?.says_unavailable === true;
    const ok = await engine.composeSchedulingOutcomeReply(ctx, [], CATALOG, {}, { outcome: 'slot_unavailable' }, 'texto fixo', valid);
    assert.equal(ok, 'Esse horário não está livre.', file);
    composed = { ...composed, reply: 'Pode ser ocupado ou indisponível, quem sabe.', outcome_check: { ...composed.outcome_check, says_unavailable: false } };
    const rejected = await engine.composeSchedulingOutcomeReply(ctx, [], CATALOG, {}, { outcome: 'slot_unavailable' }, 'texto fixo', valid);
    assert.equal(rejected, 'texto fixo', 'palavras de indisponibilidade na prosa não bastam; o campo manda');
  }
});

test('[nubia] instrução de geração proíbe saudação repetida (grounded e services_v1); runTurn não corta mais por lista de saudações', () => {
  const code = read(SOURCES.core);
  const grounded = between(code, 'async function callGroundedGemini(', 'function schedulingEnabled(');
  assert.match(grounded, /opening=false[^']*sem saudação|sem saudação[^']*opening=false/i, 'instrução de saudação no grounded');
  const compose = between(code, 'async function servicesComposeReply(', 'function servicesReceiptFrom(');
  assert.match(compose, /nao abra com saudacao|sem saudacao/i, 'instrução de saudação no services_v1');
  const runTurn = between(code, 'async function runTurn()', 'try {\n  const turnResult');
  assert.doesNotMatch(runTurn, /removeMidConversationGreeting/);
  assert.doesNotMatch(runTurn, /isBotFrustrationText/);
  assert.doesNotMatch(runTurn, /sessionReferenceIntent/);
  assert.doesNotMatch(code, /function sessionReferenceIntent\(/);
});

// ======================================================================================================================
// Caminho comum do runTurn (legado com tags) em Núbia-core e Salon: decisões vêm das tags do Gemini
// ======================================================================================================================
const CHAT = '5511111111111@s.whatsapp.net';
const SERVICES = [
  { external_id: 'corte', name: 'Corte', category: 'Cabelo', description: 'Corte', price: 50, billing_unit: 'sessao', estimated_hours: 1 },
  { external_id: 'escova', name: 'Escova', category: 'Cabelo', description: 'Escova', price: 40, billing_unit: 'sessao', estimated_hours: 0.5 },
];

async function runTurn(file, { text, responses, history = [], settingsExtra = {} }) {
  const code = read(file);
  const execute = new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', "const NORIA_NODE_PHASE = 'single';\n" + code);
  const calls = [], events = [];
  let sentText = '', generations = 0;
  const input = {
    tenant_id: 't-salon', tenant_slug: 'salon', remoteJid: CHAT, instance: 'salon',
    noria_client_policy: { contract: 'noria_policy_v2', tenant_id: 't-salon', tenant_slug: 'salon', profile: 'services_booking_v2', capability: 'standard',
      audio_enabled: false, scheduling_enabled: false, modules: { turn_pipeline: { contract: 'noria_turn_pipeline_v1' } } },
  };
  const environment = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'fake', GEMINI_ENABLED: 'true', GEMINI_API_KEY: 'fake',
    EVOLUTION_API_URL_SALON: 'https://evo.test', EVOLUTION_API_KEY_SALON: 'fake', EVOLUTION_INSTANCE_SALON: 'salon', NORIA_INGRESS_FORWARD_TOKEN_SALON: 'fake' };
  const settings = { whatsapp_processing_mode: 'conversation_core_v1', ai_model: 'gemini-2.5-flash-lite', ai_enabled: true, system_prompt: 'Atendente do salão',
    timezone: 'America/Sao_Paulo', gemini_daily_limit: 80, payment: { enabled: false }, ...settingsExtra };
  const httpRequest = async ({ method, url, body }) => {
    const u = new URL(url); calls.push({ method, url, body });
    if (u.hostname === 'evo.test') { sentText = body.text; return { key: { id: 'sent-1' } }; }
    if (u.hostname === 'generativelanguage.googleapis.com') {
      const value = Array.isArray(responses) ? responses[generations++] : responses;
      return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: value }] } }], usageMetadata: {} };
    }
    assert.equal(u.hostname, 'db.test');
    const table = u.pathname.split('/').at(-1);
    if (table === 'magia_turn_suppression_status') return { contract: 'noria_turn_lifecycle_v1', evidence: {} };
    if (table === 'magia_gemini_reserve') return { allowed: true };
    if (['magia_gemini_release', 'magia_gemini_commit'].includes(table)) return {};
    if (table === 'contacts' || table === 'conversation_turn_queue') return [];
    if (table === 'magia_turn_lifecycle_status') return { ready: true, contract: 'noria_turn_lifecycle_v1' };
    if (table === 'magia_claim_turn') return { claimed: true, contract: 'noria_turn_lifecycle_v1', token: 'claim-1', boundary_id: 'initial', messages: [{ event_id: 'e0', id: 'w0', text, received_at: new Date().toISOString(), raw: {} }] };
    if (table === 'magia_begin_turn_delivery') return { id: 'd1', delivery_attempt_id: 'd1', dispatch_allowed: true, contract: 'noria_turn_lifecycle_v1' };
    if (table === 'magia_confirm_turn_delivery') return { confirmed: true, contract: 'noria_turn_lifecycle_v1' };
    if (table === 'magia_merge_channel_event_raw') return { applied: true };
    if (table === 'magia_commit_turn') return { committed: true, contract: 'noria_turn_lifecycle_v1' };
    if (table === 'magia_finish_turn') return { finished: true, contract: 'noria_turn_lifecycle_v1', outcome: body.p_outcome };
    if (table === 'tenants') return [{ id: 't-salon', slug: 'salon', status: 'active', name: 'Salão' }];
    if (table === 'tenant_settings') return [{ timezone: 'America/Sao_Paulo', settings }];
    if (table === 'ai_agents') return [{ model: 'gemini-2.5-flash-lite', max_tokens: 500, temperature: 0.45 }];
    if (table === 'channels') return [{ external_id: 'salon' }];
    if (table === 'tenant_service_catalog' || table === 'search_tenant_service_catalog') return SERVICES;
    if (table === 'channel_events') {
      if (method === 'PATCH' || method === 'POST') { events.push(body); return [{ id: 'out' }]; }
      if (u.searchParams.get('or') === '(ai_provider.is.null,ai_provider.neq.buffer)') return [...history];
      return [];
    }
    if (table === 'appointments') return [];
    throw Error('Unexpected ' + method + ' ' + u.pathname);
  };
  const result = await execute.call({ helpers: { httpRequest } }, input, environment, {}, () => ({}));
  const generation = calls.filter(c => c.url.includes('generateContent'));
  return { result: result.json, calls, events, sentText, generations: generation.length, prompt: JSON.stringify(generation[0]?.body || {}) };
}

for (const [label, file] of Object.entries(SOURCES)) {
  test(`[${label}] frustração com a IA: o veto por lista de palavras saiu; a tag do Gemini decide o handoff`, async () => {
    // Fala com palavras de frustração e o Gemini marca reclamação real: antes o regex da fala anulava o handoff.
    const complaint = await runTurn(file, { text: 'você é burra, quero falar com a gerência', responses: 'Sinto muito pelo ocorrido, vou chamar a equipe. [RECLAMACAO]' });
    assert.equal(complaint.result.ok, true, JSON.stringify(complaint.result));
    assert.ok(complaint.events.some(e => e.handoff === true && e.stage === 'Atendimento humano'), 'handoff pela tag do Gemini');
    // Frustração só com a resposta: o Gemini não marca reclamação e não há handoff.
    const plain = await runTurn(file, { text: 'você é burra, não foi isso', responses: 'Desculpe, vamos de novo: qual serviço você quer?' });
    assert.ok(!plain.events.some(e => e.handoff === true));
  });

  test(`[${label}] emoji de reclamação segue a tag do Gemini, não palavras da fala`, async () => {
    const withComplaint = await runTurn(file, { text: 'tive um problema aqui', responses: 'Sinto muito 😢😢 vou chamar a equipe [RECLAMACAO]' });
    assert.doesNotMatch(withComplaint.sentText, /\p{Extended_Pictographic}/u, 'reclamação sem emoji: ' + withComplaint.sentText);
    const normal = await runTurn(file, { text: 'tive um problema aqui', responses: 'Que pena 😢😢 me conta mais' });
    assert.equal((normal.sentText.match(/\p{Extended_Pictographic}/gu) || []).length, 1, 'regra de um emoji continua');
  });
}

// ======================================================================================================================
// Salon: callGemini sem regras por palavra (saudação, catálogo, dicas de público/idade/frustração, classificação)
// ======================================================================================================================
test('[salon] saudação no meio da conversa: o motor entrega o texto do Gemini; a exigência está na instrução', async () => {
  const history = [{ direction: 'outbound', sender_type: 'assistant', message_text: 'Oi! Como posso ajudar?', created_at: '2026-11-01T10:00:00Z' }];
  const run = await runTurn(SOURCES.salon, { text: 'quanto custa o corte?', history, responses: 'Oi, meu bem! O corte custa R$ 50.' });
  assert.equal(run.sentText, 'Oi, meu bem! O corte custa R$ 50.', 'sem corte por lista de saudações');
  assert.match(run.prompt, /não abra a resposta com saudação|nao abra a resposta com saudacao/i);
});

test('[salon] prompt sem dicas por regex (frustração, público, menor, idade, classificação)', async () => {
  const run = await runTurn(SOURCES.salon, { text: 'sou homem e tenho 15 anos, ia burra', responses: 'Entendi.' });
  for (const hint of ['Frustracao apenas', 'Homem querendo', 'Agendamento explicitamente para outra', 'Menor explicitamente', 'Idade explicita', 'Classificacao atual', 'Etapa sugerida']) {
    assert.ok(!run.prompt.includes(hint), 'dica por regex ainda no prompt: ' + hint);
  }
  assert.match(run.prompt, /frustra[cç][aã]o apenas com a resposta/i);
  assert.match(run.prompt, /CATALOGO_COMPLETO/);
});

test('[salon] catálogo completo: a tag [CATALOGO_COMPLETO] do Gemini aciona a lista oficial; a fala sozinha não', async () => {
  const viaTag = await runTurn(SOURCES.salon, { text: 'me mostra tudo que vocês oferecem', responses: 'Separei tudo para você: [CATALOGO_COMPLETO]' });
  assert.equal(viaTag.generations, 1);
  assert.match(viaTag.sentText, /Separei tudo para você/);
  assert.match(viaTag.sentText, /Corte/);
  assert.doesNotMatch(viaTag.sentText, /R\$\s*50/, 'pedido de lista sem preço não divulga valores');
  assert.match(viaTag.sentText, /Escova/);
  assert.doesNotMatch(viaTag.sentText, /CATALOGO_COMPLETO/);
  assert.ok(viaTag.events.some(e => e.ai_provider === 'catalog_db_direct'));
  const noTag = await runTurn(SOURCES.salon, { text: 'quais são todos os serviços?', responses: 'Temos vários serviços, qual te interessa?' });
  assert.equal(noTag.generations, 1, 'sem a palavra-gatilho no código, o Gemini é consultado');
  assert.equal(noTag.sentText, 'Temos vários serviços, qual te interessa?');
  const withPrices = await runTurn(SOURCES.salon, { text: 'me mostra o catálogo completo com os preços', responses: 'Separei tudo para você: [CATALOGO_COMPLETO_COM_PRECOS]' });
  assert.match(withPrices.sentText, /R\$\s*50/, 'pedido explícito de valores inclui os preços oficiais');
  assert.doesNotMatch(withPrices.sentText, /CATALOGO_COMPLETO_COM_PRECOS/);
});

test('[salon] código vivo sem as listas de palavras removidas', () => {
  const code = read(SOURCES.salon);
  for (const name of ['removeMidConversationGreeting', 'isBotFrustrationText', 'isRealServiceComplaintText', 'audienceSignals', 'explicitAgeFromText',
    'wantsFullCatalogRequest', 'divaCatalogIntro', 'classify', 'sessionReferenceIntent']) {
    assert.doesNotMatch(code, new RegExp('function ' + name + '\\('), name);
  }
});

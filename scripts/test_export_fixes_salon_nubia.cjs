'use strict';
// Regressões da investigação Salon/Núbia (2026-11-12), executadas sobre o código dos exports publicados em n8n/workflows/.
// Os exports são a referência atual: as fontes em n8n/sources/ e clients/ estão defasadas em relação a eles.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const EXPORTS = {
  core: 'n8n/workflows/NORIA-CORE-Motor-Conversacional-Compartilhado--mlKNPv862H2g3Gap.json',
  salon: 'n8n/workflows/NORIA-EXT-IC-Salon-Atendimento-e-Agendamentos--yxdKP0PeskDMUFSo.json',
};
// As fontes precisam carregar as mesmas correções, ou uma regeneração a partir delas as desfaria.
const ENGINES = { ...EXPORTS, fonte: 'n8n/sources/noria_core.js', 'fonte salon': 'clients/ic_saloon/salon_engine.js' };

function engineCode(file) {
  if (file.endsWith('.js')) return fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
  const workflow = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  const node = workflow.nodes.find(item => item.name === 'CORE | Motor conversacional');
  assert.ok(node?.parameters?.jsCode, 'nó do motor ausente em ' + file);
  return node.parameters.jsCode;
}

// O motor do Salon (fonte e, depois de regenerado, o export) não corta saudação nem gera catálogo na prosa.
// Enquanto o export publicado ainda tem a versão anterior, ele segue valendo com as asserções anteriores.
function salonRewritten(label, code) {
  return ['salon', 'fonte salon'].includes(label) && !code.includes('\nfunction removeMidConversationGreeting(');
}

function slice(code, start, end) {
  const i = code.indexOf(start);
  assert.ok(i >= 0, 'trecho ausente: ' + start);
  const j = code.indexOf(end, i + start.length);
  assert.ok(j > i, 'fim ausente: ' + end);
  return code.slice(i, j);
}

function topFunction(code, name) {
  const i = code.indexOf('\nfunction ' + name + '(');
  assert.ok(i >= 0, 'função ausente: ' + name);
  return code.slice(i, code.indexOf('\n}\n', i) + 3);
}

for (const [label, file] of Object.entries(ENGINES)) {
  const code = engineCode(file);

  test(`[${label}] auditoria semântica: horário negado vale só se a prova não o lista como livre`, () => {
    const verify = new Function(slice(code, 'const SERVICES_ASSERTION_CATEGORIES', 'async function servicesSemanticAudit')
      + ';return servicesVerifySemanticReport')();
    const ctx = { decision: { facts: [], approved_blocks: [] }, execution: {}, blocks: [],
      proof: { date: '2026-11-13', time: '11:30', available_starts: ['10:00'] }, semantic: { slots: { time: '11:30' } } };
    const one = (text, polarity, reference = '') => verify({ covers_entire_reply: true,
      assertions: [{ text, category: 'availability', support: 'availability', reference, quote: '', polarity }] }, ctx).status;
    assert.equal(one('Às 11:30 não temos horário', 'denies', '11:30'), 'approved');
    assert.equal(one('Às 11:30 temos horário', 'affirms', '11:30'), 'rejected', 'horário consultado e ocupado não pode ser afirmado livre');
    assert.equal(one('Às 10:00 não temos horário', 'denies', '10:00'), 'rejected', 'negar horário livre contradiz a prova');
    assert.equal(one('Às 10:00 temos horário', 'affirms', '10:00'), 'approved');
    assert.equal(one('Às 10:00 temos horário', 'talvez', '10:00'), 'rejected', 'polaridade fora do contrato');
    const schema = slice(code, 'async function servicesSemanticAudit', 'async function servicesComposeReply');
    assert.match(schema, /polarity: \{ type: 'STRING', enum: \['affirms', 'denies'\] \}/);
    assert.match(schema, /required: \['text', 'category', 'support', 'reference', 'quote', 'polarity'\]/);
  });

  test(`[${label}] pedido fora do horário de funcionamento configurado é barrado`, () => {
    const names = ['resolveTenantDayHours', 'tenantBusinessHoursStatus', 'appointmentOutsideBusinessHours'];
    const outside = new Function('settingsFor', 'tenantTimeZone', 'normalizeText',
      names.map(name => topFunction(code, name)).join('\n') + ';return appointmentOutsideBusinessHours')(
      context => context.settings || {}, () => 'America/Sao_Paulo',
      value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase());
    const context = { settings: { business_hours: { schedule: { segunda: { start: '09:00', end: '18:00' }, domingo: { closed: true } } } } };
    assert.equal(outside(context, '2030-01-14T10:00:00-03:00'), false, 'segunda 10h está aberto');
    assert.equal(outside(context, '2030-01-14T20:00:00-03:00'), true, 'segunda 20h está fechado');
    assert.equal(outside(context, '2030-01-13T10:00:00-03:00'), true, 'domingo está fechado');
    assert.equal(outside(context, '2030-01-15T10:00:00-03:00'), false, 'dia sem regra configurada não bloqueia');
    assert.equal(outside({ settings: {} }, '2030-01-13T10:00:00-03:00'), false, 'sem horário configurado não bloqueia');
    const save = slice(code, '\nasync function saveAppointmentRequest(', '\nfunction parseAppointmentCreationTag(');
    assert.match(save, /appointmentOutsideBusinessHours\(context, startsAt\)/);
    assert.match(code, /\} else if \(\/outside_business_hours\/\.test\(code\)\) \{/);
  });

  test(`[${label}] anúncio de origem entra como contexto no prompt padrão e no services_v1`, () => {
    const adContext = new Function(topFunction(code, 'turnAdContext') + ';return turnAdContext')();
    assert.deepEqual(adContext([{ raw: { referral: { source: 'external_ad_reply', title: 'Limpeza de pele', body: 'Agende sua avaliação' } } }]),
      { title: 'Limpeza de pele', body: 'Agende sua avaliação' });
    assert.deepEqual(adContext([{ raw_payload: { referral: { source: 'external_ad_reply', title: 'Promo' } }, direction: 'inbound' }, { raw: {} }]),
      { title: 'Promo', body: '' });
    assert.equal(adContext([{ raw: { referral: { source: 'whatsapp_catalog_product', title: 'x' } } }]), null);
    assert.equal(adContext([{ direction: 'outbound', raw_payload: { referral: { source: 'external_ad_reply', title: 'x' } } }]), null);
    // O Salon (fonte própria) deixou de gerar o catálogo na prosa: o Gemini sinaliza com a tag e o CORE anexa a lista oficial.
    assert.match(code, salonRewritten(label, code)
      ? /const systemText = `\$\{basePrompt\}\$\{adContextInstruction\}/
      : /const systemText = `\$\{basePrompt\}\$\{fullCatalogInstruction\}\$\{adContextInstruction\}/);
    assert.match(slice(code, "'services_semantic_intent', {", 'servicesSemanticSchema('), /ad_context: turnAdContext\(/);
  });

  test(`[${label}] envio rejeitado pela Evolution (4xx) é sinalizado à fila como não entregue`, () => {
    const rejected = new Function(topFunction(code, 'turnDeliveryRejectedByProvider') + ';return turnDeliveryRejectedByProvider')();
    const http = (status, route = '/message/sendText/{id}', provider = 'external') => ({ noria_http: { provider, route, status } });
    const state = { sendAttempted: true, providerAccepted: false, deliveryConfirmed: false };
    assert.equal(rejected(http(400), state), true);
    assert.equal(rejected(http(404, '/message/sendMedia/{id}'), state), true);
    assert.equal(rejected(http(429), state), false, 'limite de taxa pode ter sido entregue depois');
    assert.equal(rejected(http(408), state), false, 'timeout não comprova não-entrega');
    assert.equal(rejected(http(500), state), false, 'erro do servidor é incerto');
    assert.equal(rejected(http(null), state), false, 'sem resposta é incerto');
    assert.equal(rejected(new Error('ETIMEDOUT'), state), false);
    assert.equal(rejected(http(400, '/rest/v1/rpc/{id}', 'supabase_rpc'), state), false, 'falha do Supabase não é rejeição do provedor');
    assert.equal(rejected(http(400), { ...state, providerAccepted: true }), false, 'parte já aceita pelo provedor');
    assert.equal(rejected(http(400), { ...state, sendAttempted: false }), false);
    assert.equal(rejected(http(400), { ...state, deliveryConfirmed: true }), false);
    const failCall = slice(code, '    failure.failure_retryable = retryable;', '      failure.finish_persisted = true;');
    assert.match(failCall, /p_delivery_rejected: true/);
    assert.match(failCall, /PGRST202/, 'sem a migração aplicada, repete a chamada sem o parâmetro');
    assert.match(code, /result\.reason !== 'provider_rejected_delivery'/);
  });

  test(`[${label}] services_v1 informa a data local de cada mensagem do cliente`, () => {
    const localDate = new Function('tenantTimeZone', topFunction(code, 'servicesMessageLocalDate') + ';return servicesMessageLocalDate')(() => 'America/Sao_Paulo');
    assert.equal(localDate('2026-11-12T02:30:00Z', {}), '2026-11-11', '23:30 em São Paulo ainda é o dia anterior');
    assert.equal(localDate('2026-11-12T13:00:00Z', {}), '2026-11-12');
    assert.equal(localDate('', {}), '');
    const input = slice(code, "'services_semantic_intent', {", 'servicesSemanticSchema(');
    assert.match(input, /scope: 'session', received_local_date: servicesMessageLocalDate\(row\.received_at, context\)/);
    assert.match(input, /scope: 'current', received_local_date: servicesMessageLocalDate\(item\.received_at, context\)/);
    assert.match(code, /received_at: row\.created_at/);
    assert.match(slice(code, 'const SERVICES_SEMANTIC_RULES', '];'), /received_local_date/);
  });

  test(`[${label}] auditoria semântica: disponibilidade exige horário presente na prova`, () => {
    const verify = new Function(slice(code, 'const SERVICES_ASSERTION_CATEGORIES', 'async function servicesSemanticAudit')
      + ';return servicesVerifySemanticReport')();
    const ctx = {
      decision: { facts: [], approved_blocks: [] },
      execution: { reservation: { status: 'created', appointment: { requested_date: '2026-11-13', requested_time: '10:00' } } },
      proof: { date: '2026-11-13', time: '10:00', available_starts: ['10:00'] },
      semantic: { slots: { time: '11:30' } },
      blocks: [],
    };
    const report = assertions => verify({ assertions, covers_entire_reply: true }, ctx);
    // Horário pedido pelo cliente não é prova de disponibilidade nem recibo de reserva.
    assert.equal(report([{ text: 'Tem horário às 11:30', category: 'availability', support: 'availability', reference: '11:30', quote: '' }]).status, 'rejected');
    assert.equal(report([{ text: 'Tem horário às 11h30', category: 'availability', support: 'availability', reference: 'agenda', quote: '' }]).status, 'rejected');
    assert.equal(report([{ text: 'Reservei às 11:30', category: 'reservation', support: 'reservation_receipt', reference: 'recibo', quote: '' }]).status, 'rejected');
    // Controles: o que a prova e o recibo sustentam continua aprovado; o eco do pedido numa pergunta também.
    assert.equal(report([{ text: 'Tem horário às 10:00', category: 'availability', support: 'availability', reference: '10:00', quote: '' }]).status, 'approved');
    assert.equal(report([{ text: 'Reservei às 10h', category: 'reservation', support: 'reservation_receipt', reference: 'recibo', quote: '' }]).status, 'approved');
    assert.equal(report([{ text: 'Você prefere 11:30 mesmo?', category: 'conversational', support: 'customer_provided', reference: 'time', quote: '' }]).status, 'approved');
    // Relatório sem nenhuma afirmação não comprova cobertura de uma resposta com texto.
    assert.equal(report([]).status, 'rejected');
  });

  test(`[${label}] auditoria semântica: contrato anterior preservado (casos de test_noria_services_pipeline)`, () => {
    const verify = new Function(slice(code, 'const SERVICES_ASSERTION_CATEGORIES', 'async function servicesSemanticAudit')
      + ';return servicesVerifySemanticReport')();
    const base = { decision: { facts: [{ fact_id: 'f1', value: '10.00' }], approved_blocks: [{ key: 'b1' }] }, execution: { reservation: { status: 'not_attempted' }, payment_forward: { status: 'not_attempted' }, handoff: { executed: false } },
      proof: { available_starts: ['10:00'] }, semantic: { slots: { customer_name: 'Maria' } }, blocks: [{ key: 'b1', text: 'O preparo exige pele limpa e sem hidratante. Custa R$ 10,00.' }] };
    const report = (assertions, covers = true) => verify({ assertions, covers_entire_reply: covers }, base);
    const item = (category, support, reference = '', quote = '', text = 't') => ({ text, category, support, reference, quote });
    assert.equal(report([item('price', 'fact', 'f1', '10.00'), item('conversational', 'none'), item('availability', 'availability', '10:00'), item('service', 'customer_provided', 'customer_name')]).status, 'approved');
    assert.ok(report([item('price', 'fact', 'f1', '99.00')]).failures.includes('AUDIT_QUOTE_MISMATCH:fact'));
    assert.ok(report([item('preparation', 'block', 'b1', 'basta chegar de biquíni')]).failures.includes('AUDIT_QUOTE_MISMATCH:block'));
    assert.equal(report([item('preparation', 'block', 'b1', 'pele limpa e sem hidratante')]).status, 'approved');
    assert.ok(report([item('price', 'fact', 'f1', '10.00', 'custa R$ 12,00')]).failures.includes('AUDIT_ASSERTED_AMOUNT_NOT_IN_AUTHORITY'));
    assert.ok(report([item('availability', 'availability', '10:00', '', 'tem às 16:00')]).failures.includes('AUDIT_ASSERTED_TIME_NOT_IN_AUTHORITY'));
    assert.ok(report([item('health_safety', 'none')]).failures.includes('AUDIT_UNSUPPORTED_ASSERTION:health_safety'));
    assert.ok(report([item('result_promise', 'customer_provided', 'customer_name')]).failures.includes('AUDIT_UNSUPPORTED_ASSERTION:result_promise'));
    assert.ok(report([item('price', 'fact', 'f9')]).failures.includes('AUDIT_SUPPORT_NOT_FOUND:price:fact'));
    assert.ok(report([item('availability', 'availability', '16:00')]).failures.includes('AUDIT_SUPPORT_NOT_FOUND:availability:availability'));
    assert.ok(report([item('reservation', 'reservation_receipt')]).failures.includes('AUDIT_SUPPORT_NOT_FOUND:reservation:reservation_receipt'));
    assert.ok(report([item('handoff', 'handoff_execution')]).failures.includes('AUDIT_SUPPORT_NOT_FOUND:handoff:handoff_execution'));
    assert.ok(report([item('preparation', 'block', 'b9')]).failures.includes('AUDIT_SUPPORT_NOT_FOUND:preparation:block'));
    assert.ok(report([item('conversational', 'none')], false).failures.includes('AUDIT_COVERAGE_NOT_CONFIRMED'));
    assert.deepEqual(verify({ assertions: 'x' }, base).failures, ['AUDIT_REPORT_INVALID']);
  });

  test(`[${label}] saudação no meio da conversa não deixa resto truncado`, {
    skip: salonRewritten(label, code) && 'o Salon não corta saudação por lista: instrução na geração e remove_prefix no revisor (test_no_conversational_regex_nubia_salon.cjs)',
  }, () => {
    const strip = new Function(topFunction(code, 'removeMidConversationGreeting') + ';return removeMidConversationGreeting')();
    // Casos anteriores (test_booking_authorization.cjs) continuam valendo.
    assert.equal(strip('Oie, maravilhosa! ✨ Já conferi os horários pra você 💖', true), 'Já conferi os horários pra você 💖');
    assert.equal(strip('Oi, meu bem! 🌸 Claro, pode deixar!', true), 'Claro, pode deixar!');
    assert.equal(strip('Oie, maravilhosa! ✨ Como posso te ajudar hoje?', false), 'Oie, maravilhosa! ✨ Como posso te ajudar hoje?');
    assert.equal(strip('Oie, boa tarde, meu bem! Temos horário amanhã.', true), 'Temos horário amanhã.');
    assert.equal(strip('Oi, e tudo bem? Posso te ajudar com o agendamento.', true), 'Posso te ajudar com o agendamento.');
    assert.equal(strip('Oi! Qual serviço você quer?', true), 'Qual serviço você quer?');
    assert.equal(strip('Boa tarde, meu bem!', true), 'Boa tarde, meu bem!');
    assert.equal(strip('Olá, Ana, tudo bem?', true), 'Olá, Ana, tudo bem?');
    assert.equal(strip('Oi, tudo bem?', false), 'Oi, tudo bem?');
  });

  test(`[${label}] contexto de data informa o dia da semana`, () => {
    const build = new Function('tenantTimeZone', topFunction(code, 'buildDateContext') + ';return buildDateContext')(() => 'America/Sao_Paulo');
    const ctx = build({});
    const expected = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long' }).format(new Date());
    assert.equal(ctx.todayWeekday, expected);
    assert.ok(ctx.tomorrowWeekday && ctx.tomorrowWeekday !== ctx.todayWeekday);
    assert.match(code, /- Hoje: \$\{dateContext\.today\}\$\{dateContext\.todayWeekday \? ' \(' \+ dateContext\.todayWeekday \+ '\)' : ''\}/);
  });
}

// ---- Adaptador do Salon (embutido no export do Salon) ----------------------------------------------------------------------
function salonAdapter() {
  const code = engineCode(EXPORTS.salon);
  const src = code.slice(0, code.indexOf('const salonHelpers = createSalonHelpers('));
  const m = { exports: {} };
  new Function('module', src + '\nmodule.exports = { createSalonHelpers };')(m);
  return m.exports.createSalonHelpers;
}

async function runSalonCreation({ limit }) {
  const db = 'https://db.test';
  const tenant = '76aff8a0-0466-42b9-a80d-db186ff3d8bd';
  const jid = '5511999999999@s.whatsapp.net';
  // O nome completo só aparece no evento atual, ainda com ai_provider='buffer' durante o turno.
  const rows = [
    { id: 'e1', message_text: 'oi quero corte amanhã 10h', ai_provider: 'rules' },
    { id: 'cur', message_text: 'Maria Souza Lima', ai_provider: 'buffer' },
  ];
  const evidenceQueries = [];
  const helpers = {
    httpRequest: async options => {
      const address = options.url.split('?')[0];
      if (address === db + '/rest/v1/channel_events') {
        const query = new URLSearchParams(options.url.split('?')[1]);
        evidenceQueries.push(query);
        const excludesBuffer = String(query.get('or') || '').includes('ai_provider.neq.buffer');
        return rows.filter(row => !excludesBuffer || row.ai_provider !== 'buffer').map(row => ({ ...row }));
      }
      if (address === db + '/rest/v1/tenant_settings') return [{ settings: {} }];
      if (address === db + '/rest/v1/appointments') return [];
      if (address.includes('generativelanguage')) {
        const system = options.body.system_instruction.parts[0].text;
        if (system.includes('AGENDAMENTOS CONHECIDOS')) {
          return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '[AÇÃO: CRIAR_AGENDAMENTO | nome=Maria Souza Lima | servicos=Corte | data=2099-12-01 | hora=10:00]' }] } }] };
        }
        // Revisor simulado confirma a fala atual como evidência; só pode citar IDs que o adaptador ofereceu como candidatos.
        const offered = JSON.stringify(options.body).includes('cur');
        const verdict = { allowed: true, evidence_id: offered ? 'cur' : '', existing_acknowledged: true, deposit_acknowledged: true, remove_suffix: false };
        return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(verdict) }] } }] };
      }
      throw Error('unexpected ' + address);
    },
  };
  const input = { tenant_id: tenant, tenant_slug: 'ic_salon', instance: 'ic_saloon', noria_engine_phase: 'single', remoteJid: jid };
  const salon = salonAdapter()(helpers, input, { SUPABASE_URL: db });
  const history = db + '/rest/v1/channel_events?select=*&tenant_slug=eq.ic_salon&channel_type=eq.whatsapp&external_conversation_id=eq.'
    + encodeURIComponent(jid) + '&or=(ai_provider.is.null,ai_provider.neq.buffer)&order=created_at.desc,id.desc&limit=' + limit;
  await salon.httpRequest({ method: 'GET', url: history, headers: {} });
  const response = await salon.httpRequest({ method: 'POST', url: 'https://generativelanguage.googleapis.com/v1beta/models/x:generateContent',
    body: { system_instruction: { parts: [{ text: 'AGENDAMENTOS CONHECIDOS PELO SISTEMA REGRAS OPERACIONAIS CURTAS' }] }, contents: [{ role: 'user', parts: [{ text: 'Maria Souza Lima' }] }] } });
  return { text: response.candidates[0].content.parts[0].text, diagnostics: salon.salonAdapterDiagnostics(), evidenceQueries };
}

test('[salon] nome completo enviado só na mensagem atual (buffer) comprova o nome', async () => {
  const result = await runSalonCreation({ limit: 50 });
  assert.match(result.text, /CRIAR_AGENDAMENTO/, 'esperava a tag de criação, veio: ' + result.text);
  const evidence = result.evidenceQueries.find(query => query.get('select') === 'id,message_text');
  assert.ok(evidence, 'consulta de evidência não executada');
  // Escopo preservado: tenant, conversa, direção e remetente continuam filtrados.
  assert.equal(evidence.get('tenant_slug'), 'eq.ic_salon');
  assert.equal(evidence.get('direction'), 'eq.inbound');
  assert.equal(evidence.get('sender_type'), 'eq.contact');
  assert.ok(evidence.get('tenant_id'));
});

test('[salon] revisor exige que dia e hora tenham vindo do cliente', () => {
  const code = engineCode(EXPORTS.salon);
  assert.match(slice(code, 'async function review(', 'async function priceAudit('),
    /O horário atual do relógio ou o horário em que a mensagem chegou nunca é o horário pedido/);
});

// ---- EXT Núbia (export) --------------------------------------------------------------------------------------------------
const NUBIA_EXPORT = 'n8n/workflows/NORIA-EXT-Nubia-NB-Bronze-Catalogo-de-Servicos--6jSiEH2ugboYSack.json';
const NUBIA_CODES = {
  export: () => JSON.parse(fs.readFileSync(path.join(ROOT, NUBIA_EXPORT), 'utf8')).nodes.find(n => n.name === 'EXT | Serviços Núbia v2').parameters.jsCode,
  fonte: () => fs.readFileSync(path.join(ROOT, 'n8n/sources/nubia_extension.js'), 'utf8'),
};
let nubiaCode = NUBIA_CODES.export;
const TENANT = '563a93cd-a5c1-4412-a65f-be2e2d41bb88';
const TOKEN = '7c1f0a52-3b8e-4d6a-9f21-0a5b6c7d8e9f';
async function runNubia(semantic, sessionEvidence = []) {
  const settings = {
    whatsapp_processing_mode: 'conversation_core_v1', attendance_lifecycle: 'session_v2',
    payment_signal_enabled: true, appointment_payment_trigger: 'SINAL PAGO', payment: { deposit_percentage: 50 },
    appointment_scheduling: { enabled: true, duration_minutes: 90, units: { u1: { name: 'Unidade', capacities: { r_a: 2 } } }, service_resources: { svc_a: 'r_a', svc_b: 'r_a' } },
    business_facts: { service_guidance: { g_ai: { services: ['svc_a', 'svc_b'] } } },
    approved_messages: { enabled: true, revision: 'rev-x', catalog_prices: { svc_a: 10, svc_b: 20 }, blocks: {} },
  };
  const httpRequest = async ({ url }) => {
    if (url.includes('/tenants?')) return [{ id: TENANT, slug: 'clinica_nubia_oficial', status: 'active' }];
    if (url.includes('/channels?')) return [{ external_id: 'inst', status: 'active' }];
    if (url.includes('/tenant_settings?')) return [{ settings }];
    if (url.includes('/tenant_service_catalog?')) return [
      { external_id: 'svc_a', name: 'A', category: 'c', active: true, price: '10', metadata: {} },
      { external_id: 'svc_b', name: 'B', category: 'c', active: true, price: '20', metadata: {} }];
    if (url.includes('/follow_up_policies?')) return [{ enabled: true, steps: [{ key: 's1' }] }];
    throw new Error('unexpected request ' + url);
  };
  const input = { noria_phase: 'commercial_decision', noria_extension: 'nubia', noria_contract_version: '2.0', tenant_id: TENANT, tenant_slug: 'clinica_nubia_oficial',
    instance: 'inst', remoteJid: '5500@s.whatsapp.net',
    turn: { claimed: true, contract: 'noria_turn_lifecycle_v1', tenant_slug: 'clinica_nubia_oficial', instance: 'inst', token: TOKEN, boundary_id: 'initial', messages: [{ event_id: 'm1', text: 'pode ser dia 15 às 10h' }] },
    noria_business_context: { session_id: 'initial', request_id: 'm1:' + TOKEN },
    session_evidence: sessionEvidence,
    semantic_intent: { contract: 'noria_services_semantic_intent_v1', confidence: 'high', evidence_ids: ['m1'], secondary_intents: [], services: [], info_requests: [], slots: {},
      payment: { declared: false }, human: { requested: false }, conversation: { topic_change: false, requires_clarification: false }, customer_disposition: { value: 'active' }, ambiguities: [], ...semantic } };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const out = await new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', nubiaCode()).call({ helpers: { httpRequest } }, input,
    { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'k' }, {}, () => ({}));
  return out.json.commercial_decision;
}
const earlier = [{ id: 's0', text: 'quero o serviço A', direction: 'inbound', sender_type: 'contact', session_id: 'initial' }];
const slotsNow = { unit_id: 'u1', date: '2030-01-15', time: '10:00', evidence_ids: ['m1'] };

for (const [variant, load] of Object.entries(NUBIA_CODES)) {
test(`[nubia ${variant}] serviço escolhido no turno anterior da mesma sessão + dia/hora agora consulta disponibilidade`, async () => {
  nubiaCode = load;
  const d = await runNubia({ primary_intent: 'availability_request', services: [{ service_id: 'svc_a', role: 'selected', evidence_ids: ['s0'], session_id: 'initial' }], slots: slotsNow }, earlier);
  assert.equal(d.status, 'ok', JSON.stringify(d.errors || d.semantic_errors || d));
  assert.equal(d.actions.check_availability.allowed, true, JSON.stringify(d.actions.check_availability));
  assert.equal(d.actions.check_availability.params.service_id, 'svc_a');
});

test(`[nubia ${variant}] escolha atual prevalece sobre escolha anterior da sessão`, async () => {
  nubiaCode = load;
  const d = await runNubia({ primary_intent: 'availability_request', slots: slotsNow, services: [
    { service_id: 'svc_a', role: 'selected', evidence_ids: ['s0'], session_id: 'initial' },
    { service_id: 'svc_b', role: 'selected', evidence_ids: ['m1'] }] }, earlier);
  assert.equal(d.actions.check_availability.params?.service_id, 'svc_b');
});

test(`[nubia ${variant}] escolha de outra sessão continua recusada; intenção acionável continua exigindo mensagem atual`, async () => {
  nubiaCode = load;
  const other = await runNubia({ primary_intent: 'availability_request', services: [{ service_id: 'svc_a', role: 'selected', evidence_ids: ['s0'], session_id: 'outra' }], slots: slotsNow }, earlier);
  assert.equal(other.actions.check_availability.allowed, false);
  const stale = await runNubia({ primary_intent: 'availability_request', evidence_ids: ['s0'], services: [{ service_id: 'svc_a', role: 'selected', evidence_ids: ['s0'], session_id: 'initial' }], slots: slotsNow }, earlier);
  assert.equal(stale.actions.check_availability.allowed, false);
});
}

test('[salon] histórico em grounding canonical_v2 (limit=251) não derruba a evidência', async () => {
  const result = await runSalonCreation({ limit: 251 });
  assert.match(result.text, /CRIAR_AGENDAMENTO/);
});

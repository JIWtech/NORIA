// Modo appointment_request no caminho legado do CORE: a IA registra o pedido sem travar, a cliente pode mudar ou
// cancelar, o dono é quem confirma. Com o modo desligado nada muda. Os textos vêm da configuração do tenant.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const code = fs.readFileSync(path.join(__dirname, '../n8n/code/whatsapp_conversation_core.generated.js'), 'utf8');
const execute = new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', code);

const CHAT = '5511111111111@s.whatsapp.net';
const services = [
  { external_id: 'corte', name: 'Corte', category: 'Cabelo', description: 'Corte', price: 50, billing_unit: 'sessao', estimated_hours: 1 },
  { external_id: 'escova', name: 'Escova', category: 'Cabelo', description: 'Escova', price: 40, billing_unit: 'sessao', estimated_hours: 0.5 },
  { external_id: 'drenagem', name: 'Drenagem', category: 'Corpo', description: 'Drenagem', price: 90, billing_unit: 'sessao', estimated_hours: null },
];
const mode = {
  mode: 'operator_confirmation',
  received_template: 'Anotei, {nome}: {servicos}, {data}, às {hora}. A equipe vai confirmar.',
  confirmation_template: 'Confirmado.',
  slot_rejected_template: 'Indisponível.',
};
const CREATE = 'Certo [ACAO: CRIAR_AGENDAMENTO|nome=Maria Silva|servico=Corte|data=2099-09-29|hora=10:00|status=pending_confirmation]';
const open = {
  id: 'a-open', status: 'pending_confirmation', title: 'Corte - Maria Silva', contact_name: 'Maria Silva', starts_at: '2099-09-29T13:00:00Z',
  created_at: '2099-01-01T00:00:00Z', metadata: { services: ['Corte'], customer_name: 'Maria Silva', requested_date: '2099-09-29', requested_time: '10:00', request_version: 1 },
};

async function run({ response = CREATE, request = mode, extra = {}, appointments = [], texts = ['Quero marcar'], rpcError = null } = {}) {
  const calls = [], events = [], rpc = [], posted = [];
  let sent = 0, sentText = '';
  const input = {
    tenant_id: 't-salon', tenant_slug: 'salon', remoteJid: CHAT, instance: 'salon',
    noria_client_policy: {
      contract: 'noria_policy_v2', tenant_id: 't-salon', tenant_slug: 'salon', profile: 'services_booking_v2', capability: 'standard',
      audio_enabled: false, scheduling_enabled: false, modules: { turn_pipeline: { contract: 'noria_turn_pipeline_v1' } },
    },
  };
  const environment = {
    SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'fake', GEMINI_ENABLED: 'true', GEMINI_API_KEY: 'fake',
    EVOLUTION_API_URL_SALON: 'https://evo.test', EVOLUTION_API_KEY_SALON: 'fake', EVOLUTION_INSTANCE_SALON: 'salon', NORIA_INGRESS_FORWARD_TOKEN_SALON: 'fake',
  };
  const settings = {
    whatsapp_processing_mode: 'conversation_core_v1', ai_model: 'gemini-2.5-flash-lite', ai_enabled: true, system_prompt: 'Atendente do salão',
    timezone: 'America/Sao_Paulo', gemini_daily_limit: 80, payment: { enabled: false }, ...extra,
  };
  if (request) settings.appointment_request = request;
  const httpRequest = async ({ method, url, body }) => {
    const u = new URL(url); calls.push({ method, url, body });
    if (u.hostname === 'evo.test') { sent++; sentText = body.text; return { key: { id: 'sent-1' } }; }
    if (u.hostname === 'generativelanguage.googleapis.com') return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: response }] } }], usageMetadata: {} };
    assert.equal(u.hostname, 'db.test');
    const table = u.pathname.split('/').at(-1);
    if (table === 'magia_turn_suppression_status') return { contract: 'noria_turn_lifecycle_v1', evidence: {} };
    if (table === 'magia_gemini_reserve') return { allowed: true };
    if (table === 'magia_gemini_release' || table === 'magia_gemini_commit') return {};
    if (table === 'contacts' || table === 'conversation_turn_queue') return [];
    if (table === 'magia_turn_lifecycle_status') return { ready: true, contract: 'noria_turn_lifecycle_v1' };
    if (table === 'magia_claim_turn') return { claimed: true, contract: 'noria_turn_lifecycle_v1', token: 'claim-1', boundary_id: 'initial', messages: texts.map((text, i) => ({ event_id: 'e' + i, id: 'm' + i, text, name: 'Maria', received_at: '2026-11-06T12:00:00Z' })) };
    if (table === 'magia_begin_turn_delivery') return { id: 'delivery-attempt-1', delivery_attempt_id: 'delivery-attempt-1', dispatch_allowed: true, contract: 'noria_turn_lifecycle_v1' };
    if (table === 'magia_confirm_turn_delivery') return { confirmed: true, contract: 'noria_turn_lifecycle_v1' };
    if (table === 'magia_merge_channel_event_raw') return { applied: true };
    if (table === 'magia_commit_turn') return { committed: true, contract: 'noria_turn_lifecycle_v1' };
    if (table === 'magia_finish_turn') return { finished: true, contract: 'noria_turn_lifecycle_v1', outcome: body.p_outcome };
    if (table === 'magia_upsert_appointment_request') {
      rpc.push({ name: table, body });
      if (rpcError) throw Object.assign(new Error('Request failed with status code 400'), { response: { data: { message: rpcError } } });
      return { appointment: { id: 'a-new', status: 'pending_confirmation', contact_name: body.p_contact, starts_at: body.p_starts_at, metadata: { ...body.p_details, request_version: 1 } }, created: true };
    }
    if (table === 'magia_cancel_appointment_request') { rpc.push({ name: table, body }); return { cancelled: true }; }
    if (table === 'tenants') return [{ id: 't-salon', slug: 'salon', status: 'active', name: 'Salão' }];
    if (table === 'tenant_settings') return [{ timezone: 'America/Sao_Paulo', settings }];
    if (table === 'ai_agents') return [{ model: 'gemini-2.5-flash-lite', max_tokens: 500, temperature: 0.45 }];
    if (table === 'channels') return [{ external_id: 'salon' }];
    if (table === 'tenant_service_catalog' || table === 'search_tenant_service_catalog') return services;
    if (table === 'channel_events') {
      if (method === 'PATCH' || method === 'POST') { events.push(body); return [{ id: 'out' }]; }
      return [];
    }
    if (table === 'appointments') {
      if (method === 'POST') { posted.push(body); return [{ id: 'a-legacy', ...body }]; }
      if (u.searchParams.get('status') === 'eq.pending_confirmation') return appointments.filter(a => a.status === 'pending_confirmation');
      return appointments;
    }
    throw Error('Unexpected ' + method + ' ' + u.pathname);
  };
  const usage = {};
  const result = await execute.call({ helpers: { httpRequest } }, input, environment, {}, () => usage);
  const prompt = JSON.stringify(calls.find(c => c.url.includes('generateContent'))?.body || {});
  return { result: result.json, calls, events, rpc, posted, sent, sentText, prompt };
}

test('a tag registra o pedido sem travar e responde com o modelo do tenant', async () => {
  const r = await run();
  assert.equal(r.result.ok, true, JSON.stringify(r.result));
  assert.equal(r.rpc.length, 1);
  assert.equal(r.rpc[0].body.p_tenant, 't-salon');
  assert.equal(r.rpc[0].body.p_chat, CHAT);
  assert.equal(r.posted.length, 0);
  assert.equal(r.sentText, 'Anotei, Maria Silva: Corte, terça-feira, 29 de setembro, às 10:00. A equipe vai confirmar.');
  const saved = r.events.find(e => e.service === 'agendamento_pendente');
  assert.ok(saved, 'evento do pedido');
  assert.equal(saved.handoff === true, false);
  assert.equal(saved.stage, 'Aguardando confirmação');
});

test('sem sinal: o pedido nunca nasce aguardando pagamento', async () => {
  const r = await run();
  assert.doesNotMatch(r.sentText, /sinal|pagamento/i);
  assert.ok(!r.events.some(e => e.stage === 'Aguardando sinal' || e.stage === 'Agendamento confirmado'));
});

test('vários serviços somam a duração do catálogo', async () => {
  const r = await run({ response: 'Ok [ACAO: CRIAR_AGENDAMENTO|nome=Maria Silva|servicos=Corte;Escova|data=2099-09-29|hora=10:00|profissional=Ana|primeira_vez=sim|status=pending_confirmation]' });
  const body = r.rpc[0].body;
  assert.deepEqual(body.p_details.services, ['Corte', 'Escova']);
  assert.equal(body.p_details.professional, 'Ana');
  assert.equal(body.p_details.first_visit, 'sim');
  assert.equal(Date.parse(body.p_ends_at) - Date.parse(body.p_starts_at), 90 * 60000);
});

test('serviço sem duração no catálogo deixa o fim vazio; a duração da tag é ignorada', async () => {
  const r = await run({ response: 'Ok [ACAO: CRIAR_AGENDAMENTO|nome=Maria Silva|servico=Drenagem|data=2099-09-29|hora=10:00|duracao=30|status=pending_confirmation]' });
  assert.equal(r.rpc[0].body.p_ends_at, null);
});

test('dados inválidos não gravam nada', async () => {
  for (const response of [
    'Ok [ACAO: CRIAR_AGENDAMENTO|nome=Maria|servico=Corte|data=2099-09-29|hora=10:00|status=pending_confirmation]',
    'Ok [ACAO: CRIAR_AGENDAMENTO|nome=Maria Silva|servico=Inexistente|data=2099-09-29|hora=10:00|status=pending_confirmation]',
    'Ok [ACAO: CRIAR_AGENDAMENTO|nome=Maria Silva|servico=Corte|data=2001-09-29|hora=10:00|status=pending_confirmation]',
  ]) {
    const r = await run({ response });
    assert.equal(r.rpc.length, 0, response);
    assert.equal(r.posted.length, 0, response);
  }
});

test('a IA não confirma: AGENDAMENTO_CONFIRMADO e outros status são recusados', async () => {
  for (const response of [
    'Ok [ACAO: AGENDAMENTO_CONFIRMADO|nome=Maria Silva|servico=Corte|data=2099-09-29|hora=10:00]',
    'Ok [ACAO: CRIAR_AGENDAMENTO|nome=Maria Silva|servico=Corte|data=2099-09-29|hora=10:00|status=confirmed]',
    'Ok [ACAO: CRIAR_AGENDAMENTO|nome=Maria Silva|servico=Corte|data=2099-09-29|hora=10:00]',
  ]) {
    const r = await run({ response });
    assert.equal(r.rpc.length, 0, response);
    assert.equal(r.posted.length, 0, response);
    assert.doesNotMatch(r.sentText, /\[ACAO/);
  }
});

test('ATUALIZAR_PEDIDO mantém o que não mudou', async () => {
  const r = await run({ appointments: [open], response: 'Ok [ACAO: ATUALIZAR_PEDIDO|hora=15:00]' });
  const body = r.rpc[0].body;
  assert.equal(body.p_contact, 'Maria Silva');
  assert.deepEqual(body.p_details.services, ['Corte']);
  assert.equal(body.p_details.requested_time, '15:00');
  assert.match(r.sentText, /às 15:00/);
});

test('ATUALIZAR_PEDIDO sem pedido aberto não grava', async () => {
  const r = await run({ response: 'Ok [ACAO: ATUALIZAR_PEDIDO|hora=15:00]' });
  assert.equal(r.rpc.length, 0);
});

test('CANCELAR_PEDIDO cancela e mantém o texto da IA sem a tag', async () => {
  const r = await run({ appointments: [open], response: 'Tudo bem, cancelei seu pedido. [ACAO: CANCELAR_PEDIDO]' });
  assert.equal(r.rpc[0].name, 'magia_cancel_appointment_request');
  assert.equal(r.rpc[0].body.p_reason, 'customer_cancelled');
  assert.equal(r.sentText, 'Tudo bem, cancelei seu pedido.');
  assert.ok(!r.events.some(e => e.handoff === true));
});

test('CANCELAR_PEDIDO sem texto não cancela sem avisar a cliente', async () => {
  const r = await run({ appointments: [open], response: '[ACAO: CANCELAR_PEDIDO]' });
  assert.equal(r.rpc.length, 0);
});

test('o pedido chega à IA como pendente, nunca como confirmado', async () => {
  const r = await run({ appointments: [open], response: 'A equipe vai confirmar.' });
  assert.match(r.prompt, /pedido_pendente/);
  assert.match(r.prompt, /\\"confirmado\\":null/);
  assert.equal(r.sentText, 'A equipe vai confirmar.');
  assert.equal(r.rpc.length, 0);
});

test('pedido vencido não vira agendamento passado para a IA', async () => {
  const stale = { ...open, starts_at: '2020-01-01T13:00:00Z' };
  const r = await run({ appointments: [stale], response: 'Ok' });
  assert.match(r.prompt, /\\"passado\\":null/);
  assert.match(r.prompt, /pedido_pendente/);
});

test('pedido de atendente vence a tag: trava e não grava', async () => {
  const r = await run({ response: 'Vou chamar a equipe. [HUMANO_SOLICITADO] ' + CREATE });
  assert.equal(r.rpc.length, 0);
  assert.ok(r.events.some(e => e.handoff === true));
});

test('pedido em envio chama a equipe', async () => {
  const r = await run({ appointments: [open], rpcError: 'APPOINTMENT_REQUEST_BUSY' });
  assert.ok(r.events.some(e => e.handoff === true));
  assert.ok(r.events.some(e => e.ai_error === 'appointment_not_created'));
});

test('modelo ausente não grava e chama a equipe', async () => {
  const r = await run({ request: { ...mode, received_template: '' } });
  assert.equal(r.rpc.length, 0);
  assert.equal(r.posted.length, 0);
  assert.ok(r.events.some(e => e.handoff === true));
});

test('caminho com agenda própria não grava pedido', async () => {
  const r = await run({ extra: { appointment_scheduling: { enabled: true } } });
  assert.equal(r.rpc.length, 0);
  assert.equal(r.posted.length, 0);
});

test('modelo com variável desconhecida não sai para a cliente', async () => {
  const r = await run({ request: { ...mode, received_template: 'Oi {apelido}' } });
  assert.doesNotMatch(r.sentText, /\{apelido\}/);
});

test('modo desligado: as tags novas não têm efeito e a criação segue como antes', async () => {
  const update = await run({ request: null, response: 'Ok [ACAO: CANCELAR_PEDIDO]' });
  assert.equal(update.rpc.length, 0);
  assert.doesNotMatch(update.sentText, /\[ACAO/);
  const created = await run({ request: null, response: 'Ok [ACAO: CRIAR_AGENDAMENTO|nome=Maria Silva|servico=Corte|data=2099-09-29|hora=10:00]' });
  assert.equal(created.rpc.length, 0);
  assert.equal(created.posted.length, 1);
  assert.equal(created.posted[0].status, 'pending_payment');
  assert.doesNotMatch(created.prompt, /pedido_pendente/);
});

// 09/11/2026 (I&C): a resposta do Gemini tinha só marcações; depois de limpar, o texto ficou vazio e a Evolution recusou o
// envio com 400. A cliente ficou sem resposta e a conversa caiu em erro técnico.
test('resposta só com pedido de atendente envia o aviso de encaminhamento, nunca texto vazio', async () => {
  const r = await run({ response: '[HUMANO_SOLICITADO]' });
  assert.equal(r.result.ok, true, JSON.stringify(r.result));
  assert.equal(r.sent, 1);
  assert.ok(r.sentText.trim().length > 0, 'texto enviado não pode ser vazio');
  assert.ok(r.events.some(e => e.handoff === true));
});

test('resposta vazia sem encaminhamento não é enviada', async () => {
  const r = await run({ response: '[ACAO: CANCELAR_PEDIDO]', request: null });
  assert.equal(r.sent, 0, 'nada é enviado à Evolution');
  assert.equal(r.result.ok, false);
});

test('o evento registra quais marcações a IA devolveu, sem o texto', async () => {
  const r = await run({ response: 'Vou chamar a equipe. [HUMANO_SOLICITADO] ' + CREATE });
  const saved = r.events.find(e => e.raw_payload && e.raw_payload.reply_actions);
  assert.ok(saved, 'diagnóstico gravado');
  assert.deepEqual(saved.raw_payload.reply_actions, { human_requested: true, complaint: false, appointment_tag: 'create', text_empty: false });
});

// 09/11/2026 (I&C): o CORE ensinava ao Gemini o agendamento com sinal (status=pending_payment, "pendente do sinal") mesmo
// no modo de pedido com confirmação do dono, que recusa esse formato. A instrução de agendamento segue o modo do tenant.
test('no modo de pedido, o Gemini aprende o formato do pré-agendamento, sem sinal', async () => {
  const r = await run({ response: 'Qual horário você prefere?' });
  assert.match(r.prompt, /status=pending_confirmation/);
  assert.doesNotMatch(r.prompt, /pendente do sinal/);
  assert.doesNotMatch(r.prompt, /status=pending_payment/);
});

test('sem o modo de pedido, a instrução de agendamento continua a de antes', async () => {
  const r = await run({ request: null, response: 'Qual horário você prefere?' });
  assert.match(r.prompt, /pendente do sinal/);
  assert.match(r.prompt, /status=pending_payment/);
  assert.doesNotMatch(r.prompt, /status=pending_confirmation/);
});

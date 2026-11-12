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
  created_at: '2099-01-01T00:00:00Z', updated_at: '2099-01-01T00:01:00Z',
  metadata: { services: ['Corte'], customer_name: 'Maria Silva', requested_date: '2099-09-29', requested_time: '10:00', request_version: 1 },
};

async function run({ response = CREATE, request = mode, extra = {}, appointments = [], history = [], texts = ['Quero marcar'],
  rpcError = null, suppression = {}, boundary = null, replaceBeforeWrite = null } = {}) {
  const calls = [], events = [], rpc = [], posted = [], patched = [];
  let sent = 0, sentText = '', generations = 0;
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
    if (u.hostname === 'generativelanguage.googleapis.com') {
      const text = Array.isArray(response) ? response[generations++] : response;
      return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }], usageMetadata: {} };
    }
    assert.equal(u.hostname, 'db.test');
    const table = u.pathname.split('/').at(-1);
    if (table === 'magia_turn_suppression_status') return { contract: 'noria_turn_lifecycle_v1', evidence: suppression };
    if (table === 'magia_gemini_reserve') return { allowed: true };
    if (table === 'magia_gemini_release' || table === 'magia_gemini_commit') return {};
    if (table === 'contacts' || table === 'conversation_turn_queue') return [];
    if (table === 'magia_turn_lifecycle_status') return { ready: true, contract: 'noria_turn_lifecycle_v1' };
    if (table === 'magia_claim_turn') return { claimed: true, contract: 'noria_turn_lifecycle_v1', token: 'claim-1', boundary_id: boundary?.id || 'initial', messages: texts.map((text, i) => ({ event_id: 'e' + i, id: 'm' + i, text, name: 'Maria', received_at: '2026-11-06T12:00:00Z' })) };
    if (table === 'magia_begin_turn_delivery') return { id: 'delivery-attempt-1', delivery_attempt_id: 'delivery-attempt-1', dispatch_allowed: true, contract: 'noria_turn_lifecycle_v1' };
    if (table === 'magia_confirm_turn_delivery') return { confirmed: true, contract: 'noria_turn_lifecycle_v1' };
    if (table === 'magia_merge_channel_event_raw') return { applied: true };
    if (table === 'magia_commit_turn') return { committed: true, contract: 'noria_turn_lifecycle_v1' };
    if (table === 'magia_finish_turn') return { finished: true, contract: 'noria_turn_lifecycle_v1', outcome: body.p_outcome };
    if (table === 'magia_fail_turn') return { finished: true, contract: 'noria_turn_lifecycle_v1', outcome: 'review' };
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
      if (u.searchParams.get('or') === '(ai_provider.is.null,ai_provider.neq.buffer)') return [...history];
      if (boundary && u.searchParams.get('or')?.includes('service.eq.conversation_closed')) return [boundary];
      return [];
    }
    if (table === 'appointments') {
      if (method === 'PATCH') {
        if (replaceBeforeWrite) appointments = replaceBeforeWrite;
        const target = appointments.find(a => a.status === 'pending_confirmation'
          && u.searchParams.get('id') === 'eq.' + a.id && u.searchParams.get('updated_at') === 'eq.' + a.updated_at
          && u.searchParams.get('metadata->>request_version') === 'eq.' + a.metadata.request_version
          && !a.metadata.confirmation_state);
        if (!target) return [];
        patched.push(body);
        return [{ ...target, ...body }];
      }
      if (method === 'POST') {
        if (replaceBeforeWrite) {
          appointments = replaceBeforeWrite;
          if (body.status === 'pending_confirmation' && appointments.some(a => a.status === 'pending_confirmation')) {
            throw Object.assign(new Error('Request failed with status code 409'), {
              response: { data: { code: '23505', message: 'duplicate key violates unique constraint "appointments_one_open_request_idx"' } },
            });
          }
        }
        posted.push(body);
        return [{ id: 'a-legacy', ...body }];
      }
      if (u.searchParams.get('status') === 'eq.pending_confirmation') return appointments.filter(a => a.status === 'pending_confirmation');
      if (u.searchParams.has('created_at')) return appointments.filter(a => a.created_at > u.searchParams.get('created_at').slice(3));
      return appointments;
    }
    throw Error('Unexpected ' + method + ' ' + u.pathname);
  };
  const usage = {};
  const result = await execute.call({ helpers: { httpRequest } }, input, environment, {}, () => usage);
  const prompt = JSON.stringify(calls.find(c => c.url.includes('generateContent'))?.body || {});
  return { result: result.json, calls, events, rpc, posted, patched, sent, sentText, prompt };
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

const manualReplyOnly = { ...mode, team_review_control: 'manual_reply' };
const contextualReplies = { ...manualReplyOnly, reply_mode: 'contextual' };

test('agradecimento com tag repetida mantém versão e deixa o Gemini responder sem repetir o recibo', async () => {
  const pending = { ...open, metadata: { ...open.metadata, services: ['Escova', 'Corte'], request_version: 2 } };
  const repeat = 'Anotado! [ACAO: CRIAR_AGENDAMENTO|nome=Maria Silva|servicos=Corte;Escova|data=2099-09-29|hora=10:00|status=pending_confirmation]';
  const reply = 'Por nada! Se precisar de mais alguma coisa, é só chamar.';
  const receipt = 'Recebi o pedido de corte e escova às 10h. A equipe vai confirmar.';
  const r = await run({ request: contextualReplies, appointments: [pending], texts: ['Muito obrigado'], response: [repeat, reply],
    history: [{ direction: 'outbound', sender_type: 'assistant', message_text: receipt }] });
  assert.equal(r.result.ok, true);
  assert.deepEqual(r.rpc, []);
  assert.equal(r.sentText, reply);
  assert.match(r.prompt, /reconhecimento|agradecimento/);
  assert.ok(r.prompt.includes(receipt));
});

test('pedido pendente com mudança real continua atualizando e usa o recibo de atualização configurado', async () => {
  const request = { ...contextualReplies, updated_template: 'Horário solicitado atualizado para {hora}. A equipe ainda vai confirmar.' };
  const r = await run({ request, appointments: [open], response: 'Ok [ACAO: ATUALIZAR_PEDIDO|hora=11:30]' });
  assert.equal(r.patched.length, 1);
  assert.equal(r.patched[0].metadata.requested_time, '11:30');
  assert.equal(r.patched[0].metadata.request_version, 2);
  assert.equal(r.sentText, 'Horário solicitado atualizado para 11:30. A equipe ainda vai confirmar.');
});

test('edição obsoleta não cria pedido após a equipe confirmar', async () => {
  const original = { ...open, status: 'confirmed' };
  const reply = 'A equipe vai verificar se é possível ajustar para esse horário.';
  const r = await run({ request: contextualReplies, appointments: [open], replaceBeforeWrite: [original],
    response: ['Mudei. [ACAO: ATUALIZAR_PEDIDO|hora=11:30]', reply] });
  assert.deepEqual(r.patched, []);
  assert.deepEqual(r.posted, []);
  assert.equal(r.sentText, reply);
  assert.ok(r.events.some(e => e.raw_payload?.team_review_requested && !e.handoff));
});

test('pedido concorrente criado depois da leitura não é sobrescrito', async () => {
  const reply = 'Já existe um pedido em análise e a equipe vai verificar os horários.';
  const r = await run({ request: contextualReplies, replaceBeforeWrite: [open], response: [CREATE, reply] });
  assert.deepEqual(r.posted, []);
  assert.deepEqual(r.patched, []);
  assert.deepEqual(r.rpc, []);
  assert.equal(r.sentText, reply);
});

test('cancelamento sem pedido aberto reformula sem afirmar sucesso', async () => {
  const reply = 'Vou pedir à equipe para verificar a situação do agendamento.';
  const r = await run({ request: contextualReplies, response: ['Cancelei. [ACAO: CANCELAR_PEDIDO]', reply] });
  assert.deepEqual(r.patched, []);
  assert.deepEqual(r.rpc, []);
  assert.equal(r.sentText, reply);
});

test('cancelamento obsoleto não cancela o pedido substituto nem afirma que cancelou', async () => {
  const reply = 'Vou pedir à equipe para verificar qual reserva pode ser cancelada.';
  const r = await run({ request: contextualReplies, appointments: [open],
    replaceBeforeWrite: [{ ...open, id: 'outro-pedido' }], response: ['Cancelei. [ACAO: CANCELAR_PEDIDO]', reply] });
  assert.deepEqual(r.patched, []);
  assert.deepEqual(r.rpc, []);
  assert.equal(r.sentText, reply);
});

test('cancelamento pendente só é comunicado após alterar a reserva correta', async () => {
  const r = await run({ request: contextualReplies, appointments: [open], response: 'Cancelei seu pedido. [ACAO: CANCELAR_PEDIDO]' });
  assert.equal(r.patched[0].status, 'cancelled');
  assert.equal(r.sentText, 'Cancelei seu pedido.');
  assert.ok(r.events.some(e => e.service === 'agendamento_cancelado'));
});

test('reparo ignora recibo igual ao histórico ou com tag e tenta uma nova redação', async () => {
  const receipt = 'Seu pedido de corte para 10:00 aguarda confirmação.';
  const repeat = receipt + ' ' + CREATE.slice(CREATE.indexOf('['));
  for (const second of [receipt, repeat]) {
    const reply = 'Por nada!';
    const r = await run({ request: contextualReplies, appointments: [open], texts: ['Muito obrigado'],
      history: [{ direction: 'outbound', message_text: receipt }], response: [repeat, second, reply] });
    assert.equal(r.sentText, reply);
    assert.equal(r.sent, 1);
    assert.deepEqual(r.posted, []);
    assert.deepEqual(r.patched, []);
  }
});

test('reabrir o chat do César mantém o agendamento futuro confirmado no contexto', async () => {
  const prior = { ...open, status: 'confirmed', title: 'Pé e mão tradicional', created_at: '2026-11-06T11:00:00Z',
    metadata: { ...open.metadata, conversation_session_id: 'initial', services: ['Pé e mão tradicional'] } };
  const reply = 'Vou verificar com a equipe se dá para incluir a escova no mesmo horário.';
  const r = await run({ request: contextualReplies, appointments: [prior], boundary: { id: 'reaberta', created_at: '2026-11-06T11:30:00Z' },
    texts: ['Consigo fazer uma escova nesse mesmo horario?'], response: [reply + ' [ACAO: ATUALIZAR_PEDIDO|servicos=Escova]', reply] });
  assert.match(r.prompt, /Pé e mão tradicional/);
  assert.equal(r.sentText, reply);
  assert.deepEqual(r.posted, []);
  assert.deepEqual(r.patched, []);
  assert.ok(r.events.some(e => e.raw_payload?.team_review_requested && !e.handoff));
});

test('reserva confirmada e pedido pendente no mesmo horário exigem identificação do pedido para editar', async () => {
  const confirmed = { ...open, id: 'confirmado', status: 'confirmed', title: 'Pé e mão tradicional' };
  const reply = 'A equipe vai conferir a inclusão no agendamento confirmado.';
  const ambiguous = await run({ request: contextualReplies, appointments: [open, confirmed],
    response: ['Anotei [ACAO: ATUALIZAR_PEDIDO|servicos=Escova]', reply] });
  assert.equal(ambiguous.sentText, reply);
  assert.deepEqual(ambiguous.patched, []);
  const explicit = await run({ request: contextualReplies, appointments: [open, confirmed],
    response: 'Anotei [ACAO: ATUALIZAR_PEDIDO|pedido=a-open|servicos=Escova]' });
  assert.equal(explicit.patched.length, 1);
  assert.deepEqual(explicit.patched[0].metadata.services, ['Escova']);
});

test('reprodução do César: pedido de incluir escova em horário confirmado vai à equipe sem pausar a IA', async () => {
  const confirmed = { ...open, status: 'confirmed', title: 'Pé e mão tradicional', metadata: { ...open.metadata, services: ['Pé e mão tradicional'] } };
  const rewritten = 'Vou pedir à equipe para verificar se dá para incluir a escova no mesmo horário.';
  const r = await run({ request: manualReplyOnly, appointments: [confirmed], texts: ['Consigo fazer uma escova nesse mesmo horário?'],
    response: ['Acrescentei a escova. [ACAO: ATUALIZAR_PEDIDO|servicos=Escova]', rewritten] });
  assert.equal(r.result.ok, true);
  assert.equal(r.sentText, rewritten);
  assert.deepEqual(r.rpc, []);
  assert.deepEqual(r.posted, []);
  const review = r.events.find(e => e.raw_payload?.team_review_requested === true);
  assert.ok(review);
  assert.equal(review.handoff, false);
  assert.ok(!review.ai_error);
  assert.match(r.prompt, /pedido_pendente/);
});

test('encaminhamento da IA com revisão sem bloqueio mantém o diálogo e evita escrever um pedido concorrente', async () => {
  const r = await run({ request: manualReplyOnly, response: 'Vou encaminhar à equipe. [HUMANO_SOLICITADO] ' + CREATE.slice(CREATE.indexOf('[')) });
  assert.deepEqual(r.rpc, []);
  assert.equal(r.sentText, 'Vou encaminhar à equipe.');
  assert.ok(r.events.some(e => e.raw_payload?.team_review_requested === true && e.handoff === false));
  const next = await run({ request: manualReplyOnly, texts: ['Qual é o endereço?'], response: 'O endereço consta no nosso perfil.' });
  assert.equal(next.sent, 1);
});

test('mensagem manual com prova de controle continua impedindo o próximo envio automático', async () => {
  for (const origin of ['noria', 'whatsapp']) {
    const r = await run({ request: manualReplyOnly, suppression: { human_control: { kind: 'human_control', event_id: `manual-${origin}` } } });
    assert.equal(r.sent, 0);
    assert.ok(!r.calls.some(c => c.url.includes('generateContent')));
  }
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

// 09/11/2026 (I&C): a IA marcou o serviço com outro nome ("Corte cabelo" em vez de "Corte"); o pedido só aceita o nome
// exato do catálogo e foi recusado sem dizer por quê. A instrução lista os nomes do catálogo do tenant e o erro diz o que não bateu.
test('no modo de pedido, a instrução lista os nomes exatos do catálogo para o campo servicos', async () => {
  const r = await run({ response: 'Qual horário você prefere?' });
  assert.match(r.prompt, /servicos.*somente nomes exatos[^\n]*Corte; Escova; Drenagem/);
});

test('serviço fora do catálogo: o erro registra qual nome não bateu, sem criar pedido', async () => {
  const r = await run({ response: '[ACAO: CRIAR_AGENDAMENTO|nome=Maria Silva|servicos=Corte cabelo;Escova|data=2099-09-29|hora=10:00|status=pending_confirmation]' });
  const ev = r.events.find(e => e.raw_payload?.appointment_request);
  assert.match(ev.raw_payload.appointment_request.failed, /^Invalid appointment details/);
  assert.match(ev.raw_payload.appointment_request.failed, /unknown_services=Corte cabelo(?!;Escova)/);
  assert.equal(ev.raw_payload.appointment_request.appointment_id, undefined);
});

// 09/11/2026: no modo de pedido, as frases de nova tentativa (nome completo e dados do pedido) eram texto fixo no CORE.
// Agora vêm de appointment_request no Supabase, como as de pedido recebido e confirmado. Sem a frase configurada, decide uma pessoa.
const BAD_SERVICE = '[ACAO: CRIAR_AGENDAMENTO|nome=Maria Silva|servicos=Corte cabelo|data=2099-09-29|hora=10:00|status=pending_confirmation]';
const SHORT_NAME = '[ACAO: CRIAR_AGENDAMENTO|nome=Maria|servicos=Corte|data=2099-09-29|hora=10:00|status=pending_confirmation]';
const retryMode = { ...mode, invalid_request_template: 'TPL dados do pedido', full_name_template: 'TPL nome completo' };

test('pedido recusado: a frase de nova tentativa vem da configuração do tenant', async () => {
  const r = await run({ request: retryMode, response: BAD_SERVICE });
  assert.equal(r.sent, 1);
  assert.match(r.sentText, /TPL dados do pedido/);
  assert.ok(!r.events.some(e => e.handoff === true));
});

test('nome incompleto: a pergunta do nome completo vem da configuração do tenant', async () => {
  const r = await run({ request: retryMode, response: SHORT_NAME });
  assert.match(r.sentText, /TPL nome completo/);
  assert.ok(!r.events.some(e => e.handoff === true));
});

test('sem a frase configurada, o pedido recusado vai para a equipe e o CORE não inventa texto', async () => {
  for (const response of [BAD_SERVICE, SHORT_NAME]) {
    const r = await run({ response });
    assert.ok(r.events.some(e => e.handoff === true), 'encaminha para a equipe');
    assert.doesNotMatch(r.sentText, /consegui registrar|nome completo, por favor/);
  }
});

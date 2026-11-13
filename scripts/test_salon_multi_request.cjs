// Motor do I&C Salon (clients/ic_saloon/salon_engine.js): vários pedidos pendentes na mesma conversa, um por pessoa atendida,
// e a IA nunca promete confirmação de um pedido que não foi gravado. Regressão João/Louzania/Ana Julia (2026-11-12).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const code = fs.readFileSync(path.join(__dirname, '../clients/ic_saloon/salon_engine.js'), 'utf8');
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
  rpcError = null, suppression = {}, boundary = null, replaceBeforeWrite = null, oneOpenIndex = false } = {}) {
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
        // Simula o índice appointments_one_open_request_idx ainda aplicado no banco.
        if (oneOpenIndex && body.status === 'pending_confirmation' && appointments.some(a => a.status === 'pending_confirmation')) {
          throw Object.assign(new Error('Request failed with status code 409'), {
            response: { data: { code: '23505', message: 'duplicate key violates unique constraint "appointments_one_open_request_idx"' } },
          });
        }
        posted.push(body);
        return [{ id: 'a-new-' + posted.length, ...body }];
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

const contextual = { ...mode, team_review_control: 'manual_reply', reply_mode: 'contextual',
  updated_template: 'Pedido atualizado para {servicos}, {hora}. A equipe ainda vai confirmar.' };
const mother = { id: 'mae', status: 'pending_confirmation', title: 'Corte - Louzania Santos', contact_name: 'Louzania Santos', starts_at: '2099-09-29T13:00:00Z',
  created_at: '2099-01-01T00:00:00Z', updated_at: '2099-01-01T00:01:00Z',
  metadata: { services: ['Corte'], customer_name: 'Louzania Santos', requested_date: '2099-09-29', requested_time: '10:00', request_version: 1,
    request_key: 'turn:anterior', first_visit: 'sim' } };
const second = { ...mother, id: 'namorada', title: 'Escova - Ana Julia Souza', contact_name: 'Ana Julia Souza', created_at: '2099-01-02T00:00:00Z',
  metadata: { ...mother.metadata, services: ['Escova'], customer_name: 'Ana Julia Souza', first_visit: null } };
const girlfriend = 'Certo [ACAO: CRIAR_AGENDAMENTO|nome=Ana Julia Souza|servicos=Escova|data=2099-09-30|hora=15:00|status=pending_confirmation]';

test('pedido para outra pessoa na mesma conversa é gravado como novo pedido e não toca o pendente', async () => {
  const r = await run({ request: contextual, appointments: [mother], response: girlfriend, texts: ['Agora para minha namorada Ana Julia Souza'] });
  assert.equal(r.result.ok, true, JSON.stringify(r.result));
  assert.equal(r.posted.length, 1);
  assert.deepEqual(r.patched, []);
  const row = r.posted[0];
  assert.equal(row.tenant_id, 't-salon');
  assert.equal(row.external_conversation_id, CHAT);
  assert.equal(row.status, 'pending_confirmation');
  assert.equal(row.contact_name, 'Ana Julia Souza');
  assert.deepEqual(row.metadata.services, ['Escova']);
  assert.equal(row.metadata.recipient_key, 'ana julia souza');
  assert.equal(row.metadata.request_version, 1);
  assert.equal(r.sentText, 'Anotei, Ana Julia Souza: Escova, quarta-feira, 30 de setembro, às 15:00. A equipe vai confirmar.');
  const saved = r.events.find(e => e.service === 'agendamento_pendente');
  assert.ok(saved, 'evento do pedido');
  assert.notEqual(saved.handoff, true);
});

test('o contexto do modelo lista todos os pedidos pendentes com id e pessoa atendida', async () => {
  const r = await run({ request: contextual, appointments: [mother, second], texts: ['Obrigado'], response: 'De nada!' });
  assert.match(r.prompt, /pedidos_pendentes/);
  assert.ok(r.prompt.includes('mae') && r.prompt.includes('namorada'));
  assert.ok(r.prompt.includes('Ana Julia Souza') && r.prompt.includes('Louzania Santos'));
});

test('no Salon alterar nunca grava: com vários pendentes a equipe assume e nenhum pedido muda', async () => {
  const r = await run({ request: contextual, appointments: [mother, second], response: 'Ok [ACAO: ATUALIZAR_PEDIDO|pedido=namorada|hora=11:00]' });
  assert.deepEqual(r.patched, []);
  assert.deepEqual(r.posted, []);
  assert.ok(r.events.some(e => e.handoff === true && e.raw_payload?.explicit_handoff));
});

test('cliente desiste de um pedido ainda não confirmado: só esse pedido é cancelado e a IA segue no atendimento', async () => {
  const r = await run({ request: contextual, appointments: [mother, second], texts: ['Não quero mais marcar pra minha mãe'],
    response: 'Tudo bem, tirei o pedido da sua mãe. Quer seguir com o da Ana Julia? [ACAO: CANCELAR_PEDIDO|pedido=mae]' });
  assert.deepEqual(r.posted, []);
  assert.equal(r.patched.length, 1);
  assert.equal(r.patched[0].status, 'cancelled');
  assert.equal(r.patched[0].metadata.customer_name, 'Louzania Santos');
  assert.equal(r.patched[0].metadata.cancel_reason, 'customer_cancelled');
  assert.ok(!r.events.some(e => e.handoff === true), 'sem passar para a equipe');
  assert.equal(r.sentText, 'Tudo bem, tirei o pedido da sua mãe. Quer seguir com o da Ana Julia?');
});

test('segundo pedido para a mesma pessoa não vira novo registro', async () => {
  const sameName = 'Certo [ACAO: CRIAR_AGENDAMENTO|nome=Louzania Santos|servicos=Escova|data=2099-09-30|hora=15:00|status=pending_confirmation]';
  const r = await run({ request: contextual, appointments: [mother], response: [sameName, 'Vou pedir à equipe para ajustar esse pedido.'] });
  assert.deepEqual(r.posted, []);
  assert.deepEqual(r.patched, []);
});

test('gravação que falha nunca é anunciada: o modelo recebe ordem de não prometer confirmação e a equipe é avisada', async () => {
  // Banco ainda com o índice de um pedido aberto por conversa: o segundo pedido não é gravado.
  const reply = 'Não consegui registrar agora; a equipe foi avisada para falar com você.';
  const r = await run({ request: contextual, appointments: [mother], oneOpenIndex: true,
    response: [girlfriend, reply], texts: ['Agora para minha namorada Ana Julia Souza'] });
  assert.deepEqual(r.posted, []);
  assert.deepEqual(r.patched, []);
  assert.equal(r.sentText, reply);
  const generations = r.calls.filter(c => c.url.includes('generateContent')).map(c => JSON.stringify(c.body));
  const correction = generations.at(-1);
  assert.match(correction, /nada foi gravado/i);
  assert.match(correction, /não diga[^"]*equipe vai confirmar/i);
  assert.doesNotMatch(correction, /explicar com naturalidade o que a equipe vai verificar/);
  const failed = r.events.find(e => e.raw_payload?.appointment_request?.failed);
  assert.ok(failed, 'falha registrada no evento');
  assert.equal(failed.handoff, true);
});

test('resposta de correção que ainda traz tag de agendamento cai no texto de erro do tenant', async () => {
  const r = await run({ request: { ...contextual, processing_error_template: 'Tive um problema aqui. A equipe continua com você.' },
    appointments: [mother], oneOpenIndex: true,
    response: [girlfriend, 'A equipe vai confirmar! [ACAO: CRIAR_AGENDAMENTO|nome=Ana Julia Souza|servicos=Escova|data=2099-09-30|hora=15:00|status=pending_confirmation]'] });
  assert.deepEqual(r.posted, []);
  assert.doesNotMatch(r.sentText, /ACAO|vai confirmar/);
});

test('primeira_vez só vale com sim ou não e não passa de uma pessoa para outra', async () => {
  const withVisit = value => 'Ok [ACAO: CRIAR_AGENDAMENTO|nome=Ana Julia Souza|servicos=Escova|data=2099-09-30|hora=15:00|primeira_vez=' + value + '|status=pending_confirmation]';
  const unknown = await run({ request: contextual, appointments: [mother], response: withVisit('talvez') });
  assert.equal(unknown.posted[0].metadata.first_visit, null);
  const none = await run({ request: contextual, appointments: [mother], response: girlfriend });
  assert.equal(none.posted[0].metadata.first_visit, null, 'a primeira visita da mãe não é herdada pela namorada');
  const no = await run({ request: contextual, appointments: [mother], response: withVisit('não') });
  assert.equal(no.posted[0].metadata.first_visit, 'não');
  const yes = await run({ request: contextual, appointments: [mother], response: withVisit('Sim') });
  assert.equal(yes.posted[0].metadata.first_visit, 'sim');
});

test('tag de criação sem status (a IA omitiu o campo) grava o pedido pendente em vez de erro (regressão 13/11 "João Victor")', async () => {
  const noStatus = 'Certo [ACAO: CRIAR_AGENDAMENTO|nome=João Victor Santos|servicos=Corte|data=2099-09-30|hora=11:00]';
  const r = await run({ request: contextual, response: noStatus, texts: ['João Victor Santos'] });
  assert.equal(r.posted.length, 1, JSON.stringify(r.events.map(e => e.raw_payload?.appointment_request)));
  assert.equal(r.posted[0].status, 'pending_confirmation');
  // Status explícito diferente de pendente continua inválido: só a equipe confirma.
  const confirmed = await run({ request: contextual, response: noStatus.replace(']', '|status=confirmed]'), texts: ['João Victor Santos'] });
  assert.deepEqual(confirmed.posted, []);
});

test('catálogo completo: categorias em negrito do WhatsApp e um serviço por linha, vindos do banco', async () => {
  const r = await run({ request: contextual, response: 'Claro, aqui estão todos os nossos serviços! [CATALOGO_COMPLETO]', texts: ['Quero a lista completa'] });
  assert.match(r.sentText, /^Claro, aqui estão todos os nossos serviços!/);
  assert.match(r.sentText, /\*Cabelo\*\n• Corte\n• Escova/);
  assert.match(r.sentText, /\*Corpo\*\n• Drenagem/);
  assert.doesNotMatch(r.sentText, /CATALOGO_COMPLETO/);
});

test('regras do motor: formato único da tag com campos opcionais, cancelamento de pedido pendente e humano sem contradizer o prompt', async () => {
  const r = await run({ request: contextual, appointments: [mother], texts: ['Oi'], response: 'Oi!' });
  assert.match(r.prompt, /CRIAR_AGENDAMENTO\|nome=NOME COMPLETO\|servicos=SERVICO 1;SERVICO 2\|data=AAAA-MM-DD\|hora=HH:MM\|profissional=NOME\|primeira_vez=sim\|status=pending_confirmation/);
  assert.match(r.prompt, /CANCELAR_PEDIDO\|pedido=ID_DO_PEDIDO/);
  assert.doesNotMatch(r.prompt, /Use humano apenas para reclama/);
  assert.doesNotMatch(r.prompt, /HH:mm/);
});

test('cancelamento nunca atinge o pedido de outra pessoa (regressão Gemini real: cancelou a namorada ao desistir da mãe)', async () => {
  const onlyGirlfriend = [second];
  for (const tag of ['[ACAO: CANCELAR_PEDIDO|pedido=mae|nome=Louzania Santos]', '[ACAO: CANCELAR_PEDIDO|pedido=namorada|nome=Louzania Santos]',
    '[ACAO: CANCELAR_PEDIDO|pedido=id-inexistente]']) {
    const reply = 'Não encontrei pedido pendente da sua mãe por aqui. Posso ajudar com outra coisa?';
    const r = await run({ request: contextual, appointments: onlyGirlfriend, texts: ['Não quero mais marcar pra minha mãe'],
      response: ['Já retirei o pedido da sua mãe. ' + tag, reply] });
    assert.deepEqual(r.patched, [], tag);
    assert.doesNotMatch(r.sentText, /retirei/i, tag);
    assert.ok(!r.events.some(e => e.handoff === true), 'sem pedido para retirar não é caso da equipe: ' + tag);
    const generations = r.calls.filter(c => c.url.includes('generateContent')).map(c => JSON.stringify(c.body));
    assert.match(generations.at(-1), /não há pedido pendente/i, tag);
  }
  // Nome da tag igual ao da pessoa do pedido: cancela normalmente.
  const ok = await run({ request: contextual, appointments: onlyGirlfriend, texts: ['Não quero mais o da Ana Julia'],
    response: 'Tudo bem, retirei o pedido da Ana Julia. [ACAO: CANCELAR_PEDIDO|pedido=namorada|nome=Ana Julia Souza]' });
  assert.equal(ok.patched.length, 1);
  assert.equal(ok.patched[0].status, 'cancelled');
});

test('regras do motor: cancelamento leva o nome de quem seria atendida no pedido', async () => {
  const r = await run({ request: contextual, appointments: [mother], texts: ['Oi'], response: 'Oi!' });
  assert.match(r.prompt, /CANCELAR_PEDIDO\|pedido=ID_DO_PEDIDO\|nome=NOME/);
});

test('sobrenome informado depois do pedido completa o nome do mesmo pedido, sem novo registro nem equipe (regressão Gemini real)', async () => {
  const partial = { ...mother, id: 'joao', title: 'Corte - João Victor', contact_name: 'João Victor',
    metadata: { ...mother.metadata, services: ['Corte'], customer_name: 'João Victor', recipient_key: 'joao victor', first_visit: null } };
  const fuller = 'Certo [ACAO: CRIAR_AGENDAMENTO|nome=João Victor Santos|servicos=Corte|data=2099-09-29|hora=10:00|status=pending_confirmation]';
  const r = await run({ request: contextual, appointments: [partial], response: fuller, texts: ['João Victor Santos'] });
  assert.deepEqual(r.posted, []);
  assert.equal(r.patched.length, 1, JSON.stringify(r.events.map(e => e.raw_payload?.appointment_request)));
  assert.equal(r.patched[0].contact_name, 'João Victor Santos');
  assert.equal(r.patched[0].metadata.recipient_key, 'joao victor santos');
  assert.ok(!r.events.some(e => e.handoff === true));
  // Outro horário com nome mais longo não é "completar nome": continua sendo alteração (equipe).
  const otherSlot = fuller.replace('hora=10:00', 'hora=15:00');
  const changed = await run({ request: contextual, appointments: [partial], response: [otherSlot, 'Vou pedir para a equipe ajustar.'], texts: ['João Victor Santos às 15'] });
  assert.ok(!changed.patched.some(p => p.contact_name === 'João Victor Santos' && p.starts_at));
});

test('nome completado responde com o texto de pedido atualizado, sem repetir o recibo', async () => {
  const partial = { ...mother, id: 'joao', title: 'Corte - João Victor', contact_name: 'João Victor',
    metadata: { ...mother.metadata, services: ['Corte'], customer_name: 'João Victor', recipient_key: 'joao victor' } };
  const r = await run({ request: contextual, appointments: [partial], texts: ['João Victor Santos'],
    response: 'Certo [ACAO: CRIAR_AGENDAMENTO|nome=João Victor Santos|servicos=Corte|data=2099-09-29|hora=10:00|status=pending_confirmation]' });
  assert.match(r.sentText, /^Pedido atualizado/);
});

test('catálogo completo: se o modelo escreveu a própria lista antes da tag, só a lista oficial sai (regressão Gemini real: lista duplicada)', async () => {
  const r = await run({ request: contextual, texts: ['Quais serviços?'],
    response: 'Claro! Temos:\n• Corte\n• Escova\n• Drenagem\n\n[CATALOGO_COMPLETO]' });
  assert.equal((r.sentText.match(/• Corte/g) || []).length, 1, r.sentText);
  assert.match(r.sentText, /\*Cabelo\*\n• Corte/);
  // Abertura curta de uma linha continua sendo usada.
  const short = await run({ request: contextual, texts: ['Quais serviços?'], response: 'Claro, olha só tudo o que fazemos! [CATALOGO_COMPLETO]' });
  assert.match(short.sentText, /^Claro, olha só tudo o que fazemos!/);
});

test('Gemini sem texto: tenta de novo e, se vier vazio outra vez, envia a mensagem de reserva do salão e passa à equipe (regressão Gemini real)', async () => {
  const fallback = 'Recebi sua mensagem! Já vou pedir para a equipe do salão continuar seu atendimento por aqui.';
  const retried = await run({ request: contextual, extra: { fallback_message: fallback }, texts: ['Tenho 15 anos, posso ir sozinha?'],
    response: ['', 'Menores de idade são atendidos com o pai ou a mãe junto.'] });
  assert.equal(retried.sentText, 'Menores de idade são atendidos com o pai ou a mãe junto.');
  const empty = await run({ request: contextual, extra: { fallback_message: fallback }, texts: ['Tenho 15 anos, posso ir sozinha?'], response: ['', ''] });
  assert.equal(empty.sent, 1, 'a pessoa recebe uma mensagem');
  assert.equal(empty.sentText, fallback);
  assert.ok(empty.events.some(e => e.handoff === true));
});

test('avaliação presencial: tag com avaliacao=sim registra "Avaliação: serviço" sem a duração do serviço completo', async () => {
  const tag = 'Certo [ACAO: CRIAR_AGENDAMENTO|nome=Maria Silva|servicos=Corte|data=2099-09-30|hora=10:00|avaliacao=sim|status=pending_confirmation]';
  const r = await run({ request: contextual, response: tag, texts: ['Quero marcar a avaliação, Maria Silva'] });
  assert.equal(r.posted.length, 1);
  assert.equal(r.posted[0].title, 'Avaliação: Corte - Maria Silva');
  assert.equal(r.posted[0].metadata.evaluation_visit, true);
  assert.equal(r.posted[0].metadata.duration_minutes, null);
  assert.equal(r.posted[0].ends_at, null);
  // Sem o campo, segue como serviço normal.
  const normal = await run({ request: contextual, response: tag.replace('|avaliacao=sim', ''), texts: ['Maria Silva'] });
  assert.equal(normal.posted[0].title, 'Corte - Maria Silva');
  assert.equal(normal.posted[0].metadata.evaluation_visit, undefined);
  assert.match(r.prompt, /avaliacao=sim/);
});

test('recibo de avaliação presencial diz que é avaliação (regressão Gemini real: "Mechas loiras para sábado")', async () => {
  const tag = 'Certo [ACAO: CRIAR_AGENDAMENTO|nome=Maria Silva|servicos=Corte|data=2099-09-30|hora=10:00|avaliacao=sim|status=pending_confirmation]';
  const r = await run({ request: contextual, response: tag, texts: ['Quero marcar a avaliação, Maria Silva'] });
  assert.match(r.sentText, /^Anotei, Maria Silva: Avaliação de Corte,/);
});

test('regras do motor: nome do registro é o da pessoa atendida e duas pessoas na mesma mensagem são registradas uma de cada vez', async () => {
  const r = await run({ request: contextual, texts: ['Oi'], response: 'Oi!' });
  assert.match(r.prompt, /não peça o nome de quem escreve/);
  assert.match(r.prompt, /registre uma pessoa por vez/);
});

test('feriado cadastrado (business_hours.holidays, MM-DD) é tratado como dia fechado: nada é gravado', async () => {
  const tag = 'Certo [ACAO: CRIAR_AGENDAMENTO|nome=Paulo Mendes|servicos=Corte|data=2099-11-20|hora=10:00|status=pending_confirmation]';
  const hours = { schedule: { segunda: { closed: true }, terca: { start: '09:00', end: '18:00' }, quarta: { start: '09:00', end: '18:00' },
    quinta: { start: '09:00', end: '18:00' }, sexta: { start: '09:00', end: '18:00' }, sabado: { start: '09:00', end: '18:00' }, domingo: { closed: true } } };
  const closed = await run({ request: contextual, extra: { business_hours: { ...hours, holidays: ['11-20'] } }, texts: ['Dia 20 de novembro às 10, Paulo Mendes'],
    response: [tag, 'Nesse dia é feriado e o salão fica fechado. Qual outro dia fica bom?'] });
  assert.deepEqual(closed.posted, []);
  assert.match(closed.sentText, /feriado/);
  const open = await run({ request: contextual, extra: { business_hours: hours }, texts: ['Dia 20 de novembro às 10, Paulo Mendes'], response: tag });
  assert.equal(open.posted.length, 1);
});

test('desistência de pedido que não existe: se a primeira reescrita vier com tag, tenta de novo antes do texto de erro', async () => {
  const reply = 'Não encontrei pedido pendente dela por aqui. Posso ajudar com mais alguma coisa?';
  const r = await run({ request: contextual, appointments: [second], texts: ['Desisto da minha esposa'],
    response: ['Retirei. [ACAO: CANCELAR_PEDIDO|pedido=x|nome=Fernanda Alves Costa]', 'Ok [ACAO: CANCELAR_PEDIDO|pedido=x]', reply] });
  assert.equal(r.sentText, reply);
  assert.deepEqual(r.patched, []);
});

test('recusas do motor viram explicação certa, sem texto fixo genérico (regressão Gemini real com outros nomes)', async () => {
  // Horário que já passou: a IA explica e pede outro, em vez de "me confirma o serviço, o dia e o horário".
  const past = 'Certo [ACAO: CRIAR_AGENDAMENTO|nome=José Carlos da Silva|servicos=Corte|data=2000-01-01|hora=14:00|status=pending_confirmation]';
  const pastReply = 'Esse horário já passou. Qual outro dia fica bom para o José Carlos?';
  const r1 = await run({ request: { ...contextual, missing_details_template: 'Para eu registrar seu pedido, me confirma o serviço, o dia e o horário exato que você prefere?' },
    response: [past, pastReply], texts: ['Corte pro meu marido José Carlos da Silva sexta às 14'] });
  assert.equal(r1.sentText, pastReply);
  assert.match(JSON.stringify(r1.calls.filter(c => c.url.includes('generateContent')).at(-1).body), /já passaram/);
  // Nome sem sobrenome da pessoa atendida: pede o sobrenome dela, não "o seu nome".
  const single = 'Certo [ACAO: CRIAR_AGENDAMENTO|nome=Thaís|servicos=Corte|data=2099-09-30|hora=15:00|status=pending_confirmation]';
  const nameReply = 'Qual é o nome completo da Thaís, com sobrenome?';
  const r2 = await run({ request: { ...contextual, full_name_template: 'Para eu anotar certinho, qual é o seu nome completo?' },
    response: [single, nameReply], texts: ['Corte pra Thaís dia 30 às 15'] });
  assert.equal(r2.sentText, nameReply);
  assert.match(JSON.stringify(r2.calls.filter(c => c.url.includes('generateContent')).at(-1).body), /pessoa que será atendida/);
});

test('fora do funcionamento: reescrita com tag ou vazia tenta de novo antes do texto de erro', async () => {
  const hours = { schedule: { segunda: { closed: true }, terca: { start: '09:00', end: '18:00' }, quarta: { start: '09:00', end: '18:00' },
    quinta: { start: '09:00', end: '18:00' }, sexta: { start: '09:00', end: '18:00' }, sabado: { start: '09:00', end: '18:00' }, domingo: { closed: true } }, holidays: ['11-20'] };
  const tag = 'Certo [ACAO: CRIAR_AGENDAMENTO|nome=Paulo Mendes|servicos=Corte|data=2099-11-20|hora=10:00|status=pending_confirmation]';
  const reply = 'Nesse dia é feriado e o salão fica fechado. Qual outro dia fica bom?';
  const r = await run({ request: contextual, extra: { business_hours: hours }, texts: ['Dia 20 às 10, Paulo Mendes'], response: [tag, tag, reply] });
  assert.equal(r.sentText, reply);
});

test('último recurso por caso: dia fechado e desistência sem pedido usam textos do cadastro, não a mensagem de erro', async () => {
  const hours = { schedule: { segunda: { closed: true }, terca: { start: '09:00', end: '18:00' }, quarta: { start: '09:00', end: '18:00' },
    quinta: { start: '09:00', end: '18:00' }, sexta: { start: '09:00', end: '18:00' }, sabado: { start: '09:00', end: '18:00' }, domingo: { closed: true } }, holidays: ['11-20'] };
  const tag = 'Certo [ACAO: CRIAR_AGENDAMENTO|nome=Paulo Mendes|servicos=Corte|data=2099-11-20|hora=10:00|status=pending_confirmation]';
  const closedText = 'Nesse dia o salão não abre. Qual outro dia fica bom para você?';
  const closed = await run({ request: { ...contextual, closed_day_template: closedText }, extra: { business_hours: hours },
    texts: ['Dia 20 às 10, Paulo Mendes'], response: [tag, tag, tag] });
  assert.equal(closed.sentText, closedText);
  const noneText = 'Não encontrei pedido pendente dessa pessoa por aqui. Posso ajudar em mais alguma coisa?';
  const cancelTag = 'Retirei. [ACAO: CANCELAR_PEDIDO|pedido=x|nome=Fernanda Alves Costa]';
  const none = await run({ request: { ...contextual, no_pending_request_template: noneText }, appointments: [second],
    texts: ['Desisto da minha esposa'], response: [cancelTag, cancelTag, cancelTag] });
  assert.equal(none.sentText, noneText);
  assert.deepEqual(none.patched, []);
});

test('reescrita que terminou no texto de passar à equipe também não serve: dia fechado usa o texto próprio', async () => {
  const hours = { schedule: { segunda: { closed: true }, terca: { start: '09:00', end: '18:00' }, quarta: { start: '09:00', end: '18:00' },
    quinta: { start: '09:00', end: '18:00' }, sexta: { start: '09:00', end: '18:00' }, sabado: { start: '09:00', end: '18:00' }, domingo: { closed: true } }, holidays: ['11-20'] };
  const tag = 'Certo [ACAO: CRIAR_AGENDAMENTO|nome=Paulo Mendes|servicos=Corte|data=2099-11-20|hora=10:00|status=pending_confirmation]';
  const handoff = 'Vou chamar alguém da equipe para continuar com você por aqui, tá bem?';
  const closedText = 'Nesse dia o salão não abre. Qual outro dia fica bom para você?';
  const r = await run({ request: { ...contextual, closed_day_template: closedText, review_handoff_template: handoff }, extra: { business_hours: hours },
    texts: ['Dia 20 às 10, Paulo Mendes'], response: [tag, handoff + ' [HUMANO_SOLICITADO]', handoff + ' [HUMANO_SOLICITADO]'] });
  assert.equal(r.sentText, closedText);
});

test('regras do motor: primeira vez, profissional e telefone são opcionais e nunca adiam o registro', async () => {
  const r = await run({ request: contextual, texts: ['Oi'], response: 'Oi!' });
  assert.match(r.prompt, /nunca adiam o registro/);
});

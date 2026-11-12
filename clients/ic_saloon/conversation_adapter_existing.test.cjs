// Clientes com agendamento existente e mensagens de recuperação por cenário no adaptador do I&C Salon.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { wrapSalonEngine } = require('./conversation_adapter.cjs');
const { buildSalonEngine } = require('./build_conversation_adapter.cjs');

const tenant = '76aff8a0-0466-42b9-a80d-db186ff3d8bd';
const chat = '5521983622313@s.whatsapp.net';
const handoff = '[HUMANO_SOLICITADO]';
const base = 'https://db.test';
const core = [
  'const NORIA_NODE_PHASE = $json.noria_engine_phase;',
  'const helpers = this.helpers;',
  'for (const options of $json.calls) await helpers.httpRequest(options);',
  'const output = await helpers.httpRequest($json.modelRequest);',
  "return { ...output, diag: typeof helpers.salonAdapterDiagnostics === 'function' ? helpers.salonAdapterDiagnostics() : null };",
].join('\n');
const execute = Object.getPrototypeOf(async function () {}).constructor('$json', '$env', wrapSalonEngine(core));
const reply = (text, finishReason = 'STOP') => ({ candidates: [{ finishReason, content: { parts: [{ text }] } }] });
const eventUrl = base + '/rest/v1/channel_events?select=*&tenant_slug=eq.ic_salon&channel_type=eq.whatsapp'
  + '&external_conversation_id=eq.' + encodeURIComponent(chat) + '&created_at=gt.2099-11-10T00%3A00%3A00Z&limit=50';

// Caso real do Ian, em ano futuro para o teste não depender da data de execução.
const ian = {
  id: 'apt-ian', title: 'Mechas loiras - Ian Shtorache', contact_name: 'Ian Shtorache', status: 'confirmed',
  starts_at: '2099-11-12T13:47:00.000Z', metadata: { services: ['Mechas loiras'] },
};
const ianTag = (time, name = 'Ian Shtorache') => '[ACAO: CRIAR_AGENDAMENTO|nome=' + name
  + '|servicos=Corte|data=2099-11-12|hora=' + time + '|status=pending_confirmation]';
const dateLabel = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: 'numeric', month: 'long' })
  .format(new Date(ian.starts_at));
const citesIan = text => text.includes('Mechas loiras') && text.includes(dateLabel) && text.includes('10:47');

async function run({ draft, current = 'quero fazer meu cabelo amanhã 9:30 cortar', evidence = [], appointments = [ian],
  appointmentsFail = false, requestSettings = {}, payment, audit = { allowed: true, evidence_id: '', remove_suffix: '' },
  repaired = () => '' } = {}) {
  const log = { reviews: [], reviewPrompts: [], repairs: [], main: [], appointmentQueries: [] };
  const scope = {
    tenant_id: tenant, tenant_slug: 'ic_salon', instance: 'ic_saloon', remoteJid: chat, noria_engine_phase: 'single',
    calls: [
      { method: 'GET', url: base + '/rest/v1/tenant_settings?select=*&tenant_id=eq.' + tenant },
      { method: 'GET', url: eventUrl, headers: { apikey: 'k' } },
    ],
    modelRequest: {
      method: 'POST', url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent',
      body: {
        system_instruction: { parts: [{ text: 'AGENDAMENTOS CONHECIDOS PELO SISTEMA\nREGRAS OPERACIONAIS CURTAS' }] },
        contents: [{ role: 'user', parts: [{ text: current }] }],
      },
    },
  };
  const output = await execute.call({ helpers: { async httpRequest(options) {
    const url = new URL(options.url);
    if (url.pathname.endsWith('tenant_settings')) {
      return [{ settings: { price_rejection_template: 'A equipe confirma o valor.',
        appointment_request: { mode: 'operator_confirmation', ...requestSettings }, ...(payment ? { payment } : {}) } }];
    }
    if (url.searchParams.get('limit') === '50') return [];
    if (url.pathname.endsWith('channel_events')) return evidence;
    if (url.pathname.endsWith('/appointments')) {
      log.appointmentQueries.push(url);
      assert.equal(options.method, 'GET');
      assert.equal(url.searchParams.get('tenant_id'), 'eq.' + tenant);
      assert.equal(url.searchParams.get('channel_type'), 'eq.whatsapp');
      // Uma única leitura: futuros ativos e desfechos/cancelamentos como histórico.
      assert.equal(url.searchParams.get('status'), null);
      assert.match(url.searchParams.get('or'), /^\(and\(status\.in\.\(confirmed,pending_confirmation\),starts_at\.gte\.\d{4}-\d{2}-\d{2}T[^)]*\),status\.in\.\(no_show,cancelled,completed,done\)\)$/);
      assert.equal(url.searchParams.get('order'), 'starts_at.desc,created_at.desc');
      assert.equal(url.searchParams.get('limit'), '40');
      const ids = url.searchParams.get('external_conversation_id');
      assert.ok(ids.startsWith('in.(') && ids.includes('"' + chat + '"') && ids.includes('"5521983622313"'), ids);
      if (appointmentsFail) throw Error('timeout');
      return appointments;
    }
    if (url.pathname.endsWith('tenant_service_catalog')) {
      return [{ tenant_id: tenant, active: true, external_id: 'corte', name: 'Corte', price: 140, metadata: { price_type: 'fixed' } }];
    }
    const parts = options.body.system_instruction.parts;
    if (parts[0].text.startsWith('Você é um auditor de mensagens')) {
      const { message } = JSON.parse(options.body.contents[0].parts[0].text);
      return reply(JSON.stringify({ complete: true, segments: [{ kind: 'non_price', text: message }] }));
    }
    if (parts.length === 1) {
      const payload = JSON.parse(options.body.contents[0].parts[0].text);
      log.reviews.push(payload);
      log.reviewPrompts.push(parts[0].text);
      return reply(JSON.stringify(typeof audit === 'function' ? audit(payload) : audit));
    }
    if (parts.length === 3) {
      log.repairs.push(parts.map(part => part.text).join('\n'));
      return reply(repaired(log.repairs.at(-1), log.repairs.length));
    }
    log.main.push(parts[0].text);
    return reply(draft);
  } } }, scope, { SUPABASE_URL: base });
  return { text: output.candidates[0].content.parts[0].text, diag: output.diag, ...log };
}

test('Ian com outro horário recebe resposta com a reserva real e sem transferência', async () => {
  const result = await run({ draft: handoff,
    repaired: instruction => citesIan(instruction)
      ? 'Vi que você já tem Mechas loiras para ' + dateLabel + ', às 10:47. O corte amanhã às 9:30 seria um atendimento a mais?' : '' });
  assert.ok(citesIan(result.main[0]), 'o prompt principal recebe serviço, dia e hora da reserva existente');
  assert.ok(citesIan(result.text), result.text);
  assert.ok(!result.text.includes(handoff));
});

test('[HUMANO_SOLICITADO] sem texto vira resposta contextual', async () => {
  const result = await run({ draft: handoff, appointments: [], current: 'quero cortar o cabelo',
    repaired: () => 'Claro! Qual dia e horário você prefere?' });
  assert.equal(result.text, 'Claro! Qual dia e horário você prefere?');
});

test('mesmo horário da reserva existente: texto contextual e transferência, sem registrar', async () => {
  const evidence = [{ id: 'ev-1', message_text: 'Ian Shtorache' }];
  const fallback = await run({ draft: ianTag('10:47'), evidence });
  assert.ok(citesIan(fallback.text), fallback.text);
  assert.ok(fallback.text.endsWith(' ' + handoff));
  assert.ok(!fallback.text.includes('[ACAO'));
  assert.equal(fallback.reviews.length, 0);
  const custom = await run({ draft: ianTag('10:47'), evidence,
    requestSettings: { conflict_existing_appointment_template: 'Você já tem {servicos} em {data} às {hora}.' } });
  assert.equal(custom.text, 'Você já tem Mechas loiras em ' + dateLabel + ' às 10:47. ' + handoff, 'o template do tenant prevalece');
});

test('outro horário só registra quando a revisão reconhece o novo atendimento', async () => {
  const evidence = [{ id: 'ev-1', message_text: 'Ian Shtorache' }];
  const repaired = instruction => citesIan(instruction) ? 'Esse corte seria além das Mechas loiras de ' + dateLabel + ', às 10:47?' : '';
  const denied = await run({ draft: ianTag('09:30'), evidence, repaired,
    audit: { allowed: true, evidence_id: 'ev-1', existing_acknowledged: false, remove_suffix: '' } });
  assert.ok(!denied.text.includes('[ACAO'));
  assert.ok(citesIan(denied.text));
  const existing = denied.reviews[0].booking.existing_appointments;
  assert.equal(existing.length, 1);
  assert.equal(existing[0].servicos, 'Mechas loiras');
  assert.equal(existing[0].hora, '10:47');
  const accepted = await run({ draft: ianTag('09:30'), evidence,
    audit: { allowed: true, evidence_id: 'ev-1', existing_acknowledged: true, remove_suffix: '' } });
  assert.equal(accepted.text, ianTag('09:30'));
});

test('nome vindo só da reserva anterior pede confirmação antes de registrar', async () => {
  const asked = await run({ draft: ianTag('09:30'),
    audit: payload => payload.booking ? { allowed: false, evidence_id: '', existing_acknowledged: true, remove_suffix: '' }
      : { allowed: true, evidence_id: '', existing_acknowledged: true, remove_suffix: '' },
    repaired: () => 'Texto do reparo que não deve ser usado' });
  // Pedido completo com nome só da reserva: a confirmação vem do template, sem depender do reparo.
  assert.equal(asked.text, 'Posso registrar esse pedido no nome Ian Shtorache?');
  assert.equal(asked.repairs.length, 0);
  assert.equal(asked.reviews[0].booking.name_source, 'reserva_anterior');
  assert.ok(asked.main[0].includes('pergunte se o novo pedido pode ser registrado nesse nome'));
  const confirmed = await run({ draft: ianTag('09:30'), current: 'Sim, pode ser nesse nome',
    audit: { allowed: true, evidence_id: 'reserva:apt-ian', existing_acknowledged: true, remove_suffix: '' } });
  assert.equal(confirmed.text, ianTag('09:30'));
});

test('a recuperação aceita a segunda geração válida', async () => {
  const result = await run({ draft: 'Já anotei seu pedido.', appointments: [],
    repaired: (_, attempt) => attempt === 1 ? 'Já registrei seu horário!' : 'Qual horário exato você prefere?' });
  assert.equal(result.repairs.length, 2);
  assert.equal(result.text, 'Qual horário exato você prefere?');
});

test('falha persistente entrega texto visível de erro com transferência', async () => {
  const result = await run({ draft: 'Já anotei seu pedido.', appointments: [] });
  assert.equal(result.repairs.length, 2);
  assert.ok(result.text.endsWith(' ' + handoff));
  const visible = result.text.slice(0, -handoff.length).trim();
  assert.ok(visible.length > 20, result.text);
  assert.ok(!/perd|whatsapp/i.test(visible));
  const custom = await run({ draft: 'Já anotei seu pedido.', appointments: [],
    requestSettings: { processing_error_template: 'A equipe vai conferir por aqui.' } });
  assert.equal(custom.text, 'A equipe vai conferir por aqui. ' + handoff);
});

test('falha ao ler agendamentos não libera o registro', async () => {
  const result = await run({ draft: ianTag('09:30'), appointmentsFail: true,
    evidence: [{ id: 'ev-1', message_text: 'Ian Shtorache' }],
    audit: { allowed: true, evidence_id: 'ev-1', existing_acknowledged: true, remove_suffix: '' } });
  assert.ok(!result.text.includes('[ACAO'));
  assert.ok(result.text.endsWith(' ' + handoff));
  assert.ok(result.text.slice(0, -handoff.length).trim());
});

test('agradecimento com pedido pendente é respondido sem repetir a tag', async () => {
  const pending = { id: 'req-1', title: 'Corte - Ana Souza', contact_name: 'Ana Souza', status: 'pending_confirmation',
    starts_at: '2099-11-20T13:00:00.000Z', metadata: { services: ['Corte'] } };
  const repeated = '[ACAO: ATUALIZAR_PEDIDO|nome=Ana Souza|servicos=Corte|data=2099-11-20|hora=10:00|pedido=req-1]';
  const result = await run({ draft: repeated, current: 'Obrigada', appointments: [pending],
    repaired: () => 'Imagina! Qualquer coisa é só me chamar.' });
  assert.equal(result.text, 'Imagina! Qualquer coisa é só me chamar.');
});

// Motor isolado: classificação das mensagens de recuperação e terceira geração no agradecimento.
const engine = JSON.parse(fs.readFileSync(path.join(__dirname, '../../n8n/workflows/NORIA CORE _ Motor conversacional.json'), 'utf8'));
const built = () => buildSalonEngine(engine).nodes.find(node => node.name === 'CORE | Motor conversacional').parameters.jsCode.replace(/\r\n/g, '\n');

test('motor isolado separa as mensagens de erro por cenário', async () => {
  const code = built();
  assert.ok(!code.includes("'invalid_request_template'"), 'invalid_request_template deixa de ser curinga');
  const start = code.indexOf('      const retryKey =');
  // Fecha antes da chave do catch: o trecho é avaliado dentro de um catch próprio.
  const end = code.indexOf('\n    }\n  } else if (tag && !requestConfig)', start);
  assert.ok(start > 0 && end > start);
  const helperStart = code.indexOf('const SALON_REQUEST_TEMPLATE_DEFAULTS');
  const helperEnd = code.indexOf('function sessionHandoffMessage', helperStart);
  assert.ok(helperStart > 0 && helperEnd > helperStart);
  const evaluate = new (Object.getPrototypeOf(async function () {}).constructor)('code', 'settings', 'contextualBooking',
    'const context = {}; const settingsFor = () => settings; const requestConfig = settings.appointment_request;'
    + ' let responseText = ""; let preserveLiteralReply = false; const event = { stage: "Conversas IA", raw_payload: {} };'
    + ' const sessionHandoffMessage = () => "GENERICO";\n' + code.slice(helperStart, helperEnd)
    + '\ntry { throw new Error(code); } catch (error) {\n'
    + code.slice(start, end) + '\n}\nreturn { responseText, handoff: event.handoff === true, preserveLiteralReply };');
  const settings = { appointment_request: { mode: 'operator_confirmation', full_name_template: 'Nome completo?' } };
  const name = await evaluate('APPOINTMENT_FULL_NAME_REQUIRED', settings, false);
  assert.deepEqual([name.responseText, name.handoff], ['Nome completo?', false]);
  const details = await evaluate('Invalid appointment details: invalid_date_time', settings, false);
  assert.ok(details.responseText.length > 20 && !details.handoff && !/perd/i.test(details.responseText));
  const failure = await evaluate('Appointment not persisted', settings, false);
  assert.ok(failure.handoff);
  assert.notEqual(failure.responseText, 'GENERICO');
  assert.ok(failure.responseText.length > 20);
  const custom = await evaluate('Appointment not persisted',
    { appointment_request: { mode: 'operator_confirmation', processing_error_template: 'Equipe confere.' } }, false);
  assert.equal(custom.responseText, 'Equipe confere.');
});

test('motor isolado faz uma terceira geração antes de transferir no agradecimento', async () => {
  const code = built();
  const start = code.indexOf('  if (bookingRepair) {');
  const end = code.indexOf('  if (!generated.text) {', start);
  assert.ok(start > 0 && end > start);
  const helperStart = code.indexOf('const SALON_REQUEST_TEMPLATE_DEFAULTS');
  const helperEnd = code.indexOf('function sessionHandoffMessage', helperStart);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const evaluate = new AsyncFunction('outputs', 'outbound',
    'const context = {}; const settingsFor = () => ({ appointment_request: {} }); const model = "m"; const maxOutputTokens = 300;'
    + ' const repairInstruction = ""; const bookingRepair = "\\n\\nCORREÇÃO"; const calls = [];'
    + ' const history = outbound.map(message_text => ({ direction: "outbound", message_text }));'
    + ' const normalizeText = value => String(value || "").toLowerCase().trim(); const cleanReplyText = value => String(value || "").replace(/\\[[^\\]]*\\]/g, "").trim();'
    + ' const parseAppointmentRequestAction = value => /\\[ACAO:/.test(value) ? { kind: "update" } : null;'
    + ' const generate = async (limit, extra) => { calls.push(extra); return { text: outputs[calls.length - 1] ?? "" }; };'
    + ' let generated = { text: "[ACAO: ATUALIZAR_PEDIDO|pedido=req-1]" };\n'
    + code.slice(helperStart, helperEnd) + '\nconst result = await (async () => {\n' + code.slice(start, end) + '\nreturn generated;\n})();\nreturn { result, calls };');
  const thanks = await evaluate(['[ACAO: ATUALIZAR_PEDIDO|pedido=req-1]', 'De nada!', 'De nada!'], ['De nada!']);
  assert.equal(thanks.calls.length, 3);
  assert.equal(thanks.result.text, 'De nada!');
  const failed = await evaluate(['', '', ''], []);
  assert.ok(failed.result.text.endsWith(' [HUMANO_SOLICITADO]'));
  assert.ok(failed.result.text.replace('[HUMANO_SOLICITADO]', '').trim().length > 20);
});

// Histórico do contato e sinal de 50% via Pix após falta (mesmo critério de magia_deposit_required_contacts).
const outcome = (id, status, startsAt, extra = {}) => ({ id, title: 'Corte - Ian Shtorache', contact_name: 'Ian Shtorache', status,
  starts_at: startsAt, created_at: '2026-01-01T00:00:00.000Z', metadata: { services: ['Corte'] }, ...extra });
const evidenceIan = [{ id: 'ev-1', message_text: 'Ian Shtorache' }];
const okAudit = extra => payload => payload.booking
  ? { allowed: true, evidence_id: 'ev-1', existing_acknowledged: true, remove_suffix: '', ...extra }
  : { allowed: true, evidence_id: '', existing_acknowledged: true, deposit_acknowledged: true, remove_suffix: '' };
const payment = { deposit_rule: 'Primeiro agendamento sem sinal. Após falta ou desmarcação em cima da hora, o reagendamento exige 50% via Pix.',
  pix_key: 'pix@salao.test', pix_holder: 'I&C Salon' };

test('falta recente exige sinal: avisa antes de registrar e marca o pedido depois da concordância', async () => {
  const history = [outcome('old-1', 'completed', '2026-09-01T13:00:00.000Z'), outcome('old-2', 'no_show', '2026-10-01T13:00:00.000Z')];
  const warned = await run({ draft: ianTag('09:30'), appointments: history, evidence: evidenceIan, payment,
    audit: okAudit({ deposit_acknowledged: false }),
    repaired: instruction => /sinal/i.test(instruction) && /50%/.test(instruction) ? 'Para reagendar, pedimos um sinal de 50% via Pix. Tudo bem?' : '' });
  assert.ok(warned.main[0].includes('SINAL OBRIGATÓRIO'));
  assert.ok(warned.main[0].includes('pix@salao.test'));
  assert.ok(!/R\$\s*\d/.test(warned.main[0]), 'o bloco de sinal não informa valores em reais');
  assert.equal(warned.reviews[0].booking.deposit_required, true);
  assert.equal(warned.text, 'Para reagendar, pedimos um sinal de 50% via Pix. Tudo bem?');
  const agreed = await run({ draft: ianTag('09:30'), appointments: history, evidence: evidenceIan, payment,
    audit: okAudit({ deposit_acknowledged: true }) });
  assert.equal(agreed.text, ianTag('09:30').replace(']', '|sinal_exigido=sim]'));
});

test('sem configuração de pagamento, o sinal usa o padrão de 50% via Pix', async () => {
  const result = await run({ draft: handoff, appointments: [outcome('old-2', 'no_show', '2026-10-01T13:00:00.000Z')],
    repaired: () => 'Posso ajudar com o reagendamento?' });
  assert.ok(result.main[0].includes('SINAL OBRIGATÓRIO') && result.main[0].includes('50% via Pix'));
});

test('compareceu depois da falta volta ao normal', async () => {
  const history = [outcome('old-2', 'no_show', '2026-09-01T13:00:00.000Z'), outcome('old-3', 'completed', '2026-10-01T13:00:00.000Z'),
    outcome('old-4', 'cancelled', '2026-10-20T13:00:00.000Z')];
  const result = await run({ draft: ianTag('09:30'), appointments: history, evidence: evidenceIan, payment,
    audit: okAudit({ deposit_acknowledged: false }) });
  assert.ok(!result.main[0].includes('SINAL OBRIGATÓRIO'));
  assert.equal(result.reviews[0].booking.deposit_required, false);
  assert.equal(result.text, ianTag('09:30'));
});

test('cancelado não conflita e aparece só como histórico', async () => {
  const cancelled = outcome('c-1', 'cancelled', '2099-11-12T12:30:00.000Z');
  const result = await run({ draft: ianTag('09:30'), appointments: [cancelled], evidence: evidenceIan, audit: okAudit({}) });
  assert.equal(result.text, ianTag('09:30'));
  assert.equal(result.reviews[0].booking.existing_appointments.length, 0);
  assert.ok(result.main[0].includes('HISTÓRICO DE AGENDAMENTOS'));
  assert.ok(!result.main[0].includes('RESERVAS FUTURAS'));
});

test('agendamento editado aparece com o horário atual', async () => {
  const edited = { ...ian, metadata: { services: ['Mechas loiras'], requested_date: '2099-11-11', requested_time: '08:00' } };
  const result = await run({ draft: ianTag('10:47'), appointments: [edited], evidence: evidenceIan });
  assert.ok(citesIan(result.text), result.text);
  assert.ok(result.main[0].includes('10:47') && !result.main[0].includes('08:00'));
});

test('falha na leitura do histórico não quebra o atendimento', async () => {
  const result = await run({ draft: 'Claro! Qual serviço você quer fazer?', appointmentsFail: true, current: 'oi' });
  assert.equal(result.text, 'Claro! Qual serviço você quer fazer?');
  assert.ok(!result.main[0].includes('SINAL OBRIGATÓRIO'));
});

test('marca de sinal forjada pelo modelo é removida', async () => {
  const forged = ianTag('09:30').replace(']', '|sinal_exigido=sim]');
  const created = await run({ draft: forged, appointments: [], evidence: evidenceIan, audit: okAudit({}) });
  assert.equal(created.text, ianTag('09:30'));
  const update = '[ACAO: ATUALIZAR_PEDIDO|hora=11:00|sinal_exigido=sim|pedido=req-1]';
  const updated = await run({ draft: update, appointments: [], current: 'pode ser 11h' });
  assert.equal(updated.text, '[ACAO: ATUALIZAR_PEDIDO|hora=11:00|pedido=req-1]');
});

test('motor isolado grava deposit_required só com a marca do sistema', async () => {
  const code = built();
  const extract = name => {
    const start = [code.indexOf('\nfunction ' + name + '('), code.indexOf('\nasync function ' + name + '(')]
      .find(index => index > 0) ?? -1;
    assert.ok(start > 0, name);
    return code.slice(start, code.indexOf('\n}\n', start) + 3);
  };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const evaluate = new AsyncFunction('text', [
    'const writes = []; const tenantSlug = "ic_salon"; const turn = { boundary_id: "b", messages: [{ event_id: "e" }] };',
    'const normalizeText = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();',
    'const encodeFilter = value => encodeURIComponent(value); const appointmentRequestConfig = () => ({ reply_mode: "contextual" });',
    'const supabaseGet = async () => [{ name: "Corte", estimated_hours: 1 }]; const groundingIsFullName = () => true;',
    'const parseAppointmentStartAt = () => "2099-11-12T12:30:00.000Z";',
    'const writeContextualAppointmentRequest = async (context, open, fields, details) => { writes.push(details); return { id: "n" }; };',
    extract('appointmentTagDetails'), extract('parseAppointmentRequestAction'), extract('saveAppointmentRequest'),
    'const action = parseAppointmentRequestAction(text); await saveAppointmentRequest({ tenant: { id: "t" } }, action, null);',
    'return { action, details: writes[0] };',
  ].join('\n'));
  const tag = ianTag('09:30');
  const marked = await evaluate(tag.replace(']', '|sinal_exigido=sim]'));
  assert.equal(marked.action.depositRequired, true);
  assert.equal(marked.details.deposit_required, true);
  const plain = await evaluate(tag);
  assert.equal(plain.action.depositRequired, false);
  assert.ok(!('deposit_required' in plain.details));
});

// Caso real de 11/11/2026 23:54Z: sessão nova, nenhum agendamento, "Quero cortar cabelo" + "Amanhã" + "9:30", sem nome na sessão.
const askName = 'Para eu anotar certinho, qual é o seu nome completo?';
const ianTurn = 'Quero cortar cabelo\nAmanhã\n9:30';
// Revisor como o observado: reprova o texto de reparo que pede dado para um pedido (sem contexto recente).
const strictReviewer = payload => ({ allowed: false, evidence_id: '', existing_acknowledged: true, deposit_acknowledged: true, remove_suffix: '' });
const repairAsksName = () => 'Perfeito! Para o corte amanhã às 9:30, qual é o seu nome completo?';

test('caso Ian 23:54: tag com nome não comprovado pede o nome completo, sem reparo e sem erro', async () => {
  for (const name of ['Ian Shtorache', 'Ian amarelo', '']) {
    const result = await run({ draft: ianTag('09:30', name), current: ianTurn, appointments: [], evidence: [],
      audit: strictReviewer, repaired: repairAsksName });
    assert.equal(result.text, askName, 'nome=' + name);
    assert.equal(result.repairs.length, 0);
    assert.equal(result.reviews.length, 0);
    assert.equal(result.diag.adapter_outcome, 'name_requested');
    assert.equal(result.diag.adapter_reason, name ? 'name_unproven' : 'name_missing');
    assert.ok(!JSON.stringify(result.diag).includes('Ian'), 'o diagnóstico não carrega dados pessoais');
  }
  const custom = await run({ draft: ianTag('09:30', 'Ian amarelo'), current: ianTurn, appointments: [],
    requestSettings: { full_name_template: 'Qual seu nome completo, por favor?' } });
  assert.equal(custom.text, 'Qual seu nome completo, por favor?');
});

test('caso Ian 23:54: nome só de reserva anterior pede confirmação desse nome sem depender do reparo', async () => {
  const previous = outcome('old-1', 'completed', '2026-10-01T13:00:00.000Z');
  const result = await run({ draft: ianTag('09:30'), current: ianTurn, appointments: [previous], audit: strictReviewer });
  assert.equal(result.text, 'Posso registrar esse pedido no nome Ian Shtorache?');
  assert.equal(result.repairs.length, 0);
  assert.equal(result.diag.adapter_outcome, 'name_confirmation_requested');
});

test('caso Ian 23:54: texto pedindo o nome é revisto com contexto e com a regra de dado faltante', async () => {
  const draft = 'Perfeito! Para o corte amanhã às 9:30, qual é o seu nome completo?';
  const result = await run({ draft, current: ianTurn, appointments: [],
    audit: { allowed: true, evidence_id: '', existing_acknowledged: true, deposit_acknowledged: true, remove_suffix: '' } });
  assert.equal(result.text, draft);
  assert.ok(Array.isArray(result.reviews[0].recent_context), 'o revisor recebe o contexto recente também sem ação');
  assert.ok(result.reviewPrompts[0].includes('Pedir um dado que falta para o pedido'));
  assert.equal(result.diag.adapter_outcome, 'passed');
});

test('reprovação semântica persistente não usa a mensagem de erro técnico', async () => {
  const result = await run({ draft: 'Perfeito! Qual é o seu nome completo?', current: ianTurn, appointments: [],
    audit: strictReviewer, repaired: repairAsksName });
  assert.equal(result.repairs.length, 2);
  assert.ok(!result.text.startsWith('Não consegui concluir'), result.text);
  assert.ok(result.text.endsWith(' ' + handoff));
  assert.equal(result.diag.adapter_outcome, 'review_handoff');
  assert.equal(result.diag.adapter_reason, 'repair_review_rejected');
  assert.deepEqual(result.diag.adapter_trail.slice(0, 1), ['review_rejected']);
  const technical = await run({ draft: 'Já anotei seu pedido.', current: ianTurn, appointments: [] });
  assert.ok(technical.text.startsWith('Não consegui concluir'));
  assert.equal(technical.diag.adapter_outcome, 'processing_error');
  assert.equal(technical.diag.adapter_reason, 'repair_empty');
});

test('motor isolado grava o diagnóstico do adaptador no raw_payload do evento de saída', () => {
  const code = built();
  const start = code.indexOf('  const salonAdapter =');
  const end = code.indexOf('  // Quais marcações a IA devolveu', start);
  assert.ok(start > 0 && end > start);
  const evaluate = new Function('helpers', 'const event = { raw_payload: { x: 1 } };\n' + code.slice(start, end) + '\nreturn event.raw_payload;');
  assert.deepEqual(evaluate({ salonAdapterDiagnostics: () => ({ adapter_outcome: 'name_requested', adapter_reason: 'name_missing', adapter_trail: ['name_missing'] }) }),
    { x: 1, adapter_outcome: 'name_requested', adapter_reason: 'name_missing', adapter_trail: ['name_missing'] });
  assert.deepEqual(evaluate({}), { x: 1 });
});

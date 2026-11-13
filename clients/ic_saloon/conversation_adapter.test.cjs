const assert = require('node:assert/strict');
const { test } = require('node:test');
const { wrapSalonEngine } = require('./conversation_adapter.cjs');

const tenant = '76aff8a0-0466-42b9-a80d-db186ff3d8bd';
const chat = '5511000000000@s.whatsapp.net';
const name = 'João Victor Santos';
const handoff = ' [HUMANO_SOLICITADO]';
const tpl = {
  processing: 'Tive um problema técnico aqui. A equipe continua seu atendimento.',
  review: 'A equipe vai conferir esse ponto com você.',
  fullName: 'Qual é o seu nome completo, por favor?',
  nameConfirm: 'Posso registrar no nome {nome}?',
  conflict: 'Você já tem {servicos} na {data}, às {hora}. A equipe confere com você.',
};
const priceFallback = 'A equipe pode confirmar o valor certinho para você.';
const tag = '[ACAO: CRIAR_AGENDAMENTO|nome=' + name + '|servico=Corte|data=2099-09-29|hora=10:00|status=pending_confirmation]';
const repairText = 'Qual horário você prefere para o corte?';
const priceQuestion = { currentText: 'Quanto custa o corte?', priceRequestQuote: 'Quanto custa o corte?' };
const core = [
  'const NORIA_NODE_PHASE = $json.noria_engine_phase;',
  'const helpers = this.helpers;',
  'for (const options of $json.calls) await helpers.httpRequest(options);',
  'const response = await helpers.httpRequest($json.modelRequest);',
  'return { response, diagnostics: helpers.salonAdapterDiagnostics() };',
].join('\n');

const base = 'https://db.test';
const eventUrl = base + '/rest/v1/channel_events?select=*&tenant_slug=eq.ic_salon&channel_type=eq.whatsapp'
  + '&external_conversation_id=eq.' + encodeURIComponent(chat) + '&created_at=gt.2026-11-10T00%3A00%3A00Z&limit=50';
const input = {
  tenant_id: tenant, tenant_slug: 'ic_salon', instance: 'ic_saloon', remoteJid: chat, noria_engine_phase: 'single',
  calls: [
    { method: 'GET', url: base + '/rest/v1/tenant_settings?select=*&tenant_id=eq.' + tenant },
    { method: 'GET', url: eventUrl },
  ],
  modelRequest: {
    method: 'POST', url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent',
    body: {
      system_instruction: { parts: [{ text: 'AGENDAMENTOS CONHECIDOS PELO SISTEMA\nREGRAS OPERACIONAIS CURTAS' }] },
      contents: [{ role: 'user', parts: [{ text: 'Quero marcar corte para mim.' }] }],
    },
  },
};
const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
const execute = AsyncFn('$json', '$env', wrapSalonEngine(core));
// Variante com o orçamento diário do motor (geminiRateRpc / geminiTenantBudget), como no script publicado.
// O motor roda numa função interna: só enxerga o adaptador por helpers e registra a reserva por setGeminiExtraReservation.
const budgetCore = core.replace('const helpers = this.helpers;', [
  'const helpers = this.helpers;',
  "const geminiTenantBudget = { tenant_id: '" + tenant + "', daily_limit: 100 };",
  "async function geminiRateRpc(name, body) { return helpers.httpRequest({ method: 'POST', url: 'https://db.test/rest/v1/rpc/' + name, body }); }",
  "function geminiControlError(reason) { const error = new Error('GEMINI_' + reason); error.reason = reason; return error; }",
  'async function reserveGeminiExtraCall(model, estimatedTokens) {',
  "  const result = await geminiRateRpc('magia_gemini_reserve', { p_tenant_id: geminiTenantBudget.tenant_id, p_daily_limit: geminiTenantBudget.daily_limit,",
  "    p_model: model, p_lease_id: 'ic_salon_extra:' + Date.now() + ':' + Math.random(), p_estimated_tokens: estimatedTokens });",
  '  if (!result || result.allowed !== true) throw geminiControlError(result && result.reason);',
  '}',
  'helpers.setGeminiExtraReservation(reserveGeminiExtraCall);',
].join('\n'));
const executeWithBudget = AsyncFn('$json', '$env', wrapSalonEngine(budgetCore));
const reply = (text, finishReason = 'STOP') => ({ candidates: [{ finishReason, content: { parts: [{ text }] } }] });
const okVerdict = { allowed: true, evidence_id: '', existing_acknowledged: true, deposit_acknowledged: true, remove_suffix: '', remove_prefix: '',
  claims_registration: false, claims_availability: false, price_unrequested: false,
  wrong_contact_name: false, recipient_assumed: false, claims_cancellation: false, shares_payment_or_contact: false, style_violation: false };
// Geração que não rende texto utilizável: o Gemini falhou e o adaptador cai no template técnico do Supabase.
const noGeneration = [{ text: '', finishReason: 'MAX_TOKENS' }];
const withEvidence = { ...okVerdict, evidence_id: 'event-old' };
// O revisor simulado declara, pelo significado, se o rascunho afirma que o pedido foi anotado, registrado ou reservado.
// Sem rascunho (revisão da ação de registro) o campo é sempre falso. Os textos abaixo são só a simulação dessa leitura do Gemini.
const claimingTexts = ['Já anotei', 'Já anotei seu pedido.', 'Pedido anotado, tudo certo, já anotei.', 'Combinado, deixei tudo certo para você.'];
const claimAware = body => ({ ...okVerdict, claims_registration: claimingTexts.includes(body.draft) });
// O revisor simulado também declara, pelo significado, se o rascunho afirma ou sugere horário livre (a IA não vê a agenda).
const availabilityTexts = ['Temos horários disponíveis para hoje!', 'Para essa parte do dia temos horários à tarde, 13:30, 14:30?', 'Tenho vaga amanhã cedo.'];
const availabilityAware = body => ({ ...okVerdict, claims_availability: availabilityTexts.includes(body.draft) });
// 2099-09-29 10:00 em São Paulo (UTC-3) é o mesmo horário da tag; a outra reserva é futura e em horário distinto.
const sameSlot = { id: 'apt-same', status: 'confirmed', title: 'Corte - Maria', contact_name: 'Maria', starts_at: '2099-09-29T13:00:00Z',
  created_at: '2026-11-01T10:00:00Z', metadata: { services: ['Corte'] } };
const otherSlot = { ...sameSlot, id: 'apt-other', starts_at: '2099-09-30T17:30:00Z' };
const past = (id, status, startsAt, extra = {}) => ({ id, status, title: 'Corte - Maria', contact_name: 'Maria', starts_at: startsAt,
  created_at: startsAt, metadata: { services: ['Corte'] }, ...extra });

async function run({ draft = tag, evidence = true, verdict = withEvidence, priceReport, currentText, scope = input,
  priceRequestQuote = '', finishReason = 'STOP', repairs = [repairText], appointments = [], appointmentsFail = false, settings, catalogPrice, auditFail, withBudget = false, budgetAllowed = true } = {}) {
  const rpcCalls = [];
  const requests = [];
  const reviews = [];
  const generations = [];
  const audits = [];
  let repairIndex = 0;
  if (currentText) {
    scope = structuredClone(scope);
    scope.modelRequest.body.contents[0].parts[0].text = currentText;
  }
  const config = settings || { appointment_request: {
    processing_error_template: tpl.processing, review_handoff_template: tpl.review, full_name_template: tpl.fullName,
    name_confirmation_template: tpl.nameConfirm, conflict_existing_appointment_template: tpl.conflict,
  }, price_rejection_template: priceFallback };
  const output = await (withBudget ? executeWithBudget : execute).call({ helpers: { async httpRequest(options) {
    const url = new URL(options.url);
    requests.push(options);
    if (url.pathname.includes('/rpc/')) {
      rpcCalls.push({ name: url.pathname.split('/').at(-1), body: options.body });
      return budgetAllowed ? { allowed: true, reason: 'ok' } : { allowed: false, reason: 'tenant_daily_limit_exceeded' };
    }
    if (url.pathname.endsWith('tenant_settings')) return [{ settings: config }];
    if (url.pathname.endsWith('channel_events')) {
      if (url.searchParams.get('limit') === '50') return [];
      // Fronteira do atendimento: mesmo tenant, conversa e janela do histórico do CORE, somente falas do contato.
      assert.equal(url.searchParams.get('limit'), '250');
      assert.equal(url.searchParams.get('tenant_id'), 'eq.' + tenant);
      assert.equal(url.searchParams.get('tenant_slug'), 'eq.ic_salon');
      assert.equal(url.searchParams.get('external_conversation_id'), 'eq.' + chat);
      assert.equal(url.searchParams.get('created_at'), 'gt.2026-11-10T00:00:00Z');
      assert.equal(url.searchParams.get('direction'), 'eq.inbound');
      assert.equal(url.searchParams.get('sender_type'), 'eq.contact');
      return evidence ? [{ id: 'event-old', message_text: name }] : [];
    }
    if (url.pathname.endsWith('appointments')) {
      assert.equal(url.searchParams.get('tenant_id'), 'eq.' + tenant);
      assert.equal(url.searchParams.get('channel_type'), 'eq.whatsapp');
      assert.equal(url.searchParams.get('external_conversation_id'), 'in.("' + chat + '","5511000000000")');
      assert.match(url.searchParams.get('or'), /^\(and\(status\.in\.\(confirmed,pending_confirmation,scheduled,reserved,pending_payment,payment_requested,payment_reported,aguardando_verificacao\),starts_at\.gte\..+\),status\.in\.\(no_show,cancelled,completed,done\)\)$/);
      
      if (appointmentsFail) throw Error('appointments down');
      return appointments;
    }
    if (url.pathname.endsWith('tenant_service_catalog')) {
      assert.equal(url.searchParams.get('tenant_id'), 'eq.' + tenant);
      assert.equal(url.searchParams.get('active'), 'eq.true');
      assert.equal(url.searchParams.get('limit'), '251');
      return [{ tenant_id: tenant, active: true, external_id: 'corte', name: 'Corte', price: catalogPrice ?? 140, metadata: { price_type: 'fixed' } }];
    }
    const system = options.body.system_instruction.parts[0].text;
    if (system.startsWith('Você é um auditor de mensagens')) {
      const message = JSON.parse(options.body.contents[0].parts[0].text).message;
      audits.push(message);
      // Falhas do auditor de preço: exceção (429, timeout), resposta truncada ou JSON inválido.
      if (auditFail === 'http429') throw Object.assign(Error('Too Many Requests'), { httpCode: '429' });
      if (auditFail === 'timeout') throw Error('The service timed out');
      if (auditFail === 'truncated') return reply('{"complete":', 'MAX_TOKENS');
      if (auditFail === 'invalid_json') return reply('isto não é JSON');
      const segments = typeof priceReport === 'function' ? priceReport(message) : priceReport;
      return reply(JSON.stringify({ complete: true, segments: segments || [{ kind: 'non_price', text: message }],
        price_requested: Boolean(priceRequestQuote), price_request_quote: priceRequestQuote }));
    }
    if (system.startsWith('Valide a resposta do salão')) {
      const body = JSON.parse(options.body.contents[0].parts[0].text);
      reviews.push(body);
      if (verdict === null) return reply('isto não é JSON');
      return reply(JSON.stringify(typeof verdict === 'function' ? verdict(body) : verdict));
    }
    // Geração: 2 partes é o rascunho (instrução + nomes do atendimento); 3 ou mais é o reparo.
    generations.push(options.body.system_instruction.parts);
    assert.equal(JSON.stringify(options.body.contents).includes(name), false);
    if (options.body.system_instruction.parts.length === 2) {
      assert.equal(options.body.system_instruction.parts[1].text.includes(name), evidence);
      return reply(draft, finishReason);
    }
    const next = typeof repairs === 'function' ? repairs(options.body.system_instruction.parts)
      : repairs[Math.min(repairIndex++, repairs.length - 1)];
    return typeof next === 'string' ? reply(next) : reply(next.text, next.finishReason);
  } } }, scope, { SUPABASE_URL: base });
  return { text: output.response.candidates[0].content.parts[0].text, diagnostics: output.diagnostics, requests, reviews, generations, audits, rpcCalls };
}

test('ação de registro só é liberada com evidência do cliente e sem pendências; o texto final é só a tag', async () => {
  const allowed = await run({ draft: 'Já anotei seu pedido! ' + tag });
  assert.equal(allowed.text, tag);
  assert.equal(allowed.diagnostics.adapter_outcome, 'creation_allowed');
  assert.deepEqual(allowed.diagnostics.adapter_trail, []);
  assert.equal(allowed.reviews.length, 1);
  assert.deepEqual(allowed.reviews[0].booking, {
    name, service: 'Corte', date: '2099-09-29', time: '10:00', local_date: allowed.reviews[0].booking.local_date,
    name_source: 'fala_do_cliente', existing_appointments: [], deposit_required: false,
  });
  assert.deepEqual(allowed.reviews[0].name_evidence, [{ id: 'event-old', text: name }]);
  // A leitura de reservas e a de nomes usam sempre o escopo do tenant e da conversa (asserções no mock).
  assert.ok(allowed.requests.some(item => item.url.includes('/rest/v1/appointments?')));

  // Evidência inventada ou revisão que nega: nada é gravado; o reparo responde sem tag.
  const invented = await run({ verdict: body => body.booking ? { ...okVerdict, evidence_id: 'invented' } : okVerdict });
  assert.equal(invented.text, repairText);
  assert.equal(invented.diagnostics.adapter_outcome, 'repaired');
  assert.deepEqual(invented.diagnostics.adapter_trail, ['evidence_mismatch']);
  const rejected = await run({ verdict: body => body.booking ? { ...okVerdict, allowed: false } : okVerdict });
  assert.equal(rejected.text, repairText);
  assert.deepEqual(rejected.diagnostics.adapter_trail, ['review_rejected']);
  assert.match(rejected.generations.at(-1).at(-1).text, /^Nenhum pedido foi gravado neste turno\./);

  // Reprovação de conteúdo em todos os reparos: texto de revisão da equipe com transferência, nunca a tag.
  const noRepair = await run({ verdict: { ...okVerdict, allowed: false, evidence_id: 'invented' }, repairs: ['Já anotei seu pedido.'] });
  assert.equal(noRepair.text, tpl.review + handoff);
  assert.equal(noRepair.diagnostics.adapter_outcome, 'review_handoff');
  assert.equal(noRepair.text.includes('ACAO'), false);

  // Revisão indisponível (JSON inválido) e reparos truncados: falha técnica, mensagem de processamento com transferência.
  const unavailable = await run({ verdict: null, repairs: [{ text: 'x', finishReason: 'MAX_TOKENS' }] });
  assert.equal(unavailable.text, tpl.processing + handoff);
  assert.equal(unavailable.diagnostics.adapter_outcome, 'processing_error');
  assert.deepEqual(unavailable.diagnostics.adapter_trail, ['review_unavailable', 'repair_finish', 'repair_finish']);
});

test('sem evidência do nome em fala do cliente o Gemini pede o nome completo; o template do Supabase é só fallback técnico', async () => {
  const askSurname = 'Anotei o João, falta só o sobrenome para eu registrar. Qual é?';
  const result = await run({ evidence: false, repairs: [askSurname] });
  assert.equal(result.text, askSurname);
  assert.equal(result.diagnostics.adapter_outcome, 'name_requested');
  assert.equal(result.diagnostics.adapter_message_source, 'gemini');
  assert.deepEqual(result.diagnostics.adapter_trail, ['name_unproven']);
  assert.equal(result.reviews.length, 1, 'o texto escrito pelo Gemini passa pelo mesmo revisor do reparo');
  assert.equal(result.generations.length, 2);
  // A intenção vai ao Gemini com o nome já dito (dado, não frase pronta) e nunca pede registro nem horário livre.
  const intent = result.generations.at(-1).at(-1).text;
  assert.match(intent, /nome completo/);
  assert.ok(intent.includes(JSON.stringify(name)), 'o nome já informado vai como dado para o Gemini reconhecer');
  assert.equal(intent.includes(tpl.fullName), false);
  // Gemini indisponível, truncado ou reprovado: aí sim vale o template técnico, sem transferência.
  for (const repairs of [noGeneration, [reply(askSurname).candidates[0].content.parts[0].text]]) {
    const technical = await run({ evidence: false, repairs, verdict: repairs === noGeneration ? okVerdict : { ...okVerdict, allowed: false } });
    assert.equal(technical.text, tpl.fullName);
    assert.equal(technical.diagnostics.adapter_outcome, 'name_requested');
    assert.equal(technical.diagnostics.adapter_message_source, 'template_fallback');
  }
  // Tag sem nome: mesmo caminho, outro código.
  const missing = await run({ evidence: false, draft: tag.replace('nome=' + name + '|', ''), repairs: [askSurname] });
  assert.equal(missing.text, askSurname);
  assert.deepEqual(missing.diagnostics.adapter_trail, ['name_missing']);
  // Sem serviço, dia e hora prontos, o pedido do nome vira reparo com orientação para perguntar o dado que falta.
  const incomplete = await run({ evidence: false, draft: '[ACAO: CRIAR_AGENDAMENTO|nome=' + name + '|data=2099-09-29]' });
  assert.equal(incomplete.text, repairText);
  assert.deepEqual(incomplete.diagnostics.adapter_trail, ['name_unproven']);
  // Template configurado inválido (marcador sem reserva) cai no padrão do código.
  const defaults = await run({ evidence: false, repairs: noGeneration, settings: { appointment_request: { full_name_template: '{nome}' }, price_rejection_template: priceFallback } });
  assert.equal(defaults.text, 'Para eu anotar certinho, qual é o seu nome completo?');
});

test('afirmação de registro sem ação, resposta truncada e transferência vazia viram reparo ou revisão da equipe', async () => {
  const claim = await run({ draft: 'Já anotei seu pedido.', verdict: claimAware });
  assert.equal(claim.text, repairText);
  assert.equal(claim.diagnostics.adapter_outcome, 'repaired');
  assert.deepEqual(claim.diagnostics.adapter_trail, ['claims_booking']);
  assert.equal(claim.reviews.length, 2, 'revisão do rascunho e do reparo; a afirmação de registro vem do campo, não de regex');
  assert.match(claim.generations.at(-1).at(-1).text, /^Nenhum pedido foi gravado neste turno\./);

  const stubborn = await run({ draft: 'Já anotei seu pedido.', verdict: claimAware, repairs: ['Pedido anotado, tudo certo, já anotei.'] });
  assert.equal(stubborn.text, tpl.review + handoff);
  assert.equal(stubborn.diagnostics.adapter_outcome, 'review_handoff');
  assert.deepEqual(stubborn.diagnostics.adapter_trail, ['claims_booking', 'repair_claim', 'repair_claim']);
  assert.match(stubborn.generations.at(-1).at(-1).text, /A tentativa anterior não pôde ser usada/);

  // Revisor nega a resposta informativa: o reparo também é negado, então vai à equipe.
  const denied = await run({ draft: 'Tudo pronto com a sua marcação.', verdict: { ...okVerdict, allowed: false } });
  assert.equal(denied.text, tpl.review + handoff);
  assert.deepEqual(denied.diagnostics.adapter_trail, ['review_rejected', 'repair_review_rejected', 'repair_review_rejected']);

  // MAX_TOKENS: com reparo utilizável vira reparo; sem ele, é falha técnica.
  const truncated = await run({ draft: 'Já anotei', finishReason: 'MAX_TOKENS' });
  assert.equal(truncated.text, repairText);
  assert.deepEqual(truncated.diagnostics.adapter_trail, ['finish_reason']);
  const broken = await run({ draft: 'Já anotei', finishReason: 'MAX_TOKENS', repairs: [{ text: 'Já anotei', finishReason: 'MAX_TOKENS' }] });
  assert.equal(broken.text, tpl.processing + handoff);
  assert.equal(broken.diagnostics.adapter_outcome, 'processing_error');

  // Padrões do código quando o tenant não configura os textos.
  const defaults = await run({ draft: 'Já anotei', finishReason: 'MAX_TOKENS', settings: { price_rejection_template: priceFallback },
    repairs: [{ text: '', finishReason: 'STOP' }] });
  assert.equal(defaults.text, 'Não consegui concluir isso por aqui agora. Vou pedir para a equipe conferir e continuar seu atendimento.' + handoff);
  assert.deepEqual(defaults.diagnostics.adapter_trail, ['finish_reason', 'repair_empty', 'repair_empty']);
  const defaultReview = await run({ draft: 'Já anotei seu pedido.', verdict: claimAware, settings: { price_rejection_template: priceFallback }, repairs: ['Já anotei'] });
  assert.equal(defaultReview.text, 'Vou pedir para a equipe conferir esse ponto com você por aqui, tá bem?' + handoff);

  const empty = await run({ draft: '[HUMANO_SOLICITADO]' });
  assert.equal(empty.text, repairText);
  assert.deepEqual(empty.diagnostics.adapter_trail, ['empty_handoff']);
  const unexpected = await run({ draft: 'Pronto. [ACAO: AGENDAMENTO_CONFIRMADO|id=1]' });
  assert.equal(unexpected.text, repairText);
  assert.deepEqual(unexpected.diagnostics.adapter_trail, ['unexpected_tag']);
});

test('afirmação de registro é decisão do revisor (claims_registration): palavra solta não reprova e sinônimo reprova', async () => {
  // Sem as palavras de antes, mas o Gemini diz que a resposta afirma registro: reparo.
  const synonym = await run({ draft: 'Combinado, deixei tudo certo para você.', verdict: claimAware });
  assert.equal(synonym.text, repairText);
  assert.deepEqual(synonym.diagnostics.adapter_trail, ['claims_booking']);
  // Palavra do antigo regex em frase que não afirma registro: o Gemini diz false e a resposta passa.
  const harmless = await run({ draft: 'Anotei sua dúvida e já explico: o corte leva uma hora.', verdict: claimAware });
  assert.equal(harmless.text, 'Anotei sua dúvida e já explico: o corte leva uma hora.');
  assert.equal(harmless.diagnostics.adapter_outcome, 'passed');
  // Falha fechada: campo ausente ou não booleano nunca libera a resposta.
  const { claims_registration: _omitted, ...incomplete } = okVerdict;
  for (const verdict of [incomplete, { ...okVerdict, claims_registration: 'false' }]) {
    const closed = await run({ draft: 'Posso ajudar com mais alguma coisa?', verdict });
    assert.notEqual(closed.text, 'Posso ajudar com mais alguma coisa?');
    assert.equal(closed.diagnostics.adapter_trail[0], 'claims_booking');
  }
  // O esquema do revisor exige os campos novos.
  const reviewer = harmless.requests.find(item => (item.body?.system_instruction?.parts?.[0]?.text || '').startsWith('Valide a resposta do salão'));
  assert.ok(reviewer.body.generationConfig.responseSchema.required.includes('claims_registration'));
  assert.ok(reviewer.body.generationConfig.responseSchema.required.includes('remove_prefix'));
  assert.ok(reviewer.body.generationConfig.responseSchema.required.includes('claims_availability'));
});

test('a IA não vê a agenda: afirmar ou sugerir horário livre é reprovado pelo revisor (claims_availability) e vai a reparo', async () => {
  for (const draft of availabilityTexts) {
    const result = await run({ draft, verdict: availabilityAware });
    assert.equal(result.text, repairText, draft);
    assert.equal(result.diagnostics.adapter_outcome, 'repaired');
    assert.deepEqual(result.diagnostics.adapter_trail, ['claims_availability']);
    assert.equal(result.reviews.length, 2, 'revisão do rascunho e do reparo');
    assert.match(result.generations.at(-1).at(-1).text, /não vê a agenda/);
  }
  // Reparo que insiste em horário livre: nunca vai ao cliente, a equipe assume.
  const stubborn = await run({ draft: availabilityTexts[0], verdict: availabilityAware, repairs: [availabilityTexts[1]] });
  assert.equal(stubborn.text, tpl.review + handoff);
  assert.equal(stubborn.diagnostics.adapter_outcome, 'review_handoff');
  assert.deepEqual(stubborn.diagnostics.adapter_trail, ['claims_availability', 'repair_availability', 'repair_availability']);
  // Falha fechada: campo ausente ou não booleano nunca libera a resposta.
  const { claims_availability: _omitted, ...incomplete } = okVerdict;
  for (const verdict of [incomplete, { ...okVerdict, claims_availability: 'false' }]) {
    const closed = await run({ draft: 'Posso ajudar com mais alguma coisa?', verdict });
    assert.notEqual(closed.text, 'Posso ajudar com mais alguma coisa?');
    assert.equal(closed.diagnostics.adapter_trail[0], 'claims_availability');
  }
  // Resposta que só pergunta a preferência da pessoa passa.
  const ask = await run({ draft: 'Qual dia e horário você prefere?', verdict: availabilityAware });
  assert.equal(ask.text, 'Qual dia e horário você prefere?');
  assert.equal(ask.diagnostics.adapter_outcome, 'passed');
  // A regra também vai ao Gemini que escreve o rascunho.
  assert.match(ask.generations[0][0].text, /não vê a agenda/);
});

test('o tratamento da pessoa atendida é neutro: nada no motor ou no adaptador injeta o feminino', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const result = await run({ draft: 'Posso ajudar?', verdict: okVerdict });
  const sent = result.generations[0].map(part => part.text).join('\n');
  assert.match(sent, /homem ou mulher/);
  assert.equal(/bem-vind[ao]/iu.test(sent), false);
  const sources = ['conversation_adapter.cjs', 'salon_engine.js'].map(file => fs.readFileSync(path.join(__dirname, file), 'utf8'));
  for (const source of sources) {
    assert.equal(/\b(a|da|à|uma|esta|essa) cliente\b/iu.test(source), false, 'instruções ao Gemini falam da pessoa atendida, sem flexão de gênero');
    assert.equal(/bem-vinda/iu.test(source), false);
  }
});

test('remove_prefix: o revisor aponta a saudação repetida; o adaptador só corta o trecho literal', async () => {
  const draft = 'Oie, meu bem! Posso conferir o horário para você.';
  const cut = await run({ draft, verdict: { ...okVerdict, remove_prefix: 'Oie, meu bem!' } });
  assert.equal(cut.text, 'Posso conferir o horário para você.');
  assert.equal(cut.diagnostics.adapter_outcome, 'prefix_removed');
  assert.match(cut.reviews[0].draft, /^Oie/);
  // Trecho que não abre o texto, ou que apagaria a resposta inteira, não é removido.
  const middle = await run({ draft, verdict: { ...okVerdict, remove_prefix: 'meu bem!' } });
  assert.equal(middle.text, draft);
  const whole = await run({ draft: 'Oie, meu bem!', verdict: { ...okVerdict, remove_prefix: 'Oie, meu bem!' } });
  assert.equal(whole.text, 'Oie, meu bem!');
  const emoji = await run({ draft: '😊 Posso ajudar.', verdict: { ...okVerdict, remove_prefix: '😊' } });
  assert.equal(emoji.text, '😊 Posso ajudar.');
  // Prefixo e convite final juntos.
  const both = await run({ draft: draft + ' Qual horário você prefere?', currentText: 'Quanto custa o corte?',
    verdict: { ...okVerdict, remove_prefix: 'Oie, meu bem!', remove_suffix: 'Qual horário você prefere?' } });
  assert.equal(both.text, 'Posso conferir o horário para você.');
});

test('resposta informativa passa, e a guarda de preço usa só o preço oficial do tenant', async () => {
  const greeting = await run({ draft: 'Tudo bem? Como posso ajudar?', verdict: okVerdict });
  assert.equal(greeting.text, 'Tudo bem? Como posso ajudar?');
  assert.equal(greeting.diagnostics.adapter_outcome, 'passed');
  assert.equal(greeting.generations.length, 1);

  const priceText = 'O corte custa R$ 140,00.';
  const priceSegment = { kind: 'catalog_price', text: priceText, service_id: 'corte', amount_cents: 14000, price_type: 'fixed' };
  const official = await run({ ...priceQuestion, draft: priceText, verdict: okVerdict, priceReport: [priceSegment] });
  assert.equal(official.text, priceText);
  assert.equal(official.diagnostics.adapter_outcome, 'passed');
  const catalogRequest = official.requests.find(item => item.url.includes('tenant_service_catalog'));
  assert.ok(catalogRequest.url.startsWith(base + '/rest/v1/tenant_service_catalog?tenant_id=eq.' + tenant));

  // Preço sem respaldo do catálogo, ou diferente do oficial, é substituído pelo texto configurado.
  const invalid = await run({ ...priceQuestion, draft: 'O corte custa R$ 50,00.', verdict: okVerdict, repairs: noGeneration });
  assert.equal(invalid.text, priceFallback);
  assert.equal(invalid.diagnostics.adapter_outcome, 'price_fallback');
  assert.equal(invalid.diagnostics.adapter_message_source, 'template_fallback');
  assert.deepEqual(invalid.diagnostics.adapter_trail, ['price_rejected', 'repair_finish', 'repair_finish', 'repair_finish', 'repair_finish']);
  // O Gemini reescreve só a afirmação de preço; o texto reparado passa de novo pelo auditor e o preço errado não chega ao cliente.
  const rewritten = 'Esse valor eu prefiro que a equipe confirme certinho para você.';
  const composedPrice = await run({ ...priceQuestion, draft: 'O corte custa R$ 50,00.', verdict: okVerdict, repairs: [rewritten] });
  assert.equal(composedPrice.text, rewritten);
  assert.equal(composedPrice.diagnostics.adapter_outcome, 'price_repaired');
  assert.equal(composedPrice.diagnostics.adapter_message_source, 'gemini');
  // Texto reescrito sem nenhum valor não precisa do auditor; o rascunho com cifra foi auditado.
  assert.deepEqual(composedPrice.audits, ['O corte custa R$ 50,00.']);
  const wrongAmount = await run({ ...priceQuestion, draft: 'O corte custa R$ 50,00.', verdict: okVerdict, repairs: noGeneration,
    priceReport: [{ ...priceSegment, text: 'O corte custa R$ 50,00.', amount_cents: 5000 }] });
  assert.equal(wrongAmount.text, priceFallback);
  assert.equal((await run({ ...priceQuestion, draft: priceText, verdict: okVerdict, catalogPrice: 90, priceReport: [priceSegment], repairs: noGeneration })).text, priceFallback);
  // Sem texto configurado para a rejeição de preço o adaptador falha em vez de inventar uma resposta.
  await assert.rejects(run({ ...priceQuestion, draft: 'O corte custa R$ 50,00.', verdict: okVerdict, settings: {}, repairs: noGeneration }), /IC_SALON_PRICE_REPLY_UNAVAILABLE/);
  // Preço sem respaldo dentro do reparo também é barrado.
  const repairedPrice = await run({ ...priceQuestion, draft: 'Já anotei seu pedido.', verdict: claimAware, repairs: ['O corte custa R$ 50,00.'] });
  assert.equal(repairedPrice.text, tpl.review + handoff);
  assert.deepEqual(repairedPrice.diagnostics.adapter_trail, ['claims_booking', 'repair_price_rejected', 'repair_price_rejected']);
});

test('preço reprovado: o reparo corrige só a afirmação de preço e preserva o resto; o auditor indisponível é diagnosticado à parte', async () => {
  const draft = 'O corte custa R$ 50,00. Amanhã atendemos até as 18h.';
  const fixed = 'O Corte custa R$ 140,00. Amanhã atendemos até as 18h.';
  const report = message => (message === fixed
    ? [{ kind: 'catalog_price', text: 'O Corte custa R$ 140,00.', service_id: 'corte', amount_cents: 14000, price_type: 'fixed' },
      { kind: 'non_price', text: ' Amanhã atendemos até as 18h.' }]
    : [{ kind: 'reject', text: 'O corte custa R$ 50,00.' }, { kind: 'non_price', text: ' Amanhã atendemos até as 18h.' }]);
  const repaired = await run({ ...priceQuestion, draft, verdict: okVerdict, priceReport: report, repairs: [fixed] });
  assert.equal(repaired.text, fixed, 'o resto da resposta (horário de atendimento) é preservado');
  assert.equal(repaired.diagnostics.adapter_outcome, 'price_repaired');
  assert.deepEqual(repaired.diagnostics.adapter_trail, ['price_rejected']);
  assert.deepEqual(repaired.audits, [draft, fixed], 'o texto reparado passa de novo pelo auditor');
  const instruction = repaired.generations.at(-1).at(-1).text;
  assert.ok(instruction.includes('Amanhã atendemos até as 18h.'), 'o rascunho vai ao reparo para preservar o resto');
  assert.match(instruction, /valor oficial do serviço exato se a pessoa pediu preço/);
  // Diagnóstico: motivo, trecho do rascunho da IA e segmentos reprovados.
  const audit = repaired.diagnostics.adapter_price_audit;
  assert.equal(audit.kind, 'rejected');
  assert.equal(audit.draft_excerpt, draft);
  assert.deepEqual(audit.rejected_segments, [{ kind: 'reject', service_id: null, text: 'O corte custa R$ 50,00.' }]);
  // Reparo que mantém o preço errado: nunca vai ao cliente; o template é o último recurso.
  const stubborn = await run({ ...priceQuestion, draft, verdict: okVerdict, priceReport: report, repairs: [draft] });
  assert.equal(stubborn.text, priceFallback);
  assert.equal(stubborn.diagnostics.adapter_outcome, 'price_fallback');
  assert.deepEqual(stubborn.diagnostics.adapter_trail, ['price_rejected', 'repair_price_rejected', 'repair_price_rejected', 'repair_price_rejected', 'repair_price_rejected']);
  // A geração só informa o preço quando a mensagem atual pede o valor.
  assert.match(repaired.generations[0][0].text, /Informe preço somente se a pessoa pedir valor ou orçamento na mensagem atual/);

  // Auditor indisponível (429, timeout, resposta truncada, JSON inválido) não é preço reprovado.
  const cases = [['http429', 'error_429'], ['timeout', 'timeout'], ['truncated', 'finish_MAX_TOKENS'], ['invalid_json', 'invalid_json']];
  for (const [auditFail, reason] of cases) {
    // Reparos que insistem no valor: sem auditor, a frase fixa é o último recurso.
    const down = await run({ draft: 'O corte custa R$ 140,00.', verdict: okVerdict, auditFail, repairs: ['O corte custa R$ 140,00.'] });
    assert.equal(down.text, priceFallback, auditFail);
    assert.equal(down.diagnostics.adapter_trail[0], 'price_audit_unavailable');
    assert.equal(down.diagnostics.adapter_trail.includes('price_rejected'), false);
    assert.deepEqual(down.diagnostics.adapter_trail.slice(1), Array(4).fill('repair_price_audit_unavailable'));
    // Reparo sem nenhum valor sai normalmente, mesmo com o auditor fora do ar.
    const plain = await run({ draft: 'O corte custa R$ 140,00.', verdict: okVerdict, auditFail });
    assert.equal(plain.text, repairText, auditFail);
    assert.deepEqual(down.diagnostics.adapter_price_audit, { kind: 'unavailable', reason, draft_excerpt: 'O corte custa R$ 140,00.' });
  }
  // Relatório que não reconstrói a mensagem é defeito do auditor.
  const broken = await run({ draft: 'O corte custa R$ 140,00.', verdict: okVerdict, priceReport: [{ kind: 'non_price', text: 'outra coisa' }], repairs: noGeneration });
  assert.equal(broken.diagnostics.adapter_price_audit.reason, 'invalid_report');
  assert.equal(broken.diagnostics.adapter_trail[0], 'price_audit_unavailable');
});

test('remove_suffix só corta o convite indevido; o pedido explícito de agendamento é preservado; emoji não é cortado', async () => {
  const priceText = 'O corte custa R$ 140,00.';
  const question = 'Qual horário você prefere para amanhã?';
  const withFollowup = priceText + '\n\n' + question;
  const priceSegment = { kind: 'catalog_price', text: priceText, service_id: 'corte', amount_cents: 14000, price_type: 'fixed' };
  const filtered = await run({ draft: withFollowup, currentText: 'Quanto custa o corte?',
    priceRequestQuote: 'Quanto custa o corte?', verdict: { ...okVerdict, remove_suffix: question }, priceReport: [priceSegment] });
  assert.equal(filtered.text, priceText);
  assert.equal(filtered.diagnostics.adapter_outcome, 'suffix_removed');
  const requested = await run({ draft: withFollowup, currentText: 'Quanto custa o corte? Quero marcar para amanhã.',
    priceRequestQuote: 'Quanto custa o corte?', verdict: okVerdict, priceReport: [priceSegment, { kind: 'non_price', text: '\n\n' + question }] });
  assert.equal(requested.text, withFollowup);
  assert.equal(requested.diagnostics.adapter_outcome, 'passed');
  assert.equal(requested.reviews[0].current, 'Quanto custa o corte? Quero marcar para amanhã.');
  const emoji = await run({ draft: 'Tudo bem? 😊', verdict: { ...okVerdict, remove_suffix: '😊' } });
  assert.equal(emoji.text, 'Tudo bem? 😊');
  assert.equal(emoji.diagnostics.adapter_outcome, 'passed');
  // Trecho que não termina o texto não é removido.
  const middle = await run({ draft: 'Tudo bem? Posso ajudar.', verdict: { ...okVerdict, remove_suffix: 'Tudo bem?' } });
  assert.equal(middle.text, 'Tudo bem? Posso ajudar.');
});

test('agendamento em andamento: a pergunta para seguir nunca é cortada (regressão "só a mão mesmo")', async () => {
  const question = 'Para qual dia e horário você quer marcar para ela?';
  const draft = 'Perfeito, mão tradicional para ela então. ' + question;
  const kept = await run({ draft, currentText: 'deixa, só a mão mesmo',
    verdict: { ...okVerdict, remove_suffix: question, booking_in_progress: true } });
  assert.equal(kept.text, draft);
  assert.equal(kept.diagnostics.adapter_outcome, 'passed');
});

test('reservas futuras do contato entram como contexto e exigem existing_acknowledged', async () => {
  const known = [{ nome: 'Maria', servicos: 'Corte', data: 'quarta-feira, 30 de setembro', hora: '14:30', status: 'confirmed' }];
  const acknowledged = await run({ appointments: [otherSlot] });
  assert.equal(acknowledged.text, tag);
  assert.equal(acknowledged.diagnostics.adapter_outcome, 'creation_allowed');
  assert.deepEqual(acknowledged.reviews[0].booking.existing_appointments, known);
  assert.match(acknowledged.generations[0][0].text, /RESERVAS FUTURAS DESTE CONTATO[^.]*"servicos":"Corte"[^.]*"hora":"14:30"/);

  const pending = await run({ appointments: [otherSlot], verdict: { ...withEvidence, existing_acknowledged: false } });
  assert.equal(pending.text, repairText);
  assert.deepEqual(pending.diagnostics.adapter_trail, ['existing_not_acknowledged']);
  assert.match(pending.generations.at(-1).at(-1).text, /cite serviço, dia e hora da reserva existente/);
  assert.match(pending.generations.at(-1).at(-1).text, /atendimento a mais ou uma mudança/);

  // Reproduz o turno real ("13:30 tá bom"): o modelo devolvia só a tag nos dois reparos (repair_empty, repair_empty) porque o
  // contexto do reparo ainda mandava "devolver somente a tag". O reparo agora suspende o registro e remove essa regra.
  const tagOnlyModel = parts => (parts[0].text.includes('devolva somente a tag de registro') ? tag : repairText);
  const accepted = await run({ appointments: [otherSlot], verdict: { ...withEvidence, existing_acknowledged: false }, repairs: tagOnlyModel });
  assert.equal(accepted.text, repairText);
  assert.equal(accepted.diagnostics.adapter_outcome, 'repaired');
  assert.deepEqual(accepted.diagnostics.adapter_trail, ['existing_not_acknowledged']);
  const repairParts = accepted.generations.at(-1);
  assert.equal(repairParts[0].text.includes('devolva somente a tag'), false);
  assert.match(repairParts.at(-1).text, /NÃO devolva tag/);
  assert.match(repairParts.at(-1).text, /Ignore qualquer regra anterior/);
  // Um modelo que ainda devolvesse só a tag cairia no erro técnico: o diagnóstico continua registrando repair_empty.
  const stubbornTag = await run({ appointments: [otherSlot], verdict: { ...withEvidence, existing_acknowledged: false }, repairs: [tag] });
  assert.deepEqual(stubbornTag.diagnostics.adapter_trail, ['existing_not_acknowledged', 'repair_empty', 'repair_empty']);

  // Reservas passadas, canceladas ou concluídas não são reservas futuras nem exigem confirmação.
  const history = await run({ appointments: [
    past('h1', 'cancelled', '2099-09-29T13:00:00Z'), past('h2', 'completed', '2026-01-10T13:00:00Z'),
    past('h3', 'confirmed', '2026-01-11T13:00:00Z'),
  ] });
  assert.equal(history.text, tag);
  assert.deepEqual(history.reviews[0].booking.existing_appointments, []);
  assert.match(history.generations[0][0].text, /HISTÓRICO DE AGENDAMENTOS/);
  assert.equal(history.generations[0][0].text.includes('RESERVAS FUTURAS'), false);
});

test('tag igual a um pedido pendente já gravado responde sem nova ação', async () => {
  const pending = { ...sameSlot, id: 'apt-p', status: 'pending_confirmation' };
  const result = await run({ appointments: [pending] });
  assert.equal(result.text, repairText);
  assert.deepEqual(result.diagnostics.adapter_trail, ['repeated_pending']);
  assert.equal(result.reviews.length, 1);
  assert.equal(result.reviews[0].booking, null);
});

test('mesmo horário de uma reserva existente: o Gemini escreve o aviso com os dados do sistema e a equipe assume', async () => {
  const written = 'Vi que você já tem Corte na terça-feira, 29 de setembro, às 10:00. A equipe vai olhar esse horário com você.';
  const composed = await run({ appointments: [sameSlot], repairs: [written] });
  assert.equal(composed.text, written + handoff);
  assert.equal(composed.diagnostics.adapter_outcome, 'conflict_handoff');
  assert.equal(composed.diagnostics.adapter_message_source, 'gemini');
  assert.match(composed.generations.at(-1).at(-1).text, /"Corte"/);
  // Dado obrigatório ausente no texto do Gemini: vale o template configurado.
  const missingData = await run({ appointments: [sameSlot], repairs: ['Você já tem um horário marcado. A equipe confere.'] });
  assert.equal(missingData.text, 'Você já tem Corte na terça-feira, 29 de setembro, às 10:00. A equipe confere com você.' + handoff);
  assert.equal(missingData.diagnostics.adapter_message_source, 'template_fallback');
  const result = await run({ appointments: [sameSlot], repairs: noGeneration });
  assert.equal(result.text, 'Você já tem Corte na terça-feira, 29 de setembro, às 10:00. A equipe confere com você.' + handoff);
  assert.equal(result.diagnostics.adapter_outcome, 'conflict_handoff');
  assert.deepEqual(result.diagnostics.adapter_trail, ['conflict_existing', 'repair_finish', 'repair_finish']);
  assert.equal(result.diagnostics.adapter_message_source, 'template_fallback');
  const defaults = await run({ appointments: [sameSlot], repairs: noGeneration, settings: { price_rejection_template: priceFallback } });
  assert.equal(defaults.text, 'Vi aqui que você já tem Corte marcado para terça-feira, 29 de setembro, às 10:00. Vou pedir para a equipe conferir esse horário com você por aqui.' + handoff);
});

test('após falta o novo registro exige sinal acordado e a marca sinal_exigido é do sistema', async () => {
  const noShow = [past('n1', 'no_show', '2026-10-01T13:00:00Z')];
  const asked = await run({ appointments: noShow, verdict: { ...withEvidence, deposit_acknowledged: false } });
  assert.equal(asked.text, repairText);
  assert.deepEqual(asked.diagnostics.adapter_trail, ['deposit_not_acknowledged']);
  assert.equal(asked.reviews[0].booking.deposit_required, true);
  assert.match(asked.generations[0][0].text, /SINAL OBRIGATÓRIO/);
  assert.match(asked.generations.at(-1).at(-1).text, /exige sinal de 50% via Pix/);

  const agreed = await run({ appointments: noShow });
  assert.equal(agreed.text, tag.replace(/\]$/, '|sinal_exigido=sim]'));
  assert.equal(agreed.diagnostics.adapter_outcome, 'creation_allowed');

  // Um comparecimento posterior à falta desfaz a exigência, e a marca vinda do modelo é removida.
  const later = [...noShow, past('c1', 'completed', '2026-10-20T13:00:00Z')];
  const cleared = await run({ appointments: later, draft: tag.replace(/\]$/, '|sinal_exigido=sim]') });
  assert.equal(cleared.text, tag);
  assert.equal(cleared.reviews[0].booking.deposit_required, false);
  assert.equal(cleared.generations[0][0].text.includes('SINAL OBRIGATÓRIO'), false);
});

test('nome só de reserva anterior exige confirmação explícita do cliente', async () => {
  const previous = [past('h9', 'completed', '2026-10-01T13:00:00Z', { contact_name: name })];
  const rejectBooking = body => (body.booking ? { ...okVerdict, allowed: false } : okVerdict);
  const written = 'Da última vez foi no nome ' + name + '. Posso registrar este também?';
  const composed = await run({ evidence: false, appointments: previous, verdict: rejectBooking, repairs: [written] });
  assert.equal(composed.text, written);
  assert.equal(composed.diagnostics.adapter_message_source, 'gemini');
  // Texto do Gemini sem o nome conferido pelo sistema: template configurado.
  const noName = await run({ evidence: false, appointments: previous, verdict: rejectBooking, repairs: ['Posso registrar no mesmo nome de antes?'] });
  assert.equal(noName.text, 'Posso registrar no nome ' + name + '?');
  assert.equal(noName.diagnostics.adapter_message_source, 'template_fallback');
  const asked = await run({ evidence: false, appointments: previous, verdict: { ...okVerdict, allowed: false }, repairs: noGeneration });
  assert.equal(asked.text, 'Posso registrar no nome ' + name + '?');
  assert.equal(asked.diagnostics.adapter_outcome, 'name_confirmation_requested');
  assert.deepEqual(asked.diagnostics.adapter_trail, ['previous_name_unconfirmed', 'repair_finish', 'repair_finish']);
  assert.equal(asked.reviews[0].booking.name_source, 'reserva_anterior');
  assert.deepEqual(asked.reviews[0].name_evidence, [{ id: 'reserva:h9', text: name }]);

  const confirmed = await run({ evidence: false, appointments: previous, verdict: { ...okVerdict, evidence_id: 'reserva:h9' } });
  assert.equal(confirmed.text, tag);
  assert.equal(confirmed.diagnostics.adapter_outcome, 'creation_allowed');
  // Evidência de outra origem não vale para este nome.
  const mismatch = await run({ evidence: false, appointments: previous, verdict: { ...okVerdict, evidence_id: 'event-old' }, repairs: noGeneration });
  assert.equal(mismatch.text, 'Posso registrar no nome ' + name + '?');
  // Fala do cliente prevalece sobre reserva anterior.
  const spoken = await run({ appointments: previous });
  assert.equal(spoken.reviews[0].booking.name_source, 'fala_do_cliente');
});

test('sem leitura confiável das reservas nenhum registro é liberado, mas respostas informativas seguem', async () => {
  const failed = await run({ appointmentsFail: true });
  assert.equal(failed.text, tpl.processing + handoff);
  assert.equal(failed.diagnostics.adapter_outcome, 'processing_error');
  assert.deepEqual(failed.diagnostics.adapter_trail, ['appointments_unavailable']);
  assert.equal(failed.reviews.length, 0);
  const informative = await run({ appointmentsFail: true, draft: 'Tudo bem? Como posso ajudar?', verdict: okVerdict });
  assert.equal(informative.text, 'Tudo bem? Como posso ajudar?');
  assert.equal(informative.diagnostics.adapter_outcome, 'passed');
});

test('o adaptador recusa escopo de outro tenant, instância ou fase', async () => {
  await assert.rejects(run({ scope: { ...input, tenant_id: 'other' } }), /IC_SALON_ADAPTER_SCOPE_INVALID/);
  await assert.rejects(run({ scope: { ...input, instance: 'outra' } }), /IC_SALON_ADAPTER_SCOPE_INVALID/);
  await assert.rejects(run({ scope: { ...input, tenant_slug: 'outro' } }), /IC_SALON_ADAPTER_SCOPE_INVALID/);
  await assert.rejects(run({ scope: { ...input, noria_engine_phase: 'prepare' } }), /IC_SALON_ADAPTER_SCOPE_INVALID/);
});

// IA-22: as chamadas extras ao Gemini (revisão, auditoria de preço, reparo) contam no orçamento diário do tenant.
test('cada chamada extra ao Gemini reserva o orçamento diário do tenant antes de sair', async () => {
  const result = await run({ withBudget: true });
  const extraModelCalls = result.reviews.length + result.audits.length + Math.max(0, result.generations.length - 1);
  assert.ok(extraModelCalls > 0, 'o cenário deve gerar chamadas extras');
  const reserves = result.rpcCalls.filter(call => call.name === 'magia_gemini_reserve');
  assert.equal(reserves.length, extraModelCalls, JSON.stringify(result.rpcCalls.map(call => call.name)));
  for (const reserve of reserves) {
    assert.equal(reserve.body.p_tenant_id, tenant);
    assert.equal(reserve.body.p_daily_limit, 100);
    assert.equal(reserve.body.p_scope, undefined, 'sem escopo global: só o orçamento do tenant, sem lease de concorrência aninhada');
    assert.match(reserve.body.p_lease_id, /^ic_salon_extra:/);
  }
});

test('orçamento esgotado recusa a chamada extra sem chamar o Gemini e cai no fluxo de falha existente', async () => {
  const result = await run({ withBudget: true, budgetAllowed: false }).catch(error => ({ error }));
  assert.ok(result.error || result.text, 'o fluxo termina por erro do Gemini ou por texto de contingência');
  const extra = result.error ? [] : [...result.reviews, ...result.audits];
  assert.equal(extra.length, 0, 'nenhuma revisão nem auditoria pode ter sido enviada ao Gemini');
});

test('o motor real registra a reserva extra e ela conta só no orçamento do tenant (sem escopo global)', () => {
  const engine = require('node:fs').readFileSync(require('node:path').join(__dirname, 'salon_engine.js'), 'utf8').replace(/\r\n/g, '\n');
  assert.match(engine, /helpers\.setGeminiExtraReservation\(reserveGeminiExtraCall\)/);
  const start = engine.indexOf('async function reserveGeminiExtraCall(');
  const body = engine.slice(start, engine.indexOf('\nasync function releaseGeminiConcurrencySlot(', start));
  assert.match(body, /magia_gemini_reserve/);
  assert.doesNotMatch(body, /p_scope|p_max_concurrent/, 'sem lease de concorrência aninhada');
  assert.match(body, /geminiControlError\(String\(result\?\.reason/, 'recusa falha fechada com o mesmo tipo de erro do motor');
});

// A resposta correta sobre "loiro" virava o texto de preço porque a auditoria truncava em 1.800 tokens.
test('falha técnica do auditor pede para repetir (texto do tenant); preço reprovado continua indo à equipe', async () => {
  const settings = { appointment_request: {}, price_rejection_template: priceFallback,
    price_check_retry_template: 'Não consegui conferir essa informação agora. Pode me mandar sua pergunta de novo, por favor? 😊' };
  for (const auditFail of ['http429', 'timeout', 'truncated', 'invalid_json']) {
    const down = await run({ draft: 'Trabalhamos sim! Mechas loiras a partir de R$ 580,00.', verdict: okVerdict, auditFail, settings,
      repairs: ['Mechas loiras a partir de R$ 580,00.'] });
    assert.equal(down.text, settings.price_check_retry_template, auditFail);
    assert.equal(down.diagnostics.adapter_outcome, 'price_fallback');
  }
  // preço fora do catálogo continua com o texto de preço, não com o pedido para repetir
  const wrong = await run({ draft: 'O corte custa R$ 50,00.', verdict: okVerdict, repairs: noGeneration, settings });
  assert.equal(wrong.text, priceFallback);
  // sem o texto configurado, o comportamento anterior é mantido
  const legacy = await run({ draft: 'O corte custa R$ 140,00.', verdict: okVerdict, auditFail: 'truncated', repairs: ['O corte custa R$ 140,00.'] });
  assert.equal(legacy.text, priceFallback);
});

test('revisão e auditoria de preço pedem limite de saída suficiente para a mensagem inteira', async () => {
  const result = await run({ ...priceQuestion, draft: 'O corte custa R$ 140,00.', verdict: okVerdict, priceReport: [{ kind: 'catalog_price', text: 'O corte custa R$ 140,00.', service_id: 'corte', amount_cents: 14000, price_type: 'fixed' }] });
  const limits = result.requests.filter(item => item.body && item.body.generationConfig && item.body.generationConfig.responseMimeType === 'application/json')
    .map(item => item.body.generationConfig.maxOutputTokens);
  assert.ok(limits.length >= 2, 'revisão e auditoria enviadas');
  for (const limit of limits) assert.ok(limit >= 4000, 'limite ' + limit);
});

// Caso real de 12/11 ("As 10?" virou "vou pedir para a equipe conferir"): o reparo precisa saber o que fazer quando o rascunho deu o pedido por combinado.
test('afirmação de pedido combinado recebe orientação de reparo: agradecer, equipe confirma, pedir o próximo dado', async () => {
  const result = await run({ draft: 'Pedido anotado, tudo certo, já anotei.', verdict: claimAware });
  assert.equal(result.diagnostics.adapter_trail[0], 'claims_booking');
  const repairInstruction = result.generations[1].map(part => part.text).join(' ');
  assert.match(repairInstruction, /Nada foi marcado ainda/);
  assert.match(repairInstruction, /a equipe confirma o horário/);
  assert.match(repairInstruction, /UMA pergunta com o próximo dado que falta/);
  assert.equal(result.text, repairText);
});

// Caso real de 12/11 ("Quero loiro e fazer as unhas da mão"): a IA informou o preço sem ninguém pedir.
test('preço citado sem a pessoa pedir volta para o reparo sem valor; preço pedido passa', async () => {
  const priceText = 'Que escolha linda! O corte custa R$ 140,00.';
  const priceSegment = { kind: 'catalog_price', text: priceText, service_id: 'corte', amount_cents: 14000, price_type: 'fixed' };
  const unrequested = await run({ draft: priceText, verdict: body => ({ ...okVerdict, price_unrequested: body.draft === priceText }), priceReport: message => (message === priceText ? [priceSegment] : undefined) });
  assert.equal(unrequested.diagnostics.adapter_trail[0], 'price_unrequested');
  assert.equal(unrequested.text, repairText);
  const guidance = unrequested.generations[1].map(part => part.text).join(' ');
  assert.match(guidance, /Não cite preço, valor nem duração/);
  assert.match(guidance, /no máximo três frases curtas/);
  const asked = await run({ ...priceQuestion, draft: priceText, verdict: { ...okVerdict, price_unrequested: false }, priceReport: [priceSegment] });
  assert.equal(asked.text, priceText);
  assert.equal(asked.diagnostics.adapter_outcome, 'passed');
  // o schema do revisor exige o campo
  const review = unrequested.requests.find(item => item.body && item.body.generationConfig && item.body.generationConfig.responseSchema
    && item.body.generationConfig.responseSchema.required && item.body.generationConfig.responseSchema.required.includes('claims_availability'));
  assert.ok(review.body.generationConfig.responseSchema.required.includes('price_unrequested'));
});

test('preço oficial sem pedido não passa quando o revisor erra a intenção', async () => {
  const text = 'O corte custa R$ 140,00.';
  const segment = { kind: 'catalog_price', text, service_id: 'corte', amount_cents: 14000, price_type: 'fixed' };
  const result = await run({ currentText: 'Quero fazer corte e unhas da mão.', draft: text,
    verdict: { ...okVerdict, price_unrequested: false }, priceReport: [segment] });
  assert.doesNotMatch(result.text, /R\$\s*140,00/);
});

test('reparo não pode devolver preço que a pessoa não pediu', async () => {
  const text = 'O corte custa R$ 140,00.';
  const segment = { kind: 'catalog_price', text, service_id: 'corte', amount_cents: 14000, price_type: 'fixed' };
  const result = await run({ currentText: 'Quero fazer corte e unhas da mão.', draft: text,
    verdict: { ...okVerdict, price_unrequested: true }, priceReport: [segment], repairs: [text, text] });
  assert.doesNotMatch(result.text, /R\$\s*140,00/);
});

test('pedido de preço precisa ter trecho literal na mensagem atual', async () => {
  const text = 'O corte custa R$ 140,00.';
  const segment = { kind: 'catalog_price', text, service_id: 'corte', amount_cents: 14000, price_type: 'fixed' };
  const result = await run({ currentText: 'Quero fazer o corte.', priceRequestQuote: 'Quanto custa o corte?',
    draft: text, verdict: { ...okVerdict, price_unrequested: false }, priceReport: [segment] });
  assert.doesNotMatch(result.text, /R\$\s*140,00/);
});

test('catálogo com valores exige pedido explícito na mensagem atual', async () => {
  const tag = 'Separei tudo para você: [CATALOGO_COMPLETO_COM_PRECOS]';
  const unrequested = await run({ currentText: 'Me mostra todos os serviços.', draft: tag, verdict: okVerdict });
  assert.doesNotMatch(unrequested.text, /CATALOGO_COMPLETO_COM_PRECOS/);
  const requested = await run({ currentText: 'Me mostra o catálogo completo com preços.',
    priceRequestQuote: 'com preços', draft: tag, verdict: okVerdict });
  assert.equal(requested.text, tag);
});

test('novo serviço não herda a mãe como interlocutora ou destinatária sem confirmação', async () => {
  const motherRequest = { ...otherSlot, id: 'apt-mother', status: 'pending_confirmation',
    title: 'Design de sobrancelha - Louzania Santos', contact_name: 'Louzania Santos',
    metadata: { services: ['Design de sobrancelha'] } };
  const scope = structuredClone(input);
  scope.contactName = name;
  const wrong = 'Adorei a escolha, Louzania! Para qual dia e horário você prefere agendar a sua mão tradicional?';
  const corrected = 'Mão tradicional, que tudo! É para sua mãe, a Louzania, novamente, ou para outra pessoa?';
  const result = await run({ scope, evidence: false, appointments: [motherRequest], currentText: 'Só a mão mesmo, best',
    draft: wrong, repairs: [corrected], verdict: body => ({ ...okVerdict,
      wrong_contact_name: body.draft === wrong, recipient_assumed: body.draft === wrong }) });
  assert.equal(result.text, corrected);
  assert.equal(result.diagnostics.adapter_outcome, 'repaired');
  assert.equal(result.reviews[0].contact_display_name, name);
  assert.equal(result.reviews[0].appointment_recipients[0].nome, 'Louzania Santos');
  assert.deepEqual(result.reviews[0].identity_evidence, []);
  const reviewRequest = result.requests.find(item => item.body?.generationConfig?.responseSchema?.required?.includes('claims_availability'));
  assert.ok(reviewRequest.body.generationConfig.responseSchema.required.includes('wrong_contact_name'));
  assert.ok(reviewRequest.body.generationConfig.responseSchema.required.includes('recipient_assumed'));
});

test('correção para namorada não chama João pelo nome da mãe nem altera pedido antigo', async () => {
  const motherRequest = { ...otherSlot, id: 'apt-mother', status: 'pending_confirmation',
    title: 'Design de sobrancelha - Louzania Santos', contact_name: 'Louzania Santos',
    metadata: { services: ['Design de sobrancelha'] } };
  const scope = structuredClone(input);
  scope.contactName = name;
  const wrong = 'Entendi perfeitamente, Louzania! Qual é o nome completo dela para que eu possa organizar o agendamento?';
  const corrected = 'Ah, entendi! A mão tradicional agora é para sua namorada 💕 Qual é o nome completo dela?';
  const result = await run({ scope, evidence: false, appointments: [motherRequest], currentText: 'Não quero marcar pra minha mãe não! Agora quero pra minha namorada linda',
    draft: wrong, repairs: [corrected], verdict: body => ({ ...okVerdict, wrong_contact_name: body.draft === wrong,
      recipient_assumed: false }) });
  assert.equal(result.text, corrected);
  assert.equal(result.diagnostics.adapter_outcome, 'repaired');
  assert.equal(result.reviews[0].current, 'Não quero marcar pra minha mãe não! Agora quero pra minha namorada linda');
});

// Regressão João/Louzania (2026-11-12): primeira_vez=sim foi gravado sem a pessoa ter respondido.
// A leitura de que o cliente informou é do revisor (first_visit_stated); sem ela o campo sai da tag.
test('primeira_vez só segue na tag quando o revisor confirma que o cliente informou sobre a pessoa atendida', async () => {
  const withVisit = tag.replace('|status=', '|primeira_vez=sim|status=');
  const stripped = tag;
  const unstated = await run({ draft: withVisit, verdict: { ...withEvidence, first_visit_stated: false } });
  assert.equal(unstated.text, stripped);
  assert.equal(unstated.diagnostics.adapter_outcome, 'creation_allowed');
  assert.equal(unstated.reviews[0].booking.first_visit, 'sim');
  const reviewRequest = unstated.requests.find(item => item.body?.generationConfig?.responseSchema?.required?.includes('claims_availability'));
  assert.ok(reviewRequest.body.generationConfig.responseSchema.required.includes('first_visit_stated'));

  // Campo ausente na resposta do revisor falha fechado: o dado não é gravado.
  const missing = await run({ draft: withVisit, verdict: withEvidence });
  assert.equal(missing.text, stripped);

  const stated = await run({ draft: withVisit, verdict: { ...withEvidence, first_visit_stated: true } });
  assert.equal(stated.text, withVisit);

  // Sem o campo na tag nada muda e o contexto do revisor não ganha chave extra.
  const none = await run({ draft: tag, verdict: withEvidence });
  assert.equal(none.text, tag);
  assert.equal('first_visit' in none.reviews[0].booking, false);

  // Atualização de pedido também não carrega primeira_vez sem confirmação.
  const update = await run({ draft: 'Pronto, ajustei. [ACAO: ATUALIZAR_PEDIDO|pedido=apt-p|hora=11:00|primeira_vez=sim]', verdict: okVerdict });
  assert.doesNotMatch(update.text, /primeira_vez/);
  assert.match(update.text, /ATUALIZAR_PEDIDO/);
});

test('texto sem número não afirma preço: não depende do auditor (regressão "Oiee" → "manda de novo")', async () => {
  const settings = { appointment_request: {}, price_rejection_template: priceFallback,
    price_check_retry_template: 'Não consegui conferir essa informação agora. Pode me mandar sua pergunta de novo, por favor? 😊' };
  for (const draft of ['Qual é o seu nome completo com sobrenome? ✨', 'Oi! Sou nova na equipe do salão. Como posso te ajudar hoje?']) {
    const result = await run({ draft, verdict: okVerdict, auditFail: 'invalid_json', settings });
    assert.equal(result.text, draft);
    assert.equal(result.diagnostics.adapter_outcome, 'passed');
    assert.deepEqual(result.audits, []);
  }
});

test('relatório do auditor que difere só em espaços ou seletor de emoji reconstrói o texto', async () => {
  const draft = 'O corte custa R$ 140,00.\n\nAté breve ✨️';
  const report = [{ kind: 'catalog_price', text: 'O corte custa R$ 140,00.', service_id: 'corte', amount_cents: 14000, price_type: 'fixed' },
    { kind: 'non_price', text: ' Até breve ✨' }];
  const result = await run({ ...priceQuestion, draft, verdict: okVerdict, priceReport: report });
  assert.equal(result.text, draft);
  assert.equal(result.diagnostics.adapter_outcome, 'passed');
});

test('preço reprovado: antes da frase fixa de preço, tenta uma resposta sem valor nenhum', async () => {
  const draft = 'O corte custa R$ 50,00. Para qual dia você quer?';
  const noPrice = 'Fazemos sim! Para qual dia você quer marcar?';
  const repairs = (parts) => (parts.some(part => /Não cite nenhum valor/.test(part.text)) ? noPrice : draft);
  // Caso real: o auditor leu "Mão" como pedido de preço e reprovou o valor; a pessoa recebia só a frase fixa de preço.
  const result = await run({ draft, verdict: okVerdict, currentText: 'Quero cortar o cabelo', priceRequestQuote: 'Quero cortar o cabelo', repairs,
    priceReport: (message) => (/\d/.test(message) ? [{ kind: 'reject', text: message }] : [{ kind: 'non_price', text: message }]) });
  assert.equal(result.text, noPrice);
  assert.notEqual(result.text, priceFallback);
});

test('"retirei" sem ação de cancelamento é reparado; com a ação de cancelar, passa (regressão Gemini real)', async () => {
  const claim = 'Prontinho, retirei tudo por aqui, fique tranquila.';
  const fixed = 'De qual pedido você quer desistir, do seu ou do de outra pessoa?';
  const verdict = body => ({ ...okVerdict, claims_cancellation: body.draft === claim || /retirei/.test(body.draft || '') });
  const repaired = await run({ draft: claim, currentText: 'cancela tudo', verdict, repairs: [fixed] });
  assert.equal(repaired.text, fixed);
  assert.equal(repaired.diagnostics.adapter_trail[0], 'claims_cancellation');
  const withAction = 'Tudo bem, retirei o pedido da Ana. [ACAO: CANCELAR_PEDIDO|pedido=p1|nome=Ana Souza]';
  const allowed = await run({ draft: withAction, currentText: 'não quero mais o da Ana', verdict });
  assert.equal(allowed.text, withAction);
});

test('chave Pix, CNPJ ou contato nunca saem da IA (regressão Gemini real: CNPJ inventado)', async () => {
  const invented = 'A chave Pix do salão é o CNPJ 45.678.901/0001-23. ✨';
  const fixed = 'A equipe te envia os dados do Pix por aqui quando for preciso, tá bem?';
  const verdict = body => ({ ...okVerdict, shares_payment_or_contact: body.draft === invented });
  const result = await run({ draft: invented, currentText: 'me passa o pix', verdict, repairs: [fixed] });
  assert.equal(result.text, fixed);
  assert.equal(result.diagnostics.adapter_trail[0], 'shares_payment_or_contact');
  const stubborn = await run({ draft: invented, currentText: 'me passa o pix', verdict, repairs: [invented] });
  assert.notEqual(stubborn.text, invented);
});

test('auditor de preço: pergunta curta ("Quanto custa?") vale como pedido do serviço em discussão (regressão Gemini real)', () => {
  const { auditPrompt } = require('./price_guard.cjs').createPriceGuard('tenant-x');
  assert.match(auditPrompt, /pergunta curta de preço sem nome de serviço/);
  assert.match(auditPrompt, /serviço que está sendo discutido no diálogo recente/);
});

test('"Quanto custa?": auditor erra, revisor prova com o trecho literal e o preço oficial sai; sem trecho continua barrado', async () => {
  const priceText = 'O corte custa R$ 140,00.';
  const segment = { kind: 'catalog_price', text: priceText, service_id: 'corte', amount_cents: 14000, price_type: 'fixed', contextual_match: true };
  const proven = await run({ draft: priceText, currentText: 'Quanto custa?', priceRequestQuote: '', priceReport: [segment],
    verdict: { ...okVerdict, price_request_quote: 'Quanto custa?' } });
  assert.equal(proven.text, priceText);
  assert.equal(proven.diagnostics.adapter_outcome, 'passed');
  // Trecho que não está na mensagem atual não prova nada.
  const invented = await run({ draft: priceText, currentText: 'Quero cortar', priceRequestQuote: '', priceReport: [segment],
    verdict: { ...okVerdict, price_request_quote: 'quanto custa' }, repairs: noGeneration });
  assert.notEqual(invented.text, priceText);
});

test('revisor: relatar que a equipe recebeu o pedido pendente e ainda confirma não é registro indevido (regressão "tá confirmado né?")', async () => {
  const pending = [{ id: 'p1', status: 'pending_confirmation', title: 'Corte - Maria', contact_name: 'Maria Souza', starts_at: '2099-09-29T13:00:00Z',
    created_at: '2026-11-01T10:00:00Z', metadata: { services: ['Corte'] } }];
  const result = await run({ draft: 'A equipe já recebeu seu pedido e confirma o horário por aqui.', currentText: 'tá confirmado né?', verdict: okVerdict, appointments: pending });
  const system = JSON.stringify(result.requests.find(item => JSON.stringify(item.body || {}).includes('Valide a resposta do salão'))?.body?.system_instruction || '');
  assert.match(system, /relato de status, não afirmação de registro/);
  assert.ok(result.reviews[0].appointment_recipients.some(item => item.status === 'pending_confirmation'));
});

test('nome completado do pedido pendente segue ao motor, não vira "pedido repetido" (regressão Gemini real)', async () => {
  const partial = { id: 'p-joao', status: 'pending_confirmation', title: 'Corte - João Victor', contact_name: 'João Victor', starts_at: '2099-09-29T13:00:00Z',
    created_at: '2026-11-01T10:00:00Z', metadata: { services: ['Corte'] } };
  const result = await run({ appointments: [partial], verdict: { ...withEvidence, existing_acknowledged: false } });
  assert.equal(result.diagnostics.adapter_outcome, 'creation_allowed', JSON.stringify(result.diagnostics.adapter_trail));
  // Mesmo nome gravado: continua sendo repetição, sem nova ação.
  const same = await run({ appointments: [{ ...partial, contact_name: name }] });
  assert.notEqual(same.diagnostics.adapter_outcome, 'creation_allowed');
});

test('corte do convite nunca deixa a frase pela metade (regressão Gemini real: "Não fazemos unha de gel, mas")', async () => {
  const draft = 'Não fazemos unha de gel, mas temos a mão tradicional. Quer marcar?';
  const half = await run({ draft, currentText: 'vocês fazem unha de gel?', verdict: { ...okVerdict, remove_suffix: 'temos a mão tradicional. Quer marcar?' } });
  assert.equal(half.text, draft, 'o que sobraria não termina como frase: mantém a resposta inteira');
  const whole = await run({ draft, currentText: 'vocês fazem unha de gel?', verdict: { ...okVerdict, remove_suffix: 'Quer marcar?' } });
  assert.equal(whole.text, 'Não fazemos unha de gel, mas temos a mão tradicional.');
});

test('review_model do salão: o revisor usa o modelo configurado; resposta, reparos e auditor de preço seguem no modelo do atendimento', async () => {
  const base = { appointment_request: {}, price_rejection_template: priceFallback };
  const priceText = 'O corte custa R$ 140,00.';
  const segment = { kind: 'catalog_price', text: priceText, service_id: 'corte', amount_cents: 14000, price_type: 'fixed', contextual_match: true };
  const judged = await run({ ...priceQuestion, draft: priceText, verdict: okVerdict, priceReport: [segment], settings: { ...base, review_model: 'gemini-flash-latest' } });
  const models = judged.requests.filter(r => String(r.url).includes('generativelanguage')).map(r => ({
    model: /\/models\/([^:/?]+):/.exec(r.url)[1], kind: JSON.stringify(r.body?.system_instruction || '').slice(0, 40), timeout: r.timeout }));
  const reviewer = models.filter(m => m.kind.includes('Valide a resposta'));
  const auditor = models.filter(m => m.kind.includes('Você é um auditor'));
  assert.ok(reviewer.length && reviewer.every(m => m.model === 'gemini-flash-latest' && m.timeout >= 9000), JSON.stringify(models));
  // O auditor de preço fica no modelo do atendimento (no Flash juntava valores e reprovava preço oficial).
  assert.ok(auditor.length && auditor.every(m => m.model === 'gemini-test'), JSON.stringify(models));
  // Sem configuração: tudo no modelo do atendimento, como antes.
  const plain = await run({ ...priceQuestion, draft: priceText, verdict: okVerdict, priceReport: [segment], settings: base });
  assert.ok(plain.requests.filter(r => String(r.url).includes('generativelanguage')).every(r => r.url.includes('/models/gemini-test:')));
  // Valor inválido é ignorado (nunca vira parte da URL).
  const bad = await run({ ...priceQuestion, draft: priceText, verdict: okVerdict, priceReport: [segment], settings: { ...base, review_model: '../x?key=1' } });
  assert.ok(bad.requests.filter(r => String(r.url).includes('generativelanguage')).every(r => r.url.includes('/models/gemini-test:')));
});

test('boas-vindas ou nome do salão na resposta são reescritos (regressão Gemini real: "Seja muito bem-vinda ao I&C Salon!")', async () => {
  const welcome = 'Oi! Seja muito bem-vinda ao I&C Salon! Como posso ajudar você hoje? ✨';
  const fixed = 'Oi! Acabei de chegar na equipe. Como posso ajudar você hoje? ✨';
  const verdict = body => ({ ...okVerdict, style_violation: body.draft === welcome });
  const settings = { appointment_request: {}, price_rejection_template: priceFallback, business_facts: { name: 'I&C Salon' } };
  const result = await run({ draft: welcome, currentText: 'oi', verdict, repairs: [fixed], settings });
  assert.equal(result.text, fixed);
  assert.equal(result.diagnostics.adapter_trail[0], 'style_violation');
  assert.equal(result.reviews[0].business_name, 'I&C Salon', 'o revisor recebe o nome do salão do cadastro');
  // Reparo que insiste nas boas-vindas também é reprovado.
  const stubborn = await run({ draft: welcome, currentText: 'oi', verdict, repairs: [welcome], settings });
  assert.notEqual(stubborn.text, welcome);
});

test('instrução do adaptador não manda passar desistência de pedido pendente para a equipe (contradizia o cancelamento do motor)', async () => {
  const pending = [{ id: 'p1', status: 'pending_confirmation', title: 'Corte - Maria', contact_name: 'Maria Souza', starts_at: '2099-09-29T13:00:00Z',
    created_at: '2026-11-01T10:00:00Z', metadata: { services: ['Corte'] } }];
  const result = await run({ draft: 'Posso ajudar?', verdict: okVerdict, appointments: pending });
  const sent = result.generations[0].map(part => part.text).join('\n');
  assert.doesNotMatch(sent, /somente para alterar ou cancelar uma reserva existente/);
  assert.match(sent, /pedido pendente[^.]*CANCELAR_PEDIDO/);
});

test('"retirei" sem a marcação: a IA refaz uma vez com a marcação de cancelamento e o motor recebe a ação (regressão Gemini real)', async () => {
  const claim = 'Tudo bem, retirei o pedido da sua mãe. 🌸';
  const withTag = 'Tudo bem, retirei o pedido da sua mãe. 🌸 [ACAO: CANCELAR_PEDIDO|pedido=p1|nome=Louzania Santos]';
  const verdict = body => ({ ...okVerdict, claims_cancellation: /retirei/.test(body.draft || '') });
  // O rascunho principal vem sem tag; a segunda tentativa do modelo principal (com a instrução de cancelamento) traz a tag.
  const repairs = parts => (parts.some(p => /CANCELAMENTO OBRIGATÓRIO/.test(p.text || '')) ? withTag : 'De qual pedido você quer desistir?');
  const result = await run({ draft: claim, currentText: 'Não quero mais marcar pra minha mãe', verdict, repairs });
  assert.equal(result.text, withTag);
  assert.equal(result.diagnostics.adapter_outcome, 'cancel_tag_recovered');
  // Se a segunda tentativa também vier sem tag, segue a proteção: pergunta, sem afirmar cancelamento.
  const noTag = await run({ draft: claim, currentText: 'Não quero mais marcar pra minha mãe', verdict, repairs: () => 'De qual pedido você quer desistir?' });
  assert.equal(noTag.text, 'De qual pedido você quer desistir?');
});

test('revisor: encaminhar mudança de pedido à equipe com [HUMANO_SOLICITADO] é permitido', async () => {
  const result = await run({ draft: 'Posso ajudar?', verdict: okVerdict });
  const system = JSON.stringify(result.requests.find(item => JSON.stringify(item.body || {}).includes('Valide a resposta do salão'))?.body?.system_instruction || '');
  assert.match(system, /contém \[HUMANO_SOLICITADO\]/);
});

test('resposta com a tag de cancelar: "retirei" passa mesmo com o revisor reprovando no geral; o motor confere o pedido (regressão Gemini real)', async () => {
  const draft = 'Tudo bem, retirei o pedido da Ana Julia. [ACAO: CANCELAR_PEDIDO|pedido=p2|nome=Ana Julia Souza]';
  const result = await run({ draft, currentText: 'Desisto do da Ana Julia', verdict: { ...okVerdict, allowed: false, claims_cancellation: true } });
  assert.equal(result.text, draft);
  const system = JSON.stringify(result.requests.find(item => JSON.stringify(item.body || {}).includes('Valide a resposta do salão'))?.body?.system_instruction || '');
  assert.match(system, /contém a tag CANCELAR_PEDIDO/);
  // As checagens específicas continuam valendo na resposta de cancelamento.
  const leaking = await run({ draft: 'Retirei o pedido. A chave Pix é 123. [ACAO: CANCELAR_PEDIDO|pedido=p2|nome=Ana Julia Souza]', currentText: 'Desisto',
    verdict: { ...okVerdict, allowed: false, shares_payment_or_contact: true }, repairs: ['De qual pedido você quer desistir?'] });
  assert.doesNotMatch(leaking.text, /Pix/);
});

test('revisor de estilo: profissional não pedido e data em formato técnico também são reescritos', async () => {
  const result = await run({ draft: 'Posso ajudar?', verdict: okVerdict });
  const system = JSON.stringify(result.requests.find(item => JSON.stringify(item.body || {}).includes('Valide a resposta do salão'))?.body?.system_instruction || '');
  assert.match(system, /cita um profissional pelo nome sem a pessoa ter perguntado nem escolhido/);
  assert.match(system, /data em formato técnico/);
});

test('sobrenome do pedido pendente passa mesmo com o revisor reprovando no geral (regressão Gemini real com Flash)', async () => {
  const partial = { id: 'p-joao', status: 'pending_confirmation', title: 'Corte - João Victor', contact_name: 'João Victor', starts_at: '2099-09-29T13:00:00Z',
    created_at: '2026-11-01T10:00:00Z', metadata: { services: ['Corte'] } };
  const result = await run({ appointments: [partial], verdict: { ...okVerdict, allowed: false, evidence_id: '' } });
  assert.equal(result.diagnostics.adapter_outcome, 'creation_allowed', JSON.stringify(result.diagnostics.adapter_trail));
  // Sem a prova literal do nome na fala da pessoa, continua barrado.
  const unproven = await run({ appointments: [partial], evidence: false, verdict: { ...okVerdict, allowed: false } , repairs: ['Qual é o seu nome completo?'] });
  assert.notEqual(unproven.diagnostics.adapter_outcome, 'creation_allowed');
});

test('afirmação de cancelamento sem tag vai para a nova tentativa com a tag, mesmo se o revisor também marcar registro', async () => {
  const claim = 'Retirei o pedido da Ana Julia e o da Louzania continua.';
  const withTag = claim + ' [ACAO: CANCELAR_PEDIDO|pedido=p2|nome=Ana Julia Souza]';
  const verdict = body => ({ ...okVerdict, claims_cancellation: /Retirei/.test(body.draft || ''), claims_registration: /Retirei/.test(body.draft || '') });
  const repairs = parts => (parts.some(p => /CANCELAMENTO OBRIGATÓRIO/.test(p.text || '')) ? withTag : 'De qual pedido você quer desistir?');
  const result = await run({ draft: claim, currentText: 'Desisto do da Ana Julia', verdict, repairs });
  assert.equal(result.diagnostics.adapter_outcome, 'cancel_tag_recovered');
});

test('duas tags numa mudança de horário: a reescrita é orientada a passar a mudança para a equipe', async () => {
  const draft = 'Ok [ACAO: CANCELAR_PEDIDO|pedido=p1|nome=Marta Souza] [ACAO: CRIAR_AGENDAMENTO|nome=Marta Souza|servicos=Corte|data=2099-09-29|hora=15:00|status=pending_confirmation]';
  const result = await run({ draft, currentText: 'na verdade quero às 15', verdict: okVerdict, repairs: ['Um responsável vai ajustar com você por aqui. [HUMANO_SOLICITADO]'] });
  const guidance = result.generations.at(-1).map(p => p.text).join(' ');
  assert.match(guidance, /um responsável vai ajustar com ela por aqui/);
});

test('id do pedido dentro da tag não aciona o auditor de preço (regressão Gemini real: cancelamento virou "manda de novo")', async () => {
  const draft = 'Retirei o pedido da Ana Julia. [ACAO: CANCELAR_PEDIDO|pedido=5a0e84a7-9ce0-4350|nome=Ana Julia Souza]';
  const result = await run({ draft, currentText: 'Desisto do da Ana Julia', verdict: okVerdict, auditFail: 'invalid_json' });
  assert.equal(result.text, draft);
  assert.deepEqual(result.audits, []);
});

test('"retirei" sem tag com reprovação geral do revisor: a nova tentativa com a tag vem antes da reprovação', async () => {
  const claim = 'Retirei o pedido da sua mãe.';
  const withTag = claim + ' [ACAO: CANCELAR_PEDIDO|pedido=p1|nome=Louzania Santos]';
  const verdict = body => ({ ...okVerdict, allowed: !/^Retirei o pedido da sua mãe\.$/.test(body.draft || ''), claims_cancellation: /Retirei/.test(body.draft || '') });
  const repairs = parts => (parts.some(p => /CANCELAMENTO OBRIGATÓRIO/.test(p.text || '')) ? withTag : 'De qual pedido você quer desistir?');
  const result = await run({ draft: claim, currentText: 'Não quero mais marcar pra minha mãe', verdict, repairs });
  assert.equal(result.diagnostics.adapter_outcome, 'cancel_tag_recovered');
});

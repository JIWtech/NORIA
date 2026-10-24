// Regressão do hotfix P1 (continuidade e handoff): funções REAIS do CORE gerado e do EXT, executadas pelo executor de homologação com respostas
// do modelo simuladas. Cobre: handoff anunciado sem execução, pergunta atual antes da coleta pendente, recuperação limitada e rejeição preservada.
// Rodar: node --test scripts/test_genesis_dialogue_recovery.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ex = require('./homolog/genesis_executor.cjs');

const root = path.join(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'n8n/code/whatsapp_conversation_core.generated.js'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, 'homolog/fixtures/genesis_scenarios.json'), 'utf8'));
const body = value => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] });
const contract = (over = {}) => ({ fact_evidence_mode: 'standard', answers: [], requested_fields: [], facts: [], availability_asserted: false, assignment_confirmed: false, photo_sent: false, handoff_announced: false, ...over });

async function engine(names) {
  const hook = /try \{\r?\n\s*const turnResult = await runTurn\(\);/.exec(code);
  return new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', code.replace(hook[0], 'turn = inputJson.noria_preclaimed_turn; return { ' + names.join(',') + ' };\n' + hook[0])).call({ helpers: { httpRequest: async () => ({}) } },
    { tenant_slug: 'wesley_automoveis', tenant_id: 't', remoteJid: '5511@s.whatsapp.net', instance: 'i', noria_preclaimed_turn: { boundary_id: 'b', messages: [], claimed: true, token: 'x' } }, {}, {}, () => ({}));
}

test('uma foto EXT autorizada libera o pedido para o envio sem forjar photo_sent', async () => {
  const core = await engine(['salesValidatePrimaryDialogue', 'salesPhotoActionProofs']);
  const action = { tenant_id: 't', request_ids: ['request_1'] };
  const attachment = { commercial_action: action };
  const product = { id: 'vehicle-1' };
  core.salesPhotoActionProofs.set(attachment, { snapshot: JSON.stringify(attachment), attachment: {
    id: 'request:photo', tenant_id: 't', session_id: 'b', turn_token: 'x', delivery_state: 'authorized_for_dispatch', product: { id: product.id }
  } });
  const generated = { primary_reply: 'A foto está autorizada para envio.', state: {}, primary_facts: [], response_contract: contract() };
  const plan = { requests: [{ id: 'request_1', topic: 'photos', subject: 'specific_product' }], next_requirement: 'none' };
  const result = core.salesValidatePrimaryDialogue(generated, plan, { active: false }, {
    photo_attachment: attachment, product, fact_ledger: [], turn_text: 'Tem foto?', inventory: [], handoff_claim_required: false
  });
  assert.ok(!result.issues.includes('UNANSWERED_REQUEST:request_1'));
  assert.ok(result.issues.includes('SEMANTIC_FACT_AUDIT_REQUIRED'), 'autorização ainda exige a auditoria semântica do texto');
  assert.equal(generated.response_contract.photo_sent, false, 'autorização não é confirmação de envio');
});

test('foto sem autorização não cobre o pedido de mídia', async () => {
  const core = await engine(['salesValidatePrimaryDialogue']);
  const result = core.salesValidatePrimaryDialogue({ primary_reply: 'A foto está autorizada para envio.', state: {}, primary_facts: [], response_contract: contract() },
    { requests: [{ id: 'request_1', topic: 'photos', subject: 'specific_product' }], next_requirement: 'none' }, { active: false },
    { product: { id: 'vehicle-1' }, fact_ledger: [], turn_text: 'Tem foto?', inventory: [], handoff_claim_required: false });
  assert.ok(result.issues.includes('UNANSWERED_REQUEST:request_1'));
});

test('a coleta pendente só é exigida quando o pedido atual é a própria coleta; visita, humano, pagamento etc. são perguntas atuais', async () => {
  const core = await engine(['salesValidatePrimaryDialogue']);
  const collection = { active: true, ready: false, next_field: 'customer_name', missing_fields: ['customer_name'] };
  const issuesFor = topic => core.salesValidatePrimaryDialogue({ primary_reply: 'Pode ir na quinta, estamos aguardando.', state: {}, primary_facts: [], response_contract: contract({ answers: [{ request_id: 'request_1', excerpt: 'Pode ir na quinta' }] }) },
    { requests: [{ id: 'request_1', topic }], next_requirement: 'customer_name', handoff_reason: 'none' }, collection, { handoff_claim_required: true, handoff_dispatched: false }).issues;
  for (const topic of ['visit', 'human', 'payment', 'sale', 'other', 'price', 'location']) assert.ok(!issuesFor(topic).includes('MISSING_COLLECTION_QUESTION:customer_name'), topic + ' é pedido atual e vem antes da coleta');
  for (const topic of ['name', 'documents', 'purchase']) assert.ok(issuesFor(topic).includes('MISSING_COLLECTION_QUESTION:customer_name'), topic + ' é a própria coleta: a pergunta continua exigida');
});

test('anunciar transferência sem execução continua rejeitado; com execução confirmada é aceito', async () => {
  const core = await engine(['salesValidatePrimaryDialogue']);
  const audit = dispatched => core.salesValidatePrimaryDialogue({ primary_reply: 'Vou chamar um atendente.', state: {}, primary_facts: [], response_contract: contract({ handoff_announced: true }) },
    { requests: [], next_requirement: 'none', handoff_reason: 'none' }, { active: false }, { handoff_claim_required: true, handoff_dispatched: dispatched }).issues;
  assert.ok(audit(false).includes('UNEXECUTED_HANDOFF_ANNOUNCEMENT'));
  assert.ok(!audit(true).includes('UNEXECUTED_HANDOFF_ANNOUNCEMENT'));
});

async function run(turnSpec, repairs) {
  const scenario = { name: 'recovery', turns: [{ text: 'Air-bag acionado no painel \nE luz de injeção', gemini: turnSpec }], auditor_responses: repairs };
  const result = await ex.runScenario(scenario, { mode: 'fixtures', geminiKey: null, settings: ex.loadSettings(), inventory: fixtures.inventory });
  const outbound = salesOutbound(result.world);
  return { result, outbound, alert: operatorAlert(result.world), repairCalls: result.world.log.gemini.filter(item => (item.schema_properties || []).includes('reply') && (item.schema_properties || []).includes('response_contract') && !(item.schema_properties || []).includes('semantic_intent')).length };
}
// The turn's own sales event, and the internal operator alert of a turn the AI could not answer safely.
const salesOutbound = world => world.tables.channel_events.filter(row => row.direction === 'outbound' && row.ai_provider !== 'core_error').at(-1);
const operatorAlert = world => world.tables.channel_events.find(row => row.service === 'technical_error' && row.ai_provider === 'core_operator_review') || null;
// Nenhuma mensagem técnica chega ao cliente: o turno fica em silêncio e o operador é alertado.
function assertSilentForOperator(world, alert, issue) {
  assert.equal(world.log.simulated_sends.length, 0, 'nenhuma mensagem ao cliente');
  assert.ok(alert, 'operador alertado');
  assert.equal(alert.delivery_status, 'internal');
  assert.equal(alert.message_text, '');
  assert.equal(alert.handoff, false, 'o alerta não é troca de controle');
  assert.match(alert.ai_error, issue);
  const queue = world.tables.conversation_turn_queue[0];
  assert.equal(queue.phase, 'review', 'turno retido para o operador, sem falha técnica');
  assert.equal(queue.claimed.length, 1, 'a mensagem do cliente fica preservada para o operador');
  assert.equal(world.log.failures.length, 0, 'sem falha de fila');
}
const announced = { reply: 'Vou chamar um atendente para olhar isso.', response_contract: { handoff_announced: true }, semantic_intent: { primary_intent: 'other', topics: ['other'] } };

test('rejeição só comportamental: uma reescrita auditada recupera o atendimento sem anunciar transferência', async () => {
  const repaired = body({ reply: 'Entendi, obrigado por avisar. Posso ajudar com mais alguma informação do veículo?', response_contract: contract({ requested_fields: [{ field: 'x', excerpt: 'Posso ajudar com mais alguma informação do veículo?' }] }) });
  const { outbound, repairCalls } = await run(announced, [repaired]);
  assert.equal(repairCalls, 1, 'exatamente uma reescrita');
  assert.match(outbound.message_text, /Posso ajudar com mais alguma informação/);
  assert.equal(outbound.raw_payload.dialogue_repair?.status, 'accepted', JSON.stringify(outbound.raw_payload.dialogue_repair));
  assert.equal(JSON.stringify(outbound.raw_payload.dialogue_repair.original_issues), JSON.stringify(['UNEXECUTED_HANDOFF_ANNOUNCEMENT']), 'o motivo original fica registrado');
  assert.ok(!outbound.ai_error, 'resposta aceita não carrega erro');
  assert.doesNotMatch(outbound.message_text, /atendente|encaminh|transfer/i);
});

test('a reescrita é auditada pelo mesmo auditor: se repetir o anúncio sem execução, vale o bloqueio e o turno fica em silêncio para o operador', async () => {
  const again = body({ reply: 'Já estou chamando um atendente.', response_contract: contract({ handoff_announced: true }) });
  const { result, outbound, alert, repairCalls } = await run(announced, [again]);
  assert.equal(repairCalls, 1, 'nenhuma segunda tentativa');
  assert.equal(outbound.raw_payload.dialogue_repair.status, 'needs_human_review');
  assert.match(outbound.ai_error, /UNEXECUTED_HANDOFF_ANNOUNCEMENT/);
  assertSilentForOperator(result.world, alert, /UNEXECUTED_HANDOFF_ANNOUNCEMENT/);
});

test('falha da própria reescrita não derruba o turno nem gera mensagem técnica', async () => {
  const { result, outbound, alert } = await run(announced, []);
  assert.equal(outbound.raw_payload.dialogue_repair.status, 'failed');
  assert.match(outbound.ai_error, /UNEXECUTED_HANDOFF_ANNOUNCEMENT/);
  assertSilentForOperator(result.world, alert, /UNEXECUTED_HANDOFF_ANNOUNCEMENT/);
});

test('rejeição factual: uma reescrita auditada pode retirar o valor, mas o preço inventado nunca chega ao cliente', async () => {
  const invented = { reply: 'Essa moto custa R$ 99.999,00.', semantic_intent: { primary_intent: 'other', topics: ['other'] } };
  const repeated = body({ reply: 'Ela sai por R$ 99.999,00.', response_contract: contract() });
  const blocked = await run(invented, [repeated]);
  assert.equal(blocked.repairCalls, 1, 'uma única reescrita');
  assert.match(blocked.outbound.ai_error, /UNSUPPORTED_AMOUNT/);
  assertSilentForOperator(blocked.result.world, blocked.alert, /UNSUPPORTED_AMOUNT/);
  const fixed = await run(invented, [body({ reply: 'Esse valor eu não tenho confirmado agora. Quer saber outro detalhe dela?', response_contract: contract({ requested_fields: [{ field: 'x', excerpt: 'Quer saber outro detalhe dela?' }] }) })]);
  assert.equal(fixed.outbound.raw_payload.dialogue_repair?.status, 'accepted', JSON.stringify(fixed.outbound.raw_payload.dialogue_repair));
  assert.doesNotMatch(fixed.outbound.message_text, /99\.999/);
  assert.equal(fixed.result.world.log.simulated_sends.length, 1);
});

// ---------------------------------------------------------------- fechamento P1: handoff, orçamento e falha segura
const handoffSettings = () => { const settings = JSON.parse(JSON.stringify(ex.loadSettings())); settings.sales.stages = { ...(settings.sales.stages || {}), sales_human: { allow_ai: false, closed: false } }; return settings; };
// the in-memory save RPC does not lock the lead; the published one does for the human stage
const lockHuman = world => ({ ...world.rpcOverrides, magia_sales_save: (w, p) => { const r = ex.RPC.magia_sales_save(w, p); if (p.p_stage === 'sales_human') { w.tables.sales_leads.find(l => l.id === r.id).ai_locked = true; r.ai_locked = true; } return r; } });
const humanRequest = { reply: 'Claro, vou chamar um atendente para você.', response_contract: { handoff_announced: true }, dialogue_plan: { human_requested: true, handoff_reason: 'human_requested' }, semantic_intent: { primary_intent: 'human_handoff', topics: ['human'] } };
async function runWith(turnSpec, responses, { seed, settings } = {}) {
  const scenario = { name: 'closing', turns: [{ text: 'Quero falar com um atendente', gemini: turnSpec }], auditor_responses: responses };
  const result = await ex.runScenario(scenario, { mode: 'fixtures', geminiKey: null, settings: settings || ex.loadSettings(), inventory: fixtures.inventory, seed });
  return { result, world: result.world, outbound: salesOutbound(result.world) };
}

test('handoff autorizado: o CORE executa e persiste (fila humana, lead travado, evento com handoff) sem reescrita nem chamada extra', async () => {
  const { world, outbound } = await runWith(humanRequest, [], { settings: handoffSettings(), seed: w => { w.rpcOverrides = lockHuman(w); } });
  const execution = outbound.raw_payload.handoff_execution;
  assert.equal(execution.executed, true, JSON.stringify(execution));
  assert.equal(execution.operation_evidence, 'dispatch_record_persisted');
  assert.equal(outbound.handoff, true);
  assert.equal(world.tables.sales_leads[0].ai_locked, true);
  assert.equal(world.tables.sales_leads[0].state.human_dispatch.status, 'queued_unassigned');
  assert.equal(outbound.raw_payload.dialogue_repair, undefined);
  assert.equal(world.log.gemini.length, 1, 'uma única chamada ao modelo');
});

test('handoff decidido mas não comprovado: nenhuma reescrita de texto o encobre', async () => {
  const repaired = body({ reply: 'Certo, seguimos por aqui.', response_contract: contract() });
  const { world, outbound } = await run(humanRequest, [repaired]).then(value => ({ world: value.result.world, outbound: value.outbound }));
  assert.equal(outbound.raw_payload.handoff_execution.decided, true);
  assert.equal(outbound.raw_payload.handoff_execution.executed, false);
  assert.equal(outbound.raw_payload.dialogue_repair.attempted, false);
  assert.equal(outbound.raw_payload.dialogue_repair.skipped, 'handoff_decided_not_executed');
  assert.equal(world.log.gemini.length, 1, 'nenhuma chamada de reescrita');
  assert.match(outbound.ai_error, /UNEXECUTED_HANDOFF_ANNOUNCEMENT/);
  assert.doesNotMatch(outbound.message_text, /Certo, seguimos/);
});

test('a reescrita usa o orçamento Gemini do tenant: uma reserva por chamada; sem orçamento nenhuma chamada sai e o turno fica em silêncio para o operador', async () => {
  const repaired = body({ reply: 'Entendi, obrigado por avisar. Posso ajudar com mais alguma informação do veículo?', response_contract: contract() });
  const reserves = [];
  const counted = await run(announced, [repaired]).then(() => null);
  void counted;
  const scenario = { name: 'budget', turns: [{ text: 'Air-bag acionado no painel', gemini: announced }], auditor_responses: [repaired] };
  const withBudget = (allowedCalls) => ex.runScenario(scenario, { mode: 'fixtures', geminiKey: null, settings: ex.loadSettings(), inventory: fixtures.inventory,
    seed: world => { let used = 0; world.rpcOverrides = { magia_gemini_reserve: (w, p) => { reserves.push(p); return used++ < allowedCalls ? { allowed: true } : { allowed: false, reason: 'tenant_daily_limit' }; } }; } });
  const ok = await withBudget(10);
  const gemini = ok.world.log.gemini.length;
  assert.ok(reserves.length >= gemini && reserves.every(r => r.p_tenant_id && Number.isFinite(r.p_daily_limit)), 'toda chamada reserva o orçamento do tenant antes de sair');
  reserves.length = 0;
  const denied = await withBudget(1);
  const out = salesOutbound(denied.world);
  assert.equal(denied.world.log.gemini.length, 1, 'sem orçamento a reescrita não sai');
  assert.equal(out.raw_payload.dialogue_repair.status, 'failed');
  assert.match(out.ai_error, /UNEXECUTED_HANDOFF_ANNOUNCEMENT/);
  assertSilentForOperator(denied.world, operatorAlert(denied.world), /UNEXECUTED_HANDOFF_ANNOUNCEMENT/);
});

test('reescrita rejeitada: bloqueio preservado, sem envio, sem transferência inventada e mensagem retida para o operador', async () => {
  const again = body({ reply: 'Já estou chamando um atendente.', response_contract: contract({ handoff_announced: true }) });
  const { world, outbound, alert } = await run(announced, [again]).then(value => ({ world: value.result.world, outbound: value.outbound, alert: value.alert }));
  assertSilentForOperator(world, alert, /UNEXECUTED_HANDOFF_ANNOUNCEMENT/);
  assert.ok(!outbound.handoff, 'nenhum handoff inventado');
  assert.equal(world.tables.sales_leads[0]?.ai_locked ?? false, false);
});

// Mecânica de recuperação de um veredito semântico SIMULADO. Não chama Gemini real.
async function semanticRecovery({ repeatUnsupported = false, auditUnavailable = false, topic = 'other', reauditUnavailable = false } = {}) {
  const rejected = 'Isso mesmo, ele é recuperado de financiamento.';
  const repaired = 'Essa informação eu não tenho confirmada agora.';
  const responseContract = text => contract({ answers: [{ request_id: 'request_1', excerpt: text }] });
  const scenario = { name: 'semantic-recovery', turns: [{ text: 'É recuperado de financiamento?', gemini: {
    reply: rejected, response_contract: { ...responseContract(rejected), fact_evidence_mode: 'semantic' },
    semantic_intent: { primary_intent: 'other', topics: ['other'] },
    dialogue_plan: { requests: [{ id: 'request_1', topic }] },
  } }], auditor_responses: [] };
  let audits = 0, repairs = 0;
  const result = await ex.runScenario(scenario, {
    mode: 'fixtures', geminiKey: null, settings: ex.loadSettings(), inventory: fixtures.inventory,
    geminiOverride: (request, schema) => {
      if (schema.properties?.segments) {
        audits++;
        if (auditUnavailable || (reauditUnavailable && audits > 1)) throw new Error('SEMANTIC_AUDIT_UNAVAILABLE');
        const data = JSON.parse(request.contents[0].parts[0].text);
        return body({ scope_key: data.scope_key, complete: true, segments: [{ text: data.reply,
          kind: audits === 1 || repeatUnsupported ? 'unsupported' : 'non_factual', evidence: [] }] });
      }
      if (schema.properties?.reply && !schema.properties?.semantic_intent) {
        repairs++;
        return body({ reply: repeatUnsupported ? rejected : repaired,
          response_contract: responseContract(repeatUnsupported ? rejected : repaired) });
      }
      return undefined;
    },
  });
  return { world: result.world, outbound: salesOutbound(result.world), alert: operatorAlert(result.world), audits, repairs, repaired };
}

test('afirmação sem suporte semântico recebe uma única reescrita e nova auditoria antes do envio', async () => {
  const { world, outbound, repairs, audits, repaired } = await semanticRecovery();
  assert.equal(repairs, 1, 'uma única candidata de recuperação');
  assert.equal(audits, 2, 'a resposta nova também passa pelo auditor independente');
  assert.equal(outbound.message_text, repaired);
  assert.equal(outbound.raw_payload.dialogue_repair.status, 'accepted');
  assert.equal(world.log.simulated_sends.length, 1);
});

test('nova afirmação sem prova continua bloqueada após uma única recuperação semântica', async () => {
  const { world, alert, repairs, audits } = await semanticRecovery({ repeatUnsupported: true });
  assert.equal(repairs, 1);
  assert.equal(audits, 2);
  assertSilentForOperator(world, alert, /SEMANTIC_FACT_UNSUPPORTED/);
});

test('auditor indisponível não inicia reescrita nem autoriza envio', async () => {
  const { world, alert, repairs, audits } = await semanticRecovery({ auditUnavailable: true });
  assert.equal(repairs, 0);
  assert.equal(audits, 1);
  assertSilentForOperator(world, alert, /SEMANTIC_FACT_AUDIT_UNAVAILABLE/);
});

test('recuperação semântica aceita apenas falta de suporte; contradição e prova inválida continuam retidas', async () => {
  const { salesIssuesRepairable } = await engine(['salesIssuesRepairable']);
  assert.equal(salesIssuesRepairable(['SEMANTIC_FACT_UNSUPPORTED', 'UNSUPPORTED_SEMANTIC_CLAIM']), true);
  for (const issue of ['SEMANTIC_FACT_CONTRADICTED', 'SEMANTIC_FACT_UNCERTAIN', 'SEMANTIC_FACT_AUDIT_UNAVAILABLE', 'SEMANTIC_SOURCE_MISMATCH', 'INVALID_SEMANTIC_EVIDENCE']) {
    assert.equal(salesIssuesRepairable([issue]), false, issue);
  }
});

test('foto marcada como enviada antes da confirmação recebe a reescrita auditada (produção 24/10 19:44, Onix)', async () => {
  const { salesIssuesRepairable } = await engine(['salesIssuesRepairable']);
  assert.equal(salesIssuesRepairable(['UNCONFIRMED_PHOTO_DELIVERY']), true);
  assert.equal(salesIssuesRepairable(['UNCONFIRMED_PHOTO_DELIVERY', 'SEMANTIC_FACT_CONTRADICTED']), false);
  const src = fs.readFileSync(path.join(root, 'n8n/sources/noria_core.js'), 'utf8');
  const repair = src.slice(src.indexOf('async function salesRepairRejectedDialogue('), src.indexOf('async function salesAuditPrimaryDialogue('));
  assert.match(repair, /UNCONFIRMED_PHOTO_DELIVERY:[^']*photo_sent=false/);
});

test('fato declarado em trecho que o auditor julgou não factual é falta de prova: recebe a mesma reescrita auditada', async () => {
  // Produção 24/10 14:03: "O Nissan Versa SL 2013 é uma ótima escolha." trazia modelo e ano dentro de uma opinião.
  const { salesIssuesRepairable } = await engine(['salesIssuesRepairable']);
  assert.equal(salesIssuesRepairable(['FACT_CLASSIFIED_AS_NON_FACTUAL', 'UNSUPPORTED_SEMANTIC_CLAIM']), true);
  assert.equal(salesIssuesRepairable(['FACT_CLASSIFIED_AS_NON_FACTUAL', 'SEMANTIC_FACT_CONTRADICTED']), false);
  const src = fs.readFileSync(path.join(root, 'n8n/sources/noria_core.js'), 'utf8');
  const repair = src.slice(src.indexOf('async function salesRepairRejectedDialogue('), src.indexOf('async function salesAuditPrimaryDialogue('));
  assert.match(repair, /FACT_CLASSIFIED_AS_NON_FACTUAL/, 'a reescrita recebe orientação para esse caso');
  assert.match(repair, /semanticRejection = issues\.some\([^)]*FACT_CLASSIFIED_AS_NON_FACTUAL/, 'a nova candidata continua em auditoria semântica');
});

test('reescrita não pode trocar semantic por standard para pular a nova auditoria', async () => {
  const { world, repairs, audits, outbound } = await semanticRecovery({ topic: 'price' });
  assert.equal(repairs, 1);
  assert.equal(audits, 2, 'mesmo um contrato standard da reescrita precisa de verificação semântica');
  assert.equal(outbound.raw_payload.dialogue_repair.status, 'accepted');
  assert.equal(world.log.simulated_sends.length, 1);
});

test('falha do auditor da nova candidata mantém o bloqueio sem envio nem nova reescrita', async () => {
  const { world, repairs, audits, alert, outbound } = await semanticRecovery({ topic: 'price', reauditUnavailable: true });
  assert.equal(repairs, 1);
  assert.equal(audits, 2);
  assert.equal(outbound.raw_payload.dialogue_repair.status, 'needs_human_review');
  assertSilentForOperator(world, alert, /SEMANTIC_FACT_UNSUPPORTED/);
});

// Verificações locais da infraestrutura genérica do pipeline de serviços (sem rede, sem Gemini, sem escrita no Supabase).
// Rodar: node --test scripts/test_noria_services_pipeline.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ts = require('../app/node_modules/typescript');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const coreCode = read('n8n/sources/noria_core.js');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// Carrega funções REAIS do CORE (por nome, via AST) em um escopo controlado.
function loadCore(names, globals) {
  const ast = ts.createSourceFile('core.js', coreCode, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const source = ast.statements.filter(ts.isFunctionDeclaration).filter(n => names.includes(n.name.text)).map(n => n.getText(ast)).join('\n');
  const keys = Object.keys(globals);
  return new Function(...keys, source + '\nreturn {' + names.join(',') + '};')(...keys.map(key => globals[key]));
}
const TENANT = '563a93cd-a5c1-4412-a65f-be2e2d41bb88';
const offered = { contract: 'noria_turn_pipeline_v1', capability: 'services_v1', contract_version: '2.0', semantic_contract: 'sem_v1', decision_contract: 'dec_v2',
  decision_provenance: 'prov_v1', semantic_vocabulary: { intents: ['a'], roles: ['b'], topics: ['c'], dispositions: ['d'], ambiguity_kinds: ['e'], confidence: ['f'] } };
const declared = { enabled: true, contract: offered.contract, capability: offered.capability, contract_version: '2.0', semantic_contract: 'sem_v1', decision_contract: 'dec_v2', decision_provenance: 'prov_v1' };
const selector = ({ policy, settings = {}, version = '2.0' }) => {
  const core = loadCore(['settingsFor', 'salesEnabled', 'turnPipelineFor'], { tenantBusinessRules: policy, inputJson: { noria_contract_version: version },
    TURN_PIPELINE_CONTRACT: 'noria_turn_pipeline_v1', TURN_PIPELINE_CAPABILITIES: ['services_v1'],
    TURN_PIPELINE_FIELDS: ['contract', 'capability', 'contract_version', 'semantic_contract', 'decision_contract', 'decision_provenance'] });
  return () => core.turnPipelineFor({ settings: { settings } });
};
const servicesPolicy = { contract: 'noria_policy_v2', profile: 'services_booking_v2', capability: 'standard', modules: { turn_pipeline: offered } };

test('Gênesis, Núbia v1 e tenant legado não selecionam o pipeline de serviços', () => {
  const genesis = { contract: 'noria_policy_v2', profile: 'vehicle_sales_v1', capability: 'sales_v1', modules: {} };
  assert.equal(selector({ policy: genesis, settings: { conversation_capability: 'sales_v1' } })(), null);
  const core = loadCore(['settingsFor', 'salesEnabled'], { tenantBusinessRules: genesis, inputJson: {} });
  assert.equal(core.salesEnabled({ settings: { settings: { conversation_capability: 'sales_v1' } } }), true, 'salesEnabled da Gênesis permanece intacto');
  assert.equal(selector({ policy: { contract: 'noria_policy_v2', profile: 'nb_bronze_v1', capability: 'standard', modules: {} }, version: '1.0' })(), null);
  assert.equal(selector({ policy: {}, settings: {} })(), null);
});

test('Declaração ausente ou desabilitada preserva o legado; habilitada e inconsistente falha sem fallback', () => {
  assert.equal(selector({ policy: servicesPolicy, settings: {} })(), null);
  assert.equal(selector({ policy: servicesPolicy, settings: { noria_turn_pipeline: { ...declared, enabled: false } } })(), null);
  const ok = selector({ policy: servicesPolicy, settings: { noria_turn_pipeline: declared } })();
  assert.equal(ok.capability, 'services_v1');
  assert.deepEqual(ok.semantic_vocabulary.intents, ['a']);
  assert.throws(selector({ policy: servicesPolicy, settings: { noria_turn_pipeline: declared }, version: '1.0' }), /NORIA_TURN_PIPELINE_CONFIG_INVALID/);
  assert.throws(selector({ policy: servicesPolicy, settings: { noria_turn_pipeline: { ...declared, decision_provenance: 'outra' } } }), /NORIA_TURN_PIPELINE_CONFIG_INVALID/);
  assert.throws(selector({ policy: { contract: 'noria_policy_v2', profile: 'nb_bronze_v1', capability: 'standard', modules: {} }, settings: { noria_turn_pipeline: declared } }), /NORIA_TURN_PIPELINE_CONFIG_INVALID/);
  assert.throws(selector({ policy: servicesPolicy, settings: { noria_turn_pipeline: 'ligado' } }), /NORIA_TURN_PIPELINE_CONFIG_INVALID/);
  const sales = { ...servicesPolicy, profile: 'vehicle_sales_v1', capability: 'sales_v1' };
  assert.throws(selector({ policy: sales, settings: { conversation_capability: 'sales_v1', noria_turn_pipeline: declared } }), /NORIA_TURN_PIPELINE_CONFLICT/);
});

test('decisão com identidade, versão ou proveniência incorretas é recusada; recusada/malformada não autoriza nada', () => {
  const identity = { tenant_id: TENANT, tenant_slug: 'clinica_nubia_oficial', instance: 'inst', remote_jid: 'jid', session_id: 'initial', request_id: 'm1:tok', turn_token: 'tok' };
  const decision = { contract: 'dec_v2', provenance: 'prov_v1', noria_contract_version: '2.0', status: 'ok', ...identity,
    actions: { create_reservation: { allowed: true }, check_availability: { allowed: false }, handoff: { required: true } }, follow_up: { action: 'cancel' } };
  const pipeline = { contract_version: '2.0', decision_contract: 'dec_v2', decision_provenance: 'prov_v1' };
  const verify = (input, id = identity) => loadCore(['servicesVerifiedDecision'], { inputJson: input }).servicesVerifiedDecision(pipeline, id);
  assert.equal(verify({ commercial_decision: decision, commercial_decision_status: 'ok' }).status, 'ok');
  for (const [label, patch, error] of [
    ['versão', { noria_contract_version: '1.0' }, /PROVENANCE_INVALID/], ['proveniência', { provenance: 'x' }, /PROVENANCE_INVALID/],
    ['contrato', { contract: 'x' }, /PROVENANCE_INVALID/], ['tenant', { tenant_id: 'outro' }, /IDENTITY_MISMATCH/],
    ['token', { turn_token: 'outro' }, /IDENTITY_MISMATCH/], ['sessão', { session_id: 'outra' }, /IDENTITY_MISMATCH/], ['request', { request_id: 'm9:tok' }, /IDENTITY_MISMATCH/],
  ]) assert.throws(() => verify({ commercial_decision: { ...decision, ...patch }, commercial_decision_status: 'ok' }), error, label);
  assert.throws(() => verify({ commercial_decision: null, commercial_decision_status: 'error', commercial_decision_error: 'X' }), /X/);
  assert.throws(() => verify({ commercial_decision: decision, commercial_decision_status: 'refused' }), /PROVENANCE_INVALID/, 'status do envelope diverge da decisão');
  const authorized = loadCore(['servicesAuthorized'], {}).servicesAuthorized;
  assert.equal(authorized(decision).create_reservation, true);
  const none = authorized({ ...decision, status: 'refused' });
  assert.deepEqual([none.create_reservation, none.check_availability, none.forward_payment_declaration, none.handoff, none.follow_up], [false, false, false, false, 'none']);
  assert.equal(authorized({ ...decision, actions: { create_reservation: { allowed: 'true' } } }).create_reservation, false, 'allowed deve ser booleano estrito');
});

test('auditor: cada afirmação é checada na sua autoridade; horários, datas e valores da prosa precisam ser autorizados', () => {
  const audit = loadCore(['servicesAudit'], { SERVICES_CLAIM_KINDS: ['fact', 'slot', 'reservation', 'payment', 'handoff', 'preparation'] }).servicesAudit;
  const decision = { facts: [{ fact_id: 'f1', value: '10.00' }], services: [{ service_id: 's1' }],
    approved_blocks: [{ key: 'prep', purpose: 'preparation', applies_to_service_ids: ['s1'] }, { key: 'other', purpose: 'preparation', applies_to_service_ids: ['s9'] }] };
  const none = { reservation: { status: 'not_attempted' }, payment_forward: { status: 'not_attempted' }, handoff: { executed: false } };
  const proof = { date: '2031-03-15', available_starts: ['10:00', '11:30'] };
  const blocks = [{ key: 'prep', text: 't' }, { key: 'other', text: 't' }];
  const claim = (kind, extra = {}) => ({ kind, fact_id: '', value: '', date: '', time: '', status: '', block_key: '', ...extra });
  const run = (composition, execution = none, overrides = {}) => audit({ composition: { block_keys: [], claims: [], reply: 'ok', ...composition }, decision, execution, proof, semantic: { slots: { time: '10:00', date: '2031-03-15' } }, blocks, ...overrides });
  assert.equal(run({}).status, 'approved');
  assert.equal(run({ reply: 'Custa R$ 10,00 às 10:00 em 15/03.', claims: [claim('fact', { fact_id: 'f1', value: '10.00' }), claim('slot', { date: '2031-03-15', time: '10:00' })] }).status, 'approved');
  const failures = (composition, execution, overrides) => run(composition, execution, overrides).failures;
  assert.ok(failures({ reply: 'Custa R$ 99,00.' }).includes('AUDIT_AMOUNT_NOT_AUTHORIZED'));
  assert.ok(failures({ reply: 'Temos às 16:00.' }).includes('AUDIT_TIME_NOT_AUTHORIZED'), 'horário inventado');
  assert.ok(failures({ reply: 'Temos às 11h30.' }).length === 0, 'horário oferecido pela prova');
  assert.ok(failures({ reply: 'No dia 20/03.' }).includes('AUDIT_DATE_NOT_AUTHORIZED'));
  assert.ok(failures({ claims: [claim('fact', { fact_id: 'f1', value: '99.00' })] }).includes('AUDIT_FACT_NOT_AUTHORIZED'));
  assert.ok(failures({ claims: [claim('slot', { date: '2031-03-15', time: '16:00' })] }).includes('AUDIT_SLOT_NOT_SUPPORTED'));
  assert.ok(failures({ claims: [claim('reservation', { status: 'completed', date: '2031-03-15', time: '10:00' })] }).includes('AUDIT_RESERVATION_WITHOUT_RECEIPT'), 'reserva sem recibo');
  assert.ok(failures({ claims: [claim('payment', { status: 'confirmed' })] }).includes('AUDIT_PAYMENT_CONFIRMATION_FORBIDDEN'));
  assert.ok(failures({ claims: [claim('payment', { status: 'awaiting_verification' })] }).includes('AUDIT_PAYMENT_WITHOUT_FORWARD'));
  assert.ok(failures({ claims: [claim('handoff', { status: 'announced' })] }).includes('AUDIT_HANDOFF_NOT_EXECUTED'), 'handoff sem execução');
  assert.ok(failures({ block_keys: ['x'] }).includes('AUDIT_BLOCK_NOT_AUTHORIZED'));
  assert.ok(failures({ block_keys: ['other'], claims: [claim('preparation', { block_key: 'other' })] }).includes('AUDIT_PREPARATION_NOT_AUTHORIZED'), 'preparo de outro procedimento');
  assert.equal(run({ block_keys: ['prep'], claims: [claim('preparation', { block_key: 'prep' })] }).status, 'approved');
  const receipt = { reservation: { status: 'created', appointment: { requested_date: '2031-03-15', requested_time: '10:00' } }, payment_forward: { status: 'not_attempted' }, handoff: { executed: false } };
  assert.ok(failures({}, receipt).includes('AUDIT_RECEIPT_NOT_REPORTED'), 'o recibo precisa ser informado');
  assert.equal(run({ claims: [claim('reservation', { status: 'completed', date: '2031-03-15', time: '10:00' })] }, receipt).status, 'approved');
  assert.ok(failures({ claims: [claim('reservation', { status: 'completed', date: '2031-03-15', time: '11:30' })] }, receipt).includes('AUDIT_RESERVATION_WITHOUT_RECEIPT'), 'recibo de outro horário');
});

// ----------------------------------------------------------------- despachante
const dispatchCode = read('n8n/sources/noria_turn_dispatch.js');
const CLAIM = { claimed: true, contract: 'noria_turn_lifecycle_v1', token: '7c1f0a52-3b8e-4d6a-9f21-0a5b6c7d8e9f', boundary_id: 'initial', instance: 'inst', tenant_slug: 'clinica_nubia_oficial',
  messages: [{ event_id: 'm0', text: 'oi' }, { event_id: 'm1', text: 'quero agendar' }] };
async function dispatch({ claim = CLAIM, input = {}, readiness = { ready: true, contract: 'noria_turn_lifecycle_v1' }, pinned = false } = {}) {
  const calls = [];
  const httpRequest = async ({ method, url, body }) => {
    const name = url.split('/rest/v1/')[1]; calls.push({ method, name, body });
    if (name === 'rpc/magia_turn_lifecycle_status') return readiness;
    if (name === 'rpc/magia_claim_turn') return claim;
    if (name === 'rpc/magia_fail_turn') return { finished: true, contract: 'noria_turn_lifecycle_v1' };
    if (name.startsWith('channel_events?')) return pinned ? [{ id: 'pin-existing' }] : [];
    if (name === 'channel_events') return [{ id: 'pin-1' }];
    throw new Error('unexpected request ' + name);
  };
  const event = { tenant_id: TENANT, tenant_slug: 'clinica_nubia_oficial', instance: 'inst', remoteJid: '5500@s.whatsapp.net',
    noria_client_policy: { contract: 'noria_policy_v2', tenant_id: TENANT, tenant_slug: 'clinica_nubia_oficial', modules: { turn_pipeline: { contract: 'noria_turn_pipeline_v1', contract_version: '2.0', capability: 'services_v1' } } }, ...input };
  const out = await new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', dispatchCode).call({ helpers: { httpRequest } }, event,
    { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'k', NORIA_INGRESS_FORWARD_TOKEN_CLINICA_NUBIA_OFICIAL: 't' }, {}, () => ({}));
  return { json: out.json, calls };
}

test('despachante: um único claim, request_id = <último event_id>:<token>, sem envio nem reserva', async () => {
  const { json, calls } = await dispatch();
  assert.equal(calls.filter(c => c.name === 'rpc/magia_claim_turn').length, 1);
  assert.deepEqual(calls.map(c => c.name), ['rpc/magia_turn_lifecycle_status', 'rpc/magia_claim_turn', calls[2].name, 'channel_events']);
  const pin = calls.at(-1).body;
  assert.equal(pin.external_message_id, 'noria_pin_2.0_m1', 'o lote fica fixo na versão que o reivindicou, pela chave do último event_id');
  assert.equal(pin.service, 'noria_pipeline_pin');
  assert.equal(pin.tenant_id, TENANT);
  assert.equal(pin.handoff, false);
  assert.equal(json.noria_business_context.request_id, 'm1:' + CLAIM.token);
  assert.equal(json.noria_business_context.session_id, 'initial');
  assert.equal(json.noria_preclaimed_turn.token, CLAIM.token);
  assert.ok(!calls.some(c => /appointment|reserve|send|follow/i.test(c.name)));
  const again = await dispatch({ pinned: true });
  assert.ok(!again.calls.some(c => c.name === 'channel_events'), 'o marcador já existente não é escrito de novo');
});

test('despachante: turno já reivindicado, política inválida, claim de outro escopo e fila vazia', async () => {
  await assert.rejects(dispatch({ input: { noria_preclaimed_turn: CLAIM } }), /NORIA_TURN_ALREADY_CLAIMED/);
  await assert.rejects(dispatch({ input: { noria_client_policy: {} } }), /NORIA_TURN_DISPATCH_POLICY_INVALID/);
  const wrongInstance = await dispatch({ claim: { ...CLAIM, instance: 'outra' } });
  assert.equal(wrongInstance.json.noria_terminal, true);
  assert.equal(wrongInstance.json.noria_dispatch_error.code, 'TURN_DISPATCH_PREPARATION_FAILED');
  assert.ok(wrongInstance.json.noria_dispatch_error.message.includes('CLAIM_SCOPE_MISMATCH'));
  assert.equal(wrongInstance.calls.filter(c => c.name === 'rpc/magia_claim_turn').length, 1, 'sem segundo claim');
  assert.equal(wrongInstance.calls.filter(c => c.name === 'rpc/magia_fail_turn').length, 1, 'o claim inválido é devolvido pelo contrato da fila');
  const empty = await dispatch({ claim: { claimed: false, reason: 'quiet_window' } });
  assert.equal(empty.json.noria_terminal, true);
  assert.equal(empty.json.reason, 'quiet_window');
  const notReady = await dispatch({ readiness: { ready: false } });
  assert.equal(notReady.calls.filter(c => c.name === 'rpc/magia_claim_turn').length, 0, 'sem pré-voo não há claim');
});

test('o request_id emitido pelo despachante é aceito pela identidade da EXT Núbia v2', async () => {
  const { json } = await dispatch();
  const ext = read('n8n/sources/nubia_extension.js');
  const httpRequest = async ({ url }) => {
    if (url.includes('/tenants?')) return [{ id: TENANT, slug: 'clinica_nubia_oficial', status: 'active' }];
    if (url.includes('/channels?')) return [{ external_id: 'inst', status: 'active' }];
    if (url.includes('/tenant_settings?')) return [{ settings: { whatsapp_processing_mode: 'conversation_core_v1' } }];
    if (url.includes('/tenant_service_catalog?')) return [{ external_id: 's', name: 'S', category: 'c', active: true, price: '1', metadata: {} }];
    if (url.includes('/follow_up_policies?')) return [];
    throw new Error('unexpected ' + url);
  };
  const run = extra => new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', ext).call({ helpers: { httpRequest } },
    { ...json, noria_phase: 'commercial_decision', noria_extension: 'nubia', noria_contract_version: '2.0', turn: json.noria_preclaimed_turn,
      semantic_intent: { contract: 'noria_services_semantic_intent_v1', primary_intent: 'other', secondary_intents: [], evidence_ids: [], confidence: 'high', services: [], info_requests: [], slots: {},
        payment: { declared: false }, human: { requested: false }, conversation: { topic_change: false, requires_clarification: false }, customer_disposition: { value: 'active' }, ambiguities: [] }, ...extra },
    { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'k' }, {}, () => ({}));
  assert.equal((await run({})).json.commercial_decision_status, 'ok');
  assert.equal((await run({ noria_business_context: { ...json.noria_business_context, request_id: 'm0:' + CLAIM.token } })).json.commercial_decision_error, 'COMMERCIAL_TURN_IDENTITY_MISMATCH');
  const boot = await run({ noria_phase: undefined, noria_dispatch_phase: 'bootstrap' });
  assert.equal(boot.json.noria_client_policy.modules.turn_pipeline.contract, 'noria_turn_pipeline_v1');
  assert.equal(boot.json.noria_client_policy.profile, 'services_booking_v2');
  // the prepared (not applied) configuration declares exactly what the EXT offers
  const example = JSON.parse(read('docs/operations/nubia_v2_pipeline_config.example.json')).noria_turn_pipeline, offered = boot.json.noria_client_policy.modules.turn_pipeline;
  for (const field of ['contract', 'capability', 'contract_version', 'semantic_contract', 'decision_contract', 'decision_provenance']) assert.equal(example[field], offered[field], field);
  assert.equal(example.enabled, false, 'o exemplo nasce desligado');
});

// ------------------------------------------------------ preparo, build e conexões
test('preparação não reserva nem altera pagamento; só responde (após commit) em ramos terminais', () => {
  const ast = ts.createSourceFile('core.js', coreCode, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const fn = name => ast.statements.filter(ts.isFunctionDeclaration).find(n => n.name.text === name).getText(ast);
  const prepare = fn('runServicesTurnPrepare'), availability = fn('runServicesAvailability');
  for (const forbidden of ['schedulingReserve', 'servicesMarkPaymentReported', 'guardFutureAppointment', 'supabasePatch', 'cancelPendingFollowUps', 'magia_reserve']) {
    assert.ok(!prepare.includes(forbidden) && !availability.includes(forbidden), forbidden);
  }
  for (const match of prepare.matchAll(/sendChannelMessage\(/g)) {
    assert.ok(prepare.slice(Math.max(0, match.index - 700), match.index).includes('await commit()'), 'todo envio da preparação é terminal e vem depois do commit');
  }
  assert.ok(!availability.includes('sendChannelMessage') && !availability.includes('saveEvent') && !availability.includes('commit()'));
  assert.ok(!availability.includes("claim"), 'availability não reivindica o turno');
  const finalize = fn('runServicesTurnFinalize');
  assert.ok(finalize.indexOf('await commit()') < finalize.indexOf('schedulingReserve('), 'a reserva só ocorre depois do fencing da fila');
  assert.ok(finalize.indexOf('servicesVerifiedDecision(') < finalize.indexOf('await commit()'), 'a decisão é verificada antes de qualquer efeito');
  assert.equal((coreCode.match(/queueRpc\('claim'\)/g) || []).length, 1, 'o CORE mantém um único ponto de claim');
});

test('build: a cadeia da Núbia v2 está fora do CORE; roteador simples; rotas legadas e EXTs publicadas intactas', () => {
  const core = JSON.parse(read('n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json'));
  assert.deepEqual(core.nodes.filter(n => n.name.startsWith('CORE | Serviços | ')).map(n => n.name), [], 'nenhum nó da cadeia de serviços no CORE');
  assert.ok(!JSON.stringify(core).includes('PREENCHER_ID_EXT_NUBIA_V2'));
  const names = new Set(core.nodes.map(n => n.name));
  for (const [from, entry] of Object.entries(core.connections)) {
    assert.ok(names.has(from), 'conexão de nó inexistente: ' + from);
    for (const c of (entry.main || []).flat()) assert.ok(names.has(c.node), from + ' -> nó inexistente ' + c.node);
  }
  const branches = name => core.connections[name].main.map(b => b.map(c => c.node));
  assert.deepEqual(branches('CORE - Resolver extensão do tenant'), [['CORE - É Núbia?']]);
  const router = core.nodes.find(n => n.name === 'CORE - Resolver extensão do tenant').parameters.jsCode;
  assert.equal(router, read('n8n/sources/noria_router_core.js').replace(/\r\n/g, '\n'), 'o roteador do workflow é a fonte canônica');
  assert.ok(!router.includes('noria_turn_pipeline'), 'o roteador ao vivo não lê a declaração do pipeline de serviços');
  const recovery = core.nodes.find(n => n.name === 'Recuperar Fila WhatsApp').parameters.rule.interval[0];
  assert.deepEqual(recovery, { field: 'seconds', secondsInterval: 30 });
  const has = (from, to, branch) => (core.connections[from]?.main?.[branch] || []).some(c => c.node === to);
  assert.ok(has('CORE | Preparar dispatch Genesis', 'CORE | Turno terminal Genesis?', 0));
  assert.ok(has('CORE | Turno terminal Genesis?', 'CORE | Executar EXT Genesis por turno', 1));
  assert.ok(has('CORE | Executar EXT Genesis por turno', 'CORE | Preparar resposta | Fase', 0));
  assert.ok(has('CORE | Preparar resposta | Fase', 'CORE | Preparar resposta', 0));
  assert.ok(has('CORE | Executar EXT Genesis comercial', 'CORE | Finalizar resposta | Fase', 0));
  assert.ok(has('CORE | Finalizar resposta | Fase', 'CORE | Finalizar resposta', 0));
  // Núbia v1 segue pela sua EXT (nunca pelo pipeline de outro tenant nem como evento ignorado); Royal fica fora até ser publicada.
  assert.ok(has('CORE - É Núbia?', 'CORE | Executar EXT Núbia', 0));
  assert.ok(!core.nodes.some(n => n.name === 'Executar EXT Nubia (PREENCHER ID)'));
  assert.ok(has('Recuperar Fila WhatsApp', 'Ler Fila WhatsApp', 0));
  const diff = execFileSync('git', ['diff', '--stat', '--', 'n8n/workflows/NORIA EXT _ NB Bronze _ Política de negócio v2.json'], { cwd: root }).toString().trim();
  assert.equal(diff, '', 'EXT Núbia v1 não foi alterada');
  const manifest = JSON.parse(read('n8n/build_manifest.json'));
  const sha = text => require('node:crypto').createHash('sha256').update(text).digest('hex');
  assert.equal(manifest.services_pipeline, undefined);
  assert.equal(manifest.router_sha256, sha(read('n8n/sources/noria_router_core.js').replace(/\r\n/g, '\n')));
  const ext = JSON.parse(read('n8n/workflows/NORIA EXT _ NB Bronze _ Serviços v2.json'));
  assert.equal(ext.active, false);
  assert.equal(ext.nodes.find(n => n.name === 'EXT | Serviços Núbia v2').parameters.jsCode, read('n8n/sources/nubia_extension.js'));
});

test('auditoria semântica: cada afirmação precisa de uma autoridade existente e do tipo permitido; sem cobertura ou sem fonte, rejeita', () => {
  const verify = loadCore(['servicesVerifySemanticReport'], {
    SERVICES_ASSERTION_CATEGORIES: ['price', 'service', 'schedule', 'availability', 'reservation', 'payment', 'handoff', 'preparation', 'conditions', 'health_safety', 'result_promise', 'conversational'],
    SERVICES_SUPPORT_KINDS: ['fact', 'block', 'availability', 'reservation_receipt', 'payment_forward', 'handoff_execution', 'customer_provided', 'none'],
    SERVICES_SUPPORT_RULES: (() => { const kinds = ['fact', 'block', 'availability', 'reservation_receipt', 'payment_forward', 'handoff_execution', 'customer_provided', 'none'];
      return { price: ['fact', 'block'], service: ['fact', 'block', 'customer_provided'], schedule: ['fact', 'block', 'availability'], availability: ['availability'], reservation: ['reservation_receipt'],
        payment: ['payment_forward', 'fact', 'block'], handoff: ['handoff_execution'], preparation: ['block', 'fact'], conditions: ['fact', 'block'], health_safety: ['fact', 'block'], result_promise: ['fact', 'block'], conversational: kinds }; })(),
  }).servicesVerifySemanticReport;
  const base = { decision: { facts: [{ fact_id: 'f1', value: '10.00' }], approved_blocks: [{ key: 'b1' }] }, execution: { reservation: { status: 'not_attempted' }, payment_forward: { status: 'not_attempted' }, handoff: { executed: false } },
    proof: { available_starts: ['10:00'] }, semantic: { slots: { customer_name: 'Maria' } }, blocks: [{ key: 'b1', text: 'O preparo exige pele limpa e sem hidratante. Custa R$ 10,00.' }] };
  const report = (assertions, covers = true) => verify({ assertions, covers_entire_reply: covers }, base);
  const item = (category, support, reference = '', quote = '', text = 't') => ({ text, category, support, reference, quote });
  assert.equal(report([item('price', 'fact', 'f1', '10.00'), item('conversational', 'none'), item('availability', 'availability', '10:00'), item('service', 'customer_provided', 'customer_name')]).status, 'approved');
  // existence is not support: the quote must be literal and the asserted figures must be the authority's
  assert.ok(report([item('price', 'fact', 'f1', '99.00')]).failures.includes('AUDIT_QUOTE_MISMATCH:fact'), 'fato existe mas o valor citado não é o dele');
  assert.ok(report([item('preparation', 'block', 'b1', 'basta chegar de biquíni')]).failures.includes('AUDIT_QUOTE_MISMATCH:block'), 'trecho que não está no bloco');
  assert.ok(report([item('preparation', 'block', 'b1', 'pele limpa e sem hidratante')]).status === 'approved', 'trecho literal do bloco');
  assert.ok(report([item('price', 'fact', 'f1', '10.00', 'custa R$ 12,00')]).failures.includes('AUDIT_ASSERTED_AMOUNT_NOT_IN_AUTHORITY'), 'valor da afirmação fora da autoridade');
  assert.ok(report([item('availability', 'availability', '10:00', '', 'tem às 16:00')]).failures.includes('AUDIT_ASSERTED_TIME_NOT_IN_AUTHORITY'), 'horário da afirmação fora da prova');
  assert.ok(report([item('health_safety', 'none')]).failures.includes('AUDIT_UNSUPPORTED_ASSERTION:health_safety'), 'segurança sem fonte');
  assert.ok(report([item('result_promise', 'customer_provided', 'customer_name')]).failures.includes('AUDIT_UNSUPPORTED_ASSERTION:result_promise'), 'o cliente não sustenta promessa');
  assert.ok(report([item('price', 'fact', 'f9')]).failures.includes('AUDIT_SUPPORT_NOT_FOUND:price:fact'), 'fato inexistente');
  assert.ok(report([item('availability', 'availability', '16:00')]).failures.includes('AUDIT_SUPPORT_NOT_FOUND:availability:availability'), 'horário fora da prova');
  assert.ok(report([item('reservation', 'reservation_receipt')]).failures.includes('AUDIT_SUPPORT_NOT_FOUND:reservation:reservation_receipt'), 'reserva sem recibo');
  assert.ok(report([item('handoff', 'handoff_execution')]).failures.includes('AUDIT_SUPPORT_NOT_FOUND:handoff:handoff_execution'), 'handoff sem execução');
  assert.ok(report([item('preparation', 'block', 'b9')]).failures.includes('AUDIT_SUPPORT_NOT_FOUND:preparation:block'), 'preparo sem bloco autorizado');
  assert.ok(report([item('conversational', 'none')], false).failures.includes('AUDIT_COVERAGE_NOT_CONFIRMED'));
  assert.deepEqual(verify({ assertions: 'x' }, base).failures, ['AUDIT_REPORT_INVALID']);
});

// ------------------------------------------------------------------ roteador por configuração
const routerCode = read('n8n/sources/noria_router.js');
const NUBIA = { tenant_slug: 'clinica_nubia_oficial', tenant_id: TENANT, instance: 'inst', remoteJid: '5524999990001@s.whatsapp.net' };
const validDeclaration = { enabled: true, contract: 'noria_turn_pipeline_v1', capability: 'services_v1', contract_version: '2.0', rollout: 'pilot', pilot: { allowed_contacts: ['+55 (24) 99999-0001'] } };
async function route({ input = NUBIA, declared, claimed = [], pins = [], failSettings = false, settingsExtra = {} } = {}) {
  const calls = [];
  const httpRequest = async ({ url }) => {
    const endpoint = url.split('/rest/v1/')[1]; calls.push(endpoint);
    if (failSettings && endpoint.startsWith('tenant_settings')) throw new Error('db');
    if (endpoint.startsWith('tenant_settings')) return [{ settings: { ...settingsExtra, ...(declared === undefined ? {} : { noria_turn_pipeline: declared }) } }];
    if (endpoint.startsWith('conversation_turn_queue')) return claimed.length ? [{ claimed }] : [];
    // pins are scoped by tenant: a marker of another tenant is invisible
    if (endpoint.startsWith('channel_events')) return endpoint.includes('tenant_id=eq.' + TENANT) ? pins.filter(pin => endpoint.includes(encodeURIComponent(pin))).map(pin => ({ external_message_id: pin })) : [];
    throw new Error('unexpected ' + endpoint);
  };
  const out = await new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', routerCode).call({ helpers: { httpRequest } }, input, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'k' }, {}, () => ({}));
  return { json: out.json, calls };
}
const version = r => r.json.noria_pipeline === 'services_v1' ? '2.0' : r.json.noria_contract_version;

test('roteador: Gênesis e demais caminhos legados idênticos; Núbia só vai ao 2.0 por declaração válida, habilitada e no escopo', async () => {
  const genesis = await route({ input: { ...NUBIA, tenant_slug: 'wesley_automoveis' }, declared: validDeclaration });
  assert.equal(genesis.json.noria_contract_version, '2.0');
  assert.equal(genesis.json.noria_extension, 'genesis');
  assert.equal(genesis.json.noria_pipeline, undefined);
  assert.deepEqual(genesis.calls, [], 'a Gênesis não lê configuração do pipeline');
  const dynamic = await route({ input: { ...NUBIA, tenant_slug: 'novo_tenant' }, settingsExtra: { noria_client_policy: { profile: 'p' } }, declared: validDeclaration });
  assert.equal(dynamic.json.noria_extension, 'saas_dynamic');
  assert.equal(dynamic.json.noria_pipeline, undefined, 'tenant SaaS dinâmico não participa do pipeline de serviços');
  for (const [label, declared] of [['sem declaração', undefined], ['desabilitada', { ...validDeclaration, enabled: false }]]) {
    const r = await route({ declared });
    assert.equal(version(r), '1.0', label);
    assert.equal(r.json.noria_extension, 'nubia', label);
    assert.equal(r.json.noria_router, 'core_3wf_v1', label);
    assert.equal(r.json.noria_dispatch_phase, 'bootstrap', label);
  }
  const pilot = await route({ declared: validDeclaration });
  assert.equal(version(pilot), '2.0');
  assert.equal(pilot.json.noria_router, 'services_v2');
  assert.equal(pilot.json.noria_dispatch_phase, 'bootstrap');
  assert.equal(version(await route({ input: { ...NUBIA, remoteJid: '5524988880002@s.whatsapp.net' }, declared: validDeclaration })), '1.0', 'contato fora do piloto segue no 1.0');
  assert.equal(version(await route({ declared: { ...validDeclaration, rollout: 'all', pilot: undefined }, input: { ...NUBIA, remoteJid: '5524988880002@s.whatsapp.net' } })), '2.0', 'rollout explícito para todos');
  assert.ok(pilot.calls.every(c => c.includes('tenant_id=eq.' + TENANT)), 'toda leitura é filtrada pelo tenant');
});

test('roteador: declaração habilitada e inválida ou configuração indisponível falham fechado, sem fallback entre versões', async () => {
  for (const declared of [{ ...validDeclaration, rollout: undefined }, { ...validDeclaration, rollout: 'pilot', pilot: { allowed_contacts: [] } }, { ...validDeclaration, capability: 'outra' },
    { ...validDeclaration, contract_version: '3.0' }, { ...validDeclaration, contract: 'x' }, 'ligado']) {
    await assert.rejects(route({ declared }), /NORIA_ROTEAMENTO_PIPELINE_CONFIG_INVALIDA/);
  }
  await assert.rejects(route({ declared: validDeclaration, failSettings: true }), /NORIA_ROTEAMENTO_PIPELINE_INDISPONIVEL/);
});

test('roteador: um lote em andamento fica na versão que o reivindicou (reversão de configuração não o muda)', async () => {
  const claimed = [{ id: 'ext-1', event_id: 'ev-1' }, { id: 'ext-2', event_id: 'ev-2' }];
  const inFlightV2 = await route({ declared: { ...validDeclaration, enabled: false }, claimed, pins: ['noria_pin_2.0_ev-2'] });
  assert.equal(version(inFlightV2), '2.0', 'lote fixado no 2.0 continua no 2.0 mesmo após a reversão');
  assert.equal(inFlightV2.json.noria_router, 'services_v2_pinned');
  const inFlightV1 = await route({ declared: validDeclaration, claimed });
  assert.equal(version(inFlightV1), '1.0', 'lote do 1.0 em andamento não é tomado pelo 2.0 com a configuração ligada');
  const otherTenantPin = await route({ declared: validDeclaration, claimed, pins: ['noria_pin_2.0_ev-2'], input: { ...NUBIA, tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } });
  assert.equal(version(otherTenantPin), '1.0', 'marcador de outro tenant não vale');
});

test('guardas do CORE: o legado recusa lote fixado no pipeline; turno despachado nunca cai no legado', async () => {
  const guard = loadCore(['servicesPinFound'], { turn: { messages: [{ event_id: 'ev-1' }, { event_id: 'ev-2' }] }, chatId: 'jid', encodeFilter: encodeURIComponent,
    supabaseGet: async url => (url.includes('noria_pin_2.0_ev-2') && url.includes('tenant_id=eq.t1') ? [{ id: 'x' }] : []) });
  assert.equal(await guard.servicesPinFound({ tenant: { id: 't1' } }, '2.0'), true);
  assert.equal(await guard.servicesPinFound({ tenant: { id: 't2' } }, '2.0'), false, 'isolado por tenant');
  assert.match(coreCode, /provenance === 'noria_turn_dispatch_v1'\) throw new Error\('NORIA_TURN_PIPELINE_DISABLED_FOR_PINNED_TURN'\)/);
  assert.match(coreCode, /throw new Error\('NORIA_TURN_PINNED_TO_OTHER_PIPELINE'\)/);
});

// ------------------------------------------------------------------ publicação
test('publicação: o CORE atual não carrega a cadeia da Núbia v2, então o publicador recusa gerar o artefato', () => {
  // A cadeia saiu do CORE (bcbabe3). Publicar a v2 exige reconstruir a cadeia no build; até lá o publicador falha fechado.
  const { buildArtifact } = require(path.join(root, 'scripts/publish_nubia_v2.cjs'));
  const core = JSON.parse(read('n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json'));
  assert.throws(() => buildArtifact(core, 'EXT-V2-REAL-ID'), /CHAIN_INCOMPLETE: 0/);
});

test('piloto: só um JID de telefone do ingresso autenticado casa; LID, grupo e configuração com número inválido não', async () => {
  for (const jid of ['5524999990001@lid', '5524999990001@g.us', '5524999990001', '5524999990001@s.whatsapp.net.evil', '1203630000@g.us']) {
    assert.equal(version(await route({ declared: validDeclaration, input: { ...NUBIA, remoteJid: jid } })), '1.0', jid);
  }
  assert.equal(version(await route({ declared: validDeclaration, input: { ...NUBIA, remoteJid: '5524999990001:12@s.whatsapp.net' } })), '2.0', 'JID com sufixo de dispositivo do mesmo número');
  for (const bad of [['<NUMERO_INTERNO_AUTORIZADO_EM_DIGITOS>'], ['123'], ['55249999900011111111']]) {
    await assert.rejects(route({ declared: { ...validDeclaration, pilot: { allowed_contacts: bad } } }), /NORIA_ROTEAMENTO_PIPELINE_CONFIG_INVALIDA/);
  }
});

test('lote fixado: desligar a declaração não tira o turno em andamento do pipeline; só novos lotes mudam', () => {
  const pipelineFor = (declared, dispatched) => loadCore(['settingsFor', 'salesEnabled', 'turnPipelineFor'], {
    tenantBusinessRules: servicesPolicy, TURN_PIPELINE_CONTRACT: 'noria_turn_pipeline_v1', TURN_PIPELINE_CAPABILITIES: ['services_v1'],
    TURN_PIPELINE_FIELDS: ['contract', 'capability', 'contract_version', 'semantic_contract', 'decision_contract', 'decision_provenance'],
    inputJson: { noria_contract_version: '2.0', ...(dispatched ? { noria_business_context: { provenance: 'noria_turn_dispatch_v1' } } : {}) },
  }).turnPipelineFor({ settings: { settings: declared === undefined ? {} : { noria_turn_pipeline: declared } } });
  for (const off of [undefined, { ...declared, enabled: false }]) {
    assert.equal(pipelineFor(off, false), null, 'novo lote: legado');
    assert.equal(pipelineFor(off, true).capability, 'services_v1', 'lote já despachado: continua no pipeline');
  }
  assert.throws(() => pipelineFor({ ...declared, decision_provenance: 'outra' }, true), /NORIA_TURN_PIPELINE_CONFIG_INVALID/, 'declaração ligada e divergente continua falhando fechado');
});

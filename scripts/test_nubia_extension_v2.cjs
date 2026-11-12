// Verificações mínimas e locais (sem rede) da EXT Núbia v2. Executa a fonte real via AsyncFunction,
// com um httpRequest falso. Rodar: node --test scripts/test_nubia_extension_v2.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const code = fs.readFileSync(path.join(__dirname, '../n8n/sources/nubia_extension.js'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const TENANT = '563a93cd-a5c1-4412-a65f-be2e2d41bb88';
const TOKEN = '7c1f0a52-3b8e-4d6a-9f21-0a5b6c7d8e9f';

// Dados de teste sintéticos (a fonte da EXT não contém nenhum deles).
const baseSettings = () => ({
  whatsapp_processing_mode: 'conversation_core_v1', attendance_lifecycle: 'session_v2',
  payment_signal_enabled: true, appointment_payment_trigger: 'SINAL PAGO', payment: { deposit_percentage: 50 },
  appointment_scheduling: { enabled: true, duration_minutes: 90, units: { u1: { name: 'Unidade', capacities: { r_a: 2 } } }, service_resources: { svc_a: 'r_a', svc_b: 'r_zero' } },
  business_facts: { service_guidance: {
    g_human: { services: ['svc_sun'], booking: 'human', before_message: 'blk_prep' },
    g_ai: { services: ['svc_a'], before_message: 'blk_prep' } } },
  approved_messages: { enabled: true, revision: 'rev-x', catalog_prices: { svc_a: 10, svc_b: 20 },
    blocks: { blk_a: { text: 'Servico A - R$ 10,00', service_ids: ['svc_a'] }, blk_prep: { text: 'Preparo geral', service_ids: [] },
      blk_bad: { text: 'Servico B - R$ 99,00', service_ids: ['svc_b'] } } },
});
const catalog = () => [
  { external_id: 'svc_a', name: 'A', category: 'c', active: true, price: '10', metadata: {} },
  { external_id: 'svc_b', name: 'B', category: 'c', active: true, price: '20', metadata: {} },
  { external_id: 'svc_sun', name: 'S', category: 'c', active: true, price: '30', metadata: {} },
  { external_id: 'svc_off', name: 'O', category: 'c', active: false, price: '40', metadata: {} },
];
async function run({ settings = baseSettings(), semantic, extra = {}, tenantSlug = 'clinica_nubia_oficial' } = {}) {
  const httpRequest = async ({ url }) => {
    if (url.includes('/tenants?')) return [{ id: TENANT, slug: 'clinica_nubia_oficial', status: 'active' }];
    if (url.includes('/channels?')) return [{ external_id: 'inst', status: 'active' }];
    if (url.includes('/tenant_settings?')) return [{ settings }];
    if (url.includes('/tenant_service_catalog?')) return catalog();
    if (url.includes('/follow_up_policies?')) return [{ enabled: true, steps: [{ key: 's1' }] }];
    throw new Error('unexpected request ' + url);
  };
  const input = { noria_phase: 'commercial_decision', noria_extension: 'nubia', noria_contract_version: '2.0', tenant_id: TENANT, tenant_slug: tenantSlug,
    instance: 'inst', remoteJid: '5500@s.whatsapp.net', turn: { claimed: true, contract: 'noria_turn_lifecycle_v1', tenant_slug: 'clinica_nubia_oficial', instance: 'inst', token: TOKEN, boundary_id: 'initial', messages: [{ event_id: 'm1', text: 'Maria Silva no turno atual' }] },
    noria_business_context: { session_id: 'initial', request_id: 'm1:' + TOKEN },
    semantic_intent: semantic ? { contract: 'noria_services_semantic_intent_v1', confidence: 'high', evidence_ids: ['m1'], secondary_intents: [], services: [], info_requests: [], slots: {},
      payment: { declared: false }, human: { requested: false }, conversation: { topic_change: false, requires_clarification: false }, customer_disposition: { value: 'active' }, ambiguities: [], ...semantic } : undefined,
    ...extra };
  const out = await new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', code).call({ helpers: { httpRequest } }, input,
    { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'k' }, {}, () => ({}));
  return out.json;
}
const ref = (service_id, role) => ({ service_id, role, evidence_ids: ['m1'] });
const slots = { unit_id: 'u1', date: '2030-01-15', time: '10:00', customer_name: 'Maria Silva', evidence_ids: ['m1'], name_evidence_ids: ['m1'] };
const availability = { source: 'magia_appointment_availability', tenant_id: TENANT, remote_jid: '5500@s.whatsapp.net', session_id: 'initial', request_id: 'm1:' + TOKEN, turn_token: TOKEN,
  unit_id: 'u1', service_id: 'svc_a', date: '2030-01-15', time: '10:00', available_starts: ['10:00'] };
const bookingProof = { contract: 'current_booking_authorization_v1', identity: { tenant_id: TENANT, instance: 'inst', remote_jid: '5500@s.whatsapp.net', session_id: 'initial', request_id: 'm1:' + TOKEN, turn_token: TOKEN }, proposal: { service_id: 'svc_a', unit_id: 'u1', date: slots.date, time: slots.time, customer_name: slots.customer_name }, status: 'accepted', evidence_ids: ['m1'] };

test('consulta informativa não gera disponibilidade nem reserva e aponta bloco aprovado', async () => {
  const d = (await run({ semantic: { primary_intent: 'info_inquiry', services: [ref('svc_a', 'asked_about')], info_requests: [{ topic: 'presentation', service_ids: ['svc_a'], evidence_ids: ['m1'] }] } })).commercial_decision;
  assert.equal(d.status, 'ok');
  assert.equal(d.actions.create_reservation.allowed, false);
  assert.equal(d.actions.check_availability.allowed, false);
  assert.deepEqual(d.actions.present_information.block_keys, ['blk_a']);
  assert.ok(d.facts.some(f => f.fact_id === 'service.svc_a.price' && f.value === '10.00'));
});

test('seleção de serviço não reserva; reserva exige intenção, disponibilidade da RPC e nome', async () => {
  let d = (await run({ semantic: { primary_intent: 'info_inquiry', services: [ref('svc_a', 'selected')] } })).commercial_decision;
  assert.equal(d.actions.create_reservation.allowed, false);
  assert.equal(d.actions.check_availability.allowed, false);
  const booking = { primary_intent: 'booking_intent', services: [ref('svc_a', 'booking_target')], slots };
  d = (await run({ semantic: booking })).commercial_decision;
  assert.equal(d.actions.check_availability.allowed, true);
  assert.equal(d.actions.create_reservation.allowed, false);
  assert.equal(d.actions.create_reservation.reason, 'AVAILABILITY_NOT_VERIFIED');
  d = (await run({ semantic: booking, extra: { availability, booking_authorization: { contract: 'current_booking_authorization_v1', identity: { tenant_id: TENANT, instance: 'inst', remote_jid: '5500@s.whatsapp.net', session_id: 'initial', request_id: 'm1:' + TOKEN, turn_token: TOKEN }, proposal: { service_id: 'svc_a', unit_id: 'u1', date: slots.date, time: slots.time, customer_name: slots.customer_name }, status: 'accepted', evidence_ids: ['m1'] } } })).commercial_decision;
  assert.equal(d.actions.create_reservation.allowed, true);
  assert.equal(d.actions.create_reservation.params.operation, 'magia_reserve_session_appointment');
  d = (await run({ semantic: booking, extra: { availability: { ...availability, turn_token: 'outro' } } })).commercial_decision;
  assert.equal(d.actions.create_reservation.allowed, false);
});

test('serviço ambíguo ou desconhecido não é resolvido arbitrariamente', async () => {
  let d = (await run({ semantic: { primary_intent: 'ambiguous', services: [ref('svc_a', 'mentioned')], ambiguities: [{ kind: 'service', candidate_service_ids: ['svc_a', 'svc_b'] }], conversation: { topic_change: false, requires_clarification: true } } })).commercial_decision;
  assert.equal(d.actions.check_availability.allowed, false);
  assert.ok(d.reason_codes.includes('CLARIFICATION_REQUIRED'));
  d = (await run({ semantic: { primary_intent: 'booking_intent', services: [ref('svc_inexistente', 'booking_target')], slots } })).commercial_decision;
  assert.equal(d.status, 'refused');
  assert.ok(d.reason_codes.includes('UNKNOWN_SERVICE_ID'));
  d = (await run({ semantic: { primary_intent: 'booking_intent', services: [ref('svc_a', 'selected'), ref('svc_b', 'selected')], slots } })).commercial_decision;
  assert.equal(d.actions.check_availability.allowed, false);
  assert.deepEqual(d.actions.check_availability.missing, ['service_choice']);
});

test('serviço sem recurso de agenda ou com atendimento humano não autoriza reserva automática', async () => {
  for (const id of ['svc_b', 'svc_sun']) {
    const d = (await run({ semantic: { primary_intent: 'booking_intent', services: [ref(id, 'booking_target')], slots }, extra: { availability: { ...availability, service_id: id } } })).commercial_decision;
    assert.equal(d.actions.create_reservation.allowed, false, id);
    assert.equal(d.actions.check_availability.allowed, false, id);
    assert.equal(d.actions.handoff.required, true, id);
  }
});

test('pagamento relatado só encaminha a declaração; nunca confirma e nunca escolhe entre reservas', async () => {
  const payment = { primary_intent: 'payment_report', payment: { declared: true, evidence_ids: ['m1'] } };
  let d = (await run({ semantic: payment, extra: { reservations: [{ id: 'a1', status: 'pending_payment' }] } })).commercial_decision;
  assert.equal(d.actions.forward_payment_declaration.allowed, true);
  assert.equal(d.actions.forward_payment_declaration.resulting_state, 'awaiting_verification');
  assert.equal(d.actions.confirm_payment.allowed, false);
  d = (await run({ semantic: payment, extra: { reservations: [{ id: 'a1', status: 'pending_payment' }, { id: 'a2', status: 'pending_payment' }] } })).commercial_decision;
  assert.equal(d.actions.forward_payment_declaration.allowed, false);
  assert.equal(d.actions.forward_payment_declaration.reason, 'AMBIGUOUS_PENDING_RESERVATIONS');
  assert.equal(d.actions.confirm_payment.allowed, false);
});

test('tenant, versão, identidade do turno ou evidência inválidos resultam em recusa', async () => {
  assert.equal((await run({ semantic: { primary_intent: 'other' }, tenantSlug: 'wesley_automoveis' })).commercial_decision_status, 'error');
  assert.equal((await run({ semantic: { primary_intent: 'other' }, extra: { noria_contract_version: '1.0' } })).commercial_decision_error, 'COMMERCIAL_CONTRACT_VERSION_MISMATCH');
  assert.equal((await run({ semantic: { primary_intent: 'other' }, extra: { noria_business_context: { session_id: 'initial', request_id: 'req:' + TOKEN } } })).commercial_decision_error, 'COMMERCIAL_TURN_IDENTITY_MISMATCH');
  const forged = (await run({ semantic: { primary_intent: 'booking_intent', evidence_ids: ['inexistente'], services: [ref('svc_a', 'booking_target')], slots } })).commercial_decision;
  assert.equal(forged.status, 'refused');
  assert.equal(forged.actions.check_availability.allowed, false);
  const old = (await run({ semantic: { primary_intent: 'booking_intent', services: [ref('svc_a', 'booking_target')], slots }, extra: { session_evidence: [{ id: 'h1', text: 'antigo', direction: 'inbound', sender_type: 'contact', session_id: 'initial' }] } })).commercial_decision;
  assert.equal(old.status, 'ok');
  const historyOnly = (await run({ semantic: { primary_intent: 'booking_intent', evidence_ids: ['h1'], services: [{ service_id: 'svc_a', role: 'booking_target', evidence_ids: ['h1'], session_id: 'initial' }], slots: { ...slots, evidence_ids: ['h1'], customer_name: '', name_evidence_ids: [] } }, extra: { session_evidence: [{ id: 'h1', text: 'antigo', direction: 'inbound', sender_type: 'contact', session_id: 'initial' }] } })).commercial_decision;
  assert.equal(historyOnly.status, 'refused');
  assert.equal(await run({ semantic: undefined }).then(r => r.commercial_decision.status), 'refused');
});

test('falta de configuração não autoriza ação comercial', async () => {
  const noSched = baseSettings(); delete noSched.appointment_scheduling;
  let d = (await run({ settings: noSched, semantic: { primary_intent: 'booking_intent', services: [ref('svc_a', 'booking_target')], slots } })).commercial_decision;
  assert.equal(d.actions.check_availability.allowed, false);
  assert.equal(d.actions.create_reservation.allowed, false);
  const noPay = baseSettings(); delete noPay.payment_signal_enabled; delete noPay.appointment_payment_trigger;
  d = (await run({ settings: noPay, semantic: { primary_intent: 'payment_report', payment: { declared: true, evidence_ids: ['m1'] } }, extra: { reservations: [{ id: 'a1', status: 'pending_payment' }] } })).commercial_decision;
  assert.equal(d.actions.forward_payment_declaration.allowed, false);
  const noMsg = baseSettings(); delete noMsg.approved_messages;
  d = (await run({ settings: noMsg, semantic: { primary_intent: 'info_inquiry', services: [ref('svc_a', 'asked_about')], info_requests: [{ topic: 'presentation', service_ids: ['svc_a'], evidence_ids: ['m1'] }] } })).commercial_decision;
  assert.deepEqual(d.approved_blocks, []);
  d = (await run({ semantic: { primary_intent: 'info_inquiry', customer_disposition: { value: 'declined', evidence_ids: ['m1'] } } })).commercial_decision;
  assert.equal(d.follow_up.action, 'none');
  assert.equal(d.follow_up.reason, 'DISPOSITION_ACTION_NOT_CONFIGURED');
});

const turnOf = over => ({ claimed: true, contract: 'noria_turn_lifecycle_v1', tenant_slug: 'clinica_nubia_oficial', instance: 'inst', token: TOKEN, boundary_id: 'initial', messages: [{ event_id: 'm1', text: 'x' }], ...over });

test('nome: vale se provado em mensagem do cliente da mesma sessão; recusado se inferido, de outra sessão ou do assistente', async () => {
  const booking = { primary_intent: 'booking_intent', services: [ref('svc_a', 'booking_target')], slots: { ...slots, name_evidence_ids: ['h1'], session_id: 'initial' } };
  const turnWithoutName = turnOf({ messages: [{ event_id: 'm1', text: 'quero agendar amanha' }] });
  const hist = (over = {}) => [{ id: 'h1', text: 'meu nome e Maria Silva', direction: 'inbound', sender_type: 'contact', session_id: 'initial', ...over }];
  const go = session_evidence => run({ semantic: booking, extra: { availability, booking_authorization: bookingProof, session_evidence, turn: turnWithoutName } });
  assert.equal((await go(hist())).commercial_decision.actions.create_reservation.allowed, true);
  assert.equal((await go(hist({ session_id: 'outra' }))).commercial_decision.status, 'refused');
  assert.equal((await go(hist({ direction: 'outbound', sender_type: 'ai' }))).commercial_decision.status, 'refused');
  assert.equal((await go(hist({ text: 'oi, tudo bem' }))).commercial_decision.status, 'refused');
  // nome sem evidência própria (inferido pelo modelo)
  const inferred = { ...booking, slots: { ...booking.slots, name_evidence_ids: [] } };
  assert.equal((await run({ semantic: inferred, extra: { availability } })).commercial_decision.status, 'refused');
  // a intenção de reservar continua exigindo evidência do turno atual
  const staleIntent = { ...booking, evidence_ids: ['h1'], services: [{ service_id: 'svc_a', role: 'booking_target', evidence_ids: ['h1'], session_id: 'initial' }] };
  assert.equal((await run({ semantic: staleIntent, extra: { availability, session_evidence: hist(), turn: turnWithoutName } })).commercial_decision.status, 'refused');
});

test('identidade do turno: request_id = <último event_id>:<token>, token uuid, contrato, slug e instância do claim', async () => {
  const sem = { primary_intent: 'other' };
  for (const [label, extra] of [
    ['request_id de outra mensagem', { noria_business_context: { session_id: 'initial', request_id: 'm9:' + TOKEN } }],
    ['sufixo sem o evento', { noria_business_context: { session_id: 'initial', request_id: 'x:m1:' + TOKEN } }],
    ['claim de outra instância', { turn: turnOf({ instance: 'outra' }) }],
    ['claim de outro tenant', { turn: turnOf({ tenant_slug: 'wesley_automoveis' }) }],
    ['contrato de fila ausente', { turn: turnOf({ contract: undefined }) }],
    ['token que não é uuid', { turn: turnOf({ token: 'tok' }), noria_business_context: { session_id: 'initial', request_id: 'm1:tok' } }],
  ]) assert.equal((await run({ semantic: sem, extra })).commercial_decision_error, 'COMMERCIAL_TURN_IDENTITY_MISMATCH', label);
  assert.equal((await run({ semantic: sem })).commercial_decision_status, 'ok');
});

test('disponibilidade: prova presa a tenant, conversa, sessão, solicitação, turno, serviço, unidade, data e horário', async () => {
  const booking = { primary_intent: 'booking_intent', services: [ref('svc_a', 'booking_target')], slots };
  const decide = async proof => (await run({ semantic: booking, extra: { availability: proof, booking_authorization: bookingProof } })).commercial_decision.actions.create_reservation;
  const ok = await decide(availability);
  assert.equal(ok.allowed, true);
  assert.equal(ok.idempotency_key, 'whatsapp:m1');
  assert.equal(ok.completion_claim_allowed, false);
  for (const field of ['tenant_id', 'remote_jid', 'session_id', 'request_id', 'turn_token', 'unit_id', 'service_id', 'date', 'time']) {
    const r = await decide({ ...availability, [field]: 'outro' });
    assert.equal(r.allowed, false, field);
    assert.equal(r.reason, 'AVAILABILITY_NOT_VERIFIED', field);
  }
  assert.equal((await decide({ ...availability, available_starts: ['11:30'] })).reason, 'SLOT_NOT_AVAILABLE');
  assert.equal((await decide(undefined)).reason, 'AVAILABILITY_NOT_VERIFIED');
});

test('saúde/segurança: sem fonte autorizada a EXT não deixa informar e exige humano', async () => {
  const d = (await run({ semantic: { primary_intent: 'info_inquiry', services: [ref('svc_a', 'asked_about')], info_requests: [{ topic: 'health_or_safety', service_ids: ['svc_a'], evidence_ids: ['m1'] }] } })).commercial_decision;
  assert.equal(d.status, 'ok');
  assert.equal(d.actions.present_information.allowed, false);
  assert.equal(d.actions.handoff.required, true);
  assert.ok(d.reason_codes.includes('NO_AUTHORIZED_SOURCE_FOR_TOPIC'));
  assert.deepEqual(d.approved_blocks, []);
});


test('auditoria de reserva é vinculada ao turno e à proposta', async () => {
 const booking = { primary_intent:'booking_intent', services:[ref('svc_a','booking_target')], slots };
 const proposal = { service_id:'svc_a', unit_id:'u1', date:slots.date, time:slots.time, customer_name:slots.customer_name };
 const identity = { tenant_id:TENANT, instance:'inst', remote_jid:'5500@s.whatsapp.net', session_id:'initial', request_id:'m1:'+TOKEN, turn_token:TOKEN };
 const proof = { contract:'current_booking_authorization_v1', identity, proposal, status:'accepted', evidence_ids:['m1'] };
 let d=(await run({semantic:booking})).commercial_decision;
 assert.deepEqual(d.actions.create_reservation.candidate,proposal);
 d=(await run({semantic:booking,extra:{availability}})).commercial_decision;
 assert.equal(d.actions.create_reservation.reason,'BOOKING_AUTHORIZATION_REQUIRED');
 d=(await run({semantic:booking,extra:{availability,booking_authorization:proof}})).commercial_decision;
 assert.equal(d.actions.create_reservation.allowed,true);
 for(const bad of [{...proof,proposal:{...proposal,customer_name:'Outro Nome'}},{...proof,evidence_ids:['outro']},{...proof,status:'unavailable'}]) {
  d=(await run({semantic:booking,extra:{availability,booking_authorization:bad}})).commercial_decision;
  assert.equal(d.actions.create_reservation.allowed,false); assert.equal(d.actions.handoff.required,true);
 }
 for(const status of ['blocked_real_name','blocked_audience']) {
  d=(await run({semantic:booking,extra:{availability,booking_authorization:{...proof,status}}})).commercial_decision;
  assert.equal(d.actions.create_reservation.allowed,false); assert.equal(d.actions.create_reservation.reason,status.toUpperCase());
 }
});


test('dados oficiais de Pix são autorizados apenas quando configurados', async () => {
 const settings=baseSettings(); settings.payment.pix_key='chave-teste'; settings.payment.pix_holder='Titular Teste'; settings.payment.pix_institution='Banco Teste';
 const d=(await run({settings,semantic:{primary_intent:'info_inquiry',info_requests:[{topic:'payment_terms',service_ids:[],evidence_ids:['m1']}]}})).commercial_decision;
 for(const [id,value] of [['payment.pix_key','chave-teste'],['payment.pix_holder','Titular Teste'],['payment.pix_institution','Banco Teste']]) assert.ok(d.facts.some(f=>f.fact_id===id && f.value===value));
});


test('cancelamento ou remarcação e incerteza não autorizam ações incompatíveis', async () => {
 for (const intent of ['cancellation','reschedule','slot_change']) {
  const d=(await run({semantic:{primary_intent:intent,secondary_intents:['booking_intent'],services:[ref('svc_a','booking_target')],slots},extra:{availability,booking_authorization:bookingProof}})).commercial_decision;
  assert.equal(d.actions.create_reservation.allowed,false); assert.equal(d.actions.handoff.required,true);
 }
 const d=(await run({semantic:{primary_intent:'payment_report',confidence:'low',payment:{declared:true,evidence_ids:['m1']}},extra:{reservations:[{id:'a',status:'pending_payment'}]}})).commercial_decision;
 assert.equal(d.actions.forward_payment_declaration.allowed,false);
});


test('política de público e mensagens de bloqueio vêm da configuração do tenant', async () => {
 const settings=baseSettings(); settings.business_facts.audience={exclusive_to:'female',allow_proxy_booking_for_female:true,policy:'política oficial',invalid_name_message:'Informe nome real',ineligible_booking_message:'Público definido'};
 const booking={primary_intent:'booking_intent',services:[ref('svc_a','booking_target')],slots};
 let d=(await run({settings,semantic:booking})).commercial_decision;
 assert.deepEqual(d.actions.create_reservation.audience_policy,{exclusive_to:'female',allow_proxy_booking_for_female:true,policy:'política oficial'});
 for(const [status,value] of [['blocked_real_name','Informe nome real'],['blocked_audience','Público definido']]) {
  d=(await run({settings,semantic:booking,extra:{availability,booking_authorization:{...bookingProof,status}}})).commercial_decision;
  assert.ok(d.facts.some(f=>f.fact_id==='booking.block_message' && f.value===value));
 }
});


// Paridade com a v1 (lacunas encontradas na comparação com a configuração de produção). Fixtures sintéticas.
test('valor de taxa configurada em business_facts.fees é aceito em bloco aprovado sem serviço; valor desconhecido continua inválido', async () => {
 const settings=baseSettings(); settings.business_facts.fees={after_hours:10};
 settings.approved_messages.blocks.blk_rules={text:'Regras gerais. Acréscimo de R$ 10,00 após o horário.',service_ids:[]};
 settings.approved_messages.blocks.blk_rules_bad={text:'Regras gerais. Acréscimo de R$ 11,00.',service_ids:[]};
 const d=(await run({settings,semantic:{primary_intent:'other'}})).commercial_decision;
 assert.ok(!d.config.invalid_approved_blocks.includes('blk_rules'));
 assert.ok(d.config.invalid_approved_blocks.includes('blk_rules_bad'));
 const none=baseSettings(); none.approved_messages.blocks.blk_rules={text:'Acréscimo de R$ 10,00.',service_ids:[]};
 assert.ok((await run({settings:none,semantic:{primary_intent:'other'}})).commercial_decision.config.invalid_approved_blocks.includes('blk_rules'));
});

test('política de público configurada é exposta como fato, sem texto fixo no código', async () => {
 const settings=baseSettings(); settings.business_facts.audience={exclusive_to:'female',allow_proxy_booking_for_female:true,policy:'política oficial do público'};
 let d=(await run({settings,semantic:{primary_intent:'info_inquiry',services:[ref('svc_a','asked_about')]}})).commercial_decision;
 assert.ok(d.facts.some(f=>f.fact_id==='audience.exclusive_to' && f.value==='female'));
 assert.ok(d.facts.some(f=>f.fact_id==='audience.policy' && f.value==='política oficial do público'));
 d=(await run({semantic:{primary_intent:'info_inquiry',services:[ref('svc_a','asked_about')]}})).commercial_decision;
 assert.ok(!d.facts.some(f=>f.fact_id.startsWith('audience.')));
});

test('atendimento a domicílio vem de service_guidance.home_service e nunca autoriza reserva automática', async () => {
 const settings=baseSettings();
 settings.business_facts.service_guidance.g_spray={services:['svc_b'],booking:'human',home_service:{available:true,booking:'human',price_status:'confirm_with_team',coverage_status:'confirm_with_team',availability_status:'confirm_with_team',source:'texto livre'}};
 let d=(await run({settings,semantic:{primary_intent:'info_inquiry',services:[ref('svc_b','asked_about')]}})).commercial_decision;
 for(const [id,value] of [['available','true'],['booking','human'],['price_status','confirm_with_team'],['coverage_status','confirm_with_team'],['availability_status','confirm_with_team']])
  assert.ok(d.facts.some(f=>f.fact_id==='service.svc_b.home_service.'+id && f.value===value),id);
 assert.ok(!d.facts.some(f=>f.fact_id==='service.svc_b.home_service.source'));
 assert.ok(!d.facts.some(f=>f.fact_id.startsWith('service.svc_a.home_service')));
 d=(await run({settings,semantic:{primary_intent:'booking_intent',services:[ref('svc_b','booking_target')],slots},extra:{availability:{...availability,service_id:'svc_b'}}})).commercial_decision;
 assert.equal(d.actions.create_reservation.allowed,false); assert.equal(d.actions.handoff.required,true);
});

test('duração e permanência do procedimento caem para o grupo de service_guidance quando o catálogo não as traz', async () => {
 const settings=baseSettings();
 Object.assign(settings.business_facts.service_guidance,{
  g_machine:{services:['svc_a'],procedure_minutes_min:40,procedure_minutes_max:80,stay_minutes:{svc_a:[90,150]}},
  g_spray:{services:['svc_b'],procedure_minutes:20,stay_minutes:45}});
 const d=(await run({settings,semantic:{primary_intent:'info_inquiry',services:[ref('svc_a','asked_about'),ref('svc_b','asked_about')]}})).commercial_decision;
 const fact=id=>d.facts.find(f=>f.fact_id===id)?.value;
 assert.equal(fact('service.svc_a.procedure_minutes'),'40-80'); assert.equal(fact('service.svc_a.stay_minutes'),'90-150');
 assert.equal(fact('service.svc_b.procedure_minutes'),'20'); assert.equal(fact('service.svc_b.stay_minutes'),'45');
});


// Decisões do responsável (Q1, Q2, Q3, Q6).
test('nova reserva havendo outra reserva futura ativa conhecida vai para a equipe; reservas inativas não bloqueiam', async () => {
 const booking={primary_intent:'booking_intent',services:[ref('svc_a','booking_target')],slots};
 const extra=reservations=>({availability,booking_authorization:bookingProof,reservations});
 for (const status of ['pending_payment','payment_reported','confirmed']) {
  const d=(await run({semantic:booking,extra:extra([{id:'r1',status,service_id:'svc_b',requested_date:'2030-02-01',requested_time:'09:00'}])})).commercial_decision;
  assert.equal(d.actions.create_reservation.allowed,false,status);
  assert.equal(d.actions.create_reservation.reason,'EXISTING_FUTURE_RESERVATION',status);
  assert.deepEqual(d.actions.handoff,{required:true,reason:'EXISTING_FUTURE_RESERVATION'},status);
 }
 let d=(await run({semantic:booking,extra:extra([{id:'r1',status:'cancelled',service_id:'svc_b'}])})).commercial_decision;
 assert.equal(d.actions.create_reservation.allowed,true);
 d=(await run({semantic:booking,extra:extra([{id:'r1',status:'confirmed',service_id:'svc_b',starts_at:'2001-01-01T10:00:00Z'}])})).commercial_decision;
 assert.equal(d.actions.create_reservation.allowed,true,'reserva passada não bloqueia');
});

test('tópico payment_terms usa o bloco aprovado que declara esse tópico nos dados do tenant, sem nome de bloco no código', async () => {
 const settings=baseSettings(); settings.business_facts.fees={after_hours:10};
 settings.approved_messages.blocks.blk_rules={text:'Regras. Acréscimo de R$ 10,00.',service_ids:[],topics:['payment_terms']};
 const info={primary_intent:'info_inquiry',info_requests:[{topic:'payment_terms',service_ids:[],evidence_ids:['m1']}]};
 let d=(await run({settings,semantic:info})).commercial_decision;
 assert.deepEqual(d.actions.present_information.block_keys,['blk_rules']);
 assert.equal(d.approved_blocks[0].literal,true);
 settings.approved_messages.blocks.blk_rules.topics=[];
 d=(await run({settings,semantic:info})).commercial_decision;
 assert.deepEqual(d.actions.present_information.block_keys,[]);
 settings.approved_messages.blocks.blk_rules={text:'Regras. Acréscimo de R$ 99,00.',service_ids:[],topics:['payment_terms']};
 d=(await run({settings,semantic:info})).commercial_decision;
 assert.deepEqual(d.actions.present_information.block_keys,[], 'bloco inválido não é apresentado');
});

test('mensagem de bloqueio de público cai para audience.policy; as chaves específicas prevalecem', async () => {
 const settings=baseSettings(); settings.business_facts.audience={exclusive_to:'female',policy:'política oficial'};
 const booking={primary_intent:'booking_intent',services:[ref('svc_a','booking_target')],slots};
 for(const status of ['blocked_real_name','blocked_audience']) {
  const d=(await run({settings,semantic:booking,extra:{availability,booking_authorization:{...bookingProof,status}}})).commercial_decision;
  assert.ok(d.facts.some(f=>f.fact_id==='booking.block_message' && f.value==='política oficial'),status);
 }
 settings.business_facts.audience.invalid_name_message='Informe nome real';
 const d=(await run({settings,semantic:booking,extra:{availability,booking_authorization:{...bookingProof,status:'blocked_real_name'}}})).commercial_decision;
 assert.equal(d.facts.find(f=>f.fact_id==='booking.block_message').value,'Informe nome real');
});

test('taxa de horário/dia vem de business_facts.fee_rules e só entra quando o pedido cai na regra', async () => {
 const settings=baseSettings();
 settings.business_facts.fees={after_hours:10};
 settings.business_facts.fee_rules={after_hours:{after_time:'17:00',weekdays:[0],holiday_dates:['2030-03-01']}};
 const ask=(date,time)=>run({settings,semantic:{primary_intent:'availability_request',services:[ref('svc_a','selected')],slots:{...slots,date,time}}}).then(r=>r.commercial_decision);
 const fact=(d,id)=>d.facts.find(f=>f.fact_id===id)?.value;
 let d=await ask('2030-01-15','10:00');
 assert.equal(fact(d,'booking.fee.after_hours.applies'),'false'); assert.equal(fact(d,'booking.fee.after_hours.amount'),undefined);
 d=await ask('2030-01-15','17:30'); assert.equal(fact(d,'booking.fee.after_hours.applies'),'true'); assert.equal(fact(d,'booking.fee.after_hours.amount'),'10.00');
 d=await ask('2030-01-15','17:00'); assert.equal(fact(d,'booking.fee.after_hours.applies'),'false','"após" é estritamente depois do limite');
 d=await ask('2030-01-20','08:00'); assert.equal(fact(d,'booking.fee.after_hours.applies'),'true','domingo');
 d=await ask('2030-03-01','09:00'); assert.equal(fact(d,'booking.fee.after_hours.applies'),'true','feriado cadastrado');
 d=await ask('2030-03-04','09:00'); assert.equal(fact(d,'booking.fee.after_hours.applies'),'false','feriado não cadastrado não é presumido');
 delete settings.business_facts.fee_rules;
 d=await ask('2030-01-20','08:00'); assert.equal(fact(d,'booking.fee.after_hours.applies'),undefined,'sem regra configurada nada é presumido');
});

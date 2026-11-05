// Fluxo canônico real com transporte Gemini simulado. Verifica a mecânica de prova,
// não o julgamento do Gemini real. Nenhuma rede, escrita ou mensagem real.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../n8n/code/whatsapp_conversation_core.generated.js'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const body = value => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] });
const catalog = { isComplete: true, matches: [
  { external_id: 'classic', name: 'Serviço Clássico', price: 99.99, active: true },
  { external_id: 'comfort', name: 'Serviço Comfort', price: 179.99, active: true },
] };
const state = { customer_name: '', service_id: 'comfort', date: '', time: '', unit_id: '', unit_evidence: '',
  name_evidence: '', service_evidence: 'in-now', date_evidence: '', time_evidence: '' };
const history = [{ id: 'in-now', direction: 'inbound', sender_type: 'contact', message_text: 'Qual o valor do Comfort?',
  created_at: '2026-10-23T22:00:00-03:00', raw_payload: {} }];
const context = { tenant: { id: 'tenant-fixture', slug: 'clinic' }, settings: { settings: {
  system_prompt: 'Fixture de contrato', prompt_revision: 'fixture', ai_model: 'gemini-3.5-flash-lite',
  gemini_daily_limit: 100, payment: { deposit_percentage: 50 }, business_facts: { fees: { after_hours: 10 } },
} } };
const claim = (source_id, amount_cents, excerpt, source_type = 'service_price') => ({ source_type, source_id, amount_cents, excerpt });

async function engine(reply, claims, { verdict = 'supported_fact', badScope = false, auditError = false, responseState = state,
  action = 'reply', messageKeys = [], clientPolicy = null } = {}) {
  const requests = [];
  const request = async options => {
    if (options.url.endsWith('/rpc/magia_gemini_reserve')) return { allowed: true, tenant_used: 1, tenant_limit: 100 };
    if (options.url.endsWith('/rpc/magia_gemini_release')) return {};
    if (!options.url.includes('generativelanguage.googleapis.com')) throw new Error('NO_NETWORK:' + options.url);
    requests.push(options.body);
    const schema = options.body.generationConfig.responseSchema;
    if (schema.properties.action) return body({ action, reply, state: responseState, message_keys: messageKeys, price_claims: claims });
    if (auditError) throw new Error('fixture auditor unavailable');
    const input = JSON.parse(options.body.contents[0].parts[0].text);
    return body({ scope_key: badScope ? 'another-turn' : input.scope_key, complete: true,
      segments: [{ text: input.reply, kind: verdict,
        evidence: verdict === 'supported_fact' ? input.sources : [] }] });
  };
  const hook = /try \{\r?\n\s*const turnResult = await runTurn\(\);/.exec(code);
  const core = await new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', code.replace(hook[0],
    "geminiTenantBudget = {tenant_id:'tenant-fixture',daily_limit:100}; turn = { token: 'token', boundary_id: 'session', messages: [{event_id:'in-now',id:'message-now',text:'Qual o valor do Comfort?'}] }; return { callGroundedGemini, groundingValidateResponse };\n" + hook[0])).call(
    { helpers: { httpRequest: request } }, { tenant_id: 'tenant-fixture', tenant_slug: 'clinic', instance: 'fixture', remoteJid: 'fixture@s.whatsapp.net', noria_client_policy: clientPolicy },
    { GEMINI_API_KEY: 'fixture', GEMINI_ENABLED: 'true', SUPABASE_URL:'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY:'fixture',
      GEMINI_RATE_SCOPE:'fixture', GEMINI_MAX_RPM:'100', GEMINI_MAX_TPM:'100000', GEMINI_MAX_RPD:'1000' }, {}, () => ({}));
  return { core, requests };
}

test('valor válido de outro serviço não comprova o preço do serviço atual', async () => {
  const text = 'O Serviço Comfort custa R$ 99,99.';
  const { core } = await engine(text, [claim('comfort', 9999, text)]);
  assert.throws(() => core.groundingValidateResponse({ action: 'reply', reply: text, state, message_keys: [], price_claims: [claim('comfort', 9999, text)] },
    context, [{ id: 'in-now', text: 'Qual o valor do Comfort?' }], catalog, { rows: [] }), /PRICE_SOURCE_VALUE_MISMATCH/);
});

test('ID e preço de outro serviço corretos não autorizam atribuí-los ao Comfort no texto', async () => {
  const text = 'O Serviço Comfort custa R$ 99,99.';
  const { core, requests } = await engine(text, [claim('classic', 9999, text)], { verdict: 'unsupported' });
  const out = await core.callGroundedGemini(context, history, catalog, { rows: [] });
  assert.equal(requests.length, 2, 'primária e auditoria independente');
  assert.notEqual(out.text, text);
  assert.match(out.audit.blocked_reason, /SERVICE_PRICE_AUDIT_REJECTED/);
});

test('comparação com fontes próprias para os dois serviços permanece aceita', async () => {
  const text = 'O Clássico custa R$ 99,99 e o Comfort custa R$ 179,99.';
  const { core, requests } = await engine(text, [claim('classic', 9999, 'Clássico custa R$ 99,99'), claim('comfort', 17999, 'Comfort custa R$ 179,99')]);
  const out = await core.callGroundedGemini(context, history, catalog, { rows: [] });
  assert.equal(out.text, text);
  assert.equal(requests.length, 2);
  assert.equal(out.audit.price_evidence.status, 'accepted');
});

test('sinal vincula serviço, preço base e percentual do tenant', async () => {
  const text = 'O sinal do Comfort é de R$ 90,00.';
  const { core } = await engine(text, [claim('comfort', 9000, text, 'service_deposit')]);
  const out = await core.callGroundedGemini(context, history, catalog, { rows: [] });
  assert.equal(out.text, text);
  assert.equal(out.audit.price_evidence.status, 'accepted');
});

test('valor por extenso sem fato declarado também precisa de prova', async () => {
  const text = 'O Comfort custa noventa e nove reais.';
  const { core, requests } = await engine(text, [], { verdict: 'unsupported' });
  const out = await core.callGroundedGemini(context, history, catalog, { rows: [] });
  assert.equal(requests.length, 2);
  assert.notEqual(out.text, text);
  assert.match(out.audit.blocked_reason, /SERVICE_PRICE_AUDIT_REJECTED/);
});

test('relatório de outro turno não autoriza o preço', async () => {
  const text = 'O Comfort custa R$ 179,99.';
  const { core } = await engine(text, [claim('comfort', 17999, text)], { badScope: true });
  const out = await core.callGroundedGemini(context, history, catalog, { rows: [] });
  assert.notEqual(out.text, text);
  assert.match(out.audit.blocked_reason, /SERVICE_PRICE_AUDIT_REJECTED/);
});

test('taxa oficial tem autoridade própria, separada do preço do serviço', async () => {
  const text = 'O adicional após o horário é R$ 10,00.';
  const { core } = await engine(text, [claim('after_hours', 1000, text, 'business_fee')]);
  const out = await core.callGroundedGemini(context, history, catalog, { rows: [] });
  assert.equal(out.text, text);
  assert.equal(out.audit.price_evidence.sources[0].source_product_id, 'after_hours');
});

test('indisponibilidade do auditor impede entregar o texto sem prova', async () => {
  const text = 'O Comfort custa R$ 179,99.';
  const { core } = await engine(text, [claim('comfort', 17999, text)], { auditError: true });
  await assert.rejects(core.callGroundedGemini(context, history, catalog, { rows: [] }));
});

test('fala sem preço passa pela verificação e permanece livre de frases prontas', async () => {
  const text = 'Você prefere algum dos serviços?';
  const { core, requests } = await engine(text, [], { verdict: 'non_factual' });
  const out = await core.callGroundedGemini(context, history, catalog, { rows: [] });
  assert.equal(out.text, text);
  assert.equal(requests.length, 2);
});

test('catálogo de outro tenant ou serviço inativo não autoriza o valor', async () => {
  const text = 'O Comfort custa R$ 179,99.';
  const { core } = await engine(text, [claim('comfort', 17999, text)]);
  const result = { action: 'reply', reply: text, state, message_keys: [], price_claims: [claim('comfort', 17999, text)] };
  for (const patch of [{tenant_id:'other'}, {active:false}, {price:null}]) {
    const changed = { matches: catalog.matches.map(row => row.external_id === 'comfort' ? {...row,...patch} : row) };
    assert.throws(() => core.groundingValidateResponse(result, context, [{id:'in-now',text:'Qual o valor?'}], changed, {rows:[]}), /PRICE_SERVICE_SOURCE_INVALID|Price absent/);
  }
});

test('formatação com milhar não altera o preço oficial em centavos', async () => {
  const text = 'O Comfort custa R$ 1.179,99.';
  const { core } = await engine(text, [claim('comfort', 117999, text)]);
  const changed = {matches: catalog.matches.map(row => row.external_id === 'comfort' ? {...row,price:1179.99} : row)};
  const out = await core.callGroundedGemini(context, history, changed, {rows:[]});
  assert.equal(out.text,text);
  assert.equal(out.audit.price_evidence.status,'accepted');
});

test('catálogo sem preços não dispensa auditoria de valor inventado e omitido', async () => {
  const text = 'Esse serviço custa cem reais.';
  const {core,requests} = await engine(text, [], {verdict:'unsupported',responseState:{...state,service_id:'',service_evidence:''}});
  const out = await core.callGroundedGemini(context, history, {matches:[]}, {rows:[]});
  assert.equal(requests.length,2);
  assert.notEqual(out.text,text);
  assert.match(out.audit.blocked_reason,/SERVICE_PRICE_AUDIT_REJECTED/);
});

test('bloco oficial literal válido dispensa auditoria extra; snapshot obsoleto continua bloqueado', async () => {
  const text = 'O Comfort custa R$ 179,99.';
  const policy = {profile:'nb_bronze_v1',modules:{approved_service_texts:true}};
  for (const price of [179.99,99.99]) {
    const configured = {...context,settings:{settings:{...context.settings.settings,approved_messages:{
      enabled:true,revision:'nb-texts-v1',catalog_prices:{comfort:price},blocks:{comfort:{text,service_ids:['comfort']}}
    }}}};
    const {core,requests} = await engine('Texto livre ignorado',[],{action:'approved_reply',messageKeys:['comfort'],clientPolicy:policy});
    const out = await core.callGroundedGemini(configured,history,catalog,{rows:[]});
    assert.equal(requests.length,1);
    if(price===179.99) { assert.equal(out.text,text);assert.equal(out.preserveLiteral,true); }
    else { assert.notEqual(out.text,text);assert.ok(out.audit.blocked_reason); }
  }
});

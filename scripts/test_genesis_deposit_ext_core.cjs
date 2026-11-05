// Regressão direcionada: o mesmo fato monetário (entrada) atravessa CORE e EXT Gênesis sem contradição. Funções reais:
// a decisão comercial do EXT (commercial.decide) e as leituras do CORE gerado. Sem rede.
// Rodar: node --test scripts/test_genesis_deposit_ext_core.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const extCode = fs.readFileSync(path.join(root, 'n8n/sources/genesis_extension.js'), 'utf8');
const coreCode = fs.readFileSync(path.join(root, 'n8n/code/whatsapp_conversation_core.generated.js'), 'utf8');
const TENANT = '0b5e0000-0000-4000-8000-000000000001';
const TOKEN = '7c1f0a52-3b8e-4d6a-9f21-0a5b6c7d8e9f';

const settings = (required) => ({ whatsapp_processing_mode: 'conversation_core_v1', conversation_capability: 'sales_v1', tenant_id: TENANT,
  sales: { hot_lead_rule: 'deposit_30_and_financing_documents_v1', collect_documents: true, financing_require_deposit_for_progress: required,
    required_financing_documents: ['full_name', 'birth_date', 'identity_document_photo'], stage_keys: { initial: 'a' }, stages: {} },
  sdr_rules: { hot_lead_percent: 30 },
  business_facts: { financing: { offered_by_business: true, required_information: { full_name: { required: true }, birth_date: { required: true },
    identity_document_photo: { required: true, one_of: ['cnh', 'cpf'], format: 'photo' } } } } });

// The EXT decision phase exactly as the CORE would send it (verified settings travel with the request, so no network is needed).
async function decide(text, depositInState, { required } = {}) {
  const input = { noria_phase: 'commercial_decision', operation: 'commercial.decide', noria_extension: 'genesis', noria_contract_version: '2.0', tenant_id: TENANT, tenant_slug: 'wesley_automoveis',
    instance: 'inst', remoteJid: '5500@s.whatsapp.net', noria_verified_settings: settings(required),
    turn: { claimed: true, token: TOKEN, boundary_id: 'initial', messages: [{ event_id: 'in-1', id: 'ext-1', text }] }, noria_business_context: { session_id: 'initial', request_id: 'in-1:' + TOKEN },
    semantic_intent: { valid: true, primary_intent: 'financing', secondary_intents: [], topics: ['financing'], references: { evidence_ids: [], product_references: [], mentioned_product_ids: [] }, customer_disposition: { value: 'active', evidence_ids: [] } },
    state: { intent: 'buy', transaction_mode: 'buy', payment_mode: 'financing', payment_evidence: 'in-1', customer_name: 'Cliente Teste Silva', deposit_cents: depositInState } };
  const out = await new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', extCode).call({ helpers: { httpRequest: async () => { throw new Error('sem rede'); } } }, input,
    { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'k' }, {}, () => ({}));
  assert.equal(out.json.commercial_decision_status, 'ok', out.json.commercial_decision_error);
  return out.json.commercial_decision;
}

async function core() {
  const hook = /try \{\r?\n\s*const turnResult = await runTurn\(\);/.exec(coreCode);
  return new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', coreCode.replace(hook[0], 'return { salesDeclaredAmount };\n' + hook[0])).call({ helpers: { httpRequest: async () => ({}) } },
    { tenant_slug: 'wesley_automoveis', tenant_id: 't', remoteJid: '5511@s.whatsapp.net', instance: 'i', noria_preclaimed_turn: { boundary_id: 'b', messages: [], claimed: true, token: 'x' } }, {}, {}, () => ({}));
}

test('a entrada declarada junto de uma pergunta atravessa o EXT: o EXT nunca a perde nem a substitui; a autoridade é o estado validado pelo CORE', async () => {
  const incident = 'Essa Honda cb ai, tenho 10 mil de entrada, da pra Dale ?';
  assert.equal((await decide(incident, 1000000)).commercial_state.deposit_cents, 1000000, 'estado do CORE preservado pelo EXT');
  assert.equal((await decide(incident, null)).commercial_state.deposit_cents, null, 'o EXT não cria entrada por conta própria: um segundo leitor semântico contradiria o CORE');
  assert.equal((await decide('Tem como dar R$ 10 mil de entrada?', 500000)).commercial_state.deposit_cents, 500000, 'hipótese não substitui a entrada já declarada');
  assert.equal((await decide('Tem como dar R$ 10 mil de entrada?', null)).commercial_state.deposit_cents, null, 'hipótese isolada não vira entrada');
  assert.equal((await decide('e se eu der 20 mil de entrada?', 1000000)).commercial_state.deposit_cents, 1000000);
});

test('CORE e EXT não se contradizem: onde o EXT lê um valor, o CORE lê o mesmo; onde o EXT se abstém, mantém o estado', async () => {
  const c = await core();
  for (const text of ['tenho 10 mil de entrada', 'Dando 6mil de entrada e parcelamento no cartão', 'entrada de R$ 10.000,00', 'vou dar 15 mil de entrada', 'Tem como dar R$ 10 mil de entrada?',
    'e se eu der 20 mil de entrada?', 'Essa Honda cb ai, tenho 10 mil de entrada, da pra Dale ?']) {
    const ext = (await decide(text, null)).commercial_state.deposit_cents;
    const coreAmount = c.salesDeclaredAmount(text);
    if (ext !== null) assert.equal(coreAmount, ext, 'contradição monetária em: ' + text);
    if (ext === null && /tenho 10 mil/.test(text)) assert.equal(coreAmount, 1000000, 'o CORE cobre o que o EXT, por desenho, não lê');
    if (/^(Tem como|e se)/.test(text)) assert.equal(coreAmount, null, 'hipótese: nenhum dos dois cria entrada');
  }
});

test('a decisão do EXT diferencia entrada declarada de limiar de temperatura e não carrega valor aprovado, parcela ou saldo derivado', async () => {
  const d = await decide('Essa Honda cb ai, tenho 10 mil de entrada, da pra Dale ?', 1000000, { required: false });
  assert.equal(d.commercial_state.deposit_cents, 1000000);
  assert.ok(!JSON.stringify(d).match(/installment|parcela|approved|aprovad|financed_balance|saldo/i), 'nenhum valor aprovado, parcela ou cálculo derivado emitido pelo EXT');
  const missing = (await decide('oi', null, { required: false })).commercial_state;
  assert.equal(missing.deposit_cents, null);
  const required = await decide('oi', null, { required: true });
  const optional = await decide('oi', null, { required: false });
  assert.ok(JSON.stringify(required).includes('deposit') && JSON.stringify(required) !== JSON.stringify(optional), 'a exigência de entrada vem só da configuração');
});

test('commercial.decide não substitui a entrada validada por um segundo parsing da conversa', async () => {
  const text = 'Tenho 20 mil de entrada';
  const kept = await decide(text, 1000000);
  assert.equal(kept.commercial_state.deposit_cents, 1000000);
  assert.equal(kept.lead_classification.deposit_cents, 1000000);
  assert.equal((await decide(text, null)).commercial_state.deposit_cents, null, 'texto sozinho não cria valor comercial');
  assert.equal((await decide(text, 0)).commercial_state.deposit_cents, 0, 'zero validado não é substituído pelo parser');
});

test('commercial.decide descarta valor monetário estruturalmente inválido sem reconstruí-lo pelo texto', async () => {
  for (const invalid of [-1, 1.5, '1000000', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal((await decide('Tenho 20 mil de entrada', invalid)).commercial_state.deposit_cents, null);
  }
});

// Guardas do contrato CORE × EXT: versão suportada pelo CORE, guarda de atendimento automático
// de outra empresa e textos/orçamentos declarados pela EXT em vez da flag de protocolo.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../n8n/sources/noria_core.js'), 'utf8').replace(/\r\n/g, '\n');

function slice(startMarker, endMarker = '\n}\n') {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, 'trecho ausente: ' + startMarker);
  return source.slice(start, source.indexOf(endMarker, start) + endMarker.length);
}
const protocol = source.slice(source.indexOf('function salesUsesStructuredDialogue()'), source.indexOf('\nconst allowedBusinessProfiles')) + '\n';
const normalize = slice('function normalizeText(value)');

function validPolicy(version) {
  return {
    profile: 'vehicle_sales_v1', capability: 'sales_v1', contract: 'noria_policy_v2', tenant_slug: 'loja_x', tenant_id: 't1', audio_enabled: false,
    modules: { dialogue: { contract: 'noria_sales_dialogue_v1', instructions: [] },
      commercial_contract: { contract: 'noria_commercial_decision_v1', version, provenance: 'ext_decide_v1' } },
  };
}

test('CORE recusa versão de contrato comercial que ele não implementa', () => {
  const declaration = source.slice(source.indexOf('function salesUsesStructuredDialogue()'), source.indexOf('\n}\n', source.indexOf('function validateTenantPolicyContract()')) + 3);
  const validate = new Function('tenantBusinessRules', 'tenantSlug', 'inputJson',
    declaration + '; validateTenantPolicyContract(); return salesSupportedContractVersion();');
  assert.throws(() => validate(validPolicy('9.9'), 'loja_x', { tenant_id: 't1' }), /NORIA_COMMERCIAL_PROTOCOL_INVALID/);
  assert.throws(() => validate(validPolicy(''), 'loja_x', { tenant_id: 't1' }), /NORIA_COMMERCIAL_PROTOCOL_INVALID/);
  assert.equal(validate(validPolicy('2.0'), 'loja_x', { tenant_id: 't1' }), '2.0');
});

test('a versão exigida na decisão vem do CORE, não da política declarada pela EXT', () => {
  assert.doesNotMatch(source, /salesCommercialContract\(\)\.version\s*\|\|/);
  assert.match(source, /decisionData\?\.noria_contract_version === salesSupportedContractVersion\(\)/);
});

function guard(policy, messages, history = [], tenant = { name: 'Gênesis Automóveis', slug: 'wesley_automoveis' }) {
  const declaration = normalize + slice('function settingsFor(') + protocol + slice('function salesTenantOwnNames(') + slice('function salesAutomatedContactGuard(');
  const run = new Function('tenantBusinessRules', 'context', 'messages', 'history',
    declaration + '; return salesAutomatedContactGuard(messages, history, salesTenantOwnNames(context));');
  return run(policy, { tenant, settings: { settings: { business_facts: { name: tenant.name } } } }, messages, history);
}

test('atendimento automático de outra empresa é reconhecido também no protocolo estruturado', () => {
  const structured = validPolicy('2.0');
  const bot = [{ text: 'Olá! Você entrou em contato com a Autopecas Silva. Como posso ajudar?' }];
  assert.equal(guard(structured, bot), 'other_business_automated_greeting');
  assert.equal(guard(structured, bot, [{ direction: 'outbound' }]), 'other_business_bot_loop');
  assert.equal(guard({ modules: {} }, bot), 'other_business_automated_greeting');
});

test('o nome da própria empresa, lido do tenant, não é tratado como outra empresa', () => {
  const structured = validPolicy('2.0');
  assert.equal(guard(structured, [{ text: 'Oi, bem-vindo ao atendimento da Genesis, como posso ajudar?' }]), null);
  assert.equal(guard(structured, [{ text: 'Você entrou em contato com a Clinica Nubia. Como posso ajudar?' }], [],
    { name: 'Clínica Núbia', slug: 'clinica_nubia_oficial' }), null);
  assert.equal(guard(structured, [{ text: 'Você entrou em contato com a Clinica Nubia. Como posso ajudar?' }]), 'other_business_automated_greeting');
});

test('textos de fallback e orçamento de tokens vêm da EXT, não da flag de protocolo', () => {
  for (const name of ['salesPriceUnavailableReply', 'salesDuplicateReplyDecision']) {
    assert.doesNotMatch(slice('function ' + name + '('), /salesUsesStructuredDialogue\(\)\s*\?\s*'/, name);
  }
  assert.doesNotMatch(source, /planilha da loja/);
  assert.doesNotMatch(source, /maxOutputTokens: salesUsesStructuredDialogue\(\)/);
  const copy = slice('function salesDialogueCopy(');
  const read = new Function('tenantBusinessRules', copy + '; return [salesDialogueCopy("price_unavailable", "padrão"), salesDialogueCopy("x", "padrão")];');
  assert.deepEqual(read({ modules: { dialogue: { copy: { price_unavailable: 'Texto da EXT' } } } }), ['Texto da EXT', 'padrão']);
  assert.deepEqual(read({ modules: { dialogue: { copy: { price_unavailable: 42 } } } }), ['padrão', 'padrão']);
});

test('a EXT da Gênesis declara textos e orçamento usados pelo CORE', () => {
  const ext = fs.readFileSync(path.join(__dirname, '../n8n/sources/genesis_extension.js'), 'utf8');
  assert.match(ext, /price_unavailable: '[^']*\{item\}/);
  assert.match(ext, /duplicate_reorientation: '/);
  assert.match(ext, /grounded_max_output_tokens:\s*4096/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const identityCode = fs.readFileSync(path.join(root, 'n8n/sources/genesis_tenant_identity.js'), 'utf8');
const extCode = fs.readFileSync(path.join(root, 'n8n/sources/genesis_extension.js'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const tenantId = '11111111-1111-4111-8111-111111111111';

const settings = {
  whatsapp_processing_mode: 'conversation_core_v1', conversation_capability: 'sales_v1',
  sales: { hot_lead_rule: 'deposit_30_and_financing_documents_v1', collect_documents: true,
    required_financing_documents: ['full_name', 'birth_date', 'identity_document_photo'] },
  sdr_rules: { hot_lead_percent: 30, minimum_purchase_year: 1995,
    rejected_purchase_brands: ['Peugeot', 'Citroen'], preferred_purchase_models: ['Uno', 'Palio', 'Gol', 'Corsa', 'Celta'],
    warranty_response: 'human_review_required', document_processing: 'private_ocr_human_review', ignored_rule: true },
  business_facts: { financing: { offered_by_business: true, required_information: {
    full_name: { required: true }, birth_date: { required: true },
    identity_document_photo: { required: true, one_of: ['cnh', 'cpf'], format: 'photo' }
  } },
    trade_in_policy: { accepted_subject_to_appraisal: true },
    vehicle_appraisal: { revision: 'genesis-appraisal-modes-v1' }, secret: 'must-not-pass' },
};

async function identity(input = {}) {
  const request = async ({ url }) => {
    if (url.includes('tenants?')) return [{ id: tenantId, slug: 'wesley_automoveis', status: 'active' }];
    // A consulta atual usa aliases de settings->campo: a API devolve os campos
    // projetados diretamente, sem o envelope { settings } da consulta antiga.
    if (url.includes('tenant_settings?')) return [{ ...settings }];
    if (url.includes('channels?')) return [{ external_id: 'genesis-instance', status: 'active' }];
    throw new Error('unexpected request');
  };
  return new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', identityCode).call(
    { helpers: { httpRequest: request } },
    { tenant_id: tenantId, tenant_slug: 'wesley_automoveis', noria_extension: 'genesis', noria_contract_version: '2.0', instance: 'genesis-instance', remoteJid: '5511999999999@s.whatsapp.net', ...input },
    { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test' }, {}, () => ({})
  );
}

test('Gênesis EXT keeps an allowlisted commercial policy and blocks another tenant', async () => {
  const verified = (await identity()).json.noria_verified_settings;
  assert.deepEqual(verified.sales.required_financing_documents, ['full_name', 'birth_date', 'identity_document_photo']);
  assert.equal(verified.sales.hot_lead_rule, 'deposit_30_and_financing_documents_v1');
  assert.equal(verified.sales.collect_documents, true);
  assert.equal(verified.sdr_rules.hot_lead_percent, 30);
  assert.equal(verified.business_facts.financing.offered_by_business, true);
  assert.equal(verified.business_facts.secret, undefined);

  const result = await new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', extCode).call(
    { helpers: { httpRequest: async () => { throw new Error('bootstrap must not read again'); } } },
    { tenant_id: tenantId, tenant_slug: 'wesley_automoveis', noria_extension: 'genesis', noria_verified_settings: verified, noria_dispatch_phase: 'bootstrap' },
    { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test' }, {}, () => ({})
  );
  const policy = result.json.noria_business_context.commercial_policy;
  assert.equal(policy.contract, 'noria_commercial_policy_v1');
  assert.equal(policy.financing.offered_by_business, true);
  assert.equal(policy.financing.collection_enabled, true);
  assert.deepEqual(policy.financing.required_documents, ['full_name', 'birth_date', 'identity_document_photo']);
  assert.deepEqual(policy.financing.required_information.identity_document_photo.one_of, ['cnh', 'cpf']);
  assert.equal(policy.trade_in.accepted_subject_to_appraisal, true);
  assert.equal(policy.lead_rules.minimum_purchase_year, 1995);
  assert.deepEqual(policy.lead_rules.rejected_purchase_brands, ['Peugeot', 'Citroen']);
  assert.equal(policy.lead_rules.warranty_response, 'human_review_required');
  assert.equal(policy.lead_rules.document_processing, 'private_ocr_human_review');
  await assert.rejects(() => identity({ tenant_slug: 'clinica_nubia_oficial', noria_extension: 'genesis' }), /NORIA_EXTENSAO_TENANT_INCORRETO/);
});

'use strict';
// A proposta de tenant_settings da JOYERÍA é aceita, como está, pela EXT, pelo roteador e pelo CORE.
// Rodar: node --test clients/joyeria/configuracao/configuracao.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../../../app/node_modules/typescript');
const R = require('../../../n8n/sources/noria_retail.js');

const root = path.join(__dirname, '../../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const TENANT = '33333333-3333-4333-8333-333333333333';
const TESTE = '5521900000000';
const STORE_JID = '5522999237824@s.whatsapp.net';
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function settings({ enabled = true } = {}) {
  const raw = fs.readFileSync(path.join(__dirname, 'tenant_settings_proposta.json'), 'utf8')
    .replace('<TENANT_ID>', TENANT).replace('<NUMERO_DE_TESTE>', TESTE);
  const value = JSON.parse(raw);
  value.noria_turn_pipeline.enabled = enabled;
  return value;
}

test('proposta mantém o pipeline desligado e sem número de teste real', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'tenant_settings_proposta.json'), 'utf8'));
  assert.equal(raw.noria_turn_pipeline.enabled, false);
  assert.deepEqual(raw.noria_turn_pipeline.pilot.allowed_contacts, ['<NUMERO_DE_TESTE>']);
  assert.equal(raw.retail_policy.specialist.customer_message, 'Uma especialista irá entrar em contato');
});

test('vocabulário semântico da política é idêntico ao validado pela EXT', () => {
  const ext = read('n8n/sources/joyeria_extension.js');
  const list = name => JSON.parse(new RegExp('const ' + name + " = (\\[[^\\]]*\\]);").exec(ext)[1].replace(/'/g, '"').replace(/\s+/g, ' '));
  const vocab = settings().noria_client_policy.modules.turn_pipeline.semantic_vocabulary;
  assert.deepEqual(vocab, { intents: list('INTENTS'), roles: list('ROLES'), materials: list('MATERIALS'), decisions: list('DECISIONS'), confidence: list('CONFIDENCE') });
  assert.deepEqual(R.retailVocabulary(settings().noria_client_policy.modules.turn_pipeline), vocab);
});

function loadCore(names, globals) {
  const code = read('n8n/sources/noria_core.js');
  const ast = ts.createSourceFile('core.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const source = ast.statements.filter(ts.isFunctionDeclaration).filter(n => names.includes(n.name.text)).map(n => n.getText(ast)).join('\n');
  const region = require('../../../scripts/lib/retail_region.cjs').extractRetailRegion(code);
  const keys = Object.keys(globals);
  return new Function(...keys, region + '\n' + source + '\nreturn {' + names.join(',') + '};')(...keys.map(key => globals[key]));
}

test('CORE aceita a política (contrato do perfil) e seleciona retail_v1 para turno roteado', () => {
  const s = settings();
  const policy = s.noria_client_policy;
  const core = loadCore(['validateTenantPolicyContract', 'salesUsesStructuredDialogue', 'salesCommercialContract', 'salesSupportedContractVersion', 'settingsFor', 'salesEnabled', 'turnPipelineFor'], {
    tenantBusinessRules: policy, tenantSlug: 'joyeria', inputJson: { tenant_id: TENANT, noria_contract_version: '1.0', noria_pipeline: 'retail_v1' },
    allowedBusinessProfiles: { nb_bronze_v1: 'standard', vehicle_sales_v1: 'sales_v1', services_booking_v2: 'standard', retail_consultative_v1: 'standard' },
    TURN_PIPELINE_CONTRACT: 'noria_turn_pipeline_v1', TURN_PIPELINE_CAPABILITIES: ['services_v1', 'retail_v1'],
    TURN_PIPELINE_FIELDS: ['contract', 'capability', 'contract_version', 'semantic_contract', 'decision_contract', 'decision_provenance'] });
  assert.doesNotThrow(() => core.validateTenantPolicyContract());
  const pipe = core.turnPipelineFor({ settings: { settings: s } });
  assert.equal(pipe.capability, 'retail_v1');
  // Coerência que o CORE confere a cada turno entre política e configurações.
  assert.equal(policy.audio_enabled, s.whatsapp_audio_enabled === true);
  assert.equal(policy.scheduling_enabled, s.appointment_scheduling?.enabled === true);
});

test('roteador envia o número de teste ao retail_v1 e mantém os demais contatos fora', async () => {
  const code = read('n8n/sources/noria_router.js');
  const run = async (s, remoteJid) => {
    const rows = { tenants: [{ id: TENANT, slug: 'joyeria', status: 'active' }], channels: [{ external_id: 'joyeria', status: 'active', config: {} }],
      tenant_settings: [{ settings: s }], conversation_turn_queue: [], channel_events: [] };
    const out = await new AsyncFunction('$json', '$env', '$binary', code).call({ helpers: { httpRequest: async req => rows[new URL(req.url).pathname.split('/').pop()] } },
      { tenant_slug: 'joyeria', tenant_id: TENANT, instance: 'joyeria', remoteJid }, { SUPABASE_URL: 'https://db.invalid', SUPABASE_SERVICE_ROLE_KEY: 'x' });
    return out.json;
  };
  assert.equal((await run(settings(), TESTE + '@s.whatsapp.net')).noria_pipeline, 'retail_v1');
  assert.equal((await run(settings(), '5511988887777@s.whatsapp.net')).noria_pipeline, undefined);
  assert.equal((await run(settings({ enabled: false }), TESTE + '@s.whatsapp.net')).noria_pipeline, undefined);
});

test('destino do aviso é o número pessoal configurado e nunca o número da loja', () => {
  assert.deepEqual(R.retailSpecialistRecipient(settings(), TESTE + '@s.whatsapp.net'), { ok: true, number: '5522997963611' });
  assert.notEqual(settings().specialist_notification.recipient, STORE_JID.split('@')[0]);
});

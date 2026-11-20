// Roteamento retail_v1: roteador (ramo saas_dynamic) e travas do CORE para turnos fora da rota. Sem rede.
// Rodar: node --test scripts/test_retail_routing.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../app/node_modules/typescript');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const root = path.join(__dirname, '..');
const routerCode = fs.readFileSync(path.join(root, 'n8n/sources/noria_router.js'), 'utf8');
const coreCode = fs.readFileSync(path.join(root, 'n8n/sources/noria_core.js'), 'utf8').replace(/\r\n/g, '\n');

const ID = '22222222-2222-4222-8222-222222222222';
const LEAD = '5522999990000@s.whatsapp.net';
const offered = { contract: 'noria_turn_pipeline_v1', capability: 'retail_v1', contract_version: '1.0' };
const retailPolicy = { contract: 'noria_policy_v2', profile: 'retail_consultative_v1', capability: 'standard', modules: { turn_pipeline: offered } };
const declared = { enabled: true, rollout: 'all', contract: 'noria_turn_pipeline_v1', capability: 'retail_v1', contract_version: '1.0' };

async function route({ settings, queue = [], pins = [], remoteJid = LEAD }) {
  const requests = [];
  const rows = { tenants: [{ id: ID, slug: 'loja', status: 'active' }], channels: [{ external_id: 'loja', status: 'active', config: {} }],
    tenant_settings: [{ settings }], conversation_turn_queue: queue, channel_events: pins };
  const out = await new AsyncFunction('$json', '$env', '$binary', routerCode).call({ helpers: { httpRequest: async req => {
    requests.push(req); return rows[new URL(req.url).pathname.split('/').pop()]; } } },
  { tenant_slug: 'loja', tenant_id: ID, instance: 'loja', remoteJid }, { SUPABASE_URL: 'https://db.invalid', SUPABASE_SERVICE_ROLE_KEY: 'x' });
  return { value: out.json, requests };
}

test('declaração válida marca o turno como retail_v1; todas as leituras são GET', async () => {
  const { value, requests } = await route({ settings: { noria_client_policy: retailPolicy, noria_turn_pipeline: declared } });
  assert.equal(value.noria_pipeline, 'retail_v1');
  assert.equal(value.noria_router, 'retail_v1');
  assert.equal(value.noria_contract_version, '1.0');
  assert.equal(value.noria_extension, 'saas_dynamic');
  assert.ok(requests.every(req => (req.method || 'GET') === 'GET'));
});

test('piloto: só o contato autorizado entra; LID nunca casa com número', async () => {
  const pilot = { ...declared, rollout: 'pilot', pilot: { allowed_contacts: ['+55 (22) 99999-0000'] } };
  assert.equal((await route({ settings: { noria_client_policy: retailPolicy, noria_turn_pipeline: pilot } })).value.noria_pipeline, 'retail_v1');
  const other = await route({ settings: { noria_client_policy: retailPolicy, noria_turn_pipeline: pilot }, remoteJid: '5511888880000@s.whatsapp.net' });
  assert.equal(other.value.noria_pipeline, undefined);
  assert.equal(other.value.noria_router, 'saas_dynamic_v1');
  const lid = await route({ settings: { noria_client_policy: retailPolicy, noria_turn_pipeline: pilot }, remoteJid: '5522999990000@lid' });
  assert.equal(lid.value.noria_pipeline, undefined);
});

test('declaração desligada ou ausente não roteia; inválida falha fechada', async () => {
  assert.equal((await route({ settings: { noria_client_policy: retailPolicy } })).value.noria_pipeline, undefined);
  assert.equal((await route({ settings: { noria_client_policy: retailPolicy, noria_turn_pipeline: { ...declared, enabled: false } } })).value.noria_pipeline, undefined);
  for (const bad of [{ ...declared, capability: 'services_v1' }, { ...declared, contract_version: '2.0' }, { ...declared, rollout: 'pilot', pilot: { allowed_contacts: [] } }]) {
    await assert.rejects(route({ settings: { noria_client_policy: retailPolicy, noria_turn_pipeline: bad } }), /NORIA_ROTEAMENTO_PIPELINE_CONFIG_INVALIDA/);
  }
});

test('lote em andamento: com pino fica no retail; sem pino segue o caminho padrão', async () => {
  const queue = [{ claimed: [{ event_id: 'e1' }] }];
  const pinned = await route({ settings: { noria_client_policy: retailPolicy, noria_turn_pipeline: declared }, queue, pins: [{ external_message_id: 'noria_pin_1.0_e1' }] });
  assert.equal(pinned.value.noria_pipeline, 'retail_v1');
  assert.equal(pinned.value.noria_router, 'retail_v1_pinned');
  const unpinned = await route({ settings: { noria_client_policy: retailPolicy, noria_turn_pipeline: declared }, queue, pins: [] });
  assert.equal(unpinned.value.noria_pipeline, undefined);
});

test('tenant SaaS de outro perfil não muda: mesma saída de antes, sem consultar a fila', async () => {
  const policy = { contract: 'noria_policy_v2', profile: 'services_booking_v2', capability: 'standard', modules: {} };
  const { value, requests } = await route({ settings: { noria_client_policy: policy, noria_turn_pipeline: declared } });
  assert.equal(value.noria_pipeline, undefined);
  assert.equal(value.noria_router, 'saas_dynamic_v1');
  assert.equal(value.noria_contract_version, '1.0');
  assert.ok(!requests.some(req => req.url.includes('conversation_turn_queue')));
});

function loadCore(names, globals) {
  const ast = ts.createSourceFile('core.js', coreCode, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const source = ast.statements.filter(ts.isFunctionDeclaration).filter(n => names.includes(n.name.text)).map(n => n.getText(ast)).join('\n');
  const keys = Object.keys(globals);
  return new Function(...keys, source + '\nreturn {' + names.join(',') + '};')(...keys.map(key => globals[key]));
}

test('CORE: tenant de varejo com declaração ativa mas turno não roteado não entra no pipeline', () => {
  const offeredFull = { ...offered, semantic_contract: 's', decision_contract: 'd', decision_provenance: 'p',
    semantic_vocabulary: { intents: ['a'], roles: ['b'], materials: ['c'], decisions: ['d'], confidence: ['e'] } };
  const policy = { ...retailPolicy, modules: { turn_pipeline: offeredFull } };
  const decl = { ...declared, semantic_contract: 's', decision_contract: 'd', decision_provenance: 'p' };
  const core = loadCore(['settingsFor', 'salesEnabled', 'turnPipelineFor'], { tenantBusinessRules: policy, inputJson: { noria_contract_version: '1.0' },
    TURN_PIPELINE_CONTRACT: 'noria_turn_pipeline_v1', TURN_PIPELINE_CAPABILITIES: ['services_v1', 'retail_v1'],
    TURN_PIPELINE_FIELDS: ['contract', 'capability', 'contract_version', 'semantic_contract', 'decision_contract', 'decision_provenance'] });
  assert.equal(core.turnPipelineFor({ settings: { settings: { noria_turn_pipeline: decl } } }), null);
});

test('CORE: tenant de varejo fora do pipeline nunca segue para o caminho de serviços', () => {
  const start = coreCode.indexOf("if (tenantBusinessRules.profile === 'retail_consultative_v1') {\n    if (!await commit())");
  const legacy = coreCode.indexOf("if (normalized === '/reset' || normalized === 'reset') {\n    if (!await commit()) return { ok: true, skipped: true };");
  assert.ok(start > 0 && legacy > start, 'trava de varejo antes do caminho legado');
  const guard = coreCode.slice(start, coreCode.indexOf('\n  }\n', start));
  assert.match(guard, /retail_pipeline_inactive/);
  assert.doesNotMatch(guard, /sendChannelMessage/);
});

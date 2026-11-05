// Incidentes de 27/10: resolução caiu em tenant padrão após erro de rede;
// coleta avançou sem produto selecionado; limitação interna do anúncio foi enviada.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const intake = JSON.parse(read('n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json'));
const normalize = intake.nodes.find(n => n.name === 'Normalizar Entrada WhatsApp').parameters.jsCode;
const channel = { external_id: 'registered-instance', status: 'active', config: {}, tenants: { slug: 'tenant_a', status: 'active' } };
const transient = () => Object.assign(new Error('timeout of 7000ms exceeded'), { code: 'ECONNABORTED' });
async function ingress(http) {
  return new AsyncFunction('$json', '$env', normalize).call({ helpers: { httpRequest: http } },
    { body: { event: 'messages.upsert', instance: 'registered-instance', data: { key: { id: 'm1', remoteJid: '5511999990000@s.whatsapp.net', fromMe: false }, message: { conversation: 'Oi' } } } },
    { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test', WHATSAPP_TENANT_SLUG: 'legacy_tenant' });
}
test('entrada: timeout transitório tem uma única nova leitura e resolve tenant registrado', async () => {
  let calls = 0;
  const out = await ingress(async () => { if (++calls === 1) throw transient(); return [channel]; });
  assert.equal(calls, 2); assert.equal(out.json.tenant_slug, 'tenant_a');
  assert.equal(out.json.tenant_resolution.source, 'channels.config');
});
test('entrada: indisponibilidade persistente não chega ao sync com tenant padrão', async () => {
  let calls = 0;
  await assert.rejects(ingress(async () => { calls++; throw transient(); }), /NORIA_CHANNEL_RESOLUTION_UNAVAILABLE/);
  assert.equal(calls, 2);
});
test('entrada: erro 400 não é repetido nem vira fallback', async () => {
  let calls = 0;
  await assert.rejects(ingress(async () => { calls++; throw Object.assign(new Error('bad request'), { statusCode: 400 }); }), /NORIA_CHANNEL_RESOLUTION_UNAVAILABLE/);
  assert.equal(calls, 1);
});
test('entrada: tenant suspenso, canal pendente e associação ambígua são bloqueados antes do sync', async () => {
  for (const rows of [[{ ...channel, tenants: { slug: 'tenant_a', status: 'suspended' } }], [{ ...channel, status: 'pending' }], [channel, { ...channel, tenants: { slug: 'tenant_b', status: 'active' } }]]) {
    await assert.rejects(ingress(async () => rows), /NORIA_CHANNEL_(?:INACTIVE|AMBIGUOUS)/);
  }
});
test('entrada: aliases registrados são preservados e ausência comprovada mantém legado', async () => {
  const alias = await ingress(async () => [{ ...channel, external_id: 'provider-id', config: { instance_name: 'registered-instance' } }]);
  assert.equal(alias.json.tenant_slug, 'tenant_a');
  const absent = await ingress(async () => []);
  assert.equal(absent.json.tenant_resolution.source, 'env_fallback');
  assert.equal(absent.json.tenant_slug, 'legacy_tenant');
});
test('entrada: resposta incompleta ou registro truncado não comprova ausência do canal', async () => {
  for (const rows of [{ error: 'bad projection' }, Array.from({ length: 201 }, (_, i) => ({ external_id: 'other-' + i }))]) {
    await assert.rejects(ingress(async () => rows), /NORIA_CHANNEL_RESOLUTION_UNAVAILABLE/);
  }
});
const identity = read('n8n/sources/genesis_tenant_identity.js');
test('EXT: timeout GET é repetido uma vez, somente em leitura', async () => {
  const calls = [], memory = {};
  const out = await new AsyncFunction('$json', '$env', '$getWorkflowStaticData', identity).call({ helpers: { httpRequest: async opts => {
    calls.push(opts); if (calls.length === 1) throw transient();
    if (opts.url.includes('/tenants?')) return [{ status: 'active' }];
    if (opts.url.includes('/tenant_settings?')) return [{ whatsapp_processing_mode: 'conversation_core_v1', conversation_capability: 'sales_v1' }];
    return [{ external_id: 'instance-a', status: 'active' }];
  } } }, { tenant_slug: 'wesley_automoveis', noria_extension: 'genesis', noria_contract_version: '2.0', tenant_id: '11111111-1111-4111-8111-111111111111', instance: 'instance-a', remoteJid: '5511999990000@s.whatsapp.net' }, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test' }, () => memory);
  assert.equal(calls.length, 4); assert.ok(calls.every(c => c.method === 'GET'));
  assert.equal(out.json.noria_verified_settings.conversation_capability, 'sales_v1');
});
test('EXT: falha persistente/400 e tenant inativo não preenchem cache nem pulam validação', async () => {
  for (const mode of ['timeout', '400', 'inactive']) {
    let calls = 0;
    const memory = {};
    const run = new AsyncFunction('$json', '$env', '$getWorkflowStaticData', identity);
    await assert.rejects(run.call({ helpers: { httpRequest: async () => {
      calls++;
      if (mode === 'inactive') return [{ status: 'suspended' }];
      throw mode === 'timeout' ? transient() : Object.assign(new Error('bad request'), { statusCode: 400 });
    } } }, { tenant_slug: 'wesley_automoveis', noria_extension: 'genesis', noria_contract_version: '2.0', tenant_id: '11111111-1111-4111-8111-111111111111', instance: 'instance-a', remoteJid: 'r' }, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test' }, () => memory));
    assert.equal(calls, mode === 'timeout' ? 2 : 1);
    assert.equal(memory.noria_identity, undefined);
  }
});
async function engine(names) {
  const code = read('n8n/code/whatsapp_conversation_core.generated.js');
  const hook = /try \{\r?\n\s*const turnResult = await runTurn\(\);/.exec(code);
  return new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', code.replace(hook[0], 'turn = inputJson.noria_preclaimed_turn; return { ' + names.join(',') + ' };\n' + hook[0])).call({ helpers: { httpRequest: async () => ({}) } }, { tenant_slug: 'tenant_a', tenant_id: 't', remoteJid: 'r', instance: 'i', noria_preclaimed_turn: { claimed: true, token: 'x', boundary_id: 'b', messages: [] } }, {}, {}, () => ({}));
}
const contract = over => ({ fact_evidence_mode: 'standard', answers: [], requested_fields: [], facts: [], availability_asserted: false, assignment_confirmed: false, photo_sent: false, handoff_announced: false, ...over });
test('coleta: decisão EXT exige produto; tópico financing não autoriza pedir nascimento antes', async () => {
  const { salesValidatePrimaryDialogue } = await engine(['salesValidatePrimaryDialogue']);
  const response = { primary_reply: 'Qual é a sua data de nascimento?', state: {}, response_contract: contract({ answers: [{ request_id: 'request_1', excerpt: 'Qual é a sua data de nascimento?' }], requested_fields: [{ field: 'birth_date', excerpt: 'Qual é a sua data de nascimento?' }] }) };
  const result = salesValidatePrimaryDialogue(response, { requests: [{ id: 'request_1', topic: 'financing' }], next_requirement: 'birth_date' }, { active: true, ready: false, next_field: 'purchase_product', missing_fields: ['purchase_product', 'birth_date'] }, { fact_ledger: [], inventory: [], handoff_claim_required: false });
  assert.ok(result.issues.includes('MISSING_COLLECTION_QUESTION:purchase_product'), JSON.stringify(result));
});
test('auditoria: exposição técnica é classificável fora do pedido de fotos e nunca é aceita', async () => {
  const c = await engine(['salesSemanticAuditRequest', 'salesValidateSemanticEvidence', 'salesIssuesRepairable']);
  const reply = 'Não temos a identificação exata do veículo na nossa referência.';
  const req = c.salesSemanticAuditRequest('scope', reply, [], [], 'gemini-3.5-flash-lite');
  assert.ok(req.generationConfig.responseSchema.properties.segments.items.properties.kind.enum.includes('technical_internal_disclosure'));
  const issues = c.salesValidateSemanticEvidence({ scope_key: 'scope', complete: true, segments: [{ text: reply, kind: 'technical_internal_disclosure', evidence: [] }] }, 'scope', reply, [], []);
  assert.ok(issues.includes('SEMANTIC_FACT_TECHNICAL_INTERNAL_DISCLOSURE'));
  assert.equal(c.salesIssuesRepairable(issues), true);
});
test('continuidade: nome e confirmação não são pedidos antigos; prompt instrui esclarecimento sem expor infraestrutura', () => {
  const ext = read('n8n/sources/genesis_extension.js');
  assert.match(ext, /DADOS DE COLETA:/);
  assert.match(ext, /PRIVACIDADE OPERACIONAL:/);
  const core = read('n8n/sources/noria_core.js');
  const repair = core.slice(core.indexOf('async function salesRepairRejectedDialogue('), core.indexOf('async function salesAuditPrimaryDialogue('));
  assert.match(repair, /pending_requirement: execution\.pending_requirement/);
  assert.match(repair, /SEMANTIC_FACT_TECHNICAL_INTERNAL_DISCLOSURE/);
});
test('coleta: esclarecer produto é aceito; pergunta atual de política não força coleta', async () => {
  const { salesValidatePrimaryDialogue } = await engine(['salesValidatePrimaryDialogue']);
  const plan = { requests: [{ id: 'request_1', topic: 'financing' }], next_requirement: 'birth_date' };
  const collection = { active: true, ready: false, next_field: 'purchase_product', missing_fields: ['purchase_product', 'birth_date'] };
  const execution = { fact_ledger: [], inventory: [], handoff_claim_required: false };
  const reply = 'Qual veículo você quer financiar?';
  const fixed = salesValidatePrimaryDialogue({ primary_reply: reply, state: {}, response_contract: contract({ answers: [{ request_id: 'request_1', excerpt: reply }], requested_fields: [{ field: 'purchase_product', excerpt: reply }] }) }, plan, collection, execution);
  assert.equal(fixed.status, 'accepted', JSON.stringify(fixed));
  const policyReply = 'Quer que eu explique as etapas?';
  const policy = salesValidatePrimaryDialogue({ primary_reply: policyReply, state: {}, response_contract: contract({ answers: [{ request_id: 'request_1', excerpt: policyReply }] }) }, plan, collection, execution);
  assert.ok(!policy.issues.includes('MISSING_COLLECTION_QUESTION:purchase_product'));
});
for (const repeatDisclosure of [false, true]) test('motor completo: exposição interna recebe uma reparação auditada; repetição=' + repeatDisclosure, async () => {
  const ex = require('./homolog/genesis_executor.cjs');
  const inventory = JSON.parse(read('scripts/homolog/fixtures/genesis_scenarios.json')).inventory;
  const rejected = 'Não temos a identificação exata do veículo na nossa referência.';
  const repaired = 'Qual veículo chamou sua atenção?';
  const responseContract = reply => contract({ answers: [{ request_id: 'request_1', excerpt: reply }] });
  const body = value => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] });
  let audits = 0, repairs = 0;
  const result = await ex.runScenario({ name: 'anuncio-anonimizado', turns: [{ text: 'Olá! Posso ter mais informações sobre isso?', gemini: {
    reply: rejected, response_contract: { ...responseContract(rejected), fact_evidence_mode: 'semantic' },
    semantic_intent: { primary_intent: 'product_details', topics: ['details'] },
    dialogue_plan: { requests: [{ id: 'request_1', topic: 'details', subject: 'unspecified' }] }
  } }] }, {
    mode: 'fixtures', geminiKey: null, settings: ex.loadSettings(), inventory,
    geminiOverride: (request, schema) => {
      if (schema.properties?.segments) {
        audits++;
        const data = JSON.parse(request.contents[0].parts[0].text);
        return body({ scope_key: data.scope_key, complete: true, segments: [{ text: data.reply,
          kind: audits === 1 || repeatDisclosure ? 'technical_internal_disclosure' : 'non_factual', evidence: [] }] });
      }
      if (schema.properties?.reply && !schema.properties?.semantic_intent) {
        repairs++;
        const reply = repeatDisclosure ? rejected : repaired;
        return body({ reply, response_contract: responseContract(reply) });
      }
    }
  });
  assert.equal(repairs, 1); assert.equal(audits, 2, JSON.stringify(result.steps));
  assert.equal(result.world.log.simulated_sends.length, repeatDisclosure ? 0 : 1);
  if (!repeatDisclosure) assert.equal(result.world.log.simulated_sends[0].text, repaired);
});

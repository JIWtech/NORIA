// Rodar: node --test scripts/test_noria_engine_subworkflow.cjs
// Topologia: o motor conversacional vive numa única cópia, no workflow "NORIA CORE | Motor de Atendimento".
// O roteador (webhook, fila, comandos e follow-ups) não carrega o motor: só os turnos reais chamam o motor, uma vez por fase.
// A EXT do tenant NORIA é um workflow próprio e nunca usa o ID do motor.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const CORE_FILE = 'n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json';
const ENGINE_FILE = 'n8n/workflows/NORIA CORE _ Motor conversacional.json';
const NORIA_EXT_FILE = 'n8n/workflows/NORIA EXT _ NORIA _ Política.json';
const ENGINE_NODE = 'CORE | Motor conversacional';
const ENGINE_ID = 'mlKNPv862H2g3Gap';
const SALON_ID = 'yxdKP0PeskDMUFSo';
const CONTRACT = 'noria_engine_phase_v1';
const PHASES = {
  'CORE | Motor conversacional único': 'single',
  'CORE | Preparar resposta': 'prepare',
  'CORE | Finalizar resposta': 'finalize',
  'CORE | Serviços | Preparar resposta': 'prepare',
  'CORE | Serviços | Verificar disponibilidade': 'availability',
  'CORE | Serviços | Finalizar resposta': 'finalize',
};
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const core = JSON.parse(read(CORE_FILE));
const engine = JSON.parse(read(ENGINE_FILE));
const noriaExt = JSON.parse(read(NORIA_EXT_FILE));
const source = read('n8n/sources/noria_core.js');
const engineCode = engine.nodes.find(n => n.name === ENGINE_NODE)?.parameters?.jsCode || '';
const links = name => (core.connections[name]?.main || []).map(branch => branch.map(connection => connection.node));
const sourcesOf = target => Object.entries(core.connections)
  .filter(([, entry]) => (entry.main || []).flat().some(c => c.node === target)).map(([from]) => from).sort();
const workflowFiles = fs.readdirSync(path.join(root, 'n8n/workflows')).filter(file => file.endsWith('.json'));

test('tamanho: o roteador fica abaixo de 300 KB e nenhum nó dele carrega o motor', () => {
  const bytes = Buffer.byteLength(read(CORE_FILE));
  assert.ok(bytes < 300 * 1024, 'roteador com ' + Math.round(bytes / 1024) + ' KB');
  const big = core.nodes.filter(n => (n.parameters?.jsCode || '').length > 100 * 1024).map(n => n.name);
  assert.deepEqual(big, []);
  assert.equal(core.name, 'NORIA CORE | Roteador WhatsApp, Comandos e Follow-ups');
});

test('tamanho: exatamente uma cópia do motor entre os workflows exportados, no workflow do motor', () => {
  const marker = source.slice(0, 4000);
  const copies = Object.fromEntries(workflowFiles.map(file => {
    const text = read('n8n/workflows/' + file);
    const flat = JSON.stringify(JSON.parse(text));
    const needle = JSON.stringify(marker).slice(1, -1);
    return [file, flat.split(needle).length - 1];
  }));
  assert.equal(Object.values(copies).reduce((total, count) => total + count, 0), 1, JSON.stringify(copies));
  assert.equal(copies['NORIA CORE _ Motor conversacional.json'], 1);
  assert.equal(engine.name, 'NORIA CORE | Motor de Atendimento');
});

test('o sub-workflow do motor tem uma única cópia da fonte canônica, precedida só pela leitura de fase e contrato', () => {
  const trigger = engine.nodes.find(n => n.type === 'n8n-nodes-base.executeWorkflowTrigger');
  assert.ok(trigger, 'gatilho de sub-workflow');
  assert.equal(trigger.parameters.inputSource, 'passthrough');
  assert.deepEqual(engine.connections[trigger.name].main, [[{ node: ENGINE_NODE, type: 'main', index: 0 }]]);
  const node = engine.nodes.find(n => n.name === ENGINE_NODE);
  assert.equal(node.type, 'n8n-nodes-base.code');
  assert.equal(node.parameters.mode, 'runOnceForEachItem');
  assert.ok(engineCode.endsWith(source), 'termina com a fonte canônica, sem alterações');
  assert.equal(engine.nodes.filter(n => n.type === 'n8n-nodes-base.code').length, 1);
  assert.equal(engine.nodes.length, 2);
  assert.equal(engine.settings.saveDataSuccessExecution, 'none');
  new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', engineCode);
});

test('cada fase do roteador chama o mesmo sub-workflow, depois de um nó que marca fase e contrato', () => {
  const ids = new Set();
  for (const [name, phase] of Object.entries(PHASES)) {
    const call = core.nodes.find(n => n.name === name);
    assert.equal(call.type, 'n8n-nodes-base.executeWorkflow', name);
    assert.equal(call.parameters.mode, 'each');
    assert.equal(call.parameters.options.waitForSubWorkflow, true);
    // O nó "único" também pode escolher o motor do I&C Salon por expressão; os demais usam só o ID do motor.
    if (phase !== 'single' || name !== 'CORE | Motor conversacional único') ids.add(call.parameters.workflowId.value);

    const marker = core.nodes.find(n => n.name === name + ' | Fase');
    assert.equal(marker.type, 'n8n-nodes-base.code');
    assert.equal(marker.parameters.mode, 'runOnceForEachItem');
    assert.ok(marker.parameters.jsCode.length < 1024);
    const item = { json: { tenant_slug: 't', remoteJid: 'r' }, binary: { media_file: { id: 'b' } } };
    const out = new Function('$json', '$input', marker.parameters.jsCode)(item.json, { item });
    assert.deepEqual(out.json, { tenant_slug: 't', remoteJid: 'r', noria_engine_phase: phase, noria_engine_contract: CONTRACT });
    assert.equal(out.binary, item.binary, 'o binário (áudio) segue para o motor');
    assert.deepEqual(sourcesOf(name), [name + ' | Fase'], name);
    assert.deepEqual(links(name + ' | Fase'), [[name]]);
  }
  assert.deepEqual([...ids], [ENGINE_ID], 'um único sub-workflow de motor');
});

test('fase e contrato chegam ao motor e saem do item antes de ele ler a entrada; ausente ou divergente falha fechado', async () => {
  const prelude = engineCode.slice(0, engineCode.length - source.length);
  const probe = prelude + '\nreturn { phase: NORIA_NODE_PHASE, json: { ...$json } };';
  const run = json => new AsyncFunction('$json', probe)(json);
  for (const phase of Object.values(PHASES)) {
    const out = await run({ noria_engine_phase: phase, noria_engine_contract: CONTRACT, tenant_slug: 't' });
    assert.equal(out.phase, phase);
    assert.deepEqual(out.json, { tenant_slug: 't' });
  }
  await assert.rejects(run({ tenant_slug: 't' }), /NORIA_ENGINE_PHASE_REQUIRED/);
  await assert.rejects(run({ noria_engine_phase: 'outra', noria_engine_contract: CONTRACT }), /NORIA_ENGINE_PHASE_REQUIRED/);
  await assert.rejects(run({ noria_engine_phase: 'single' }), /NORIA_ENGINE_CONTRACT_MISMATCH/);
  await assert.rejects(run({ noria_engine_phase: 'single', noria_engine_contract: 'noria_engine_phase_v0' }), /NORIA_ENGINE_CONTRACT_MISMATCH/);
  assert.equal(JSON.parse(read('n8n/build_manifest.json')).engine_phase_contract, CONTRACT);
});

test('a EXT NORIA é um workflow próprio: o ID do motor nunca é o padrão dela', () => {
  assert.equal(noriaExt.name, 'NORIA EXT | NORIA | Política');
  const [trigger, policy] = noriaExt.nodes;
  assert.equal(trigger.type, 'n8n-nodes-base.executeWorkflowTrigger');
  assert.equal(trigger.parameters.inputSource, 'passthrough');
  assert.deepEqual(noriaExt.connections[trigger.name].main, [[{ node: policy.name, type: 'main', index: 0 }]]);
  assert.equal(policy.parameters.jsCode, read('n8n/sources/noria_extension.js'));
  assert.equal(noriaExt.settings.saveDataSuccessExecution, 'none');
  assert.ok(!read(NORIA_EXT_FILE).includes(ENGINE_ID));
  assert.ok(!engineCode.includes('EXT NORIA - Política') && engine.nodes.length === 2, 'o motor não é a EXT');
  const call = core.nodes.find(n => n.name === 'CORE | Executar EXT NORIA');
  assert.equal(call.type, 'n8n-nodes-base.executeWorkflow');
  assert.equal(call.parameters.options.waitForSubWorkflow, true);
  assert.notEqual(call.parameters.workflowId.value, ENGINE_ID);
  assert.match(call.parameters.workflowId.value, /^(PREENCHER_ID_EXT_NORIA|[A-Za-z0-9_-]+)$/);
  const engineCalls = core.nodes.filter(n => n.type === 'n8n-nodes-base.executeWorkflow'
    && JSON.stringify(n.parameters.workflowId || {}).includes(ENGINE_ID)).map(n => n.name).sort();
  assert.deepEqual(engineCalls, Object.keys(PHASES).sort(), 'só as seis fases chamam o motor');
  assert.deepEqual(links('CORE - Resolver extensão do tenant'), [['CORE | É tenant NORIA?']]);
  assert.deepEqual(links('CORE | É tenant NORIA?'), [['CORE | Executar EXT NORIA'], ['CORE | Serviços | Núbia v2?']]);
  assert.deepEqual(links('CORE | Executar EXT NORIA'), [['CORE | Motor conversacional único | Fase']]);
});

test('entrada e recuperação convergem no mesmo nó do motor, com fase, contrato, áudio e seleção do Salon', () => {
  assert.deepEqual(links('Recuperar Fila WhatsApp'), [['Ler Fila WhatsApp']]);
  assert.deepEqual(links('Ler Fila WhatsApp'), [['CORE - Resolver extensão do tenant']]);
  assert.equal(core.nodes.find(n => n.name === 'Ler Fila WhatsApp').parameters.jsCode, read('n8n/code/whatsapp_recover_core.js').replace(/\r\n/g, '\n'));
  assert.deepEqual(sourcesOf('CORE | Motor conversacional único | Fase'),
    ['CORE - Roteador Dinâmico SaaS', 'CORE | Executar EXT NORIA', 'CORE | Executar EXT Núbia']);
  for (const gone of ['CORE | É I&C Salon?', 'CORE | Preparar fase I&C Salon', 'CORE | Executar motor I&C Salon']) {
    assert.ok(!core.nodes.some(n => n.name === gone), gone);
  }
  const expression = core.nodes.find(n => n.name === 'CORE | Motor conversacional único').parameters.workflowId.value;
  const choose = new Function('$json', 'return ' + expression.slice(3, -2));
  const salon = { tenant_id: '76aff8a0-0466-42b9-a80d-db186ff3d8bd', tenant_slug: 'ic_salon', instance: 'ic_saloon' };
  assert.equal(choose(salon), SALON_ID);
  assert.equal(choose({ ...salon, recovered: true }), SALON_ID);
  for (const change of [{ tenant_id: 'outro' }, { tenant_slug: 'noria' }, { instance: 'outra' }]) {
    assert.equal(choose({ ...salon, ...change }), ENGINE_ID);
  }
});

test('o estado compartilhado do Gemini (circuito e concorrência) existe somente no workflow do motor', () => {
  for (const key of ['gemini_circuit_open_until', 'gemini_active_calls', 'gemini_probe_id']) {
    assert.ok(engineCode.includes(key), key);
    assert.ok(!core.nodes.some(n => (n.parameters?.jsCode || '').includes(key)), key + ' no roteador');
  }
});

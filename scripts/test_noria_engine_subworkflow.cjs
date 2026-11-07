// Rodar: node --test scripts/test_noria_engine_subworkflow.cjs
// O motor conversacional vive num sub-workflow próprio: o CORE (webhook, fila e follow-ups) não carrega
// mais cópias do motor em cada execução; só os turnos reais chamam o motor, uma vez por fase.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const CORE_FILE = 'n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json';
const ENGINE_FILE = 'n8n/workflows/NORIA CORE _ Motor conversacional.json';
const ENGINE_NODE = 'CORE | Motor conversacional';
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
const engineCode = engine.nodes.find(n => n.name === ENGINE_NODE)?.parameters?.jsCode || '';

test('o CORE não embute o motor: nenhum nó Code passa de 100 KB e o arquivo cai abaixo de 600 KB', () => {
  const big = core.nodes.filter(n => (n.parameters?.jsCode || '').length > 100 * 1024).map(n => n.name);
  assert.deepEqual(big, []);
  assert.ok(JSON.stringify(core).length < 600 * 1024, 'CORE com ' + Math.round(JSON.stringify(core).length / 1024) + ' KB');
});

test('o sub-workflow do motor tem uma única cópia da fonte canônica, precedida só pela leitura da fase', () => {
  const trigger = engine.nodes.find(n => n.type === 'n8n-nodes-base.executeWorkflowTrigger');
  assert.ok(trigger, 'gatilho de sub-workflow');
  assert.equal(trigger.parameters.inputSource, 'passthrough');
  assert.deepEqual(engine.connections[trigger.name].main, [[{ node: ENGINE_NODE, type: 'main', index: 0 }]]);
  const node = engine.nodes.find(n => n.name === ENGINE_NODE);
  assert.equal(node.type, 'n8n-nodes-base.code');
  assert.equal(node.parameters.mode, 'runOnceForEachItem');
  assert.ok(engineCode.endsWith(read('n8n/sources/noria_core.js')), 'termina com a fonte canônica, sem alterações');
  assert.equal(engine.nodes.filter(n => n.type === 'n8n-nodes-base.code').length, 1);
  assert.equal(engine.settings.saveDataSuccessExecution, 'none');
  new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', engineCode);
});

test('cada fase do CORE chama o mesmo sub-workflow, depois de um nó que marca a fase', () => {
  const ids = new Set();
  for (const [name, phase] of Object.entries(PHASES)) {
    const call = core.nodes.find(n => n.name === name);
    assert.equal(call.type, 'n8n-nodes-base.executeWorkflow', name);
    assert.equal(call.parameters.mode, 'each');
    assert.equal(call.parameters.options.waitForSubWorkflow, true);
    ids.add(call.parameters.workflowId.value);

    const marker = core.nodes.find(n => n.name === name + ' | Fase');
    assert.equal(marker.type, 'n8n-nodes-base.code');
    assert.equal(marker.parameters.mode, 'runOnceForEachItem');
    assert.ok(marker.parameters.jsCode.length < 1024);
    const item = { json: { tenant_slug: 't', remoteJid: 'r' }, binary: { media_file: { id: 'b' } } };
    const out = new Function('$json', '$input', marker.parameters.jsCode)(item.json, { item });
    assert.deepEqual(out.json, { tenant_slug: 't', remoteJid: 'r', noria_engine_phase: phase });
    assert.equal(out.binary, item.binary, 'o binário (áudio) segue para o motor');

    // Toda entrada que ia para o nó do motor agora passa pelo marcador de fase.
    const sources = Object.entries(core.connections)
      .filter(([, entry]) => (entry.main || []).flat().some(c => c.node === name))
      .map(([from]) => from);
    assert.deepEqual(sources, [name + ' | Fase'], name);
  }
  assert.equal(ids.size, 1, 'um único sub-workflow de motor');
});

test('a fase chega ao motor e sai do item antes de ele ler a entrada; fase ausente falha fechado', async () => {
  const prelude = engineCode.slice(0, engineCode.length - read('n8n/sources/noria_core.js').length);
  const probe = prelude + '\nreturn { phase: NORIA_NODE_PHASE, json: { ...$json } };';
  for (const phase of Object.values(PHASES)) {
    const out = await new AsyncFunction('$json', probe)({ noria_engine_phase: phase, tenant_slug: 't' });
    assert.equal(out.phase, phase);
    assert.deepEqual(out.json, { tenant_slug: 't' });
  }
  await assert.rejects(new AsyncFunction('$json', probe)({ tenant_slug: 't' }), /NORIA_ENGINE_PHASE_REQUIRED/);
  await assert.rejects(new AsyncFunction('$json', probe)({ noria_engine_phase: 'outra' }), /NORIA_ENGINE_PHASE_REQUIRED/);
});

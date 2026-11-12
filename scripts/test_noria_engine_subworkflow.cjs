const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const parentFile = 'n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json';
const parent = JSON.parse(read(parentFile));
const ext = JSON.parse(read('n8n/workflows/NORIA CORE _ Motor conversacional.json'));
const source = read('n8n/sources/noria_core.js');
const phases = {
  'CORE | Motor conversacional único': 'single',
  'CORE | Preparar resposta': 'prepare',
  'CORE | Finalizar resposta': 'finalize',
  'CORE | Serviços | Preparar resposta': 'prepare',
  'CORE | Serviços | Verificar disponibilidade': 'availability',
  'CORE | Serviços | Finalizar resposta': 'finalize',
};
const find = name => parent.nodes.find(node => node.name === name);
const links = name => (parent.connections[name]?.main || []).map(branch => branch.map(connection => connection.node));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

test('cada fase usa a fonte canônica dentro do CORE pai e ignora fase forjada no item', async () => {
  assert.equal(parent.name, 'NORIA CORE | Roteador WhatsApp, Comandos e Follow-ups');
  for (const [name, phase] of Object.entries(phases)) {
    const node = find(name);
    const prelude = `const NORIA_NODE_PHASE = '${phase}';\n`;
    assert.equal(node?.type, 'n8n-nodes-base.code', name);
    assert.equal(node.parameters.mode, 'runOnceForEachItem');
    assert.equal(node.parameters.jsCode, prelude + source);
    const payload = { noria_engine_phase: 'fase-falsa', noria_terminal: true };
    const terminal = await new AsyncFunction('$json', node.parameters.jsCode).call({ helpers: {} }, payload);
    assert.deepEqual(terminal, { json: payload });
    assert.equal(await new AsyncFunction('$json', prelude + 'return NORIA_NODE_PHASE;')(payload), phase);
    assert.ok(!find(name + ' | Fase'), 'o marcador anterior foi removido');
  }
});

test('o ID reaproveitado é chamado apenas no ramo da EXT NORIA', () => {
  const calls = parent.nodes.filter(node => node.type === 'n8n-nodes-base.executeWorkflow'
    && JSON.stringify(node.parameters.workflowId || {}).includes('mlKNPv862H2g3Gap'));
  assert.deepEqual(calls.map(node => node.name), ['CORE | Executar EXT NORIA']);
  assert.equal(calls[0].parameters.options.waitForSubWorkflow, true);
  assert.deepEqual(links('CORE - Resolver extensão do tenant'), [['CORE | É tenant NORIA?']]);
  assert.deepEqual(links('CORE | É tenant NORIA?'), [['CORE | Executar EXT NORIA'], ['CORE | Serviços | Núbia v2?']]);
  assert.deepEqual(links('CORE | Executar EXT NORIA'), [['CORE | É I&C Salon?']]);
  assert.equal(ext.name, 'NORIA EXT | Política NORIA');
  const [trigger, policy] = ext.nodes;
  assert.equal(trigger.type, 'n8n-nodes-base.executeWorkflowTrigger');
  assert.equal(trigger.parameters.inputSource, 'passthrough');
  assert.deepEqual(ext.connections[trigger.name].main, [[{ node: policy.name, type: 'main', index: 0 }]]);
  assert.equal(policy.parameters.jsCode, read('n8n/sources/noria_extension.js'));
  assert.equal(ext.settings.saveDataSuccessExecution, 'none');
});

test('entrada e recuperação convergem na rota isolada do Salon com fase e áudio', () => {
  assert.deepEqual(links('Recuperar Fila WhatsApp'), [['Ler Fila WhatsApp']]);
  assert.deepEqual(links('Ler Fila WhatsApp'), [['CORE - Resolver extensão do tenant']]);
  assert.equal(find('Ler Fila WhatsApp').parameters.jsCode, read('n8n/code/whatsapp_recover_core.js').replace(/\r\n/g, '\n'));
  assert.deepEqual(links('CORE | É I&C Salon?'), [['CORE | Preparar fase I&C Salon'], ['CORE | Motor conversacional único']]);
  const marker = find('CORE | Preparar fase I&C Salon');
  const item = { json: { tenant_id: 't' }, binary: { media_file: { id: 'audio' } } };
  const result = new Function('$json', '$input', marker.parameters.jsCode)(item.json, { item });
  assert.equal(result.binary, item.binary);
  assert.equal(result.json.noria_engine_phase, 'single');
  assert.deepEqual(links(marker.name), [['CORE | Executar motor I&C Salon']]);
  assert.equal(find('CORE | Executar motor I&C Salon').parameters.workflowId.value, 'yxdKP0PeskDMUFSo');
});

test('o export do pai contém apenas as seis projeções intencionais do motor', () => {
  const projected = parent.nodes.filter(node => node.parameters?.jsCode?.endsWith(source));
  assert.deepEqual(projected.map(node => node.name).sort(), Object.keys(phases).sort());
  assert.ok(Buffer.byteLength(read(parentFile)) < 7 * 1024 * 1024, 'crescimento inesperado do export local do CORE pai');
});

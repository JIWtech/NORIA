const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const wf = file => JSON.parse(read('n8n/workflows/' + file));
const parent = wf('NORIA-CORE-Roteador-WhatsApp-Comandos-e-Follow-ups--3N5oN6sxtir9lFrA.json');
const engine = wf('NORIA-CORE-Motor-Conversacional-Compartilhado--mlKNPv862H2g3Gap.json');
const salon = wf('NORIA-EXT-IC-Salon-Atendimento-e-Agendamentos--yxdKP0PeskDMUFSo.json');
const ext = wf('NORIA-EXT-NORIA-Politica--sLxNG9o2falquchd.json');
const source = read('n8n/sources/noria_core.js');
const ENGINE_ID = 'mlKNPv862H2g3Gap';
const SALON_ID = 'yxdKP0PeskDMUFSo';
const NORIA_EXT_ID = 'sLxNG9o2falquchd';
const SALON_TENANT = '76aff8a0-0466-42b9-a80d-db186ff3d8bd';
const HEADER_START = "const NORIA_NODE_PHASE = String($json.noria_engine_phase || '');";
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
const stripMetadata = code => code.replace(/const coreBuildMetadata = \{[\s\S]*?\};/, '');
const engineCode = engine.nodes.find(node => node.name === 'CORE | Motor conversacional').parameters.jsCode;
const salonCode = salon.nodes.find(node => node.name === 'CORE | Motor conversacional').parameters.jsCode;
const resolveRoute = json => {
  const expression = find('CORE | Motor conversacional único').parameters.workflowId.value;
  return new Function('$json', 'return ' + expression.replace(/^=\{\{/, '(').replace(/\}\}$/, ')'))(json);
};

test('cada fase do pai é um marcador "| Fase" seguido de executeWorkflow que aguarda o sub-workflow', () => {
  assert.equal(parent.name, 'NORIA CORE | Roteador WhatsApp, Comandos e Follow-ups');
  for (const [name, phase] of Object.entries(phases)) {
    const call = find(name);
    const marker = find(name + ' | Fase');
    assert.equal(call?.type, 'n8n-nodes-base.executeWorkflow', name);
    assert.equal(call.parameters.options.waitForSubWorkflow, true, name);
    assert.equal(call.parameters.jsCode, undefined, 'nenhum código do motor no pai: ' + name);
    if (name !== 'CORE | Motor conversacional único') assert.equal(call.parameters.workflowId.value, ENGINE_ID, name);
    assert.equal(marker?.type, 'n8n-nodes-base.code', name);
    assert.equal(marker.parameters.mode, 'runOnceForEachItem');
    assert.equal(marker.parameters.jsCode,
      `return { json: { ...$json, noria_engine_phase: '${phase}', noria_engine_contract: 'noria_engine_phase_v1' }, binary: $input.item.binary };`);
    assert.deepEqual(links(marker.name), [[name]]);
    const item = { json: { tenant_id: 't', noria_engine_phase: 'forjada' }, binary: { media_file: { id: 'audio' } } };
    const out = new Function('$json', '$input', marker.parameters.jsCode)(item.json, { item });
    assert.equal(out.json.noria_engine_phase, phase, 'o marcador sobrescreve fase forjada');
    assert.equal(out.json.noria_engine_contract, 'noria_engine_phase_v1');
    assert.equal(out.json.tenant_id, 't');
    assert.equal(out.binary, item.binary);
  }
});

test('nenhum nó de código do pai carrega o motor; ele vive só no sub-workflow compartilhado e no Salon', () => {
  const carriers = parent.nodes.filter(node => {
    const code = node.parameters?.jsCode || '';
    return code.includes('const noriaPhase = ') || code.length > 500000;
  });
  assert.deepEqual(carriers.map(node => node.name), []);
  for (const gone of ['CORE | É I&C Salon?', 'CORE | Preparar fase I&C Salon', 'CORE | Executar motor I&C Salon']) {
    assert.equal(find(gone), undefined, 'nó antigo removido: ' + gone);
  }
  assert.ok(Buffer.byteLength(JSON.stringify(parent)) < 7 * 1024 * 1024, 'crescimento inesperado do export do CORE pai');
  assert.ok(stripMetadata(engineCode).endsWith(stripMetadata(source)), 'o motor compartilhado termina na fonte canônica');
  assert.ok(engineCode.startsWith(HEADER_START));
  assert.ok(salonCode.includes('const noriaPhase = '), 'o Salon também carrega o motor');
});

test('o motor compartilhado exige fase e contrato, consome-os do item e preserva turno terminal', async () => {
  assert.equal(engine.name, 'NORIA CORE | Motor Conversacional Compartilhado');
  assert.equal(engine.nodes[0].type, 'n8n-nodes-base.executeWorkflowTrigger');
  assert.deepEqual(engine.connections[engine.nodes[0].name].main,
    [[{ node: 'CORE | Motor conversacional', type: 'main', index: 0 }]]);
  const run = payload => new AsyncFunction('$json', engineCode).call({ helpers: {} }, payload);
  const contract = 'noria_engine_phase_v1';
  await assert.rejects(run({ noria_terminal: true }), /NORIA_ENGINE_PHASE_REQUIRED/);
  await assert.rejects(run({ noria_engine_phase: 'fase-falsa', noria_engine_contract: contract }), /NORIA_ENGINE_PHASE_REQUIRED/);
  await assert.rejects(run({ noria_engine_phase: 'single' }), /NORIA_ENGINE_CONTRACT_MISMATCH/);
  await assert.rejects(run({ noria_engine_phase: 'single', noria_engine_contract: 'outro' }), /NORIA_ENGINE_CONTRACT_MISMATCH/);
  for (const phase of ['single', 'prepare', 'availability', 'finalize']) {
    const payload = { noria_engine_phase: phase, noria_engine_contract: contract, noria_terminal: true, tenant_id: 't' };
    assert.deepEqual(await run(payload), { json: { noria_terminal: true, tenant_id: 't' } }, phase);
  }
});

test('a rota do motor único é decidida por tenant, slug e instância: só o Salon usa o seu sub-workflow', () => {
  const node = find('CORE | Motor conversacional único');
  assert.equal(node.type, 'n8n-nodes-base.executeWorkflow');
  assert.equal(node.parameters.mode, 'each');
  assert.equal(resolveRoute({ tenant_id: SALON_TENANT, tenant_slug: 'ic_salon', instance: 'ic_saloon' }), SALON_ID);
  const outros = [
    { tenant_id: 'outro', tenant_slug: 'ic_salon', instance: 'ic_saloon' },
    { tenant_id: SALON_TENANT, tenant_slug: 'outro', instance: 'ic_saloon' },
    { tenant_id: SALON_TENANT, tenant_slug: 'ic_salon', instance: 'outra' },
    { tenant_id: SALON_TENANT },
    {},
  ];
  for (const json of outros) assert.equal(resolveRoute(json), ENGINE_ID, JSON.stringify(json));
  assert.notEqual(SALON_ID, ENGINE_ID);
});

test('a EXT NORIA é chamada só no ramo NORIA e converge no marcador da fase única', () => {
  const calls = parent.nodes.filter(node => node.type === 'n8n-nodes-base.executeWorkflow'
    && JSON.stringify(node.parameters.workflowId || {}).includes(NORIA_EXT_ID));
  assert.deepEqual(calls.map(node => node.name), ['CORE | Executar EXT NORIA']);
  assert.equal(calls[0].parameters.options.waitForSubWorkflow, true);
  assert.deepEqual(links('CORE - Resolver extensão do tenant'), [['CORE | É tenant NORIA?']]);
  assert.deepEqual(links('CORE | É tenant NORIA?'), [['CORE | Executar EXT NORIA'], ['CORE | Serviços | Núbia v2?']]);
  assert.deepEqual(links('CORE | Executar EXT NORIA'), [['CORE | Motor conversacional único | Fase']]);
  assert.equal(ext.name, 'NORIA EXT | NORIA | Política');
  const [trigger, policy] = ext.nodes;
  assert.equal(trigger.type, 'n8n-nodes-base.executeWorkflowTrigger');
  assert.equal(trigger.parameters.inputSource, 'passthrough');
  assert.deepEqual(ext.connections[trigger.name].main, [[{ node: policy.name, type: 'main', index: 0 }]]);
  assert.equal(policy.parameters.jsCode, read('n8n/sources/noria_extension.js'));
  assert.equal(ext.settings.executionOrder, 'v1');
  assert.equal(ext.settings.saveDataSuccessExecution, undefined, 'export publicado usa o padrão do n8n para salvar execuções');
});

test('entrada e recuperação convergem no resolvedor; o marcador preserva áudio e leva ao motor único', () => {
  assert.deepEqual(links('Recuperar Fila WhatsApp'), [['Ler Fila WhatsApp']]);
  assert.deepEqual(links('Ler Fila WhatsApp'), [['CORE - Resolver extensão do tenant']]);
  assert.equal(find('Ler Fila WhatsApp').parameters.jsCode, read('n8n/code/whatsapp_recover_core.js').replace(/\r\n/g, '\n'));
  assert.deepEqual(links('CORE | Motor conversacional único | Fase'), [['CORE | Motor conversacional único']]);
  assert.match(find('CORE | Motor conversacional único | Fase').parameters.jsCode, /binary: \$input\.item\.binary/);
});

test('o Salon executa o motor com a mesma proteção de fase e contrato e o adaptador do tenant', () => {
  assert.equal(salon.nodes[0].type, 'n8n-nodes-base.executeWorkflowTrigger');
  assert.ok(salonCode.includes(HEADER_START));
  assert.match(salonCode, /NORIA_ENGINE_PHASE_REQUIRED/);
  assert.match(salonCode, /NORIA_ENGINE_CONTRACT_MISMATCH/);
  assert.notEqual(salonCode, engineCode, 'o Salon carrega o adaptador do tenant');
});

// Rodar: node --test scripts/test_noria_nubia_route.cjs
// A Núbia (v1) é atendida pela sua EXT publicada e pelo motor em fase única. Um turno da Núbia nunca
// pode ser consumido como "evento ignorado": isso apaga a mensagem da fila sem resposta ao cliente.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const core = JSON.parse(fs.readFileSync(path.join(root,
  'n8n/workflows/NORIA-CORE-Roteador-WhatsApp-Comandos-e-Follow-ups--3N5oN6sxtir9lFrA.json'), 'utf8'));
const NUBIA_EXT_ID = 'vCDXJLqIBCZJRTVv';
const gate = 'CORE - É Núbia?';
const execute = 'CORE | Executar EXT Núbia';
const branches = name => (core.connections[name]?.main || []).map(b => b.map(c => c.node));

test('o desvio da Núbia chama a EXT Núbia v1 e segue para o motor em fase única', () => {
  assert.deepEqual(branches(gate), [[execute], ['CORE - É Gênesis?']]);
  const node = core.nodes.find(n => n.name === execute);
  assert.equal(node.type, 'n8n-nodes-base.executeWorkflow');
  assert.equal(node.parameters.workflowId.value, NUBIA_EXT_ID);
  assert.equal(node.parameters.mode, 'each');
  assert.equal(node.parameters.options.waitForSubWorkflow, true);
  assert.deepEqual(branches(execute), [['CORE | Motor conversacional único | Fase']]);
});

test('nenhum turno de fila termina em "evento ignorado"; só eventos de webhook descartados chegam lá', () => {
  const into = Object.entries(core.connections)
    .filter(([, entry]) => (entry.main || []).flat().some(c => c.node === 'Responder Evento Ignorado'))
    .map(([from]) => from);
  assert.deepEqual(into, ['Mensagem valida?']);
  assert.ok(!core.nodes.some(n => n.name === 'Executar EXT Nubia (PREENCHER ID)'), 'nome antigo com placeholder removido');
});

test('a EXT Núbia v1 exige exatamente o que o roteador do CORE entrega', () => {
  const router = fs.readFileSync(path.join(root, 'n8n/sources/noria_router_core.js'), 'utf8');
  assert.match(router, /clinica_nubia_oficial: 'nubia'/);
  const ext = JSON.parse(fs.readFileSync(path.join(root, 'n8n/workflows/NORIA-EXT-Nubia-NB-Bronze-Politica-de-Atendimento--vCDXJLqIBCZJRTVv.json'), 'utf8'));
  const guard = ext.nodes.find(n => n.name === 'Validar identidade e capacidade do tenant').parameters.jsCode;
  assert.match(guard, /expectedExtension = 'nubia'/);
  assert.match(guard, /noria_contract_version \|\| ''\) !== '1\.0'/);
});

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { applySalonRoute, configuredSalonId, singleEngine } = require('./conversation_route.cjs');

test('entrada e recuperação compartilham o destino e a identidade completa limita o desvio ao salão', () => {
  const salon = { tenant_id: '76aff8a0-0466-42b9-a80d-db186ff3d8bd', tenant_slug: 'ic_salon', instance: 'ic_saloon' };
  const target = {
    name: singleEngine, type: 'n8n-nodes-base.executeWorkflow',
    parameters: { mode: 'each', workflowId: { __rl: true, mode: 'id', value: 'shared', cachedResultUrl: '/workflow/shared' },
      options: { waitForSubWorkflow: true } },
  };
  const otherNode = { name: 'CORE | Preparar resposta', parameters: { workflowId: { value: 'shared' } } };
  const workflow = { nodes: [target, otherNode], connections: { teste: { main: [[]] } } };
  const before = structuredClone(workflow);
  applySalonRoute(workflow, 'shared', 'salon');
  const expression = target.parameters.workflowId.value;
  const choose = new Function('$json', 'return ' + expression.slice(3, -2));
  assert.equal(choose(salon), 'salon');
  assert.equal(choose({ ...salon, recovered: true }), 'salon');
  for (const change of [{ tenant_id: 'other' }, { tenant_slug: 'royal_4x4' }, { instance: 'other' }]) {
    assert.equal(choose({ ...salon, ...change }), 'shared');
  }
  assert.equal(configuredSalonId(workflow), 'salon');
  const once = structuredClone(workflow);
  applySalonRoute(workflow, 'shared', 'salon');
  assert.deepEqual(workflow, once);
  assert.deepEqual(workflow.nodes[1], before.nodes[1]);
  assert.deepEqual(workflow.connections, before.connections);
});

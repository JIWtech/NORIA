import test from 'node:test';
import assert from 'node:assert/strict';
import { createTeamAgentManagement } from '../../src/services/agents/teamAgentManagement.js';

test('mutações de agentes resolvem o tenant e restringem alterações ao ID correspondente', async () => {
  const calls = [];
  const client = { from(table) {
    const q = {
      select() { return q; }, limit() { return q; }, eq(key, value) { calls.push([table, key, value]); return q; },
      maybeSingle: async () => ({ data: { id: 'tenant-a-id' }, error: null }),
      single: async () => ({ data: { id: 'agent-a' }, error: null }),
      insert(value) { calls.push([table, 'insert', value]); return q; },
      update(value) { calls.push([table, 'update', value]); return q; },
      delete() { calls.push([table, 'delete']); return q; },
    }; return q;
  } };
  const api = createTeamAgentManagement({ getClient: () => client });
  await api.saveTeamAgent('tenant-a', { name: 'Ana' });
  await api.updateTeamAgentStatus('agent-a', 'offline', 'tenant-a');
  await api.removeTeamAgent('agent-a', 'tenant-a');
  assert.equal(calls.find(c => c[1] === 'insert')[2][0].tenant_id, 'tenant-a-id');
  assert.equal(calls.filter(c => c[0] === 'team_agents' && c[1] === 'tenant_id' && c[2] === 'tenant-a-id').length, 2);
});

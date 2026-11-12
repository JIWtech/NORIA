import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSalesLeadIndex,
  loadSalesLeads,
  resolveSalesControlMode,
} from '../../src/services/leads/leadDataReads.js';

function fakeSupabase(response) {
  const calls = [];
  const chain = {
    select(value) { calls.push(['select', value]); return chain; },
    eq(column, value) { calls.push(['eq', column, value]); return chain; },
    order(column, options) { calls.push(['order', column, options]); return chain; },
    range(start, end) {
      calls.push(['range', start, end]);
      return Promise.resolve({ ...response, data: response.data?.slice(start, end + 1) });
    },
    then(resolve, reject) { return Promise.resolve(response).then(resolve, reject); },
  };
  return { calls, from(table) { calls.push(['from', table]); return chain; } };
}

test('lead reads retain tenant isolation and newest-first ordering', async () => {
  const client = fakeSupabase({ data: [{ id: 'lead-a', tenant_id: 'tenant-a', chat_id: 'chat-a' }], error: null });
  const leads = await loadSalesLeads(client, 'tenant-a');
  assert.deepEqual(leads, [{ id: 'lead-a', tenant_id: 'tenant-a', chat_id: 'chat-a' }]);
  assert.deepEqual(client.calls.find((call) => call[0] === 'from'), ['from', 'sales_leads']);
  assert.ok(client.calls.some((call) => call.join('|') === 'eq|tenant_id|tenant-a'));
  assert.deepEqual(client.calls.find((call) => call[0] === 'order'), ['order', 'updated_at', { ascending: false }]);
});

test('lead reads collect subsequent pages in the same tenant', async () => {
  const data = Array.from({ length: 501 }, (_, index) => ({ id: `lead-${index}`, tenant_id: 'tenant-a' }));
  const client = fakeSupabase({ data, error: null });
  assert.deepEqual(await loadSalesLeads(client, 'tenant-a'), data);
  assert.deepEqual(client.calls.filter(([name]) => name === 'range'), [['range', 0, 499], ['range', 500, 999]]);
  assert.equal(client.calls.filter(([name, key, value]) => name === 'eq' && key === 'tenant_id' && value === 'tenant-a').length, 2);
});

test('lead reads and indexing fail closed without cross-tenant or stale duplicates', async () => {
  const failing = fakeSupabase({ data: null, error: { message: 'denied' } });
  assert.deepEqual(await loadSalesLeads(failing, 'tenant-b'), []);
  const keyFor = (channel, chat) => `${channel}:${chat}`;
  const newer = { id: 'new', tenant_id: 'tenant-a', channel_type: 'whatsapp', chat_id: 'chat-a', updated_at: '2026-10-10T12:00:00Z' };
  const index = buildSalesLeadIndex([
    { id: 'old', tenant_id: 'tenant-a', channel_type: 'whatsapp', chat_id: 'chat-a', updated_at: '2026-10-10T11:00:00Z' },
    newer,
    { id: 'missing-chat', tenant_id: 'tenant-b' },
  ], keyFor, (candidate, current) => Date.parse(candidate.updated_at) > Date.parse(current.updated_at));
  assert.equal(index.size, 1);
  assert.equal(index.get('whatsapp:chat-a').id, 'new');
});

test('lead control mode preserves human, AI, and neutral commercial states', () => {
  assert.equal(resolveSalesControlMode({ stage_key: 'sales_human', ai_locked: false }), 'human');
  assert.equal(resolveSalesControlMode({ stage_key: 'sales_hot', ai_locked: false }), 'ai');
  assert.equal(resolveSalesControlMode({ stage_key: 'sales_closed', ai_locked: false }), 'none');
});

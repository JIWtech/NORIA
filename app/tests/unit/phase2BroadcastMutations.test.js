import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createBroadcastOperations } from '../../src/services/broadcasts/broadcastOperations.js';

test('fachada de mutações aceita slug explícito e rejeita contexto ausente', async () => {
  const source = fs.readFileSync(new URL('../../src/dataService.js', import.meta.url), 'utf8');
  const fragment = source.slice(source.indexOf('const broadcastOperations ='), source.indexOf('const teamAgentManagement =')).replaceAll('export ', '');
  const filters = [];
  const q = { update() { return q; }, select() { return q; }, eq(k, v) { filters.push([k, v]); return q; }, async single() { return { data: {}, error: null }; }, then(resolve) { resolve({ data: [], error: null }); } };
  const api = vm.runInNewContext(`${fragment}\n({ updateBroadcastCampaign, updateBroadcastRecipient })`, {
    createBroadcastOperations, getClient: () => ({ from: () => q }), loadTenant: async () => ({ id: 'tenant-a' }), currentUserId: async () => null,
  });
  await api.updateBroadcastCampaign('c', {}, 'a');
  await api.updateBroadcastRecipient('c', 'chat', {}, 'a');
  assert.equal(filters.filter(([key, value]) => key === 'tenant_id' && value === 'tenant-a').length, 2);
  await assert.rejects(() => api.updateBroadcastCampaign('c', {}), /Tenant/);
  await assert.rejects(() => api.updateBroadcastRecipient('c', 'chat', {}), /Tenant/);
});

test('consultas e alterações de campanha exigem tenant ativo e filtram seu ID', async () => {
  const calls = [];
  const client = { from(table) {
    const q = { select() { return q; }, update() { return q; }, eq(k, v) { calls.push([table, k, v]); return q; }, single: async () => ({ data: {}, error: null }), then(resolve) { resolve({ data: [], error: null }); } };
    return q;
  } };
  const opts = { getClient: () => client, loadTenant: async () => ({ id: 'tenant-a' }) };
  const unscoped = createBroadcastOperations(opts);
  await assert.rejects(() => unscoped.updateBroadcastCampaign('c', {}), /Tenant/);
  const scoped = createBroadcastOperations({ ...opts, getTenantSlug: () => 'a' });
  await scoped.updateBroadcastCampaign('c', {});
  await scoped.updateBroadcastRecipient('c', 'chat', {});
  await scoped.getBroadcastCampaignRecipients('c');
  assert.equal(calls.filter(c => c[1] === 'tenant_id' && c[2] === 'tenant-a').length, 3);
});

test('preflight impede RPC para campanha de outro tenant', async () => {
  let rpcCalls = 0;
  const filters = [];
  const q = { select() { return q; }, eq(k, v) { filters.push([k, v]); return q; }, async maybeSingle() { return { data: null, error: null }; } };
  const api = createBroadcastOperations({ getClient: () => ({ from: () => q, rpc: async () => { rpcCalls++; } }), loadTenant: async () => ({ id: 'tenant-a' }), getTenantSlug: () => 'a' });
  await assert.rejects(() => api.controlBroadcastCampaign('campaign-b', 'pause'), /tenant ativo/);
  assert.deepEqual(filters, [['id', 'campaign-b'], ['tenant_id', 'tenant-a']]);
  assert.equal(rpcCalls, 0);
});

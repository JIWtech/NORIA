import test from 'node:test';
import assert from 'node:assert/strict';
import { realtimeRefreshTargets, selectPartialRefresh, mergeCampaignPatch } from '../../src/services/timeline/realtimeRefreshTargets.js';

test('somente campanhas usam recarga parcial; eventos de outro tenant são ignorados', () => {
  assert.deepEqual(realtimeRefreshTargets({ table: 'broadcast_campaigns', new: { tenant_id: 'a' } }, 'a'), ['broadcastCampaigns']);
  assert.deepEqual(realtimeRefreshTargets({ table: 'broadcast_campaigns', old: { tenant_id: 'b' } }, 'a'), []);
  assert.deepEqual(realtimeRefreshTargets({ table: 'broadcast_campaigns', old: { id: 'x' } }, 'a'), ['broadcastCampaigns']);
  assert.equal(realtimeRefreshTargets({ table: 'appointments' }, 'a'), undefined);
  assert.equal(realtimeRefreshTargets({ table: 'sales_leads' }, 'a'), undefined);
  assert.deepEqual(realtimeRefreshTargets({ table: 'appointments', new: { tenant_id: 'b' } }, 'a'), []);
  assert.deepEqual(realtimeRefreshTargets({ table: 'sales_leads', old: { tenant_id: 'b' } }, 'a'), []);
});

test('carga parcial só é selecionada para campanhas após carga completa do escopo', () => {
  const current = { tenantId: 'a', source: 'supabase' };
  assert.deepEqual(selectPartialRefresh(['broadcastCampaigns'], current, 'scope-a', 'scope-a'), ['broadcastCampaigns']);
  for (const resources of [undefined, [], ['appointments'], ['broadcastCampaigns', 'appointments'], ['broadcastCampaigns', 'broadcastCampaigns']]) {
    assert.equal(selectPartialRefresh(resources, current, 'scope-a', 'scope-a'), undefined);
  }
  assert.equal(selectPartialRefresh(['broadcastCampaigns'], current, '', 'scope-a'), undefined);
  assert.equal(selectPartialRefresh(['broadcastCampaigns'], { ...current, tenantId: null }, 'scope-a', 'scope-a'), undefined);
  assert.equal(selectPartialRefresh(['broadcastCampaigns'], { ...current, source: 'mock' }, 'scope-a', 'scope-a'), undefined);
});

test('patch de campanhas preserva mensagens recentes, mídia e kanban e rejeita tenant divergente', () => {
  const previous = { tenantId: 'a', conversations: [{ messages: [{ media: { loadState: 'resolving' } }] }], kanbanColumns: [{ id: 'local' }], broadcastCampaigns: [] };
  const patch = { tenantId: 'a', broadcastCampaigns: [{ id: 'campaign' }], conversations: [] };
  const merged = mergeCampaignPatch(previous, patch, 'a');
  assert.equal(merged.conversations, previous.conversations);
  assert.equal(merged.kanbanColumns, previous.kanbanColumns);
  assert.deepEqual(merged.broadcastCampaigns, [{ id: 'campaign' }]);
  assert.equal(mergeCampaignPatch(previous, { ...patch, tenantId: 'b' }, 'a'), null);
  assert.equal(mergeCampaignPatch({ ...previous, tenantId: 'b' }, patch, 'a'), null);
  assert.equal(mergeCampaignPatch(previous, { tenantId: 'a' }, 'a'), null);
});


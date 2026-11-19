import test from 'node:test';
import assert from 'node:assert/strict';
import * as realtimeRefresh from '../../src/services/timeline/realtimeRefresh.js';

test('refresh coordinator skips a fresh visibility refresh and coalesces an in-flight refresh for the same tenant', async () => {
  assert.equal(typeof realtimeRefresh.createRefreshCoordinator, 'function');
  assert.equal(realtimeRefresh.VISIBILITY_REFRESH_STALE_AFTER_MS, 15 * 60 * 1000);

  let now = 1_000;
  const coordinator = realtimeRefresh.createRefreshCoordinator({
    now: () => now,
  });
  coordinator.markFresh('tenant-a');

  assert.equal(coordinator.shouldRefreshOnVisibility('tenant-a'), false);
  now += 5 * 60 * 1000;
  assert.equal(coordinator.shouldRefreshOnVisibility('tenant-a'), false);
  now += 10 * 60 * 1000;
  assert.equal(coordinator.shouldRefreshOnVisibility('tenant-a'), true);

  let resolveLoad;
  let calls = 0;
  const load = () => {
    calls += 1;
    return new Promise((resolve) => { resolveLoad = resolve; });
  };
  const first = coordinator.run('tenant-a', load);
  const second = coordinator.run('tenant-a', load);

  assert.notEqual(first, second, 'pedido no meio da recarga ganha uma recarga extra ao final');
  assert.equal(calls, 1);
  resolveLoad();
  await first;
  await new Promise((resolve) => setImmediate(resolve));
  resolveLoad();
  await second;
  assert.equal(calls, 2);
  assert.equal(coordinator.shouldRefreshOnVisibility('tenant-a'), false);
});

test('pedido de recarga durante outra recarga roda de novo ao final (não usa dados lidos antes da mudança)', async () => {
  const coordinator = realtimeRefresh.createRefreshCoordinator({ now: () => 1_000 });
  const resolvers = [];
  let calls = 0;
  const load = () => { calls += 1; return new Promise((resolve) => { resolvers.push(resolve); }); };
  const first = coordinator.run('tenant-a', load);
  // Agendamento cancelado enquanto a primeira recarga ainda lê o banco: dois avisos seguidos viram uma única recarga extra.
  const second = coordinator.run('tenant-a', load);
  const third = coordinator.run('tenant-a', load);
  assert.equal(second, third);
  assert.equal(calls, 1);
  resolvers[0]('primeira');
  assert.equal(await first, 'primeira');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2, 'a recarga pedida no meio roda depois da primeira');
  resolvers[1]('depois-da-mudanca');
  assert.equal(await second, 'depois-da-mudanca');
  assert.equal(calls, 2);
});

test('pedidos concorrentes unem recursos e recarga completa prevalece', async () => {
  const coordinator = realtimeRefresh.createRefreshCoordinator();
  const calls = [];
  let finish;
  const load = (resources) => {
    calls.push(resources);
    if (calls.length === 1) return new Promise((resolve) => { finish = resolve; });
    return true;
  };
  const first = coordinator.run('a', load, ['appointments']);
  const second = coordinator.run('a', load, ['appointments']);
  const third = coordinator.run('a', load, ['broadcastCampaigns']);
  finish(true);
  await Promise.all([first, second, third]);
  assert.deepEqual(calls, [['appointments'], ['appointments', 'broadcastCampaigns']]);

  calls.length = 0;
  const fourth = coordinator.run('a', load, ['appointments']);
  const fifth = coordinator.run('a', load, ['broadcastCampaigns']);
  const sixth = coordinator.run('a', load);
  finish(true);
  await Promise.all([fourth, fifth, sixth]);
  assert.deepEqual(calls, [['appointments'], undefined]);
});

test('debounce une recursos e preserva recarga completa', async () => {
  const calls = [];
  const schedule = realtimeRefresh.createDebouncedRealtimeRefresh((resources) => calls.push(resources), 5);
  schedule(['appointments']);
  schedule(['broadcastCampaigns']);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(calls, [['appointments', 'broadcastCampaigns']]);
  schedule(['appointments']);
  schedule();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(calls, [['appointments', 'broadcastCampaigns'], undefined]);
});

test('recarga parcial não renova frescor da carga completa e flush preserva pedido pendente', async () => {
  let now = 1000;
  const coordinator = realtimeRefresh.createRefreshCoordinator({ now: () => now, staleAfterMs: 100 });
  coordinator.markFresh('a');
  now += 101;
  await coordinator.run('a', async () => true, ['broadcastCampaigns']);
  assert.equal(coordinator.shouldRefreshOnVisibility('a'), true);
  const calls = [];
  const schedule = realtimeRefresh.createDebouncedRealtimeRefresh((resources) => calls.push(resources), 1000);
  schedule(['broadcastCampaigns']);
  schedule.flush();
  schedule.flush();
  assert.deepEqual(calls, [['broadcastCampaigns']]);
});

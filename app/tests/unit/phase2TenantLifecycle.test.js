import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import parser from '@babel/parser';
import * as caches from '../../src/services/tenants/tenantScopedCaches.js';
import { findTenantBySlug, TENANT_LOOKUP_TTL_MS } from '../../src/services/tenants/tenantDataReads.js';
import { loadTeamAgents } from '../../src/services/agents/teamAgentReads.js';

test('Realtime não abre canais sem tenant e filtra todas as tabelas do escopo resolvido', () => {
  const source = fs.readFileSync(new URL('../../src/dataService.js', import.meta.url), 'utf8');
  const ast = parser.parse(source, { sourceType: 'module' });
  const node = ast.program.body.find(n => n.declaration?.id?.name === 'subscribeToClientEvents').declaration;
  const filters = []; const channels = []; const removed = [];
  const client = {
    channel(name) { const channel = { on(_, filter) { filters.push(filter); return this; }, subscribe() {} }; channels.push(name); return channel; },
    removeChannel(channel) { removed.push(channel); },
  };
  const subscribe = vm.runInNewContext(`(${source.slice(node.start, node.end)})`, { getClient: () => client, console });
  subscribe(() => {}, 'salon', null)();
  assert.deepEqual(channels, []);
  const cleanup = subscribe(() => {}, 'salon', 'tenant-a');
  assert.equal(filters.length, 4);
  for (const filter of filters) assert.equal(filter.filter, filter.table === 'channel_events' ? 'tenant_slug=eq.salon' : 'tenant_id=eq.tenant-a');
  cleanup(); assert.equal(removed.length, 2);
});

test('limpeza única esvazia todos os caches e remove apenas localStorage de agentes', () => {
  const maps = Object.values(caches).filter(value => value instanceof Map);
  for (const map of maps) map.set('tenant-a', { secret: true });
  const values = new Map([['magia:team-agents:a', 'a'], ['magia:team-agents:b', 'b'], ['preference', 'keep']]);
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    get length() { return values.size; }, key(index) { return [...values.keys()][index]; }, removeItem(key) { values.delete(key); },
  } });
  try {
    const epoch = caches.tenantCacheEpoch();
    caches.clearTenantScopedCaches();
    assert.equal(caches.tenantCacheEpoch(), epoch + 1);
    for (const map of maps) assert.equal(map.size, 0);
    assert.deepEqual([...values], [['preference', 'keep']]);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});

function tenantClient(resolve) {
  const calls = [];
  return { calls, from(table) {
    let slug;
    return { select() { return this; }, eq(key, value) { slug = value; return this; }, limit() { return this; },
      maybeSingle() { calls.push([table, slug]); return resolve(slug); } };
  } };
}

test('lookup tem TTL de 60 segundos, separa slugs/clientes e é invalidado no logout', async () => {
  caches.clearTenantScopedCaches();
  const originalNow = Date.now; let now = 1_000;
  Date.now = () => now;
  const client = tenantClient(slug => ({ data: { id: slug }, error: null }));
  try {
    await findTenantBySlug(client, 'a'); await findTenantBySlug(client, 'a');
    assert.equal(client.calls.length, 1);
    now += TENANT_LOOKUP_TTL_MS - 1; await findTenantBySlug(client, 'a'); assert.equal(client.calls.length, 1);
    now++; await findTenantBySlug(client, 'a'); assert.equal(client.calls.length, 2);
    await findTenantBySlug(client, 'b'); assert.equal(client.calls.length, 3);
    const other = tenantClient(slug => ({ data: { id: slug }, error: null }));
    await findTenantBySlug(other, 'a'); assert.equal(other.calls.length, 1);
    caches.clearTenantScopedCaches(); await findTenantBySlug(client, 'a'); assert.equal(client.calls.length, 4);
  } finally { Date.now = originalNow; caches.clearTenantScopedCaches(); }
});

test('lookup não armazena falhas nem resultados de requisição anterior à limpeza', async () => {
  let finish;
  const client = tenantClient(() => new Promise(resolve => { finish = resolve; }));
  const pending = findTenantBySlug(client, 'a');
  caches.clearTenantScopedCaches(); finish({ data: { id: 'old' }, error: null });
  assert.equal(await pending, null); assert.equal(caches.tenantLookupCache.size, 0);
  const missing = tenantClient(() => ({ data: null, error: null }));
  await findTenantBySlug(missing, 'a'); await findTenantBySlug(missing, 'a'); assert.equal(missing.calls.length, 2);
});

test('leitura pendente de agentes não recria cache após logout', async () => {
  let finish;
  const values = new Map();
  const storage = { setItem: (k, v) => values.set(k, v), getItem: (k) => values.get(k) };
  const q = { select() { return q; }, eq() { return q; }, order() { return new Promise(resolve => { finish = resolve; }); } };
  const pending = loadTeamAgents('a', { getClient: () => ({ from: () => q }), storage });
  caches.clearTenantScopedCaches();
  finish({ data: [{ id: 'antigo' }], error: null });
  assert.deepEqual(await pending, []);
  assert.equal(values.size, 0);
});

test('App limpa caches junto com appData no logout e na troca de usuário, e aguarda tenant no Realtime', () => {
  const source = fs.readFileSync(new URL('../../src/app/App.jsx', import.meta.url), 'utf8');
  assert.equal((source.match(/clearAppDataCache\(\);\s*clearTenantScopedCaches\(\);/g) || []).length, 3);
  assert.match(source, /if \(!hasTenantAccess \|\| dataScope !== scopeKey \|\| !scopedData\?\.tenantId\) return undefined/);
  assert.match(source, /const requestedEpoch = tenantCacheEpoch\(\)/);
  assert.match(source, /tenantCacheEpoch\(\) === requestedEpoch/);
});

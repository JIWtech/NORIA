import test from 'node:test';
import assert from 'node:assert/strict';
import { loadUserTenants, enabledChannels, isTenantAuthorized } from '../../src/services/tenants/tenantAccess.js';

function client(rows, error = null, userId = 'owner') {
  const calls = [];
  const query = {
    select() { return this; },
    eq(...args) { calls.push(args); return this; },
    then(resolve, reject) { return Promise.resolve({ data: rows, error }).then(resolve, reject); },
  };
  return {
    calls,
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
    from(table) { assert.equal(table, 'tenant_members'); return query; },
  };
}
const row = (overrides = {}) => ({
  user_id: 'owner', status: 'active',
  tenants: { id: 'uuid', slug: 'clinic', name: 'Clinic', status: 'active' }, ...overrides,
});

test('unauthenticated access fails closed', async () => {
  await assert.rejects(loadUserTenants(client([], null, null)), /Sessão expirada/);
});
test('no membership returns no company, never a demo tenant', async () => {
  assert.deepEqual(await loadUserTenants(client([])), []);
});
test('membership query explicitly scopes user and active status', async () => {
  const c = client([row()]);
  assert.equal((await loadUserTenants(c))[0].slug, 'clinic');
  assert.deepEqual(c.calls, [['user_id', 'owner'], ['status', 'active']]);
});
test('mismatched, inactive, missing tenants are excluded and duplicates collapse', async () => {
  const c = client([row(), row(), row({ user_id: 'other' }), row({ status: 'suspended' }),
    row({ tenants: null }), row({ tenants: { slug: 'old', status: 'inactive' } })]);
  assert.equal((await loadUserTenants(c)).length, 1);
});
test('database failure never falls back to tenant list', async () => {
  await assert.rejects(loadUserTenants(client(null, { message: 'denied' })), /verificar o acesso/);
});
test('switching account or unauthorized URL cannot reuse tenant access', () => {
  const access = { userId: 'owner', loaded: true, error: '' };
  const tenants = [{ slug: 'clinic' }];
  assert.equal(isTenantAuthorized('owner', access, tenants, 'clinic'), true);
  assert.equal(isTenantAuthorized('other', access, tenants, 'clinic'), false);
  assert.equal(isTenantAuthorized('owner', access, tenants, 'other'), false);
  assert.equal(isTenantAuthorized('owner', access, tenants, null), false);
  assert.equal(isTenantAuthorized('owner', access, tenants, ''), false);
  assert.equal(isTenantAuthorized('owner', { ...access, loaded: false }, tenants, 'clinic'), false);
  assert.equal(isTenantAuthorized('owner', { ...access, error: 'denied' }, tenants, 'clinic'), false);
});
test('handles tenant relation whether returned as object or 1-element array from PostgREST', async () => {
  const c = client([
    row({ tenants: [{ id: 'uuid-arr', slug: 'clinic-arr', name: 'Array Clinic', status: 'active' }] }),
  ]);
  const tenants = await loadUserTenants(c);
  assert.equal(tenants.length, 1);
  assert.equal(tenants[0].slug, 'clinic-arr');
  assert.equal(tenants[0].name, 'Array Clinic');
});
test('WhatsApp-only settings do not remove existing other clients channels', () => {
  assert.deepEqual(enabledChannels({ enabled_channels: ['whatsapp'] }), ['whatsapp']);
  assert.deepEqual(enabledChannels({ enabled_channels: [] }), []);
  assert.deepEqual(enabledChannels({}), ['whatsapp', 'telegram', 'instagram']);
});

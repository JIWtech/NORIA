import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findTenantBySlug,
  loadAppointments,
  loadBroadcastCampaigns,
  loadBroadcastContacts,
  loadFollowUpJobs,
  loadKanbanConfig,
} from '../../src/services/tenants/tenantDataReads.js';

function fakeSupabase(responses) {
  const queries = [];
  return {
    queries,
    from(table) {
      const query = { table, calls: [] };
      queries.push(query);
      const chain = {
        select(value) { query.calls.push(['select', value]); return chain; },
        eq(column, value) { query.calls.push(['eq', column, value]); return chain; },
        in(column, values) { query.calls.push(['in', column, values]); return chain; },
        order(column, options) { query.calls.push(['order', column, options]); return chain; },
        limit(value) { query.calls.push(['limit', value]); return chain; },
        maybeSingle() { query.calls.push(['maybeSingle']); return chain; },
        then(resolve, reject) {
          const response = responses[table];
          return Promise.resolve((typeof response === 'function' ? response(query) : response) || { data: [], error: null }).then(resolve, reject);
        },
      };
      return chain;
    },
  };
}

test('tenant reads retain tenant filters, ordering, limits, and appointment mapping', async () => {
  const client = fakeSupabase({
    tenants: { data: { id: 'tenant-a', slug: 'alpha' }, error: null },
    appointments: { data: [{ id: 'appointment-a', tenant_id: 'tenant-a' }], error: null },
    broadcast_contacts: { data: [{ id: 'contact-a', tenant_id: 'tenant-a' }], error: null },
    broadcast_campaigns: { data: [{ id: 'campaign-a', tenant_id: 'tenant-a' }], error: null },
  });

  assert.equal((await findTenantBySlug(client, 'alpha')).id, 'tenant-a');
  assert.deepEqual(await loadAppointments(client, 'tenant-a', (row) => ({ ...row, mapped: true })), [{ id: 'appointment-a', tenant_id: 'tenant-a', mapped: true }]);
  assert.deepEqual(await loadBroadcastContacts(client, 'tenant-a'), [{ id: 'contact-a', tenant_id: 'tenant-a' }]);
  assert.deepEqual(await loadBroadcastCampaigns(client, 'tenant-a'), [{ id: 'campaign-a', tenant_id: 'tenant-a' }]);
  for (const query of client.queries) {
    assert.ok(query.calls.some((call) => call.join('|') === 'eq|tenant_id|tenant-a') || query.table === 'tenants');
  }
  assert.deepEqual(client.queries.find((query) => query.table === 'appointments').calls.find((call) => call[0] === 'limit'), ['limit', 200]);
  assert.deepEqual(client.queries.find((query) => query.table === 'broadcast_contacts').calls.find((call) => call[0] === 'limit'), ['limit', 500]);
  assert.deepEqual(client.queries.find((query) => query.table === 'broadcast_campaigns').calls.find((call) => call[0] === 'limit'), ['limit', 50]);
});

test('falhas de contatos e campanhas são propagadas para preservar dados anteriores', async () => {
  const client = fakeSupabase({
    broadcast_contacts: { error: { message: 'indisponível' } },
    broadcast_campaigns: { error: { message: 'indisponível' } },
  });
  await assert.rejects(loadBroadcastContacts(client, 'tenant-a'));
  await assert.rejects(loadBroadcastCampaigns(client, 'tenant-a'));
});

test('falha no histórico impede substituir os agendamentos por uma lista incompleta', async () => {
  const active = { id: 'drenagem', status: 'confirmed' };
  const client = fakeSupabase({ appointments: query => {
    if (query.calls.some(call => call[0] === 'in' && call[1] === 'status')) return { data: [active] };
    if (query.calls.some(call => call[0] === 'eq' && call[1] === 'status')) return { data: [] };
    return { error: { message: 'histórico temporariamente indisponível' } };
  } });
  await assert.rejects(loadAppointments(client, 'tenant-a', row => row));
});

test('Kanban reads retain board and column isolation and fall back on errors', async () => {
  const client = fakeSupabase({
    kanban_boards: { data: { id: 'board-a', tenant_id: 'tenant-a' }, error: null },
    kanban_columns: { data: [{ id: 'column-a', tenant_id: 'tenant-a', board_id: 'board-a' }], error: null },
  });
  const config = await loadKanbanConfig(client, 'tenant-a');
  assert.equal(config.board.id, 'board-a');
  assert.equal(config.columns[0].board_id, 'board-a');
  assert.ok(client.queries[1].calls.some((call) => call.join('|') === 'eq|board_id|board-a'));

  const failing = fakeSupabase({ kanban_boards: { data: null, error: { message: 'unavailable' } } });
  assert.equal(await loadKanbanConfig(failing, 'tenant-a'), null);
});

test('follow-up reads stay tenant-scoped and are disabled outside the Nubia board', async () => {
  const client = fakeSupabase({ follow_up_jobs: { data: [{ id: 'job-a', tenant_id: 'tenant-a' }], error: null } });
  assert.deepEqual(await loadFollowUpJobs(client, 'tenant-a', 'other_tenant'), []);
  assert.equal(client.queries.length, 0);
  assert.deepEqual(await loadFollowUpJobs(client, 'tenant-a', 'clinica_nubia_oficial'), [{ id: 'job-a', tenant_id: 'tenant-a' }]);
  assert.ok(client.queries[0].calls.some((call) => call[0] === 'in' && call[1] === 'status'));
  assert.deepEqual(client.queries[0].calls.find((call) => call[0] === 'limit'), ['limit', 200]);
});

test('agendamentos ativos e futuros entram mesmo além dos 200 do histórico', async () => {
  const history = Array.from({ length: 200 }, (_, index) => ({ id: `old-${index}`, tenant_id: 'tenant-a', status: 'completed' }));
  const active = [{ id: 'future-confirmed', tenant_id: 'tenant-a', status: 'confirmed' }, { id: 'old-0', tenant_id: 'tenant-a', status: 'completed' }];
  let call = 0;
  const client = fakeSupabase({});
  const originalFrom = client.from.bind(client);
  client.from = (table) => {
    const chain = originalFrom(table);
    const response = call++ === 0 ? { data: history, error: null } : { data: active, error: null };
    chain.then = (resolve, reject) => Promise.resolve(response).then(resolve, reject);
    return chain;
  };
  const rows = await loadAppointments(client, 'tenant-a', (row) => row);
  assert.equal(rows.length, 201);
  assert.ok(rows.some((row) => row.id === 'future-confirmed'));
  const activeQuery = client.queries[1];
  const statuses = activeQuery.calls.find((item) => item[0] === 'in' && item[1] === 'status')[2];
  for (const status of ['pending_confirmation', 'payment_reported', 'aguardando_verificacao', 'scheduled', 'confirmed', 'reserved', 'pending_payment']) {
    assert.ok(statuses.includes(status), status);
  }
  assert.ok(activeQuery.calls.some((item) => item.join('|') === 'eq|tenant_id|tenant-a'));
  assert.ok(activeQuery.calls.find((item) => item[0] === 'limit')[1] >= 1000);
});

test('propostas de horário de pedidos cancelados entram por consulta própria, sempre no tenant', async () => {
  const client = fakeSupabase({ appointments: { data: [{ id: 'cancelled-proposal', tenant_id: 'tenant-a', status: 'cancelled' }], error: null } });
  const rows = await loadAppointments(client, 'tenant-a', (row) => row);
  assert.deepEqual(rows.map((row) => row.id), ['cancelled-proposal']);
  const proposalQuery = client.queries[2];
  assert.ok(proposalQuery.calls.some((call) => call.join('|') === 'eq|tenant_id|tenant-a'));
  assert.ok(proposalQuery.calls.some((call) => call.join('|') === 'eq|status|cancelled'));
  const statuses = proposalQuery.calls.find((call) => call[0] === 'in' && call[1] === 'metadata->slot_proposal->>status')[2];
  assert.deepEqual([...statuses].sort(), ['rejected', 'sent', 'superseded']);
});

test('consultas de agendamentos começam juntas e mantêm a prioridade da mesclagem', async () => {
  const pending = [];
  const client = fakeSupabase({ appointments: query => new Promise(resolve => pending.push({ query, resolve })) });
  const loading = loadAppointments(client, 'tenant-a', row => row);
  await new Promise(resolve => setImmediate(resolve));
  try {
    assert.equal(pending.length, 3);
    for (const { query } of pending) assert.ok(query.calls.some(call => call.join('|') === 'eq|tenant_id|tenant-a'));
    pending[2].resolve({ data: [{ id: 'proposta' }, { id: 'comum', source: 'proposta' }], error: null });
    pending[1].resolve({ data: [{ id: 'ativo' }, { id: 'comum', source: 'ativo' }], error: null });
    pending[0].resolve({ data: [{ id: 'comum', source: 'histórico' }], error: null });
    assert.deepEqual(await loading, [{ id: 'comum', source: 'histórico' }, { id: 'ativo' }, { id: 'proposta' }]);
  } finally {
    for (const { resolve } of pending) resolve({ data: [], error: null });
  }
  await loading;
});

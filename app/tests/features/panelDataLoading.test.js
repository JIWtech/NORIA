import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClientDataWithClient } from '../../src/services/clientData/clientDataLoader.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
const event = { id: 'e1', tenant_slug: 'alpha', channel_type: 'whatsapp', external_conversation_id: '5511999990000',
  created_at: '2026-11-19T10:00:00Z', direction: 'inbound', message_text: 'Olá', raw_payload: { media: { kind: 'image', status: 'pending' } } };

function database(overrides = {}) {
  const started = [];
  const queries = [];
  const responses = {
    tenants: { data: { id: 'tenant-a', slug: 'alpha' } },
    tenant_settings: { data: { settings: {} } },
    channel_events: { data: [event] },
    kanban_boards: { data: null },
    heads: { data: [event] },
    ...overrides,
  };
  const rpcCalls = [];
  const client = {
    started, queries, rpcCalls,
    from(table) { return query(table); },
    rpc(name, args) {
      assert.match(name, /^conversation_latest_events(_light)?$/);
      assert.equal(args.p_tenant_slug, 'alpha');
      rpcCalls.push({ name, args });
      return query('heads');
    },
  };
  function query(table) {
    const calls = [];
    queries.push({ table, calls });
    const chain = {};
    for (const method of ['select', 'eq', 'in', 'is', 'order', 'limit', 'maybeSingle', 'range']) {
      chain[method] = (...args) => { calls.push([method, ...args]); return chain; };
    }
    chain.then = (resolve, reject) => {
      started.push(table);
      return Promise.resolve(responses[table] || { data: [] }).then(resolve, reject);
    };
    return chain;
  }
  return client;
}

test('configurações lentas não bloqueiam eventos e demais leituras independentes', async () => {
  const settings = deferred();
  const client = database({ tenant_settings: settings.promise });
  const loading = loadClientDataWithClient(client, {}, 'alpha', 'user-a');
  await tick();
  const started = [...client.started];
  settings.resolve({ data: { settings: {} } });
  await loading;
  assert.ok(started.includes('channel_events'), 'eventos devem começar sem esperar settings');
  assert.ok(started.includes('appointments'), 'agendamentos devem começar sem esperar settings');
});

test('heads começam após eventos sem esperar agendamentos e falhas de outros domínios', async () => {
  const appointments = deferred();
  const client = database({ appointments: appointments.promise });
  const loading = loadClientDataWithClient(client, {}, 'alpha', 'user-a');
  await tick();
  const started = [...client.started];
  appointments.resolve({ data: [] });
  const data = await loading;
  assert.ok(started.includes('heads'), 'RPC não deve ficar atrás de agendamentos');
  assert.equal(data.tenantId, 'tenant-a');
  assert.equal(data.conversations.length, 1);
});

test('janela vazia ou com erro não dispara heads; settings continua sendo obrigatório', async () => {
  const empty = database({ channel_events: { data: [] } });
  assert.equal((await loadClientDataWithClient(empty, {}, 'alpha')).source, 'supabase_empty');
  assert.ok(!empty.started.includes('heads'));
  const failed = database({ channel_events: { error: { message: 'offline' } } });
  await assert.rejects(loadClientDataWithClient(failed, {}, 'alpha'), /carregar os atendimentos/);
  assert.ok(!failed.started.includes('heads'));
  const settings = database({ tenant_settings: { error: { message: 'offline' } } });
  await assert.rejects(loadClientDataWithClient(settings, {}, 'alpha'), /configurações/);
});

test('recarga de campanhas lê somente o domínio solicitado com isolamento por tenant', async () => {
  const campaigns = [{ id: 'campaign-a', tenant_id: 'tenant-a', status: 'paused' }];
  const client = database({ broadcast_campaigns: { data: campaigns } });
  const patch = await loadClientDataWithClient(client, { tenantId: 'tenant-a' }, 'alpha', 'user-a', { resources: ['broadcastCampaigns'] });
  assert.deepEqual(patch, { tenantId: 'tenant-a', broadcastCampaigns: campaigns });
  assert.deepEqual(client.started, ['tenants', 'broadcast_campaigns']);
  assert.ok(client.queries.find((q) => q.table === 'broadcast_campaigns').calls.some((c) => c[0] === 'eq' && c[1] === 'tenant_id' && c[2] === 'tenant-a'));
});

test('falha parcial de campanhas rejeita sem apagar estado anterior; tenant ausente não lê dados', async () => {
  const client = database({ broadcast_campaigns: { error: { message: 'offline' } } });
  await assert.rejects(loadClientDataWithClient(client, {}, 'alpha', 'user-a', { resources: ['broadcastCampaigns'] }), /campanhas/);
  const missing = database({ tenants: { data: null } });
  await assert.rejects(loadClientDataWithClient(missing, {}, 'alpha'), /Empresa indisponível/);
  assert.deepEqual(missing.started, ['tenants']);
});

test('falhas independentes preservam dados anteriores somente do mesmo tenant e são reportadas', async () => {
  const errors = { error: { message: 'offline' } };
  const client = database({ appointments: errors, broadcast_contacts: errors, broadcast_campaigns: errors, conversation_reads: errors });
  const previous = { tenantId: 'tenant-a', appointments: [{ id: 'a' }], broadcastContacts: [{ id: 'b' }], broadcastCampaigns: [{ id: 'c' }], conversationReads: [{ id: 'r' }] };
  const result = await loadClientDataWithClient(client, previous, 'alpha', 'user-a');
  assert.deepEqual(result.resourceErrors.sort(), ['agendamentos', 'campanhas', 'contatos de disparos', 'leituras'].sort());
  assert.deepEqual(result.appointments, previous.appointments);
  assert.deepEqual(result.broadcastCampaigns, previous.broadcastCampaigns);
  assert.deepEqual(result.conversationReads, previous.conversationReads);
  const other = await loadClientDataWithClient(client, { ...previous, tenantId: 'other' }, 'alpha', 'user-a');
  assert.deepEqual(other.appointments, []);
  assert.deepEqual(other.broadcastCampaigns, []);
  assert.deepEqual(other.conversationReads, []);
});

test('carga otimizada preserva mídia, conversa antiga e deduplicação; falha da RPC mantém a janela', async () => {
  const older = { ...event, id: 'old', external_conversation_id: '5511888880000', created_at: '2026-10-01T10:00:00Z' };
  const client = database({ heads: { data: [event, older, { ...older, id: 'foreign', tenant_slug: 'beta' }] } });
  const snapshot = structuredClone(event);
  const data = await loadClientDataWithClient(client, {}, 'alpha', 'user-a');
  assert.equal(data.conversations.length, 2);
  const recent = data.conversations.find((c) => c.externalConversationId === event.external_conversation_id);
  assert.equal(recent.messages.length, 1);
  assert.equal(recent.messages[0].media.kind, 'image');
  assert.equal(recent.messages[0].media.status, 'pending');
  assert.deepEqual(event, snapshot, 'o enriquecimento não deve alterar o payload original');
  const unavailable = database({ heads: { error: { message: 'RPC temporariamente indisponível' } } });
  const fallback = await loadClientDataWithClient(unavailable, {}, 'alpha', 'user-a');
  assert.equal(fallback.conversations.length, 1);
  assert.equal(fallback.conversations[0].messages[0].eventId, event.id);
});

// Desempenho (19/11): por padrão só conversas com atividade nos últimos 30 dias; as antigas sob demanda.
test('a lista de conversas pede só os últimos 30 dias; com conversas antigas pedidas, pede todas', async () => {
  const client = database();
  const before = Date.now();
  await loadClientDataWithClient(client, {}, 'alpha', 'user-a');
  const recent = client.rpcCalls[0];
  assert.equal(recent.name, 'conversation_latest_events_light');
  const ageDays = (before - Date.parse(recent.args.p_since)) / 86_400_000;
  assert.ok(ageDays > 29.9 && ageDays < 30.1, `janela de 30 dias (${ageDays})`);
  const all = database();
  await loadClientDataWithClient(all, {}, 'alpha', 'user-a', { includeOlderConversations: true });
  assert.equal(all.rpcCalls[0].args.p_since, null);
});

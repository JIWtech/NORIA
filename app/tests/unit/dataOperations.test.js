import assert from 'node:assert/strict';
import test from 'node:test';
import { enrichSingleMediaEvent } from '../../src/services/media/singleMediaEvent.js';
import { clearMediaUrlCache } from '../../src/services/media/mediaUrlService.js';
import { loadContactAvatars, loadRelevantContacts } from '../../src/services/contacts/contactDataService.js';

function queryClient(rowsByTable) {
  const queries = [];
  return {
    queries,
    from(table) {
      const query = { table, calls: [] };
      queries.push(query);
      const chain = {
        select(value) { query.calls.push(['select', value]); return chain; },
        eq(column, value) { query.calls.push(['eq', column, value]); return chain; },
        is(column, value) { query.calls.push(['is', column, value]); return chain; },
        not(column, operator, value) { query.calls.push(['not', column, operator, value]); return chain; },
        in(column, values) { query.calls.push(['in', column, values]); return chain; },
        order(column, options) { query.calls.push(['order', column, options]); return chain; },
        limit(value) { query.calls.push(['limit', value]); return chain; },
        then(resolve, reject) { return Promise.resolve({ data: rowsByTable[table] || [], error: null }).then(resolve, reject); },
      };
      return chain;
    },
  };
}

test('single media enrichment uses the injected client and force invalidates the shared URL cache', async () => {
  clearMediaUrlCache();
  let signedCalls = 0;
  const client = { storage: { from: () => ({
    createSignedUrl: async () => ({ data: { signedUrl: `signed-${++signedCalls}` }, error: null }),
  }) } };
  const event = { id: 'event-1', direction: 'inbound', raw_payload: {
    media: { status: 'stored', bucket: 'tenant-private', storagePath: 'tenant-a/image.png', kind: 'image' },
  } };

  const initial = await enrichSingleMediaEvent(event, client);
  const forced = await enrichSingleMediaEvent(initial, client, { force: true });
  assert.equal(initial.raw_payload.media.url, 'signed-1');
  assert.equal(forced.raw_payload.media.url, 'signed-2');
  assert.equal(signedCalls, 2);
  clearMediaUrlCache();
});

test('relevant contacts retain tenant and WhatsApp filters with an injected client', async () => {
  const client = queryClient({ contacts: [{ id: 'contact-a', tenant_id: 'tenant-a', source_channel: 'whatsapp', external_handle: '5511999999999@s.whatsapp.net' }] });
  const contacts = await loadRelevantContacts(client, 'tenant-a', [
    { channel_type: 'whatsapp', external_conversation_id: '5511999999999@s.whatsapp.net' },
    { channel_type: 'telegram', external_conversation_id: 'tenant-b-only' },
  ], [{ channelType: 'whatsapp', externalConversationId: '5511888888888@s.whatsapp.net' }]);

  assert.deepEqual(contacts.map((contact) => contact.tenant_id), ['tenant-a']);
  const calls = client.queries[0].calls;
  assert.ok(calls.some((call) => call.join('|') === 'eq|tenant_id|tenant-a'));
  assert.ok(calls.some((call) => call.join('|') === 'eq|source_channel|whatsapp'));
  assert.deepEqual(calls.find((call) => call[0] === 'in')[2].sort(), ['5511888888888@s.whatsapp.net', '5511999999999@s.whatsapp.net']);
});

test('contact avatars keep their tenant scope and nullable-handle exclusion with an injected client', async () => {
  const client = queryClient({ contacts: [{ tenant_id: 'tenant-a', source_channel: 'whatsapp', external_handle: '5511999999999@s.whatsapp.net', avatar_url: 'https://cdn.example/a.png' }] });
  const avatars = await loadContactAvatars(client, 'tenant-a');

  assert.equal(avatars[0].tenant_id, 'tenant-a');
  const calls = client.queries[0].calls;
  assert.ok(calls.some((call) => call.join('|') === 'eq|tenant_id|tenant-a'));
  assert.ok(calls.some((call) => call.join('|') === 'is|deleted_at|'));
  assert.ok(calls.some((call) => call.join('|') === 'not|external_handle|is|'));
});

test('contatos iniciam até três lotes e propagam falha de um lote', async () => {
  const pending = [];
  const queries = [];
  const client = { from() {
    const calls = []; queries.push(calls);
    const chain = {
      select(value) { calls.push(['select', value]); return chain; },
      eq(...args) { calls.push(['eq', ...args]); return chain; },
      is(...args) { calls.push(['is', ...args]); return chain; },
      in(...args) { calls.push(['in', ...args]); return chain; },
      order(...args) { calls.push(['order', ...args]); return chain; },
      then(resolve, reject) { return new Promise(done => pending.push(done)).then(resolve, reject); },
    };
    return chain;
  } };
  const events = Array.from({ length: 800 }, (_, i) => ({ channel_type: 'whatsapp', external_conversation_id: `5511${String(i).padStart(8, '0')}@s.whatsapp.net` }));
  const loading = loadRelevantContacts(client, 'tenant-a', events);
  const rejected = assert.rejects(loading, /carregar os contatos/);
  await new Promise(resolve => setImmediate(resolve));
  try {
    assert.equal(pending.length, 3);
    pending[2]({ data: [{ id: 'terceiro' }], error: null });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(pending.length, 4);
    pending[1]({ data: null, error: { message: 'indisponível' } });
    pending[3]({ data: [{ id: 'quarto' }], error: null });
    pending[0]({ data: [{ id: 'primeiro' }], error: null });
    await rejected;
    for (const calls of queries) assert.ok(calls.some(call => call.join('|') === 'eq|tenant_id|tenant-a'));
  } finally {
    for (const resolve of pending) resolve({ data: [], error: null });
  }
});

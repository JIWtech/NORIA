import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConversationReads } from '../../src/services/reads/conversationDataReads.js';

function fakeSupabase(response) {
  const calls = [];
  const chain = {
    select(value) { calls.push(['select', value]); return chain; },
    eq(column, value) { calls.push(['eq', column, value]); return chain; },
    limit(value) { calls.push(['limit', value]); return chain; },
    then(resolve, reject) { return Promise.resolve(response).then(resolve, reject); },
  };
  return { calls, from(table) { calls.push(['from', table]); return chain; } };
}

test('conversation reads retain tenant and user isolation, fields, and pagination', async () => {
  const client = fakeSupabase({ data: [{ tenant_id: 'tenant-a', user_id: 'user-a', channel_type: 'whatsapp', external_conversation_id: 'chat-a' }], error: null });
  const reads = await loadConversationReads(client, 'tenant-a', 'user-a');

  assert.deepEqual(reads, [{ tenant_id: 'tenant-a', user_id: 'user-a', channel_type: 'whatsapp', external_conversation_id: 'chat-a' }]);
  assert.deepEqual(client.calls.find((call) => call[0] === 'from'), ['from', 'conversation_reads']);
  assert.ok(client.calls.some((call) => call.join('|') === 'eq|tenant_id|tenant-a'));
  assert.ok(client.calls.some((call) => call.join('|') === 'eq|user_id|user-a'));
  assert.deepEqual(client.calls.find((call) => call[0] === 'limit'), ['limit', 500]);
});

test('conversation reads do not query incomplete scope and fail closed on errors', async () => {
  const missingScope = fakeSupabase({ data: [{ id: 'must-not-read' }], error: null });
  assert.deepEqual(await loadConversationReads(missingScope, '', 'user-a'), []);
  assert.deepEqual(await loadConversationReads(missingScope, 'tenant-a', null), []);
  assert.equal(missingScope.calls.length, 0);

  const failing = fakeSupabase({ data: null, error: { message: 'denied' } });
  await assert.rejects(loadConversationReads(failing, 'tenant-b', 'user-b'), /carregar as leituras/);
});

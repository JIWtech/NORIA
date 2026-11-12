import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConversationHeads, mergeConversationHeads } from '../../src/services/conversations/conversationHeads.js';
import { eventsToConversations } from '../../src/services/conversations/eventsToConversations.js';

const row = (id, chat, at, tenant = 'nubia') => ({ id, tenant_slug: tenant, channel_type: 'whatsapp', external_conversation_id: chat, created_at: at,
  direction: 'inbound', sender_type: 'contact', message_text: 'oi ' + id, stage: 'Qualificação', raw_payload: {} });

test('conversa fora da janela recente volta ao painel pelo último evento dela (IA-16)', () => {
  const recent = [row('e2', 'chatA', '2026-11-12T10:00:00Z')];
  const heads = [row('e2', 'chatA', '2026-11-12T10:00:00Z'), row('old', 'chatB', '2026-10-01T09:00:00Z')];
  const merged = mergeConversationHeads(recent, heads);
  assert.equal(merged.length, 2, 'sem duplicar o evento que já estava na janela');
  const ids = eventsToConversations(merged, 'nubia').map((c) => c.externalConversationId).sort();
  assert.deepEqual(ids, ['chatA', 'chatB']);
  assert.equal(eventsToConversations(recent, 'nubia').length, 1, 'sem as cabeças, chatB some');
});

test('RPC ausente ou com erro não derruba a carga', async () => {
  assert.deepEqual(await loadConversationHeads({ rpc: async () => ({ data: null, error: { message: 'function does not exist' } }) }, 'nubia'), []);
  assert.deepEqual(await loadConversationHeads({ rpc: async () => { throw new Error('rede'); } }, 'nubia'), []);
  assert.deepEqual(await loadConversationHeads(null, 'nubia'), []);
});

test('descarta linhas de outro tenant mesmo que a RPC as devolva (isolamento)', async () => {
  const supabase = { rpc: async (name, args) => { assert.equal(name, 'conversation_latest_events'); assert.equal(args.p_tenant_slug, 'nubia'); return { data: [row('a', 'c1', '2026-11-12T10:00:00Z'), row('b', 'c2', '2026-11-12T10:00:00Z', 'outro')], error: null }; } };
  const heads = await loadConversationHeads(supabase, 'nubia');
  assert.deepEqual(heads.map((r) => r.id), ['a']);
});

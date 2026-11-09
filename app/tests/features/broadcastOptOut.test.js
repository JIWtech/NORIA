import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBroadcastOperations } from '../../src/services/broadcasts/broadcastOperations.js';
import { broadcastContactKey, optOutIndex, isContactOptedOut } from '../../src/features/broadcasts/utils/broadcastOptOut.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fakeClient(rows = []) {
  const calls = [];
  const query = (table) => {
    const q = {
      select(columns) { calls.push({ table, select: columns }); return q; },
      eq(column, value) { calls.push({ table, eq: [column, value] }); return q; },
      then(resolve) { return Promise.resolve({ data: rows, error: null }).then(resolve); },
    };
    return q;
  };
  return {
    calls,
    from: (table) => query(table),
    rpc: async (name, args) => { calls.push({ rpc: name, args }); return { data: { ok: true }, error: null }; },
  };
}

const ops = (client) => createBroadcastOperations({
  getClient: () => client, loadTenant: async (slug) => ({ id: 'tenant-' + slug }), currentUserId: async () => 'user-1',
});

test('chave do contato segue a mesma normalização técnica do banco', () => {
  assert.equal(broadcastContactKey('5521999990000@s.whatsapp.net'), '5521999990000');
  assert.equal(broadcastContactKey(' 5521999990000@c.us '), '5521999990000');
  assert.equal(broadcastContactKey(''), '');
});

test('contato bloqueado é reconhecido por canal e chave, sem misturar canais', () => {
  const index = optOutIndex([{ channel_type: 'whatsapp', contact_key: '5521999990000' }]);
  assert.equal(isContactOptedOut({ channelType: 'whatsapp', externalConversationId: '5521999990000@s.whatsapp.net' }, index), true);
  assert.equal(isContactOptedOut({ channel_type: 'telegram', external_conversation_id: '5521999990000' }, index), false);
  assert.equal(isContactOptedOut({ channelType: 'whatsapp', externalConversationId: '5521888880000' }, index), false);
});

test('lista de bloqueio é lida só do tenant ativo', async () => {
  const client = fakeClient([{ channel_type: 'whatsapp', contact_key: '1' }]);
  const rows = await ops(client).listBroadcastOptOuts('salao');
  assert.equal(rows.length, 1);
  assert.ok(client.calls.some((call) => call.table === 'broadcast_opt_outs' && call.eq?.[0] === 'tenant_id' && call.eq[1] === 'tenant-salao'));
});

test('bloquear e desbloquear passam pela RPC com tenant, canal e contato', async () => {
  const client = fakeClient();
  await ops(client).setBroadcastOptOut('salao', { channelType: 'whatsapp', externalConversationId: '5521999990000' }, true, 'pediu na loja');
  await ops(client).setBroadcastOptOut('salao', { channel_type: 'whatsapp', external_conversation_id: '5521999990000' }, false);
  assert.deepEqual(client.calls.filter((call) => call.rpc), [
    { rpc: 'broadcast_set_opt_out', args: { p_tenant_id: 'tenant-salao', p_channel: 'whatsapp', p_external: '5521999990000', p_opted_out: true, p_reason: 'pediu na loja' } },
    { rpc: 'broadcast_set_opt_out', args: { p_tenant_id: 'tenant-salao', p_channel: 'whatsapp', p_external: '5521999990000', p_opted_out: false, p_reason: null } },
  ]);
});

test('a tela tira bloqueados da seleção e permite bloquear/desbloquear', () => {
  const screen = fs.readFileSync(path.join(__dirname, '../../src/features/broadcasts/components/Broadcasts.jsx'), 'utf8');
  assert.match(screen, /listBroadcastOptOuts/);
  assert.match(screen, /setBroadcastOptOut/);
  assert.match(screen, /isContactOptedOut/);
  assert.match(screen, /Não recebe disparos/);
});

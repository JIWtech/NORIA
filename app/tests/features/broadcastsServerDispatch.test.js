import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBroadcastOperations } from '../../src/services/broadcasts/broadcastOperations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = (file) => fs.readFileSync(path.join(__dirname, '../../src', file), 'utf8');

function fakeClient() {
  const calls = [];
  const chain = (table) => {
    const query = {
      insert(payload) { calls.push({ table, op: 'insert', payload }); return query; },
      update(payload) { calls.push({ table, op: 'update', payload }); return query; },
      upsert(payload) { calls.push({ table, op: 'upsert', payload }); return query; },
      select() { return query; }, eq() { return query; }, neq() { return query; }, in() { return query; },
      single: async () => ({ data: { id: 'campaign-1', status: 'draft' }, error: null }),
      then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); },
    };
    return query;
  };
  return {
    calls,
    from: (table) => chain(table),
    rpc: async (name, args) => { calls.push({ rpc: name, args }); return { data: { ok: true, status: 'queued' }, error: null }; },
  };
}

const operations = (client) => createBroadcastOperations({
  getClient: () => client, loadTenant: async () => ({ id: 'tenant-1' }), currentUserId: async () => 'user-1',
});

test('o navegador não executa mais o envio: worker local removido', () => {
  assert.equal(fs.existsSync(path.join(__dirname, '../../src/services/broadcasts/broadcastWorker.js')), false);
  const screen = source('features/broadcasts/components/Broadcasts.jsx');
  assert.doesNotMatch(screen, /broadcastWorker|executeBroadcastCampaign/);
  assert.doesNotMatch(screen, /broadcast_(start|resume|cancel)/, 'comandos que o roteador recusa');
  assert.doesNotMatch(screen, /sendN8nCommand/);
  assert.doesNotMatch(screen, /beforeunload/, 'fechar a aba não interrompe mais o envio');
});

test('o painel não tem acesso às RPCs do worker nem classifica envio por texto', () => {
  const ops = operations(fakeClient());
  for (const name of ['claimBroadcastBatch', 'markRecipientSending', 'recordRecipientResult', 'recoverStaleLeases', 'cancelBroadcastCampaign']) {
    assert.equal(ops[name], undefined, name + ' é exclusivo do servidor');
  }
  assert.doesNotMatch(source('services/broadcasts/broadcastStateMachine.js'), /classifySendOutcome/);
});

test('criar campanha grava rascunho com destinatários, sem horários do navegador', async () => {
  const client = fakeClient();
  await operations(client).createBroadcastCampaign('salao', { name: 'C', messageText: 'Oi', channelType: 'whatsapp', status: 'sending' },
    [{ id: 'contact-1', externalConversationId: '5521999990000', name: 'Ana' }]);
  const campaignInsert = client.calls.find((call) => call.table === 'broadcast_campaigns' && call.op === 'insert');
  assert.equal(campaignInsert.payload.status, 'draft', 'status inicial é sempre rascunho');
  assert.equal(campaignInsert.payload.tenant_id, 'tenant-1');
  const recipients = client.calls.find((call) => call.table === 'broadcast_campaign_recipients').payload;
  assert.equal(recipients[0].tenant_id, 'tenant-1');
  assert.equal(recipients[0].status, 'queued');
  for (const call of client.calls) {
    for (const row of [].concat(call.payload || [])) {
      for (const key of Object.keys(row)) assert.doesNotMatch(key, /_at$/, call.table + '.' + key + ' viria do relógio do navegador');
    }
  }
});

test('enfileirar e controlar a campanha passam pelas RPCs do servidor, com consentimento explícito', async () => {
  const client = fakeClient();
  const ops = operations(client);
  await ops.enqueueBroadcastCampaign('campaign-1', { consentConfirmed: true });
  await ops.enqueueBroadcastCampaign('campaign-2', { consentConfirmed: true, scheduledAt: '2026-11-10T13:00:00.000Z' });
  await ops.controlBroadcastCampaign('campaign-1', 'pause');
  assert.deepEqual(client.calls.filter((call) => call.rpc), [
    { rpc: 'broadcast_enqueue_campaign', args: { p_campaign_id: 'campaign-1', p_scheduled_at: null, p_consent_confirmed: true } },
    { rpc: 'broadcast_enqueue_campaign', args: { p_campaign_id: 'campaign-2', p_scheduled_at: '2026-11-10T13:00:00.000Z', p_consent_confirmed: true } },
    { rpc: 'broadcast_control_campaign', args: { p_campaign_id: 'campaign-1', p_action: 'pause' } },
  ]);
  await assert.rejects(() => ops.enqueueBroadcastCampaign('campaign-1', { consentConfirmed: false }), /consentimento/i);
  await assert.rejects(() => ops.controlBroadcastCampaign('campaign-1', 'apagar'), /acao/i);
});

test('erro da RPC chega à tela (sem fallback silencioso no navegador)', async () => {
  const client = { ...fakeClient(), rpc: async () => ({ data: null, error: new Error('BROADCAST_FORBIDDEN') }) };
  await assert.rejects(() => operations(client).enqueueBroadcastCampaign('campaign-1', { consentConfirmed: true }), /BROADCAST_FORBIDDEN/);
});

test('a tela enfileira e acompanha: sem envio local, com confirmação de consentimento', () => {
  const screen = source('features/broadcasts/components/Broadcasts.jsx');
  assert.match(screen, /enqueueBroadcastCampaign/);
  assert.match(screen, /controlBroadcastCampaign/);
  assert.match(screen, /consentConfirmed/);
});

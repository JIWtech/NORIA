import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createBroadcastOperations } from '../../src/services/broadcasts/broadcastOperations.js';

// IA-25: o painel só cria e enfileira; quem envia é o servidor, que respeita a cadência de proteção do número.
function ops(rpcImpl) {
  const calls = [];
  const client = { async rpc(name, args) { calls.push([name, args]); return rpcImpl(name, args); } };
  return { calls, api: createBroadcastOperations({ getClient: () => client, loadTenant: async () => ({ id: 't1' }), currentUserId: async () => 'u1' }) };
}

test('enfileirar exige consentimento e chama a RPC do servidor', async () => {
  const { api, calls } = ops(async () => ({ data: { ok: true, status: 'queued' }, error: null }));
  await assert.rejects(() => api.enqueueBroadcastCampaign('c1', { consentConfirmed: false }), /consentimento/i);
  assert.equal(calls.length, 0, 'sem consentimento nada é chamado');
  const result = await api.enqueueBroadcastCampaign('c1', { consentConfirmed: true });
  assert.equal(result.status, 'queued');
  assert.deepEqual(calls[0], ['broadcast_enqueue_campaign', { p_campaign_id: 'c1', p_scheduled_at: null, p_consent_confirmed: true }]);
});

test('pausar, retomar e cancelar passam por broadcast_control_campaign', async () => {
  const { api, calls } = ops(async (name, args) => ({ data: { ok: true, action: args.p_action, cancelled_recipients: 3 }, error: null }));
  for (const action of ['pause', 'resume', 'cancel']) {
    const result = await api.controlBroadcastCampaign('c1', action);
    assert.equal(result.action, action);
  }
  assert.deepEqual(calls.map((call) => call[0]), ['broadcast_control_campaign', 'broadcast_control_campaign', 'broadcast_control_campaign']);
  await assert.rejects(() => api.controlBroadcastCampaign('c1', 'apagar'), /acao/i);
});

test('erro da RPC é propagado em vez de ser engolido', async () => {
  const { api } = ops(async () => ({ data: null, error: new Error('BROADCAST_CONSENT_REQUIRED') }));
  await assert.rejects(() => api.enqueueBroadcastCampaign('c1', { consentConfirmed: true }), /BROADCAST_CONSENT_REQUIRED/);
});

test('o painel não envia mensagens pelo navegador nem chama comandos que o router recusa', () => {
  const source = fs.readFileSync(new URL('../../src/features/broadcasts/components/Broadcasts.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /executeBroadcastCampaign/, 'o envio local ignorava a cadência de proteção');
  assert.doesNotMatch(source, /sendN8nCommand\('broadcast_(start|resume|cancel)'/);
  assert.match(source, /enqueueBroadcastCampaign/);
  assert.match(source, /controlBroadcastCampaign/);
});

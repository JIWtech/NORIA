import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../../../n8n/code/broadcast_campaign_worker.js', import.meta.url), 'utf8');
const run = new (Object.getPrototypeOf(async function () {}).constructor)('$json', '$env', source);

test('falha ao gravar histórico aparece no relatório sem repetir envio confirmado', async () => {
  const calls = [];
  const campaign = { id: 'c1', tenant_id: 't1', tenant_slug: 'nubia', channel_type: 'whatsapp', name: 'Teste', message_text: 'Olá' };
  const recipient = { id: 'r1', tenant_id: 't1', external_conversation_id: '5511@s.whatsapp.net', contact_name: 'Ana' };
  const httpRequest = async options => {
    calls.push(options.url);
    if (options.url.includes('/rpc/')) return ({ broadcast_claim_opt_out_reviews: [], broadcast_claim_due_campaigns: [campaign],
      broadcast_protection_settings: { min_interval_seconds: 2460, max_interval_seconds: 2460, max_consecutive_failures: 5 },
      broadcast_daily_quota: { ok: true, remaining: 1 }, broadcast_claim_batch: [recipient], broadcast_begin_send_paced: 'sending',
      broadcast_schedule_next: { ok: true, next_send_at: '2026-11-12T13:00:00Z', db_now: '2026-11-12T12:00:00Z' },
      broadcast_release_campaign: { status: 'sent' } })[options.url.split('/rpc/')[1]];
    if (options.url.includes('/channels?')) return [{ external_id: 'nubia', config: {} }];
    if (options.url.includes('evo.test')) return { statusCode: 201, body: { key: { id: 'MSG1' } } };
    if (options.url.endsWith('/channel_events')) throw new Error('history unavailable');
    return null;
  };
  const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'k', EVOLUTION_API_URL_NUBIA: 'https://evo.test', EVOLUTION_API_KEY_NUBIA: 'x', EVOLUTION_INSTANCE_NUBIA: 'nubia', BROADCAST_WORKER_BUDGET_SECONDS: '1' };
  const out = await run.call({ helpers: { httpRequest } }, {}, env);
  const report = out.map(item => item.json).find(item => item.campaign_id === 'c1');
  assert.equal(report.sent, 1);
  assert.equal(report.history_errors?.length, 1);
  assert.equal(report.history_errors[0].recipient_id, 'r1');
  assert.equal(calls.filter(url => url.includes('evo.test')).length, 1);
});

for (const [code, expected] of [[429, 'broadcast_requeue_recipient_paced'], [400, 'broadcast_schedule_next']]) {
  test(`recusa definitiva HTTP ${code} arma cadência antes de parar`, async () => {
    const calls = [];
    const campaign = { id: 'c1', tenant_id: 't1', tenant_slug: 'nubia', channel_type: 'whatsapp', message_text: 'Olá' };
    const recipient = { id: 'r1', tenant_id: 't1', external_conversation_id: '5511@s.whatsapp.net' };
    const httpRequest = async options => {
      calls.push(options.url);
      if (options.url.includes('/rpc/')) return ({ broadcast_claim_opt_out_reviews: [], broadcast_claim_due_campaigns: [campaign],
        broadcast_protection_settings: { min_interval_seconds: 2460, max_interval_seconds: 2460, max_consecutive_failures: 1 },
        broadcast_daily_quota: { ok: true, remaining: 1 }, broadcast_claim_batch: [recipient], broadcast_begin_send_paced: 'sending',
        broadcast_consecutive_failures: 1, broadcast_requeue_recipient_paced: { ok: true },
        broadcast_schedule_next: { ok: true, next_send_at: '2026-11-12T13:00:00Z', db_now: '2026-11-12T12:00:00Z' },
        broadcast_release_campaign: { status: 'paused' } })[options.url.split('/rpc/')[1]];
      if (options.url.includes('/channels?')) return [{ external_id: 'nubia', config: {} }];
      if (options.url.includes('evo.test')) return { statusCode: code, body: {} };
      return null;
    };
    const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'k', EVOLUTION_API_URL_NUBIA: 'https://evo.test', EVOLUTION_API_KEY_NUBIA: 'x', EVOLUTION_INSTANCE_NUBIA: 'nubia', BROADCAST_WORKER_BUDGET_SECONDS: '1' };
    await run.call({ helpers: { httpRequest } }, {}, env);
    assert.equal(calls.filter(url => url.includes('evo.test')).length, 1);
    assert.ok(calls.some(url => url.endsWith('/rpc/' + expected)));
  });
}

// IA-18/IA-25: o worker de disparos versionado em n8n/code é o fluxo por lease do servidor, identifica o canal por
// aliases de instância e agenda o próximo envio com o intervalo de proteção do número.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const code = fs.readFileSync('n8n/code/broadcast_campaign_worker.js', 'utf8');
const run = new AsyncFunction('$json', '$env', code);

async function execute({ channels, instance = 'nubia-oficial', protection = { min_interval_seconds: 2460, max_interval_seconds: 3300, max_consecutive_failures: 5 } }) {
  const calls = [];
  const campaign = { id: 'c1', tenant_id: 't1', tenant_slug: 'nubia', channel_type: 'whatsapp', name: 'Teste', message_text: 'Oi {nome}!' };
  const recipient = { id: 'r1', tenant_id: 't1', external_conversation_id: '5511999990000@s.whatsapp.net', contact_name: 'Ana', idempotency_key: 'k1' };
  const httpRequest = async (options) => {
    calls.push(options);
    const url = options.url;
    if (url.includes('/rest/v1/rpc/')) {
      const name = url.split('/rpc/')[1];
      const table = {
        broadcast_claim_opt_out_reviews: [],
        broadcast_claim_due_campaigns: [campaign],
        broadcast_recover_stale_leases: null,
        broadcast_protection_settings: protection,
        broadcast_daily_quota: { ok: true, remaining: 10 },
        broadcast_claim_batch: [recipient],
        broadcast_begin_send: 'sending',
        broadcast_record_result: null,
        broadcast_schedule_next: { ok: true, next_send_at: '2026-11-12T13:00:00Z', db_now: '2026-11-12T12:00:00Z' },
        broadcast_release_campaign: { status: 'sending' },
      };
      return table[name];
    }
    if (url.includes('/rest/v1/channels')) return channels;
    if (url.includes('evo.test')) return { statusCode: 201, body: { key: { id: 'MSG1' } } };
    return null;
  };
  const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'k', EVOLUTION_API_URL_NUBIA: 'https://evo.test', EVOLUTION_API_KEY_NUBIA: 'x',
    EVOLUTION_INSTANCE_NUBIA: instance, BROADCAST_WORKER_BUDGET_SECONDS: '1' };
  const out = (await run.call({ helpers: { httpRequest } }, {}, env)).map(item => item.json);
  return { out, calls };
}
const rpcCalls = (calls, name) => calls.filter(call => call.url.endsWith('/rpc/' + name));

test('código versionado é o fluxo por lease (não o worker legado)', () => {
  assert.match(code, /broadcast_claim_due_campaigns/);
  assert.match(code, /broadcast_claim_batch/);
  assert.match(code, /detectOptOuts/);
  assert.doesNotMatch(code, /input\.command !== 'broadcast_campaign'/);
});

test('canal identificado por config.instance_name, sem diferenciar caixa, e envio com id do provedor', async () => {
  const { out, calls } = await execute({ channels: [{ external_id: '5511', config: { instance_name: 'Nubia-Oficial' } }] });
  const report = out.find(item => item.campaign_id === 'c1');
  assert.equal(report.sent, 1, JSON.stringify(report));
  assert.equal(calls.filter(call => String(call.url).includes('evo.test')).length, 1);
  assert.equal(rpcCalls(calls, 'broadcast_record_result')[0].body.p_status, 'sent');
});

test('o próximo envio é agendado dentro do intervalo de proteção (acima de 40 minutos)', async () => {
  const { calls } = await execute({ channels: [{ external_id: 'nubia-oficial', config: {} }] });
  const next = rpcCalls(calls, 'broadcast_schedule_next')[0].body.p_delay_seconds;
  assert.ok(next >= 2460 && next <= 3300, 'atraso ' + next);
  assert.ok(next > 40 * 60);
});

test('instância que não pertence ao tenant pausa a campanha sem enviar', async () => {
  const { out, calls } = await execute({ channels: [{ external_id: 'outra', config: { instance_name: 'outra' } }] });
  const report = out.find(item => item.campaign_id === 'c1');
  assert.equal(report.paused, 'whatsapp_credentials_missing');
  assert.equal(calls.filter(call => String(call.url).includes('evo.test')).length, 0);
});

// Etapa 3 dos disparos: proteção do número. Cadência aleatória por tenant, limite diário e por campanha,
// pausa automática após falhas seguidas e classificação estruturada (status HTTP + corpo), nunca por texto.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  bootstrap, asUser, setSettings, createCampaign, createProvider, runWorker,
  TENANT_A, TENANT_B, MEMBER_A, MEMBER_B,
} = require('./broadcast_test_harness.cjs');

const campaignRow = async (db, id) => (await db.query(`select * from broadcast_campaigns where id = $1`, [id])).rows[0];
const recipients = async (db, id) => (await db.query(
  `select status, error from broadcast_campaign_recipients where campaign_id = $1 order by created_at`, [id])).rows;
const makeDue = (db, id) => db.query(`update broadcast_campaigns set next_send_at = clock_timestamp() - interval '1 second' where id = $1`, [id]);
const protection = async (db, tenant) => (await db.query(`select broadcast_protection_settings($1) as p`, [tenant.id])).rows[0].p;

async function withRandom(value, fn) {
  const original = Math.random;
  Math.random = () => value;
  try { return await fn(); } finally { Math.random = original; }
}

async function runUntilIdle(db, campaignId, provider, runs = 10) {
  for (let i = 0; i < runs; i += 1) {
    await runWorker(db, { provider });
    const campaign = await campaignRow(db, campaignId);
    if (campaign.status !== 'sending') return campaign;
    if (campaign.next_send_at && new Date(campaign.next_send_at) > new Date(Date.now() + 3600e3)) return campaign;
    await makeDue(db, campaignId);
  }
  return campaignRow(db, campaignId);
}

test('configuração por tenant vem de tenant_settings, com padrões e pisos de segurança no banco', async () => {
  const db = await bootstrap();
  const defaults = await protection(db, TENANT_A);
  for (const key of ['min_interval_seconds', 'max_interval_seconds', 'daily_limit', 'campaign_limit', 'max_consecutive_failures']) {
    assert.equal(typeof defaults[key], 'number', key);
  }
  assert.ok(defaults.max_interval_seconds >= defaults.min_interval_seconds);
  await setSettings(db, TENANT_A, { min_interval_seconds: 120, max_interval_seconds: 60, daily_limit: 40 });
  const custom = await protection(db, TENANT_A);
  assert.equal(custom.min_interval_seconds, 120);
  assert.equal(custom.max_interval_seconds, 120, 'máximo nunca abaixo do mínimo');
  assert.equal(custom.daily_limit, 40);
  await setSettings(db, TENANT_A, { min_interval_seconds: 0, daily_limit: -5 });
  const floored = await protection(db, TENANT_A);
  assert.ok(floored.min_interval_seconds > 0 && floored.daily_limit > 0, 'valores inválidos não desligam a proteção');
  assert.deepEqual(await protection(db, TENANT_B), defaults, 'configuração de um tenant não afeta outro');
});

test('intervalo entre envios é aleatório dentro da faixa do tenant e medido pelo banco', async () => {
  const db = await bootstrap();
  await setSettings(db, TENANT_A, { min_interval_seconds: 100, max_interval_seconds: 300 });
  const delays = [];
  for (const random of [0, 0.999]) {
    const campaignId = await createCampaign(db, { contacts: 2 });
    await withRandom(random, () => runWorker(db));
    const { rows: [row] } = await db.query(
      `select extract(epoch from next_send_at - (select max(last_attempt_at) from broadcast_campaign_recipients where campaign_id = $1)) as delay
       from broadcast_campaigns where id = $1`, [campaignId]);
    delays.push(Number(row.delay));
    await asUser(db, MEMBER_A, `select broadcast_control_campaign($1, 'cancel')`, [campaignId]);
  }
  assert.ok(delays[0] >= 99 && delays[0] <= 102, 'mínimo: ' + delays[0]);
  assert.ok(delays[1] >= 298 && delays[1] <= 301, 'máximo: ' + delays[1]);
});

test('limite diário do tenant segura a campanha até o dia seguinte, sem perder destinatários', async () => {
  const db = await bootstrap();
  await setSettings(db, TENANT_A, { daily_limit: 2 });
  const campaignId = await createCampaign(db, { contacts: 3 });
  const provider = createProvider();
  const campaign = await runUntilIdle(db, campaignId, provider);
  assert.equal(provider.sent.length, 2);
  assert.equal(campaign.status, 'sending', 'continua ativa, só aguardando o próximo dia');
  const { rows: [{ tomorrow }] } = await db.query(
    `select (date_trunc('day', now() at time zone 'America/Sao_Paulo') + interval '1 day') at time zone 'America/Sao_Paulo' as tomorrow`);
  assert.equal(new Date(campaign.next_send_at).getTime(), new Date(tomorrow).getTime());
  assert.deepEqual((await recipients(db, campaignId)).map(r => r.status), ['sent', 'sent', 'queued']);
});

test('limite por campanha é verificado ao enfileirar', async () => {
  const db = await bootstrap();
  await setSettings(db, TENANT_A, { campaign_limit: 2 });
  const campaignId = await createCampaign(db, { contacts: 3, enqueue: false });
  await assert.rejects(asUser(db, MEMBER_A, `select broadcast_enqueue_campaign($1, null, true)`, [campaignId]), /BROADCAST_CAMPAIGN_LIMIT/);
  assert.equal((await campaignRow(db, campaignId)).status, 'draft');
});

test('falhas seguidas pausam a campanha automaticamente; os pendentes ficam na fila', async () => {
  const db = await bootstrap();
  await setSettings(db, TENANT_A, { max_consecutive_failures: 2 });
  const campaignId = await createCampaign(db, { contacts: 4 });
  const provider = createProvider(() => ({ statusCode: 400, body: { status: 400, error: 'Bad Request' } }));
  const campaign = await runUntilIdle(db, campaignId, provider);
  assert.equal(provider.sent.length, 2);
  assert.equal(campaign.status, 'paused');
  assert.equal(campaign.last_error, 'consecutive_failures');
  assert.deepEqual((await recipients(db, campaignId)).map(r => r.status), ['failed', 'failed', 'queued', 'queued']);
});

test('falhas de um tenant não pausam o outro', async () => {
  const db = await bootstrap();
  await setSettings(db, TENANT_A, { max_consecutive_failures: 1 });
  await setSettings(db, TENANT_B, { max_consecutive_failures: 1 });
  const a = await createCampaign(db, { tenant: TENANT_A, member: MEMBER_A, contacts: 2 });
  const b = await createCampaign(db, { tenant: TENANT_B, member: MEMBER_B, contacts: 2 });
  const provider = createProvider(request => (request.url.includes('salao_a')
    ? { statusCode: 400, body: {} } : { statusCode: 201, body: { key: { id: 'ok-' + Math.random() } } }));
  await runWorker(db, { provider });
  assert.equal((await campaignRow(db, a)).status, 'paused');
  assert.equal((await campaignRow(db, b)).status, 'sending');
});

test('classificação estruturada da resposta da Evolution', async (t) => {
  const cases = [
    { name: 'número sem WhatsApp (400, exists=false) = failed', respond: () => ({ statusCode: 400,
      body: { status: 400, error: 'Bad Request', response: { message: [{ exists: false, jid: '5521990000000@s.whatsapp.net', number: '5521990000000' }] } } }),
      recipient: 'failed', error: 'number_not_on_whatsapp', campaign: 'sending' },
    { name: '5xx = unknown (pode ter saído)', respond: () => ({ statusCode: 502, body: {} }), recipient: 'unknown', error: 'http_502', campaign: 'sending' },
    { name: '2xx sem id = unknown', respond: () => ({ statusCode: 201, body: { status: 'PENDING' } }), recipient: 'unknown', error: 'no_message_id', campaign: 'sending' },
    { name: 'falha de transporte = unknown', respond: () => { throw Object.assign(new Error('Tempo esgotado'), { code: 'ETIMEDOUT' }); },
      recipient: 'unknown', error: 'transport_etimedout', campaign: 'sending' },
    { name: 'credencial recusada (401) volta para a fila e pausa', respond: () => ({ statusCode: 401, body: { error: 'Unauthorized' } }),
      recipient: 'queued', error: 'provider_rejected_http_401', campaign: 'paused' },
    { name: 'limite do provedor (429) volta para a fila e pausa', respond: () => ({ statusCode: 429, body: {} }),
      recipient: 'queued', error: 'provider_rejected_http_429', campaign: 'paused' },
    { name: 'instância inexistente (404) volta para a fila e pausa', respond: () => ({ statusCode: 404, body: {} }),
      recipient: 'queued', error: 'provider_rejected_http_404', campaign: 'paused' },
  ];
  for (const item of cases) {
    await t.test(item.name, async () => {
      const db = await bootstrap();
      await setSettings(db, TENANT_A, { max_consecutive_failures: 10 });
      const campaignId = await createCampaign(db, { contacts: 2 });
      await runWorker(db, { provider: createProvider(item.respond) });
      const [first] = await recipients(db, campaignId);
      assert.equal(first.status, item.recipient);
      assert.equal(first.error, item.error);
      const campaign = await campaignRow(db, campaignId);
      assert.equal(campaign.status, item.campaign);
      if (item.campaign === 'paused') assert.equal(campaign.last_error, item.error);
    });
  }
});

// Pedido de saída do cliente que recebeu disparo: a intenção é decidida pelo Gemini (saída estruturada
// com evidências), nunca por regex; o código só valida as evidências e registra o contrato
// noria_broadcast_opt_out_v1. Roda no worker do servidor, antes da fase de envio.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  bootstrap, setSettings, createCampaign, createProvider, createGemini, runWorker, envFor,
  TENANT_A, TENANT_B, MEMBER_B,
} = require('./broadcast_test_harness.cjs');

const CHAT = '5521990000000';

async function sentBroadcast(db, { tenant = TENANT_A, member, text = 'Promoção de corte esta semana!' } = {}) {
  const campaignId = await createCampaign(db, { tenant, member, contacts: 1, text });
  await runWorker(db);
  const { rows: [r] } = await db.query(`select status from broadcast_campaign_recipients where campaign_id = $1`, [campaignId]);
  assert.equal(r.status, 'sent');
  return campaignId;
}

async function inbound(db, { tenant = TENANT_A, chat = CHAT + '@s.whatsapp.net', text, at = 'clock_timestamp()', direction = 'inbound', sender = 'contact' }) {
  const { rows: [row] } = await db.query(
    `insert into channel_events(tenant_id, tenant_slug, channel_type, external_conversation_id, direction, sender_type, message_text, created_at)
     values ($1, $2, 'whatsapp', $3, $4, $5, $6, ${at}) returning id`, [tenant.id, tenant.slug, chat, direction, sender, text]);
  return row.id;
}

const optOuts = async db => (await db.query(`select tenant_id, contact_key, source, evidence from broadcast_opt_outs`)).rows;
const reviews = async db => (await db.query(`select event_id, status from broadcast_opt_out_reviews`)).rows;
const askedToLeave = input => ({ requested: true, evidence_ids: input.customer_messages.map(message => message.id) });

test('pedido de saída interpretado pelo Gemini entra na lista com a evidência', async () => {
  const db = await bootstrap();
  const campaignId = await sentBroadcast(db);
  const eventId = await inbound(db, { text: 'Por favor, não me mandem mais essas promoções' });
  const gemini = createGemini(askedToLeave);
  await runWorker(db, { gemini });
  assert.equal(gemini.calls.length, 1);
  const call = gemini.calls[0];
  assert.equal(call.headers['x-goog-api-key'], 'gemini-key-test');
  assert.match(call.url, /models\/gemini-test:generateContent$/);
  assert.equal(call.body.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(call.input.customer_messages.map(m => m.id), [eventId]);
  assert.equal(call.input.broadcast_message, 'Promoção de corte esta semana!');
  const rows = await optOuts(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].contact_key, CHAT);
  assert.equal(rows[0].source, 'customer_request');
  assert.deepEqual(rows[0].evidence.evidence_ids, [eventId]);
  assert.equal(rows[0].evidence.campaign_id, campaignId);
  assert.deepEqual(await reviews(db), [{ event_id: eventId, status: 'done' }]);
});

test('resposta que não é pedido de saída não bloqueia e não é analisada de novo', async () => {
  const db = await bootstrap();
  await sentBroadcast(db);
  await inbound(db, { text: 'Tem horário sábado?' });
  const gemini = createGemini(() => ({ requested: false, evidence_ids: [] }));
  await runWorker(db, { gemini });
  await runWorker(db, { gemini });
  assert.equal(gemini.calls.length, 1);
  assert.deepEqual(await optOuts(db), []);
});

test('evidência que não é da mensagem analisada é descartada', async () => {
  const db = await bootstrap();
  await sentBroadcast(db);
  await inbound(db, { text: 'ok' });
  await runWorker(db, { gemini: createGemini(() => ({ requested: true, evidence_ids: ['inventado'] })) });
  assert.deepEqual(await optOuts(db), []);
});

test('só analisa resposta de quem recebeu disparo, do próprio tenant e dentro da janela', async () => {
  const db = await bootstrap();
  await setSettings(db, TENANT_A, { opt_out_window_days: 7 });
  await sentBroadcast(db);
  await inbound(db, { chat: '5521977777777@s.whatsapp.net', text: 'parem de me mandar mensagem' });
  await inbound(db, { tenant: TENANT_B, text: 'parem de me mandar mensagem' });
  await inbound(db, { direction: 'outbound', sender: 'assistant', text: 'Olá!' });
  await db.query(`update broadcast_campaign_recipients set sent_at = now() - interval '9 days'`);
  await inbound(db, { text: 'parem de me mandar mensagem' });
  const gemini = createGemini(askedToLeave);
  await runWorker(db, { gemini });
  assert.equal(gemini.calls.length, 0);
});

test('sem cota de Gemini a análise espera, sem chamar o modelo, e volta depois', async () => {
  const db = await bootstrap();
  await sentBroadcast(db);
  const eventId = await inbound(db, { text: 'quero sair da lista' });
  await db.query(`update test_gemini_quota set allowed = false`);
  const gemini = createGemini(askedToLeave);
  await runWorker(db, { gemini });
  assert.equal(gemini.calls.length, 0);
  assert.deepEqual(await reviews(db), [{ event_id: eventId, status: 'deferred' }]);
  await db.query(`update test_gemini_quota set allowed = true`);
  await db.query(`update broadcast_opt_out_reviews set locked_until = now() - interval '1 second'`);
  await runWorker(db, { gemini });
  assert.equal(gemini.calls.length, 1);
  assert.equal((await optOuts(db)).length, 1);
});

test('pedido recebido antes do próximo envio já vale na mesma execução; falha do Gemini não para envios', async () => {
  const db = await bootstrap();
  await sentBroadcast(db);
  const second = await createCampaign(db, { contacts: 2, text: 'Nova promoção' });
  await inbound(db, { text: 'não quero mais receber' });
  const provider = createProvider();
  await runWorker(db, { provider, gemini: createGemini(askedToLeave) });
  const { rows } = await db.query(`select external_conversation_id as chat, status from broadcast_campaign_recipients where campaign_id = $1 order by created_at`, [second]);
  assert.deepEqual(rows.map(r => r.status), ['skipped', 'sent']);
  assert.deepEqual(provider.sent.map(r => r.body.number), ['5521990000001']);

  const db2 = await bootstrap();
  await sentBroadcast(db2);
  await createCampaign(db2, { contacts: 2 });
  await inbound(db2, { text: 'oi' });
  const provider2 = createProvider();
  const failing = createGemini(() => { throw new Error('Gemini fora do ar'); });
  await runWorker(db2, { provider: provider2, gemini: failing });
  assert.equal(provider2.sent.length, 1, 'envio segue mesmo com o Gemini fora');
  assert.equal((await reviews(db2))[0].status, 'deferred');
});

test('sem chave do Gemini a detecção não roda e o envio segue', async () => {
  const db = await bootstrap();
  await sentBroadcast(db);
  await inbound(db, { text: 'sair' });
  const env = envFor(); delete env.GEMINI_API_KEY;
  const gemini = createGemini(askedToLeave);
  await runWorker(db, { gemini, env });
  assert.equal(gemini.calls.length, 0);
  assert.deepEqual(await reviews(db), []);
});

test('tenant B só tem os próprios pedidos analisados', async () => {
  const db = await bootstrap();
  await sentBroadcast(db, { tenant: TENANT_B, member: MEMBER_B });
  await inbound(db, { tenant: TENANT_B, text: 'me tira dessa lista' });
  await runWorker(db, { gemini: createGemini(askedToLeave) });
  const rows = await optOuts(db);
  assert.deepEqual(rows.map(r => r.tenant_id), [TENANT_B.id]);
});

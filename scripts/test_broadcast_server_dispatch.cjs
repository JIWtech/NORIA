// Etapa 2 dos disparos: o envio sai do navegador e roda no n8n (schedule de 1 min do workflow de Entrada),
// usando as RPCs atômicas, sempre filtrado por tenant e com horários vindos do banco.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {
  bootstrap, asUser, createCampaign, createProvider, createPostgrest, envFor, runWorker, read,
  TENANT_A, TENANT_B, MEMBER_A, MEMBER_B,
} = require('./broadcast_test_harness.cjs');

const statuses = async (db, campaignId) => (await db.query(
  `select status, count(*)::int as n from broadcast_campaign_recipients where campaign_id = $1 group by 1 order by 1`, [campaignId])).rows;
const campaignRow = async (db, campaignId) => (await db.query(`select * from broadcast_campaigns where id = $1`, [campaignId])).rows[0];
// Simula a passagem do tempo até o próximo envio permitido sem depender do relógio do processo.
const makeDue = (db, campaignId) => db.query(`update broadcast_campaigns set next_send_at = clock_timestamp() - interval '1 second' where id = $1`, [campaignId]);

async function drain(db, campaignId, options = {}) {
  const provider = options.provider || createProvider();
  for (let run = 0; run < 20; run += 1) {
    await runWorker(db, { ...options, provider });
    const campaign = await campaignRow(db, campaignId);
    if (!['queued', 'scheduled', 'sending'].includes(campaign.status)) break;
    await makeDue(db, campaignId);
  }
  return provider;
}

test('enfileirar exige membro do tenant e consentimento; horário e autor vêm do servidor', async () => {
  const db = await bootstrap();
  const campaignId = await createCampaign(db, { enqueue: false });
  await assert.rejects(asUser(db, MEMBER_B, `select broadcast_enqueue_campaign($1, null, true)`, [campaignId]), /BROADCAST_FORBIDDEN/);
  await assert.rejects(asUser(db, MEMBER_A, `select broadcast_enqueue_campaign($1, null, false)`, [campaignId]), /BROADCAST_CONSENT_REQUIRED/);
  await asUser(db, MEMBER_A, `select broadcast_enqueue_campaign($1, null, true)`, [campaignId]);
  const campaign = await campaignRow(db, campaignId);
  assert.equal(campaign.status, 'queued');
  assert.equal(campaign.consent_confirmed_by, MEMBER_A);
  assert.ok(campaign.consent_confirmed_at && campaign.scheduled_at);
  await assert.rejects(asUser(db, MEMBER_A, `select broadcast_enqueue_campaign($1, null, true)`, [campaignId]), /BROADCAST_NOT_DRAFT/);
});

test('worker envia a campanha da fila pela Evolution do próprio tenant e registra o evento', async () => {
  const db = await bootstrap();
  const campaignId = await createCampaign(db, { contacts: 2 });
  const provider = await drain(db, campaignId);
  assert.equal(provider.sent.length, 2);
  for (const request of provider.sent) {
    assert.equal(request.url, 'https://evo.test/salao_a/message/sendText/inst-a');
    assert.equal(request.headers.apikey, 'key-salao_a');
    assert.match(request.body.number, /^552199000\d{4}$/);
  }
  assert.deepEqual(await statuses(db, campaignId), [{ status: 'sent', n: 2 }]);
  const campaign = await campaignRow(db, campaignId);
  assert.equal(campaign.status, 'sent');
  assert.equal(campaign.sent_count, 2);
  assert.ok(campaign.sent_at && campaign.started_at, 'datas finais gravadas pelo banco');
  const { rows: events } = await db.query(`select tenant_id, tenant_slug, direction, service, command_id from channel_events order by created_at`);
  assert.equal(events.length, 2);
  assert.ok(events.every(event => event.tenant_id === TENANT_A.id && event.tenant_slug === TENANT_A.slug
    && event.direction === 'outbound' && event.service === 'broadcast' && event.command_id.startsWith('bcast:' + campaignId)));
});

test('respeita o intervalo: uma execução não envia de novo antes do próximo horário do banco', async () => {
  const db = await bootstrap();
  const campaignId = await createCampaign(db, { contacts: 3 });
  const provider = createProvider();
  await runWorker(db, { provider });
  await runWorker(db, { provider });
  assert.equal(provider.sent.length, 1, 'segundo ciclo ainda não está no horário');
  const campaign = await campaignRow(db, campaignId);
  assert.ok(new Date(campaign.next_send_at) > new Date(campaign.started_at));
});

test('campanha antiga na fila sem agendamento do servidor nunca é enviada', async () => {
  const db = await bootstrap();
  const { rows: [legacy] } = await db.query(
    `insert into broadcast_campaigns(tenant_id, name, channel_type, message_text, status, consent_confirmed_at, send_interval_seconds)
     values ($1, 'Legada', 'whatsapp', 'Oi', 'queued', now() - interval '30 days', 300) returning id`, [TENANT_A.id]);
  await db.query(`insert into broadcast_campaign_recipients(tenant_id, campaign_id, channel_type, external_conversation_id)
    values ($1, $2, 'whatsapp', '5521988887777')`, [TENANT_A.id, legacy.id]);
  const { provider } = await runWorker(db);
  assert.equal(provider.sent.length, 0);
  const campaign = await campaignRow(db, legacy.id);
  assert.equal(campaign.status, 'queued');
  assert.equal(campaign.started_at, null);
});

test('agendada para o futuro só sai quando o horário do banco chega', async () => {
  const db = await bootstrap();
  const { rows: [{ at }] } = await db.query(`select (now() + interval '2 hours') as at`);
  const campaignId = await createCampaign(db, { contacts: 1, scheduledAt: at });
  assert.equal((await campaignRow(db, campaignId)).status, 'scheduled');
  const { provider } = await runWorker(db);
  assert.equal(provider.sent.length, 0);
  await db.query(`update broadcast_campaigns set scheduled_at = now() - interval '1 minute' where id = $1`, [campaignId]);
  const second = await runWorker(db);
  assert.equal(second.provider.sent.length, 1);
});

test('cada tenant usa só as próprias credenciais e linhas', async () => {
  const db = await bootstrap();
  await createCampaign(db, { tenant: TENANT_A, member: MEMBER_A, contacts: 1 });
  await createCampaign(db, { tenant: TENANT_B, member: MEMBER_B, contacts: 1 });
  const { provider, postgrest } = await runWorker(db);
  const urls = provider.sent.map(request => request.url).sort();
  assert.deepEqual(urls, ['https://evo.test/loja_b/message/sendText/inst-b', 'https://evo.test/salao_a/message/sendText/inst-a']);
  const reads = postgrest.calls.filter(call => call.method === 'GET');
  assert.ok(reads.length > 0 && reads.every(call => /tenant_id=eq\./.test(call.query)), 'toda leitura de tabela filtra por tenant_id');
});

test('um tenant processa uma campanha por vez (o número não recebe duas cadências)', async () => {
  const db = await bootstrap();
  await createCampaign(db, { contacts: 2 });
  await createCampaign(db, { contacts: 2 });
  const { provider } = await runWorker(db);
  assert.equal(provider.sent.length, 1);
});

test('duas execuções simultâneas não enviam o mesmo destinatário duas vezes', async () => {
  const db = await bootstrap();
  await createCampaign(db, { contacts: 3 });
  const provider = createProvider();
  const postgrest = createPostgrest(db);
  await Promise.all([runWorker(db, { provider, postgrest }), runWorker(db, { provider, postgrest })]);
  const numbers = provider.sent.map(request => request.body.number);
  assert.equal(new Set(numbers).size, numbers.length);
  assert.equal(numbers.length, 1);
});

test('pausar e cancelar pelo painel param o worker; só membros do tenant controlam', async () => {
  const db = await bootstrap();
  const campaignId = await createCampaign(db, { contacts: 2 });
  await assert.rejects(asUser(db, MEMBER_B, `select broadcast_control_campaign($1, 'pause')`, [campaignId]), /BROADCAST_FORBIDDEN/);
  await asUser(db, MEMBER_A, `select broadcast_control_campaign($1, 'pause')`, [campaignId]);
  assert.equal((await runWorker(db)).provider.sent.length, 0);
  await asUser(db, MEMBER_A, `select broadcast_control_campaign($1, 'resume')`, [campaignId]);
  assert.equal((await runWorker(db)).provider.sent.length, 1);
  await asUser(db, MEMBER_A, `select broadcast_control_campaign($1, 'cancel')`, [campaignId]);
  await makeDue(db, campaignId);
  assert.equal((await runWorker(db)).provider.sent.length, 0);
  assert.deepEqual(await statuses(db, campaignId), [{ status: 'cancelled', n: 1 }, { status: 'sent', n: 1 }]);
});

test('falha de transporte vira unknown e nunca é reenviada automaticamente', async () => {
  const db = await bootstrap();
  const campaignId = await createCampaign(db, { contacts: 1 });
  const provider = createProvider(() => { throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }); });
  await runWorker(db, { provider });
  assert.deepEqual(await statuses(db, campaignId), [{ status: 'unknown', n: 1 }]);
  await makeDue(db, campaignId);
  const again = await runWorker(db);
  assert.equal(again.provider.sent.length, 0);
  assert.equal((await campaignRow(db, campaignId)).status, 'partial_error');
});

test('o worker não envia horários do relógio do processo para o banco', async () => {
  const db = await bootstrap();
  await createCampaign(db, { contacts: 1 });
  const { postgrest } = await runWorker(db);
  const writes = postgrest.calls.filter(call => call.method !== 'GET');
  for (const call of writes) {
    for (const key of Object.keys(call.body || {})) assert.doesNotMatch(key, /_at$/, call.route + ' enviou ' + key);
  }
});

test('build liga o worker ao schedule de 1 min do workflow de Entrada', () => {
  const workflow = JSON.parse(fs.readFileSync(path.join(__dirname, '../n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json'), 'utf8'));
  assert.equal(workflow.id, '3N5oN6sxtir9lFrA');
  const node = workflow.nodes.find(item => item.name === 'Processar Disparos');
  assert.ok(node, 'nó Processar Disparos ausente');
  assert.equal(node.type, 'n8n-nodes-base.code');
  assert.equal(node.parameters.jsCode, read('n8n/code/broadcast_campaign_worker.js').replace(/\r\n/g, '\n').trimEnd());
  const trigger = workflow.nodes.find(item => item.name === 'Verificar Follow-ups Vencidos');
  assert.equal(trigger.type, 'n8n-nodes-base.scheduleTrigger');
  const targets = workflow.connections['Verificar Follow-ups Vencidos'].main[0].map(link => link.node);
  assert.deepEqual(targets.sort(), ['Processar Disparos', 'Processar Follow-ups']);
  assert.equal(workflow.nodes.filter(item => item.name === 'Processar Disparos').length, 1);
});

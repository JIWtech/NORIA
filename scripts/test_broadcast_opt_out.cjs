// Etapa 4 dos disparos: lista de bloqueio (opt-out) por tenant. Quem pediu para sair, ou foi bloqueado
// pela equipe, não recebe disparo: nem ao enfileirar, nem no momento do envio.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  bootstrap, asUser, createCampaign, createProvider, runWorker,
  TENANT_A, TENANT_B, MEMBER_A, MEMBER_B,
} = require('./broadcast_test_harness.cjs');

const MANAGER_A = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const NUMBER = '5521990000000';
const proof = (ids = ['evt-1']) => ({ contract: 'noria_broadcast_opt_out_v1', source: 'customer_request', evidence_ids: ids });

async function setup() {
  const db = await bootstrap();
  await db.query(`insert into auth.users values ($1)`, [MANAGER_A]);
  await db.query(`insert into tenant_members values ($1, $2, 'manager', 'active')`, [TENANT_A.id, MANAGER_A]);
  return db;
}
const statuses = async (db, id) => (await db.query(
  `select external_conversation_id as chat, status, error from broadcast_campaign_recipients where campaign_id = $1 order by created_at`, [id])).rows;
const campaignRow = async (db, id) => (await db.query(`select * from broadcast_campaigns where id = $1`, [id])).rows[0];
const makeDue = (db, id) => db.query(`update broadcast_campaigns set next_send_at = clock_timestamp() - interval '1 second' where id = $1`, [id]);

test('equipe bloqueia contato do próprio tenant; desbloquear exige gestor', async () => {
  const db = await setup();
  await asUser(db, MEMBER_A, `select broadcast_set_opt_out($1, 'whatsapp', $2, true, 'pediu por telefone')`, [TENANT_A.id, NUMBER + '@s.whatsapp.net']);
  const { rows } = await asUser(db, MEMBER_A, `select contact_key, source, created_by from broadcast_opt_outs`);
  assert.deepEqual(rows, [{ contact_key: NUMBER, source: 'operator', created_by: MEMBER_A }]);
  await assert.rejects(asUser(db, MEMBER_B, `select broadcast_set_opt_out($1, 'whatsapp', $2, true, null)`, [TENANT_A.id, NUMBER]), /BROADCAST_FORBIDDEN/);
  assert.equal((await asUser(db, MEMBER_B, `select * from broadcast_opt_outs`)).rows.length, 0, 'outro tenant não enxerga a lista');
  await assert.rejects(asUser(db, MEMBER_A, `select broadcast_set_opt_out($1, 'whatsapp', $2, false, null)`, [TENANT_A.id, NUMBER]), /BROADCAST_FORBIDDEN/);
  await asUser(db, MANAGER_A, `select broadcast_set_opt_out($1, 'whatsapp', $2, false, null)`, [TENANT_A.id, NUMBER]);
  assert.equal((await db.query(`select count(*)::int as n from broadcast_opt_outs`)).rows[0].n, 0);
});

test('ao enfileirar, bloqueados são pulados; lista só de bloqueados não enfileira', async () => {
  const db = await setup();
  await asUser(db, MEMBER_A, `select broadcast_set_opt_out($1, 'whatsapp', '5521990000000', true, null)`, [TENANT_A.id]);
  const campaignId = await createCampaign(db, { contacts: 2 });
  assert.deepEqual((await statuses(db, campaignId)).map(r => [r.status, r.error]), [['skipped', 'opt_out'], ['queued', null]]);
  assert.equal((await campaignRow(db, campaignId)).total_recipients, 2);
  const onlyBlocked = await createCampaign(db, { contacts: 1, enqueue: false });
  await assert.rejects(asUser(db, MEMBER_A, `select broadcast_enqueue_campaign($1, null, true)`, [onlyBlocked]), /BROADCAST_NO_RECIPIENTS/);
});

test('pedido de saída registrado depois de enfileirar é respeitado no momento do envio', async () => {
  const db = await setup();
  const campaignId = await createCampaign(db, { contacts: 2 });
  await db.query(`select broadcast_register_opt_out($1, 'whatsapp', $2, $3::jsonb)`, [TENANT_A.id, NUMBER + '@s.whatsapp.net', JSON.stringify(proof())]);
  const provider = createProvider();
  for (let i = 0; i < 4; i += 1) { await runWorker(db, { provider }); await makeDue(db, campaignId); }
  assert.deepEqual(provider.sent.map(request => request.body.number), ['5521990000001']);
  assert.deepEqual((await statuses(db, campaignId)).map(r => r.status), ['skipped', 'sent']);
  const campaign = await campaignRow(db, campaignId);
  assert.equal(campaign.status, 'sent');
});

test('registro automático exige o contrato estruturado com evidências e é só do backend', async () => {
  const db = await setup();
  await assert.rejects(db.query(`select broadcast_register_opt_out($1, 'whatsapp', $2, $3::jsonb)`,
    [TENANT_A.id, NUMBER, JSON.stringify({ contract: 'noria_broadcast_opt_out_v1', evidence_ids: [] })]), /BROADCAST_OPT_OUT_PROOF/);
  await assert.rejects(db.query(`select broadcast_register_opt_out($1, 'whatsapp', $2, $3::jsonb)`,
    [TENANT_A.id, NUMBER, JSON.stringify({ evidence_ids: ['x'] })]), /BROADCAST_OPT_OUT_PROOF/);
  const { rows: [fn] } = await db.query(`select oid from pg_proc where proname = 'broadcast_register_opt_out'`);
  for (const role of ['anon', 'authenticated']) {
    assert.equal((await db.query(`select has_function_privilege($1, $2::oid, 'execute') as ok`, [role, fn.oid])).rows[0].ok, false);
  }
  const first = (await db.query(`select broadcast_register_opt_out($1, 'whatsapp', $2, $3::jsonb) as r`, [TENANT_A.id, NUMBER, JSON.stringify(proof())])).rows[0].r;
  const again = (await db.query(`select broadcast_register_opt_out($1, 'whatsapp', $2, $3::jsonb) as r`, [TENANT_A.id, NUMBER, JSON.stringify(proof(['evt-2']))])).rows[0].r;
  assert.equal(first.ok, true);
  assert.equal(again.ok, true, 'idempotente');
  const { rows } = await db.query(`select source, evidence from broadcast_opt_outs`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, 'customer_request');
  assert.deepEqual(rows[0].evidence.evidence_ids, ['evt-1']);
});

test('bloqueio de um tenant não afeta o mesmo número em outro tenant', async () => {
  const db = await setup();
  await db.query(`select broadcast_register_opt_out($1, 'whatsapp', $2, $3::jsonb)`, [TENANT_A.id, NUMBER, JSON.stringify(proof())]);
  const campaignB = await createCampaign(db, { tenant: TENANT_B, member: MEMBER_B, contacts: 1 });
  const { provider } = await runWorker(db);
  assert.deepEqual(provider.sent.map(request => request.url), ['https://evo.test/loja_b/message/sendText/inst-b']);
  assert.deepEqual((await statuses(db, campaignB)).map(r => r.status), ['sent']);
});

// Etapa 1 dos disparos: o repositório precisa recriar o schema de broadcasts que já existe em produção
// (colunas de lease/idempotência, constraints de status atuais e as RPCs atômicas), de forma idempotente.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(path.join(
  process.env.MAGIA_TEST_MODULES || path.join(require('node:os').tmpdir(), 'magia-diag-tools/node_modules'),
  '@electric-sql/pglite'
));

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const ALIGNMENT = 'supabase/migrations/20261109192247_broadcast_production_alignment.sql';

const tenantA = '11111111-1111-1111-1111-111111111111';
const tenantB = '22222222-2222-2222-2222-222222222222';
const memberA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

async function bootstrap({ applyTwice = false } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table tenants(id uuid primary key, slug text, status text);
    create table tenant_members(tenant_id uuid, user_id uuid, role text, status text);
    create table appointments(id uuid primary key default gen_random_uuid(), tenant_id uuid, starts_at timestamptz);
    create publication supabase_realtime;
    grant usage on schema public, auth to anon, authenticated, service_role;
    insert into auth.users values ('${memberA}');
    insert into tenants values ('${tenantA}', 'a', 'active'), ('${tenantB}', 'b', 'active');
    insert into tenant_members values ('${tenantA}', '${memberA}', 'owner', 'active');
  `);
  await db.exec(read('supabase/migrations/010_broadcasts_and_appointments.sql'));
  await db.exec(read('supabase/migrations/023_broadcast_campaign_controls.sql'));
  await db.exec(read(ALIGNMENT));
  if (applyTwice) await db.exec(read(ALIGNMENT));
  await db.exec('grant select, insert, update on all tables in schema public to authenticated, service_role;');
  return db;
}

async function seedCampaign(db, { tenant = tenantA, status = 'sending', recipients = 2 } = {}) {
  const { rows: [campaign] } = await db.query(
    `insert into broadcast_campaigns(tenant_id, name, channel_type, message_text, status, send_interval_seconds)
     values ($1, 'Campanha', 'whatsapp', 'Oi', $2, 300) returning id`, [tenant, status]);
  for (let i = 0; i < recipients; i += 1) {
    await db.query(
      `insert into broadcast_campaign_recipients(tenant_id, campaign_id, channel_type, external_conversation_id, contact_name, idempotency_key, created_at)
       values ($1, $2, 'whatsapp', $3, 'Contato', $4, now() + make_interval(secs => $5))`,
      [tenant, campaign.id, '55219000000' + i, 'bcast:' + campaign.id + ':' + i, i]);
  }
  return campaign.id;
}

test('migração recria as colunas de lease, idempotência e contadores que existem em produção', async () => {
  const db = await bootstrap();
  const { rows } = await db.query(`select table_name || '.' || column_name as col, data_type
    from information_schema.columns where table_schema = 'public' and table_name like 'broadcast%'`);
  const types = Object.fromEntries(rows.map(row => [row.col, row.data_type]));
  for (const col of ['idempotency_key', 'lease_token', 'locked_until', 'claimed_at', 'attempt_count', 'last_attempt_at']) {
    assert.ok(types['broadcast_campaign_recipients.' + col], 'falta broadcast_campaign_recipients.' + col);
  }
  for (const col of ['unknown_count', 'lease_token', 'locked_until', 'consent_confirmed_at', 'consent_confirmed_by', 'started_at', 'last_error']) {
    assert.ok(types['broadcast_campaigns.' + col], 'falta broadcast_campaigns.' + col);
  }
  assert.equal(types['broadcast_campaigns.send_interval_seconds'], 'integer');
});

test('constraints de status e intervalo aceitam os valores usados em produção', async () => {
  const db = await bootstrap();
  const campaignId = await seedCampaign(db, { status: 'paused' });
  await db.query(`update broadcast_campaign_recipients set status = 'unknown' where campaign_id = $1`, [campaignId]);
  await assert.rejects(db.query(`update broadcast_campaigns set status = 'inventado' where id = $1`, [campaignId]));
  await assert.rejects(db.query(`update broadcast_campaigns set send_interval_seconds = 1 where id = $1`, [campaignId]));
  await assert.rejects(db.query(
    `insert into broadcast_campaign_recipients(tenant_id, campaign_id, external_conversation_id) values ($1, $2, '552190000000')`,
    [tenantA, campaignId]), /duplicate|unique/i);
});

test('RPCs atômicas existem só para o backend (service_role), nunca para anon/authenticated', async () => {
  const db = await bootstrap();
  const names = ['broadcast_claim_batch', 'broadcast_mark_sending', 'broadcast_record_result',
    'broadcast_recover_stale_leases', 'broadcast_cancel_campaign'];
  for (const name of names) {
    const { rows } = await db.query(`select p.oid, p.prosecdef from pg_proc p where p.proname = $1`, [name]);
    assert.equal(rows.length, 1, name + ' deve existir uma única vez');
    assert.equal(rows[0].prosecdef, true, name + ' deve ser security definer');
    for (const role of ['anon', 'authenticated']) {
      const { rows: [grant] } = await db.query(`select has_function_privilege($1, $2::oid, 'execute') as ok`, [role, rows[0].oid]);
      assert.equal(grant.ok, false, role + ' não pode executar ' + name);
    }
    const { rows: [service] } = await db.query(`select has_function_privilege('service_role', $1::oid, 'execute') as ok`, [rows[0].oid]);
    assert.equal(service.ok, true, 'service_role precisa executar ' + name);
  }
});

test('ciclo claim → sending → sent atualiza contadores e finaliza a campanha', async () => {
  const db = await bootstrap();
  const campaignId = await seedCampaign(db, { recipients: 2 });
  const lease = '99999999-9999-9999-9999-999999999999';
  const { rows: claimed } = await db.query(`select * from broadcast_claim_batch($1, $2, 10, 120)`, [campaignId, lease]);
  assert.equal(claimed.length, 2);
  assert.equal(claimed[0].attempt_count, 1);
  const { rows: again } = await db.query(`select * from broadcast_claim_batch($1, $2, 10, 120)`, [campaignId, lease]);
  assert.equal(again.length, 0, 'lease válida não pode ser reivindicada de novo');
  for (const recipient of claimed) {
    const { rows: [mark] } = await db.query(`select broadcast_mark_sending($1, $2) as ok`, [recipient.id, lease]);
    assert.equal(mark.ok, true);
    const { rows: [result] } = await db.query(`select broadcast_record_result($1, $2, 'sent', $3, null) as r`, [recipient.id, lease, 'wamid-' + recipient.id]);
    assert.equal(result.r.ok, true);
  }
  const { rows: [campaign] } = await db.query(`select status, sent_count, unknown_count from broadcast_campaigns where id = $1`, [campaignId]);
  assert.deepEqual(campaign, { status: 'sent', sent_count: 2, unknown_count: 0 });
  const { rows: [late] } = await db.query(`select broadcast_record_result($1, $2, 'failed', null, 'tarde') as r`, [claimed[0].id, lease]);
  assert.equal(late.r.note, 'already_sent', 'sent é imutável');
});

test('lease vencida: claimed volta para a fila, sending vira unknown (nunca reenvio cego)', async () => {
  const db = await bootstrap();
  const campaignId = await seedCampaign(db, { recipients: 2 });
  const lease = '88888888-8888-8888-8888-888888888888';
  const { rows: claimed } = await db.query(`select * from broadcast_claim_batch($1, $2, 10, 120)`, [campaignId, lease]);
  await db.query(`select broadcast_mark_sending($1, $2)`, [claimed[0].id, lease]);
  await db.query(`update broadcast_campaign_recipients set locked_until = now() - interval '1 minute' where campaign_id = $1`, [campaignId]);
  const { rows: [recovered] } = await db.query(`select broadcast_recover_stale_leases($1) as r`, [campaignId]);
  assert.deepEqual(recovered.r, { requeued: 1, marked_unknown: 1 });
  const { rows: [campaign] } = await db.query(`select unknown_count from broadcast_campaigns where id = $1`, [campaignId]);
  assert.equal(campaign.unknown_count, 1);
});

test('cancelar afeta só destinatários na fila ou reservados', async () => {
  const db = await bootstrap();
  const campaignId = await seedCampaign(db, { recipients: 3 });
  await db.query(`update broadcast_campaign_recipients set status = 'sent' where external_conversation_id = '552190000000'`);
  const { rows: [cancelled] } = await db.query(`select broadcast_cancel_campaign($1) as r`, [campaignId]);
  assert.deepEqual(cancelled.r, { ok: true, cancelled_recipients: 2 });
  const { rows } = await db.query(`select status, count(*)::int as n from broadcast_campaign_recipients where campaign_id = $1 group by 1 order by 1`, [campaignId]);
  assert.deepEqual(rows, [{ status: 'cancelled', n: 2 }, { status: 'sent', n: 1 }]);
});

test('reaplicar a migração é seguro (idempotente)', async () => {
  const db = await bootstrap({ applyTwice: true });
  const { rows: [count] } = await db.query(`select count(*)::int as n from pg_proc where proname like 'broadcast\\_%'`);
  assert.equal(count.n, 5);
});

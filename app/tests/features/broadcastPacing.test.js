import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

test('duas campanhas do mesmo canal respeitam a reserva após interrupção', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table tenants(id uuid primary key);
      create table broadcast_campaigns(id uuid primary key, tenant_id uuid, channel_type text, lease_token uuid, locked_until timestamptz, next_send_at timestamptz, updated_at timestamptz, status text default 'sending');
      create table broadcast_campaign_recipients(id uuid primary key, tenant_id uuid, campaign_id uuid, channel_type text, status text, lease_token uuid, locked_until timestamptz, external_conversation_id text, error text);
      create table broadcast_opt_outs(tenant_id uuid, channel_type text, contact_key text);
      create function broadcast_contact_key(text) returns text language sql as $$ select $1 $$;
      create function broadcast_protection_settings(uuid) returns jsonb language sql as $$ select '{"min_interval_seconds":2460}'::jsonb $$;
      insert into tenants values ('00000000-0000-0000-0000-000000000001');
      insert into broadcast_campaigns(id,tenant_id,channel_type,lease_token,locked_until) values
      ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','whatsapp','00000000-0000-0000-0000-000000000021',now()+interval '2 minutes'),
      ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000001','whatsapp','00000000-0000-0000-0000-000000000022',now()+interval '2 minutes');
      insert into broadcast_campaign_recipients(id,tenant_id,campaign_id,channel_type,status,lease_token,locked_until) values
      ('00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','whatsapp','claimed','00000000-0000-0000-0000-000000000021',now()+interval '2 minutes'),
      ('00000000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000012','whatsapp','claimed','00000000-0000-0000-0000-000000000022',now()+interval '2 minutes');`);
    const definition = (path, name) => {
      const sql = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
      return sql.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?end \\$\\$;`, 'i'))[0];
    };
    await db.exec(definition('../../../supabase/migrations/20261109192247_broadcast_production_alignment.sql', 'broadcast_mark_sending'));
    await db.exec(definition('../../../supabase/migrations/20261109192425_broadcast_opt_out.sql', 'broadcast_begin_send'));
    await db.exec(definition('../../../supabase/migrations/20261109192353_broadcast_number_protection.sql', 'broadcast_requeue_recipient'));
    await db.exec("update broadcast_campaigns set next_send_at=clock_timestamp()+interval '50 minutes' where id='00000000-0000-0000-0000-000000000012'");
    if (process.env.BROADCAST_BASELINE !== '1') await db.exec(fs.readFileSync(new URL('../../../supabase/migrations/20261121214308_broadcast_pacing_v1.sql', import.meta.url), 'utf8'));
    if (process.env.BROADCAST_BASELINE !== '1') {
      const seeded = await db.query("select p.next_send_at = c.next_send_at as preserved from broadcast_channel_pacing p join broadcast_campaigns c on c.id='00000000-0000-0000-0000-000000000012'");
      assert.equal(seeded.rows[0]?.preserved, true, 'cadência existente deve ser preservada');
      await db.exec("update broadcast_channel_pacing set next_send_at=clock_timestamp()-interval '1 minute'");
    }
    const name = process.env.BROADCAST_BASELINE === '1' ? 'broadcast_begin_send' : 'broadcast_begin_send_paced';
    const suffix = process.env.BROADCAST_BASELINE === '1' ? '' : ',2460';
    const started = (await db.query('select clock_timestamp() as t')).rows[0].t;
    const [first, second] = await Promise.all([
      db.query(`select ${name}('00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000021'${suffix}) as result`),
      db.query(`select ${name}('00000000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000022'${suffix}) as result`),
    ]);
    assert.deepEqual([first.rows[0].result, second.rows[0].result].sort(), ['pending_review', 'sending']);
    const reservation = await db.query('select next_send_at >= $1::timestamptz + interval \'41 minutes\' as valid from broadcast_channel_pacing', [started]);
    assert.equal(reservation.rows[0].valid, true);
    // Interrupção após envio, inclusive quando já se passaram mais de 41 minutos.
    await db.exec("update broadcast_channel_pacing set next_send_at=clock_timestamp()-interval '1 minute'");
    const stillBlocked = await db.query("select broadcast_begin_send_paced('00000000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000022',2460) as result");
    assert.equal(stillBlocked.rows[0].result, 'pending_review');
    const unresolved = await db.query("select broadcast_schedule_next('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000021',2460) as result");
    assert.equal(unresolved.rows[0].result.reason, 'delivery_unresolved');
    await db.exec("update broadcast_campaign_recipients set status='sent' where id='00000000-0000-0000-0000-000000000031'");
    const beforeSchedule = (await db.query('select clock_timestamp() as t')).rows[0].t;
    await db.query("select broadcast_schedule_next('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000021',2460)");
    const extended = await db.query('select next_send_at >= $1::timestamptz + interval \'41 minutes\' as valid from broadcast_channel_pacing', [beforeSchedule]);
    assert.equal(extended.rows[0].valid, true);
    await db.exec("update broadcast_channel_pacing set next_send_at=clock_timestamp()-interval '1 minute'");
    const reopened = await db.query("select broadcast_begin_send_paced('00000000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000022',2460) as result");
    assert.equal(reopened.rows[0].result, 'sending');
    const rejected = await db.query("select broadcast_requeue_recipient_paced('00000000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000022','provider_rejected_http_429',2460) as result");
    assert.equal(rejected.rows[0].result.ok, true);
    const requeued = await db.query("select r.status, p.pending_recipient_id, p.next_send_at > clock_timestamp() as cooling from broadcast_campaign_recipients r cross join broadcast_channel_pacing p where r.id='00000000-0000-0000-0000-000000000032'");
    assert.equal(requeued.rows[0].status, 'queued');
    assert.equal(requeued.rows[0].pending_recipient_id, null);
    assert.equal(requeued.rows[0].cooling, true);
    await db.exec(fs.readFileSync(new URL('../../../supabase/migrations_pending_review/20261121214308_broadcast_pacing_v1.rollback.sql', import.meta.url), 'utf8'));
    const rollback = await db.query("select to_regclass('public.broadcast_channel_pacing') as pacing");
    assert.equal(rollback.rows[0].pacing, null);
  } finally { await db.close(); }
});

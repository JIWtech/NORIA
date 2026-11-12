const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PGlite } = require(path.join(process.env.MAGIA_TEST_MODULES || path.join(require('node:os').tmpdir(), 'magia-diag-tools/node_modules'), '@electric-sql/pglite'));
const { tenantId } = require('./price_relay.cjs');

const read = file => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
const base = read('supabase/migrations_pending_review/turn_queue_lifecycle_v1.sql');
const proposal = read('clients/ic_saloon/09_proposta_liberar_fila_preco_recusado.sql');
const other = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const relayActor = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ordinaryActor = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function lifecycleFunction(name) {
  const start = base.indexOf('create or replace function public.magia_' + name + '(');
  assert.ok(start >= 0, name);
  return base.slice(start, base.indexOf('end $$;', start) + 7);
}

async function setupQueue() {
  const db = new PGlite();
  try {
    await db.exec(
      "create role anon; create role authenticated; create role service_role;" +
      "create schema auth; create table auth.users (id uuid primary key, raw_app_meta_data jsonb);" +
      "create function auth.uid() returns uuid language sql as 'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';" +
      "create table tenants(id uuid primary key,slug text,status text,deleted_at timestamptz);" +
      "create table channels(tenant_id uuid,type text,status text,external_id text,config jsonb);" +
      "create table channel_events(id uuid primary key default gen_random_uuid(),tenant_id uuid,tenant_slug text," +
      "channel_type text,external_conversation_id text,external_message_id text,direction text,sender_type text," +
      "contact_name text,message_text text,service text,stage text,handoff boolean,ai_provider text,raw_payload jsonb," +
      "created_at timestamptz default clock_timestamp(),unique(tenant_slug,channel_type,external_message_id));"
    );
    await db.query("insert into tenants values ($1,'ic_salon','active',null),($2,'other','active',null)", [tenantId, other]);
    await db.query("insert into channels values ($1,'whatsapp','active','ic_saloon','{}'),($2,'whatsapp','active','other','{}')", [tenantId, other]);
    await db.query("insert into auth.users values ($1,$2),($3,'{}')", [relayActor, { noria_ic_salon_price_relay: true }, ordinaryActor]);
    await db.exec(read('supabase/migrations/017_whatsapp_turn_queue.sql'));
    await db.exec(base.slice(base.indexOf('begin;'), base.indexOf('-- Provenance is issued')) + 'commit;');
    for (const name of ['fail_turn', 'claim_turn', 'commit_turn', 'begin_turn_delivery', 'confirm_turn_delivery', 'finish_turn']) {
      await db.exec(lifecycleFunction(name));
    }
    await db.exec(proposal);
    await db.exec(proposal);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

const rpc = async (db, name, params) => (await db.query(
  'select public.' + name + '(' + params.map((_, i) => '$' + (i + 1)).join(',') + ') as result', params
)).rows[0].result;

async function asActor(db, actor, work) {
  await db.exec('begin; set local role authenticated;');
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [actor]);
    const result = await work();
    await db.exec('commit;');
    return result;
  } catch (error) {
    await db.exec('rollback;');
    throw error;
  }
}

const issue = (db, chat, actor = relayActor) => asActor(db, actor,
  () => rpc(db, 'ic_salon_issue_price_rejection', [chat]));

async function enqueue(db, tid, chat, text) {
  const instance = tid === tenantId ? 'ic_saloon' : 'other';
  await rpc(db, 'magia_enqueue_turn', [tid, chat, instance, { id: randomUUID(), text, name: 'Teste' }, 3000]);
  await db.query("update conversation_turn_queue set quiet_until = now() - interval '1 second' where tenant_id = $1 and chat_id = $2", [tid, chat]);
}

async function beginDelivery(db, tid, chat) {
  await enqueue(db, tid, chat, 'Quanto custa o corte?');
  const claim = await rpc(db, 'magia_claim_turn', [tid, chat]);
  assert.equal(claim.claimed, true);
  assert.equal((await rpc(db, 'magia_commit_turn', [tid, chat, claim.token])).committed, true);
  const delivery = await rpc(db, 'magia_begin_turn_delivery', [tid, chat, claim.token]);
  assert.equal(delivery.dispatch_allowed, true);
  return { claim, delivery };
}

module.exports = { setupQueue, rpc, issue, enqueue, beginDelivery, other, ordinaryActor };

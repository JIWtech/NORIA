// Testes locais (PGlite) da proposta turn_fail_provider_rejected_v1.
// Nada aqui toca Supabase real. Para ver os casos novos falharem sem a migracao:
//   TURN_FAIL_REJECTED_SKIP_MIGRATION=1 node --test scripts/test_turn_fail_provider_rejected.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(path.join(process.env.MAGIA_TEST_MODULES || path.join(__dirname, '../app/node_modules'), '@electric-sql/pglite'));

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const PENDING = 'supabase/migrations_pending_review/';
const SKIP = process.env.TURN_FAIL_REJECTED_SKIP_MIGRATION === '1';

const TA = '11111111-1111-1111-1111-111111111111';
const TB = '22222222-2222-2222-2222-222222222222';
const OPERATOR = '33333333-3333-3333-3333-333333333333';
const CHAT = '5511999990000@s.whatsapp.net';

// Schema minimo exigido pelas migracoes (stubs das tabelas de produto que elas apenas consultam).
const STUBS = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users(id uuid primary key default gen_random_uuid());
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  create table tenants(id uuid primary key,slug text,status text,deleted_at timestamptz);
  create table channels(tenant_id uuid,type text,status text,external_id text,config jsonb);
  create table channel_events(id uuid primary key default gen_random_uuid(),tenant_id uuid,tenant_slug text,
    channel_type text,external_conversation_id text,external_message_id text,direction text,sender_type text,
    contact_name text,message_text text,service text,stage text,handoff boolean,ai_provider text,raw_payload jsonb,
    response_text text,ai_model text,ai_error text,ai_usage jsonb,sent_by_user text,delivery_status text,command_id text,
    created_at timestamptz default clock_timestamp(),unique(tenant_slug,channel_type,external_message_id));
  create table tenant_members(tenant_id uuid,user_id uuid,status text,role text);
  create table tenant_settings(tenant_id uuid primary key,settings jsonb);
  create table sales_leads(id uuid primary key default gen_random_uuid(),tenant_id uuid,channel_type text,chat_id text,
    session_id text,revision int default 1,stage_key text,ai_locked boolean default false);
  create table tenant_ai_excluded_contacts(tenant_id uuid,phone text);
  create table appointments(id uuid primary key default gen_random_uuid(),tenant_id uuid);
  create function public.magia_exclusion_phone_candidates(p text) returns text[] language sql as $$ select array[p] $$;
  insert into auth.users(id) values ('${OPERATOR}');
  insert into tenants values ('${TA}','clinic-a','active',null),('${TB}','clinic-b','active',null);
  insert into channels values ('${TA}','whatsapp','active','clinic-a','{}'),('${TB}','whatsapp','active','clinic-b','{}');
`;

async function setup({ withNew }) {
  const db = new PGlite();
  await db.exec(STUBS);
  await db.exec(read('supabase/migrations/017_whatsapp_turn_queue.sql'));
  await db.exec(read(PENDING + 'turn_queue_lifecycle_v1.sql'));
  await db.exec(read(PENDING + 'turn_queue_retry_provisioning_v1.sql'));
  await db.exec(read(PENDING + 'turn_queue_closure_recovery_v1.sql'));
  if (withNew) await db.exec(read(PENDING + 'turn_fail_provider_rejected_v1.sql'));
  // Politica de retry (necessaria para resume_unattempted) e operador de revisao.
  await db.exec(`
    insert into conversation_turn_retry_policy values ('${TA}',3,1,10),('${TB}',3,1,10)
      on conflict (tenant_id) do update set max_attempts=3,base_backoff_seconds=1,max_backoff_seconds=10;
    insert into conversation_turn_review_operators values ('${TA}','${OPERATOR}') on conflict do nothing;
  `);
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const one = async (sql, args = []) => (await q(sql, args))[0];
  const rpc = async (name, args) => (await one(
    `select magia_${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as r`, args)).r;
  // Turno em 'sending' com tentativa de entrega iniciada.
  const sendingTurn = async (tid, slug, chat = CHAT) => {
    await rpc('enqueue_turn', [tid, chat, slug, JSON.stringify({ id: 'm-' + tid, text: 'Oi', name: 'Cliente' }), 3000]);
    await db.query(`update conversation_turn_queue set quiet_until=now()-interval '1 second' where tenant_id=$1`, [tid]);
    const c = await rpc('claim_turn', [tid, chat]);
    assert.equal(c.claimed, true, JSON.stringify(c));
    assert.equal((await rpc('commit_turn', [tid, chat, c.token])).committed, true);
    const d = await rpc('begin_turn_delivery', [tid, chat, c.token]);
    assert.equal(d.dispatch_allowed, true);
    return { token: c.token, attempt: d.id };
  };
  const queue = (tid, chat = CHAT) => one(
    `select phase,current_delivery_id,last_error_code from conversation_turn_queue where tenant_id=$1 and chat_id=$2`, [tid, chat]);
  const attempt = (token) => one(`select status,error_code from conversation_turn_delivery_attempts where turn_token=$1`, [token]);
  const asOperator = () => db.exec(`select set_config('request.jwt.claim.sub','${OPERATOR}',false)`);
  const openTicket = (tid) => one(
    `select id,revision from conversation_turn_review_tickets where tenant_id=$1 and resolved_at is null`, [tid]);
  return { db, q, one, rpc, sendingTurn, queue, attempt, asOperator, openTicket };
}

const fail6 = (h, tid, token, rejected) => h.rpc('fail_turn', [tid, CHAT, token, 'evolution_http_400', false, rejected]);

test('rejeicao 4xx comprovada: review, tentativa rejected, current_delivery_id nulo', async () => {
  const h = await setup({ withNew: !SKIP });
  try {
    const { token } = await h.sendingTurn(TA, 'clinic-a');
    const r = await fail6(h, TA, token, true);
    assert.equal(r.outcome, 'review');
    assert.equal(r.reason, 'provider_rejected_delivery');
    const a = await h.attempt(token);
    assert.equal(a.status, 'rejected');
    assert.equal(a.error_code, 'evolution_http_400');
    const q = await h.queue(TA);
    assert.equal(q.phase, 'review');
    assert.equal(q.current_delivery_id, null);
  } finally { await h.db.close(); }
});

test('p_delivery_rejected=false ou chamada de 5 args continua uncertain', async () => {
  const h = await setup({ withNew: !SKIP });
  try {
    const t1 = await h.sendingTurn(TA, 'clinic-a');
    const r1 = await fail6(h, TA, t1.token, false);
    assert.equal(r1.outcome, 'uncertain');
    assert.equal(r1.reason, 'delivery_reconciliation_required');
    assert.equal((await h.attempt(t1.token)).status, 'uncertain');
    assert.notEqual((await h.queue(TA)).current_delivery_id, null);

    const t2 = await h.sendingTurn(TB, 'clinic-b');
    const r2 = await h.rpc('fail_turn', [TB, CHAT, t2.token, 'x', false]);
    assert.equal(r2.outcome, 'uncertain');
    assert.equal((await h.attempt(t2.token)).status, 'uncertain');
  } finally { await h.db.close(); }
});

test('rejeicao informada mas tentativa confirmada ou com provider_message_id continua uncertain', async () => {
  for (const mode of ['confirmed', 'provider_message_id']) {
    const h = await setup({ withNew: !SKIP });
    try {
      const { token } = await h.sendingTurn(TA, 'clinic-a');
      if (mode === 'confirmed') {
        await h.db.exec(`update conversation_turn_delivery_attempts set status='confirmed',provider_message_id='wamid.1'`);
      } else {
        await h.db.exec(`update conversation_turn_delivery_attempts set provider_message_id='wamid.2'`);
      }
      const r = await fail6(h, TA, token, true);
      assert.equal(r.outcome, 'uncertain', mode);
      assert.notEqual((await h.attempt(token)).status, 'rejected', mode);
      if (mode === 'confirmed') assert.equal((await h.attempt(token)).status, 'confirmed');
      assert.notEqual((await h.queue(TA)).current_delivery_id, null, mode);
    } finally { await h.db.close(); }
  }
});

test('isolamento: mesmo chat_id em outro tenant nao e afetado', async () => {
  const h = await setup({ withNew: !SKIP });
  try {
    const a = await h.sendingTurn(TA, 'clinic-a');
    const b = await h.sendingTurn(TB, 'clinic-b');
    const r = await fail6(h, TA, a.token, true);
    assert.equal(r.outcome, 'review');
    const qb = await h.queue(TB);
    assert.equal(qb.phase, 'sending');
    assert.notEqual(qb.current_delivery_id, null);
    assert.equal((await h.attempt(b.token)).status, 'attempting');
    // Token do tenant A nao vale no tenant B.
    const cross = await h.rpc('fail_turn', [TB, CHAT, a.token, 'x', false, true]);
    assert.equal(cross.reason, 'stale_token');
    assert.equal((await h.queue(TB)).phase, 'sending');
  } finally { await h.db.close(); }
});

test('revisao: apos rejected resume_unattempted e permitido; uncertain continua bloqueado', async () => {
  const h = await setup({ withNew: !SKIP });
  try {
    await h.asOperator();
    const rej = await h.sendingTurn(TA, 'clinic-a');
    await fail6(h, TA, rej.token, true);
    const t = await h.openTicket(TA);
    const res = await h.rpc('resolve_turn_review', [TA, t.id, t.revision, 'resume_unattempted', 'nota']);
    assert.equal(res.resolved, true);
    assert.equal((await h.queue(TA)).phase, 'ready');

    // Uncertain (sem rejeicao): resume e close_with_evidence seguem exigindo reconciliacao.
    const unc = await h.sendingTurn(TB, 'clinic-b');
    await h.db.exec(`insert into conversation_turn_review_operators values ('${TB}','${OPERATOR}')`);
    await fail6(h, TB, unc.token, false);
    const tu = await h.openTicket(TB);
    await assert.rejects(h.rpc('resolve_turn_review', [TB, tu.id, tu.revision, 'resume_unattempted', 'nota']),
      /DELIVERY_RECONCILIATION_REQUIRED/);
    await assert.rejects(h.rpc('resolve_turn_review', [TB, tu.id, tu.revision, 'close_with_evidence', 'nota']),
      /DELIVERY_RECONCILIATION_REQUIRED/);
  } finally { await h.db.close(); }
});

test('chamada interna de 5 args (claim com lease expirada) continua valida', async () => {
  const h = await setup({ withNew: !SKIP });
  try {
    await h.sendingTurn(TA, 'clinic-a');
    await h.db.exec(`update conversation_turn_queue set lease_until=clock_timestamp()-interval '1 second'`);
    const c = await h.rpc('claim_turn', [TA, CHAT]);
    assert.equal(c.claimed, false);
    assert.equal(c.reason, 'delivery_reconciliation_required');
    assert.equal((await h.queue(TA)).phase, 'uncertain');
  } finally { await h.db.close(); }
});

test('rollback: restaura a funcao de 5 args e o check original', { skip: SKIP }, async () => {
  const h = await setup({ withNew: true });
  try {
    const t1 = await h.sendingTurn(TA, 'clinic-a');
    await fail6(h, TA, t1.token, true);
    assert.equal((await h.attempt(t1.token)).status, 'rejected');
    await h.db.exec(read(PENDING + 'turn_fail_provider_rejected_v1_rollback.sql'));
    // Linhas rejected foram convertidas para uncertain.
    assert.equal((await h.attempt(t1.token)).status, 'uncertain');
    const sigs = (await h.q(`select pg_get_function_identity_arguments(oid) a from pg_proc
      where proname='magia_fail_turn' and pronamespace='public'::regnamespace`)).map((x) => x.a);
    assert.equal(sigs.length, 1);
    assert.ok(!sigs[0].includes('p_delivery_rejected'));
    const t2 = await h.sendingTurn(TB, 'clinic-b');
    const r = await h.rpc('fail_turn', [TB, CHAT, t2.token, 'x', false]);
    assert.equal(r.outcome, 'uncertain');
    await assert.rejects(h.db.exec(`update conversation_turn_delivery_attempts set status='rejected'`), /check/i);
    // Resolve restaurado volta a bloquear qualquer tentativa (inclusive nao rejected).
    await h.asOperator();
    const t = await h.openTicket(TA);
    await assert.rejects(h.rpc('resolve_turn_review', [TA, t.id, t.revision, 'resume_unattempted', 'nota']),
      /DELIVERY_RECONCILIATION_REQUIRED/);
  } finally { await h.db.close(); }
});

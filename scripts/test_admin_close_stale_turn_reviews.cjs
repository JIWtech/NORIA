// Encerramento em lote das revisões travadas (Frente 3, 26/11): função proposta + rollback, em PGlite, com o gatilho real
// magia_track_turn_review copiado de produção. Rodar: node --test scripts/test_admin_close_stale_turn_reviews.cjs
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { PGlite } = require('../app/node_modules/@electric-sql/pglite');
const migration = fs.readFileSync(require.resolve('../supabase/migrations_pending_review/20261126_admin_close_stale_turn_reviews.sql'), 'utf8');
const rollback = fs.readFileSync(require.resolve('../supabase/migrations_pending_review/20261126_admin_close_stale_turn_reviews.rollback.sql'), 'utf8');
const A = '10000000-0000-4000-8000-00000000000a', B = '10000000-0000-4000-8000-00000000000b';
const tok = n => '20000000-0000-4000-8000-0000000000' + String(n).padStart(2, '0');
const ev = n => '30000000-0000-4000-8000-0000000000' + String(n).padStart(2, '0');

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.role() returns text language sql as $$select current_setting('test.role',true)$$;
    select set_config('test.role','service_role',false);
    create table channel_events(id uuid primary key, tenant_id uuid, channel_type text, external_conversation_id text, direction text, sender_type text, created_at timestamptz);
    create table conversation_turn_queue(tenant_id uuid, channel_type text, chat_id text, instance_name text, pending jsonb, claimed jsonb, quiet_until timestamptz,
      token uuid, lease_until timestamptz, claimed_at timestamptz, boundary_id text, phase text check (phase in ('ready','processing','sending','uncertain','review')),
      updated_at timestamptz, current_delivery_id uuid, retry_batch_id uuid, attempt_count int default 0, retry_max_attempts int, retry_base_seconds int,
      retry_cap_seconds int, next_attempt_at timestamptz, last_error_code text, review_required_at timestamptz, primary key(tenant_id, channel_type, chat_id));
    create table conversation_turn_review_tickets(id uuid primary key default gen_random_uuid(), tenant_id uuid, channel_type text, chat_id text, revision bigint default 1,
      created_snapshot jsonb, queue_snapshot jsonb, notification_pending boolean default true, acknowledged_by uuid, acknowledged_at timestamptz, resolved_by uuid,
      resolved_at timestamptz, resolution text, resolution_note text, resolution_snapshot jsonb, resolution_evidence jsonb, created_at timestamptz default now(),
      updated_at timestamptz default now(), notified_revision bigint, notification_lease_token uuid, notification_lease_revision bigint, notification_lease_until timestamptz);
    create unique index one_open_ticket on conversation_turn_review_tickets(tenant_id, channel_type, chat_id) where resolved_at is null;
    create table conversation_turn_terminal_receipts(turn_token uuid primary key, tenant_id uuid, chat_id text, outcome text, claimed jsonb, evidence jsonb, created_at timestamptz default now());
    create table conversation_turn_delivery_attempts(id uuid primary key default gen_random_uuid(), tenant_id uuid, channel_type text, chat_id text, turn_token uuid, claimed_event_ids jsonb);
    -- Cópia do gatilho de produção (pg_get_functiondef de 26/11/2026).
    create function magia_track_turn_review() returns trigger language plpgsql security definer set search_path to 'public','pg_temp' as $f$
    declare tid uuid; rev bigint;
    begin
      if new.phase in ('review','uncertain') then
        insert into public.conversation_turn_review_tickets(tenant_id,channel_type,chat_id,created_snapshot,queue_snapshot)
          values(new.tenant_id,new.channel_type,new.chat_id,to_jsonb(new),to_jsonb(new))
          on conflict(tenant_id,channel_type,chat_id) where resolved_at is null do update
            set queue_snapshot=excluded.queue_snapshot,revision=conversation_turn_review_tickets.revision+1,
              notification_pending=true,notification_lease_token=null,notification_lease_revision=null,
              notification_lease_until=null,updated_at=clock_timestamp()
          returning id,revision into tid,rev;
        perform pg_notify('noria_turn_review',jsonb_build_object('ticket_id',tid,'tenant_id',new.tenant_id,'revision',rev)::text);
      elsif tg_op='UPDATE' and old.phase in ('review','uncertain') then
        update public.conversation_turn_review_tickets set resolved_at=clock_timestamp(),resolution='queue_finalized',
          resolution_snapshot=to_jsonb(old),notification_pending=false,revision=revision+1,updated_at=clock_timestamp()
          where tenant_id=new.tenant_id and channel_type=new.channel_type and chat_id=new.chat_id and resolved_at is null;
      end if;
      return new;
    end $f$;
    create trigger noria_track_turn_review after insert or update on conversation_turn_queue for each row execute function magia_track_turn_review();
  `);
  // Conversas: c1 (equipe respondeu por último, 2 pendentes antigas e 1 depois da equipe), c2 (cliente falou depois da equipe),
  // c3 (tentativa de entrega do lote), c4 (sem resposta da equipe), c1 também no tenant B (isolamento).
  const at = d => `now() - interval '${d} days'`;
  await db.exec(`
    insert into channel_events values
      ('${ev(1)}','${A}','whatsapp','c1','inbound','contact',${at(30)}), ('${ev(2)}','${A}','whatsapp','c1','inbound','contact',${at(29)}),
      ('${ev(3)}','${A}','whatsapp','c1','outbound','agent',${at(20)}),
      ('${ev(4)}','${A}','whatsapp','c2','inbound','contact',${at(30)}), ('${ev(5)}','${A}','whatsapp','c2','outbound','agent',${at(20)}),
      ('${ev(6)}','${A}','whatsapp','c2','inbound','contact',${at(10)}),
      ('${ev(7)}','${A}','whatsapp','c3','inbound','contact',${at(30)}), ('${ev(8)}','${A}','whatsapp','c3','outbound','agent',${at(20)}),
      ('${ev(9)}','${A}','whatsapp','c4','inbound','contact',${at(30)}),
      ('${ev(10)}','${B}','whatsapp','c1','inbound','contact',${at(30)}), ('${ev(11)}','${B}','whatsapp','c1','outbound','agent',${at(20)});
    insert into conversation_turn_queue(tenant_id,channel_type,chat_id,pending,claimed,token,phase,review_required_at,updated_at,last_error_code) values
      ('${A}','whatsapp','c1','[{"event_id":"${ev(2)}"}]','[{"event_id":"${ev(1)}"}]','${tok(1)}','review',${at(29)},${at(29)},'GEMINI_RATE_LIMIT'),
      ('${A}','whatsapp','c2','[]','[{"event_id":"${ev(4)}"}]','${tok(2)}','review',${at(29)},${at(29)},'X'),
      ('${A}','whatsapp','c3','[]','[{"event_id":"${ev(7)}"}]','${tok(3)}','review',${at(29)},${at(29)},'X'),
      ('${A}','whatsapp','c4','[]','[{"event_id":"${ev(9)}"}]','${tok(4)}','review',${at(29)},${at(29)},'X'),
      ('${B}','whatsapp','c1','[]','[{"event_id":"${ev(10)}"}]','${tok(5)}','review',${at(29)},${at(29)},'X');
    insert into conversation_turn_delivery_attempts(tenant_id,channel_type,chat_id,turn_token,claimed_event_ids) values ('${A}','whatsapp','c3','${tok(3)}','["${ev(7)}"]');
  `);
  await db.exec(migration);
  return db;
}
const close = (db, chats, dry, tenant = A) => db.query('select magia_admin_close_stale_turn_reviews($1,$2,$3,$4) as r', [tenant, chats, 'limpeza autorizada em 26/11', dry]).then(x => x.rows[0].r);
const queue = (db, chat, tenant = A) => db.query('select * from conversation_turn_queue where tenant_id=$1 and chat_id=$2', [tenant, chat]).then(x => x.rows[0]);
const openTickets = db => db.query('select tenant_id, chat_id from conversation_turn_review_tickets where resolved_at is null order by tenant_id, chat_id').then(x => x.rows.map(r => (r.tenant_id === A ? 'A:' : 'B:') + r.chat_id));

test('simulação não altera nada e já aponta quem fecha e quem fica', async () => {
  const db = await database();
  try {
    const r = await close(db, ['c1', 'c2', 'c3', 'c4', 'c9'], true);
    assert.equal(r.dry_run, true);
    assert.deepEqual(r.closed_chats.map(c => c.chat_id), ['c1']);
    assert.deepEqual(Object.fromEntries(r.skipped_chats.map(s => [s.chat_id, s.reason])),
      { c2: 'TEAM_DID_NOT_REPLY_LAST', c3: 'DELIVERY_RECONCILIATION_REQUIRED', c4: 'TEAM_DID_NOT_REPLY_LAST', c9: 'QUEUE_NOT_FOUND' });
    assert.equal((await queue(db, 'c1')).phase, 'review');
    assert.deepEqual(await openTickets(db), ['A:c1', 'A:c2', 'A:c3', 'A:c4', 'B:c1']);
    assert.equal((await db.query('select count(*)::int n from conversation_turn_terminal_receipts')).rows[0].n, 0);
  } finally { await db.close(); }
});

test('encerramento: só a conversa segura, recibo cancelado, pendentes antigas fora, motivo e nota no chamado, outro tenant intacto', async () => {
  const db = await database();
  try {
    // Mensagem da cliente que chegou DEPOIS da resposta da equipe fica na fila (não é descartada).
    await db.exec(`insert into channel_events values ('${ev(12)}','${A}','whatsapp','c1x','inbound','contact',now())`);
    await db.exec(`update conversation_turn_queue set pending = pending || '[{"event_id":"${ev(12)}"}]' where tenant_id='${A}' and chat_id='c1'`);
    const r = await close(db, ['c1', 'c2', 'c3', 'c4'], false);
    assert.equal(r.closed, 1);
    const q = await queue(db, 'c1');
    assert.equal(q.phase, 'ready'); assert.equal(q.token, null); assert.deepEqual(q.claimed, []); assert.equal(q.review_required_at, null); assert.equal(q.last_error_code, null);
    assert.deepEqual(q.pending, [{ event_id: ev(12) }], 'só a pendente posterior à resposta da equipe continua');
    const receipt = (await db.query('select * from conversation_turn_terminal_receipts where turn_token=$1', [tok(1)])).rows[0];
    assert.equal(receipt.outcome, 'cancelled');
    assert.deepEqual(receipt.claimed, [{ event_id: ev(1) }, { event_id: ev(2) }]);
    assert.equal(receipt.evidence.kind, 'admin_stale_review_closure');
    assert.equal(receipt.evidence.agent_event_id, ev(3));
    const ticket = (await db.query("select * from conversation_turn_review_tickets where tenant_id=$1 and chat_id='c1'", [A])).rows[0];
    assert.equal(ticket.resolution, 'admin_closed_stale');
    assert.equal(ticket.resolution_note, 'limpeza autorizada em 26/11');
    assert.equal(ticket.resolution_snapshot.phase, 'review');
    assert.deepEqual(await openTickets(db), ['A:c2', 'A:c3', 'A:c4', 'B:c1'], 'nenhum outro chamado foi fechado, nem do outro tenant');
    assert.equal((await queue(db, 'c1', B)).phase, 'review');
    // Repetir não faz nada (já não está em revisão).
    assert.equal((await close(db, ['c1'], false)).skipped_chats[0].reason, 'NOT_IN_REVIEW');
  } finally { await db.close(); }
});

test('papel errado, nota vazia ou lista vazia recusam sem efeito', async () => {
  const db = await database();
  try {
    await db.exec("select set_config('test.role','authenticated',false)");
    await assert.rejects(close(db, ['c1'], false), /ADMIN_CLOSE_FORBIDDEN/);
    await db.exec("select set_config('test.role','service_role',false)");
    await assert.rejects(db.query('select magia_admin_close_stale_turn_reviews($1,$2,$3,false)', [A, ['c1'], '  ']), /ADMIN_CLOSE_NOTE_REQUIRED/);
    await assert.rejects(db.query('select magia_admin_close_stale_turn_reviews($1,$2,$3,false)', [A, [], 'x']), /ADMIN_CLOSE_INVALID_INPUT/);
    assert.equal((await queue(db, 'c1')).phase, 'review');
  } finally { await db.close(); }
});

test('rollback devolve a conversa à revisão com o mesmo chamado aberto, apaga o recibo e remove a função', async () => {
  const db = await database();
  try {
    await close(db, ['c1'], false);
    await db.exec(rollback);
    const q = await queue(db, 'c1');
    assert.equal(q.phase, 'review'); assert.equal(q.token, tok(1)); assert.deepEqual(q.claimed, [{ event_id: ev(1) }]); assert.deepEqual(q.pending, [{ event_id: ev(2) }]);
    assert.equal(q.last_error_code, 'GEMINI_RATE_LIMIT');
    assert.deepEqual(await openTickets(db), ['A:c1', 'A:c2', 'A:c3', 'A:c4', 'B:c1']);
    assert.equal((await db.query("select count(*)::int n from conversation_turn_review_tickets where tenant_id=$1 and chat_id='c1'", [A])).rows[0].n, 1, 'sem chamado duplicado');
    assert.equal((await db.query('select count(*)::int n from conversation_turn_terminal_receipts')).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int n from pg_proc where proname='magia_admin_close_stale_turn_reviews'")).rows[0].n, 0);
  } finally { await db.close(); }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(path.join(
  process.env.MAGIA_TEST_MODULES || path.join(require('node:os').tmpdir(), 'magia-diag-tools/node_modules'),
  '@electric-sql/pglite'
));
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const tenantA = '11111111-1111-1111-1111-111111111111';
const tenantB = '22222222-2222-2222-2222-222222222222';
const ownerA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ownerB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const viewerA = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

async function bootstrap() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table tenants(id uuid primary key, slug text, status text, deleted_at timestamptz);
    create table tenant_members(tenant_id uuid, user_id uuid, email text, role text, status text);
    create table appointments(
      id uuid primary key default gen_random_uuid(), tenant_id uuid not null, title text not null,
      starts_at timestamptz not null, ends_at timestamptz, status text, metadata jsonb default '{}',
      channel_type text, external_conversation_id text, contact_name text, notes text, created_by uuid,
      created_at timestamptz default now(), updated_at timestamptz default now());
    create table channel_events(
      id uuid primary key default gen_random_uuid(), tenant_id uuid, tenant_slug text, channel_type text,
      external_conversation_id text, external_message_id text, direction text, sender_type text, contact_name text,
      message_text text, service text, stage text, handoff boolean, response_text text, raw_payload jsonb,
      ai_provider text, ai_model text, delivery_status text, command_id text, sent_by_user text,
      created_at timestamptz default clock_timestamp(),
      unique (tenant_id, channel_type, external_conversation_id, external_message_id));
    -- Stand-in for the published control-event RPC (the real one also fences the turn queue). Same contract: the caller must be a member.
    create function magia_record_turn_control_event(p_event jsonb) returns setof channel_events language plpgsql security definer as $$
    declare e channel_events%rowtype;
    begin
      if auth.uid() is null or not exists (select 1 from tenant_members where tenant_id = (p_event->>'tenant_id')::uuid and user_id = auth.uid() and status = 'active')
        then raise exception 'CONTROL_ORIGIN_FORBIDDEN'; end if;
      insert into channel_events(tenant_id, tenant_slug, channel_type, external_conversation_id, external_message_id, direction, sender_type,
        contact_name, message_text, service, stage, handoff, ai_provider, delivery_status, command_id, sent_by_user, raw_payload)
      values ((p_event->>'tenant_id')::uuid, 'slug', p_event->>'channel_type', p_event->>'external_conversation_id', p_event->>'external_message_id',
        p_event->>'direction', p_event->>'sender_type', p_event->>'contact_name', p_event->>'message_text', p_event->>'service', p_event->>'stage',
        coalesce((p_event->>'handoff')::boolean, false), p_event->>'ai_provider', p_event->>'delivery_status', p_event->>'command_id',
        p_event->>'sent_by_user', coalesce(p_event->'raw_payload', '{}'))
      on conflict do nothing returning * into e;
      if e.id is not null then return next e; end if;
    end $$;
    alter table appointments enable row level security;
    create policy appointments_member_select on appointments for select to authenticated
      using (exists (select 1 from tenant_members m where m.tenant_id = appointments.tenant_id and m.user_id = auth.uid() and m.status = 'active'));
    grant usage on schema public, auth to authenticated, service_role;
    grant select on tenant_members, tenants, channel_events to authenticated;
    grant select on appointments to authenticated;
    insert into tenants values ('${tenantA}', 'a', 'active', null), ('${tenantB}', 'b', 'active', null);
    insert into tenant_members values
      ('${tenantA}', '${ownerA}', 'dona@salao.test', 'owner', 'active'),
      ('${tenantA}', '${viewerA}', 'leitor@salao.test', 'viewer', 'active'),
      ('${tenantB}', '${ownerB}', 'dono@outro.test', 'owner', 'active');
  `);
  await db.exec(read('supabase/migrations/030_appointment_outcomes_no_show.sql'));
  return db;
}

const as = (db, uid) => db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid || ''}', false); set role authenticated;`);
const insertAppointment = async (db, { tenant = tenantA, chat = '5521900000001@s.whatsapp.net', channel = 'whatsapp', status = 'scheduled', startsAt = "now() - interval '2 hours'" } = {}) =>
  (await db.query(`insert into appointments(tenant_id, title, starts_at, status, channel_type, external_conversation_id, contact_name)
    values ($1, 'Corte', ${startsAt}, $2, $3, $4, 'Cliente Teste') returning id`, [tenant, status, channel, chat])).rows[0].id;
const outcome = async (db, id, kind, note = null) => (await db.query('select magia_mark_appointment_outcome($1, $2, $3) r', [id, kind, note])).rows[0].r;
const required = async (db, tenant = tenantA) => (await db.query('select * from magia_deposit_required_contacts($1)', [tenant])).rows;

test('"cliente não veio" encerra a conversa, marca o agendamento e é idempotente', async () => {
  const db = await bootstrap();
  try {
    const id = await insertAppointment(db);
    await as(db, ownerA);
    const first = await outcome(db, id, 'no_show', 'Avisou ninguém');
    assert.equal(first.ok, true);
    assert.equal(first.status, 'no_show');
    assert.equal(first.closed_conversation, true);
    await db.exec('reset role');
    const row = (await db.query('select status, metadata from appointments where id = $1', [id])).rows[0];
    assert.equal(row.status, 'no_show');
    assert.equal(row.metadata.outcome, 'no_show');
    assert.equal(row.metadata.outcome_by, 'dona@salao.test');
    assert.equal(row.metadata.outcome_note, 'Avisou ninguém');
    const events = (await db.query('select * from channel_events')).rows;
    assert.equal(events.length, 1);
    assert.equal(events[0].service, 'conversation_closed');
    assert.equal(events[0].stage, 'Finalizado');
    assert.equal(events[0].delivery_status, 'closed');
    assert.equal(events[0].raw_payload.close_reason, 'no_show');
    assert.equal(events[0].raw_payload.appointment_id, id);
    await as(db, ownerA);
    const again = await outcome(db, id, 'no_show');
    assert.equal(again.already, true);
    await db.exec('reset role');
    assert.equal((await db.query('select count(*)::int n from channel_events')).rows[0].n, 1, 'segunda chamada não cria novo encerramento');
  } finally { await db.close(); }
});

test('desfecho respeita permissão, tempo e status do agendamento', async () => {
  const db = await bootstrap();
  try {
    const past = await insertAppointment(db);
    const future = await insertAppointment(db, { chat: 'future@s.whatsapp.net', startsAt: "now() + interval '3 hours'" });
    const cancelled = await insertAppointment(db, { chat: 'cancelled@s.whatsapp.net', status: 'cancelled' });
    await as(db, ownerB);
    await assert.rejects(outcome(db, past, 'no_show'), /APPOINTMENT_OUTCOME_FORBIDDEN/, 'dono de outro tenant não pode');
    await as(db, viewerA);
    await assert.rejects(outcome(db, past, 'no_show'), /APPOINTMENT_OUTCOME_FORBIDDEN/, 'papel sem permissão não pode');
    await as(db, '');
    await assert.rejects(outcome(db, past, 'no_show'), /APPOINTMENT_OUTCOME_FORBIDDEN/, 'sem sessão não pode');
    await as(db, ownerA);
    await assert.rejects(outcome(db, future, 'no_show'), /APPOINTMENT_NOT_STARTED/, 'não marca antes do horário');
    await assert.rejects(outcome(db, cancelled, 'no_show'), /APPOINTMENT_OUTCOME_INVALID_STATUS/, 'cancelado não vira falta');
    await assert.rejects(outcome(db, past, 'qualquer'), /APPOINTMENT_OUTCOME_INVALID/, 'desfecho desconhecido');
    await assert.rejects(outcome(db, '99999999-9999-9999-9999-999999999999', 'no_show'), /APPOINTMENT_NOT_FOUND/);
    await db.exec('reset role');
    assert.equal((await db.query('select count(*)::int n from channel_events')).rows[0].n, 0, 'nenhuma tentativa recusada encerra conversa');
    assert.equal((await db.query("select status from appointments where id = $1", [past])).rows[0].status, 'scheduled');
  } finally { await db.close(); }
});

test('agendamento fora do WhatsApp não encerra conversa e "compareceu" não encerra nada', async () => {
  const db = await bootstrap();
  try {
    const manual = await insertAppointment(db, { channel: 'manual', chat: '' });
    const attended = await insertAppointment(db, { chat: 'attended@s.whatsapp.net' });
    await as(db, ownerA);
    const m = await outcome(db, manual, 'no_show');
    assert.equal(m.status, 'no_show');
    assert.equal(m.closed_conversation, false);
    const a = await outcome(db, attended, 'attended');
    assert.equal(a.status, 'completed');
    assert.equal(a.closed_conversation, false);
    await db.exec('reset role');
    assert.equal((await db.query('select count(*)::int n from channel_events')).rows[0].n, 0);
  } finally { await db.close(); }
});

test('lista de sinal obrigatório: vale após a falta, some quando o cliente comparece e isola tenants', async () => {
  const db = await bootstrap();
  try {
    const chatA = '5521911111111@s.whatsapp.net', chatB = '5521922222222@s.whatsapp.net', chatC = '5521933333333@s.whatsapp.net';
    const missedA = await insertAppointment(db, { chat: chatA, startsAt: "now() - interval '3 days'" });
    const okB = await insertAppointment(db, { chat: chatB, startsAt: "now() - interval '2 days'" });
    const missedC = await insertAppointment(db, { chat: chatC, startsAt: "now() - interval '5 days'" });
    const otherTenant = await insertAppointment(db, { tenant: tenantB, chat: 'outro@s.whatsapp.net', startsAt: "now() - interval '1 day'" });
    await as(db, ownerA);
    assert.deepEqual(await required(db), [], 'ninguém antes de qualquer falta');
    await outcome(db, missedA, 'no_show');
    await outcome(db, okB, 'attended');
    await outcome(db, missedC, 'no_show');
    let list = await required(db);
    assert.deepEqual(list.map(r => r.external_conversation_id).sort(), [chatA, chatC].sort());
    assert.ok(list.every(r => r.channel_type === 'whatsapp' && r.appointment_id));

    // Novo agendamento futuro de quem faltou não limpa a marca; só comparecer limpa.
    await db.exec('reset role');
    const futureA = await insertAppointment(db, { chat: chatA, startsAt: "now() + interval '2 days'" });
    await as(db, ownerA);
    list = await required(db);
    assert.ok(list.some(r => r.external_conversation_id === chatA), 'agendar de novo não retira a exigência');
    await db.exec('reset role');
    await db.query("update appointments set starts_at = now() - interval '1 hour' where id = $1", [futureA]);
    await as(db, ownerA);
    await outcome(db, futureA, 'attended');
    list = await required(db);
    assert.deepEqual(list.map(r => r.external_conversation_id), [chatC], 'comparecer depois da falta volta ao normal');

    // Isolamento: o dono do tenant A nunca enxerga o tenant B, nem pedindo pelo id dele.
    assert.deepEqual(await required(db, tenantB), []);
    await assert.rejects(outcome(db, otherTenant, 'no_show'), /APPOINTMENT_OUTCOME_FORBIDDEN/, 'dono do tenant A não marca falta no tenant B');
    await as(db, ownerB);
    assert.equal((await outcome(db, otherTenant, 'no_show')).status, 'no_show', 'o dono do tenant B marca o dele');
    assert.deepEqual((await required(db, tenantB)).map(r => r.external_conversation_id), ['outro@s.whatsapp.net']);
    assert.deepEqual((await required(db, tenantA)), [], 'e não enxerga o tenant A');
  } finally { await db.close(); }
});

test('clique errado pode ser corrigido sem encerrar a conversa duas vezes', async () => {
  const db = await bootstrap();
  try {
    const id = await insertAppointment(db, { chat: 'corrige@s.whatsapp.net' });
    await as(db, ownerA);
    await outcome(db, id, 'no_show');
    assert.equal((await required(db)).length, 1);
    const fixed = await outcome(db, id, 'attended');
    assert.equal(fixed.status, 'completed');
    assert.equal((await required(db)).length, 0, 'corrigido para compareceu: sai da lista');
    const back = await outcome(db, id, 'no_show');
    assert.equal(back.status, 'no_show');
    await db.exec('reset role');
    assert.equal((await db.query('select count(*)::int n from channel_events')).rows[0].n, 1, 'o encerramento é idempotente por agendamento');
  } finally { await db.close(); }
});

test('a migração é reaplicável sem erro e não altera agendamentos existentes', async () => {
  const db = await bootstrap();
  try {
    const id = await insertAppointment(db);
    const before = (await db.query('select * from appointments where id = $1', [id])).rows[0];
    await db.exec(read('supabase/migrations/030_appointment_outcomes_no_show.sql'));
    assert.deepEqual((await db.query('select * from appointments where id = $1', [id])).rows[0], before);
  } finally { await db.close(); }
});

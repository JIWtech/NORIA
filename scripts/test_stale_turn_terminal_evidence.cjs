// Migração 033: o turno barrado por mensagem antiga só encerra como 'done' com prova do banco. Antes, sem prova, o turno
// ia para revisão e a conversa ficava bloqueada. O banco não confia no CORE: confere atestado do ingresso e horário de envio.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(path.join(
  process.env.MAGIA_TEST_MODULES || path.join(require('node:os').tmpdir(), 'magia-diag-tools/node_modules'),
  '@electric-sql/pglite'
));
const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/033_stale_turn_terminal_evidence.sql'), 'utf8')
  .replace(/notify pgrst[^;]*;/, '');
const rollback = fs.readFileSync(path.join(__dirname, '../supabase/migrations_pending_review/033_stale_turn_terminal_evidence_rollback.sql'), 'utf8')
  .replace(/notify pgrst[^;]*;/, '');

const T = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const CHAT = '5521999990000@s.whatsapp.net';
const TOKEN = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const hoursAgo = h => Math.floor((Date.now() - h * 3600000) / 1000);

async function bootstrap({ stamps = [hoursAgo(30)], attested = true, settings = {}, control = 'unproven', suppression = {}, tenant = T } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table tenant_settings(tenant_id uuid primary key, settings jsonb);
    create table conversation_turn_queue(tenant_id uuid, channel_type text, chat_id text, token uuid, claimed jsonb);
    create table channel_events(id uuid primary key, tenant_id uuid, channel_type text, external_conversation_id text,
      external_message_id text, direction text, raw_payload jsonb);
    create table conversation_turn_ingress_facts(tenant_id uuid, chat_id text, external_message_id text, from_me boolean);
    -- Dublês das funções que a 033 não altera: a prova de controle e o estado de supressão.
    create table stub(control text, suppression jsonb);
    create function magia_turn_control_evidence(uuid, text, uuid, text) returns jsonb language sql as
      $$ select case when (select control from stub) = 'null' then null else jsonb_build_object('kind', (select control from stub)) end $$;
    create function magia_turn_suppression_status(uuid, text, uuid) returns jsonb language sql as
      $$ select jsonb_build_object('contract', 'noria_turn_lifecycle_v1', 'evidence', (select suppression from stub)) $$;
  `);
  await db.query('insert into stub values ($1, $2)', [control, JSON.stringify(suppression)]);
  await db.query('insert into tenant_settings values ($1, $2)', [T, JSON.stringify(settings)]);
  const claimed = stamps.map((stamp, i) => ({ id: 'm' + i, event_id: `00000000-0000-0000-0000-00000000000${i}`, text: 'oi' }));
  await db.query("insert into conversation_turn_queue values ($1, 'whatsapp', $2, $3, $4)", [T, CHAT, TOKEN, JSON.stringify(claimed)]);
  for (const [i, stamp] of stamps.entries()) {
    await db.query("insert into channel_events values ($1, $2, 'whatsapp', $3, $4, 'inbound', $5)",
      [claimed[i].event_id, tenant, CHAT, 'm' + i, JSON.stringify(stamp === null ? {} : { message_timestamp: stamp })]);
    if (attested) await db.query('insert into conversation_turn_ingress_facts values ($1, $2, $3, false)', [T, CHAT, 'm' + i]);
  }
  await db.exec(migration);
  return db;
}
const evidence = async (db, outcome = 'done', token = TOKEN) =>
  (await db.query('select magia_turn_terminal_evidence($1, $2, $3, $4) e', [T, CHAT, token, outcome])).rows[0].e;

test('turno com todas as mensagens antigas e atestadas encerra como concluído', async () => {
  const proof = await evidence(await bootstrap({ stamps: [hoursAgo(30), hoursAgo(25)] }));
  assert.equal(proof.kind, 'stale_message');
  assert.equal(Number(proof.limit_hours), 6);
  assert.equal(proof.claimed_event_ids.length, 2);
});

test('mensagem dentro do limite não tem prova (a cliente é atendida)', async () => {
  assert.equal(await evidence(await bootstrap({ stamps: [hoursAgo(5)] })), null);
});

test('turno misto: uma mensagem nova derruba a prova', async () => {
  assert.equal(await evidence(await bootstrap({ stamps: [hoursAgo(30), hoursAgo(1)] })), null);
});

test('sem horário de envio nunca há prova', async () => {
  assert.equal(await evidence(await bootstrap({ stamps: [hoursAgo(30), null] })), null);
});

test('mensagem não atestada pelo ingresso não vale como prova', async () => {
  assert.equal(await evidence(await bootstrap({ attested: false })), null);
});

test('evento de outro tenant não vale como prova', async () => {
  assert.equal(await evidence(await bootstrap({ tenant: OTHER })), null);
});

test('limite do tenant é respeitado; valor inválido usa 6 horas', async () => {
  assert.equal(await evidence(await bootstrap({ stamps: [hoursAgo(10)], settings: { stale_message_max_age_hours: 24 } })), null);
  assert.equal((await evidence(await bootstrap({ stamps: [hoursAgo(3)], settings: { stale_message_max_age_hours: 2 } }))).kind, 'stale_message');
  assert.equal((await evidence(await bootstrap({ stamps: [hoursAgo(7)], settings: { stale_message_max_age_hours: 'x' } }))).kind, 'stale_message');
});

test('vale só para o desfecho concluído', async () => {
  assert.equal(await evidence(await bootstrap(), 'cancelled'), null);
});

test('token de outro turno não recebe prova', async () => {
  assert.equal(await evidence(await bootstrap(), 'done', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), null);
});

test('provas que já existiam continuam valendo antes da nova', async () => {
  assert.equal((await evidence(await bootstrap({ control: 'human_control' }))).kind, 'human_control');
  assert.equal((await evidence(await bootstrap({ suppression: { contact_excluded: { source: 'x' } } }))).kind, 'contact_excluded');
  assert.equal(await evidence(await bootstrap({ control: 'null' })), null);
});

test('rollback volta ao comportamento anterior: sem prova de mensagem antiga', async () => {
  const db = await bootstrap();
  await db.exec(rollback);
  assert.equal(await evidence(db), null);
  const fn = (await db.query("select count(*)::int c from pg_proc where proname = 'magia_turn_stale_evidence'")).rows[0].c;
  assert.equal(fn, 0);
});

test('só o banco executa a nova função', async () => {
  const db = await bootstrap();
  const { rows } = await db.query(`select has_function_privilege('anon','magia_turn_stale_evidence(uuid,text,uuid)','execute') anon,
    has_function_privilege('authenticated','magia_turn_stale_evidence(uuid,text,uuid)','execute') auth`);
  assert.deepEqual(rows[0], { anon: false, auth: false });
});

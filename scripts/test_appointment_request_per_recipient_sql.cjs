// Proposta 20261113000000_appointment_requests_one_per_recipient (NÃO aplicada em produção), validada em PGlite:
// um pedido aberto por pessoa atendida na conversa; sem recipient_key o comportamento da migração 031 é o mesmo.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(path.join(
  process.env.MAGIA_TEST_MODULES || path.join(require('node:os').tmpdir(), 'magia-diag-tools/node_modules'),
  '@electric-sql/pglite'
));
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/notify pgrst[^;]*;/g, '');
const PROPOSAL = 'supabase/migrations_pending_review/20261113000000_appointment_requests_one_per_recipient.sql';
const ROLLBACK = 'supabase/migrations_pending_review/20261113000000_appointment_requests_one_per_recipient_rollback.sql';
const tenant = '11111111-1111-1111-1111-111111111111';
const future = hours => new Date(Date.now() + hours * 3600000).toISOString();

async function bootstrap(applyProposal = true) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table appointments(
      id uuid primary key default gen_random_uuid(), tenant_id uuid not null, title text not null,
      starts_at timestamptz not null, ends_at timestamptz, status text, metadata jsonb default '{}',
      channel_type text, external_conversation_id text, contact_name text, notes text, created_by uuid,
      created_at timestamptz default now(), updated_at timestamptz default now());
  `);
  await db.exec(read('supabase/migrations/031_appointment_requests.sql'));
  if (applyProposal) await db.exec(read(PROPOSAL));
  return db;
}
const upsert = async (db, { key, name = 'Maria Silva', recipient, starts = future(24) }) =>
  (await db.query(`select magia_upsert_appointment_request($1,'whatsapp','chat-1',$2,'Corte',$3,null,$4,$5) r`,
    [tenant, name, starts, JSON.stringify({ services: ['Corte'], ...(recipient ? { recipient_key: recipient } : {}) }), key])).rows[0].r;
const direct = (db, recipient, status = 'pending_confirmation') => db.query(
  `insert into appointments(tenant_id,title,starts_at,status,channel_type,external_conversation_id,metadata)
   values ($1,'x',$2,$3,'whatsapp','chat-1',$4)`, [tenant, future(30), status, JSON.stringify(recipient ? { recipient_key: recipient } : {})]);
const open = async db => (await db.query(`select count(*)::int c from appointments where status='pending_confirmation'`)).rows[0].c;

test('pessoas diferentes na mesma conversa têm um pedido cada; a mesma pessoa continua com um só', async () => {
  const db = await bootstrap();
  await direct(db, 'louzania santos');
  await direct(db, 'ana julia souza');
  assert.equal(await open(db), 2);
  await assert.rejects(direct(db, 'ana julia souza'), /appointments_one_open_request_idx/);
  // Cancelado não ocupa a vaga da pessoa.
  await direct(db, 'ana julia souza', 'cancelled');
});

test('sem recipient_key vale a regra antiga: um pedido aberto por conversa', async () => {
  const db = await bootstrap();
  await direct(db, null);
  await assert.rejects(direct(db, null), /appointments_one_open_request_idx/);
});

test('a função legada atualiza o pedido da mesma pessoa e cria o de outra', async () => {
  const db = await bootstrap();
  const mother = await upsert(db, { key: 'k1', recipient: 'louzania santos', name: 'Louzania Santos' });
  const girl = await upsert(db, { key: 'k2', recipient: 'ana julia souza', name: 'Ana Julia Souza' });
  assert.notEqual(mother.appointment.id, girl.appointment.id);
  const again = await upsert(db, { key: 'k3', recipient: 'ana julia souza', name: 'Ana Julia Souza', starts: future(48) });
  assert.equal(again.appointment.id, girl.appointment.id);
  assert.equal(again.appointment.metadata.request_version, 2);
  assert.equal((await upsert(db, { key: 'k3', recipient: 'ana julia souza' })).already, true);
  assert.equal(await open(db), 2);
  const legacy = await upsert(db, { key: 'k4' });
  const legacyAgain = await upsert(db, { key: 'k5' });
  assert.equal(legacy.appointment.id, legacyAgain.appointment.id);
});

test('rollback é bloqueado com vários pendentes e restaura o índice antigo sem eles', async () => {
  const db = await bootstrap();
  await direct(db, 'a'); await direct(db, 'b');
  await assert.rejects(db.exec(read(ROLLBACK)), /ROLLBACK_BLOCKED/);
  await db.exec('rollback');
  await db.query(`update appointments set status='cancelled' where metadata->>'recipient_key'='b'`);
  await db.exec(read(ROLLBACK));
  await assert.rejects(direct(db, 'c'), /appointments_one_open_request_idx/);
});

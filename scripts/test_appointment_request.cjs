// Pedido de agendamento aguardando confirmação do dono (migração 031): um pedido aberto por conversa,
// versão a cada mudança, repetição do mesmo turno sem efeito e isolamento entre tenants.
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
const future = hours => new Date(Date.now() + hours * 3600000).toISOString();

async function bootstrap() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table appointments(
      id uuid primary key default gen_random_uuid(), tenant_id uuid not null, title text not null,
      starts_at timestamptz not null, ends_at timestamptz, status text, metadata jsonb default '{}',
      channel_type text, external_conversation_id text, contact_name text, notes text, created_by uuid,
      created_at timestamptz default now(), updated_at timestamptz default now());
  `);
  await db.exec(read('supabase/migrations/031_appointment_requests.sql').replace(/notify pgrst[^;]*;/, ''));
  return db;
}

const upsert = async (db, { tenant = tenantA, chat = 'chat-1', starts = future(24), ends = null, key = 'k1', details = {} } = {}) => {
  const { rows } = await db.query(`select magia_upsert_appointment_request($1,'whatsapp',$2,'Maria Silva','Corte - Maria Silva',$3,$4,$5,$6) r`,
    [tenant, chat, starts, ends, JSON.stringify({ services: ['Corte'], ...details }), key]);
  return rows[0].r;
};
const cancel = async (db, { tenant = tenantA, chat = 'chat-1', reason = 'customer_cancelled', actor = 'ia' } = {}) =>
  (await db.query(`select magia_cancel_appointment_request($1,'whatsapp',$2,$3,$4) r`, [tenant, chat, reason, actor])).rows[0].r;
const openCount = async (db, tenant = tenantA) =>
  (await db.query(`select count(*)::int c from appointments where tenant_id=$1 and status='pending_confirmation'`, [tenant])).rows[0].c;

test('o primeiro pedido nasce na versão 1, aguardando confirmação', async () => {
  const r = await upsert(await bootstrap());
  assert.equal(r.created, true);
  assert.equal(r.appointment.status, 'pending_confirmation');
  assert.equal(r.appointment.metadata.request_version, 1);
  assert.equal(r.appointment.metadata.source, 'ai_appointment_request');
});

test('mudança da cliente atualiza o mesmo pedido e sobe a versão', async () => {
  const db = await bootstrap();
  const first = await upsert(db);
  const second = await upsert(db, { key: 'k2', starts: future(48), details: { services: ['Corte', 'Escova'] } });
  assert.equal(second.created, false);
  assert.equal(second.appointment.id, first.appointment.id);
  assert.equal(second.appointment.metadata.request_version, 2);
  assert.deepEqual(second.appointment.metadata.services, ['Corte', 'Escova']);
  assert.equal(await openCount(db), 1);
});

test('repetir o mesmo turno não muda versão nem dados', async () => {
  const db = await bootstrap();
  await upsert(db);
  const retry = await upsert(db, { starts: future(72) });
  assert.equal(retry.already, true);
  assert.equal(retry.appointment.metadata.request_version, 1);
});

test('pedido com horário vencido é atualizado, sem erro de duplicidade', async () => {
  const db = await bootstrap();
  const first = await upsert(db);
  await db.query(`update appointments set starts_at = now() - interval '1 hour' where id = $1`, [first.appointment.id]);
  const second = await upsert(db, { key: 'k2' });
  assert.equal(second.appointment.id, first.appointment.id);
  assert.equal(await openCount(db), 1);
});

test('data no passado é recusada', async () => {
  await assert.rejects(upsert(await bootstrap(), { starts: future(-1) }), /APPOINTMENT_REQUEST_PAST/);
});

test('pedido em envio não aceita mudança nem cancelamento', async () => {
  const db = await bootstrap();
  const first = await upsert(db);
  await db.query(`update appointments set metadata = metadata || '{"confirmation_state":"sending"}' where id = $1`, [first.appointment.id]);
  await assert.rejects(upsert(db, { key: 'k2' }), /APPOINTMENT_REQUEST_BUSY/);
  await assert.rejects(cancel(db), /APPOINTMENT_REQUEST_BUSY/);
});

test('cancelar fecha o pedido, guarda o motivo e libera um novo', async () => {
  const db = await bootstrap();
  const first = await upsert(db);
  const done = await cancel(db);
  assert.equal(done.cancelled, true);
  const { rows } = await db.query(`select status, metadata from appointments where id = $1`, [first.appointment.id]);
  assert.equal(rows[0].status, 'cancelled');
  assert.equal(rows[0].metadata.cancel_reason, 'customer_cancelled');
  assert.equal((await upsert(db, { key: 'k2' })).created, true);
});

test('cancelar sem pedido aberto não faz nada', async () => {
  assert.equal((await cancel(await bootstrap())).cancelled, false);
});

test('pedidos e cancelamentos não cruzam tenants nem conversas', async () => {
  const db = await bootstrap();
  await upsert(db);
  await upsert(db, { tenant: tenantB });
  await upsert(db, { chat: 'chat-2' });
  assert.equal(await openCount(db, tenantA), 2);
  await cancel(db, { tenant: tenantB });
  assert.equal(await openCount(db, tenantA), 2);
  assert.equal(await openCount(db, tenantB), 0);
});

test('agendamento confirmado não impede pedido novo na mesma conversa', async () => {
  const db = await bootstrap();
  const first = await upsert(db);
  await db.query(`update appointments set status = 'confirmed' where id = $1`, [first.appointment.id]);
  assert.equal((await upsert(db, { key: 'k2' })).created, true);
});

test('conflito considera sobreposição no tenant e ignora cancelados e outros tenants', async () => {
  const db = await bootstrap();
  const starts = future(24);
  const ends = new Date(Date.parse(starts) + 3600000).toISOString();
  const mine = await upsert(db, { starts, ends });
  const insert = (tenant, status, s) => db.query(
    `insert into appointments(tenant_id,title,starts_at,status,channel_type,external_conversation_id) values($1,$2,$3,$4,'whatsapp','outro')`,
    [tenant, status + ' ' + tenant.slice(0, 1), s, status]);
  await insert(tenantA, 'confirmed', new Date(Date.parse(starts) + 1800000).toISOString());
  await insert(tenantA, 'cancelled', starts);
  await insert(tenantB, 'confirmed', starts);
  await insert(tenantA, 'confirmed', future(30));
  const { rows } = await db.query(`select * from magia_appointment_request_conflicts($1,$2)`, [tenantA, mine.appointment.id]);
  assert.deepEqual(rows.map(row => row.title), ['confirmed 1']);
});

test('sem ends_at o conflito considera 2 horas', async () => {
  const db = await bootstrap();
  const starts = future(24);
  const mine = await upsert(db, { starts });
  await db.query(`insert into appointments(tenant_id,title,starts_at,status) values($1,'perto',$2,'scheduled')`,
    [tenantA, new Date(Date.parse(starts) + 90 * 60000).toISOString()]);
  const { rows } = await db.query(`select * from magia_appointment_request_conflicts($1,$2)`, [tenantA, mine.appointment.id]);
  assert.equal(rows.length, 1);
});

test('só o service_role executa as funções', async () => {
  const db = await bootstrap();
  const { rows } = await db.query(`select p.proname, has_function_privilege('authenticated', p.oid, 'execute') auth, has_function_privilege('anon', p.oid, 'execute') anon,
    has_function_privilege('service_role', p.oid, 'execute') svc from pg_proc p where p.proname like '%appointment_request%'`);
  assert.equal(rows.length, 3);
  for (const row of rows) assert.deepEqual([row.auth, row.anon, row.svc], [false, false, true], row.proname);
});

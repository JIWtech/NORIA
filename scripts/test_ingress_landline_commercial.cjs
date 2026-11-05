// Gênesis 23-27/10: avisos automáticos de banco/fintech vindos de telefone FIXO (5511…9102 "Visa Migração Credz",
// 5511…8976 "Vencimento do SParcelado"...) receberam resposta da IA e 14 follow-ups. A Entrada já os rotulava como
// "Número comercial", mas a supressão só aceita o fato autenticado, e magia_attest_turn_ingress só olhava isBusiness.
// Telefone fixo brasileiro só usa WhatsApp pelo app Business: o número da chave autenticada basta como prova.
// Roda a função REAL de produção (fixture) para provar a falha e a migração pendente para provar a correção.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(path.join(process.env.MAGIA_TEST_MODULES || path.join(__dirname, '../app/node_modules'), '@electric-sql/pglite'));

const root = path.join(__dirname, '..');
const PROD = fs.readFileSync(path.join(root, 'supabase/tests/fixtures/attest_turn_ingress_prod_2026_10_27.sql'), 'utf8');
const FIX = fs.readFileSync(path.join(root, 'supabase/migrations_pending_review/ingress_landline_commercial_v1.sql'), 'utf8');
const TENANT = '11111111-1111-4111-8111-111111111111', OTHER = '66666666-6666-4666-8666-666666666666';
const SOURCE = '22222222-2222-4222-8222-222222222222', PRINCIPAL = '33333333-3333-4333-8333-333333333333';

const SCHEMA = `
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table channels(tenant_id uuid, type text, status text, external_id text, config jsonb default '{}');
create table conversation_turn_ingress_sources(id uuid primary key, tenant_id uuid, instance_name text, enabled boolean, principal_id uuid);
create table conversation_turn_ingress_facts(source_id uuid, tenant_id uuid, chat_id text, instance_name text, external_message_id text,
  body_sha256 text, from_me boolean, owner_saved boolean, business_account boolean, phone_jid text,
  received_at timestamptz default clock_timestamp(), unique(source_id, external_message_id));
insert into channels values ('${TENANT}', 'whatsapp', 'active', 'genesis');
insert into conversation_turn_ingress_sources values ('${SOURCE}', '${TENANT}', 'genesis', true, '${PRINCIPAL}');
select set_config('request.jwt.claim.sub', '${PRINCIPAL}', false);
`;

async function database(functionSql) {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(functionSql);
  return db;
}
let seq = 0;
async function attest(db, remoteJid, data = {}, key = {}) {
  const id = 'msg-' + (++seq);
  const envelope = { instance: 'genesis', data: { key: { id, remoteJid, fromMe: false, ...key }, ...data } };
  await db.query('select magia_attest_turn_ingress($1, $2::jsonb, $3)', [SOURCE, JSON.stringify(envelope), 'a'.repeat(64)]);
  const rows = await db.query('select business_account from conversation_turn_ingress_facts where external_message_id = $1', [id]);
  return rows.rows[0].business_account;
}

test('produção: fixo de fintech sem isBusiness não vira comercial (a falha de 23-27/10)', async () => {
  const db = await database(PROD);
  assert.equal(await attest(db, '551131269102@s.whatsapp.net'), null);
});

test('correção: fixo brasileiro (DDD + 8 dígitos começando com 2 a 5) é número comercial', async () => {
  const db = await database(FIX);
  for (const jid of ['551131269102@s.whatsapp.net', '551131268976@s.whatsapp.net', '556140043332@s.whatsapp.net', '552125551234@s.whatsapp.net', '554732225000@s.whatsapp.net']) {
    assert.equal(await attest(db, jid), true, jid);
  }
});

test('correção: fixo prevalece mesmo se o provedor disser isBusiness=false', async () => {
  const db = await database(FIX);
  assert.equal(await attest(db, '551131269102@s.whatsapp.net', { isBusiness: false }), true);
});

test('celular continua como antes: só o booleano do provedor decide', async () => {
  const db = await database(FIX);
  assert.equal(await attest(db, '5521999990000@s.whatsapp.net'), null);
  assert.equal(await attest(db, '5521999990000@s.whatsapp.net', { isBusiness: false }), false);
  assert.equal(await attest(db, '5521999990000@s.whatsapp.net', { isBusiness: true }), true);
  // Celular antigo sem o nono dígito (começa com 6 a 9) não é fixo.
  assert.equal(await attest(db, '552198887777@s.whatsapp.net'), null);
});

test('número de outro país, grupo ou LID não é tratado como fixo brasileiro', async () => {
  const db = await database(FIX);
  for (const jid of ['14155552671@s.whatsapp.net', '351212345678@s.whatsapp.net', '120363025555555555@g.us', '123456789012345@lid']) {
    assert.equal(await attest(db, jid), null, jid);
  }
});

test('LID com número alternativo autenticado de fixo é comercial', async () => {
  const db = await database(FIX);
  assert.equal(await attest(db, '123456789012345@lid', {}, { remoteJidAlt: '551131269102@s.whatsapp.net' }), true);
});

test('a correção mantém as travas de origem e de escopo', async () => {
  const db = await database(FIX);
  await db.exec(`select set_config('request.jwt.claim.sub', '${OTHER}', false);`);
  await assert.rejects(attest(db, '551131269102@s.whatsapp.net'), /INGRESS_SOURCE_FORBIDDEN/);
  await db.exec(`select set_config('request.jwt.claim.sub', '${PRINCIPAL}', false);`);
  const envelope = { instance: 'outra', data: { key: { id: 'x', remoteJid: '551131269102@s.whatsapp.net', fromMe: false } } };
  await assert.rejects(db.query('select magia_attest_turn_ingress($1, $2::jsonb, $3)', [SOURCE, JSON.stringify(envelope), 'a'.repeat(64)]), /INGRESS_SCOPE_MISMATCH/);
});

test('rollback devolve exatamente a função de produção', () => {
  const rollback = fs.readFileSync(path.join(root, 'supabase/migrations_pending_review/ingress_landline_commercial_v1_rollback.sql'), 'utf8');
  const body = sql => sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION'));
  assert.equal(body(rollback), body(PROD));
});

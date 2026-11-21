'use strict';
// Executa as definições SQL do repositório em PGlite; substitui apenas o tipo
// pgvector por domínio escalar e operador de distância para testar o filtro.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('../app/node_modules/@electric-sql/pglite');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const functionSql = (sql, name) => sql.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`, 'i'))[0];
const proposal = read('supabase/migrations_pending_review/fase2_boundary.PROPOSAL.sql');
const rollback = read('supabase/migrations_pending_review/fase2_boundary.ROLLBACK.PROPOSAL.sql');
const knowledge = functionSql(read('supabase/migrations/011_ai_knowledge_pgvector.sql'), 'match_ai_knowledge').replace('extensions.vector(1536)', 'extensions.vector').replace(/\r\n/g, '\n');
const salonSql = read('supabase/migrations_pending_review/20261113000100_salon_appointment_outcomes.sql');
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', U = '33333333-3333-4333-8333-333333333333';
async function fixture() {
  const db = new PGlite();
  await db.exec(`create schema extensions; create domain extensions.vector as double precision;
    create function extensions.distance(extensions.vector,extensions.vector) returns double precision language sql immutable as 'select abs($1::float8-$2::float8)';
    create operator extensions.<=> (leftarg=extensions.vector,rightarg=extensions.vector,function=extensions.distance);
    create schema auth; create function auth.uid() returns uuid language sql as 'select ''${U}''::uuid';
    create table public.ai_knowledge_documents(id bigint, content text, metadata jsonb, embedding extensions.vector, tenant_slug text, approved boolean);
    insert into public.ai_knowledge_documents values (1,'A','{"tenant_slug":"a"}',1,'a',true),(2,'B','{"tenant_slug":"b"}',2,'b',true);
    create table public.tenants(id uuid primary key,slug text);
    create table public.tenant_settings(tenant_id uuid primary key,settings jsonb);
    create table public.tenant_members(tenant_id uuid,user_id uuid,email text,status text,role text);
    create table public.appointments(id uuid primary key,tenant_id uuid,status text,starts_at timestamptz,ends_at timestamptz,updated_at timestamptz,created_at timestamptz,metadata jsonb,channel_type text,external_conversation_id text,contact_name text);
    create table public.events(payload jsonb);
    create function public.magia_record_turn_control_event(jsonb) returns void language sql as 'insert into public.events values ($1)';
    insert into public.tenants values ('${A}','ic_salon'),('${B}','other');
    insert into public.tenant_settings values ('${A}','{"other":1}'),('${B}','{}');
    insert into public.tenant_members values ('${A}','${U}','a','active','agent'),('${B}','${U}','b','active','agent');
    insert into public.appointments values
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','${A}','scheduled',now()-interval '2 hours',now()-interval '1 hour',now(),now(),'{}','whatsapp','chat','Pessoa'),
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','${B}','scheduled',now()-interval '2 hours',now()-interval '1 hour',now(),now(),'{}','whatsapp','chat','Pessoa');`);
  await db.exec(knowledge);
  await db.exec(functionSql(salonSql, 'magia_mark_appointment_outcome'));
  await db.exec(functionSql(salonSql, 'magia_deposit_required_recipients'));
  return db;
}
test('isolamento, configuração e rollback executam as funções SQL reais', async () => {
  const db = await fixture();
  try {
    const count = async filter => (await db.query('select count(*)::int n from public.match_ai_knowledge(1::extensions.vector,5,$1::jsonb)', [JSON.stringify(filter)])).rows[0].n;
    assert.equal(await count({}), 2, 'reproduz vazamento antes');
    await db.exec(proposal);
    assert.equal(await count({}), 0); assert.equal(await count({tenant_slug:null}), 0);
    assert.equal(await count({tenant_slug:''}), 0); assert.equal(await count({tenant_slug:'a'}), 1);
    const mark = async id => (await db.query('select public.magia_mark_appointment_outcome($1,\'no_show\') x', [id])).rows[0].x;
    assert.equal((await mark('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).closed_conversation, false);
    assert.equal((await mark('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).closed_conversation, true);
    const recipients = async tenant => (await db.query('select * from public.magia_deposit_required_recipients($1)', [tenant])).rows.length;
    assert.equal(await recipients(A), 1); assert.equal(await recipients(B), 0);
    for (const value of [false, null, 'true']) {
      await db.query('update public.tenant_settings set settings=$1::jsonb where tenant_id=$2', [JSON.stringify({appointment_outcome_tracking:value}), B]);
      assert.equal(await recipients(B), 0, `valor ${JSON.stringify(value)} não habilita lista`);
      await db.query("update public.appointments set status='scheduled' where id=$1", ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']);
      assert.equal((await mark('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).closed_conversation, true, `valor ${JSON.stringify(value)} mantém fechamento`);
    }
    await db.exec(`update public.tenant_settings set settings='{"appointment_outcome_tracking":true}' where tenant_id='${B}'`);
    assert.equal(await recipients(B), 1);
    await db.exec(rollback);
    assert.equal(await count({}), 2); assert.equal(await recipients(A), 1); assert.equal(await recipients(B), 0);
    assert.deepEqual((await db.query('select settings from public.tenant_settings where tenant_id=$1',[A])).rows[0].settings, {other:1});
  } finally { await db.close(); }
});
test('divergência do baseline aborta toda a transação', async () => {
  const db = await fixture();
  try {
    await db.exec(`update public.tenant_settings set settings='{"appointment_outcome_tracking":false}' where tenant_id='${A}'`);
    await assert.rejects(db.exec(proposal), /SALON_SETTINGS_BASELINE_DIVERGED/);
    await db.exec('rollback');
    assert.equal((await db.query(`select count(*)::int n from public.match_ai_knowledge(1::extensions.vector,5,'{}')`)).rows[0].n, 2);
  } finally { await db.close(); }
});
test('consultas extraídas de claim e sales comparam fronteiras em quatro cenários', async () => {
  const db = new PGlite();
  try {
    const claimSource = functionSql(read('supabase/migrations_pending_review/turn_queue_closure_recovery_v1.sql'), 'magia_claim_turn');
    const salesSource = functionSql(read('supabase/migrations/025_sales_capability.sql'), 'magia_sales_move');
    const claimMatch = claimSource.match(/select id::text,created_at into b,bt from public\.channel_events[\s\S]*?order by created_at desc,id desc limit 1/i);
    const salesMatch = salesSource.match(/select id::text from public\.channel_events where tenant_id=lead\.tenant_id[\s\S]*?order by created_at desc,id desc limit 1/i);
    assert.ok(claimMatch && salesMatch, 'as consultas devem ser extraídas das funções do repositório');
    const claim = claimMatch[0].replace('id::text,created_at into b,bt', 'id::text').replace('tenant_slug=s', 'tenant_slug=$1').replace('external_conversation_id=p_chat', "external_conversation_id='chat'");
    const sales = salesMatch[0].replace('lead.tenant_id', '$1::uuid').replace('lead.channel_type', "'whatsapp'").replace('lead.chat_id', "'chat'");
    await db.exec('create table public.channel_events(id uuid, tenant_id uuid, tenant_slug text, channel_type text, external_conversation_id text, service text, ai_provider text, created_at timestamptz)');
    const compare = async slug => ({
      claim: (await db.query(`select coalesce((${claim}),'initial') id`, [slug])).rows[0].id,
      sales: (await db.query(`select coalesce((${sales}),'initial') id`, [A])).rows[0].id,
    });
    const first = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', second = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    assert.deepEqual(await compare('salon'), {claim:'initial',sales:'initial'});
    await db.query("insert into public.channel_events values ($1,$2,'salon','whatsapp','chat','conversation_closed',null,'2026-01-01')", [first,A]);
    assert.deepEqual(await compare('salon'), {claim:first,sales:first});
    assert.deepEqual(await compare('novo_slug'), {claim:'initial',sales:first});
    await db.query("insert into public.channel_events values ($1,$2,'salon','whatsapp','chat','conversation_closed',null,'2026-01-02')", [second,B]);
    assert.deepEqual(await compare('salon'), {claim:second,sales:first});
  } finally { await db.close(); }
});

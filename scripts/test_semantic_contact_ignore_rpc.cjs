const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { PGlite } = require('../app/node_modules/@electric-sql/pglite');
const sql = fs.readFileSync(require.resolve('../supabase/migrations_pending_review/semantic_automated_contact_ignore_v1.sql'), 'utf8');
const tenant = '10000000-0000-4000-8000-000000000001', other = '10000000-0000-4000-8000-000000000002';
const token = '20000000-0000-4000-8000-000000000001', event = '30000000-0000-4000-8000-000000000001';
const proof = { contract: 'noria_semantic_contact_ignore_v1', kind: 'external_automated_contact', other_business: 'Estúdio Exemplo',
  evidence_ids: [event], quoted_or_forwarded: false, contains_customer_request: false };
async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.role() returns text language sql as $$select current_setting('test.role',true)$$;
    select set_config('test.role','service_role',false);
    create table tenants(id uuid primary key,slug text);
    create table tenant_settings(tenant_id uuid,settings jsonb);
    create table conversation_turn_queue(tenant_id uuid,channel_type text,chat_id text,token uuid,phase text,lease_until timestamptz,
      claimed jsonb,pending jsonb,instance_name text,boundary_id text,current_delivery_id uuid,retry_batch_id uuid,attempt_count int,
      retry_max_attempts int,retry_base_seconds int,retry_cap_seconds int,next_attempt_at timestamptz,last_error_code text,
      review_required_at timestamptz,updated_at timestamptz);
    create table conversation_turn_terminal_receipts(turn_token uuid primary key,tenant_id uuid,chat_id text,outcome text,claimed jsonb,evidence jsonb);
    create table conversation_turn_delivery_attempts(tenant_id uuid,chat_id text,turn_token uuid);
    create table conversation_turn_ingress_sources(id uuid,tenant_id uuid,instance_name text,enabled bool);
    create table conversation_turn_ingress_facts(source_id uuid,tenant_id uuid,chat_id text,external_message_id text,from_me bool,instance_name text);
    create table channel_events(id uuid default gen_random_uuid(),tenant_id uuid,tenant_slug text,channel_type text,external_conversation_id text,
      external_message_id text,direction text,sender_type text,message_text text,service text,stage text,handoff bool,ai_provider text,
      ai_model text,delivery_status text,raw_payload jsonb);
    create table follow_up_jobs(tenant_id uuid,channel_type text,external_conversation_id text,status text,error text,lease_token uuid,locked_until timestamptz,updated_at timestamptz);
    insert into tenants values('${tenant}','tenant-a'),('${other}','tenant-b');
    insert into tenant_settings values('${tenant}','{"ai_model":"gemini-fixture"}');
    insert into conversation_turn_queue(tenant_id,channel_type,chat_id,token,phase,lease_until,claimed,pending,instance_name,boundary_id)
      values('${tenant}','whatsapp','chat','${token}','sending',now()+interval '5 minutes','[{"id":"external","event_id":"${event}"}]','[{"id":"new-human"}]','instance','session');
    insert into channel_events(id,tenant_id,channel_type,external_conversation_id,external_message_id,direction,sender_type)
      values('${event}','${tenant}','whatsapp','chat','external','inbound','contact');
    insert into conversation_turn_ingress_sources values('${event}','${tenant}','instance',true);
    insert into conversation_turn_ingress_facts values('${event}','${tenant}','chat','external',false,'instance');
    insert into follow_up_jobs(tenant_id,channel_type,external_conversation_id,status) values('${tenant}','whatsapp','chat','pending'),('${other}','whatsapp','chat','pending');
  `);
  await db.exec(sql); return db;
}
const ignore = (db, value = proof, t = tenant) => db.query('select magia_ignore_automated_turn($1,$2,$3,$4,$5::jsonb) as result', [t, 'chat', token, 'gemini-fixture', JSON.stringify(value)]);

test('ignora só o turno, cancela follow-up do tenant e preserva próxima mensagem humana', async () => {
  const db = await database();
  try {
    assert.equal((await ignore(db)).rows[0].result.finished, true);
    const q = (await db.query('select phase,claimed,pending from conversation_turn_queue')).rows[0];
    assert.equal(q.phase, 'ready'); assert.deepEqual(q.claimed, []); assert.equal(q.pending[0].id, 'new-human');
    assert.deepEqual((await db.query('select status from follow_up_jobs order by tenant_id')).rows.map(x => x.status), ['cancelled', 'pending']);
    const out = (await db.query("select message_text,delivery_status from channel_events where direction='outbound'")).rows;
    assert.deepEqual(out, [{ message_text: '', delivery_status: 'internal' }]);
    assert.equal((await ignore(db)).rows[0].result.idempotent, true);
    assert.equal((await db.query('select count(*)::int as n from conversation_turn_terminal_receipts')).rows[0].n, 1);
    await assert.rejects(ignore(db, proof, other), /SEMANTIC_IGNORE_SCOPE_MISMATCH/);
  } finally { await db.close(); }
});

test('prova antiga/incompleta ou pedido humano não conclui o turno', async () => {
  const db = await database();
  try {
    await assert.rejects(ignore(db, { ...proof, evidence_ids: [] }), /SEMANTIC_IGNORE_EVIDENCE_MISMATCH/);
    await assert.rejects(ignore(db, { ...proof, contains_customer_request: true }), /SEMANTIC_IGNORE_PROOF_INVALID/);
    assert.equal((await db.query('select count(*)::int as n from conversation_turn_terminal_receipts')).rows[0].n, 0);
  } finally { await db.close(); }
});

test('sem ingresso autenticado, com tentativa de entrega ou papel errado, recusa sem efeito', async () => {
  const db = await database();
  try {
    await db.exec('update conversation_turn_ingress_sources set enabled=false');
    await assert.rejects(ignore(db), /SEMANTIC_IGNORE_INGRESS_REQUIRED/);
    await db.exec('update conversation_turn_ingress_sources set enabled=true');
    await db.exec(`insert into conversation_turn_delivery_attempts values('${tenant}','chat','${token}')`);
    await assert.rejects(ignore(db), /SEMANTIC_IGNORE_DELIVERY_ATTEMPTED/);
    await db.exec("select set_config('test.role','authenticated',false)");
    await assert.rejects(ignore(db), /SEMANTIC_IGNORE_FORBIDDEN/);
  } finally { await db.close(); }
});

test('proposta de prompt é guardada por hash, preserva configurações e tem rollback exato', async () => {
  const db = await database();
  try {
    const before = fs.readFileSync(require.resolve('../clients/clinica_nubia_oficial/prompts/system_prompt_contract_alignment_v5.txt'), 'utf8');
    const after = fs.readFileSync(require.resolve('../clients/clinica_nubia_oficial/prompts/system_prompt_context_v6.txt'), 'utf8');
    const apply = fs.readFileSync(require.resolve('../supabase/migrations_pending_review/nubia_context_prompt_v6.sql'), 'utf8');
    const rollback = fs.readFileSync(require.resolve('../supabase/migrations_pending_review/nubia_context_prompt_v6_rollback.sql'), 'utf8');
    await db.query('update tenants set slug=$1 where id=$2', ['clinica_nubia_oficial', tenant]);
    await db.query("update tenant_settings set settings=settings || jsonb_build_object('system_prompt',$1::text)", [before]);
    await db.exec(apply);
    let settings = (await db.query('select settings from tenant_settings')).rows[0].settings;
    assert.equal(settings.system_prompt, after); assert.equal(settings.ai_model, 'gemini-fixture');
    await db.exec(rollback);
    settings = (await db.query('select settings from tenant_settings')).rows[0].settings;
    assert.equal(settings.system_prompt, before);
    await db.query("update tenant_settings set settings=settings || '{\"system_prompt\":\"alteração concorrente\"}'::jsonb");
    await assert.rejects(db.exec(apply), /NUBIA_PROMPT_DRIFT_OR_SCOPE_MISMATCH/);
    await db.exec('rollback');
  } finally { await db.close(); }
});

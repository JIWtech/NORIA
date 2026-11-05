const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(path.join(process.env.MAGIA_TEST_MODULES || path.join(__dirname, '../app/node_modules'), '@electric-sql/pglite'));
const root = path.join(__dirname, '..');
const tenant = '00000000-0000-0000-0000-000000000001';
const other = '00000000-0000-0000-0000-000000000002';
const anchor = '00000000-0000-0000-0000-000000000003';
const chat = '5521988887777@s.whatsapp.net';
async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create function auth.role() returns text language sql as $$select coalesce(current_setting('test.role',true),'service_role')$$;
    create table tenants(id uuid primary key,slug text,status text,deleted_at timestamptz);
    create table tenant_settings(tenant_id uuid primary key,settings jsonb,updated_at timestamptz);
    create table channels(tenant_id uuid,type text,external_id text,status text);
    create table channel_events(id uuid primary key default gen_random_uuid(),tenant_id uuid,channel_type text,
      external_conversation_id text,direction text,sender_type text,handoff boolean,service text,ai_provider text,ai_error text,
      raw_payload jsonb default '{}',created_at timestamptz default now());
    create table sales_leads(tenant_id uuid,channel_type text,chat_id text,session_id text,stage_key text,
      ai_locked boolean default false,interest_registered boolean default false);
    insert into tenants values ('${tenant}','wesley_automoveis','active',null),('${other}','clinic','active',null);
    insert into tenant_settings values ('${tenant}','{"contact_exclusion_enabled":true,"conversation_capability":"sales_v1",
      "whatsapp_processing_mode":"conversation_core_v1","ai_enabled":true,"follow_up_enabled":true,"sales_follow_up":{"enabled":true},
      "sales":{"stage_keys":{"initial":"sales_new","qualifying":"sales_qualifying"},"stages":{"sales_new":{"allow_ai":true},"sales_qualifying":{"allow_ai":true}}}}',now()),
      ('${other}','{}',now());`);
  for (const name of ['019_follow_up_jobs.sql','026_tenant_ai_contact_exclusions.sql','027_sales_follow_up_guards.sql']) {
    await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations', name), 'utf8'));
  }
  return db;
}
async function status(db, jid, tid = tenant) {
  return (await db.query('select magia_contact_exclusion_status($1,$2) as value',[tid,jid])).rows[0].value;
}
async function seed(db) {
  await db.query('insert into tenant_ai_excluded_contacts(tenant_id,phone) values($1,$2)',[tenant,'5521999998888']);
}
test('exclusion is tenant-scoped, handles ninth digit and device JIDs, and fails closed for LID/empty list', async () => {
  const db = await setup();
  try {
    assert.equal((await status(db,chat)).reason,'exclusion_list_empty');
    await seed(db);
    for (const jid of ['5521999998888@s.whatsapp.net','552199998888@s.whatsapp.net','21999998888','+55 (21) 99999-8888','5521999998888:7@s.whatsapp.net']) {
      assert.equal((await status(db,jid)).blocked,true,jid);
    }
    assert.equal((await status(db,chat)).blocked,false);
    assert.equal((await status(db,'5521999998888@s.whatsapp.net',other)).blocked,false);
    assert.equal((await status(db,'123456789012345@lid')).reason,'contact_identity_unresolved');
    assert.equal((await status(db,'invalid')).blocked,true);
    await db.query(`insert into channel_events(tenant_id,channel_type,external_conversation_id,direction,sender_type,raw_payload)
      values($1,'whatsapp','123456789012345@lid','inbound','contact',$2)`,[tenant,{exclusion_phone:'5521999998888@s.whatsapp.net'}]);
    assert.equal((await status(db,'123456789012345@lid')).reason,'contact_excluded');
    await db.exec("set test.role='authenticated'");
    await assert.rejects(status(db,chat),/denied/);
  } finally { await db.close(); }
});

test('activation SQLs preserve other tenants, validate the import and are repeatable without retrospective jobs',async()=>{
  const db=await setup();
  const clientFile=name=>fs.readFileSync(path.join(root,'clients/wesley_automoveis',name),'utf8');
  try {
    await db.query(`insert into channels values($1,'whatsapp','wesley-carros','active')`,[tenant]);
    await db.query(`insert into tenant_ai_excluded_contacts(tenant_id,phone)
      select $1,('552199'||lpad(n::text,7,'0')) from generate_series(1,3260) n`,[tenant]);
    await db.exec(clientFile('12_restaurar_trava_contatos.sql'));
    for(let i=0;i<2;i++)await db.exec(clientFile('13_ativar_follow_up.sql'));
    const policies=(await db.query('select * from follow_up_policies where tenant_id=$1 and enabled',[tenant])).rows;
    assert.equal(policies.length,1);assert.deepEqual(policies[0].steps.map(s=>s.delay_minutes),[180,1440,21600]);
    assert.equal((await db.query('select count(*)::int as n from follow_up_jobs')).rows[0].n,0);
    assert.deepEqual((await db.query('select settings from tenant_settings where tenant_id=$1',[other])).rows[0].settings,{});
    await db.exec(clientFile('15_pausar_follow_up.sql'));
    const cfg=(await db.query('select settings from tenant_settings where tenant_id=$1',[tenant])).rows[0].settings;
    assert.equal(cfg.follow_up_enabled,false);assert.equal(cfg.contact_exclusion_enabled,true);assert.equal(cfg.ai_enabled,true);
    await db.exec(clientFile('13_ativar_follow_up.sql'));
    assert.equal((await db.query('select count(*)::int as n from follow_up_policies where tenant_id=$1 and enabled',[tenant])).rows[0].n,1);
    await db.exec(clientFile('14_diagnostico_trava_follow_up.sql'));
  } finally {await db.close();}
});
test('Brazilian aliases work in both directions without inventing mobile aliases for landlines', async () => {
  const db=await setup();
  try {
    await db.query('insert into tenant_ai_excluded_contacts(tenant_id,phone) values($1,$2),($1,$3)',[tenant,'552188887777','552133334444']);
    assert.equal((await status(db,chat)).blocked,true);
    assert.equal((await status(db,'5521933334444@s.whatsapp.net')).blocked,false);
  } finally { await db.close(); }
});
test('sales follow-up validates anchor, lease, policy, control and exclusion at dispatch time', async () => {
  const db=await setup();
  const eligible=async()=> (await db.query('select magia_sales_followup_eligible($1,$2,$3) as ok',[tenant,chat,anchor])).rows[0].ok;
  try {
    await seed(db);
    await db.query(`insert into channel_events(id,tenant_id,channel_type,external_conversation_id,direction,sender_type,
      handoff,service,ai_provider,raw_payload,created_at) values($1,$2,'whatsapp',$3,'outbound','assistant',false,
      'sales_qualification','sales_core','{"conversation_session_id":"initial"}',now()-interval '4 hours')`,[anchor,tenant,chat]);
    await db.query(`insert into sales_leads values($1,'whatsapp',$2,'initial','sales_qualifying',false,false)`,[tenant,chat]);
    assert.equal(await eligible(),true);
    await db.query('update follow_up_policies set enabled=true where tenant_id=$1',[tenant]);
    await db.query('select magia_schedule_followups($1,$2,$3,$4)',[tenant,'whatsapp',chat,anchor]);
    await db.exec("update follow_up_jobs set due_at=now()-interval '1 second'");
    const job=(await db.query('select * from magia_claim_followup_jobs(1)')).rows[0];
    const guard=async()=> (await db.query('select magia_validate_sales_followup($1,$2) as value',[job.id,job.lease_token])).rows[0].value.allowed;
    assert.equal(await guard(),true);
    await db.query('insert into tenant_ai_excluded_contacts(tenant_id,phone) values($1,$2)',[tenant,'552188887777']);
    assert.equal(await guard(),false);
    await db.query('delete from tenant_ai_excluded_contacts where tenant_id=$1 and phone=$2',[tenant,'552188887777']);
    await db.exec('update sales_leads set ai_locked=true'); assert.equal(await guard(),false);
    await db.exec('update sales_leads set ai_locked=false,interest_registered=true'); assert.equal(await guard(),false);
    await db.exec("update sales_leads set interest_registered=false,stage_key='sales_after_sales'"); assert.equal(await guard(),false);
    await db.exec("update sales_leads set stage_key='sales_qualifying'"); assert.equal(await guard(),true);
    await db.query(`insert into channel_events(tenant_id,channel_type,external_conversation_id,direction,sender_type)
      values($1,'whatsapp',$2,'inbound','contact')`,[tenant,chat]);
    assert.equal(await guard(),false);
    await db.query('select magia_schedule_followups($1,$2,$3,$4)',[tenant,'whatsapp',chat,anchor]);
    assert.equal((await db.query("select count(*)::int as n from follow_up_jobs where status='pending'")).rows[0].n,0);
  } finally { await db.close(); }
});

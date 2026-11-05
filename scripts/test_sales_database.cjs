const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require(path.join(process.env.MAGIA_TEST_MODULES||path.join(__dirname, '../app/node_modules'),'@electric-sql/pglite'));
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const tid='11111111-1111-1111-1111-111111111111',other='22222222-2222-2222-2222-222222222222';
const owner='8fb2bc06-94d5-4abe-83b2-1aed41a346ae',token='33333333-3333-3333-3333-333333333333';
test('sales database activation, isolation, score, manual fencing and document RLS',async()=>{
  const db=new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;
      create schema auth;create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create table tenant_members(tenant_id uuid,user_id uuid,role text,status text);
      create table tenants(id uuid primary key,slug text,status text,deleted_at timestamptz);
      create table tenant_settings(tenant_id uuid primary key,settings jsonb,updated_at timestamptz);
      create table channels(tenant_id uuid,type text,external_id text,status text,config jsonb,updated_at timestamptz);
      create table ai_prompt_versions(tenant_id uuid,active boolean);
      create table kanban_boards(id uuid primary key default gen_random_uuid(),tenant_id uuid,name text,is_default boolean);
      create table kanban_columns(tenant_id uuid,board_id uuid,name text,position integer,automation_key text);
      create table channel_events(id uuid primary key default gen_random_uuid(),tenant_id uuid,tenant_slug text,channel_type text,
        external_conversation_id text,external_message_id text,direction text,sender_type text,message_text text,service text,stage text,
        handoff boolean,ai_provider text,raw_payload jsonb,created_at timestamptz default clock_timestamp());
      create table conversation_turn_queue(tenant_id uuid,channel_type text,chat_id text,token uuid,phase text,boundary_id text);
      insert into tenants values('${tid}','wesley_automoveis','active',null),('${other}','other','active',null);
      insert into tenant_members values('${tid}','${owner}','owner','active');
      insert into tenant_settings values('${tid}','{}',now()),('${other}','{"unchanged":true}',now());
      insert into channels values('${tid}','whatsapp','wesley-carros','pending','{"phone":"5521992923139"}',now());
      grant usage on schema public,auth to authenticated;
      grant select on tenant_members to authenticated;
      select set_config('request.jwt.claim.sub','${owner}',false);`);
    await db.exec(read('supabase/migrations/025_sales_capability.sql'));
    await db.exec(read('supabase/migrations/025_sales_capability.sql'));
    await db.exec(read('clients/wesley_automoveis/04_ativar_sales.sql'));
    await db.exec(read('clients/wesley_automoveis/04_ativar_sales.sql'));
    assert.equal((await db.query('select count(*)::int n from kanban_columns')).rows[0].n,8);
    assert.deepEqual((await db.query('select settings from tenant_settings where tenant_id=$1',[other])).rows[0].settings,{unchanged:true});
    await db.exec(`insert into conversation_turn_queue values('${tid}','whatsapp','chat','${token}','sending','initial');`);
    const save=async({revision=0,register=false,deposit=1289400,stage='sales_qualifying',documents=[]}={})=>(await db.query(
      'select magia_sales_save($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) lead',
      [tid,'chat','initial',token,revision,'request',{intent:'buy',customer_name:'Test',deposit_cents:deposit},
        {id:'product',price_cents:4298000},stage,register,documents])).rows[0].lead;
    let lead=await save({register:true});
    assert.equal(lead.hot,true);assert.equal(lead.stage_key,'sales_hot');assert.equal(lead.ai_locked,true);
    await assert.rejects(save({revision:lead.revision}),/SALES_CONTROL_CHANGED/);
    await db.exec('set role authenticated');
    lead=(await db.query('select magia_sales_move($1,$2,$3) lead',[lead.id,'sales_qualifying',lead.revision])).rows[0].lead;
    assert.equal(lead.ai_locked,false);
    await assert.rejects(db.query('select magia_sales_move($1,$2,$3)',[lead.id,'does_not_exist',lead.revision]),/INVALID_SALES_STAGE/);
    await db.exec('reset role');
    await assert.rejects(save({revision:1}),/SALES_CONTROL_CHANGED/);
    lead=await save({revision:lead.revision,deposit:1289399});assert.equal(lead.hot,false);
    const event=(await db.query(`insert into channel_events(tenant_id,channel_type,external_conversation_id,direction)
      values($1,'whatsapp','chat','inbound') returning id`,[tid])).rows[0];
    lead=await save({revision:lead.revision,documents:[{event_id:event.id,extracted:{name:'SYNTHETIC DOCUMENT'}}]});
    await db.exec('set role authenticated');
    assert.equal((await db.query('select * from sales_documents')).rows.length,1);
    await db.exec(`select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false);`);
    assert.equal((await db.query('select * from sales_leads')).rows.length,0);
    assert.equal((await db.query('select * from sales_documents')).rows.length,0);
    await assert.rejects(db.query('select magia_sales_move($1,$2,$3)',[lead.id,'sales_qualifying',lead.revision]),/SALES_ACCESS_DENIED/);
    await assert.rejects(db.query("insert into sales_leads(tenant_id,chat_id,session_id,stage_key) values($1,'hacked','initial','sales_new')",[tid]),/permission denied/);
    await db.exec('reset role');
    await db.exec(`insert into tenant_members values('${tid}','55555555-5555-4555-8555-555555555555','viewer','active');
      select set_config('request.jwt.claim.sub','55555555-5555-4555-8555-555555555555',false);set role authenticated;`);
    assert.equal((await db.query('select * from sales_leads')).rows.length,1);
    assert.equal((await db.query('select * from sales_documents')).rows.length,0);
    await db.exec(`reset role;select set_config('request.jwt.claim.sub','${owner}',false);`);
    await db.exec(`insert into channel_events(tenant_id,channel_type,external_conversation_id,direction,service,ai_provider)
      values('${tid}','whatsapp','chat','outbound','conversation_assigned','command_router');`);
    await assert.rejects(save({revision:lead.revision}),/SALES_CONTROL_CHANGED/);
    await db.exec(`insert into channel_events(tenant_id,channel_type,external_conversation_id,direction,service,ai_provider)
      values('${tid}','whatsapp','chat','outbound','conversation_closed','command_router');`);
    await assert.rejects(save({revision:lead.revision}),/STALE_SALES_SESSION/);
    lead=(await db.query('select * from sales_leads where id=$1',[lead.id])).rows[0];
    await db.exec('set role authenticated');
    await assert.rejects(db.query('select magia_sales_move($1,$2,$3)',[lead.id,'sales_qualifying',lead.revision]),/SALES_SESSION_CLOSED/);
    await db.exec('reset role');
    await db.exec(read('clients/wesley_automoveis/06_pausar_sales.sql'));
    assert.equal((await db.query('select settings from tenant_settings where tenant_id=$1',[tid])).rows[0].settings.ai_enabled,false);
    assert.deepEqual((await db.query('select settings from tenant_settings where tenant_id=$1',[other])).rows[0].settings,{unchanged:true});
  } finally {await db.close();}
});

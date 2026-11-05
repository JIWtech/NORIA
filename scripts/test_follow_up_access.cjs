const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require(path.join(process.env.MAGIA_TEST_MODULES||path.join(__dirname, '../app/node_modules'),'@electric-sql/pglite'));
test('follow-up dashboard denies anonymous and unrelated users, permits active tenant members',async()=>{
  const db=new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create schema auth;
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('app.uid',true),'')::uuid$$;
      grant usage on schema auth to authenticated;
      create table tenants(id uuid,slug text,status text,deleted_at timestamptz);
      create table tenant_members(tenant_id uuid,user_id uuid,status text);
      create table follow_up_jobs(id int,tenant_id uuid);
      alter table follow_up_jobs enable row level security;
      grant select on tenants,tenant_members to authenticated;
      grant select on follow_up_jobs to anon;
      create policy follow_up_jobs_select_nubia_dashboard on follow_up_jobs for select to anon,authenticated using(true);
      insert into tenants values('11111111-1111-1111-1111-111111111111','clinica_nubia_oficial','active',null);
      insert into tenant_members values('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','active');
      insert into follow_up_jobs values(1,'11111111-1111-1111-1111-111111111111');`);
    const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/023_follow_up_dashboard_access.sql'),'utf8');
    await db.exec(sql);await db.exec(sql);
    await db.exec('set role anon');
    await assert.rejects(db.query('select * from follow_up_jobs'),/permission denied/);
    await db.exec('reset role;set role authenticated');
    assert.equal((await db.query('select * from follow_up_jobs')).rows.length,0);
    await db.exec("set app.uid='33333333-3333-3333-3333-333333333333'");
    assert.equal((await db.query('select * from follow_up_jobs')).rows.length,0);
    await db.exec("set app.uid='22222222-2222-2222-2222-222222222222'");
    assert.equal((await db.query('select * from follow_up_jobs')).rows.length,1);
  } finally {await db.close();}
});

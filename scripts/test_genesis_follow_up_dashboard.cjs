const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(path.join(process.env.MAGIA_TEST_MODULES || path.join(__dirname, '../app/node_modules'), '@electric-sql/pglite'));

test('Genesis dashboard SQL is idempotent, read-only for jobs, and tenant isolated', async () => {
  const db = new PGlite();
  const genesis = '11111111-1111-1111-1111-111111111111';
  const nubia = '22222222-2222-2222-2222-222222222222';
  const user = '33333333-3333-3333-3333-333333333333';
  try {
    await db.exec(`
      create role authenticated; create role anon; create schema auth;
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('app.uid',true),'')::uuid$$;
      grant usage on schema auth to authenticated;
      create table tenants(id uuid,slug text,status text,deleted_at timestamptz);
      create table tenant_settings(tenant_id uuid,settings jsonb);
      create table tenant_members(tenant_id uuid,user_id uuid,status text);
      create table kanban_boards(id uuid,tenant_id uuid,is_default boolean,settings jsonb);
      create table kanban_columns(tenant_id uuid,board_id uuid,name text,position int,automation_key text,unique(tenant_id,board_id,name));
      create table follow_up_jobs(id int,tenant_id uuid,status text);
      alter table follow_up_jobs enable row level security;
      grant select on tenants,tenant_members to authenticated;
      insert into tenants values('${genesis}','wesley_automoveis','active',null),('${nubia}','clinica_nubia_oficial','active',null);
      insert into tenant_settings values('${genesis}','{"conversation_capability":"sales_v1","follow_up_enabled":true}');
      insert into tenant_members values('${genesis}','${user}','active');
      insert into kanban_boards values('${genesis}','${genesis}',true,'{"capability":"sales_v1"}'),('${nubia}','${nubia}',true,'{}');
      insert into kanban_columns values('${genesis}','${genesis}','Qualificacao',2,'sales_qualifying'),('${nubia}','${nubia}','Follow Ups',9,'follow_ups');
      insert into follow_up_jobs values(1,'${genesis}','pending'),(2,'${nubia}','pending');
      create policy follow_up_jobs_select_nubia_dashboard on follow_up_jobs for select to authenticated
        using(tenant_id='${nubia}' and exists(select 1 from tenant_members m where m.tenant_id=follow_up_jobs.tenant_id and m.user_id=auth.uid() and m.status='active'));
    `);
    const jobsBefore = (await db.query('select * from follow_up_jobs order by id')).rows;
    const settingsBefore = (await db.query('select * from tenant_settings')).rows;
    const sql = fs.readFileSync(path.join(__dirname, '../clients/wesley_automoveis/16_kanban_follow_up.sql'), 'utf8');
    await db.exec(sql);
    await db.exec(sql);
    assert.deepEqual((await db.query('select * from follow_up_jobs order by id')).rows, jobsBefore);
    assert.deepEqual((await db.query('select * from tenant_settings')).rows, settingsBefore);
    assert.deepEqual((await db.query(`select name,position from kanban_columns where tenant_id='${genesis}' order by position`)).rows,
      [{ name: 'Qualificacao', position: 2 }, { name: 'Follow Ups', position: 3 }]);
    assert.equal((await db.query(`select position from kanban_columns where tenant_id='${nubia}'`)).rows[0].position, 9);
    await db.exec('set role anon');
    await assert.rejects(db.query('select * from follow_up_jobs'), /permission denied/);
    await db.exec('reset role; set role authenticated');
    assert.equal((await db.query('select * from follow_up_jobs')).rows.length, 0);
    await db.exec(`set app.uid='${user}'`);
    assert.deepEqual((await db.query('select id from follow_up_jobs')).rows, [{ id: 1 }]);
    await assert.rejects(db.exec("update follow_up_jobs set status='sent'"), /permission denied/);
    await db.exec(`reset role; update tenant_members set status='inactive'; set role authenticated`);
    assert.equal((await db.query('select * from follow_up_jobs')).rows.length, 0);
    await db.exec(`reset role; insert into tenant_members values('${nubia}','${user}','active'); set role authenticated`);
    assert.deepEqual((await db.query('select id from follow_up_jobs')).rows, [{ id: 2 }]);
  } finally {
    await db.close();
  }
});

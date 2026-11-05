const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('../app/node_modules/@electric-sql/pglite');
const baseline = fs.readFileSync(path.join(__dirname,'../supabase/migrations/014_channel_media_storage.sql'),'utf8');
const proposal = path.join(__dirname,'../supabase/migrations_pending_review/channel_media_exact_tenant_scope.PROPOSAL.sql');
const user = '00000000-0000-0000-0000-000000000001';
async function fixture() {
  const db = new PGlite();
  await db.exec(`create role authenticated nosuperuser;
    create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql stable as $$ select '${user}'::uuid $$;
    create table tenants(id uuid primary key,slug text);
    create table tenant_members(tenant_id uuid,user_id uuid,status text);
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
    create table storage.objects(id text primary key,bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant usage on schema public,auth,storage to authenticated;
    grant select on tenants,tenant_members,storage.objects to authenticated;
    insert into tenants values ('10000000-0000-0000-0000-000000000001','wesley_automoveis'),
      ('10000000-0000-0000-0000-000000000002','wesleyXautomoveis');
    insert into tenant_members values ('10000000-0000-0000-0000-000000000001','${user}','active');
    insert into storage.objects values ('own','channel-media','wesley_automoveis/whatsapp/document.pdf'),
      ('wildcard','channel-media','wesleyXautomoveis/whatsapp/document.pdf'),
      ('prefix','channel-media','wesley_automoveis_extra/whatsapp/document.pdf'),
      ('other-bucket','other','wesley_automoveis/whatsapp/document.pdf'),
      ('no-folder','channel-media','wesley_automoveis');`);
  await db.exec(baseline);
  return db;
}
async function ids(db) {
  await db.exec('set role authenticated');
  try { return (await db.query('select id from storage.objects order by id')).rows.map(r=>r.id); }
  finally { await db.exec('reset role'); }
}
test('RLS isola o segmento exato do tenant, incluindo slugs com underscore',async()=>{
  const db = await fixture();
  try {
    await db.exec(fs.readFileSync(proposal,'utf8'));
    assert.deepEqual(await ids(db),['own']);
  } finally { await db.close(); }
});
test('política corrigida é repetível e mantém vínculo ativo e bucket privado',async()=>{
  const db = await fixture();
  try {
    const sql=fs.readFileSync(proposal,'utf8');await db.exec(sql);await db.exec(sql);
    assert.deepEqual(await ids(db),['own']);
    await db.exec("update tenant_members set status='inactive'");
    assert.deepEqual(await ids(db),[]);
    assert.equal((await db.query("select public from storage.buckets where id='channel-media'")).rows[0].public,false);
    await db.exec("update tenant_members set status='active',tenant_id='10000000-0000-0000-0000-000000000002'");
    assert.deepEqual(await ids(db),['wildcard']);
  } finally { await db.close(); }
});
test('mudança concorrente de expressão ou roles é recusada sem sobrescrever a política',async()=>{
  for(const mutation of ["alter policy channel_media_read_member on storage.objects using(false)",
    "alter policy channel_media_read_member on storage.objects to public"]) {
    const db=await fixture();
    try {
      await db.exec(mutation);
      const before=(await db.query("select qual,roles from pg_policies where policyname='channel_media_read_member'")).rows;
      await assert.rejects(db.exec(fs.readFileSync(proposal,'utf8')),/STORAGE_POLICY_BASELINE_MISMATCH/);
      await db.exec('rollback');
      assert.deepEqual((await db.query("select qual,roles from pg_policies where policyname='channel_media_read_member'")).rows,before);
    } finally { await db.close(); }
  }
});

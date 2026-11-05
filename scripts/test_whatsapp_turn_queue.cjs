const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(path.join(process.env.MAGIA_TEST_MODULES || path.join(__dirname, '../app/node_modules'), '@electric-sql/pglite'));

test('durable queue: grouping, deduplication, fencing, isolation and uncertain delivery', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table tenants(id uuid primary key,slug text,status text,deleted_at timestamptz);
      create table channels(tenant_id uuid,type text,status text,external_id text,config jsonb);
      create table channel_events(id uuid primary key default gen_random_uuid(),tenant_id uuid,tenant_slug text,
        channel_type text,external_conversation_id text,external_message_id text,direction text,sender_type text,
        contact_name text,message_text text,service text,stage text,handoff boolean,ai_provider text,raw_payload jsonb,
        created_at timestamptz default clock_timestamp(),unique(tenant_slug,channel_type,external_message_id));
      insert into tenants values ('11111111-1111-1111-1111-111111111111','clinic','active',null);
      insert into channels values ('11111111-1111-1111-1111-111111111111','whatsapp','active','clinic','{}');
    `);
    await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/017_whatsapp_turn_queue.sql'),'utf8'));
    const tid='11111111-1111-1111-1111-111111111111';
    const rpc=async(name,args)=> (await db.query(`select magia_${name}_turn(${args.map((_,i)=>'$'+(i+1)).join(',')}) as r`,args)).rows[0].r;
    const enqueue=(id,text)=>rpc('enqueue',[tid,'chat','clinic',JSON.stringify({id,text,name:'Cliente'}),3000]);
    const quiet=()=>db.exec("update conversation_turn_queue set quiet_until=now()-interval '1 second'");
    for(const [i,text] of ['Oi','Quero agendar','amanha','as 10h'].entries()) await enqueue(String(i),text);
    assert.equal((await enqueue('0','duplicate')).duplicate,true);
    assert.equal((await rpc('claim',[tid,'chat'])).reason,'quiet_window');
    await quiet();
    const a=await rpc('claim',[tid,'chat']);
    assert.equal(a.messages.length,4);
    assert.equal((await rpc('claim',[tid,'chat'])).reason,'busy');
    await enqueue('4','Sou Maria');
    assert.equal((await rpc('commit',[tid,'chat',a.token])).reason,'new_messages');
    await rpc('finish',[tid,'chat',a.token,'retry']); await quiet();
    const b=await rpc('claim',[tid,'chat']);
    assert.equal(b.messages.length,5);
    assert.equal((await rpc('commit',[tid,'chat',a.token])).reason,'lost_lease');
    assert.equal((await rpc('commit',[tid,'chat',b.token])).committed,true);
    await rpc('finish',[tid,'chat',b.token,'done']);
    assert.equal((await db.query('select count(*)::int n from channel_events')).rows[0].n,5);
    await assert.rejects(rpc('enqueue',[tid,'chat','wrong-instance',JSON.stringify({id:'wrong'}),3000]),/Instance/);
    await enqueue('5','nova mensagem'); await quiet(); const c=await rpc('claim',[tid,'chat']);
    await db.exec(`insert into channel_events(tenant_slug,channel_type,external_conversation_id,service)
      values('clinic','whatsapp','chat','conversation_closed')`);
    assert.equal((await rpc('commit',[tid,'chat',c.token])).reason,'conversation_control_changed');
    await rpc('finish',[tid,'chat',c.token,'cancelled']);
    await enqueue('6','depois de encerrar'); await quiet(); const d=await rpc('claim',[tid,'chat']);
    assert.equal((await rpc('commit',[tid,'chat',d.token])).committed,true);
    await rpc('finish',[tid,'chat',d.token,'uncertain']);
    assert.equal((await rpc('claim',[tid,'chat'])).reason,'delivery_uncertain');
    await db.exec('set role authenticated');
    await assert.rejects(rpc('claim',[tid,'chat']),/permission denied/);
  } finally { await db.close(); }
});

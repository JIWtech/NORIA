const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { PGlite } = require('../app/node_modules/@electric-sql/pglite');

async function run() {
  const defaultMigration = path.join(__dirname, '../supabase/migrations/20261109163222_genesis_preserve_sales_stage_on_conversation_close.sql');
  const source = readFileSync(process.argv[2] || defaultMigration, 'utf8');
  const trigger = source.match(/CREATE OR REPLACE FUNCTION public\.magia_sales_human_control\(\)[\s\S]*?end \$function\$/i)?.[0];
  assert.ok(trigger, 'A definição da regra de controle comercial precisa estar no arquivo.');
  const db = new PGlite();
  try {
    await db.exec(`
      create table tenant_settings (tenant_id text primary key, settings jsonb);
      create table conversation_turn_queue (tenant_id text, channel_type text, chat_id text);
      create table sales_leads (
        id uuid primary key default gen_random_uuid(), tenant_id text, channel_type text, chat_id text,
        session_id text default 'initial', stage_key text, ai_locked boolean, revision integer default 4,
        created_at timestamptz default now(), updated_at timestamptz default '2026-11-01T12:00:00Z'
      );
      create table channel_events (
        id uuid primary key default gen_random_uuid(), tenant_id text, channel_type text, external_conversation_id text,
        direction text, service text, ai_provider text, created_at timestamptz default now()
      );
      insert into tenant_settings values ('genesis', '{
        "conversation_capability":"sales_v1",
        "sales":{
          "stage_keys":{"closed":"sales_closed","human":"sales_human","qualifying":"sales_qualifying"},
          "stages":{"sales_financing":{"allow_ai":false},"sales_appraisal":{"allow_ai":false},"sales_closed":{"closed":true}}
        }
      }'), ('salon', '{}');
      ${trigger};
      create trigger sales_human_control after insert on channel_events
        for each row execute function magia_sales_human_control();
    `);

    const scenarios = [
      ['sales_qualifying', false], ['sales_hot', false], ['sales_human', true],
      ['sales_financing', true], ['sales_appraisal', true], ['sales_closed', true],
    ];
    for (const [stage, locked] of scenarios) {
      await db.query("insert into sales_leads (tenant_id, channel_type, chat_id, stage_key, ai_locked) values ('genesis','whatsapp',$1,$1,$2)", [stage, locked]);
    }
    const before = (await db.query('select * from sales_leads order by chat_id')).rows;
    await db.exec(`
      insert into channel_events (tenant_id, channel_type, external_conversation_id, direction, service)
      select tenant_id, channel_type, chat_id, 'outbound', 'conversation_closed' from sales_leads
    `);
    assert.deepEqual((await db.query('select * from sales_leads order by chat_id')).rows, before,
      'Encerrar atendimentos deve preservar etapa, bloqueio, revisão e data dos leads');
    assert.equal((await db.query("select count(*)::int as count from channel_events where service='conversation_closed'")).rows[0].count, scenarios.length);

    await db.exec(`
      insert into sales_leads (tenant_id, channel_type, chat_id, stage_key, ai_locked) values
        ('genesis','whatsapp','assigned','sales_qualifying',false),
        ('genesis','whatsapp','reply','sales_financing',true),
        ('genesis','whatsapp','resume','sales_human',true),
        ('genesis','telegram','assigned','sales_qualifying',false),
        ('salon','whatsapp','assigned','sales_qualifying',false);
      insert into channel_events (tenant_id, channel_type, external_conversation_id, direction, service) values
        ('genesis','whatsapp','assigned','outbound','conversation_assigned'),
        ('genesis','whatsapp','reply','outbound','manual_reply'),
        ('genesis','whatsapp','resume','outbound','resume_ai'),
        ('salon','whatsapp','assigned','outbound','conversation_assigned');
    `);
    const { rows } = await db.query(`
      select tenant_id,channel_type,chat_id,stage_key,ai_locked,revision
      from sales_leads where chat_id in ('assigned','reply','resume')
      order by tenant_id,channel_type,chat_id
    `);
    assert.deepEqual(rows.map(Object.values), [
      ['genesis', 'telegram', 'assigned', 'sales_qualifying', false, 4],
      ['genesis', 'whatsapp', 'assigned', 'sales_human', true, 5],
      ['genesis', 'whatsapp', 'reply', 'sales_financing', true, 5],
      ['genesis', 'whatsapp', 'resume', 'sales_qualifying', false, 5],
      ['salon', 'whatsapp', 'assigned', 'sales_qualifying', false, 4],
    ]);
    console.log('Encerramento preserva seis etapas comerciais. Atribuição, resposta, retomada e isolamento conferidos.');
  } finally {
    await db.close();
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

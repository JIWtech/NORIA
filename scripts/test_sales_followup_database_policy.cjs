const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('../app/node_modules/@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
const tenant = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const anchor = '33333333-3333-4333-8333-333333333333';

test('follow-up executa a migration real respeitando configuração, isolamento e controle', async t => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth;
      create function auth.role() returns text language sql as $$ select current_setting('request.jwt.claim.role',true) $$;
      set request.jwt.claim.role='service_role';
      create table tenants(id uuid primary key,status text,deleted_at timestamptz);
      create table tenant_settings(tenant_id uuid primary key,settings jsonb);
      create table sales_leads(id uuid,tenant_id uuid,channel_type text,chat_id text,session_id text,
        ai_locked boolean,interest_registered boolean,stage_key text);
      create table channel_events(id uuid primary key,tenant_id uuid,channel_type text,external_conversation_id text,
        direction text,sender_type text,handoff boolean,service text,ai_provider text,raw_payload jsonb,created_at timestamptz);
      create function magia_contact_exclusion_status(uuid,text) returns jsonb language sql as $$select '{"blocked":false}'::jsonb$$;
      insert into tenants values('${tenant}','active',null),('${other}','active',null);
      insert into tenant_settings values('${tenant}', '{"ai_enabled":true,"follow_up_enabled":true,"contact_exclusion_enabled":true,
        "conversation_capability":"sales_v1","sales_follow_up":{"enabled":true},"sales":{"hot_lead_rule":"deposit_30_and_financing_documents_v1",
        "stage_keys":{"initial":"initial","qualifying":"qualifying","warm":"warm","cold":"cold"},
        "stages":{"initial":{"allow_ai":true},"qualifying":{"allow_ai":true},"warm":{"allow_ai":true},"cold":{"allow_ai":true},"human":{"allow_ai":false}}}}');
      insert into sales_leads values('${anchor}','${tenant}','whatsapp','fixture','initial',false,false,'warm');
      insert into channel_events values('${anchor}','${tenant}','whatsapp','fixture','outbound','assistant',false,
        'sales_qualification','sales_core','{"conversation_session_id":"initial","follow_up_disposition":"awaiting_customer"}','2026-10-24T10:00:00Z');`);
    const eligible = async (who = tenant) => (await db.query(`select magia_sales_followup_eligible($1,'fixture',$2) as allowed`, [who, anchor])).rows[0].allowed;
    const previous = JSON.parse(fs.readFileSync(path.join(root, 'docs/archive/reports/noria_20261024_production_prestate.json'), 'utf8'));
    await db.exec(previous.old_followup_function.trim().replace(/;?$/, ';'));
    assert.equal(await eligible(), false, 'contraprova: versão anterior bloqueia etapa morna quando o nome da regra é 30%');
    await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/20261024143922_sales_followup_configured_stages.sql'), 'utf8'));
    await t.test('etapas morna e fria com IA permitida funcionam com a regra de 30%', async () => {
      for (const stage of ['warm', 'cold']) {
        await db.query('update sales_leads set stage_key=$1', [stage]);
        assert.equal(await eligible(), true);
      }
    });
    await t.test('nome ou percentual da regra não autoriza nem bloqueia follow-up', async () => {
      await db.exec(`update tenant_settings set settings=jsonb_set(settings,'{sales,hot_lead_rule}','"policy_from_ext_v3"');`);
      assert.equal(await eligible(), true);
    });
    await t.test('outro tenant não pode reutilizar o evento âncora', async () => assert.equal(await eligible(other), false));
    await t.test('etapa sem permissão de IA bloqueia', async () => {
      await db.exec("update sales_leads set stage_key='human';");
      assert.equal(await eligible(), false);
      await db.exec("update sales_leads set stage_key='warm';");
    });
    await t.test('recusa não é espera pelo cliente', async () => {
      await db.exec(`update channel_events set raw_payload=jsonb_set(raw_payload,'{follow_up_disposition}','"declined"');`);
      assert.equal(await eligible(), false);
      await db.exec(`update channel_events set raw_payload=jsonb_set(raw_payload,'{follow_up_disposition}','"awaiting_customer"');`);
    });
    await t.test('bloqueio humano impede envio', async () => {
      await db.exec('update sales_leads set ai_locked=true;');
      assert.equal(await eligible(), false);
      await db.exec('update sales_leads set ai_locked=false;');
    });
    await t.test('interesse já registrado impede envio', async () => {
      await db.exec('update sales_leads set interest_registered=true;');
      assert.equal(await eligible(), false);
      await db.exec('update sales_leads set interest_registered=false;');
    });
    await t.test('nova mensagem do cliente invalida a âncora antiga', async () => {
      await db.exec(`insert into channel_events values('${other}','${tenant}','whatsapp','fixture','inbound','contact',false,'geral',null,'{}','2026-10-24T10:01:00Z');`);
      assert.equal(await eligible(), false);
    });
    await t.test('usuário autenticado não executa o controle de serviço', async () => {
      await db.exec("set request.jwt.claim.role='authenticated';");
      await assert.rejects(eligible(), /Sales follow-up denied/);
    });
  } finally { await db.close(); }
});

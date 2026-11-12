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

// Proposta (NAO aplicada): retomada apos adiamento. A funcao nova so aceita ancora deferred_by_customer quando o tenant
// configurou a acao 'resume'; todas as outras travas permanecem. O arquivo traz o bloco de rollback da funcao e, comentado,
// a configuracao do tenant e o respectivo rollback; os testes executam cada bloco no PGlite.
const proposalPath = path.join(root, 'supabase/migrations_pending_review/sales_followup_resume_after_deferral_proposta.sql');
const block = (sql, name) => {
  const start = sql.indexOf(`-- >>> ${name}`), end = sql.indexOf(`-- <<< ${name}`);
  assert.ok(start >= 0 && end > start, `bloco ${name} ausente`);
  return sql.slice(sql.indexOf('\n', start) + 1, end).split('\n').map(line => line.replace(/^-- ?/, '')).join('\n');
};
test('proposta de retomada apos adiamento: so aceita adiamento com resume e mantem todas as outras travas', async t => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth;
      create function auth.role() returns text language sql as $$ select current_setting('request.jwt.claim.role',true) $$;
      set request.jwt.claim.role='service_role';
      create table tenants(id uuid primary key,slug text,status text,deleted_at timestamptz);
      create table tenant_settings(tenant_id uuid primary key,settings jsonb,updated_at timestamptz);
      create table sales_leads(id uuid,tenant_id uuid,channel_type text,chat_id text,session_id text,
        ai_locked boolean,interest_registered boolean,stage_key text);
      create table channel_events(id uuid primary key,tenant_id uuid,channel_type text,external_conversation_id text,
        direction text,sender_type text,handoff boolean,service text,ai_provider text,raw_payload jsonb,created_at timestamptz);
      create function magia_contact_exclusion_status(uuid,text) returns jsonb language sql as $$select '{"blocked":false}'::jsonb$$;
      insert into tenants values('${tenant}','wesley_automoveis','active',null),('${other}','outro','active',null);
      insert into tenant_settings values('${tenant}', '{"ai_enabled":true,"follow_up_enabled":true,"contact_exclusion_enabled":true,
        "conversation_capability":"sales_v1","sales_follow_up":{"enabled":true,"messages":{"3h":"x"}},
        "sales":{"stage_keys":{"initial":"initial","qualifying":"qualifying","warm":"warm","cold":"cold"},
        "stages":{"initial":{"allow_ai":true},"qualifying":{"allow_ai":true},"warm":{"allow_ai":true},"cold":{"allow_ai":true},"human":{"allow_ai":false}}}}',now()),
        ('${other}','{"conversation_capability":"sales_v1","sales_follow_up":{"enabled":true}}',now());
      insert into sales_leads values('${anchor}','${tenant}','whatsapp','fixture','initial',false,false,'warm');
      insert into channel_events values('${anchor}','${tenant}','whatsapp','fixture','outbound','assistant',false,
        'sales_qualification','sales_core','{"conversation_session_id":"initial","follow_up_disposition":"deferred_by_customer"}','2026-10-24T10:00:00Z');`);
    const eligible = async () => (await db.query(`select magia_sales_followup_eligible($1,'fixture',$2) as allowed`, [tenant, anchor])).rows[0].allowed;
    const disposition = value => db.query(`update channel_events set raw_payload=jsonb_set(raw_payload,'{follow_up_disposition}',to_jsonb($1::text)) where id=$2`, [value, anchor]);
    const setSettings = sql => db.exec(`update tenant_settings set settings=${sql} where tenant_id='${tenant}'`);
    const definition = async () => (await db.query(`select pg_get_functiondef('public.magia_sales_followup_eligible(uuid,text,uuid)'::regprocedure) as def`)).rows[0].def;
    const acl = async () => (await db.query(`select coalesce(string_agg(a::text,',' order by a::text),'') as acl from pg_proc p, unnest(p.proacl) a where p.oid='public.magia_sales_followup_eligible(uuid,text,uuid)'::regprocedure`)).rows[0].acl;
    const proposal = fs.readFileSync(proposalPath, 'utf8');

    await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/20261024143922_sales_followup_configured_stages.sql'), 'utf8').replace(/\r\n/g, '\n'));
    const current = await definition(), currentAcl = await acl();
    assert.equal(await eligible(), false, 'linha de base: versao atual recusa adiamento');
    await db.exec(proposal);

    await t.test('sem a configuracao a funcao nova se comporta como a atual', async () => {
      assert.equal(await eligible(), false);
      await setSettings(`jsonb_set(settings,'{sales_follow_up,disposition_actions}','{"deferred_by_customer":"keep"}')`);
      assert.equal(await eligible(), false);
      await setSettings(`jsonb_set(settings,'{sales_follow_up,disposition_actions}','{"declined":"resume"}')`);
      assert.equal(await eligible(), false, 'resume em outra disposicao nao autoriza o adiamento');
      await disposition('awaiting_customer'); assert.equal(await eligible(), true, 'silencio continua elegivel');
      await disposition('deferred_by_customer');
    });
    await t.test('com resume o adiamento e elegivel; recusa, encerramento e resolvido continuam inelegiveis', async () => {
      await setSettings(`jsonb_set(settings,'{sales_follow_up,disposition_actions}','{"deferred_by_customer":"resume"}')`);
      assert.equal(await eligible(), true);
      for (const value of ['declined', 'closed_by_customer', 'resolved', 'not_applicable']) { await disposition(value); assert.equal(await eligible(), false, value); }
      await db.exec(`update channel_events set raw_payload=raw_payload-'follow_up_disposition' where id='${anchor}'`); assert.equal(await eligible(), false, 'sem disposicao');
      await disposition('deferred_by_customer');
    });
    await t.test('demais travas valem para a retomada', async () => {
      assert.equal(await eligible(), true);
      await db.exec("update sales_leads set ai_locked=true"); assert.equal(await eligible(), false, 'humano assumiu'); await db.exec("update sales_leads set ai_locked=false");
      await db.exec("update sales_leads set stage_key='human'"); assert.equal(await eligible(), false, 'etapa sem IA'); await db.exec("update sales_leads set stage_key='warm'");
      await db.exec("update sales_leads set interest_registered=true"); assert.equal(await eligible(), false, 'lead travado'); await db.exec("update sales_leads set interest_registered=false");
      await db.exec(`update channel_events set raw_payload=jsonb_set(raw_payload,'{conversation_session_id}','"outra"') where id='${anchor}'`); assert.equal(await eligible(), false, 'sessao');
      await db.exec(`update channel_events set raw_payload=jsonb_set(raw_payload,'{conversation_session_id}','"initial"') where id='${anchor}'`);
      await setSettings(`jsonb_set(settings,'{sales_follow_up,enabled}','false')`); assert.equal(await eligible(), false, 'follow-up desligado');
      await setSettings(`jsonb_set(settings,'{sales_follow_up,enabled}','true')`);
      const later = (direction, sender, handoff, service, provider) => db.exec(`insert into channel_events values('${other}','${tenant}','whatsapp','fixture','${direction}','${sender}',${handoff},'${service}',${provider},'{}','2026-10-24T10:01:00Z')`);
      const clear = () => db.exec(`delete from channel_events where id='${other}'`);
      await later('inbound', 'contact', false, 'geral', 'null'); assert.equal(await eligible(), false, 'cliente respondeu depois'); await clear();
      await later('outbound', 'human', false, 'geral', "'human_operator'"); assert.equal(await eligible(), false, 'atendente humano respondeu'); await clear();
      await later('outbound', 'assistant', false, 'conversation_closed', "'conversation_closed'"); assert.equal(await eligible(), false, 'conversa fechada'); await clear();
      assert.equal(await eligible(), true);
    });
    await t.test('so uma retomada: depois da retomada da IA nenhuma etapa seguinte e elegivel; texto configurado continua encadeando', async () => {
      const follow = provider => db.exec(`insert into channel_events values('${other}','${tenant}','whatsapp','fixture','outbound','assistant',false,'follow_up','${provider}','{}','2026-10-24T13:00:00Z')`);
      await follow('gemini_follow_up'); assert.equal(await eligible(), false);
      await db.exec(`delete from channel_events where id='${other}'`);
      await follow('configured_follow_up'); assert.equal(await eligible(), true);
      await db.exec(`delete from channel_events where id='${other}'`);
    });
    await t.test('isolamento: outro tenant com resume nao autoriza a ancora do primeiro', async () => {
      await db.exec(`update tenant_settings set settings=jsonb_set(settings,'{sales_follow_up,disposition_actions}','{"deferred_by_customer":"resume"}') where tenant_id='${other}'`);
      await setSettings(`settings #- '{sales_follow_up,disposition_actions}'`);
      assert.equal(await eligible(), false);
    });
    await t.test('mesmos grants da original e execucao restrita ao service_role', async () => {
      assert.equal(await acl(), currentAcl);
      await db.exec("set request.jwt.claim.role='authenticated';");
      await assert.rejects(eligible(), /Sales follow-up denied/);
      await db.exec("set request.jwt.claim.role='service_role';");
    });
    await t.test('configuracao do tenant (bloco comentado): escopo por id e slug, preserva chaves, idempotente, com guarda e rollback', async () => {
      const apply = block(proposal, 'CONFIG-APPLY'), revert = block(proposal, 'CONFIG-ROLLBACK');
      const settingsOf = async id => (await db.query('select settings from tenant_settings where tenant_id=$1', [id])).rows[0].settings;
      await setSettings(`jsonb_set(settings,'{sales_follow_up,disposition_actions}','{"declined":"cancel"}')`);
      const before = await settingsOf(tenant), otherBefore = await settingsOf(other);
      await db.exec(apply);
      const after = await settingsOf(tenant);
      assert.deepEqual(after.sales_follow_up.disposition_actions, { declined: 'cancel', deferred_by_customer: 'resume' });
      assert.deepEqual({ ...after, sales_follow_up: { ...after.sales_follow_up, disposition_actions: before.sales_follow_up.disposition_actions } }, before, 'nenhuma outra chave muda');
      assert.deepEqual(await settingsOf(other), otherBefore, 'outro tenant intacto');
      assert.equal(await eligible(), true);
      await db.exec(apply);
      assert.deepEqual(await settingsOf(tenant), after, 'reaplicar e idempotente');
      await db.exec(revert);
      assert.deepEqual(await settingsOf(tenant), before, 'rollback restaura a configuracao anterior');
      await setSettings(`jsonb_set(settings,'{sales_follow_up,disposition_actions}','{"deferred_by_customer":"keep"}')`);
      await assert.rejects(db.exec(apply), /nao sobrescrever/, 'nao sobrescreve uma decisao ja configurada'); await db.exec('rollback');
      assert.equal((await settingsOf(tenant)).sales_follow_up.disposition_actions.deferred_by_customer, 'keep');
      await db.exec(revert);
      assert.equal((await settingsOf(tenant)).sales_follow_up.disposition_actions.deferred_by_customer, 'keep', 'rollback so remove o que a proposta gravou');
      await setSettings(`settings #- '{sales_follow_up,disposition_actions}'`);
    });
    await t.test('rollback da funcao restaura exatamente a definicao atual', async () => {
      assert.notEqual(await definition(), current);
      await db.exec(block(proposal, 'FUNCTION-ROLLBACK'));
      assert.equal(await definition(), current);
      assert.equal(await acl(), currentAcl);
      await setSettings(`jsonb_set(settings,'{sales_follow_up,disposition_actions}','{"deferred_by_customer":"resume"}')`);
      assert.equal(await eligible(), false);
    });
  } finally { await db.close(); }
});

test('proposta de retomada: declara transacao, notify e grants; fora dos blocos comentados so a funcao e aplicada', () => {
  const sql = fs.readFileSync(proposalPath, 'utf8');
  assert.match(sql, /^begin;$/m); assert.match(sql, /^commit;$/m); assert.match(sql, /notify pgrst,\s*'reload schema'/);
  assert.match(sql, /revoke all on function public\.magia_sales_followup_eligible\(uuid,text,uuid\) from public,anon,authenticated;/);
  assert.match(sql, /grant execute on function public\.magia_sales_followup_eligible\(uuid,text,uuid\) to service_role;/);
  const live = sql.split('\n').filter(line => !line.startsWith('--')).join('\n');
  assert.doesNotMatch(live, /update\s+public\.tenant_settings|jsonb_set/i);
});

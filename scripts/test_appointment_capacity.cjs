const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(path.join(process.env.MAGIA_TEST_MODULES || path.join(__dirname, '../app/node_modules'), '@electric-sql/pglite'));
const tenant = '11111111-1111-1111-1111-111111111111';
const other = '22222222-2222-2222-2222-222222222222';
test('capacity: slots, independent units/resources, release, idempotence, legacy and permissions', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth;
      create function auth.role() returns text language sql as $$ select coalesce(current_setting('request.jwt.claim.role',true),'service_role') $$;
      create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
      create table tenants(id uuid primary key,status text,slug text,deleted_at timestamptz);
      create table ai_prompt_versions(tenant_id uuid,active boolean);
      create table channel_events(id uuid primary key default gen_random_uuid(),tenant_slug text,channel_type text,
        external_conversation_id text,service text,ai_provider text,created_at timestamptz default now());
      create table tenant_settings(tenant_id uuid primary key,settings jsonb,updated_at timestamptz default now());
      create table tenant_members(tenant_id uuid,user_id uuid,status text,role text);
      create table tenant_service_catalog(id uuid primary key default gen_random_uuid(),tenant_id uuid,external_id text,name text,active boolean,
        category text,description text,notes text,price numeric,estimated_hours numeric,external_source text,billing_unit text,metadata jsonb,updated_at timestamptz);
      create table appointments(id uuid primary key default gen_random_uuid(),tenant_id uuid,title text,starts_at timestamptz,
        ends_at timestamptz,status text,contact_name text,channel_type text,external_conversation_id text,created_by uuid,metadata jsonb,notes text);
      insert into tenants(id,status,slug) values('${tenant}','active','clinica_nubia_oficial'),('${other}','active','other');
      insert into tenant_service_catalog(tenant_id,external_id,name,active,price) values('${tenant}','bronze_classico','Classico',true,99.99),
        ('${tenant}','bronze_comfort','Comfort',true,179.99),('${tenant}','bronze_premium','Premium',true,149.99),
        ('${tenant}','bronze_no_sol','Sol',true,99.99),('${tenant}','banho_lua_classico','Banho antigo',true,19.99);`);
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../clients/clinica_nubia_oficial/scheduling.json')));
    config.units.rio={...structuredClone(config.units.angra),name:'Rio',aliases:['rio']};
    await db.query('insert into tenant_settings(tenant_id,settings) values($1,$2)', [tenant, {
      appointment_scheduling: config,grounding_mode:'canonical_v2',whatsapp_processing_mode:'conversation_core_v1',
      payment:{deposit_percentage:50},ai_model:'gemini-2.5-flash' }]);
    const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/018_appointment_capacity.sql'), 'utf8');
    await db.exec(sql); await db.exec(sql);
    const reserve = async (req, unit = 'angra', service = 'bronze_classico', time = '10:00', date = '2030-01-01') =>
      (await db.query('select magia_reserve_appointment($1,$2,$3,$4,$5,$6,$7,$8) a', [tenant, unit, service, date, time, 'Cliente', 'chat-' + req, req])).rows[0].a;
    const available = async (unit = 'angra', service = 'bronze_classico', date = '2030-01-01') =>
      (await db.query('select magia_appointment_availability($1,$2,$3,$4) a', [tenant, unit, service, date])).rows[0].a.available_starts;
    assert.deepEqual(await available(), ['10:00','11:30','13:00']);
    const first = await reserve('1');
    assert.equal(first.status, 'pending_payment');
    assert.equal((Date.parse(first.ends_at)-Date.parse(first.starts_at))/60000,90);
    assert.equal((await reserve('1')).id,first.id);
    await assert.rejects(reserve('1','rio'), /RESERVATION_REQUEST_REUSED/);
    for (const id of ['2','3','4']) await reserve(id);
    await assert.rejects(reserve('5'), /SLOT_UNAVAILABLE/);
    assert.deepEqual(await available(), ['11:30','13:00']);
    await reserve('rio','rio');
    await reserve('comfort','angra','bronze_comfort');
    await assert.rejects(reserve('comfort2','angra','bronze_comfort'), /SLOT_UNAVAILABLE/);
    await reserve('premium','angra','bronze_premium');
    await assert.rejects(reserve('wrong','angra','bronze_classico','09:00'), /INVALID_SESSION_SLOT/);
    await assert.rejects(reserve('wrongservice','angra','banho_lua_comfort'), /SCHEDULE_NOT_CONFIGURED/);
    await assert.rejects(reserve('wrongunit','outro'), /SCHEDULE_NOT_CONFIGURED/);
    await db.query("update appointments set status='payment_reported' where id=$1",[first.id]);
    await db.query("update appointments set status='confirmed' where id=$1",[first.id]);
    await assert.rejects(reserve('stillfull'), /SLOT_UNAVAILABLE/);
    await db.query("update appointments set status='cancelled' where id=$1",[first.id]);
    const replacement = await reserve('replacement');
    await db.query('delete from appointments where id=$1',[replacement.id]);
    assert.ok((await available()).includes('10:00'));
    // Manual REST inserts use the same trigger; they cannot bypass the grid/capacity.
    await assert.rejects(db.query("insert into appointments(tenant_id,starts_at,status,metadata) values($1,'2030-01-02 10:00Z','scheduled','{}')",[tenant]), /SCHEDULE_NOT_CONFIGURED/);
    await db.query("insert into appointments(tenant_id,starts_at,status,metadata) values($1,'2030-01-02 10:00Z','scheduled','{}')",[other]);
    // Simulate a pre-migration appointment without location. Neither unit may silently ignore it.
    await db.exec('alter table appointments disable trigger appointment_capacity_guard');
    await db.query("insert into appointments(tenant_id,starts_at,ends_at,status,metadata) values($1,'2030-01-01 14:30Z','2030-01-01 16:00Z','payment_reported','{}')",[tenant]);
    await db.exec('alter table appointments enable trigger appointment_capacity_guard');
    assert.ok(!(await available()).includes('11:30'));
    assert.ok(!(await available('rio')).includes('11:30'));
    await assert.rejects(reserve('legacy','rio','bronze_classico','11:30'), /LEGACY_BOOKING_REQUIRES_REVIEW/);
    // Sunday and Monday are different schedules; capacity values never leave availability RPC.
    assert.deepEqual(await available('rio','bronze_classico','2030-01-06'), ['08:00','09:30']);
    assert.deepEqual(await available('rio','bronze_classico','2030-01-07'), ['16:00','17:30']);
    const countBefore = (await db.query('select count(*)::int n from appointments')).rows[0].n;
    const clientSql = fs.readFileSync(path.join(__dirname, '../clients/clinica_nubia_oficial/05_unidades_agenda_pagamento.sql'),'utf8');
    await db.exec(clientSql); await db.exec(clientSql);
    assert.equal((await db.query('select count(*)::int n from appointments')).rows[0].n,countBefore);
    const newSettings=(await db.query('select settings from tenant_settings where tenant_id=$1',[tenant])).rows[0].settings;
    assert.equal(newSettings.payment.pix_holder,'Silvana Marques');
    assert.equal(newSettings.payment.deposit_percentage,50);
    assert.equal(newSettings.ai_model,'gemini-2.5-flash');
    const updatedCatalog=(await db.query('select * from tenant_service_catalog where tenant_id=$1',[tenant])).rows;
    assert.equal(updatedCatalog.find(s=>s.external_id==='bronze_classico').price,'99.99');
    assert.equal(updatedCatalog.find(s=>s.external_id==='banho_lua_classico').active,false);
    assert.equal(updatedCatalog.filter(s=>s.external_id==='banho_lua').length,1);
    assert.equal(updatedCatalog.find(s=>s.external_id==='banho_lua').price,'60');
    assert.equal(updatedCatalog.find(s=>s.external_id==='bronze_jato_domicilio').price,'200');
    const sessionSql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/019_appointment_attendance_sessions.sql'),'utf8');
    await db.exec(sessionSql);await db.exec(sessionSql);
    const reserveSession=async(req,date='2030-01-03',session='initial',chat='repeat-customer')=>
      (await db.query('select magia_reserve_session_appointment($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) a',
        [tenant,'angra','bronze_classico',date,'10:00','Cliente',chat,req,'whatsapp',null,session])).rows[0].a;
    const firstSession=await reserveSession('session-1');
    assert.equal((await reserveSession('session-1')).id,firstSession.id);
    assert.equal((await reserveSession('duplicate')).id,firstSession.id);
    const secondSession=await reserveSession('session-2','2030-01-05');
    assert.notEqual(secondSession.id,firstSession.id);
    assert.equal(secondSession.metadata.conversation_session_id,'initial');
    const boundary='33333333-3333-3333-3333-333333333333';
    await db.query("insert into channel_events(id,tenant_slug,channel_type,external_conversation_id,service) values($1,'clinica_nubia_oficial','whatsapp','repeat-customer','conversation_closed')",[boundary]);
    await assert.rejects(reserveSession('stale','2030-01-08'),/STALE_ATTENDANCE/);
    await assert.rejects(reserveSession('duplicate-after-close','2030-01-03',boundary),/EXISTING_BOOKING_REQUIRES_REVIEW/);
    const fresh=await reserveSession('session-3','2030-01-08',boundary);
    assert.equal(fresh.metadata.conversation_session_id,boundary);
    assert.equal((await db.query('select status from appointments where id=$1',[firstSession.id])).rows[0].status,'pending_payment');
    for(const n of [1,2,3]) await reserveSession('capacity-'+n,'2030-01-08','initial','another-'+n);
    await assert.rejects(reserveSession('full','2030-01-08','initial','another-4'),/SLOT_UNAVAILABLE/);
    const activation=fs.readFileSync(path.join(__dirname,'../clients/clinica_nubia_oficial/06_sessoes_independentes.sql'),'utf8');
    await db.exec(activation);await db.exec(activation);
    const activated=(await db.query('select settings from tenant_settings where tenant_id=$1',[tenant])).rows[0].settings;
    assert.equal(activated.attendance_lifecycle,'session_v2');
    assert.equal(activated.payment.pix_holder,'Silvana Marques');
    assert.equal(activated.ai_model,newSettings.ai_model);
    const singleUnitSql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/022_nubia_single_angra_scheduling.sql'),'utf8');
    await db.query('insert into ai_prompt_versions values($1,true),($2,true)',[tenant,other]);
    await db.exec(singleUnitSql);await db.exec(singleUnitSql);
    assert.deepEqual((await db.query('select active from ai_prompt_versions where tenant_id=$1',[tenant])).rows,[{active:false}]);
    assert.deepEqual((await db.query('select active from ai_prompt_versions where tenant_id=$1',[other])).rows,[{active:true}]);
    const finalSettings=(await db.query('select settings from tenant_settings where tenant_id=$1',[tenant])).rows[0].settings;
    assert.deepEqual(Object.keys(finalSettings.appointment_scheduling.units),['angra']);
    assert.equal(finalSettings.attendance_lifecycle,'session_v2');
    assert.match(finalSettings.system_prompt,/SESSOES INDEPENDENTES/);
    const liveInstruction='O atendimento presencial e exclusivamente em Angra dos Reis. Se a cliente pedir outra cidade, informe com gentileza que atendemos somente em Angra dos Reis. Use state.unit_id "angra" e unit_evidence apenas quando a cliente mencionar Angra, Nova Angra ou a unidade. Nunca suponha unidade pelo DDD, perfil ou endereco de outra pessoa.';
    const liveFlow='Colete e confirme, usando somente dados informados pela cliente:\n1. unidade;\n2. servico;\n3. data;\n4. horario;\n5. nome completo.\nQuando faltar algum desses cinco dados estiver vazio\nUse action=create_appointment somente quando unidade, servico, data, horario e nome completo estiverem preenchidos e sustentados por mensagens da cliente.';
    await db.query("update tenant_settings set settings=jsonb_set(settings,'{system_prompt}',to_jsonb($2::text)) where tenant_id=$1",[tenant,liveInstruction+'\nSESSOES INDEPENDENTES\n'+liveFlow]);
    await db.exec(singleUnitSql);await db.exec(singleUnitSql);
    const repaired=(await db.query("select settings->>'system_prompt' prompt from tenant_settings where tenant_id=$1",[tenant])).rows[0].prompt;
    assert.match(repaired,/SESSOES INDEPENDENTES/);assert.match(repaired,/unit_evidence vazio/);
    assert.doesNotMatch(repaired,/1\. unidade|cinco dados|unit_evidence apenas/);
    const audioSql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/024_nubia_whatsapp_audio.sql'),'utf8');
    await db.exec(audioSql);await db.exec(audioSql);
    const audioSettings=(await db.query('select settings from tenant_settings where tenant_id=$1',[tenant])).rows[0].settings;
    assert.equal(audioSettings.whatsapp_audio_enabled,true);
    assert.equal(audioSettings.ai_model,finalSettings.ai_model);
    assert.deepEqual(audioSettings.payment,finalSettings.payment);
    await db.exec("set request.jwt.claim.role='authenticated'; set role authenticated");
    await assert.rejects(reserveSession('unauthorized'),/Scheduling access denied/);
    await assert.rejects(available(), /Scheduling access denied/);
    await assert.rejects(db.query('select * from appointment_capacity_slots'), /permission denied/);
  } finally { await db.close(); }
});

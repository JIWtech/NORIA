const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(path.join(process.env.MAGIA_TEST_MODULES || path.join(__dirname, '../app/node_modules'), '@electric-sql/pglite'));
const patch = fs.readFileSync(path.join(__dirname, '../clients/clinica_nubia_oficial/07_nome_nb_bronze.sql'), 'utf8');

test('NB Bronze patch preserves custom settings, isolates tenant and is repeatable', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table tenants(id uuid primary key,slug text,name text,status text,deleted_at timestamptz);
      create table tenant_settings(tenant_id uuid primary key,settings jsonb,updated_at timestamptz);
      insert into tenants values ('11111111-1111-1111-1111-111111111111','clinica_nubia_oficial','Old','active',null),
        ('22222222-2222-2222-2222-222222222222','other','Other','active',null);`);
    const settings = {grounding_mode:'canonical_v2',whatsapp_processing_mode:'conversation_core_v1',
      system_prompt:'Voce atende a Cl\u00ednica da N\u00fabia. Clinica Nubia. Regra personalizada: preservar.',
      prompt_revision:'custom-v9',business_facts:{locations:[{id:'angra',name:'Nova Angra'}]},
      ai_enabled:false,payment:{enabled:true},ai_model:'custom',appointment_scheduling:{enabled:true}};
    await db.query('insert into tenant_settings values ($1,$2,now()),($3,$4,now())', [
      '11111111-1111-1111-1111-111111111111',settings,'22222222-2222-2222-2222-222222222222',{unchanged:true}]);
    await db.exec(patch);
    const first = (await db.query('select settings from tenant_settings where tenant_id=$1', ['11111111-1111-1111-1111-111111111111'])).rows[0].settings;
    assert.match(first.system_prompt,/NB Bronze\. NB Bronze\. Regra personalizada: preservar\./);
    assert.equal(first.prompt_revision,'custom-v9-nb-bronze-v1');
    assert.deepEqual({...first,system_prompt:settings.system_prompt,prompt_revision:settings.prompt_revision,
      business_facts:settings.business_facts},settings);
    assert.deepEqual(first.business_facts,{...settings.business_facts,name:'NB Bronze'});
    await db.exec(patch);
    assert.deepEqual((await db.query('select settings from tenant_settings where tenant_id=$1', ['11111111-1111-1111-1111-111111111111'])).rows[0].settings,first);
    assert.deepEqual((await db.query("select t.name,s.settings from tenants t join tenant_settings s on s.tenant_id=t.id where t.slug='other'")).rows[0],{name:'Other',settings:{unchanged:true}});
    assert.equal((await db.query("select name from tenants where slug='clinica_nubia_oficial'")).rows[0].name,'NB Bronze');
    await db.exec("update tenant_settings set settings=settings-'grounding_mode' where tenant_id='11111111-1111-1111-1111-111111111111'");
    await assert.rejects(db.exec(patch),/Configuracao canonica/);
    await db.exec('rollback');
  } finally { await db.close(); }
});

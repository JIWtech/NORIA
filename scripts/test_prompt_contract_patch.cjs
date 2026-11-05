const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PGlite } = require(path.join(process.env.MAGIA_TEST_MODULES || path.join(__dirname, '../app/node_modules'), '@electric-sql/pglite'));
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, 'supabase/migrations_pending_review/prompt_contract_alignment_20261023' + name + '.sql'), 'utf8');
const apply = read(''), rollback = read('_rollback');
const payload = JSON.parse(apply.match(/\$noria_prompt_payload\$\s*([\s\S]*?)\s*\$noria_prompt_payload\$/)[1]);
const md5 = value => crypto.createHash('md5').update(value).digest('hex');
const baselines = {wesley_automoveis:'1213c4d84e69e0ce4967ecbe3b6a56f5',clinica_nubia_oficial:'041110318c4d8a249380e7f015d0a349'};
const otherId = '00000000-0000-0000-0000-000000000001';
async function fixture() {
  const db = new PGlite();
  await db.exec('create table tenants(id uuid primary key,slug text); create table tenant_settings(tenant_id uuid primary key,settings jsonb,updated_at timestamptz)');
  for (const item of payload) {
    await db.query('insert into tenants values ($1,$2)', [item.id,item.slug]);
    await db.query('insert into tenant_settings values ($1,$2,now())', [item.id,{
      system_prompt:item.expected_prompt,prompt_revision:item.expected_revision,
      whatsapp_processing_mode:'conversation_core_v1',grounding_mode:'canonical_v2',
      custom:{keep:true},payment:{deposit_percentage:37},ai_model:'unchanged',
    }]);
  }
  await db.query('insert into tenants values ($1,$2)', [otherId,'other']);
  await db.query('insert into tenant_settings values ($1,$2,now())', [otherId,{isolated:true}]);
  return db;
}
async function snapshot(db) { return (await db.query('select tenant_id,settings from tenant_settings order by tenant_id')).rows; }

test('patch parte dos prompts verificados e entrega exatamente os rascunhos revisáveis', () => {
  for (const item of payload) {
    assert.equal(md5(item.expected_prompt),baselines[item.slug]);
    const file = item.slug === 'wesley_automoveis' ? 'system_prompt_v14_25_contract_alignment.md' : 'system_prompt_contract_alignment_v5.txt';
    assert.equal(item.target_prompt,fs.readFileSync(path.join(root,'clients',item.slug,'prompts',file),'utf8'));
  }
});

test('aplicação, repetição e rollback preservam políticas, preços e outros tenants', async () => {
  const db = await fixture();
  try {
    const before = await snapshot(db);
    await db.exec(apply);
    const first = await snapshot(db);
    for (const item of payload) {
      const original = before.find(row=>row.tenant_id===item.id).settings;
      assert.deepEqual(first.find(row=>row.tenant_id===item.id).settings,{...original,system_prompt:item.target_prompt,prompt_revision:item.target_revision});
    }
    assert.deepEqual(first.find(row=>row.tenant_id===otherId),before.find(row=>row.tenant_id===otherId));
    await db.exec(apply);
    assert.deepEqual(await snapshot(db),first);
    await db.exec(rollback);
    assert.deepEqual(await snapshot(db),before);
    await db.exec(rollback);
    assert.deepEqual(await snapshot(db),before);
  } finally { await db.close(); }
});

test('mudança concorrente no segundo tenant aborta também a alteração do primeiro', async () => {
  const db = await fixture();
  try {
    await db.query("update tenant_settings set settings=jsonb_set(settings,'{system_prompt}',to_jsonb($1::text)) where tenant_id=$2", [payload[1].expected_prompt+'\nMudança posterior',payload[1].id]);
    const before = await snapshot(db);
    await assert.rejects(db.exec(apply),/Prompt mudou/);
    await db.exec('rollback');
    assert.deepEqual(await snapshot(db),before);
  } finally { await db.close(); }
});

test('rota divergente ou identidade incorreta impedem aplicação', async () => {
  const db = await fixture();
  try {
    await db.query("update tenant_settings set settings=settings-'grounding_mode' where tenant_id=$1",[payload[0].id]);
    await assert.rejects(db.exec(apply),/Rota canonica divergente/);
    await db.exec('rollback');
    await db.query("update tenants set slug='wrong' where id=$1",[payload[0].id]);
    await assert.rejects(db.exec(apply),/no rows/);
    await db.exec('rollback');
  } finally { await db.close(); }
});

test('rollback recusa apagar uma edição posterior à aplicação', async () => {
  const db = await fixture();
  try {
    await db.exec(apply);
    await db.query("update tenant_settings set settings=jsonb_set(settings,'{system_prompt}',to_jsonb($1::text)) where tenant_id=$2", [payload[0].target_prompt+'\nNova edição',payload[0].id]);
    const before = await snapshot(db);
    await assert.rejects(db.exec(rollback),/Prompt mudou/);
    await db.exec('rollback');
    assert.deepEqual(await snapshot(db),before);
  } finally { await db.close(); }
});

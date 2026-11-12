'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(path.join(process.env.MAGIA_TEST_MODULES || path.join(__dirname, '../app/node_modules'), '@electric-sql/pglite'));
const dir = path.join(__dirname, '../clients/ic_saloon');
const read = name => fs.readFileSync(path.join(dir, name), 'utf8');
const v5 = read('11_proposta_prompt_v5_persona.sql').split('$prompt$')[1];
const proposal = read('12_proposta_prompt_v6_integrante_nova.sql');
const rollback = read('12_proposta_prompt_v6_integrante_nova_rollback.sql');
const salon = '76aff8a0-0466-42b9-a80d-db186ff3d8bd';
const other = '11111111-1111-4111-8111-111111111111';
const initial = { system_prompt: v5, prompt_revision: 'ic_salon_recepcao_v5_persona_equipe', other: { preserved: true } };
async function setup(prompt = initial) {
  const db = new PGlite();
  await db.exec(`create table tenants(id uuid primary key, slug text); create table tenant_settings(tenant_id uuid primary key, settings jsonb, updated_at timestamptz);
    insert into tenants values ('${salon}', 'ic_salon'), ('${other}', 'outro');`);
  await db.query('insert into tenant_settings values ($1, $2, now()), ($3, $2, now())', [salon, JSON.stringify(prompt), other]);
  return db;
}
async function settings(db, id = salon) { return (await db.query('select settings from tenant_settings where tenant_id = $1', [id])).rows[0].settings; }
test('v5 para v6 preserva dados, isolamento e rollback exato', async () => {
  const db = await setup();
  try {
    await db.exec(proposal);
    const changed = await settings(db);
    assert.equal(changed.prompt_revision, 'ic_salon_recepcao_v6_integrante_nova');
    assert.match(changed.system_prompt, /não se apresente espontaneamente como assistente virtual/i);
    assert.match(changed.system_prompt, /se perguntarem se você é pessoa ou robô, responda com transparência/);
    assert.deepEqual(changed.other, initial.other);
    assert.deepEqual(await settings(db, other), initial);
    await db.exec(proposal);
    assert.deepEqual(await settings(db), changed);
    await db.exec(rollback);
    assert.deepEqual(await settings(db), initial);
    await db.exec(rollback);
    assert.deepEqual(await settings(db), initial);
  } finally { await db.close(); }
});
test('revisão ou trecho divergente impede atualização', async () => {
  for (const value of [{ ...initial, prompt_revision: 'outra' }, { ...initial, system_prompt: 'texto alterado' }]) {
    const db = await setup(value);
    try { await db.exec(proposal); assert.deepEqual(await settings(db), value); } finally { await db.close(); }
  }
});

// Prompt v13 do I&C Salon: o apply só age sobre a v12 exata, guarda a cópia literal e o rollback a restaura.
// Também confere que o texto novo não traz sintaxe de tag (o protocolo é do motor) e não perdeu fatos do salão.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(path.join(process.env.MAGIA_TEST_MODULES || path.join(__dirname, '../app/node_modules'), '@electric-sql/pglite'));

const dir = path.join(__dirname, '../clients/ic_saloon');
const apply = fs.readFileSync(path.join(dir, '20_proposta_prompt_v13_catalogo_unhas.sql'), 'utf8');
const rollback = fs.readFileSync(path.join(dir, '20_proposta_prompt_v13_catalogo_unhas_rollback.sql'), 'utf8');
const TENANT = '76aff8a0-0466-42b9-a80d-db186ff3d8bd';
const V12 = 'prompt v12 literal — Unhas: pergunte se é só mão, só pé ou pé e mão.';

async function db(revision = 'ic_salon_recepcao_v12_servicos_curtos_cancelamento') {
  const pg = new PGlite();
  await pg.exec(`create table public.tenants (id uuid primary key, slug text);
    create table public.tenant_settings (tenant_id uuid primary key, settings jsonb, updated_at timestamptz);
    insert into public.tenants values ('${TENANT}', 'ic_salon');`);
  await pg.query('insert into public.tenant_settings values ($1, $2, now())',
    [TENANT, JSON.stringify({ system_prompt: V12, prompt_revision: revision, ai_enabled: true })]);
  return pg;
}
const settings = async pg => (await pg.query('select settings from public.tenant_settings')).rows[0].settings;

test('apply sobre a v12 troca o prompt, guarda a cópia e preserva os outros campos; rollback restaura a v12', async () => {
  const pg = await db();
  await pg.exec(apply);
  const after = await settings(pg);
  assert.equal(after.prompt_revision, 'ic_salon_recepcao_v13_alinhado_motor');
  assert.equal(after.system_prompt_v12_backup, V12);
  assert.equal(after.ai_enabled, true);
  assert.doesNotMatch(after.system_prompt, /só mão, só pé/);
  assert.doesNotMatch(after.system_prompt, /\[ACAO:|CATALOGO_COMPLETO/, 'sintaxe de tag fica só no motor');
  for (const fact of ['Av. das Acácias, 207', '45 dias', 'César, Ítalo, Rose e Elisa', 'até 10x', 'três medidas', '50% via Pix', '15 minutos']) {
    assert.ok(after.system_prompt.includes(fact), fact);
  }
  await pg.exec(rollback);
  const back = await settings(pg);
  assert.equal(back.system_prompt, V12);
  assert.equal(back.prompt_revision, 'ic_salon_recepcao_v12_servicos_curtos_cancelamento');
  assert.equal(back.system_prompt_v12_backup, undefined);
  assert.equal(back.ai_enabled, true);
});

test('apply não age sobre outra revisão', async () => {
  const pg = await db('ic_salon_recepcao_v11_interlocutor_destinatario');
  await pg.exec(apply);
  const after = await settings(pg);
  assert.equal(after.system_prompt, V12);
  assert.equal(after.prompt_revision, 'ic_salon_recepcao_v11_interlocutor_destinatario');
});

// Prompt v15 do I&C Salon: a abertura da lista não pede que a pessoa solicite a lista; rollback restaura o v14.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(path.join(process.env.MAGIA_TEST_MODULES || path.join(__dirname, '../app/node_modules'), '@electric-sql/pglite'));

const dir = path.join(__dirname, '../clients/ic_saloon');
const sql = name => fs.readFileSync(path.join(dir, name), 'utf8');
const V13 = sql('20_proposta_prompt_v13_catalogo_unhas.sql').split('$prompt$')[1];
const TENANT = '76aff8a0-0466-42b9-a80d-db186ff3d8bd';

test('v15 troca a abertura da lista sobre o v14 real e o rollback restaura o v14', async () => {
  const pg = new PGlite();
  await pg.exec(`create table public.tenants (id uuid primary key, slug text);
    create table public.tenant_settings (tenant_id uuid primary key, settings jsonb, updated_at timestamptz);
    create table public.tenant_service_catalog (tenant_id uuid, external_id text, notes text, searchable_text text generated always as (lower(notes)) stored, metadata jsonb, updated_at timestamptz);
    insert into public.tenants values ('${TENANT}', 'ic_salon');`);
  await pg.query('insert into public.tenant_settings values ($1, $2, now())', [TENANT, JSON.stringify({ system_prompt: V13, prompt_revision: 'ic_salon_recepcao_v13_alinhado_motor' })]);
  await pg.exec(sql('21_proposta_prompt_v14_primeira_mensagem.sql'));
  const v14 = (await pg.query('select settings from public.tenant_settings')).rows[0].settings.system_prompt;
  await pg.exec(sql('23_proposta_prompt_v15_abertura_lista.sql'));
  const after = (await pg.query('select settings from public.tenant_settings')).rows[0].settings;
  assert.equal(after.prompt_revision, 'ic_salon_recepcao_v15_abertura_lista');
  assert.doesNotMatch(after.system_prompt, /peça a lista oficial/);
  assert.match(after.system_prompt, /Nunca diga para a pessoa pedir a lista/);
  assert.equal(after.system_prompt_v14_backup, v14);
  await pg.exec(sql('23_proposta_prompt_v15_abertura_lista_rollback.sql'));
  const back = (await pg.query('select settings from public.tenant_settings')).rows[0].settings;
  assert.equal(back.system_prompt, v14);
  assert.equal(back.prompt_revision, 'ic_salon_recepcao_v14_primeira_mensagem');
});

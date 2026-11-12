'use strict';
// Prompt v7 do I&C Salon (clients/ic_saloon/13_proposta_prompt_v7_publico_misto.sql) e rollback, em PGlite.
// O v6 de produção é reconstruído a partir do v5 versionado mais a frase que o Codex acrescentou; os md5 abaixo foram lidos
// do NORIA-prod em 12/11/2026 (somente leitura).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PGlite } = require(path.join(process.env.MAGIA_TEST_MODULES || path.join(__dirname, '../app/node_modules'), '@electric-sql/pglite'));

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const PROPOSAL = read('clients/ic_saloon/13_proposta_prompt_v7_publico_misto.sql');
const ROLLBACK = read('clients/ic_saloon/13_proposta_prompt_v7_publico_misto_rollback.sql');
const SALON = '76aff8a0-0466-42b9-a80d-db186ff3d8bd';
const OTHER = '11111111-1111-4111-8111-111111111111';
const PROD = { prompt: '142c7f4cd7ab6978a2a70278a0912afe', tone: 'bf8f249dc750978e517f8a97f5af3626' };
const md5 = text => crypto.createHash('md5').update(text).digest('hex');

function v6Prompt() {
  const v5 = read('clients/ic_saloon/11_proposta_prompt_v5_persona.sql').replace(/\r\n/g, '\n');
  return v5.slice(v5.indexOf('$prompt$') + 8, v5.lastIndexOf('$prompt$')).replace(
    'pergunte com quem está falando e como pode ajudar. Escreva com as suas palavras, sem frase decorada.',
    'pergunte com quem está falando e como pode ajudar. Não se apresente espontaneamente como assistente virtual; se perguntarem se você é pessoa ou robô, responda com transparência que é a assistente virtual da equipe. Escreva com as suas palavras, sem frase decorada.');
}
const V6_TONE = 'Acolhedora, carinhosa e animada, no feminino, como a integrante mais nova da equipe do salão; próxima sem exagero, sem gírias; no máximo um emoji por mensagem.';

async function database() {
  const db = new PGlite();
  await db.exec(`create table public.tenants(id uuid primary key, slug text);
    create table public.tenant_settings(tenant_id uuid primary key, settings jsonb, updated_at timestamptz);
    insert into public.tenants values ('${SALON}', 'ic_salon'), ('${OTHER}', 'outro');`);
  const settings = { system_prompt: v6Prompt(), tone: V6_TONE, prompt_revision: 'ic_salon_recepcao_v6_integrante_nova', business_hours: { schedule: {} } };
  await db.query('insert into public.tenant_settings values ($1, $2, now()), ($3, $2, now())', [SALON, JSON.stringify(settings), OTHER]);
  return db;
}
const state = async (db, id = SALON) => (await db.query(`select settings->>'system_prompt' prompt, settings->>'tone' tone,
  settings->>'prompt_revision' revision, settings->'business_hours' bh from public.tenant_settings where tenant_id = $1`, [id])).rows[0];

test('o v6 reconstruído é o de produção', () => {
  assert.equal(md5(v6Prompt()), PROD.prompt);
  assert.equal(md5(V6_TONE), PROD.tone);
});

test('v7: atendente no feminino, cliente de qualquer gênero, sem oferecer horário como livre; rollback exato', async () => {
  const db = await database();
  await db.exec(PROPOSAL);
  const v7 = await state(db);
  assert.equal(v7.revision, 'ic_salon_recepcao_v7_publico_misto');
  assert.match(v7.prompt, /Você fala sempre no feminino\. O salão atende homens e mulheres/);
  assert.match(v7.prompt, /sem “bem-vinda” nem “bem-vindo”/);
  assert.match(v7.prompt, /não sugira horários como se estivessem livres/);
  assert.match(v7.prompt, /cuidar de quem chega/);
  assert.match(v7.tone, /clientes de qualquer gênero/);
  assert.deepEqual(v7.bh, { schedule: {} }, 'chaves não citadas ficam intactas');
  assert.equal((await state(db, OTHER)).revision, 'ic_salon_recepcao_v6_integrante_nova', 'outro tenant não é tocado');
  await db.exec(PROPOSAL);
  assert.equal((await state(db)).prompt, v7.prompt, 'não reaplica sobre o v7');
  await db.exec(ROLLBACK);
  const back = await state(db);
  assert.equal(md5(back.prompt), PROD.prompt);
  assert.equal(md5(back.tone), PROD.tone);
  assert.equal(back.revision, 'ic_salon_recepcao_v6_integrante_nova');
});

test('sem os trechos exatos do v6, a proposta não altera nada', async () => {
  const db = await database();
  await db.query(`update public.tenant_settings set settings = jsonb_set(settings, '{system_prompt}', to_jsonb('outro texto'::text)) where tenant_id = $1`, [SALON]);
  await db.exec(PROPOSAL);
  assert.equal((await state(db)).revision, 'ic_salon_recepcao_v6_integrante_nova');
});

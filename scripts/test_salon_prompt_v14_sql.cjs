// Prompt v14 e observações do catálogo do I&C Salon: aplica sobre o texto real do v13, cada troca acontece,
// e o rollback restaura prompt e observações literalmente.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(path.join(process.env.MAGIA_TEST_MODULES || path.join(__dirname, '../app/node_modules'), '@electric-sql/pglite'));

const dir = path.join(__dirname, '../clients/ic_saloon');
const apply = fs.readFileSync(path.join(dir, '21_proposta_prompt_v14_primeira_mensagem.sql'), 'utf8');
const rollback = fs.readFileSync(path.join(dir, '21_proposta_prompt_v14_primeira_mensagem_rollback.sql'), 'utf8');
const V13 = fs.readFileSync(path.join(dir, '20_proposta_prompt_v13_catalogo_unhas.sql'), 'utf8').split('$prompt$')[1];
const TENANT = '76aff8a0-0466-42b9-a80d-db186ff3d8bd';
// Observações reais (produção, 13/11/2026) dos serviços com frase pronta.
const NOTES = {
  servico_mao_tradicional: 'Valor para pagamento no Pix ou em dinheiro. Antes de passar valor ou horário, perguntar se é só mão, só pé ou pé e mão. A equipe pode enviar fotos de antes e depois.',
  servico_pe_e_mao_tradicional: 'Valor para pagamento no Pix ou em dinheiro. Antes de passar valor ou horário, perguntar se é só mão, só pé ou pé e mão.',
  servico_penteado: 'Valor para pagamento no Pix ou em dinheiro. Perguntar se a cliente já vem com o cabelo escovado ou se será preparado antes no salão.',
  servico_mechas_loiras: 'Orçamento definido na avaliação presencial gratuita, conforme a quantidade de produto necessária.  Perguntar o tipo de mecha e há quanto tempo foi a última química. A equipe pode enviar fotos de antes e depois. Valor a partir de R$ 580,00 no Pix ou em dinheiro.',
  servico_corte: 'Preço fixo para pagamento no Pix ou em dinheiro.',
};

async function db() {
  const pg = new PGlite();
  await pg.exec(`create table public.tenants (id uuid primary key, slug text);
    create table public.tenant_settings (tenant_id uuid primary key, settings jsonb, updated_at timestamptz);
    create table public.tenant_service_catalog (tenant_id uuid, external_id text, notes text, searchable_text text, metadata jsonb, updated_at timestamptz);
    insert into public.tenants values ('${TENANT}', 'ic_salon');`);
  await pg.query('insert into public.tenant_settings values ($1, $2, now())',
    [TENANT, JSON.stringify({ system_prompt: V13, prompt_revision: 'ic_salon_recepcao_v13_alinhado_motor' })]);
  for (const [id, notes] of Object.entries(NOTES)) {
    await pg.query('insert into public.tenant_service_catalog values ($1, $2, $3, $4, $5, now())', [TENANT, id, notes, notes.toLowerCase(), JSON.stringify({ price_type: 'fixed' })]);
  }
  return pg;
}

test('v14 aplica todas as trocas sobre o v13 real, limpa as frases prontas do catálogo e o rollback restaura tudo', async () => {
  assert.ok(V13 && V13.length > 10000);
  const pg = await db();
  await pg.exec(apply);
  const settings = (await pg.query('select settings from public.tenant_settings')).rows[0].settings;
  assert.equal(settings.prompt_revision, 'ic_salon_recepcao_v14_primeira_mensagem');
  assert.equal(settings.system_prompt_v13_backup, V13);
  for (const text of ['bom dia antes das 12h', 'nunca responda só com a apresentação', 'nunca escreva a lista você mesma',
    'Não cite profissional se a pessoa não perguntou', 'é o próximo dia com esse nome', 'isso já responde', 'sem ela, nada é cancelado', 'Menores de idade só são atendidos acompanhados do pai ou da mãe', 'indicando que é avaliação conforme as regras do sistema', 'nunca adie o registro para perguntá-los', 'não pergunte telefone', 'o nome de quem escreve não é necessário']) {
    assert.ok(settings.system_prompt.includes(text), text);
  }
  const rows = (await pg.query('select external_id, notes, searchable_text, metadata from public.tenant_service_catalog order by external_id')).rows;
  for (const row of rows) {
    assert.doesNotMatch(row.notes, /perguntar|Perguntar/, row.external_id);
    assert.doesNotMatch(row.searchable_text, /perguntar/, row.external_id);
    assert.doesNotMatch(row.notes, /\s{2,}/, row.external_id);
  }
  assert.equal(rows.find(r => r.external_id === 'servico_mao_tradicional').notes, 'Valor para pagamento no Pix ou em dinheiro. A equipe pode enviar fotos de antes e depois.');
  assert.equal(rows.find(r => r.external_id === 'servico_corte').metadata.notes_v13, undefined, 'serviço sem frase pronta não muda');
  await pg.exec(rollback);
  const back = (await pg.query('select settings from public.tenant_settings')).rows[0].settings;
  assert.equal(back.system_prompt, V13);
  assert.equal(back.prompt_revision, 'ic_salon_recepcao_v13_alinhado_motor');
  const restored = (await pg.query('select external_id, notes, metadata from public.tenant_service_catalog')).rows;
  for (const row of restored) {
    assert.equal(row.notes, NOTES[row.external_id], row.external_id);
    assert.equal(row.metadata.notes_v13, undefined);
  }
});

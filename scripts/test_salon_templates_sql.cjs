// Textos de recibo e confirmação do I&C Salon: o recibo não repete o aviso de menores, a confirmação traz o aviso leve,
// as frases terminam com pontuação e o rollback restaura os textos anteriores.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(path.join(process.env.MAGIA_TEST_MODULES || path.join(__dirname, '../app/node_modules'), '@electric-sql/pglite'));

const dir = path.join(__dirname, '../clients/ic_saloon');
const apply = fs.readFileSync(path.join(dir, '22_textos_recibo_confirmacao.sql'), 'utf8');
const rollback = fs.readFileSync(path.join(dir, '22_textos_recibo_confirmacao_rollback.sql'), 'utf8');
const TENANT = '76aff8a0-0466-42b9-a80d-db186ff3d8bd';
// Textos de produção em 13/11/2026.
const OLD = {
  received_template: 'Prontinho, anotei aqui! {servicos} para {data}, às {hora} ✨\nAgora é só aguardar: a equipe confirma o horário com você por aqui, combinado?\nUm lembrete importante: menores de idade só são atendidos acompanhados do pai ou da mãe',
  confirmation_template: 'Oba, seu horário está confirmado! {servicos} para {data}, às {hora} 💜\nVamos te esperar com muito carinho!\nLembrando que menores de idade só são atendidos acompanhados do pai ou da mãe',
  updated_template: 'Pedido atualizado para {servicos}, {data}, às {hora}. A equipe ainda vai confirmar o horário por aqui.',
  review_handoff_template: 'Vou pedir para a equipe conferir esse ponto com você por aqui, tá bem?',
};

test('recibo sem o aviso de menores, confirmação com aviso leve, pontuação final e rollback', async () => {
  const pg = new PGlite();
  await pg.exec(`create table public.tenants (id uuid primary key, slug text);
    create table public.tenant_settings (tenant_id uuid primary key, settings jsonb, updated_at timestamptz);
    insert into public.tenants values ('${TENANT}', 'ic_salon');`);
  await pg.query('insert into public.tenant_settings values ($1, $2, now())', [TENANT, JSON.stringify({ appointment_request: { ...OLD, mode: 'operator_confirmation' } })]);
  await pg.exec(apply);
  const after = (await pg.query('select settings from public.tenant_settings')).rows[0].settings.appointment_request;
  assert.doesNotMatch(after.received_template, /menores/);
  assert.match(after.confirmation_template, /menor de idade/);
  for (const key of ['received_template', 'confirmation_template']) assert.match(after[key].trim(), /[.?!]$/, key);
  assert.match(after.received_template, /\{servicos\}.*\{data\}.*\{hora\}/);
  assert.equal(after.mode, 'operator_confirmation');
  assert.doesNotMatch(after.review_handoff_template, /esse ponto/);
  assert.equal(after.updated_template, OLD.updated_template);
  // Rodar de novo não sobrescreve a cópia guardada.
  await pg.exec(apply);
  assert.equal((await pg.query('select settings from public.tenant_settings')).rows[0].settings.appointment_request.templates_backup_v1.received_template, OLD.received_template);
  await pg.exec(rollback);
  const back = (await pg.query('select settings from public.tenant_settings')).rows[0].settings.appointment_request;
  assert.equal(back.received_template, OLD.received_template);
  assert.equal(back.confirmation_template, OLD.confirmation_template);
  assert.equal(back.review_handoff_template, OLD.review_handoff_template);
  assert.equal(back.templates_backup_v1, undefined);
});

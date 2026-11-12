'use strict';
// Proposta do prompt v5 do I&C Salon (clients/ic_saloon/11_proposta_prompt_v5_persona.sql) e seu rollback, em PGlite.
// O rollback precisa devolver exatamente o que estava no NORIA-prod em 2026-11-12: os md5 abaixo foram lidos de lá
// (consulta somente leitura) para system_prompt, tone e appointment_request.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(path.join(process.env.MAGIA_TEST_MODULES || path.join(__dirname, '../app/node_modules'), '@electric-sql/pglite'));

const ROOT = path.join(__dirname, '..');
const PROPOSAL = fs.readFileSync(path.join(ROOT, 'clients/ic_saloon/11_proposta_prompt_v5_persona.sql'), 'utf8');
const ROLLBACK = fs.readFileSync(path.join(ROOT, 'clients/ic_saloon/11_proposta_prompt_v5_persona_rollback.sql'), 'utf8');
const SALON = '76aff8a0-0466-42b9-a80d-db186ff3d8bd';
const OTHER = '11111111-1111-4111-8111-111111111111';
const PROD_MD5 = { prompt: 'ff5a09d91108ddd0c0a65a314e8fa355', tone: 'cf2be86b13b769b5b8501f17db6c619d', request: 'c12f9cd4ebf21edd116a541167633962' };

// appointment_request de produção sem invalid_request_template (o rollback a devolve).
const REQUEST_WITHOUT_INVALID = {
  mode: 'operator_confirmation', reply_mode: 'contextual',
  updated_template: 'Pedido atualizado para {servicos}, {data}, às {hora}. A equipe ainda vai confirmar o horário por aqui.',
  received_template: 'Prontinho, anotei aqui! {servicos} para {data}, às {hora} ✨\nAgora é só aguardar: a equipe confirma o horário com você por aqui, combinado?\nUm lembrete importante: menores de idade só são atendidos acompanhados do pai ou da mãe',
  stale_alert_hours: 4,
  full_name_template: 'Para eu anotar certinho, qual é o seu nome completo?',
  team_review_control: 'manual_reply',
  confirmation_template: 'Oba, seu horário está confirmado! {servicos} para {data}, às {hora} 💜\nVamos te esperar com muito carinho!\nLembrando que menores de idade só são atendidos acompanhados do pai ou da mãe',
  slot_rejected_template: 'Poxa, o horário de {data}, às {hora}, já está ocupado 😕 Mas a gente encontra outro para você! Qual dia ou horário fica melhor?',
  review_handoff_template: 'Vou pedir para a equipe conferir esse ponto com você por aqui, tá bem?',
  missing_details_template: 'Para eu registrar seu pedido, me confirma o serviço, o dia e o horário exato que você prefere?',
  processing_error_template: 'Não consegui concluir isso por aqui agora. Vou pedir para a equipe conferir e continuar seu atendimento.',
  name_confirmation_template: 'Posso registrar esse pedido no nome {nome}?',
  conflict_existing_appointment_template: 'Vi aqui que você já tem {servicos} marcado para {data}, às {hora}. Vou pedir para a equipe conferir esse horário com você por aqui.',
};

async function database() {
  const db = new PGlite();
  await db.exec(`create table public.tenants(id uuid primary key, slug text);
    create table public.tenant_settings(tenant_id uuid primary key, settings jsonb, updated_at timestamptz);
    insert into public.tenants values ('${SALON}', 'ic_salon'), ('${OTHER}', 'outro');`);
  // Estado v5 sintético; o rollback o leva ao v4 de produção, que é o ponto de partida da proposta.
  const seed = { system_prompt: 'x', prompt_revision: 'ic_salon_recepcao_v5_persona_equipe', tone: 'x', business_hours: {},
    appointment_request: REQUEST_WITHOUT_INVALID, payment: { pix_key: 'fixture' } };
  await db.query('insert into public.tenant_settings values ($1, $2, now()), ($3, $2, now())', [SALON, JSON.stringify(seed), OTHER]);
  await db.exec(ROLLBACK);
  return db;
}
const state = async (db, id = SALON) => (await db.query(`select md5(settings->>'system_prompt') prompt, md5(settings->>'tone') tone,
  md5((settings->'appointment_request')::text) request, settings ? 'business_hours' hours, settings->>'prompt_revision' revision,
  settings->>'system_prompt' text, settings->'business_hours' bh, settings->'payment' payment,
  (settings->'appointment_request') ? 'invalid_request_template' invalid from public.tenant_settings where tenant_id = $1`, [id])).rows[0];

test('rollback reproduz exatamente o v4 de produção', async () => {
  const db = await database();
  const v4 = await state(db);
  assert.deepEqual({ prompt: v4.prompt, tone: v4.tone, request: v4.request }, PROD_MD5);
  assert.equal(v4.hours, false);
  assert.equal(v4.revision, 'ic_salon_recepcao_v4_catalogo_endereco');
});

test('proposta v5: persona, sem frase pronta, alinhada ao motor; ida e volta preserva produção', async () => {
  const db = await database();
  await db.exec(PROPOSAL);
  const v5 = await state(db);
  assert.equal(v5.revision, 'ic_salon_recepcao_v5_persona_equipe');
  assert.match(v5.text, /integrante mais nova da equipe/);
  assert.match(v5.text, /assistente virtual da equipe do salão/, 'continua honesta quando perguntam se é robô');
  assert.doesNotMatch(v5.text, /responda: "/, 'sem frase de abertura decorada');
  assert.doesNotMatch(v5.text, /ATUALIZAR_PEDIDO|CANCELAR_PEDIDO/, 'o motor do Salon transfere mudança/desistência para a equipe');
  assert.match(v5.text, /pergunte se ela concorda/, 'sinal após falta: pede concordância antes de registrar');
  assert.equal(v5.invalid, false);
  assert.deepEqual(v5.bh.schedule.segunda, { closed: true });
  assert.deepEqual(v5.bh.schedule.terca, { start: '09:00', end: '18:00' });
  assert.deepEqual(v5.payment, { pix_key: 'fixture' }, 'chaves não citadas ficam intactas');
  // Proposta não reaplica sobre outra revisão.
  await db.exec(PROPOSAL);
  assert.equal((await state(db)).text, v5.text);
  await db.exec(ROLLBACK);
  const back = await state(db);
  assert.deepEqual({ prompt: back.prompt, tone: back.tone, request: back.request }, PROD_MD5);
  assert.equal(back.hours, false);
  // Outro tenant nunca é tocado.
  assert.equal((await state(db, OTHER)).revision, 'ic_salon_recepcao_v5_persona_equipe');
});

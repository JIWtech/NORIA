'use strict';
// Proposta do prompt v12 da NB Bronze (clients/clinica_nubia_oficial/08_proposta_prompt_v12_pipeline.sql) e seu rollback, em PGlite.
// O rollback precisa devolver exatamente o que estava no NORIA-prod em 2026-11-12. Os md5 e o fixture de business_facts abaixo
// foram lidos de lá por consulta somente leitura (tenant_settings, tenant clinica_nubia_oficial); nada foi escrito em produção.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(path.join(process.env.MAGIA_TEST_MODULES || path.join(__dirname, '../app/node_modules'), '@electric-sql/pglite'));

const dir = path.join(__dirname, '../clients/clinica_nubia_oficial');
const PROPOSAL = fs.readFileSync(path.join(dir, '08_proposta_prompt_v12_pipeline.sql'), 'utf8');
const ROLLBACK = fs.readFileSync(path.join(dir, '08_proposta_prompt_v12_pipeline_rollback.sql'), 'utf8');
const V11 = fs.readFileSync(path.join(dir, 'prompts/system_prompt_diva_v11.txt'), 'utf8');
const V12 = fs.readFileSync(path.join(dir, 'prompts/system_prompt_diva_v12.txt'), 'utf8');
const NB = '563a93cd-a5c1-4412-a65f-be2e2d41bb88';
const OTHER = '11111111-1111-4111-8111-111111111111';
const OLD_REV = "nubia-2026-11-11-diva-v11";
const NEW_REV = 'nubia-2026-11-12-diva-v12-pipeline';
const PROD_MD5 = { prompt: 'dad05fbaf27e7871f77c24f4b19362a6', facts: '59ec5cb3a960e5d7bc37c30347192162', audience: 'a478a655a8d8da096ce6e9abef39de3a', policies: '1c4b5f15ebe2abb85488ddf6d31d2764' };
const PROD_FACTS = {"fees":{"after_17h_sundays_holidays":10},"name":"NB Bronze","audience":{"policy":"Nosso espaço e todos os nossos atendimentos são dedicados exclusivamente para mulheres ✨ Se você estiver procurando um cuidado especial para alguma mulher (esposa, namorada, mãe ou amiga), vai ser um prazer te ajudar a escolher tudo pra ela 💖","exclusive_to":"female","allow_proxy_booking_for_female":true},"policies":["Tolerancia de atraso de 5 minutos. Depois disso a vaga pode ser cancelada.","Pagamento em dinheiro deve ser levado trocado, por gentileza.","Agende um horario em que realmente possa comparecer.","Atendimentos apos 17h, domingos e feriados tem acrescimo de R$ 10,00.","Agendamento confirmado mediante pagamento antecipado de 50%, sujeito a verificacao humana do sinal.","Sinal nao reembolsavel em caso de cancelamento.","Remarcacoes com minimo de 24h de antecedencia ou, excepcionalmente, ate 8h antes.","Cancelamentos fora do prazo, faltas ou atraso acima de 5 minutos resultam em perda do sinal.","Atendimento exclusivo para o público feminino (não atendemos homens)."],"fee_rules":{"after_17h_sundays_holidays":{"weekdays":[0],"after_time":"17:00","holiday_dates":[]}},"locations":[{"id":"angra","name":"Nova Angra","address":"Av. Itaguaí, 200 - Nova Angra, Angra dos Reis - RJ, 23933-115, Brasil","verified":true,"verified_source":"Endereco confirmado pelo responsavel no chat em 2026-09-25"}],"policy_source":"questionario-clinica-nubia-beatriz-2026-10-02.pdf prevalece em regras financeiras; operacao confirmada posteriormente pelo responsavel quando aplicavel","service_guidance":{"solar":{"time":"Manhã livre até as 11h, somente em dia de sol","bring":["Canga grande ou lencol de solteiro para forrar a maca","Toalha preferencialmente escura","Sabonete para o banho apos o procedimento","Protetor solar exclusivamente para o rosto","Oculos de sol","Roupa confortavel","Fone sem fio, opcional","Garrafa de agua congelada, opcional"],"before":["Chegue 15 minutos antes; tolerancia de atraso de 5 minutos.","Venha de banho tomado, com a pele limpa e sem oleo, creme, hidratante ou outros produtos corporais.","De preferencia a sabonete neutro ou sabao de coco no banho antes do procedimento.","Nao se depile no dia; depilacao com pelo menos 2 dias de antecedencia. Venha com os cabelos presos."],"booking":"human","services":["bronze_no_sol"],"restrictions":["Nao levar criancas, acompanhantes ou bicicletas.","Apos a tolerancia de atraso, o atendimento podera ser cancelado."],"bring_message":"solar_itens"},"spray":{"after":["Nao molhe a pele, nao tome banho e evite suar durante 8 a 12 horas.","Apos o primeiro banho, evite banhos muito quentes e demorados, que podem reduzir a durabilidade.","Depois desse periodo, mantenha a pele hidratada com creme hidratante para ajudar na durabilidade e uniformidade."],"before":["Nao use oleo, creme ou hidratante na pele no dia.","Tome banho antes com sabonete neutro, sem oleo, e bucha. Pele oleosa pode prejudicar a fixacao.","Use roupas leves e preferencialmente escuras. Segundo as orientacoes da clinica, o produto que encostar no tecido sai na lavagem normal."],"booking":"human","location":"Na clínica e a domicílio","services":["bronze_jato_corpo_todo"],"home_service":{"source":"Confirmado pelo responsável na conversa em 2026-10-07","booking":"human","available":true,"price_status":"confirm_with_team","coverage_status":"confirm_with_team","availability_status":"confirm_with_team"},"stay_minutes":45,"before_message":"jato_preparo","procedure_minutes":20},"source":"questionario-2026-10-02 + NB.docx recebido 2026-10-07","machine":{"bring":["Fone de ouvido sem fio","Toalha preferencialmente escura","Sabonete","Protetor solar para o rosto","Oculos de sol","Roupa confortavel"],"before":["Chegue 15 minutos antes, de banho tomado e sem oleo, creme ou hidratante na pele.","Nao se depile no dia; depilacao com pelo menos 2 dias de antecedencia.","Cabelo preso. Se a fita descolar por preparo inadequado da pele, a responsabilidade e da cliente."],"services":["bronze_classico","bronze_premium","bronze_comfort"],"restrictions":["Proibido levar criancas, acompanhantes ou bicicletas.","Atraso acima de 5 minutos cancela a vaga para nao prejudicar os proximos atendimentos."],"stay_minutes":{"bronze_premium":[90,150],"bronze_classico":[90,150]},"before_message":"informacoes_gerais","booking_block_minutes":90,"procedure_minutes_max":80,"procedure_minutes_min":40},"moon_bath":{"booking":"ai","services":["banho_lua_classico","banho_lua_premium","banho_lua_comfort"],"description":"Três versões: Clássico, Premium e Comfort, com apresentações e preços próprios.","capacity_scope":"total_dos_tres_banhos_de_lua_por_horario","capacity_status":"provisorio_confirmado_pelo_responsavel_2026-10-08","shared_capacity":30,"shared_resource":"banho_lua_shared","procedure_minutes":{"max":80,"min":40,"source":"confirmacao direta 2026-10-08"},"booking_block_minutes":90}}};

// Chaves que a proposta não cita: precisam sair idênticas.
const UNTOUCHED = {
  payment: { pix_key: 'fixture', deposit_percentage: 50 },
  approved_messages: { enabled: true, revision: 'nb-texts-v2', blocks: { catalogo: { text: 'x' } } },
  appointment_scheduling: { enabled: true, duration_minutes: 90 },
  noria_turn_pipeline: { enabled: true, rollout: 'all' },
  tone: 'feminino, acolhedor, charmoso, elegante e direto',
};

async function database(revision = OLD_REV) {
  const db = new PGlite();
  await db.exec(`create table public.tenants(id uuid primary key, slug text);
    create table public.tenant_settings(tenant_id uuid primary key, settings jsonb, updated_at timestamptz);
    insert into public.tenants values ('${NB}', 'clinica_nubia_oficial'), ('${OTHER}', 'outro');`);
  const seed = { ...UNTOUCHED, system_prompt: V11, prompt_revision: revision, business_facts: PROD_FACTS };
  await db.query('insert into public.tenant_settings values ($1, $2, now()), ($3, $2, now())', [NB, JSON.stringify(seed), OTHER]);
  return db;
}
const state = async (db, id = NB) => (await db.query(`select settings->>'system_prompt' prompt, md5(settings->>'system_prompt') prompt_md5,
  settings->>'prompt_revision' revision, md5((settings->'business_facts')::text) facts_md5, settings->'business_facts' facts,
  md5((settings->'business_facts'->'audience')::text) audience_md5, md5((settings->'business_facts'->'policies')::text) policies_md5,
  settings - 'system_prompt' - 'prompt_revision' - 'business_facts' rest from public.tenant_settings where tenant_id = $1`, [id])).rows[0];

test('ponto de partida é o v11 exato de produção (prompt do repositório e business_facts lidos do NORIA-prod)', async () => {
  const s = await state(await database());
  assert.equal(s.prompt_md5, PROD_MD5.prompt);
  assert.equal(s.facts_md5, PROD_MD5.facts);
  assert.equal(s.audience_md5, PROD_MD5.audience);
  assert.equal(s.policies_md5, PROD_MD5.policies);
});

test('proposta v12: aplica só sobre a revisão atual e altera apenas as chaves citadas', async () => {
  const db = await database();
  await db.exec(PROPOSAL);
  const v12 = await state(db);
  assert.equal(v12.revision, NEW_REV);
  assert.equal(v12.prompt, V12);
  assert.deepEqual(v12.rest, UNTOUCHED, 'chaves não citadas ficam intactas');
  const facts = v12.facts;
  const orig = PROD_FACTS;
  // Fora de audience e policies, business_facts não muda.
  for (const key of Object.keys(orig).filter(k => !['audience', 'policies'].includes(k))) assert.deepEqual(facts[key], orig[key], key);
  assert.equal(facts.audience.exclusive_to, 'female');
  assert.equal(facts.audience.allow_proxy_booking_for_female, true);
  assert.equal(facts.audience.ineligible_booking_message, orig.audience.policy, 'mensagem atual de público feminino preservada');
  assert.match(facts.audience.invalid_name_message, /nome e sobrenome reais/);
  assert.ok(facts.audience.policy.startsWith(orig.audience.policy));
  assert.match(facts.audience.policy, /cliente e amiga podem agendar juntas/i);
  assert.match(facts.audience.policy, /Acompanhante que não fará procedimento não pode ficar/);
  assert.match(facts.audience.policy, /equipe humana/);
  assert.equal(facts.policies.length, orig.policies.length + 2);
  assert.deepEqual(facts.policies.slice(0, 8), orig.policies.slice(0, 8));
  assert.doesNotMatch(facts.policies[8], /não atendemos homens/);
  assert.match(facts.policies[9], /por pessoa/);
  assert.match(facts.policies[10], /Desconto de amiga/);
  // Reaplicar não muda mais nada (a revisão já não é a v11).
  await db.exec(PROPOSAL);
  assert.deepEqual(await state(db), v12);
});

test('v12 elimina o contrato antigo e o desconto/percentual inventado', () => {
  for (const legacy of [/message_keys/, /price_claims/, /action=/, /opening=/, /official_facts/, /time_evidence/, /current_message_ids/, /\[ACAO/, /\[HUMANO/, /state\.unit_id/]) {
    assert.doesNotMatch(V12, legacy, String(legacy));
  }
  assert.doesNotMatch(V12, /\b15 ?%/, 'não informa percentual de desconto de amiga');
  assert.doesNotMatch(V12, /R\$ ?\d/, 'valores monetários só vêm dos fatos autorizados');
  assert.match(V12, /Cumprimente somente quando recent_conversation ainda não tiver nenhuma mensagem do negócio/);
  assert.match(V12, /Desconto de amiga[^\n]*equipe humana/);
  assert.match(V12, /Acompanhante que não fará procedimento não pode ficar/);
  assert.match(V12, /Cliente e amiga podem agendar juntas/);
});

test('não aplica sobre outra revisão nem sobre outro tenant', async () => {
  const edited = await database('nubia-2026-11-12-edicao-manual');
  await edited.exec(PROPOSAL);
  const kept = await state(edited);
  assert.equal(kept.revision, 'nubia-2026-11-12-edicao-manual');
  assert.equal(kept.prompt_md5, PROD_MD5.prompt);
  assert.equal(kept.facts_md5, PROD_MD5.facts);
  // Outro tenant com a mesma revisão nunca é tocado.
  const db = await database();
  await db.exec(PROPOSAL);
  const other = await state(db, OTHER);
  assert.equal(other.revision, OLD_REV);
  assert.equal(other.prompt_md5, PROD_MD5.prompt);
  assert.equal(other.facts_md5, PROD_MD5.facts);
});

test('não aplica se o texto de business_facts divergir do esperado em produção', async () => {
  const db = await database();
  await db.query(`update public.tenant_settings set settings = jsonb_set(settings, '{business_facts,audience,policy}', '"outro texto"') where tenant_id = $1`, [NB]);
  await db.exec(PROPOSAL);
  assert.equal((await state(db)).revision, OLD_REV);
});

test('rollback devolve exatamente o estado de produção e só age sobre a v12', async () => {
  const db = await database();
  await db.exec(PROPOSAL);
  await db.exec(ROLLBACK);
  const back = await state(db);
  assert.equal(back.revision, OLD_REV);
  assert.equal(back.prompt_md5, PROD_MD5.prompt);
  assert.equal(back.facts_md5, PROD_MD5.facts, 'business_facts idêntico ao de produção');
  assert.equal(back.audience_md5, PROD_MD5.audience);
  assert.equal(back.policies_md5, PROD_MD5.policies);
  assert.deepEqual(back.rest, UNTOUCHED);
  // Rollback sobre o v11 não faz nada; sobre outro tenant, também não.
  await db.exec(ROLLBACK);
  assert.equal((await state(db)).facts_md5, PROD_MD5.facts);
  const other = await database();
  await other.exec(PROPOSAL);
  await other.query(`update public.tenant_settings set settings = jsonb_set(settings, '{prompt_revision}', '"nubia-2026-11-12-diva-v12-pipeline"') where tenant_id = $1`, [OTHER]);
  await other.exec(ROLLBACK);
  assert.equal((await state(other, OTHER)).prompt_md5, PROD_MD5.prompt, 'outro tenant intacto (fixture igual ao seed)');
  assert.equal((await state(other, OTHER)).revision, 'nubia-2026-11-12-diva-v12-pipeline', 'rollback não tocou o outro tenant');
});

// Prompt v17 do I&C Salon + sincronização de business_hours:
// - constrói a v16 real a partir da cadeia local (v13 -> v14 -> v15 -> v16) e confere o MD5 de produção (80d35ff162564ab5e4b00783432a76dd);
// - aplica 25_proposta_prompt_v17_enxuto_alinhado.sql;
// - confere ausência de duplicações e contradições, presença das regras alinhadas ao motor/adaptador e sincronização da coluna business_hours;
// - executa o rollback e prova restauração bit a bit do estado de produção.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(path.join(process.env.MAGIA_TEST_MODULES || path.join(__dirname, '../app/node_modules'), '@electric-sql/pglite'));

const dir = path.join(__dirname, '../clients/ic_saloon');
const sql = name => fs.readFileSync(path.join(dir, name), 'utf8').replace(/\r\n/g, '\n');
const V13 = sql('20_proposta_prompt_v13_catalogo_unhas.sql').split('$prompt$')[1];
const TENANT = '76aff8a0-0466-42b9-a80d-db186ff3d8bd';
const LOCAL_CHAIN_V16_MD5 = 'd44d8cb8a395ef09c444c6da751b262d';
const PROD_V16_MD5 = '80d35ff162564ab5e4b00783432a76dd';
const PROD_V16_TONE = 'Acolhedora, carinhosa e animada; a atendente fala no feminino, como a integrante mais nova da equipe, e trata clientes de qualquer gênero (neutro até a pessoa se identificar); próxima sem exagero, sem gírias; no máximo um emoji por mensagem.';
const PROD_BUSINESS_HOURS = {
  holidays: ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'],
  schedule: {
    terca: { start: '09:00', end: '18:00' },
    quarta: { start: '09:00', end: '18:00' },
    quinta: { start: '09:00', end: '18:00' },
    sexta: { start: '09:00', end: '18:00' },
    sabado: { start: '09:00', end: '18:00' },
    domingo: { closed: true },
    segunda: { closed: true },
  },
  holidays_added_by: '22_textos_recibo_confirmacao',
};

async function buildProdV16Db() {
  const pg = new PGlite();
  await pg.exec(`
    create table public.tenants (id uuid primary key, slug text);
    create table public.tenant_settings (tenant_id uuid primary key, business_hours jsonb default '{}'::jsonb, settings jsonb, updated_at timestamptz);
    create table public.tenant_service_catalog (tenant_id uuid, external_id text, notes text, searchable_text text generated always as (lower(notes)) stored, metadata jsonb, updated_at timestamptz);
    insert into public.tenants values ('${TENANT}', 'ic_salon');
  `);
  await pg.query(
    'insert into public.tenant_settings (tenant_id, business_hours, settings, updated_at) values ($1, $2, $3, now())',
    [
      TENANT,
      JSON.stringify({}),
      JSON.stringify({
        system_prompt: V13,
        prompt_revision: 'ic_salon_recepcao_v13_alinhado_motor',
        tone: PROD_V16_TONE,
        business_hours: PROD_BUSINESS_HOURS,
      }),
    ]
  );
  await pg.exec(sql('21_proposta_prompt_v14_primeira_mensagem.sql'));
  await pg.exec(sql('23_proposta_prompt_v15_abertura_lista.sql'));
  await pg.exec(sql('24_proposta_prompt_v16_ordem_agendamento.sql'));
  return pg;
}

test('v17 aplica sobre a v16 (cadeia local e snapshot de produção), sincroniza business_hours, elimina duplicações e o rollback restaura tudo', async () => {
  const pg = await buildProdV16Db();
  const chainV16 = (await pg.query(`select settings->>'system_prompt' as prompt, md5(settings->>'system_prompt') as prompt_md5 from public.tenant_settings where tenant_id = $1`, [TENANT])).rows[0];
  assert.equal(chainV16.prompt_md5, LOCAL_CHAIN_V16_MD5);

  // Snapshot exato de produção em 20/11/2026 (edição manual em 18/11 removeu os dois trechos da integrante nova sobre a v16 local):
  const prodPrompt = chainV16.prompt
    .replace('Você é a integrante mais nova da equipe e cuida do atendimento pelo WhatsApp. Você fala sempre no feminino.', 'Você cuida do atendimento pelo WhatsApp. Você fala sempre no feminino e de forma gentil.')
    .replace('Depois conte, com palavras diferentes a cada atendimento, que você chegou há pouco na equipe. ', ' ');
  await pg.query(`update public.tenant_settings set settings = jsonb_set(settings, '{system_prompt}', to_jsonb($2::text)) where tenant_id = $1`, [TENANT, prodPrompt]);

  const before = (await pg.query(`select business_hours, settings, md5(settings->>'system_prompt') as prompt_md5 from public.tenant_settings where tenant_id = $1`, [TENANT])).rows[0];
  assert.equal(before.settings.prompt_revision, 'ic_salon_recepcao_v16_ordem_agendamento');
  assert.equal(before.prompt_md5, PROD_V16_MD5);
  assert.deepEqual(before.business_hours, {});

  await pg.exec(sql('25_proposta_prompt_v17_enxuto_alinhado.sql'));
  const after = (await pg.query(`select business_hours, settings, md5(settings->>'system_prompt') as prompt_md5 from public.tenant_settings where tenant_id = $1`, [TENANT])).rows[0];
  const prompt = after.settings.system_prompt;

  assert.equal(after.settings.prompt_revision, 'ic_salon_recepcao_v17_enxuto_alinhado');
  assert.equal(after.settings.system_prompt_v16_backup, before.settings.system_prompt);
  assert.deepEqual(after.business_hours, PROD_BUSINESS_HOURS, 'coluna business_hours sincronizada com settings->business_hours');
  assert.ok(prompt.length < before.settings.system_prompt.length, 'prompt v17 deve ser mais enxuto que o v16');

  // Regras essenciais preservadas e alinhadas com motor + adaptador + guarda de preços:
  for (const expected of [
    'Você é a integrante mais nova da equipe',
    'Varie a saudação, as palavras e a estrutura a cada atendimento.',
    'não pergunte como a pessoa está nem peça seu nome',
    'apresente-se brevemente como a integrante mais nova da equipe',
    'Se a pessoa apenas cumprimentou, faça uma única pergunta perguntando como pode ajudar.',
    'nunca escreva datas em formato técnico (como 2026-11-14)',
    'não fornece telefone, e-mail, chave Pix, CNPJ, CPF, conta bancária ou contato pessoal no chat',
    'Para qualquer serviço, quando a pessoa pedir preço e houver valor numérico cadastrado para o serviço exato',
    'Se houver preço cadastrado, comece informando o valor inicial numérico para Pix ou dinheiro',
    'é preciso aprovação no teste de mechas antes de agendar o procedimento',
    'cubra todos os serviços sobre os quais a pessoa pediu explicação',
    'A equipe passa os dados por aqui quando houver pagamento e confere o comprovante',
    'faltar uma informação que impeça o atendimento',
    'Nos demais serviços que pedem avaliação, explique que a avaliação presencial é feita no salão junto com o atendimento.',
    '1. Serviço ou serviços',
    '2. Dia e horário exatos',
    '3. Nome completo com sobrenome de quem será atendido',
    'Nunca adie o registro para perguntar profissional, primeira vez ou telefone',
    '[HUMANO_SOLICITADO]',
  ]) {
    assert.ok(prompt.includes(expected), `Faltou trecho esperado: ${expected}`);
  }

  // Sem duplicações internas da v16:
  assert.equal((prompt.match(/bem-vinda/g) || []).length, 1, 'regra de bem-vinda aparece uma única vez');
  assert.equal((prompt.match(/terça a sábado, das 9h às 18h/g) || []).length, 1, 'horário de funcionamento aparece uma única vez');
  assert.doesNotMatch(prompt, /pergunte com quem está falando e como pode ajudar/, 'não faz duas perguntas nem pede nome na abertura');

  // Rollback restaura literalmente a v16 e a coluna business_hours
  await pg.exec(sql('25_proposta_prompt_v17_enxuto_alinhado_rollback.sql'));
  const restored = (await pg.query(`select business_hours, settings, md5(settings->>'system_prompt') as prompt_md5 from public.tenant_settings where tenant_id = $1`, [TENANT])).rows[0];
  assert.equal(restored.settings.prompt_revision, 'ic_salon_recepcao_v16_ordem_agendamento');
  assert.equal(restored.prompt_md5, PROD_V16_MD5);
  assert.equal(restored.settings.system_prompt, before.settings.system_prompt);
  assert.equal(restored.settings.tone, PROD_V16_TONE);
  assert.equal(restored.settings.system_prompt_v16_backup, undefined);
  assert.deepEqual(restored.business_hours, {});
});

test('rollback preserva valores prévios diferentes do snapshot e bloqueia edição posterior', async t => {
  const pg = await buildProdV16Db();
  t.after(() => pg.close());
  const apply = sql('25_proposta_prompt_v17_enxuto_alinhado.sql');
  const rollback = sql('25_proposta_prompt_v17_enxuto_alinhado_rollback.sql');
  const read = async () => (await pg.query('select business_hours, business_hours is null as null_hours, settings from public.tenant_settings where tenant_id = $1', [TENANT])).rows[0];
  await pg.exec(`update public.tenant_settings set business_hours = null,
    settings = (settings - 'tone') || '{"system_prompt_v16_backup":null}'`);
  const before = await read();
  await pg.exec(apply);
  const applied = await read();
  await pg.exec(apply);
  assert.deepEqual(await read(), applied);

  await pg.exec(`update public.tenant_settings set settings = settings || '{"tone":"Alteração posterior","other_feature":true}'`);
  const edited = await read();
  await assert.rejects(pg.exec(rollback), /IC_SALON_V17_ROLLBACK_STATE_CHANGED/);
  await pg.exec('rollback');
  assert.deepEqual(await read(), edited);

  await pg.query("update public.tenant_settings set settings = jsonb_set(settings, '{tone}', $1::jsonb)", [JSON.stringify(applied.settings.tone)]);
  await pg.exec(rollback);
  assert.deepEqual(await read(), { ...before, settings: { ...before.settings, other_feature: true } });
});

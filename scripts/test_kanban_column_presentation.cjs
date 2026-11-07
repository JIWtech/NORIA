// Migração 032: aparência das colunas do Kanban no Supabase. O gatilho completa o que vier vazio a partir do preset,
// nunca sobrescreve o que o tenant definiu, e os valores aceitos são os que o painel sabe desenhar.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(path.join(
  process.env.MAGIA_TEST_MODULES || path.join(require('node:os').tmpdir(), 'magia-diag-tools/node_modules'),
  '@electric-sql/pglite'
));
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const migration = read('supabase/migrations/032_kanban_column_presentation.sql').replace(/notify pgrst[^;]*;/, '');
const tenantA = '11111111-1111-1111-1111-111111111111';
const tenantB = '22222222-2222-2222-2222-222222222222';

async function bootstrap(seed = []) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table kanban_columns(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, board_id uuid not null,
      name text not null, position integer not null default 0, automation_key text, created_at timestamptz default now(), updated_at timestamptz default now());
  `);
  for (const [tenant, key, name] of seed) {
    await db.query('insert into kanban_columns(tenant_id, board_id, name, automation_key) values ($1, $1, $2, $3)', [tenant, name, key]);
  }
  await db.exec(migration);
  return db;
}
const row = async (db, name) => (await db.query('select icon, tone, owner_role, short_label, description from kanban_columns where name = $1', [name])).rows[0];

test('carga inicial preenche as colunas existentes pela chave, sem tocar nome nem chave', async () => {
  const db = await bootstrap([[tenantA, 'com_humano', 'Com humano'], [tenantB, 'conversas_ia', 'Novo contato'], [tenantA, 'chave_nova', 'Revisão']]);
  assert.deepEqual(await row(db, 'Com humano'), { icon: 'user-round', tone: 'pink', owner_role: 'human', short_label: 'Em atendimento', description: 'Com atendentes da equipe.' });
  assert.deepEqual(await row(db, 'Novo contato'), { icon: 'bot', tone: 'cyan', owner_role: 'ai', short_label: 'Conversas IA', description: 'Em atendimento com a IA.' });
  assert.deepEqual(await row(db, 'Revisão'), { icon: null, tone: null, owner_role: 'neutral', short_label: null, description: null });
  const names = (await db.query('select name, automation_key from kanban_columns order by name')).rows;
  assert.deepEqual(names.map(r => r.name + ':' + r.automation_key), ['Com humano:com_humano', 'Novo contato:conversas_ia', 'Revisão:chave_nova']);
});

test('nova coluna recebe o preset da chave no insert (onboarding, SQL de cliente)', async () => {
  const db = await bootstrap();
  await db.query("insert into kanban_columns(tenant_id, board_id, name, automation_key) values ($1, $1, 'Confirmar agendamento', 'confirmar_agendamento')", [tenantA]);
  assert.deepEqual(await row(db, 'Confirmar agendamento'), { icon: 'calendar-check', tone: null, owner_role: 'neutral', short_label: null,
    description: 'Pedidos conduzidos pela IA aguardando a sua confirmação.' });
});

test('o que o tenant define não é sobrescrito', async () => {
  const db = await bootstrap();
  await db.query("insert into kanban_columns(tenant_id, board_id, name, automation_key, icon, tone, owner_role) values ($1, $1, 'Equipe', 'com_humano', 'sparkles', 'teal', 'neutral')", [tenantA]);
  const r = await row(db, 'Equipe');
  assert.deepEqual([r.icon, r.tone, r.owner_role, r.short_label], ['sparkles', 'teal', 'neutral', 'Em atendimento']);
});

test('valores fora da lista são recusados', async () => {
  const db = await bootstrap();
  for (const [column, value] of [['icon', 'emoji-qualquer'], ['tone', 'roxo'], ['owner_role', 'gerente']]) {
    await assert.rejects(db.query(`insert into kanban_columns(tenant_id, board_id, name, ${column}) values ($1, $1, $2, $3)`, [tenantA, 'x-' + column, value]), /check/i, column);
  }
});

test('reaplicar a migração não muda nada', async () => {
  const db = await bootstrap([[tenantA, 'agendamentos', 'Agendamentos']]);
  await db.query("update kanban_columns set icon = 'flame' where name = 'Agendamentos'");
  await db.exec(migration);
  assert.equal((await row(db, 'Agendamentos')).icon, 'flame');
  assert.equal((await db.query('select count(*)::int c from kanban_column_presets')).rows[0].c, 26);
});

test('a tabela de presets não fica exposta ao painel nem ao público', async () => {
  const db = await bootstrap();
  const { rows } = await db.query(`select has_table_privilege('anon','kanban_column_presets','select') anon, has_table_privilege('authenticated','kanban_column_presets','select') auth,
    (select relrowsecurity from pg_class where relname = 'kanban_column_presets') rls`);
  assert.deepEqual(rows[0], { anon: false, auth: false, rls: true });
});

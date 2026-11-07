import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as lucide from 'lucide-react';
import { eventsToKanban } from '../../src/dataService.js';
import { COLUMN_ICONS, kanbanColumnPresentation } from '../../src/services/kanban/kanbanColumnPresentation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migration = fs.readFileSync(path.join(__dirname, '../../../supabase/migrations/032_kanban_column_presentation.sql'), 'utf8');

// Presets da migração 032, lidos do próprio SQL.
const sqlValue = (value) => (value.trim() === 'null' ? null : value.trim().replace(/^'|'$/g, ''));
const presets = new Map([...migration.matchAll(/^\s+\('([a-z_]+)',\s+(null|'[^']*'),\s+(null|'[^']*'),\s+'(ai|human|neutral)',\s+(null|'[^']*'),\s+(null|'[^']*')\)/gm)]
  .map(([, key, icon, tone, ownerRole, shortLabel, description]) => [key, {
    icon: sqlValue(icon), tone: sqlValue(tone), owner_role: ownerRole, short_label: sqlValue(shortLabel), description: sqlValue(description),
  }]));

// Como cada coluna de produção aparecia ANTES da migração (gerado executando o código antigo sobre as 31 combinações reais).
const BEFORE = [
  ['agendamentos', 'Agendamentos', 'CalendarDays', 'indigo', 'Agenda', 'Conversas com horário marcado.'],
  ['aguardando_finalizacao', 'Aguardando finalizacao', 'Inbox', 'lime', 'Aguardando finalizacao', 'Conversas nesta etapa.'],
  ['aguardando_humano', 'Aguardando humano', 'UserRound', 'pink', 'Aguardando', 'Aguardando atendimento da equipe.'],
  ['com_humano', 'Com humano', 'UserRound', 'pink', 'Em atendimento', 'Com atendentes da equipe.'],
  ['com_humano', 'Em atendimento humano', 'UserRound', 'pink', 'Em atendimento', 'Com atendentes da equipe.'],
  ['confirmar_agendamento', 'Confirmar agendamento', 'CalendarCheck', 'slate', 'Confirmar agendamento', 'Pedidos conduzidos pela IA aguardando a sua confirmação.'],
  ['conversas_abandonadas', 'Conversas abandonadas', 'Inbox', 'red', 'Conversas abandonadas', 'Conversas nesta etapa.'],
  ['conversas_andamento', 'Conversas em andamento', 'Clock3', 'cyan', 'Andamento', 'Em negociação.'],
  ['conversas_humanos', 'Conversas com humanos', 'UserRound', 'pink', 'Em atendimento', 'Com atendentes da equipe.'],
  ['conversas_ia', 'Conversas com IA', 'Bot', 'cyan', 'Conversas IA', 'Em atendimento com a IA.'],
  ['conversas_ia', 'Conversas IA', 'Bot', 'cyan', 'Conversas IA', 'Em atendimento com a IA.'],
  ['conversas_ia', 'Novo contato', 'Bot', 'cyan', 'Conversas IA', 'Em atendimento com a IA.'],
  ['finalizadas', 'Finalizadas', 'CheckCircle2', 'green', 'Finalizadas', 'Atendimentos concluídos.'],
  ['finalizadas', 'Venda concluida', 'CheckCircle2', 'green', 'Finalizadas', 'Atendimentos concluídos.'],
  ['follow_ups', 'Follow Ups', 'Inbox', 'slate', 'Follow Ups', 'Conversas nesta etapa.'],
  ['interesse_compra', 'Interesse de compra', 'Inbox', 'orange', 'Interesse de compra', 'Conversas nesta etapa.'],
  ['interesse_compra', 'Interesse em compra', 'Inbox', 'orange', 'Interesse em compra', 'Conversas nesta etapa.'],
  ['nao_compareceu', 'Não compareceu', 'CalendarX2', 'slate', 'Não compareceu', 'Clientes que faltaram ao agendamento.'],
  ['novas_conversas', 'Novas conversas', 'MessageCircle', 'blue', 'Novas', 'Aguardando primeiro contato.'],
  ['produtos_apresentados', 'Produtos apresentados', 'Sparkles', 'yellow', 'Produtos', 'Produtos e serviços enviados.'],
  ['sales_after_sales', 'Pós-venda - Manutenção', 'Wrench', 'teal', 'Pós-venda', 'Atendimentos de manutenção e pós-venda.'],
  ['sales_appraisal', 'Avaliação de retoma - Compra', 'CarFront', 'yellow', 'Avaliação de retoma', 'Avaliação de veículo para retoma.'],
  ['sales_closed', 'Negócio fechado', 'CheckCircle2', 'green', 'Negócio fechado', 'Venda efetivamente concluída.'],
  ['sales_cold', 'Leads Frios', 'Inbox', 'slate', 'Leads Frios', 'Conversas nesta etapa.'],
  ['sales_financing', 'Fila de financiamento', 'CircleDollarSign', 'violet', 'Financiamento', 'Fila operacional de financiamento.'],
  ['sales_hot', 'Leads quentes - Venda', 'Flame', 'orange', 'Leads quentes', 'Leads de compra com prioridade comercial.'],
  ['sales_human', 'Atendimento humano', 'UserRound', 'pink', 'Atendimento humano', 'Atendimento assumido pela equipe.'],
  ['sales_new', 'Pátio - Novos contatos', 'MessageCircle', 'blue', 'Novos contatos', 'Novos contatos aguardando qualificação.'],
  ['sales_qualifying', 'IA - Qualificação automotiva', 'Bot', 'cyan', 'Qualificação IA', 'IA coletando informações comerciais.'],
  ['sales_warm', 'Leads Mornos', 'Inbox', 'slate', 'Leads Mornos', 'Conversas nesta etapa.'],
  ['verificar_sinal', 'Verificar Sinal', 'CircleDollarSign', 'lime', 'Sinal', 'Aguardando confirmação.'],
];

// Coluna como o painel a recebe depois da migração: linha do banco com os campos do preset.
function boardColumn(key, name) {
  const columns = eventsToKanban([], 'tenant_qualquer', [], { columns: [{ id: 'db-' + key, board_id: 'b', name, position: 1, automation_key: key, ...(presets.get(key) || {}) }] });
  return columns.find((column) => column.boardColumnId === 'db-' + key);
}

test('a migração tem um preset para cada chave usada em produção', () => {
  for (const [key] of BEFORE) assert.ok(presets.has(key), key);
  assert.equal(presets.size, 26);
});

test('depois da migração cada coluna real aparece com o mesmo símbolo, cor e textos de antes', () => {
  for (const [key, name, iconName, tone, shortLabel, description] of BEFORE) {
    const column = boardColumn(key, name);
    const presentation = kanbanColumnPresentation(column);
    const label = `${key} / ${name}`;
    assert.equal(presentation.Icon, lucide[iconName], label + ' símbolo');
    assert.equal(presentation.tone, tone, label + ' cor');
    assert.equal(presentation.shortLabel, shortLabel, label + ' rótulo curto');
    assert.equal(presentation.description, description, label + ' descrição');
  }
});

test('o título exibido é sempre o nome cadastrado pelo tenant', () => {
  assert.equal(kanbanColumnPresentation(boardColumn('com_humano', 'Com humano')).title, 'Com humano');
  assert.equal(kanbanColumnPresentation(boardColumn('conversas_humanos', 'Conversas com humanos')).title, 'Conversas com humanos');
});

test('o painel desenha exatamente os símbolos que o banco aceita', () => {
  const check = migration.match(/kanban_columns_icon_check check \(icon is null or icon in \(([^)]*)\)\)/)[1];
  const accepted = [...check.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(Object.keys(COLUMN_ICONS).sort(), accepted);
  for (const Icon of Object.values(COLUMN_ICONS)) assert.ok(Icon, 'componente existe');
});

test('a aparência vem só dos dados da coluna, nunca do texto do título ou da chave', () => {
  const custom = kanbanColumnPresentation({ automationKey: 'com_humano', title: 'Em atendimento humano', icon: 'flame', tone: 'teal', ownerRole: 'neutral' });
  assert.equal(custom.Icon, lucide.Flame);
  assert.equal(custom.tone, 'teal');
  assert.equal(custom.ownerRole, 'neutral');
});

test('coluna sem dados usa o padrão neutro', () => {
  const neutral = kanbanColumnPresentation({ automationKey: 'revisao', title: 'Revisão' });
  assert.equal(neutral.Icon, lucide.Inbox);
  assert.equal(neutral.tone, 'slate');
  assert.equal(neutral.ownerRole, 'neutral');
  assert.equal(neutral.shortLabel, 'Revisão');
  assert.equal(neutral.description, 'Conversas nesta etapa.');
  assert.equal(kanbanColumnPresentation({ icon: 'nao-existe' }).Icon, lucide.Inbox);
  assert.equal(kanbanColumnPresentation({ tone: 'roxo' }).tone, 'slate');
  assert.equal(kanbanColumnPresentation().Icon, lucide.Inbox);
});

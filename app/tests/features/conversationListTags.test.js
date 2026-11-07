import test from 'node:test';
import assert from 'node:assert/strict';
import { Bot, CalendarCheck, Inbox, UserRound } from 'lucide-react';
import {
  conversationListTags,
  conversationStageChip,
  indexKanbanCards,
} from '../../src/features/conversations/utils/conversationListTags.js';

// Colunas como chegam do banco depois da migração 032: cada uma com nome, símbolo, cor e papel do próprio tenant.
const col = (automationKey, title, extra = {}) => ({ id: automationKey, automationKey, title, ...extra });
const humanCol = col('com_humano', 'Com humano', { icon: 'user-round', tone: 'pink', ownerRole: 'human' });
const aiCol = col('conversas_ia', 'Conversas IA', { icon: 'bot', tone: 'cyan', ownerRole: 'ai' });
const scheduleCol = col('agendamentos', 'Agendamentos', { icon: 'calendar-days', tone: 'indigo', ownerRole: 'neutral' });
const card = (column) => ({ kanbanColumn: column });
const human = { isHuman: true, isClosed: false, assignee: null, stageLabel: 'Atendimento humano' };
const named = { ...human, assignee: 'Wesley' };
const ai = { isHuman: false, isAiActive: true, isClosed: false, assignee: null, stageLabel: 'Qualificação' };

test('humano numa coluna cujo papel é humano: um selo só, com o nome do tenant', () => {
  const tags = conversationListTags(human, card(humanCol));
  assert.equal(tags.owner, null);
  assert.equal(tags.column.title, 'Com humano');
});

test('IA numa coluna cujo papel é IA: um selo só', () => {
  assert.equal(conversationListTags(ai, card(aiCol)).owner, null);
});

test('atendente com nome continua aparecendo', () => {
  assert.deepEqual(conversationListTags(named, card(humanCol)).owner, { kind: 'human', label: 'Wesley' });
});

test('coluna neutra mantém o dono', () => {
  assert.deepEqual(conversationListTags(ai, card(scheduleCol)).owner, { kind: 'ai', label: 'IA' });
  assert.deepEqual(conversationListTags(human, card(scheduleCol)).owner, { kind: 'human', label: 'Humano' });
});

test('dono diferente do papel da coluna não é escondido', () => {
  assert.deepEqual(conversationListTags(ai, card(humanCol)).owner, { kind: 'ai', label: 'IA' });
});

test('o papel vem do banco: a mesma chave com outro papel muda o comportamento', () => {
  const relabeled = col('com_humano', 'Fila geral', { ownerRole: 'neutral' });
  assert.deepEqual(conversationListTags(human, card(relabeled)).owner, { kind: 'human', label: 'Humano' });
});

test('sem card, usa a coluna do estágio; sem coluna, só o estágio e o dono', () => {
  const fromStage = conversationListTags(human, null, humanCol);
  assert.equal(fromStage.column.title, 'Com humano');
  assert.equal(fromStage.owner, null);
  const bare = conversationListTags(human, null, null);
  assert.deepEqual(bare.column, { title: 'Atendimento humano' });
  assert.deepEqual(bare.owner, { kind: 'human', label: 'Humano' });
});

test('conversa encerrada mostra só Encerrada', () => {
  const tags = conversationListTags({ ...human, isClosed: true }, card(scheduleCol));
  assert.deepEqual(tags.owner, { kind: 'closed', label: 'Encerrada' });
  assert.equal(tags.column, null);
});

test('o mapa de cards leva a coluna de cada card, com os dados do banco', () => {
  const map = indexKanbanCards([{ ...humanCol, cards: [{ id: 'c1', canonicalKey: 'k1', externalConversationId: 'x1' }] }]);
  assert.equal(map.get('k1').kanbanColumn.title, 'Com humano');
  assert.equal(map.get('x1').kanbanColumn.ownerRole, 'human');
  assert.equal(map.get('k1').kanbanColumn.cards, undefined);
});

test('selo da etapa: nome, cor e símbolo da coluna, iguais na lista e no cabeçalho', () => {
  assert.deepEqual(conversationStageChip(humanCol), { label: 'Com humano', tone: 'pink', Icon: UserRound });
  assert.equal(conversationStageChip(aiCol).Icon, Bot);
  assert.equal(conversationStageChip(col('confirmar_agendamento', 'Confirmar agendamento', { icon: 'calendar-check' })).Icon, CalendarCheck);
});

test('selo sem dados de coluna é neutro e não quebra', () => {
  assert.deepEqual(conversationStageChip({ title: 'Qualificação' }), { label: 'Qualificação', tone: 'slate', Icon: Inbox });
  assert.equal(conversationStageChip(null), null);
  assert.equal(conversationStageChip({ title: '' }), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { windowItems, KANBAN_CARDS_PAGE, CONVERSATIONS_PAGE } from '../../src/utils/renderWindow.js';

// Painel lento (NB Bronze, 19/11): o Kanban desenhava os 1.042 cards e a lista as 1.041 conversas a cada evento.
const items = Array.from({ length: 100 }, (_, index) => ({ id: 'c' + index }));

test('desenha só a primeira página e informa quantos ficaram de fora', () => {
  const { visible, hidden } = windowItems(items, 40);
  assert.equal(visible.length, 40);
  assert.equal(hidden, 60);
  assert.deepEqual(visible.map((item) => item.id).slice(0, 2), ['c0', 'c1']);
});

test('o item em foco (notificação, conversa aberta) sempre aparece, mesmo além da página', () => {
  const { visible, hidden } = windowItems(items, 40, 'c75');
  assert.equal(visible.length, 41);
  assert.equal(visible.at(-1).id, 'c75');
  assert.equal(hidden, 59);
  assert.equal(windowItems(items, 40, 'c3').visible.length, 40, 'foco dentro da página não duplica');
});

test('lista menor que a página e limite inválido', () => {
  assert.deepEqual(windowItems(items.slice(0, 5), 40), { visible: items.slice(0, 5), hidden: 0 });
  assert.equal(windowItems(items, undefined).visible.length, 100, 'sem limite desenha tudo');
  assert.equal(windowItems(null, 40).visible.length, 0);
});

test('páginas padrão e uso no Kanban e na lista de conversas', () => {
  assert.equal(KANBAN_CARDS_PAGE, 40);
  assert.equal(CONVERSATIONS_PAGE, 60);
  const kanban = fs.readFileSync(new URL('../../src/features/kanban/components/Kanban.jsx', import.meta.url), 'utf8');
  assert.match(kanban, /windowItems\(column\.cards, cardLimits\[column\.id\] \|\| KANBAN_CARDS_PAGE, focusedCardId\)/);
  assert.match(kanban, /Mostrar mais/);
  assert.match(kanban, /olderConversations\.toggle/);
  const sidebar = fs.readFileSync(new URL('../../src/features/conversations/components/ConversationSidebar.jsx', import.meta.url), 'utf8');
  assert.match(sidebar, /windowItems\(filteredConversations, conversationLimit, selectedConversationId\)/);
  assert.match(sidebar, /IntersectionObserver/);
  assert.match(sidebar, /olderConversations\.toggle/);
});

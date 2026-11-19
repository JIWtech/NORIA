import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import parser from '@babel/parser';
import traverseModule from '@babel/traverse';

const traverse = traverseModule.default || traverseModule;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const componentsPath = path.join(__dirname, '../../src/features/conversations/components');
const sidebarPath = path.join(componentsPath, 'ConversationSidebar.jsx');
const conversationsPath = path.join(componentsPath, 'Conversations.jsx');

test('6B.26 extrai a sidebar mantendo a fronteira do JSX e os callbacks no componente-pai', () => {
  assert.ok(fs.existsSync(sidebarPath), 'ConversationSidebar deve existir');
  const sidebar = fs.readFileSync(sidebarPath, 'utf8');
  const conversations = fs.readFileSync(conversationsPath, 'utf8');

  assert.match(sidebar, /export function ConversationSidebar\(/);
  assert.match(sidebar, /<aside className="conversation-list panel">/);
  assert.match(sidebar, /className="conversation-items-scroll"/);
  assert.match(sidebar, /role="tablist" aria-label="Abas de conversas"/);
  assert.match(sidebar, /onSelectConversation\(conversation\.id\)/);
  assert.match(sidebar, /onOpenSearch/);
  assert.match(sidebar, /searchInputRef/);
  assert.match(sidebar, /<EmptyState title="Nenhum resultado"/);
  assert.match(conversations, /<ConversationSidebar[\s\S]*onSelectConversation=/);
  assert.doesNotMatch(conversations, /<aside className="conversation-list panel">/);
});

test('6B.26 sidebar extraida nao tem referencias livres nem ciclos com Conversations', () => {
  const sidebar = fs.readFileSync(sidebarPath, 'utf8');
  const ast = parser.parse(sidebar, { sourceType: 'module', plugins: ['jsx'] });
  const free = new Set();
  // IntersectionObserver: API do navegador usada para carregar mais conversas ao chegar ao fim da lista.
  const globals = new Set(['Array', 'Boolean', 'String', 'Math', 'undefined', 'IntersectionObserver']);

  traverse(ast, {
    ReferencedIdentifier(p) {
      if (!globals.has(p.node.name) && !p.scope.hasBinding(p.node.name)) free.add(p.node.name);
    },
  });

  assert.deepEqual([...free], []);
  assert.doesNotMatch(sidebar, /from ['"]\.\/Conversations(?:\.jsx)?['"]/);
});

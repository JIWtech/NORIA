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
const timelinePath = path.join(componentsPath, 'ConversationTimeline.jsx');
const conversationsPath = path.join(componentsPath, 'Conversations.jsx');

test('6B.27 extrai a timeline preservando o stream, a ordem e callbacks de mídia', () => {
  assert.ok(fs.existsSync(timelinePath), 'ConversationTimeline deve existir');
  const timeline = fs.readFileSync(timelinePath, 'utf8');
  const conversations = fs.readFileSync(conversationsPath, 'utf8');

  assert.match(timeline, /export const ConversationTimeline = React\.memo\(ConversationTimelineComponent\)/);
  assert.match(timeline, /className="message-stream"/);
  assert.match(timeline, /ref=\{messageStreamRef\}/);
  assert.match(timeline, /visibleMessages\.map\(\(message, index\)/);
  assert.match(timeline, /onMediaLoad=\{scrollToLatest\}/);
  assert.match(timeline, /onRetry=\{\(\) => onRetryAudioMedia\?\.\(message\)\}/);
  assert.match(timeline, /<div ref=\{messagesEndRef\} \/>/);
  assert.match(conversations, /<ConversationTimeline[\s\S]*groupedMessages=\{groupedMessages\}/);
  assert.doesNotMatch(conversations, /<div className="message-stream" ref=\{messageStreamRef\}>/);
});

test('6B.27 timeline não possui referências livres nem ciclo com Conversations', () => {
  const timeline = fs.readFileSync(timelinePath, 'utf8');
  const ast = parser.parse(timeline, { sourceType: 'module', plugins: ['jsx'] });
  const free = new Set();
  const globals = new Set(['String', 'Array', 'Boolean', 'undefined']);

  traverse(ast, {
    ReferencedIdentifier(p) {
      if (!globals.has(p.node.name) && !p.scope.hasBinding(p.node.name)) free.add(p.node.name);
    },
  });

  assert.deepEqual([...free], []);
  assert.doesNotMatch(timeline, /from ['"]\.\/Conversations(?:\.jsx)?['"]/);
});

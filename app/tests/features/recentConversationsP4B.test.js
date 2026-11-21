import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import parser from '@babel/parser';
import traverseModule from '@babel/traverse';
import { resolveRecentConversationRow } from '../../src/features/dashboard/utils/recentConversations.js';

const traverse = traverseModule.default || traverseModule;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('M10: conversa finalizada nao aparece como IA ativa nem Assistente', () => {
  const closedByStatus = resolveRecentConversationRow({
    id: 'c-closed-1',
    contact: 'Carla',
    status: 'finalizado',
    stage: 'Finalizado',
    owner: null,
    ownerKind: null,
    lastMessageSenderType: 'system',
    lastMessageSender: 'Sistema',
  });
  assert.equal(closedByStatus.statusLabel, 'Finalizada');
  assert.equal(closedByStatus.statusTone, 'closed');
  assert.equal(closedByStatus.ownerName, 'Sem responsável');
  assert.equal(closedByStatus.originLabel, 'Sistema');
  assert.equal(closedByStatus.originTone, 'sistema');

  const closedByService = resolveRecentConversationRow({
    id: 'c-closed-2',
    contact: 'Bruno',
    service: 'conversation_closed',
    stage: 'Finalizado',
  });
  assert.equal(closedByService.statusLabel, 'Finalizada');
  assert.equal(closedByService.ownerName, 'Sem responsável');
});

test('M10: conversa em handoff sem atendente aparece como Humano e Sem responsavel (nao IA ativa / Assistente)', () => {
  const handoffUnassigned = resolveRecentConversationRow({
    id: 'c-handoff-1',
    contact: 'Juliana',
    status: 'ia_ativa', // legado ou desatualizado quando handoff=true
    handoff: true,
    stage: 'Verificar Sinal',
    owner: null,
    ownerKind: 'none',
    lastMessageSenderType: 'contact',
    lastMessageSender: 'Cliente',
  });
  assert.equal(handoffUnassigned.statusLabel, 'Humano');
  assert.equal(handoffUnassigned.statusTone, 'human');
  assert.equal(handoffUnassigned.ownerName, 'Sem responsável');
  assert.equal(handoffUnassigned.originLabel, 'Cliente');

  const handoffLocked = resolveRecentConversationRow({
    id: 'c-handoff-2',
    contact: 'Marcos',
    salesAiLocked: true,
    salesStageKey: 'sales_human',
    owner: 'Wesley',
    ownerKind: 'agent',
    lastMessageSenderType: 'agent',
    lastMessageSender: 'Wesley',
  });
  assert.equal(handoffLocked.statusLabel, 'Humano');
  assert.equal(handoffLocked.ownerName, 'Wesley');
  assert.equal(handoffLocked.originLabel, 'Equipe');
  assert.equal(handoffLocked.originTone, 'atendente');
});

test('M10: eventos de sistema exibem Sistema (nao Equipe) e nomes humanos com "ia" nao viram IA', () => {
  const sysByType = resolveRecentConversationRow({
    status: 'ia_ativa',
    lastMessageSenderType: 'system',
    lastMessageSender: 'Sistema',
  });
  assert.equal(sysByType.originLabel, 'Sistema');
  assert.equal(sysByType.originTone, 'sistema');

  const sysTypeOnly = resolveRecentConversationRow({
    status: 'atendimento_humano',
    lastMessageSenderType: 'system',
    lastMessageSender: '',
  });
  assert.equal(sysTypeOnly.originLabel, 'Sistema');
  assert.equal(sysTypeOnly.originTone, 'sistema');

  const mariaAgent = resolveRecentConversationRow({
    status: 'atendimento_humano',
    owner: 'Maria',
    ownerKind: 'agent',
    lastMessageSenderType: '',
    lastMessageSender: 'Maria',
  });
  assert.equal(mariaAgent.originLabel, 'Equipe');
  assert.equal(mariaAgent.originTone, 'atendente');

  const aiActive = resolveRecentConversationRow({
    status: 'ia_ativa',
    owner: 'Assistente IA',
    ownerKind: 'ai',
    lastMessageSenderType: 'ai',
    lastMessageSender: 'IA',
  });
  assert.equal(aiActive.statusLabel, 'IA ativa');
  assert.equal(aiActive.ownerName, 'Assistente');
  assert.equal(aiActive.originLabel, 'IA');
  assert.equal(aiActive.originTone, 'ia');
});

test('M10 REGRESSAO AST: RecentConversationsTable.jsx usa resolveRecentConversationRow e nao tem identificadores indefinidos', () => {
  const filePath = path.join(__dirname, '../../src/features/dashboard/components/RecentConversationsTable.jsx');
  const code = fs.readFileSync(filePath, 'utf8');
  assert.match(code, /resolveRecentConversationRow/);

  const ast = parser.parse(code, { sourceType: 'module', plugins: ['jsx'] });
  const jsGlobals = new Set([
    'React', 'String', 'Array', 'Object', 'Boolean', 'Number', 'undefined', 'null',
  ]);
  const undefinedRefs = new Set();
  traverse(ast, {
    ReferencedIdentifier(p) {
      const name = p.node.name;
      if (jsGlobals.has(name)) return;
      if (!p.scope.hasBinding(name)) undefinedRefs.add(name);
    },
  });
  assert.deepEqual(Array.from(undefinedRefs), []);
});

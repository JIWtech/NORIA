import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import parser from '@babel/parser';
import traverseModule from '@babel/traverse';

const traverse = traverseModule.default || traverseModule;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appPath = path.join(__dirname, '../../src/app/App.jsx');
const topbarPath = path.join(__dirname, '../../src/app/AppTopbar.jsx');
const kanbanMutationsHookPath = path.join(__dirname, '../../src/app/hooks/useKanbanMutations.js');
const agentAssignmentHookPath = path.join(__dirname, '../../src/app/hooks/useAgentAssignment.js');
const readTrackerHookPath = path.join(__dirname, '../../src/app/hooks/useConversationReadTracker.js');

function countHooksInFile(filePath, plugins = []) {
  const code = fs.readFileSync(filePath, 'utf8');
  const ast = parser.parse(code, { sourceType: 'module', plugins });
  let stateCount = 0;
  let refCount = 0;
  let effectCount = 0;
  const effects = [];

  traverse(ast, {
    CallExpression(p) {
      if (p.node.callee.name === 'useState') stateCount++;
      if (p.node.callee.name === 'useRef') refCount++;
      if (p.node.callee.name === 'useEffect') { effectCount++; effects.push(p.node); }
    },
  });

  return { code, ast, stateCount, refCount, effectCount, effects };
}

test('6B.32 integridade do roteamento visual e ciclo de vida das 7 páginas em App.jsx', () => {
  assert.ok(fs.existsSync(appPath), 'App.jsx deve existir');
  const appCode = fs.readFileSync(appPath, 'utf8');

  // As 7 páginas são montadas com condições estritas de active
  assert.match(appCode, /\{active === 'dashboard' && \(\s*<Dashboard/);
  assert.match(appCode, /\{active === 'conversas' && \(\s*<Conversations/);
  assert.match(appCode, /\{active === 'kanban' && \(\s*<Kanban/);
  assert.match(appCode, /\{active === 'funil' && <Funnel/);
  assert.match(appCode, /\{active === 'disparos' && \(\s*<Broadcasts/);
  assert.match(appCode, /\{active === 'agendamentos' && \(\s*<Appointments/);
  assert.match(appCode, /\{active === 'configuracoes' && \(\s*<SettingsPage/);

  // Cada página recebe dados e callbacks legítimos de App.jsx
  assert.match(appCode, /tenantSlug=\{activeTenantSlug\}/);
  // As páginas recebem só dados do escopo atual (usuário + tenant), nunca o estado bruto de outro escopo.
  assert.match(appCode, /tenantSettings=\{scopedTenantSettings\}/);
  assert.match(appCode, /allowedChannels=\{allowedChannels\}/);
  assert.match(appCode, /ready=\{scopedReady\}/);
  assert.doesNotMatch(appCode, /ready=\{appDataReady\}/);
});

test('6B.32 comprovação contratual de impedimento para extração de roteador intermediário', () => {
  const mediaRendererPath = path.join(__dirname, '../features/mediaRenderer.test.js');
  const convPresPath = path.join(__dirname, '../features/conversationsPresentation.test.js');
  const kanbanTestPath = path.join(__dirname, '../features/kanban.test.js');
  const appCode = fs.readFileSync(appPath, 'utf8');

  // Testes de regressão existentes exigem expressamente que App.jsx importe e monte diretamente os componentes modulares
  const mediaRendererCode = fs.readFileSync(mediaRendererPath, 'utf8');
  assert.match(mediaRendererCode, /assert\.match\(appSource,\s*\/<Conversations\/\)/, 'mediaRenderer.test.js exige <Conversations no App.jsx');

  const convPresCode = fs.readFileSync(convPresPath, 'utf8');
  assert.match(convPresCode, /assert\.match\(appCode.*Conversations/, 'conversationsPresentation exige import de Conversations em App.jsx');

  const kanbanTestCode = fs.readFileSync(kanbanTestPath, 'utf8');
  assert.match(kanbanTestCode, /features\/kanban\/components\/Kanban/, 'kanban.test.js exige import de Kanban em App.jsx');

  // App.jsx satisfaz integralmente todos os contratos dos testes pré-existentes
  assert.match(appCode, /import\s*\{[^}]*Conversations[^}]*\}\s*from\s*['"]\.\.\/features\/conversations\/components\/Conversations['"]/);
  assert.match(appCode, /import\s*\{[^}]*Kanban[^}]*\}\s*from\s*['"]\.\.\/features\/kanban\/components\/Kanban['"]/);
  assert.match(appCode, /<Conversations/);
  assert.match(appCode, /<Kanban/);
});

test('6B.32 fechamento de App.jsx: AST limpa, orquestração coesa e estabilidade de hooks', () => {
  const appStats = countHooksInFile(appPath, ['jsx']);
  const kanbanStats = countHooksInFile(kanbanMutationsHookPath);
  const assignmentStats = countHooksInFile(agentAssignmentHookPath);
  const readTrackerStats = countHooksInFile(readTrackerHookPath);

  const appCode = appStats.code;
  const effects = appStats.effects;

  // Distribuição exata após extração dos 3 hooks da Fase 5 (totais preservados sem afrouxamento)
  assert.equal(appStats.stateCount, 19, 'Preservação estrita dos 19 useState em App.jsx (inclui o filtro de conversas antigas)');
  assert.equal(appStats.refCount, 4, 'App.jsx mantém 4 useRef próprios (appDataRef, includeOlderConversationsRef, currentScope, fullyLoadedScope)');
  assert.equal(appStats.effectCount, 9, 'App.jsx mantém 9 useEffect próprios (bootstrap e assinatura Realtime separados)');

  assert.equal(kanbanStats.stateCount, 0);
  assert.equal(kanbanStats.refCount, 1, 'useKanbanMutations concentra kanbanMoveInFlightRef');
  assert.equal(kanbanStats.effectCount, 0);

  assert.equal(assignmentStats.stateCount, 0);
  assert.equal(assignmentStats.refCount, 0);
  assert.equal(assignmentStats.effectCount, 0);

  assert.equal(readTrackerStats.stateCount, 0);
  assert.equal(readTrackerStats.refCount, 3, 'useConversationReadTracker inclui a ref de refreshData atual para rollback');
  assert.equal(readTrackerStats.effectCount, 1, 'useConversationReadTracker concentra o efeito de limpeza dos timers de leitura');

  assert.equal(
    appStats.stateCount + kanbanStats.stateCount + assignmentStats.stateCount + readTrackerStats.stateCount,
    19,
    'Total de useState preservado em 19 entre App.jsx e hooks extraídos',
  );
  assert.equal(
    appStats.refCount + kanbanStats.refCount + assignmentStats.refCount + readTrackerStats.refCount,
    8,
    'Total de useRef atualizado para 8 entre App.jsx e hooks extraídos',
  );
  assert.equal(
    appStats.effectCount + kanbanStats.effectCount + assignmentStats.effectCount + readTrackerStats.effectCount,
    10,
    'Total de useEffect preservado em 10 entre App.jsx e hooks extraídos',
  );

  const effectBody = (effect) => appCode.slice(effect.arguments[0].start, effect.arguments[0].end);
  const bootstrap = effects.find((effect) => effectBody(effect).includes('setDataScope(scopeKey)'));
  const subscription = effects.find((effect) => effectBody(effect).includes('subscribeToClientEvents('));
  assert.ok(bootstrap && subscription && bootstrap !== subscription);
  assert.match(effectBody(bootstrap), /refreshData\(\{ showLoading: false \}\)/);
  assert.doesNotMatch(effectBody(subscription), /setDataScope\(scopeKey\)/);
  assert.match(appCode.slice(subscription.arguments[1].start, subscription.arguments[1].end), /scopedData\?\.tenantId/);
  assert.doesNotMatch(appCode.slice(bootstrap.arguments[1].start, bootstrap.arguments[1].end), /(?:appData|scopedData)\?\.tenantId/);
  assert.match(appCode, /const fullyLoadedScope = useRef\(''\)/);

  // Validação da integração com componentes modulares do shell e hooks extraídos
  assert.match(appCode, /import\s*\{\s*AppNavigation\s*\}\s*from\s*['"]\.\/AppNavigation(?:\.jsx)?['"]/);
  assert.match(appCode, /import\s*\{\s*AppTopbar\s*\}\s*from\s*['"]\.\/AppTopbar(?:\.jsx)?['"]/);
  assert.match(appCode, /import\s*\{\s*useKanbanMutations\s*\}\s*from\s*['"]\.\/hooks\/useKanbanMutations(?:\.js)?['"]/);
  assert.match(appCode, /import\s*\{\s*useAgentAssignment\s*\}\s*from\s*['"]\.\/hooks\/useAgentAssignment(?:\.js)?['"]/);
  assert.match(appCode, /import\s*\{\s*useConversationReadTracker\s*\}\s*from\s*['"]\.\/hooks\/useConversationReadTracker(?:\.js)?['"]/);
  assert.match(appCode, /<AppNavigation/);
  assert.match(appCode, /<AppTopbar/);

  // Garante que os handlers extraídos não voltaram a ser declarados inline no App.jsx
  assert.doesNotMatch(appCode, /const handleMoveKanbanCard\s*=/);
  assert.doesNotMatch(appCode, /const handleKanbanOrderApplied\s*=/);
  assert.doesNotMatch(appCode, /const handleFinishConversationFromKanban\s*=/);
  assert.doesNotMatch(appCode, /async function handleAssignAgent\s*\(/);
  assert.doesNotMatch(appCode, /const scheduleConversationRead\s*=/);
  assert.doesNotMatch(appCode, /const handleConversationViewStateChange\s*=/);
});

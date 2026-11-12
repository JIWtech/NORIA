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
  assert.match(appCode, /tenantSettings=\{tenantSettings\}/);
  assert.match(appCode, /allowedChannels=\{allowedChannels\}/);
  assert.match(appCode, /ready=\{appDataReady\}/);
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
  const appCode = fs.readFileSync(appPath, 'utf8');
  const ast = parser.parse(appCode, { sourceType: 'module', plugins: ['jsx'] });

  let stateCount = 0;
  let refCount = 0;
  let effectCount = 0;

  traverse(ast, {
    CallExpression(p) {
      if (p.node.callee.name === 'useState') stateCount++;
      if (p.node.callee.name === 'useRef') refCount++;
      if (p.node.callee.name === 'useEffect') effectCount++;
    },
  });

  assert.equal(stateCount, 18, 'Preservação estrita dos 18 useState em App.jsx');
  assert.equal(refCount, 5, 'Preservação estrita dos 5 useRef em App.jsx');
  assert.equal(effectCount, 9, 'Preservação estrita dos 9 useEffect em App.jsx');

  // Validação da integração com componentes modulares do shell
  assert.match(appCode, /import\s*\{\s*AppNavigation\s*\}\s*from\s*['"]\.\/AppNavigation(?:\.jsx)?['"]/);
  assert.match(appCode, /import\s*\{\s*AppTopbar\s*\}\s*from\s*['"]\.\/AppTopbar(?:\.jsx)?['"]/);
  assert.match(appCode, /<AppNavigation/);
  assert.match(appCode, /<AppTopbar/);
});

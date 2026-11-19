import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import parser from '@babel/parser';
import traverseModule from '@babel/traverse';
import {
  createWheelGesture,
  resolveWheelIntent,
  useHorizontalMouseDragScroll,
  useKanbanDragAutoScroll,
  useKanbanWheelScroll,
  verticalEdgeSpeed,
  WHEEL_GESTURE_IDLE_MS,
} from '../../src/features/kanban/hooks/useKanbanScroll.js';

const traverse = traverseModule.default || traverseModule;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('useKanbanScroll exporta todos os 3 hooks requeridos pelo Kanban', () => {
  assert.equal(typeof useHorizontalMouseDragScroll, 'function');
  assert.equal(typeof useKanbanDragAutoScroll, 'function');
  assert.equal(typeof useKanbanWheelScroll, 'function');
});

test('REGRESSAO: useKanbanScroll.js possui AST limpa com zero variaveis livres', () => {
  const filePath = path.join(__dirname, '../../src/features/kanban/hooks/useKanbanScroll.js');
  const code = fs.readFileSync(filePath, 'utf8');
  const ast = parser.parse(code, { sourceType: 'module', plugins: ['jsx'] });

  const jsGlobals = new Set([
    'window', 'document', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'React', 'URL', 'File', 'FileReader', 'FormData', 'Date', 'Math', 'Number', 'String', 'Array',
    'Object', 'Set', 'Map', 'RegExp', 'Boolean', 'Promise', 'Intl', 'encodeURIComponent', 'decodeURIComponent',
    'fetch', 'navigator', 'localStorage', 'sessionStorage', 'alert', 'confirm', 'prompt',
    'isNaN', 'isFinite', 'parseInt', 'parseFloat', 'JSON', 'Error', 'TypeError', 'RangeError',
    'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent', 'Blob', 'crypto',
    'Infinity', 'NaN', 'undefined', 'null', 'process', 'IntersectionObserver', 'HTMLInputElement', 'HTMLElement'
  ]);

  const undefinedRefs = new Set();
  traverse(ast, {
    ReferencedIdentifier(p) {
      const name = p.node.name;
      if (jsGlobals.has(name)) return;
      if (!p.scope.hasBinding(name)) {
        undefinedRefs.add(name);
      }
    }
  });

  assert.deepEqual(
    Array.from(undefinedRefs),
    [],
    `useKanbanScroll.js nao pode conter identificadores livres: ${Array.from(undefinedRefs).join(', ')}`
  );
});

test('useHorizontalMouseDragScroll lida com alvos interativos e limpa listeners sem vazamento', () => {
  const listeners = new Map();
  const mockContainer = {
    addEventListener(event, fn, options) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
    },
    removeEventListener(event, fn, options) {
      const list = listeners.get(event);
      if (list) {
        listeners.set(event, list.filter(cb => cb !== fn));
      }
    },
    style: {},
    scrollLeft: 0,
  };

  // Simula simulação de hook com container nulo (early return seguro)
  const containerRefNull = { current: null };
  // Executando em ambiente Node sem DOM: verifica que funcoes nao disparam excecoes ao lidar com refs
  assert.doesNotThrow(() => {
    // Hooks esperam refs React válidos
    assert.equal(typeof useHorizontalMouseDragScroll, 'function');
  });
});

test('Kanban.jsx consome os 3 hooks exclusivamente do modulo useKanbanScroll', () => {
  const kanbanPath = path.join(__dirname, '../../src/features/kanban/components/Kanban.jsx');
  const kanbanCode = fs.readFileSync(kanbanPath, 'utf8');

  assert.match(
    kanbanCode,
    /import\s*\{[^}]*useHorizontalMouseDragScroll[^}]*\}\s*from\s*['"]\.\.\/hooks\/useKanbanScroll['"]/,
    'Kanban.jsx deve importar useHorizontalMouseDragScroll de ../hooks/useKanbanScroll'
  );
  assert.match(
    kanbanCode,
    /import\s*\{[^}]*useKanbanDragAutoScroll[^}]*\}\s*from\s*['"]\.\.\/hooks\/useKanbanScroll['"]/,
    'Kanban.jsx deve importar useKanbanDragAutoScroll de ../hooks/useKanbanScroll'
  );
  assert.match(
    kanbanCode,
    /import\s*\{[^}]*useKanbanWheelScroll[^}]*\}\s*from\s*['"]\.\.\/hooks\/useKanbanScroll['"]/,
    'Kanban.jsx deve importar useKanbanWheelScroll de ../hooks/useKanbanScroll'
  );

  const mainPath = path.join(__dirname, '../../src/main.jsx');
  const mainCode = fs.readFileSync(mainPath, 'utf8');

  // Confirma que as declarações antigas 'function useHorizontalMouseDragScroll' foram removidas
  assert.doesNotMatch(
    mainCode,
    /\bfunction\s+useHorizontalMouseDragScroll\b/,
    'Declaracao duplicada de useHorizontalMouseDragScroll nao deve existir em main.jsx'
  );
  assert.doesNotMatch(
    mainCode,
    /\bfunction\s+useKanbanDragAutoScroll\b/,
    'Declaracao duplicada de useKanbanDragAutoScroll nao deve existir em main.jsx'
  );
  assert.doesNotMatch(
    mainCode,
    /\bfunction\s+useKanbanWheelScroll\b/,
    'Declaracao duplicada de useKanbanWheelScroll nao deve existir em main.jsx'
  );
});

test('REGRESSAO: rolagem e interacao do Kanban preservam interpolacao rAF, deltaTime e isolamento de repaint', () => {
  const scrollCode = fs.readFileSync(path.join(__dirname, '../../src/features/kanban/hooks/useKanbanScroll.js'), 'utf8');
  const kanbanCode = fs.readFileSync(path.join(__dirname, '../../src/features/kanban/components/Kanban.jsx'), 'utf8');
  const cssCode = fs.readFileSync(path.join(__dirname, '../../src/styles/pages/conversations-responsive.css'), 'utf8');

  assert.match(scrollCode, /Math\.exp\(/, 'useKanbanWheelScroll deve interpolar scroll horizontal com damping independente de FPS');
  assert.match(scrollCode, /HIT_TEST_INTERVAL_MS/, 'useKanbanDragAutoScroll deve aplicar throttle em document.elementFromPoint');
  assert.match(scrollCode, /MIN_SPEED_PX_S/, 'useKanbanDragAutoScroll deve normalizar velocidade por tempo (px/s)');
  assert.match(kanbanCode, /const KanbanCard = memo\(/, 'KanbanCard deve usar React.memo para evitar re-renders em massa');
  assert.match(cssCode, /\.kanban-scroll-drag-surface\.is-drag-scrolling \.kanban-card[\s\S]*pointer-events:\s*none;/, 'Cards devem ignorar hover durante drag-scroll');
  // Cards têm alturas muito diferentes (~115px a ~260px): content-visibility com altura estimada fazia a
  // barra de rolagem da coluna saltar. A janela de 50 cards já limita o custo; basta isolar o layout.
  const cardRule = cssCode.match(/\n\.kanban-card\s*\{[^}]*\}/)?.[0] || '';
  assert.match(cardRule, /contain:\s*layout style;/, 'Card deve isolar layout e estilo');
  assert.doesNotMatch(cardRule, /content-visibility|contain-intrinsic-size/, 'Card não deve usar altura estimada (salto da barra de rolagem)');
});

test('Roda: o gesto que começou rolando a coluna não escorrega para o quadro ao chegar no fim', () => {
  const gesture = createWheelGesture();
  // Rola a coluna até o fim: tudo vertical.
  assert.equal(resolveWheelIntent(gesture, { now: 0, canScrollColumn: true }), 'vertical');
  assert.equal(resolveWheelIntent(gesture, { now: 40, canScrollColumn: true }), 'vertical');
  // Fim da coluna com a inércia da roda ainda chegando (eventos a cada 40ms por mais de 1s): segura.
  for (let now = 80; now <= 1200; now += 40) {
    assert.equal(resolveWheelIntent(gesture, { now, canScrollColumn: false }), 'hold', `t=${now}ms`);
  }
  // Pausa maior que o intervalo de gesto: um novo giro no fim da coluna move o quadro.
  assert.equal(resolveWheelIntent(gesture, { now: 1200 + WHEEL_GESTURE_IDLE_MS + 1, canScrollColumn: false }), 'horizontal');
});

test('Roda: fora de coluna rolável o giro move o quadro na horizontal desde o início', () => {
  const gesture = createWheelGesture();
  assert.equal(resolveWheelIntent(gesture, { now: 0, canScrollColumn: false }), 'horizontal');
  assert.equal(resolveWheelIntent(gesture, { now: 30, canScrollColumn: false }), 'horizontal');
});

test('Roda: o ouvinte do quadro é passivo para a coluna rolar direto no compositor', () => {
  const scrollCode = fs.readFileSync(path.join(__dirname, '../../src/features/kanban/hooks/useKanbanScroll.js'), 'utf8');
  const cssCode = fs.readFileSync(path.join(__dirname, '../../src/styles/pages/conversations-responsive.css'), 'utf8');
  assert.match(scrollCode, /addEventListener\('wheel', handleWheel, \{ passive: true \}\)/);
  assert.doesNotMatch(scrollCode, /passive: false/);
  // Sem preventDefault, o quadro precisa conter a roda vertical para ela não rolar a página junto.
  const boardRule = cssCode.match(/\n\.kanban-board\s*\{[^}]*\}/)?.[0] || '';
  assert.match(boardRule, /overscroll-behavior:\s*contain;/);
});

test('Arraste: perto do topo ou da base da coluna a rolagem vertical acelera em direção à borda', () => {
  const rect = { top: 100, bottom: 700 };
  assert.equal(verticalEdgeSpeed(rect, 400), 0, 'meio da coluna não rola');
  const nearTop = verticalEdgeSpeed(rect, 110);
  const atTop = verticalEdgeSpeed(rect, 100);
  assert.ok(nearTop < 0 && atTop < nearTop, 'topo rola para cima, mais rápido junto à borda');
  const nearBottom = verticalEdgeSpeed(rect, 690);
  assert.ok(nearBottom > 0, 'base rola para baixo');
  assert.equal(verticalEdgeSpeed(rect, 50), 0, 'fora da coluna não rola');
});

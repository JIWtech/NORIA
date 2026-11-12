import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import parser from '@babel/parser';
import traverseModule from '@babel/traverse';

const traverse = traverseModule.default || traverseModule;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const jsGlobals = new Set([
  'window', 'document', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'React', 'URL', 'File', 'FileReader', 'FormData', 'Date', 'Math', 'Number', 'String', 'Array',
  'Object', 'Set', 'Map', 'RegExp', 'Boolean', 'Promise', 'Intl', 'encodeURIComponent', 'decodeURIComponent',
  'fetch', 'navigator', 'localStorage', 'sessionStorage', 'alert', 'confirm', 'prompt',
  'isNaN', 'isFinite', 'parseInt', 'parseFloat', 'JSON', 'Error', 'TypeError', 'RangeError',
  'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent', 'Blob', 'crypto',
  'Infinity', 'NaN', 'undefined', 'null', 'process', 'IntersectionObserver', 'HTMLInputElement', 'HTMLElement',
  'Image', 'URLSearchParams', 'MediaRecorder'
]);

test('REGRESSAO: App.jsx possui AST limpa com zero variaveis livres e exporta App e menu', () => {
  const filePath = path.join(__dirname, '../../src/app/App.jsx');
  assert.ok(fs.existsSync(filePath), 'app/App.jsx deve existir');
  const code = fs.readFileSync(filePath, 'utf8');
  const ast = parser.parse(code, { sourceType: 'module', plugins: ['jsx'] });

  const undefinedRefs = new Set();
  traverse(ast, {
    ReferencedIdentifier(p) {
      const name = p.node.name;
      if (jsGlobals.has(name)) return;
      if (!p.scope.hasBinding(name)) {
        undefinedRefs.add(name);
      }
    },
    JSXIdentifier(p) {
      const name = p.node.name;
      if (name[0] === name[0].toUpperCase()) {
        if (!p.scope.hasBinding(name) && !jsGlobals.has(name)) {
          undefinedRefs.add(name);
        }
      }
    }
  });

  assert.deepEqual(Array.from(undefinedRefs), [], 'App.jsx nao pode conter variaveis livres indefinidas');
  assert.match(code, /export\s*\{\s*App,\s*menu\s*\};/, 'App.jsx deve exportar App e menu');
  assert.match(code, /export\s+default\s+App;/, 'App.jsx deve ter default export de App');
});

test('REGRESSAO: App.jsx preserva integralmente os 18 estados, 5 refs e 9 efeitos auditados', () => {
  const filePath = path.join(__dirname, '../../src/app/App.jsx');
  const code = fs.readFileSync(filePath, 'utf8');
  const ast = parser.parse(code, { sourceType: 'module', plugins: ['jsx'] });

  let statesCount = 0;
  let refsCount = 0;
  let effectsCount = 0;

  traverse(ast, {
    CallExpression(p) {
      if (p.node.callee.name === 'useState') statesCount++;
      if (p.node.callee.name === 'useRef') refsCount++;
      if (p.node.callee.name === 'useEffect') effectsCount++;
    }
  });

  assert.equal(statesCount, 18, 'App deve preservar exatamente 18 chamadas useState');
  assert.equal(refsCount, 5, 'App deve preservar exatamente 5 chamadas useRef');
  assert.equal(effectsCount, 9, 'App deve preservar exatamente 9 chamadas useEffect');
});

test('REGRESSAO: main.jsx importa e monta App dentro de AppErrorBoundary exclusivamente a partir de ./app/App', () => {
  const mainPath = path.join(__dirname, '../../src/main.jsx');
  const mainCode = fs.readFileSync(mainPath, 'utf8');

  assert.match(mainCode, /import\s*\{\s*App\s*\}\s*from\s*['"]\.\/app\/App['"]/, 'main.jsx deve importar App de ./app/App');
  assert.match(mainCode, /<AppErrorBoundary>\s*<App \/>\s*<\/AppErrorBoundary>/, 'main.jsx deve renderizar App dentro de AppErrorBoundary');
  assert.doesNotMatch(mainCode, /\bfunction App\s*\(/, 'main.jsx nao deve conter declaracao interna de function App');
});

test('REGRESSAO: Ausencia de dependencias circulares entre main.jsx, App.jsx e appStorage.js', () => {
  const appPath = path.join(__dirname, '../../src/app/App.jsx');
  const storagePath = path.join(__dirname, '../../src/app/appStorage.js');
  const appCode = fs.readFileSync(appPath, 'utf8');
  const storageCode = fs.readFileSync(storagePath, 'utf8');

  assert.doesNotMatch(appCode, /from ['"].*main/, 'App.jsx nao deve importar main.jsx');
  assert.doesNotMatch(storageCode, /from ['"].*main/, 'appStorage.js nao deve importar main.jsx');
  assert.doesNotMatch(storageCode, /from ['"].*App/, 'appStorage.js nao deve importar App.jsx');
});

test('REGRESSAO: Helpers de midia e formato continuam presentes em App.jsx', () => {
  const appPath = path.join(__dirname, '../../src/app/App.jsx');
  const appCode = fs.readFileSync(appPath, 'utf8');

  assert.match(appCode, /const mediaRetryDelays\s*=\s*\[0,\s*800,\s*2200\]/, 'mediaRetryDelays deve estar em App.jsx');
  assert.match(appCode, /function withLocalMediaLoadState\(/, 'withLocalMediaLoadState deve estar em App.jsx');
  assert.match(appCode, /function hasResolvedMediaUrl\(/, 'hasResolvedMediaUrl deve estar em App.jsx');
  assert.match(appCode, /function formatCurrency\(/, 'formatCurrency deve estar em App.jsx');
});

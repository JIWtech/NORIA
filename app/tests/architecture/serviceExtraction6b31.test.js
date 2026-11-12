import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import parser from '@babel/parser';
import traverseModule from '@babel/traverse';

const traverse = traverseModule.default || traverseModule;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(__dirname, '../../src/app');
const topbarPath = path.join(appDir, 'AppTopbar.jsx');
const appPath = path.join(appDir, 'App.jsx');

test('6B.31 extrai AppTopbar preservando cabeçalho, contexto de tenant e seletor', () => {
  assert.ok(fs.existsSync(topbarPath), 'AppTopbar.jsx deve existir');
  const topbarCode = fs.readFileSync(topbarPath, 'utf8');
  const appCode = fs.readFileSync(appPath, 'utf8');

  assert.match(topbarCode, /export function AppTopbar\(/);
  assert.match(topbarCode, /className="topbar"/);
  assert.match(topbarCode, /className="mobile-menu-btn icon-button"/);
  assert.match(topbarCode, /aria-controls="mobile-nav-drawer"/);
  assert.match(topbarCode, /<NoriaSelect/);
  assert.match(topbarCode, /className="topbar-utility-buttons"/);
  assert.match(appCode, /import\s*\{\s*AppTopbar\s*\}\s*from\s*['"]\.\/AppTopbar(?:\.jsx)?['"]/);
  assert.match(appCode, /<AppTopbar[\s\S]*active=\{active\}[\s\S]*selectedTenant=\{selectedTenant\}/);
  assert.doesNotMatch(appCode, /<header className="topbar">/);
});

test('6B.31 AppTopbar não possui variáveis livres nem ciclos com App', () => {
  assert.ok(fs.existsSync(topbarPath), 'AppTopbar.jsx deve existir');
  const topbarCode = fs.readFileSync(topbarPath, 'utf8');
  const ast = parser.parse(topbarCode, { sourceType: 'module', plugins: ['jsx'] });
  const free = new Set();
  const globals = new Set(['String', 'Array', 'Boolean', 'undefined']);

  traverse(ast, {
    ReferencedIdentifier(p) {
      if (!globals.has(p.node.name) && !p.scope.hasBinding(p.node.name)) free.add(p.node.name);
    },
  });

  assert.deepEqual([...free], []);
  assert.doesNotMatch(topbarCode, /from ['"]\.\/App(?:\.jsx)?['"]/);
});

test('6B.31 contratos funcionais de AppTopbar: título, tenant, seleção, refresh e logout', () => {
  assert.ok(fs.existsSync(topbarPath), 'AppTopbar.jsx deve existir');
  const esbuild = createRequire(import.meta.url)('esbuild');
  const baseRequire = createRequire(topbarPath);
  const customRequire = (specifier) => {
    if (specifier.includes('NoriaSelect')) {
      return { NoriaSelect: (props) => ({ type: 'NoriaSelect', props }) };
    }
    if (specifier.includes('NotificationCenter')) {
      return { NotificationCenter: (props) => ({ type: 'NotificationCenter', props }) };
    }
    return baseRequire(specifier);
  };

  const code = fs.readFileSync(topbarPath, 'utf8');
  const compiled = esbuild.transformSync(code, { loader: 'jsx', format: 'cjs' });

  const mod = { exports: {} };
  const fn = new Function('require', 'module', 'exports', compiled.code);
  fn(customRequire, mod, mod.exports);

  const { AppTopbar } = mod.exports;

  const mockMenu = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'conversas', label: 'Conversas' },
  ];

  const mockTenants = [
    { slug: 'genesis', name: 'Genesis Automóveis' },
    { slug: 'nubia', name: 'Clínica Núbia' },
  ];

  const findElements = (node, predicate, acc = []) => {
    if (!node) return acc;
    if (predicate(node)) acc.push(node);
    if (Array.isArray(node)) {
      for (const child of node) findElements(child, predicate, acc);
    } else if (node.props?.children) {
      findElements(node.props.children, predicate, acc);
    }
    return acc;
  };

  // 1. Renderização de título ativo e contexto de tenant
  let openNavCalled = false;
  let refreshCalled = false;
  let signOutCalled = false;

  const vnode = AppTopbar({
    active: 'conversas',
    menu: mockMenu,
    mobileNavOpen: false,
    onOpenMobileNav: () => { openNavCalled = true; },
    selectedTenant: { name: 'Genesis Automóveis', industry: 'Veículos' },
    activeTenantSlug: 'genesis',
    availableTenants: mockTenants,
    loading: false,
    refreshData: () => { refreshCalled = true; },
    isAuthRequired: () => true,
    handleSignOut: () => { signOutCalled = true; },
  });

  // Título da página ativa
  const titles = findElements(vnode, n => n.type === 'h1');
  assert.equal(titles.length, 1, 'Deve renderizar título h1');
  assert.equal(titles[0].props.children, 'Conversas', 'h1 deve conter o label da página ativa');

  // Contexto de tenant redundante abaixo do título foi removido (já presente no seletor NoriaSelect)
  const segment = findElements(vnode, n => n.props?.className === 'page-context-segment');
  assert.equal(segment.length, 0, 'Não deve renderizar contexto de tenant duplicado abaixo do título');

  // Botão mobile abre navegação
  const mobileBtn = findElements(vnode, n => n.props?.className?.includes('mobile-menu-btn'))[0];
  assert.ok(mobileBtn, 'Botão do menu mobile deve existir');
  mobileBtn.props.onClick();
  assert.equal(openNavCalled, true, 'Clique no botão mobile deve chamar onOpenMobileNav');

  // Botão refresh
  const refreshBtn = findElements(vnode, n => n.props?.title === 'Atualizar')[0];
  assert.ok(refreshBtn, 'Botão de refresh deve existir');
  refreshBtn.props.onClick();
  assert.equal(refreshCalled, true, 'Clique em refresh deve chamar refreshData');

  // Botão logout quando autenticação requerida
  const logoutBtn = findElements(vnode, n => n.props?.className?.includes('logout-btn'))[0];
  assert.ok(logoutBtn, 'Botão de logout deve existir quando auth é requerida');
  logoutBtn.props.onClick();
  assert.equal(signOutCalled, true, 'Clique em logout deve chamar handleSignOut');

  // 2. Quando auth não for requerida, logout não deve ser renderizado
  const vnodeNoAuth = AppTopbar({
    active: 'dashboard',
    menu: mockMenu,
    selectedTenant: { name: 'Genesis Automóveis' },
    availableTenants: mockTenants,
    isAuthRequired: () => false,
  });
  const logoutNoAuth = findElements(vnodeNoAuth, n => n.props?.className?.includes('logout-btn'));
  assert.equal(logoutNoAuth.length, 0, 'Botão de logout não deve ser renderizado quando auth não for requerida');
});

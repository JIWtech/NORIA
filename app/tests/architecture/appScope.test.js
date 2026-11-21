import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import parser from '@babel/parser';
import traverseModule from '@babel/traverse';

import {
  buildScopeKey,
  isSameScope,
  resourceErrorsForPage,
  selectScopedAppData,
  withScopeKey,
} from '../../src/app/appScope.js';
import {
  activePageStorageKey,
  appDataCachePrefix,
  cacheAppData,
  clearAppDataCache,
  createEmptyAppData,
  loadCachedAppData,
} from '../../src/app/appStorage.js';

const traverse = traverseModule.default || traverseModule;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

class MockStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  setItem(key, value) {
    this.store.set(String(key), String(value));
  }
  removeItem(key) {
    this.store.delete(String(key));
  }
  clear() {
    this.store.clear();
  }
  get length() {
    return this.store.size;
  }
  key(index) {
    return [...this.store.keys()][index] ?? null;
  }
}

const mockLocalStorage = new MockStorage();
const mockSessionStorage = new MockStorage();

globalThis.window = {
  localStorage: mockLocalStorage,
  sessionStorage: mockSessionStorage,
};
globalThis.localStorage = mockLocalStorage;
globalThis.sessionStorage = mockSessionStorage;

function resetStorages() {
  mockLocalStorage.clear();
  mockSessionStorage.clear();
}

test('escopo: dados de outro tenant nunca são usados ao trocar de empresa', () => {
  const scopeA = buildScopeKey('user-1', 'empresa_a');
  const scopeB = buildScopeKey('user-1', 'empresa_b');
  const fallback = createEmptyAppData();
  const dataTenantA = withScopeKey({
    ...createEmptyAppData(),
    tenantId: 'tid-a',
    conversations: [{ id: 'conv-a', contact: 'Cliente A' }],
    source: 'supabase',
  }, scopeA);

  const sameScope = selectScopedAppData(dataTenantA, true, scopeA, fallback);
  assert.equal(sameScope.ready, true);
  assert.equal(sameScope.data.tenantId, 'tid-a');
  assert.equal(sameScope.data.conversations.length, 1);

  const switchedTenant = selectScopedAppData(dataTenantA, true, scopeB, fallback);
  assert.equal(switchedTenant.ready, false);
  assert.equal(switchedTenant.data, fallback);
  assert.deepEqual(switchedTenant.data.conversations, []);
  assert.equal(switchedTenant.data.tenantId, null);
});

test('escopo: dados de outro usuário ou sem scopeKey são descartados mesmo com ready=true', () => {
  const scopeUser1 = buildScopeKey('user-1', 'clinica_nubia');
  const scopeUser2 = buildScopeKey('user-2', 'clinica_nubia');
  const fallback = createEmptyAppData();

  const dataUser1 = withScopeKey({
    ...createEmptyAppData(),
    tenantId: 'tid-nubia',
    conversations: [{ id: 'conv-1' }],
  }, scopeUser1);

  const otherUser = selectScopedAppData(dataUser1, true, scopeUser2, fallback);
  assert.equal(otherUser.ready, false);
  assert.equal(otherUser.data, fallback);

  const unscoped = selectScopedAppData({ conversations: [{ id: 'stale' }] }, true, scopeUser1, fallback);
  assert.equal(unscoped.ready, false);
  assert.equal(unscoped.data, fallback);

  const notReadyYet = selectScopedAppData(dataUser1, false, scopeUser1, fallback);
  assert.equal(notReadyYet.ready, false);
  assert.equal(notReadyYet.data, dataUser1);
});

test('isSameScope rejeita escopos vazios, nulos ou divergentes', () => {
  const scopeA = buildScopeKey('user-1', 'tenant_a');
  const scopeB = buildScopeKey('user-1', 'tenant_b');
  assert.equal(isSameScope(scopeA, scopeA), true);
  assert.equal(isSameScope(scopeA, scopeB), false);
  assert.equal(isSameScope('', scopeA), false);
  assert.equal(isSameScope(scopeA, ''), false);
  assert.equal(isSameScope(null, null), false);
});

test('resourceErrorsForPage filtra falhas apenas para as telas afetadas', () => {
  const allErrors = ['agendamentos', 'contatos de disparos', 'campanhas', 'leituras', 'contatos'];
  assert.deepEqual(resourceErrorsForPage(allErrors, 'agendamentos'), ['agendamentos']);
  assert.deepEqual(resourceErrorsForPage(allErrors, 'disparos'), ['contatos de disparos', 'campanhas', 'contatos']);
  assert.deepEqual(resourceErrorsForPage(allErrors, 'conversas'), ['leituras', 'contatos']);
  assert.deepEqual(resourceErrorsForPage(allErrors, 'kanban'), ['agendamentos', 'contatos']);
  assert.deepEqual(resourceErrorsForPage(allErrors, 'dashboard'), ['contatos']);
  assert.deepEqual(resourceErrorsForPage(allErrors, 'configuracoes'), []);
  assert.deepEqual(resourceErrorsForPage([], 'agendamentos'), []);
  assert.deepEqual(resourceErrorsForPage(null, 'conversas'), []);
});

test('limpeza no logout: clearAppDataCache remove todos os snapshots e preserva preferências do navegador', () => {
  resetStorages();
  cacheAppData('empresa_a', { conversations: [{ id: 'a1' }] }, 'user-1');
  cacheAppData('empresa_b', { conversations: [{ id: 'b1' }] }, 'user-1');
  cacheAppData('empresa_a', { conversations: [{ id: 'a2' }] }, 'user-2');
  mockLocalStorage.setItem(activePageStorageKey, 'conversas');
  mockLocalStorage.setItem('other:pref', 'keep');

  assert.ok(loadCachedAppData('empresa_a', 'user-1'));
  assert.ok(loadCachedAppData('empresa_b', 'user-1'));

  clearAppDataCache();

  assert.equal(loadCachedAppData('empresa_a', 'user-1'), null);
  assert.equal(loadCachedAppData('empresa_b', 'user-1'), null);
  assert.equal(loadCachedAppData('empresa_a', 'user-2'), null);
  assert.equal(mockLocalStorage.getItem(activePageStorageKey), 'conversas');
  assert.equal(mockLocalStorage.getItem('other:pref'), 'keep');
});

test('TTL de cache: aceita snapshots dentro de 15 minutos e rejeita expirados ou inválidos', () => {
  resetStorages();
  const key = `${appDataCachePrefix}user-1:empresa_a`;
  const ttlMs = 15 * 60 * 1000;

  mockLocalStorage.setItem(key, JSON.stringify({
    conversations: [{ id: 'fresh' }],
    source: 'supabase',
    cached_at: Date.now() - (ttlMs - 1000),
  }));
  const valid = loadCachedAppData('empresa_a', 'user-1');
  assert.ok(valid);
  assert.equal(valid.source, 'cache');
  assert.equal(valid.conversations[0].id, 'fresh');

  for (const invalidCachedAt of [Date.now() - ttlMs - 1, Date.now() + 5000, null, undefined, 'invalid']) {
    mockLocalStorage.setItem(key, JSON.stringify({
      conversations: [{ id: 'stale' }],
      cached_at: invalidCachedAt,
    }));
    assert.equal(loadCachedAppData('empresa_a', 'user-1'), null);
  }
});

test('REGRESSAO: appScope.js tem AST limpa e App.jsx aplica isolamento por scopeKey e clearAppDataCache', () => {
  const scopePath = path.join(__dirname, '../../src/app/appScope.js');
  const scopeCode = fs.readFileSync(scopePath, 'utf8');
  const scopeAst = parser.parse(scopeCode, { sourceType: 'module' });
  const jsGlobals = new Set(['JSON', 'Boolean', 'Array']);
  const undefinedRefs = new Set();

  traverse(scopeAst, {
    ReferencedIdentifier(p) {
      const name = p.node.name;
      if (jsGlobals.has(name)) return;
      if (!p.scope.hasBinding(name)) undefinedRefs.add(name);
    },
  });
  assert.deepEqual(Array.from(undefinedRefs), [], 'appScope.js não deve ter identificadores indefinidos');

  const appPath = path.join(__dirname, '../../src/app/App.jsx');
  const appCode = fs.readFileSync(appPath, 'utf8');
  assert.match(appCode, /selectScopedAppData/, 'App.jsx deve derivar dados e prontidão via selectScopedAppData');
  assert.match(appCode, /withScopeKey/, 'App.jsx deve gravar scopeKey nos dados carregados e em cache');
  assert.match(appCode, /clearAppDataCache\(\)/, 'App.jsx deve limpar cache de dados no logout e troca de usuário');
  assert.match(appCode, /clearKanbanMovesInFlight/, 'App.jsx deve zerar movimentos pendentes do Kanban ao trocar de tenant');
});

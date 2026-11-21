import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import parser from '@babel/parser';

const source = fs.readFileSync(new URL('../../src/app/App.jsx', import.meta.url), 'utf8');
const ast = parser.parse(source, { sourceType: 'module', plugins: ['jsx'] });
function findFunction(name, node) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'FunctionDeclaration' && node.id.name === name) return node;
  for (const value of Object.values(node)) {
    const found = Array.isArray(value)
      ? value.map(child => findFunction(name, child)).find(Boolean)
      : findFunction(name, value);
    if (found) return found;
  }
  return null;
}
function actualFunction(name, context) {
  const node = findFunction(name, ast);
  assert.ok(node, name);
  return vm.runInNewContext(`(${source.slice(node.start, node.end)})`, context);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function refreshHarness() {
  const request = deferred();
  const state = { loading: false, ready: false };
  const context = {
    hasTenantAccess: true, scopeKey: 'a', currentScope: { current: 'a' },
    tenantCacheEpoch: () => 1, isSameScope: (a, b) => a === b,
    refreshCoordinator: { run: (_, callback) => callback() },
    refreshLoadingRequest: { current: null },
    setLoading: value => { state.loading = value; },
    setAppDataReady: value => { state.ready = value; },
    appDataRef: { current: null }, fullyLoadedScope: { current: '' }, agentsList: [],
    selectPartialRefresh: () => null, activeTenantSlug: 'a', session: null,
    includeOlderConversationsRef: { current: false }, loadClientData: () => request.promise,
    setLoadError() {}, userFacingError: error => error.message,
  };
  return { request, state, context, refresh: actualFunction('refreshData', context) };
}

for (const nextScope of ['b', '']) {
  test(`A1: atualização manual encerra loading após invalidar escopo para '${nextScope}'`, async () => {
    const h = refreshHarness();
    const pending = h.refresh();
    assert.equal(h.state.loading, true);
    h.context.currentScope.current = nextScope;
    h.request.resolve({});
    assert.equal(await pending, false);
    assert.equal(h.state.loading, false);
    assert.equal(h.state.ready, false, 'resposta antiga não deixa nova empresa pronta');
  });
}

test('A1: finally antigo preserva o indicador de uma atualização mais nova', async () => {
  const h = refreshHarness();
  const pending = h.refresh();
  h.context.currentScope.current = 'b';
  h.context.refreshLoadingRequest.current = { scope: 'b' };
  h.request.resolve({});
  await pending;
  assert.equal(h.state.loading, true);
});

test('A1: troca de escopo limpa indicadores sem aguardar a requisição antiga', async () => {
  const h = refreshHarness();
  const pending = h.refresh();
  h.context.currentScope.current = 'b';
  const app = findFunction('App', ast);
  const effect = app.body.body.find(node => node.type === 'ExpressionStatement'
    && node.expression.callee?.name === 'useEffect'
    && source.slice(node.start, node.end).includes('refreshLoadingRequest.current = null'));
  assert.ok(effect, 'efeito de limpeza por escopo');
  const callback = effect.expression.arguments[0];
  let pendingIds;
  vm.runInNewContext(`(${source.slice(callback.start, callback.end)})`, {
    ...h.context, setAgentPendingIds: value => { pendingIds = value; },
  })();
  assert.equal(h.state.loading, false);
  assert.equal(pendingIds.size, 0);
  h.request.resolve({});
  await pending;
});

function teamHarness(serviceName) {
  const request = deferred();
  const state = { agents: [{ id: 'one', status: 'online' }], data: { scopeKey: 'a', teamAgents: [{ id: 'one', status: 'online' }] }, errors: [], calls: 0 };
  const context = {
    currentScope: { current: 'a' }, activeTenantSlug: 'a', agentsList: state.agents,
    isSameScope: (a, b) => a === b, agentMutationsInFlight: { current: new Set() },
    setAgentPendingIds() {},
    setAgentsList: update => { state.agents = update(state.agents); },
    setAppData: update => { state.data = update(state.data); },
    setLoadError: error => state.errors.push(error), userFacingError: error => error.message,
    [serviceName]: () => { state.calls++; return request.promise; },
  };
  return { request, state, context };
}

for (const [name, service] of [['handleToggleAgentStatus', 'updateTeamAgentStatus'], ['handleDeleteAgent', 'removeTeamAgent']]) {
  test(`A6: ${name} preserva os dois estados na falha e bloqueia duplo clique`, async () => {
    const h = teamHarness(service);
    const handler = actualFunction(name, h.context);
    const first = handler('one');
    const second = handler('one');
    assert.equal(h.state.calls, 1);
    assert.equal(h.state.agents.length, 1);
    assert.equal(h.state.agents[0].status, 'online');
    h.request.reject(new Error('rede indisponível'));
    await Promise.all([first, second]);
    assert.deepEqual(h.state.agents, [{ id: 'one', status: 'online' }]);
    assert.deepEqual(h.state.data.teamAgents, h.state.agents);
    assert.ok(h.state.errors.includes('rede indisponível'));
    assert.equal(h.context.agentMutationsInFlight.current.size, 0);
  });

  test(`A6: ${name} não aplica resposta da empresa anterior`, async () => {
    const h = teamHarness(service);
    const pending = actualFunction(name, h.context)('one');
    h.context.currentScope.current = 'b';
    h.request.resolve();
    await pending;
    assert.deepEqual(h.state.agents, [{ id: 'one', status: 'online' }]);
    assert.deepEqual(h.state.data.teamAgents, h.state.agents);
  });

  test(`A6: ${name} só atualiza ambos estados após sucesso remoto`, async () => {
    const h = teamHarness(service);
    const pending = actualFunction(name, h.context)('one');
    assert.deepEqual(h.state.agents, [{ id: 'one', status: 'online' }]);
    h.request.resolve();
    assert.equal(await pending, true);
    assert.equal(h.state.agents.length, name === 'handleDeleteAgent' ? 0 : 1);
    if (h.state.agents.length) assert.equal(h.state.agents[0].status, 'standby');
    assert.deepEqual(h.state.data.teamAgents, h.state.agents);
  });
}

test('A6: inclusão bloqueia clique concorrente e não aplica falha ao estado', async () => {
  const h = teamHarness('saveTeamAgent');
  const handler = actualFunction('handleAddAgent', h.context);
  const first = handler({ name: 'Ana' });
  const second = handler({ name: 'Ana' });
  assert.equal(h.state.calls, 1);
  h.request.reject(new Error('não salvo'));
  await assert.rejects(first, /não salvo/);
  await second;
  assert.equal(h.state.agents.length, 1);
  assert.equal(h.context.agentMutationsInFlight.current.size, 0);
});

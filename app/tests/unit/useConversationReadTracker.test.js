import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import * as readsService from '../../src/services/reads/readsService.js';
import * as appScope from '../../src/app/appScope.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hookPath = path.resolve(__dirname, '../../src/app/hooks/useConversationReadTracker.js');
const hookSource = fs.readFileSync(hookPath, 'utf8');

function createHookRunner() {
  const slots = [];
  let cursor = 0;

  const reactStub = {
    useRef(initialValue) {
      const idx = cursor++;
      if (!(idx in slots)) slots[idx] = { current: initialValue };
      return slots[idx];
    },
    useCallback(fn, deps) {
      const idx = cursor++;
      const prev = slots[idx];
      const changed = !prev || !deps || deps.length !== prev.deps.length
        || deps.some((dep, i) => !Object.is(dep, prev.deps[i]));
      if (changed) {
        slots[idx] = { fn, deps: deps ? [...deps] : [] };
      }
      return slots[idx].fn;
    },
    useEffect() {
      // Sem efeito necessário para o teste unitário de callback/rollback.
    },
  };

  const { outputText } = ts.transpileModule(hookSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });

  return (mockDataService) => {
    const mod = { exports: {} };
    const fn = new Function('require', 'module', 'exports', outputText);
    fn((id) => {
      if (id === 'react') return reactStub;
      if (id === '../../dataService.js') return mockDataService;
      if (id === '../appScope.js') return appScope;
      throw new Error(`Unexpected import in useConversationReadTracker.js: ${id}`);
    }, mod, mod.exports);

    return (props) => {
      cursor = 0;
      return mod.exports.useConversationReadTracker(props);
    };
  };
}

test('C3: rollback de leitura otimista chama a versão mais recente de refreshData após troca de tenant', async () => {
  const scheduledCallbacks = [];
  const prevWindow = globalThis.window;
  globalThis.window = {
    setTimeout(fn) {
      scheduledCallbacks.push(fn);
      return scheduledCallbacks.length;
    },
    clearTimeout() {},
  };

  try {
    const runHook = createHookRunner()({
      ...readsService,
      markConversationRead: async () => {
        throw new Error('Falha de rede simulada');
      },
    });

    const refreshCallsA = [];
    const refreshCallsB = [];
    const currentScope = { current: '["user-1","tenant-a"]' };
    const appDataRef = {
      current: {
        scopeKey: '["user-1","tenant-a"]',
        tenantId: 't-a',
        conversationReads: [],
      },
    };

    const hookRender1 = runHook({
      activeTenantSlug: 'tenant-a',
      sessionUserId: 'user-1',
      currentScope,
      appDataRef,
      setAppData: () => {},
      refreshData: (opts) => refreshCallsA.push(opts),
    });

    // Troca de empresa mantendo o mesmo sessionUserId: deps [sessionUserId] mantém a mesma função scheduleConversationRead.
    currentScope.current = '["user-1","tenant-b"]';
    appDataRef.current = {
      scopeKey: '["user-1","tenant-b"]',
      tenantId: 't-b',
      conversationReads: [],
    };

    const hookRender2 = runHook({
      activeTenantSlug: 'tenant-b',
      sessionUserId: 'user-1',
      currentScope,
      appDataRef,
      setAppData: () => {},
      refreshData: (opts) => refreshCallsB.push(opts),
    });

    assert.equal(hookRender1.scheduleConversationRead, hookRender2.scheduleConversationRead);

    hookRender1.scheduleConversationRead({
      channelType: 'whatsapp',
      externalConversationId: '5511999990000@s.whatsapp.net',
      messages: [{ from: 'contact', eventId: 'evt-1', createdAt: '2026-11-21T10:00:00Z' }],
    });

    assert.equal(scheduledCallbacks.length, 1);
    await scheduledCallbacks[0]();

    assert.equal(refreshCallsA.length, 0, 'Não deve chamar refreshData antigo do tenant anterior');
    assert.deepEqual(refreshCallsB, [{ showLoading: false }], 'Deve chamar a versão atual de refreshData');
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
  }
});

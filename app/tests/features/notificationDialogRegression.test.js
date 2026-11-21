import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { execFileSync } from 'node:child_process';

const read = path => process.env.NORIA_TEST_ORIGINAL
  ? execFileSync('git', ['show', `HEAD:app/${path.replace('../../', '')}`], { encoding: 'utf8' })
  : readFileSync(new URL(path, import.meta.url), 'utf8');

test('A14: sessão ausente e tenant aguardando hidratação têm estados distintos', () => {
  const source = read('../../src/features/notifications/useNotifications.js');
  assert.match(source, /if \(!userId\)/);
  assert.match(source, /if \(!tenantId\)[\s\S]*?loading: true[\s\S]*?error: ''/);
});

test('C5: leituras agrupadas são enviadas juntas e limpeza aguarda confirmação', () => {
  const hook = read('../../src/features/notifications/useNotifications.js');
  const center = read('../../src/features/notifications/NotificationCenter.jsx');
  const panel = read('../../src/features/notifications/NotificationPanel.jsx');
  assert.match(hook, /markReadMany/);
  assert.match(hook, /p_items: readItems\.map/);
  assert.match(center, /await inbox\.markReadMany/);
  assert.match(panel, /onMarkRead\(targets\.filter/);
});

test('C5: ação explícita aguarda polling e envia todas as revisões na mesma RPC', async () => {
  const source = read('../../src/features/notifications/useNotifications.js');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const effects = [];
  const react = { useState: value => [value, () => {}], useRef: value => ({ current: value }),
    useCallback: fn => fn, useEffect: fn => effects.push(fn) };
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const calls = [];
  const service = {
    inboxRpc: async (name, params) => {
      calls.push({ name, params });
      if (calls.length === 1) await gate;
      return name === 'magia_list_turn_notifications'
        ? { items: [], has_more: false, unread_count: 0 } : { unread_count: 0 };
    },
    validateInboxPage: value => value, validateInboxRead: value => value,
    fetchHumanReplies: async () => [], notificationError: () => 'erro',
  };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(id => id === 'react' ? react : service, mod, mod.exports);
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
  let cleanup;
  try {
    const inbox = mod.exports.useNotifications('tenant-a', 'user-a');
    cleanup = effects[0]();
    await new Promise(resolve => setImmediate(resolve));
    const targets = [{ id: 'a', revision: 2 }, { id: 'b', revision: 3 }];
    // A interface antiga enviava uma marcação por item e perdia as seguintes quando busy.
    const pending = inbox.markReadMany ? inbox.markReadMany(targets)
      : Promise.all(targets.map(item => inbox.markRead(item)));
    assert.equal(calls.length, 1);
    release();
    await pending;
    assert.deepEqual(calls[1], { name: 'magia_read_turn_notifications', params: { p_tenant: 'tenant-a',
      p_items: [{ id: 'a', revision: 2 }, { id: 'b', revision: 3 }] } });
  } finally {
    cleanup?.();
    globalThis.window = oldWindow;
    globalThis.document = oldDocument;
  }
});

test('A14: usuário autenticado sem tenant aguarda hidratação sem pedir login', async () => {
  const compiled = ts.transpileModule(read('../../src/features/notifications/useNotifications.js'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const effects = [], states = [];
  const react = { useState: value => { const index = states.push(value) - 1; return [value, next => { states[index] = next; }]; },
    useRef: value => ({ current: value }), useCallback: fn => fn, useEffect: fn => effects.push(fn) };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(id => id === 'react' ? react : {}, mod, mod.exports);
  const oldWindow = globalThis.window, oldDocument = globalThis.document;
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
  let cleanup;
  try {
    mod.exports.useNotifications(null, 'user-a');
    cleanup = effects[0]();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(states[0].loading, true);
    assert.equal(states[0].error, '');
  } finally { cleanup?.(); globalThis.window = oldWindow; globalThis.document = oldDocument; }
});

test('A16: repetir o efeito sobre diálogo já modal não lança erro', () => {
  const source = read('../../src/features/conversations/components/DocumentAttachment.jsx') + '\nexport { DocumentDialog };';
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React,
    esModuleInterop: true } }).outputText;
  let effect, opens = 0;
  const element = { open: false, modal: false, showModal() {
    if (this.open && this.modal) return;
    if (this.open) throw new Error('InvalidStateError');
    this.open = true; this.modal = true; opens++;
  } };
  const react = { createElement: () => ({}), lazy: () => () => {}, useRef: () => ({ current: element }),
    useEffect: fn => { effect = fn; } };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(id => id === 'react' ? react
    : id === 'react-dom' ? { createPortal: () => ({}) } : {}, mod, mod.exports);
  const oldDocument = globalThis.document;
  globalThis.document = { activeElement: { focus() {} }, body: { style: { overflow: '' } } };
  try {
    mod.exports.DocumentDialog({ name: 'teste', onClose() {} });
    const cleanup = effect();
    cleanup();
    const cleanupAgain = effect();
    assert.equal(opens, 1);
    assert.equal(element.modal, true);
    cleanupAgain();
  } finally { globalThis.document = oldDocument; }
});

test('C5: falha ao marcar todas não limpa os avisos remotos', async () => {
  const compiled = ts.transpileModule(read('../../src/features/notifications/NotificationCenter.jsx'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  let cleared = 0;
  const panel = () => {};
  const inbox = { items: [], unread: 2, markAllRead: async () => false };
  const activity = { items: [], pendingReads: new Set(), dismissedKeys: new Set(), markAllRead() {}, clearAll() { cleared++; } };
  const react = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), Fragment: 'fragment',
    memo: fn => fn, useEffect() {}, useMemo: fn => fn(), useRef: value => ({ current: value }), useState: value => [value, () => {}] };
  const dependencies = {
    './useNotifications.js': { useNotifications: () => inbox },
    './useOperatorNotifications.js': { useOperatorNotifications: () => activity },
    './useNotificationSound.js': { useNotificationSound: () => ({}) },
    './notificationService.js': {},
    './operatorEvents.js': { notificationScope: () => '', applyClearedBefore: x => x, applyDismissed: x => x, reconcileNotifications: x => x },
    './notificationPending.js': { pendingNotifications: () => [], waitingConversationNotifications: () => [], canOperateNotifications: () => false },
    './notificationSituations.js': { attachAvatars: x => x },
    './NotificationPanel.jsx': { NotificationPanel: panel }, './NotificationToasts.jsx': { NotificationToasts: () => {} },
  };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(id => id === 'react' ? react : dependencies[id], mod, mod.exports);
  const tree = mod.exports.NotificationCenter({ tenantId: 'tenant-a', userId: 'user-a' });
  const panelElement = tree.children.find(child => child.type === panel);
  await panelElement.props.onClearAll();
  assert.equal(cleared, 0);
});

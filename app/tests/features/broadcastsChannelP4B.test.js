import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import parser from '@babel/parser';
import traverseModule from '@babel/traverse';
import {
  buildBroadcastCampaignPayload,
  filterContactsForChannel,
  getBroadcastChannelOptions,
  getDefaultBroadcastChannel,
  resolveActiveBroadcastChannel,
} from '../../src/features/broadcasts/utils/broadcastChannel.js';

const traverse = traverseModule.default || traverseModule;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('A13: escolhe canal padrao quando ha apenas um ou fallback, mas preserva o canal selecionado pelo usuario', () => {
  const multi = ['whatsapp', 'telegram', 'instagram'];
  assert.equal(getDefaultBroadcastChannel(multi), 'telegram');
  assert.equal(resolveActiveBroadcastChannel('whatsapp', multi), 'whatsapp');
  assert.equal(resolveActiveBroadcastChannel('instagram', multi), 'instagram');
  // Se o canal selecionado for desabilitado nas configuracoes, cai para um canal permitido
  assert.equal(resolveActiveBroadcastChannel('telegram', ['whatsapp', 'instagram']), 'whatsapp');
});

test('A13: opcoes do seletor e filtragem de contatos respeitam o canal selecionado', () => {
  const allowed = ['whatsapp', 'telegram'];
  const options = getBroadcastChannelOptions(allowed);
  assert.deepEqual(options.map((o) => o.id), ['whatsapp', 'telegram']);

  const contacts = [
    { key: 'whatsapp:5511999990000@s.whatsapp.net', channelType: 'whatsapp', externalConversationId: '5511999990000@s.whatsapp.net' },
    { key: 'telegram:12345', channelType: 'telegram', externalConversationId: '12345' },
    { key: 'instagram:ig-1', channelType: 'instagram', externalConversationId: 'ig-1' },
  ];

  const onlyWhatsapp = filterContactsForChannel(contacts, allowed, 'whatsapp');
  assert.equal(onlyWhatsapp.length, 1);
  assert.equal(onlyWhatsapp[0].channelType, 'whatsapp');

  const onlyTelegram = filterContactsForChannel(contacts, allowed, 'telegram');
  assert.equal(onlyTelegram.length, 1);
  assert.equal(onlyTelegram[0].channelType, 'telegram');
});

test('A13: payload da campanha usa o canal escolhido em vez de travar no canal padrao', () => {
  const payload = buildBroadcastCampaignPayload({
    campaignName: 'Aviso clientes WhatsApp',
    messageText: '  Olá! Temos horários livres hoje.  ',
    activeChannel: 'whatsapp',
    recipients: [{ externalConversationId: '5511999990000@s.whatsapp.net' }],
    now: new Date(2026, 10, 21, 10, 0, 0),
  });

  assert.equal(payload.channelType, 'whatsapp');
  assert.equal(payload.name, 'Aviso clientes WhatsApp');
  assert.equal(payload.messageText, 'Olá! Temos horários livres hoje.');
  assert.equal(payload.total_recipients, 1);
  assert.equal(payload.status, 'draft');
});

test('A13 REGRESSAO AST: Broadcasts.jsx exibe seletor quando allowedChannels.length > 1 e usa activeChannel sem ReferenceError', () => {
  const filePath = path.join(__dirname, '../../src/features/broadcasts/components/Broadcasts.jsx');
  const code = fs.readFileSync(filePath, 'utf8');

  assert.match(code, /allowedChannels\.length > 1/);
  assert.match(code, /NoriaSelect/);
  assert.match(code, /activeChannel/);
  assert.match(code, /buildBroadcastCampaignPayload/);

  const ast = parser.parse(code, { sourceType: 'module', plugins: ['jsx'] });
  const jsGlobals = new Set([
    'window', 'document', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'React', 'URL', 'File', 'FileReader', 'FormData', 'Date', 'Math', 'Number', 'String', 'Array',
    'Object', 'Set', 'Map', 'RegExp', 'Boolean', 'Promise', 'Intl', 'encodeURIComponent', 'decodeURIComponent',
    'fetch', 'navigator', 'localStorage', 'sessionStorage', 'alert', 'confirm', 'prompt',
    'isNaN', 'isFinite', 'parseInt', 'parseFloat', 'JSON', 'Error', 'TypeError', 'RangeError',
    'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent', 'Blob', 'crypto',
    'Infinity', 'NaN', 'undefined', 'null', 'process', 'IntersectionObserver', 'HTMLInputElement',
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

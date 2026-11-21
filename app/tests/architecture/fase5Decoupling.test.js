import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import parser from '@babel/parser';
import traverseModule from '@babel/traverse';

import { eventsToKanban } from '../../src/services/kanban/eventsToKanban.js';
import { applyIncomingEventToKanban } from '../../src/services/kanban/applyIncomingEvent.js';
import { createEmptyAppData, getInitialAppData } from '../../src/app/appStorage.js';
import { createBroadcastOperations } from '../../src/services/broadcasts/broadcastOperations.js';

const traverse = traverseModule.default || traverseModule;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.join(__dirname, '../../src');

const jsGlobals = new Set([
  'window', 'document', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'Date', 'Math', 'Number', 'String', 'Array', 'Object', 'Set', 'Map', 'RegExp', 'Boolean',
  'Promise', 'Intl', 'JSON', 'Error', 'TypeError', 'RangeError', 'Infinity', 'NaN', 'undefined', 'null',
]);

test('Fase 5: hooks extraídos de App.jsx possuem AST limpa, preservam checagens de escopo e não importam App', () => {
  const hookFiles = [
    'app/hooks/useKanbanMutations.js',
    'app/hooks/useAgentAssignment.js',
    'app/hooks/useConversationReadTracker.js',
  ];

  for (const relPath of hookFiles) {
    const fullPath = path.join(srcRoot, relPath);
    assert.ok(fs.existsSync(fullPath), `${relPath} deve existir`);
    const code = fs.readFileSync(fullPath, 'utf8');
    const ast = parser.parse(code, { sourceType: 'module' });
    const undefinedRefs = new Set();

    traverse(ast, {
      ReferencedIdentifier(p) {
        const name = p.node.name;
        if (jsGlobals.has(name)) return;
        if (!p.scope.hasBinding(name)) undefinedRefs.add(name);
      },
    });

    assert.deepEqual(
      Array.from(undefinedRefs),
      [],
      `${relPath} não pode ter identificadores livres: ${Array.from(undefinedRefs).join(', ')}`,
    );
    assert.match(code, /isSameScope/, `${relPath} deve preservar checagem isSameScope`);
    assert.match(code, /scopeKey/, `${relPath} deve preservar checagem de scopeKey`);
    assert.doesNotMatch(code, /from\s+['"]\.\.\/App(?:\.jsx)?['"]/, `${relPath} não deve criar dependência circular com App.jsx`);
  }
});

test('Fase 5: services/kanban não lê window.localStorage diretamente', () => {
  const kanbanDir = path.join(srcRoot, 'services/kanban');
  const files = fs.readdirSync(kanbanDir).filter((file) => file.endsWith('.js'));
  assert.ok(files.length > 0, 'services/kanban deve conter arquivos .js');

  for (const file of files) {
    const code = fs.readFileSync(path.join(kanbanDir, file), 'utf8');
    assert.doesNotMatch(code, /\blocalStorage\b/, `services/kanban/${file} não deve acessar localStorage`);
  }
});

test('Fase 5: eventsToKanban e applyIncomingEventToKanban usam teamAgents recebido por parâmetro e ignoram localStorage', () => {
  const previousWindow = globalThis.window;
  const tenantSlug = 'clinica_teste';
  const storageAgents = JSON.stringify([{ id: 'ag-storage', name: 'Agente Storage', status: 'online', is_active: true }]);

  globalThis.window = {
    localStorage: {
      getItem: (key) => (key === `magia:team-agents:${tenantSlug}` ? storageAgents : null),
      setItem: () => {},
      removeItem: () => {},
    },
  };

  try {
    const handoffEvent = {
      id: 'ev-handoff-1',
      tenant_slug: tenantSlug,
      channel_type: 'whatsapp',
      external_conversation_id: '5511999990001@s.whatsapp.net',
      contact_name: 'Maria Teste',
      direction: 'outbound',
      sender_type: 'agent',
      service: 'manual_reply',
      stage: 'Atendimento humano',
      handoff: true,
      message_text: 'Assumi o atendimento por aqui.',
      created_at: '2026-11-21T12:00:00.000Z',
      raw_payload: {},
    };

    const kanbanWithoutParam = eventsToKanban([handoffEvent], tenantSlug, [], null, [], [], []);
    const cardWithoutParam = kanbanWithoutParam.flatMap((col) => col.cards).find((c) => c.id === 'card-ev-handoff-1');
    assert.ok(cardWithoutParam, 'Card deve ser gerado por eventsToKanban');
    assert.notEqual(cardWithoutParam.owner, 'Agente Storage', 'eventsToKanban não pode ler agentes do localStorage');
    assert.equal(cardWithoutParam.owner, 'Sem responsável');
    assert.equal(cardWithoutParam.ownerKind, 'none');

    const paramAgents = [{ id: 'ag-param', name: 'Camila Souza', status: 'online', is_active: true }];
    const kanbanWithParam = eventsToKanban([handoffEvent], tenantSlug, [], null, [], [], paramAgents);
    const cardWithParam = kanbanWithParam.flatMap((col) => col.cards).find((c) => c.id === 'card-ev-handoff-1');
    assert.ok(cardWithParam, 'Card deve ser gerado com teamAgents explícito');
    assert.equal(cardWithParam.owner, 'Camila Souza');
    assert.equal(cardWithParam.ownerId, 'ag-param');
    assert.equal(cardWithParam.ownerKind, 'agent');

    const baseColumns = [
      {
        id: 'conversas_ia',
        automationKey: 'conversas_ia',
        title: 'Conversas IA',
        cards: [
          {
            id: 'card-initial',
            canonicalKey: 'whatsapp:5511999990001',
            normalizedExternalId: '5511999990001',
            externalConversationId: '5511999990001@s.whatsapp.net',
            channelType: 'whatsapp',
            owner: 'Assistente IA',
            ownerId: null,
            ownerKind: 'ai',
            lastControlAt: '2026-11-21T11:00:00.000Z',
            lastActivityAt: '2026-11-21T11:00:00.000Z',
          },
        ],
      },
      {
        id: 'com_humano',
        automationKey: 'com_humano',
        title: 'Com humano',
        cards: [],
      },
    ];

    const realtimeWithoutParam = applyIncomingEventToKanban(baseColumns, handoffEvent, tenantSlug, []);
    const realtimeCardWithoutParam = realtimeWithoutParam.flatMap((col) => col.cards).find((c) => c.id === 'card-initial');
    assert.ok(realtimeCardWithoutParam);
    assert.notEqual(realtimeCardWithoutParam.owner, 'Agente Storage', 'applyIncomingEventToKanban não pode ler agentes do localStorage');
    assert.equal(realtimeCardWithoutParam.owner, 'Sem responsável');

    const realtimeWithParam = applyIncomingEventToKanban(baseColumns, handoffEvent, tenantSlug, paramAgents);
    const realtimeCardWithParam = realtimeWithParam.flatMap((col) => col.cards).find((c) => c.id === 'card-initial');
    assert.ok(realtimeCardWithParam);
    assert.equal(realtimeCardWithParam.owner, 'Camila Souza');
    assert.equal(realtimeCardWithParam.ownerId, 'ag-param');
    assert.equal(realtimeCardWithParam.ownerKind, 'agent');
  } finally {
    globalThis.window = previousWindow;
  }
});

test('Fase 5: appStorage inicializa teamAgents e App.jsx propaga teamAgents explicitamente', () => {
  const empty = createEmptyAppData();
  assert.deepEqual(empty.teamAgents, []);

  const initial = getInitialAppData('clinica_teste');
  assert.ok(Array.isArray(initial.data.teamAgents));

  const appCode = fs.readFileSync(path.join(srcRoot, 'app/App.jsx'), 'utf8');
  assert.match(appCode, /teamAgents:\s*currentTeamAgents/, 'refreshData deve repassar teamAgents para loadClientData');
  assert.match(appCode, /applyIncomingEventToKanban\([\s\S]*?resolvedTeamAgents/, 'Realtime deve passar resolvedTeamAgents para applyIncomingEventToKanban');
});

// broadcastOperations foi mantido intacto: as funções de lease/claim são cobertas pelos testes de concorrência dos disparos.
test('Fase 5: broadcastOperations mantém operações ativas e as de concorrência do disparo', () => {
  const ops = createBroadcastOperations({
    getClient: () => null,
    loadTenant: async () => null,
    currentUserId: async () => null,
    getTenantSlug: () => null,
  });

  const expectedActive = [
    'upsertBroadcastContacts',
    'createBroadcastCampaign',
    'updateBroadcastCampaign',
    'updateBroadcastRecipient',
    'getBroadcastCampaignRecipients',
    'enqueueBroadcastCampaign',
    'controlBroadcastCampaign',
    'reconcileUnknownRecipient',
  ];

  const removedDead = [
    'claimBroadcastBatch',
    'markRecipientSending',
    'recordRecipientResult',
    'recoverStaleLeases',
    'cancelBroadcastCampaign',
  ];

  for (const name of expectedActive) {
    assert.equal(typeof ops[name], 'function', `${name} deve permanecer disponível em broadcastOperations`);
  }
  for (const name of removedDead) {
    assert.equal(typeof ops[name], 'function', `${name} é usada pelos testes de concorrência dos disparos e deve permanecer`);
  }
});

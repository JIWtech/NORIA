// I&C Salon 09/11 (…8468): arrastar para Finalizadas só gravava um evento interno do Kanban. O atendimento
// humano continuava aberto no banco e a IA não voltou a responder o cliente ("Oieee" ficou sem resposta).
// Finalizar pelo Kanban precisa usar o mesmo encerramento oficial do botão Encerrar das Conversas.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createMoveKanbanCard } from '../../src/services/kanban/kanbanCardMovement.js';

function harness({ closeResult = { event: { id: 'evt-close', service: 'conversation_closed' } }, closeError = null } = {}) {
  const inserts = [];
  const closes = [];
  const client = { from: () => ({ insert: async (rows) => { inserts.push(...rows); return { error: null }; } }) };
  const move = createMoveKanbanCard({
    getClient: () => client,
    loadTenant: async () => ({ id: 'tenant-ic' }),
    closeConversation: async (request) => {
      closes.push(request);
      if (closeError) throw closeError;
      return closeResult;
    },
  });
  return { move, inserts, closes };
}

const card = {
  id: 'card-e1', title: 'Cliente Teste', channelType: 'whatsapp', externalConversationId: '5521900000002@s.whatsapp.net',
  targetColumnId: 'com_humano', stage: 'Em atendimento humano',
};
const finalizadas = { id: 'finalizadas', automationKey: 'finalizadas', title: 'Finalizadas' };

test('finalizar pelo Kanban usa o encerramento oficial e não grava evento interno', async () => {
  const { move, inserts, closes } = harness();
  const events = await move('ic_salon', card, 'finalizadas', null, finalizadas);
  assert.equal(closes.length, 1);
  assert.equal(closes[0].tenantSlug, 'ic_salon');
  assert.equal(closes[0].channelType, 'whatsapp');
  assert.equal(closes[0].externalConversationId, card.externalConversationId);
  assert.equal(inserts.length, 0, 'o encerramento oficial já grava o evento; o interno duplicaria');
  assert.deepEqual(events.map((event) => event.id), ['evt-close']);
});

test('encerramento recusado pelo servidor não vira finalização falsa', async () => {
  const { move, inserts } = harness({ closeError: new Error('O encerramento nao foi confirmado pelo servidor.') });
  await assert.rejects(() => move('ic_salon', card, 'finalizadas', null, finalizadas), /nao foi confirmado/);
  assert.equal(inserts.length, 0);
});

test('outras colunas continuam com o evento interno de auditoria', async () => {
  const { move, inserts, closes } = harness();
  await move('ic_salon', card, 'aguardando_humano', null, { id: 'aguardando_humano', automationKey: 'aguardando_humano', title: 'Aguardando humano' });
  assert.equal(closes.length, 0);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].direction, 'internal');
});

test('canal sem encerramento oficial (agendamento manual) mantém o comportamento anterior', async () => {
  const { move, inserts, closes } = harness();
  await move('ic_salon', { ...card, channelType: 'manual' }, 'finalizadas', null, finalizadas);
  assert.equal(closes.length, 0);
  assert.equal(inserts.length, 1);
});

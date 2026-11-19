import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { shouldRefreshConversationState } from '../../src/services/timeline/realtimeRefresh.js';

// NB Bronze 19/11: ~60 recargas completas por hora no pico (4,3 s e 3,1 MB cada). Duas origens não mudam nada
// que a aplicação incremental já não trate: o marcador técnico do pipeline v2 e cada mensagem de cliente numa
// conversa que já está com a equipe.

test('marcador técnico do pipeline (noria_pipeline_pin) não dispara recarga completa', () => {
  assert.equal(shouldRefreshConversationState({ service: 'noria_pipeline_pin', delivery_status: 'internal', direction: 'outbound' }), false);
  assert.equal(shouldRefreshConversationState({ service: 'noria_pipeline_pin', delivery_status: 'internal' }, { isNewConversation: true }), true,
    'conversa nova continua recarregando');
});

test('mensagem com handoff numa conversa que já está com a equipe não recarrega; o primeiro handoff recarrega', () => {
  const inbound = { direction: 'inbound', handoff: true, ai_provider: 'human_lock', stage: 'Atendimento humano' };
  assert.equal(shouldRefreshConversationState(inbound, { alreadyHumanControlled: true }), false);
  assert.equal(shouldRefreshConversationState(inbound, { alreadyHumanControlled: false }), true, 'transferência nova para a equipe');
  assert.equal(shouldRefreshConversationState({ ...inbound, direction: 'outbound', service: 'handoff_requested' }, { alreadyHumanControlled: true }), true,
    'eventos de controle continuam recarregando');
});

test('eventos de controle, pagamento e Kanban continuam disparando recarga completa', () => {
  for (const service of ['resume_ai', 'conversation_assigned', 'conversation_closed', 'pagamento_sinal', 'kanban_move']) {
    assert.equal(shouldRefreshConversationState({ service }, { alreadyHumanControlled: true }), true, service);
  }
  assert.equal(shouldRefreshConversationState({ ai_provider: 'payment_signal' }), true);
  assert.equal(shouldRefreshConversationState({ direction: 'inbound', message_text: 'oi' }), false, 'mensagem comum segue incremental');
});

test('App informa se a conversa já está com a equipe ao decidir a recarga', () => {
  const app = fs.readFileSync(new URL('../../src/app/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /shouldRefreshConversationState\(incomingEvent, \{ isNewConversation, alreadyHumanControlled \}\)/);
  assert.match(app, /status === 'atendimento_humano'/);
});

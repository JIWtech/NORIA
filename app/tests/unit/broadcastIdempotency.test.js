// Regras de estado e idempotência que o painel ainda usa. O envio, as leases e a classificação
// de resultado saíram do navegador: agora são cobertos contra o SQL real e o worker do n8n em
// scripts/test_broadcast_schema_alignment.cjs e scripts/test_broadcast_server_dispatch.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RECIPIENT_STATUS,
  computeIdempotencyKey,
  canTransitionRecipient,
  calculateCampaignCounters,
} from '../../src/services/broadcasts/broadcastStateMachine.js';

test('chave de idempotência é determinística por campanha e destinatário, sem sufixo de canal', () => {
  assert.equal(computeIdempotencyKey('c-1', '5521999990000@s.whatsapp.net'), 'bcast:c-1:5521999990000');
  assert.equal(computeIdempotencyKey('c-1', '5521999990000'), computeIdempotencyKey('c-1', ' 5521999990000 '));
  assert.notEqual(computeIdempotencyKey('c-1', '5521999990000'), computeIdempotencyKey('c-2', '5521999990000'));
  assert.throws(() => computeIdempotencyKey('', '5521999990000'));
});

test('sent e cancelled são terminais; unknown nunca volta para a fila', () => {
  assert.equal(canTransitionRecipient(RECIPIENT_STATUS.SENT, RECIPIENT_STATUS.FAILED), false);
  assert.equal(canTransitionRecipient(RECIPIENT_STATUS.CANCELLED, RECIPIENT_STATUS.QUEUED), false);
  assert.equal(canTransitionRecipient(RECIPIENT_STATUS.UNKNOWN, RECIPIENT_STATUS.QUEUED), false);
  assert.equal(canTransitionRecipient(RECIPIENT_STATUS.SENDING, RECIPIENT_STATUS.QUEUED), false);
  assert.equal(canTransitionRecipient(RECIPIENT_STATUS.UNKNOWN, RECIPIENT_STATUS.FAILED), true, 'reconciliação manual');
  assert.equal(canTransitionRecipient(RECIPIENT_STATUS.CLAIMED, RECIPIENT_STATUS.QUEUED), true, 'lease vencida antes do envio');
});

test('campanha com destinatários enviados, pendentes e incertos reflete contadores reais', () => {
  const counters = calculateCampaignCounters([
    { status: 'sent' }, { status: 'sent' }, { status: 'unknown' }, { status: 'failed' }, { status: 'queued' }, { status: 'queued' },
  ]);
  assert.equal(counters.total, 6);
  assert.equal(counters.sent, 2);
  assert.equal(counters.unknown, 1);
  assert.equal(counters.failed, 1);
  assert.equal(counters.queued, 2);
  assert.equal(counters.hasUnknown, true);
  assert.equal(counters.hasPending, true);
  assert.equal(counters.isComplete, false);
});

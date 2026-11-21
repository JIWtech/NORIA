import test from 'node:test';
import assert from 'node:assert/strict';
import { localInputToIso } from '../../src/services/appointments/appointmentActions.js';

// IA-17: data/hora digitada na agenda vale no fuso do tenant, não no fuso do navegador.
test('datetime-local é convertido pelo fuso do tenant (10:00 em São Paulo = 13:00 UTC)', () => {
  assert.equal(localInputToIso('2026-11-12T10:00', 'America/Sao_Paulo'), '2026-11-12T13:00:00.000Z');
  assert.equal(localInputToIso('2026-11-12T10:00', 'America/Manaus'), '2026-11-12T14:00:00.000Z');
  assert.equal(localInputToIso('2026-11-12T10:00', 'UTC'), '2026-11-12T10:00:00.000Z');
  assert.equal(localInputToIso('', 'America/Sao_Paulo'), null);
  assert.equal(localInputToIso('lixo', 'America/Sao_Paulo'), null);
});

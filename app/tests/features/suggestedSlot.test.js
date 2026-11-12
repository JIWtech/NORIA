import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSuggestedSlot } from '../../src/features/kanban/components/suggestedSlot.js';

test('pedido livre não envia sugestão, mesmo com valores antigos', () => {
  assert.deepEqual(buildSuggestedSlot('ask', '2099-12-01', '14:30'), {});
});

test('proposta envia data e hora juntas', () => {
  assert.deepEqual(buildSuggestedSlot('propose', '2099-12-01', '14:30', true), { suggested_date: '2099-12-01', suggested_time: '14:30' });
  assert.throws(() => buildSuggestedSlot('propose', '2099-12-01', '', true), /data e hora/i);
  assert.throws(() => buildSuggestedSlot('propose', '', '14:30', true), /data e hora/i);
});

test('proposta desabilitada não envia data ou hora', () => {
  assert.deepEqual(buildSuggestedSlot('propose', '2099-12-01', '14:30'), {});
});

test('data e hora passadas são recusadas no fuso do tenant, antes de chamar o servidor', () => {
  assert.throws(() => buildSuggestedSlot('propose', '2000-01-01', '10:00', true), /futuras/);
  // 12/11/2026 14:00 em São Paulo = 17:00Z: às 16:59Z ainda é futuro; às 17:01Z já passou.
  const options = { timeZone: 'America/Sao_Paulo' };
  assert.deepEqual(buildSuggestedSlot('propose', '2026-11-12', '14:00', true, { ...options, now: Date.parse('2026-11-12T16:59:00Z') }), { suggested_date: '2026-11-12', suggested_time: '14:00' });
  assert.throws(() => buildSuggestedSlot('propose', '2026-11-12', '14:00', true, { ...options, now: Date.parse('2026-11-12T17:01:00Z') }), /futuras/);
  // o mesmo instante em outro fuso mudaria o resultado: a hora de parede é a do tenant
  assert.throws(() => buildSuggestedSlot('propose', '2026-11-12', '14:00', true, { timeZone: 'UTC', now: Date.parse('2026-11-12T14:01:00Z') }), /futuras/);
});

test('data ou hora mal formadas dão erro próprio', () => {
  assert.throws(() => buildSuggestedSlot('propose', '2099-13-45', '10:00', true), /inválid|futuras/);
  assert.throws(() => buildSuggestedSlot('propose', '2099-12-01', '25:99', true), /inválid|futuras/);
});

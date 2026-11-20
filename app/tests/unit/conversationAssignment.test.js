import test from 'node:test';
import assert from 'node:assert/strict';
import { requirePersistedAssignment } from '../../src/services/conversations/conversationLifecycle.js';

const assigned = { id: 'evt-1', service: 'conversation_assigned', handoff: true };

test('atribuição só é aceita com o evento conversation_assigned persistido', () => {
  assert.equal(requirePersistedAssignment({ ok: true, saved: [assigned] }), assigned);
});

test('aceita a linha única devolvida pelo RPC de controle', () => {
  assert.equal(requirePersistedAssignment({ ok: true, saved: assigned }), assigned);
});

test('revisão da equipe aceita o evento atendimento_humano persistido', () => {
  const review = { id: 'evt-2', service: 'atendimento_humano', handoff: false };
  assert.equal(requirePersistedAssignment({ ok: true, saved: [review] }, { reviewOnly: true }), review);
});

test('resposta sem evento persistido, com ok falso ou com evento de outro tipo é recusada', () => {
  for (const result of [
    undefined,
    {},
    { ok: true },
    { ok: true, saved: [] },
    { ok: false, saved: [assigned] },
    { ok: true, saved: [{ service: 'conversation_assigned' }] },
    { ok: true, saved: [{ id: 'evt-3', service: 'manual_reply' }] },
  ]) {
    assert.throws(() => requirePersistedAssignment(result), /não foi confirmada/);
  }
});

test('modo revisão não aceita evento de atribuição com pausa, e vice-versa', () => {
  assert.throws(() => requirePersistedAssignment({ ok: true, saved: [assigned] }, { reviewOnly: true }), /não foi confirmada/);
  assert.throws(() => requirePersistedAssignment({ ok: true, saved: [{ id: 'x', service: 'atendimento_humano' }] }), /não foi confirmada/);
});

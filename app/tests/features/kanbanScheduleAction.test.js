import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldOfferScheduleAction } from '../../src/services/kanban/kanbanScheduleAction.js';

const NOW = Date.parse('2026-11-10T15:00:00Z');
const future = '2026-11-12T15:00:00Z';
const past = '2026-11-08T15:00:00Z';
const base = { onOpenAppointment: true, hasAgendamentosColumn: true, now: NOW };

test('oferece Agendar quando o cartão não tem agendamento ativo', () => {
  assert.equal(shouldOfferScheduleAction({ id: 'c1' }, 'conversas_ia', base), true);
  assert.equal(shouldOfferScheduleAction({ id: 'c1', appointmentId: 'a', appointmentStatus: 'cancelled', appointmentStartsAt: future }, 'conversas_ia', base), true);
  assert.equal(shouldOfferScheduleAction({ id: 'c1', appointmentId: 'a', appointmentStatus: 'no_show', appointmentStartsAt: past }, 'nao_compareceu', base), true);
});

test('oculta Agendar quando já existe agendamento ativo', () => {
  for (const status of ['confirmed', 'pending_confirmation', 'scheduled', 'reserved']) {
    assert.equal(shouldOfferScheduleAction({ appointmentId: 'a', appointmentStatus: status, appointmentStartsAt: future }, 'conversas_ia', base), false, status);
  }
  assert.equal(shouldOfferScheduleAction({ appointmentId: 'a', appointmentStatus: 'pending_payment', appointmentStartsAt: future }, 'conversas_ia', base), false);
});

test('agendamento ativo com horário já passado não bloqueia Agendar', () => {
  for (const status of ['confirmed', 'pending_confirmation', 'scheduled', 'reserved', 'pending_payment']) {
    assert.equal(shouldOfferScheduleAction({ appointmentId: 'a', appointmentStatus: status, appointmentStartsAt: past }, 'conversas_ia', base), true, status);
  }
  assert.equal(shouldOfferScheduleAction({ appointmentId: 'a', appointmentStatus: 'confirmed' }, 'conversas_ia', base), true);
});

test('status com maiúsculas ou espaços ainda conta como ativo', () => {
  assert.equal(shouldOfferScheduleAction({ appointmentId: 'a', appointmentStatus: ' Confirmed ', appointmentStartsAt: future }, 'conversas_ia', base), false);
});

test('colunas agendamentos e confirmar_agendamento nunca oferecem Agendar', () => {
  assert.equal(shouldOfferScheduleAction({ id: 'c1' }, 'agendamentos', base), false);
  assert.equal(shouldOfferScheduleAction({ id: 'c1' }, 'confirmar_agendamento', base), false);
});

test('exige callback e coluna de agendamentos configurada', () => {
  assert.equal(shouldOfferScheduleAction({ id: 'c1' }, 'conversas_ia', { ...base, onOpenAppointment: false }), false);
  assert.equal(shouldOfferScheduleAction({ id: 'c1' }, 'conversas_ia', { ...base, hasAgendamentosColumn: false }), false);
});

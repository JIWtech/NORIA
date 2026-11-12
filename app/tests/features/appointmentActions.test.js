import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appointmentActionsFor, appointmentEditDraft, buildAppointmentUpdate, createAppointmentActions, zonedDateTimeToIso,
} from '../../src/services/appointments/appointmentActions.js';
import { mapAppointment } from '../../src/services/appointments/appointmentPresentation.js';

const timeZone = 'America/Sao_Paulo';
const NOW = Date.parse('2026-11-11T15:00:00Z');
const appointment = (status, startsAt, extra = {}) => mapAppointment({
  id: 'appt-1', status, starts_at: startsAt, ends_at: null, title: 'Corte', contact_name: 'Ana',
  notes: 'Prefere tesoura', metadata: { services: ['Corte'], professional: 'Bia' }, ...extra,
});

function fakeClient(response = { data: { ok: true }, error: null }) {
  const calls = [];
  return { calls, rpc(name, args) { calls.push([name, args]); return Promise.resolve(response); } };
}

test('converte data e hora locais do tenant para ISO, inclusive fora do horário de verão', () => {
  assert.equal(zonedDateTimeToIso('2026-11-13', '14:30', timeZone), '2026-11-13T17:30:00.000Z');
  assert.equal(zonedDateTimeToIso('2026-07-01', '09:00', 'Europe/Lisbon'), '2026-07-01T08:00:00.000Z');
  assert.equal(zonedDateTimeToIso('', '09:00', timeZone), null);
});

test('rascunho de edição parte do agendamento e a atualização só manda o que mudou', () => {
  const current = appointment('confirmed', '2026-11-13T17:30:00Z');
  const draft = appointmentEditDraft(current, { timeZone });
  assert.deepEqual(draft, { date: '2026-11-13', time: '14:30', services: ['Corte'], professional: 'Bia', notes: 'Prefere tesoura' });
  assert.deepEqual(buildAppointmentUpdate(current, draft, { timeZone }), {});
  const changed = buildAppointmentUpdate(current, { ...draft, time: '16:00', services: ['Corte', ' Escova ', ''], professional: '', notes: 'Nova obs' }, { timeZone });
  assert.deepEqual(changed, {
    p_starts_at: '2026-11-13T19:00:00.000Z', p_services: ['Corte', 'Escova'], p_professional: '', p_notes: 'Nova obs',
  });
  assert.throws(() => buildAppointmentUpdate(current, { ...draft, services: [] }, { timeZone }), /serviço/);
  assert.throws(() => buildAppointmentUpdate(current, { ...draft, date: '' }, { timeZone }), /data e a hora/);
});

test('editar, cancelar e arquivar chamam as RPCs propostas sem avisar a cliente', async () => {
  const client = fakeClient();
  const actions = createAppointmentActions({ getClient: () => client });
  await actions.updateAppointment('appt-1', { p_notes: 'x' });
  await actions.cancelAppointment('appt-1');
  await actions.archiveAppointment('appt-1');
  assert.deepEqual(client.calls, [
    ['magia_update_appointment', { p_appointment: 'appt-1', p_notes: 'x' }],
    ['magia_close_appointment', { p_appointment: 'appt-1', p_action: 'cancel', p_note: null }],
    ['magia_close_appointment', { p_appointment: 'appt-1', p_action: 'archive', p_note: null }],
  ]);
  await assert.rejects(() => actions.updateAppointment('appt-1', {}), /Nada para salvar/);
});

test('erros das RPCs viram mensagens claras, inclusive RPC ainda não aplicada', async () => {
  const missing = createAppointmentActions({ getClient: () => fakeClient({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }) });
  await assert.rejects(() => missing.cancelAppointment('appt-1'), /atualização do banco/);
  const slot = createAppointmentActions({ getClient: () => fakeClient({ data: null, error: { message: 'SLOT_UNAVAILABLE' } }) });
  await assert.rejects(() => slot.updateAppointment('appt-1', { p_notes: 'x' }), /horário não está disponível/);
  const closed = createAppointmentActions({ getClient: () => fakeClient({ data: null, error: { message: 'APPOINTMENT_EDIT_INVALID_STATUS' } }) });
  await assert.rejects(() => closed.updateAppointment('appt-1', { p_notes: 'x' }), /não pode mais ser alterado/);
  const none = createAppointmentActions({ getClient: () => null });
  await assert.rejects(() => none.cancelAppointment('appt-1'), /Supabase/);
});

test('ações disponíveis dependem do status e do horário', () => {
  const keys = (item, options) => appointmentActionsFor(item, { now: NOW, ...options });
  assert.deepEqual(keys(appointment('confirmed', '2026-11-13T17:30:00Z')), ['edit', 'cancel']);
  assert.deepEqual(keys(appointment('confirmed', '2026-11-10T17:30:00Z')), ['edit', 'cancel', 'archive']);
  assert.deepEqual(keys(appointment('confirmed', '2026-11-10T17:30:00Z'), { outcomeTracking: true }), ['edit', 'cancel', 'archive', 'attended', 'no_show']);
  assert.deepEqual(keys(appointment('pending_confirmation', '2026-11-13T17:30:00Z')), ['cancel']);
  assert.deepEqual(keys(appointment('cancelled', '2026-11-13T17:30:00Z')), []);
  assert.deepEqual(keys(appointment('no_show', '2026-11-10T17:30:00Z'), { outcomeTracking: true }), ['attended']);
});

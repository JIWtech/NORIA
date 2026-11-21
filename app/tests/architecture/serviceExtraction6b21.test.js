import test from 'node:test';
import assert from 'node:assert/strict';
import { createSaveAppointment } from '../../src/services/appointments/saveAppointment.js';

function appointment(overrides = {}) {
  return { title: 'Consulta', contactName: 'Maria', startsAt: '2026-10-10T13:00:00.000Z', endsAt: null, channelType: 'whatsapp', externalConversationId: '5511@s.whatsapp.net', notes: 'Observação', ...overrides };
}

function supabaseMock({ rpc = { data: { id: 'rpc-1', title: 'Consulta', starts_at: '2026-10-10T13:00:00.000Z', status: 'scheduled' }, error: null }, insert = { data: { id: 'insert-1', title: 'Consulta', starts_at: '2026-10-10T13:00:00.000Z', status: 'scheduled' }, error: null } } = {}) {
  const calls = [];
  return { calls,
    async rpc(name, payload) { calls.push(['rpc', name, payload]); return rpc; },
    from(table) { calls.push(['from', table]); const query = { insert(payload) { calls.push(['insert', payload]); return query; }, select(value) { calls.push(['select', value]); return query; }, async single() { calls.push(['single']); return insert; } }; return query; },
  };
}

function saver(supabase, tenant = { id: 'tenant-nubia' }) {
  return createSaveAppointment({ getClient: () => supabase, loadTenant: async (slug) => ({ ...tenant, slug }), currentUserId: async () => 'user-1' });
}

test('6B.21 Núbia reserva por RPC com payload, tenant, data e horário exatos', async () => {
  const client = supabaseMock();
  const result = await saver(client)('clinica_nubia_oficial', appointment({ unitId: 'unit-1', serviceId: 'service-1', localDate: '2026-10-10', localTime: '10:30', requestId: 'request-1' }));
  assert.equal(result.id, 'rpc-1');
  assert.deepEqual(client.calls, [['rpc', 'magia_reserve_appointment', { p_tenant: 'tenant-nubia', p_unit: 'unit-1', p_service: 'service-1', p_date: '2026-10-10', p_time: '10:30', p_name: 'Maria', p_chat: '5511@s.whatsapp.net', p_request: 'request-1', p_channel: 'whatsapp', p_notes: 'Observação' }]]);
});

test('6B.21 agenda não configurada propaga erro sem gravar', async () => {
  const client = supabaseMock({ rpc: { data: null, error: new Error('SCHEDULE_NOT_CONFIGURED') } });
  await assert.rejects(() => saver(client)('outro-tenant', appointment({ unitId: 'unit-2', serviceId: 'service-2', localDate: '2026-10-11', localTime: '14:15' })), /SCHEDULE_NOT_CONFIGURED/);
  assert.equal(client.calls.filter(([kind]) => kind === 'rpc').length, 1);
  assert.equal(client.calls.filter(([kind]) => kind === 'insert').length, 0);
});

test('6B.21 erro de reserva sem fallback não grava e propaga erro', async () => {
  const error = new Error('SLOT_UNAVAILABLE'); const client = supabaseMock({ rpc: { data: null, error } });
  await assert.rejects(() => saver(client)('clinica_nubia_oficial', appointment({ unitId: 'unit' })), error);
  assert.equal(client.calls.filter(([kind]) => kind === 'insert').length, 0);
});

test('6B.21 agendamento manual preserva campos, timezone ISO e uma escrita', async () => {
  const client = supabaseMock();
  const result = await saver(client, { id: 'tenant-other' })('outro-tenant', appointment({ metadata: { origin: 'manual' } }));
  assert.equal(result.id, 'insert-1');
  assert.deepEqual(client.calls[0], ['from', 'appointments']);
  assert.deepEqual(client.calls[1], ['insert', { tenant_id: 'tenant-other', title: 'Consulta', starts_at: '2026-10-10T13:00:00.000Z', ends_at: null, status: 'scheduled', contact_name: 'Maria', channel_type: 'whatsapp', external_conversation_id: '5511@s.whatsapp.net', notes: 'Observação', created_by: 'user-1', metadata: { origin: 'manual' } }]);
});

test('6B.21 falhas de tenant, banco e payload incompleto preservam os erros existentes', async () => {
  const noTenant = createSaveAppointment({ getClient: () => supabaseMock(), loadTenant: async () => null, currentUserId: async () => 'user' });
  await assert.rejects(() => noTenant('clinica_nubia_oficial', appointment()), /Tenant nao encontrado/);
  const writeError = new Error('insert denied'); const client = supabaseMock({ insert: { data: null, error: writeError } });
  await assert.rejects(() => saver(client)('outro-tenant', appointment({ title: undefined, startsAt: undefined })), writeError);
});

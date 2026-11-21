import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppointmentDataService } from '../../src/services/appointments/appointmentDataService.js';
import { createSaveAppointment } from '../../src/services/appointments/saveAppointment.js';

test('agenda não configurada não inventa horários nem grava reserva', async () => {
  const error = new Error('SCHEDULE_NOT_CONFIGURED');
  let writes = 0;
  const client = { rpc: async () => ({ data: null, error }), from: () => { writes++; throw new Error('escrita inesperada'); } };
  const service = createAppointmentDataService({ getClient: () => client, loadTenant: async () => ({ id: 'tenant' }) });
  await assert.rejects(() => service.loadAppointmentAvailability('tenant', 'unit', 'service', '2026-11-21'), error);
  const save = createSaveAppointment({ getClient: () => client, loadTenant: async () => ({ id: 'tenant' }), currentUserId: async () => 'user' });
  await assert.rejects(() => save('tenant', { unitId: 'unit' }), error);
  assert.equal(writes, 0);
});

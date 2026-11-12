import test from 'node:test';
import assert from 'node:assert/strict';
import { localInputToIso } from '../../src/services/appointments/appointmentActions.js';
import { createSaveAppointment } from '../../src/services/appointments/saveAppointment.js';

// IA-17: data/hora digitada na agenda vale no fuso do tenant, não no fuso do navegador.
test('datetime-local é convertido pelo fuso do tenant (10:00 em São Paulo = 13:00 UTC)', () => {
  assert.equal(localInputToIso('2026-11-12T10:00', 'America/Sao_Paulo'), '2026-11-12T13:00:00.000Z');
  assert.equal(localInputToIso('2026-11-12T10:00', 'America/Manaus'), '2026-11-12T14:00:00.000Z');
  assert.equal(localInputToIso('2026-11-12T10:00', 'UTC'), '2026-11-12T10:00:00.000Z');
  assert.equal(localInputToIso('', 'America/Sao_Paulo'), null);
  assert.equal(localInputToIso('lixo', 'America/Sao_Paulo'), null);
});

test('fallback SCHEDULE_NOT_CONFIGURED grava o horário no fuso do tenant', async () => {
  let inserted;
  const supabase = {
    async rpc() { return { data: null, error: new Error('SCHEDULE_NOT_CONFIGURED') }; },
    from() { const query = { insert(payload) { inserted = payload; return query; }, select() { return query; }, async single() { return { data: { id: 'a1', title: 't', starts_at: inserted.starts_at, status: 'scheduled' }, error: null }; } }; return query; },
  };
  const save = createSaveAppointment({ getClient: () => supabase, loadTenant: async () => ({ id: 't1' }), currentUserId: async () => 'u1' });
  await save('salon', { title: 'x', contactName: 'Ana', unitId: 'u', serviceId: 's', localDate: '2026-11-12', localTime: '10:00', timeZone: 'America/Sao_Paulo', requestId: 'r' });
  assert.equal(inserted.starts_at, '2026-11-12T13:00:00.000Z');
});

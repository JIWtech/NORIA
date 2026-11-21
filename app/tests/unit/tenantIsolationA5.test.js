import test from 'node:test';
import assert from 'node:assert/strict';
import { createMoveKanbanCard } from '../../src/services/kanban/kanbanCardMovement.js';
import { eventsToKanban } from '../../src/services/kanban/eventsToKanban.js';
import {
  sendN8nCommand,
  requestKanbanFlowSuggestion,
  applyKanbanFlowOrder,
  requestCatalogProductRefresh,
} from '../../src/services/integration.js';
import { createTeamAgentManagement } from '../../src/services/agents/teamAgentManagement.js';
import { createSaveAppointment } from '../../src/services/appointments/saveAppointment.js';
import { createAppointmentDataService } from '../../src/services/appointments/appointmentDataService.js';
import { createBroadcastOperations } from '../../src/services/broadcasts/broadcastOperations.js';
import { markConversationRead } from '../../src/services/reads/conversationDataReads.js';
import { normalizeLocation } from '../../src/services/conversations/conversationPresentation.js';
import { locationDetailsCache } from '../../src/services/tenants/tenantScopedCaches.js';

test('A5: moveKanbanCard falha com erro claro quando tenantSlug não é informado (sem fallback clinica_nubia)', async () => {
  const moveKanbanCard = createMoveKanbanCard({
    getClient: () => ({}),
    loadTenant: async () => ({ id: 't1' }),
  });
  const card = { id: 'c1', stage: 'Qualificação', externalConversationId: '123' };

  await assert.rejects(() => moveKanbanCard('', card, 'conversas_humanos'), /Tenant ativo/);
  await assert.rejects(() => moveKanbanCard(null, card, 'conversas_humanos'), /Tenant ativo/);
  await assert.rejects(() => moveKanbanCard(undefined, card, 'conversas_humanos'), /Tenant ativo/);
});

test('A5: eventsToKanban não injeta clinica_nubia como tenant padrão', () => {
  const columns = eventsToKanban([
    {
      id: 'evt-1',
      channel_type: 'whatsapp',
      external_conversation_id: '5511999990000@s.whatsapp.net',
      message_text: 'Oi',
      direction: 'inbound',
      sender_type: 'contact',
      created_at: '2026-11-21T10:00:00Z',
    },
  ]);
  const card = columns.flatMap((c) => c.cards)[0];
  assert.equal(card.canonicalKey, 'whatsapp::5511999990000@s.whatsapp.net');
  assert.doesNotMatch(card.canonicalKey, /clinica_nubia/);
});

test('A5: funções de comando de integration.js falham sem tenant explícito (sem fallback jiw)', async () => {
  const msgPayload = { channel_type: 'whatsapp', external_conversation_id: '123', message_text: 'Oi' };
  await assert.rejects(() => sendN8nCommand('manual_reply', msgPayload), /Tenant ativo/);
  await assert.rejects(() => sendN8nCommand('manual_reply', msgPayload, ''), /Tenant ativo/);
  await assert.rejects(() => requestKanbanFlowSuggestion({ boardId: 'b1' }), /Tenant ativo/);
  await assert.rejects(() => applyKanbanFlowOrder({ boardId: 'b1' }, ''), /Tenant ativo/);
  await assert.rejects(() => requestCatalogProductRefresh({ instance_name: 'x' }, null), /Tenant ativo/);
});

test('A5: funções de escrita/consulta de agentes, agendamentos, disparos e leituras falham sem tenant explícito', async () => {
  const fakeSupabase = {
    from: () => ({}),
    rpc: async () => ({ data: {}, error: null }),
  };
  const agentMgmt = createTeamAgentManagement({ getClient: () => fakeSupabase });
  await assert.rejects(() => agentMgmt.saveTeamAgent('', { name: 'Ana' }), /Tenant ativo/);
  await assert.rejects(() => agentMgmt.updateTeamAgentStatus('ag-1', 'online', null), /Tenant ativo/);
  await assert.rejects(() => agentMgmt.removeTeamAgent('ag-1', ''), /Tenant ativo/);

  const saveAppointment = createSaveAppointment({
    getClient: () => fakeSupabase,
    loadTenant: async () => null,
    currentUserId: async () => 'u1',
  });
  await assert.rejects(() => saveAppointment('', { title: 'Teste' }), /Tenant ativo/);

  const apptData = createAppointmentDataService({
    getClient: () => fakeSupabase,
    loadTenant: async () => null,
  });
  await assert.rejects(() => apptData.loadAppointmentScheduling(''), /Tenant ativo/);
  await assert.rejects(() => apptData.loadAppointmentAvailability('', 'u1', 's1', '2026-12-01'), /Tenant ativo/);

  const broadcastOps = createBroadcastOperations({
    getClient: () => fakeSupabase,
    loadTenant: async () => null,
    currentUserId: async () => 'u1',
  });
  await assert.rejects(() => broadcastOps.upsertBroadcastContacts('', []), /Tenant ativo/);
  await assert.rejects(() => broadcastOps.createBroadcastCampaign('', { name: 'Camp' }, []), /Tenant ativo/);

  await assert.rejects(
    () => markConversationRead(fakeSupabase, { tenantId: '', channelType: 'whatsapp', externalConversationId: '1', lastReadEventId: 'e1' }),
    /Tenant ativo/,
  );
});

test('A5: locationDetailsCache é isolado por tenant', () => {
  locationDetailsCache.clear();

  const locWithDetails = normalizeLocation(
    {
      locationMessage: {
        degreesLatitude: -23.5505,
        degreesLongitude: -46.6333,
        name: 'Unidade Tenant A',
        address: 'Rua A, 100',
      },
    },
    { tenant_slug: 'tenant_a' },
    'tenant_a',
  );
  assert.equal(locWithDetails.name, 'Unidade Tenant A');
  assert.equal(locWithDetails.address, 'Rua A, 100');

  // Outro tenant com as mesmas coordenadas NÃO pode herdar nome/endereço de tenant_a.
  const locOtherTenant = normalizeLocation(
    {
      locationMessage: {
        degreesLatitude: -23.5505,
        degreesLongitude: -46.6333,
      },
    },
    { tenant_slug: 'tenant_b' },
    'tenant_b',
  );
  assert.equal(locOtherTenant.name, '');
  assert.equal(locOtherTenant.address, '');

  // O mesmo tenant ainda recupera seu próprio cache.
  const locSameTenant = normalizeLocation(
    {
      locationMessage: {
        degreesLatitude: -23.5505,
        degreesLongitude: -46.6333,
      },
    },
    { tenant_slug: 'tenant_a' },
    'tenant_a',
  );
  assert.equal(locSameTenant.name, 'Unidade Tenant A');
  assert.equal(locSameTenant.address, 'Rua A, 100');

  // Chamada sem tenant não lê nem grava no cache compartilhado.
  const locNoTenant = normalizeLocation({
    locationMessage: {
      degreesLatitude: -23.5505,
      degreesLongitude: -46.6333,
    },
  });
  assert.equal(locNoTenant.name, '');
  assert.equal(locNoTenant.address, '');
});

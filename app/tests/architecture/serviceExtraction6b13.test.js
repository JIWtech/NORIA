import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAudioTranscription,
  normalizeLocation,
  resolveConversationHeaderOwner,
  resolveConversationOwnerDetails,
  resolveEventMessagePreview,
  resolveMessageSender,
} from '../../src/services/conversations/conversationPresentation.js';
import { loadTeamAgents } from '../../src/services/agents/teamAgentReads.js';
import { mapAppointment } from '../../src/services/appointments/appointmentPresentation.js';

test('6B.13 conversation presentation preserves location cache and audio normalization', () => {
  normalizeLocation({ location: { latitude: -23.5, longitude: -46.6, name: 'Loja' } }, null, 'tenant-a');
  const cachedLocation = normalizeLocation({ location: { latitude: -23.5, longitude: -46.6 } }, null, 'tenant-a');
  assert.equal(cachedLocation.name, 'Loja');

  const event = {
    id: 'audio-1',
    direction: 'inbound',
    message_text: '[audio]',
    raw_payload: { audio_transcriptions: { 'audio-1': { status: 'transcribed', text: 'Olá, preciso de ajuda' } } },
  };
  assert.equal(normalizeAudioTranscription(event.raw_payload, event).text, 'Olá, preciso de ajuda');
});

test('6B.14 conversation presentation preserves ownership, sender and operational preview contracts', () => {
  assert.deepEqual(resolveConversationOwnerDetails({
    salesLead: { stage_key: 'sales_qualifying', ai_locked: false },
    activeAgents: [{ id: 'a1', name: 'Ana' }],
  }), { name: 'Assistente IA', id: null, kind: 'ai' });
  assert.deepEqual(resolveConversationHeaderOwner(
    { status: 'atendimento_humano', owner: 'Ana', stage: 'sales_human' },
    null,
    [{ id: 'a1', name: 'Ana' }],
  ), { name: 'Ana', id: 'a1', kind: 'agent' });
  assert.deepEqual(resolveMessageSender({ direction: 'outbound', raw_payload: { data: { key: { fromMe: true } }, magia_operator: { operator_name: 'Ana' } } }), { type: 'agent', label: 'Ana' });
  assert.equal(resolveEventMessagePreview({ direction: 'outbound', service: 'kanban_move', message_text: 'ignorar' }), null);
  assert.deepEqual(resolveEventMessagePreview({ direction: 'inbound', message_text: 'Olá', raw_payload: {} }), { text: 'Olá', sender: 'Cliente', senderType: 'contact' });
});

test('6B.13 team-agent read keeps tenant filter, cache fallback and auth boundary with mocks', async () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const calls = [];
  const supabase = { from(table) { calls.push(table); return { select() { return this; }, eq() { return this; }, order: async () => ({ data: [{ id: 'a1', tenant_slug: 'genesis', is_active: true }], error: null }) }; } };
  const loaded = await loadTeamAgents('genesis', { getClient: () => supabase, isAuthRequired: () => false, storage });
  assert.deepEqual(loaded, [{ id: 'a1', tenant_slug: 'genesis', is_active: true }]);
  assert.deepEqual(calls, ['team_agents']);
  assert.deepEqual(JSON.parse(values.get('magia:team-agents:genesis')), loaded);

  const fallback = await loadTeamAgents('nubia', { getClient: () => null, isAuthRequired: () => false, storage });
  assert.deepEqual(fallback, []);
  values.set('magia:team-agents:nubia', JSON.stringify([{ id: 'cached', tenant_slug: 'nubia' }]));
  assert.deepEqual(await loadTeamAgents('nubia', { getClient: () => null, isAuthRequired: () => false, storage }), [{ id: 'cached', tenant_slug: 'nubia' }]);
  assert.deepEqual(await loadTeamAgents('nubia', { getClient: () => null, isAuthRequired: () => true, storage }), []);
});

test('6B.13 appointment mapping preserves labels and normalized channel data', () => {
  const row = { id: 'appt-1', title: 'Visita', starts_at: '2026-10-09T12:30:00.000Z', ends_at: '2026-10-09T13:00:00.000Z', status: 'pending_payment', channel_type: 'whatsapp', metadata: { contact_name: 'Núbia', unit_name: 'Centro' } };
  const mapped = mapAppointment(row);
  assert.equal(mapped.contactName, 'Núbia');
  assert.equal(mapped.statusLabel, 'Aguardando sinal');
  assert.equal(mapped.channelLabel, 'WhatsApp');
  assert.equal(mapped.raw, row);
});

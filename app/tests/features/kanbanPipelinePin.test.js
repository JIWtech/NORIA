import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsToKanban } from '../../src/services/kanban/eventsToKanban.js';
import { applyIncomingEventToKanban } from '../../src/services/kanban/applyIncomingEvent.js';

// IA-15: o marcador interno noria_pipeline_pin não pode virar o "último evento" do card na recarga.
const tenant = 'clinica_nubia_oficial';
const chat = '5524000000001@s.whatsapp.net';
const now = Date.now();
const iso = (minutes) => new Date(now - 60 * 60 * 1000 + minutes * 60 * 1000).toISOString();
const event = (overrides = {}) => ({
  id: 'e1', tenant_slug: tenant, channel_type: 'whatsapp', external_conversation_id: chat, created_at: iso(0),
  stage: 'Qualificação', handoff: false, direction: 'inbound', sender_type: 'contact', ...overrides,
});
const pin = (minutes) => event({ id: 'pin-' + minutes, created_at: iso(minutes), direction: 'outbound', sender_type: 'system', service: 'noria_pipeline_pin',
  stage: 'Pipeline', ai_provider: 'noria_turn_dispatch', delivery_status: 'internal', message_text: '', raw_payload: { contract: 'noria_pipeline_pin_v1' } });
const config = { columns: ['conversas_ia', 'aguardando_humano', 'com_humano', 'finalizadas', 'conversas_abandonadas', 'triagem']
  .map((key, position) => ({ id: key, automation_key: key, name: key, position })) };
const location = (columns) => columns.find((column) => column.cards.length)?.automationKey;
const cardsOf = (columns) => columns.flatMap((column) => column.cards);

test('recarga ignora o pin interno: coluna e card iguais com e sem o pin', () => {
  const base = [event()];
  const withPin = [event(), pin(1)];
  assert.equal(location(eventsToKanban(withPin, tenant, [], config)), location(eventsToKanban(base, tenant, [], config)));
  const [a] = cardsOf(eventsToKanban(base, tenant, [], config));
  const [b] = cardsOf(eventsToKanban(withPin, tenant, [], config));
  assert.equal(b.stage ?? b.subtitle, a.stage ?? a.subtitle);
  assert.equal(b.lastEventId ?? b.id, a.lastEventId ?? a.id);
});

test('recarga e tempo real concordam quando um pin chega depois da mensagem', () => {
  const loaded = eventsToKanban([event()], tenant, [], config);
  const realtime = applyIncomingEventToKanban(loaded, pin(1), tenant);
  const reloaded = eventsToKanban([event(), pin(1)], tenant, [], config);
  assert.equal(location(realtime), location(reloaded));
  assert.equal(cardsOf(realtime).length, cardsOf(reloaded).length);
});

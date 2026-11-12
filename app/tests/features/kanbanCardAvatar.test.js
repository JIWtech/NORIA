import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsToKanban } from '../../src/services/kanban/eventsToKanban.js';
import { mapAppointment } from '../../src/services/appointments/appointmentPresentation.js';

// A foto do contato precisa aparecer também no card que une conversa e agendamento (ex.: "Aguardando confirmação").
const tenant = 'ic_salon';
const chat = '5521985198468@s.whatsapp.net';
const AVATAR = 'https://pps.whatsapp.net/v/t61.24694-24/foto.jpg?ccb=11-4';
const base = Date.now() - 60 * 60 * 1000;
const iso = (minutes) => new Date(base + minutes * 60 * 1000).toISOString();
const event = (overrides = {}) => ({ id: 'e1', tenant_slug: tenant, channel_type: 'whatsapp', external_conversation_id: chat, created_at: iso(0),
  stage: 'Conversas IA', handoff: false, direction: 'inbound', sender_type: 'contact', contact_name: 'João Victor Santos', avatar_url: AVATAR, ...overrides });
const config = { columns: ['conversas_ia', 'aguardando_humano', 'com_humano', 'verificar_sinal', 'confirmar_agendamento', 'agendamentos', 'finalizadas', 'conversas_abandonadas']
  .map((key, position) => ({ id: key, automation_key: key, name: key, position })) };
const appointment = (status) => mapAppointment({ id: 'appt-1', title: 'Design de sobrancelha', status, starts_at: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString(),
  created_at: iso(1), updated_at: iso(1), channel_type: 'whatsapp', external_conversation_id: chat, contact_name: 'Louzania Santos' });
const cardsOf = (columns) => columns.flatMap((column) => column.cards);

test('card que une conversa e agendamento mantém a foto do contato', () => {
  for (const status of ['pending_confirmation', 'confirmed']) {
    const columns = eventsToKanban([event(), event({ id: 'e2', created_at: iso(2), direction: 'outbound', sender_type: 'assistant' })], tenant, [appointment(status)], config);
    const cards = cardsOf(columns).filter((card) => card.appointmentId === 'appt-1');
    assert.equal(cards.length, 1, status);
    assert.equal(cards[0].avatarUrl, AVATAR, `foto ausente no card com agendamento ${status}`);
  }
});

test('card só de conversa continua com a foto', () => {
  const [card] = cardsOf(eventsToKanban([event()], tenant, [], config));
  assert.equal(card.avatarUrl, AVATAR);
});

test('card de agendamento mostra o status primeiro e o cliente e o horário separados', () => {
  const columns = eventsToKanban([event()], tenant, [appointment('pending_confirmation')], config);
  const card = cardsOf(columns).find((entry) => entry.appointmentId === 'appt-1');
  assert.equal(card.appointmentContactName, 'Louzania Santos');
  assert.ok(card.appointmentWhen.length > 0);
  assert.ok(String(card.id).startsWith('appointment-'));
  assert.ok(card.subtitle.includes('Louzania Santos'), 'o subtítulo continua igual para quem o usa');
});

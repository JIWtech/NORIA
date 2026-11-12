import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsToKanban } from '../../src/services/kanban/eventsToKanban.js';
import { applyIncomingEventToKanban } from '../../src/services/kanban/applyIncomingEvent.js';
import { createMoveKanbanCard } from '../../src/services/kanban/kanbanCardMovement.js';
import { mapAppointment } from '../../src/services/appointments/appointmentPresentation.js';
import { waitingConversationNotifications } from '../../src/features/notifications/notificationPending.js';

// Datas relativas ao instante atual: o Kanban abandona conversas antigas, então datas fixas envelhecem.
const BASE_TIME = Date.now() - 30 * 60 * 1000;
const iso = (minutes) => new Date(BASE_TIME + minutes * 60 * 1000).toISOString();
const tenant = 'ic_salon';
const chat = '5521000000001@s.whatsapp.net';
const event = (overrides = {}) => ({
  id: 'event-1', tenant_slug: tenant, channel_type: 'whatsapp', external_conversation_id: chat,
  created_at: iso(0), stage: 'Conversas IA', handoff: false,
  direction: 'inbound', sender_type: 'contact', ...overrides,
});
const config = { columns: [
  'conversas_ia', 'aguardando_humano', 'com_humano', 'verificar_sinal', 'confirmar_agendamento',
  'agendamentos', 'nao_compareceu', 'finalizadas', 'conversas_abandonadas', 'produtos_apresentados', 'triagem',
].map((key, position) => ({ id: key, automation_key: key, name: key, position })) };
const load = (events, appointments = []) => eventsToKanban(events, tenant, appointments, config);
const location = (columns) => columns.find((column) => column.cards.length)?.automationKey;
const appointment = (status) => mapAppointment({
  id: 'appt-1', title: 'Corte', status, starts_at: '2026-11-10T16:00:00Z',
  created_at: '2026-11-09T10:00:00Z', updated_at: '2026-11-09T10:00:00Z',
  channel_type: 'whatsapp', external_conversation_id: chat,
});

test('carga e tempo real concordam sobre fila, atribuição, pagamento e etapas configuradas', () => {
  const initial = event();
  const cases = [
    [{ service: 'handoff_requested', handoff: true, stage: 'Atendimento humano' }, 'aguardando_humano'],
    [{ service: 'conversation_assigned', handoff: true, stage: 'Atendimento humano', sender_type: 'agent' }, 'com_humano'],
    [{ service: 'pagamento_sinal', handoff: true, stage: 'Qualificacao' }, 'verificar_sinal'],
    [{ stage: 'Produtos apresentados' }, 'produtos_apresentados'],
    [{ stage: 'triagem' }, 'triagem'],
    [{ stage: 'Conversas IA', message_text: 'Ainda não está agendado?' }, 'conversas_ia'],
    [{ service: 'technical_error', ai_provider: 'core_error', sender_type: 'system', stage: 'Erro técnico' }, 'aguardando_humano'],
  ];
  for (const [fields, expected] of cases) {
    const incoming = event({ id: 'event-2', created_at: iso(5), ...fields });
    assert.equal(location(load([initial, incoming])), expected, JSON.stringify(fields));
    assert.equal(location(applyIncomingEventToKanban(load([initial]), incoming, tenant)), expected, JSON.stringify(fields));
  }
});

test('pagamento informado continua na fila após nova mensagem e falta antiga fica no histórico', () => {
  const initial = event();
  const incoming = event({ id: 'event-2', created_at: iso(5) });
  const reported = [appointment('payment_reported')];
  assert.equal(location(load([initial, incoming], reported)), 'verificar_sinal');
  assert.equal(location(applyIncomingEventToKanban(load([initial], reported), incoming, tenant)), 'verificar_sinal');
  for (const status of ['pending_payment', 'no_show']) {
    assert.notEqual(location(load([initial], [appointment(status)])), 'verificar_sinal');
  }
});

test('revisão da equipe sobre reserva confirmada fica pendente sem trocar o responsável pela conversa', () => {
  const initial = event({ created_at: iso(0) });
  const review = event({ id: 'review', service: 'atendimento_humano', raw_payload: { team_review_requested: true }, direction: 'outbound', sender_type: 'assistant',
    created_at: iso(5) });
  const ai = event({ id: 'ai-next', service: 'geral', direction: 'outbound', sender_type: 'assistant', created_at: iso(6) });
  const manual = event({ id: 'human', service: 'manual_reply', direction: 'outbound', sender_type: 'agent',
    delivery_status: 'sent', ai_provider: 'human_operator', stage: 'Atendimento humano', handoff: true, created_at: iso(7) });
  const confirmed = [appointment('confirmed')];
  const realtime = [review, ai].reduce((board, next) => applyIncomingEventToKanban(board, next, tenant), load([initial], confirmed));
  const pending = kanbanColumns => waitingConversationNotifications({ tenantId: 'tenant', userId: 'user', role: 'owner', kanbanColumns,
    now: Date.parse(iso(7)) });
  for (const columns of [load([initial, review, ai], confirmed), realtime]) {
    const [card] = columns.flatMap(column => column.cards);
    assert.equal(card.ownerKind, 'ai');
    assert.equal(card.appointmentStatus, 'confirmed');
    assert.equal(card.teamReviewRequestedAt, review.created_at);
    assert.equal(pending(columns).filter(item => item.kind === 'team-review').length, 1);
    assert.equal(pending(applyIncomingEventToKanban(columns, manual, tenant)).filter(item => item.kind === 'team-review').length, 0);
  }
  assert.equal(pending(load([initial, review, ai, manual], confirmed)).filter(item => item.kind === 'team-review').length, 0);
});

test('arrastar para a fila humana grava pedido de atendimento e não uma atribuição', async () => {
  const move = createMoveKanbanCard({ getClient: () => null });
  const card = { id: 'card-1', targetColumnId: 'conversas_ia', channelType: 'whatsapp', externalConversationId: chat };
  const [queued] = await move(tenant, card, 'aguardando_humano', null, { title: 'Aguardando humano' });
  assert.equal(queued.service, 'handoff_requested');
  const [abandoned] = await move(tenant, card, 'conversas_abandonadas');
  assert.notEqual(abandoned.stage, 'Finalizada');
  await assert.rejects(() => move(tenant, card, 'verificar_sinal'), /pagamento informado/i);
});

test('lead comercial persistido aparece mesmo sem eventos recentes e encerramento não vira venda', () => {
  const salesTenant = 'wesley_automoveis';
  const salesConfig = { columns: ['sales_qualifying', 'sales_hot', 'sales_closed'].map((key) => ({ id: key, automation_key: key })) };
  const lead = { id: 'lead-1', chat_id: chat, channel_type: 'whatsapp', stage_key: 'sales_hot', ai_locked: false, revision: 1 };
  const columns = eventsToKanban([], salesTenant, [], salesConfig, [], [lead]);
  assert.equal(location(columns), 'sales_hot');
  const closed = event({ id: 'close', service: 'conversation_closed', stage: 'Finalizado', tenant_slug: salesTenant });
  assert.equal(location(applyIncomingEventToKanban(columns, closed, salesTenant)), 'sales_hot');
  assert.equal(location(eventsToKanban([closed], salesTenant, [], salesConfig, [], [lead])), 'sales_hot');
});

test('inatividade vale também após resposta da IA e novo contato volta ao atendimento', () => {
  const old = event({ created_at: new Date(Date.now() - 25 * 3600000).toISOString(), direction: 'outbound', sender_type: 'assistant' });
  const columns = load([old]);
  assert.equal(location(columns), 'conversas_abandonadas');
  const incoming = event({ id: 'event-new', created_at: new Date().toISOString(), stage: 'Buffering' });
  const live = applyIncomingEventToKanban(columns, incoming, tenant);
  assert.equal(location(live), 'conversas_ia');
  assert.equal(live.find((column) => column.cards.length).cards[0].ownerKind, 'ai');
});

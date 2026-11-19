import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsToKanban } from '../../src/services/kanban/eventsToKanban.js';
import { withAppointmentOutcomeColumn } from '../../src/services/kanban/appointmentOutcomeColumns.js';
import { reconcilePendingKanbanMoves } from '../../src/services/kanban/pendingKanbanMoves.js';
const keys = [
  'conversas_ia',
  'aguardando_humano',
  'verificar_sinal',
  'confirmar_agendamento',
  'com_humano',
  'agendamentos',
  'finalizadas',
  'nao_compareceu',
  'conversas_abandonadas',
  'follow_ups',
];
const config = {
  columns: keys.map((key, position) => ({ id: key, name: key, automation_key: key, position })),
};
const t = Date.now(),
  at = (h) => new Date(t + h * 3600000).toISOString();
const msg = (id, chat, h, fields = {}) => ({
  id,
  tenant_slug: 'ic_salon',
  channel_type: 'whatsapp',
  external_conversation_id: chat,
  created_at: at(h),
  direction: 'inbound',
  sender_type: 'contact',
  stage: 'Conversas IA',
  message_text: 'Oi',
  raw_payload: {},
  ...fields,
});
const close = (chat, h) =>
  msg('close-' + chat, chat, h, {
    service: 'conversation_closed',
    stage: 'Finalizado',
    direction: 'outbound',
    sender_type: 'system',
  });
const booking = (id, chat, status, h = -2, update = -5) => ({
  id,
  channelType: 'whatsapp',
  externalConversationId: chat,
  status,
  startsAt: at(h),
  endsAt: at(h + 1),
  raw: { created_at: at(-9), updated_at: at(update) },
});
const board = (events, rows) =>
  withAppointmentOutcomeColumn(eventsToKanban(events, 'ic_salon', rows, config), t);
const flat = (cols) => cols.flatMap((c) => c.cards.map((card) => ({ ...card, col: c.automationKey })));
test('presença em outro contato preserva os cartões das onze colunas do Salon', () => {
  const events = keys.map((key, i) =>
    msg('e' + i, 'chat' + i, -3, { raw_payload: { kanban_transition: { to_column: key } } }),
  );
  const rows = [booking('pendente', 'avulso', 'confirmed'), booking('alvo', 'alvo', 'confirmed')];
  const before = board(events, rows),
    after = board(events, [rows[0], { ...rows[1], status: 'completed' }]);
  assert.equal(before.length, 11);
  for (const column of before) {
    assert.ok(column.cards.length, column.id);
    assert.deepEqual(
      after.find((c) => c.id === column.id).cards,
      column.cards.filter((c) => c.appointmentId !== 'alvo'),
      column.id,
    );
  }
});
test('presença antes/depois do fechamento, nova sessão e duas reservas no mesmo WhatsApp', () => {
  for (const status of ['completed', 'done'])
    for (const update of [-4, -1])
      for (const reopened of [false, true]) {
        const e = [msg('oi', 'chat', -8), close('chat', -3), ...(reopened ? [msg('nova', 'chat', 0)] : [])];
        const done = booking('feita', 'chat', status, -6, update),
          future = booking('futura', 'chat', 'confirmed', 6);
        const cards = flat(board(e, [done, future]));
        assert.equal(
          cards.some((c) => c.appointmentId === 'feita'),
          false,
        );
        assert.equal(cards.filter((c) => c.appointmentId === 'futura' && c.col === 'agendamentos').length, 1);
        assert.equal(cards.filter((c) => c.col === 'finalizadas').length, reopened ? 0 : 1);
        assert.equal(cards.filter((c) => c.col === 'conversas_ia').length, reopened ? 1 : 0);
      }
});
test('evento antigo de confirmação não recoloca reserva já concluída na fila', () => {
  const e = msg('confirmou', 'chat', -5, {
    stage: 'Agendamento confirmado',
    raw_payload: { appointment_id: 'feita' },
  });
  const cards = flat(board([e], [booking('feita', 'chat', 'completed')]));
  assert.equal(cards.length, 1);
  assert.notEqual(cards[0].col, 'agendamentos');
  assert.ok(!cards[0].appointmentId);
});
test('finalizar conversa preserva reserva independente mesmo quando seu ID era o do cartão mesclado', () => {
  const future = booking('futura', 'chat', 'confirmed', 3);
  const columns = board([msg('oi', 'chat', -9), close('chat', -2)], [future]);
  const independent = flat(columns).find((c) => c.appointmentId === 'futura');
  const old = { ...independent, detachedFromConversation: false };
  const pending = new Map([[old.id, { card: old, targetColumnKey: 'finalizadas', inFlight: true }]]);
  const after = flat(
    reconcilePendingKanbanMoves({ kanbanColumns: columns }, pending, new Map()).kanbanColumns,
  );
  assert.equal(after.filter((c) => c.appointmentId === 'futura' && c.col === 'agendamentos').length, 1);
  assert.equal(after.filter((c) => c.col === 'finalizadas').length, 1);
});
import { kanbanMoveBlockReason } from '../../src/services/kanban/cardRouting.js';
import { placeKanbanCard } from '../../src/services/kanban/pendingKanbanMoves.js';

test('duas reservas vencidas no mesmo WhatsApp aceitam presença em qualquer ordem', () => {
  const chat = '5511999990000@s.whatsapp.net';
  const events = [msg('oi', chat, -10), close(chat, -1)];
  for (const first of ['corte', 'escova']) {
    const rows = ['corte', 'escova'].map((id) => booking(id, chat, 'confirmed'));
    const other = rows.find((row) => row.id !== first);
    const remaining = () => flat(board(events, rows));
    assert.equal(remaining().filter((card) => card.col === 'aguardando_desfecho').length, 2);
    rows.find((row) => row.id === first).status = 'completed';
    assert.deepEqual(
      remaining()
        .filter((card) => card.appointmentId)
        .map((card) => card.appointmentId),
      [other.id],
    );
    other.status = 'completed';
    assert.deepEqual(
      remaining().map((card) => card.col),
      ['finalizadas'],
    );
  }
});

test('desfecho preserva outra reserva do mesmo contato em cada estado e ordem de leitura', () => {
  const states = {
    pending_confirmation: 'confirmar_agendamento',
    payment_reported: 'verificar_sinal',
    aguardando_verificacao: 'verificar_sinal',
    confirmed: 'agendamentos',
    scheduled: 'agendamentos',
    reserved: 'agendamentos',
    pending_payment: 'agendamentos',
    no_show: 'nao_compareceu',
    canceled: null,
    cancelled: null,
    done: null,
    completed: null,
  };
  const events = [msg('oi', 'chat', -10), close('chat', -4)];
  for (const [status, expected] of Object.entries(states)) {
    for (const reverse of [false, true]) {
      const target = booking('alvo', 'chat', 'no_show');
      const sibling = booking('outra', 'chat', status, 3, -1);
      const rows = reverse ? [target, sibling] : [sibling, target];
      assert.equal(
        flat(board(events, rows)).find((c) => c.appointmentId === target.id)?.col,
        'nao_compareceu',
      );
      target.status = 'completed';
      const cards = flat(board(events, rows));
      assert.equal(
        cards.some((c) => c.appointmentId === target.id),
        false,
      );
      assert.deepEqual(
        cards.filter((c) => c.appointmentId === sibling.id).map((c) => c.col),
        expected ? [expected] : [],
      );
      assert.equal(cards.filter((c) => c.col === 'finalizadas').length, 1);
    }
  }
});

test('movimentos manuais entre colunas persistidas respeitam bloqueios e preservam os demais cards', () => {
  const bookings = {
    agendamentos: 'confirmed',
    verificar_sinal: 'payment_reported',
    confirmar_agendamento: 'pending_confirmation',
    nao_compareceu: 'no_show',
  };
  for (const source of keys) {
    const card = {
      id: 'mover',
      targetColumnId: source,
      appointmentStatus: bookings[source],
      isFollowUp: source === 'follow_ups',
    };
    for (const target of keys.filter((key) => key !== source)) {
      const blocked =
        ['finalizadas', 'nao_compareceu', 'follow_ups'].includes(source) ||
        ['follow_ups', ...Object.keys(bookings)].includes(target);
      assert.equal(Boolean(kanbanMoveBlockReason(card, target)), blocked, source + ' → ' + target);
      if (blocked) continue;
      const columns = keys.map((id) => ({
        id,
        cards: [{ id: 'fixo-' + id }, ...(id === source ? [card] : [])],
      }));
      const pending = new Map([
        [card.id, { card, inFlight: true, targetColumnKey: target, targetStageLabel: target }],
      ]);
      const moved = reconcilePendingKanbanMoves({ kanbanColumns: columns }, pending).kanbanColumns;
      for (const col of moved) {
        assert.deepEqual(
          col.cards.filter((c) => c.id !== card.id),
          [{ id: 'fixo-' + col.id }],
        );
        assert.deepEqual(
          col.cards.filter((c) => c.id === card.id),
          col.id === target ? [placeKanbanCard(card, target, target)] : [],
        );
      }
    }
  }
});
test('atualização de reserva antiga não captura uma conversa reaberta', () => {
  const events = [msg('oi', 'chat', -10), close('chat', -3), msg('nova', 'chat', -1)];
  const rows = [booking('futura', 'chat', 'confirmed', 4, 0)];
  const cards = flat(board(events, rows));
  assert.deepEqual(cards.map((c) => c.col).sort(), ['agendamentos', 'conversas_ia']);
});

test('fechamento com referência à reserva não duplica a reserva em Aguardando desfecho', () => {
  const event = close('chat', -3);
  event.raw_payload.appointment_id = 'antiga';
  const cards = flat(board([event], [booking('antiga', 'chat', 'confirmed')]));
  assert.deepEqual(cards.map((c) => c.col).sort(), ['aguardando_desfecho', 'finalizadas']);
});

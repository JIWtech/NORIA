// Incidente I&C Salon (09/11): erro técnico sem texto, "cliente não veio" + encerramento e arrasto
// na mesma coluna deixaram o Kanban com texto interno, etiqueta errada e card duplicado.
import test from 'node:test';
import assert from 'node:assert/strict';

import { eventsToKanban } from '../../src/services/kanban/eventsToKanban.js';
import { applyIncomingEventToKanban } from '../../src/services/kanban/applyIncomingEvent.js';
import { reconcilePendingKanbanMoves } from '../../src/services/kanban/pendingKanbanMoves.js';

const CHAT = '5521900000001@s.whatsapp.net';
const base = { tenant_slug: 'ic_salon', channel_type: 'whatsapp', external_conversation_id: CHAT, contact_name: 'Cliente Teste', raw_payload: {} };
const ev = (id, at, overrides) => ({ ...base, id, created_at: `2026-11-09T${at}.000Z`, ...overrides });
const message = (id, at, direction, text, overrides = {}) => ev(id, at, {
  direction, sender_type: direction === 'inbound' ? 'contact' : 'assistant', service: 'geral', stage: 'Conversas IA',
  delivery_status: direction === 'inbound' ? 'received' : 'sent', handoff: false, ai_provider: 'gemini', message_text: text, ...overrides,
});
const technicalError = ev('e-tech', '12:40:13', {
  direction: 'outbound', sender_type: 'system', service: 'technical_error', stage: 'Erro técnico',
  delivery_status: 'failed', handoff: false, ai_provider: 'core_error', message_text: '',
});
const noShowClose = ev('e-noshow', '12:42:01', {
  direction: 'outbound', sender_type: 'system', service: 'conversation_closed', stage: 'Finalizado', delivery_status: 'closed',
  ai_provider: 'conversation_closed', message_text: 'Atendimento encerrado: cliente não veio',
  raw_payload: { command: 'appointment_outcome', close_reason: 'no_show', appointment_id: 'appt-1' },
});
const plainClose = ev('e-close', '12:43:00', {
  direction: 'outbound', sender_type: 'system', service: 'conversation_closed', stage: 'Finalizado', delivery_status: 'closed',
  ai_provider: 'conversation_closed', message_text: 'Atendimento encerrado pela interface', raw_payload: { command: 'close_conversation' },
});
const config = { columns: [
  ['conversas_ia', 'Conversas IA'], ['aguardando_humano', 'Aguardando humano'], ['com_humano', 'Em atendimento humano'],
  ['agendamentos', 'Agendamentos'], ['finalizadas', 'Finalizadas'], ['nao_compareceu', 'Não compareceu'],
].map(([key, name], position) => ({ id: `${key}-uuid`, name, position, automation_key: key })) };

const allCards = (columns) => columns.flatMap((column) => column.cards.map((card) => ({ ...card, columnKey: column.automationKey || column.id })));
const cardsOfChat = (columns) => allCards(columns).filter((card) => card.externalConversationId === CHAT);
const build = (events) => eventsToKanban([...events].reverse(), 'ic_salon', [], config);

test('erro técnico sem texto não aparece como "technical_error" no card', () => {
  const columns = build([message('e1', '12:39:14', 'inbound', 'Tem vaga amanhã?'), technicalError]);
  const [card] = cardsOfChat(columns);
  assert.notEqual(card.subtitle, 'technical_error');
  assert.equal(card.subtitle, 'Atendimento precisa da equipe');
});

test('conversa encerrada por falta fica em "Não compareceu" sem a etiqueta de IA conduzindo', () => {
  const columns = build([message('e1', '12:39:14', 'inbound', 'Tem vaga amanhã?'), technicalError, noShowClose]);
  const cards = cardsOfChat(columns);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].columnKey, 'nao_compareceu');
  assert.equal(cards[0].aiReason, 'Cliente não compareceu');
});

test('tempo real: encerramento muda a coluna e a etiqueta junto, como a carga completa', () => {
  const initial = build([message('e1', '12:39:14', 'inbound', 'Tem vaga amanhã?')]);
  assert.equal(cardsOfChat(initial)[0].aiReason, 'IA conduzindo a conversa');

  const closed = applyIncomingEventToKanban(initial, plainClose, 'ic_salon');
  const [card] = cardsOfChat(closed);
  assert.equal(card.columnKey, 'finalizadas');
  assert.equal(card.targetColumnId, 'finalizadas', 'o painel precisa saber em que coluna o card está');
  assert.equal(card.aiReason, 'Atendimento finalizado');

  const noShow = applyIncomingEventToKanban(initial, noShowClose, 'ic_salon');
  const [missed] = cardsOfChat(noShow);
  assert.equal(missed.columnKey, 'nao_compareceu', 'mesma coluna que a carga completa usa para a falta');
  assert.equal(missed.targetColumnId, 'nao_compareceu');
  assert.notEqual(missed.aiReason, 'IA conduzindo a conversa');
});

const pendingMove = (card, targetKey, extra = {}) => new Map([[card.id, {
  targetColumnKey: targetKey, targetColObj: { id: targetKey, automationKey: targetKey, title: 'Finalizadas' },
  targetStageLabel: 'Finalizadas', card, moveSeq: 1, inFlight: false, completedAt: Date.now(), timestamp: Date.now(), ...extra,
}]]);
const staleSnapshot = { id: 'card-e-tech', channelType: 'whatsapp', externalConversationId: CHAT, subtitle: 'technical_error', aiReason: 'IA conduzindo a conversa', targetColumnId: 'conversas_ia' };

test('arrasto: card com id novo vindo do servidor não duplica a conversa', () => {
  // O próprio arrasto grava um evento, então o servidor devolve a conversa com outro id de card.
  const server = { kanbanColumns: build([message('e1', '12:39:14', 'inbound', 'Tem vaga amanhã?'), plainClose]) };
  assert.equal(cardsOfChat(server.kanbanColumns)[0].columnKey, 'finalizadas');

  const result = reconcilePendingKanbanMoves(server, pendingMove(staleSnapshot, 'finalizadas'), new Map());
  const cards = cardsOfChat(result.kanbanColumns);
  assert.equal(cards.length, 1, cards.map((card) => card.id).join(', '));
  assert.notEqual(cards[0].subtitle, 'technical_error', 'fica o card atualizado do servidor, não a cópia antiga');
});

test('arrasto ainda não refletido no servidor: o card atual vai para o destino, sem cópia', () => {
  const server = { kanbanColumns: build([message('e1', '12:39:14', 'inbound', 'Tem vaga amanhã?')]) };
  const result = reconcilePendingKanbanMoves(server, pendingMove(staleSnapshot, 'finalizadas', { inFlight: true }), new Map());
  const cards = cardsOfChat(result.kanbanColumns);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].columnKey, 'finalizadas');
  assert.equal(cards[0].subtitle, 'Tem vaga amanhã?');
});

test('arrasto da conversa não leva junto o card de follow-up do mesmo contato', () => {
  const server = { kanbanColumns: build([message('e1', '12:39:14', 'inbound', 'Tem vaga amanhã?')]) };
  server.kanbanColumns.push({ id: 'follow_ups', automationKey: 'follow_ups', title: 'Follow Ups', cards: [{
    id: 'follow-up-job-1', channelType: 'whatsapp', externalConversationId: CHAT, subtitle: 'Retomada automática programada.', targetColumnId: 'follow_ups',
  }] });
  const result = reconcilePendingKanbanMoves(server, pendingMove(staleSnapshot, 'finalizadas', { inFlight: true }), new Map());
  const followUps = result.kanbanColumns.find((column) => column.id === 'follow_ups').cards;
  assert.deepEqual(followUps.map((card) => card.id), ['follow-up-job-1']);
  assert.equal(cardsOfChat(result.kanbanColumns).filter((card) => card.columnKey === 'finalizadas').length, 1);
});

test('arrasto confirmado com o mesmo id continua respeitado (comportamento anterior)', () => {
  const server = { kanbanColumns: build([message('e1', '12:39:14', 'inbound', 'Tem vaga amanhã?')]) };
  const [current] = cardsOfChat(server.kanbanColumns);
  // O painel passa a coluna montada (a chave do banco "com_humano" é normalizada pelo quadro).
  const humanColumn = server.kanbanColumns.find((column) => column.title === 'Em atendimento humano');
  const targetKey = humanColumn.automationKey || humanColumn.id;
  const confirmed = new Map([[current.id, {
    targetColumnKey: targetKey, targetColObj: humanColumn, targetStageLabel: humanColumn.title,
    card: current, confirmedAt: Date.now(),
  }]]);
  const result = reconcilePendingKanbanMoves(server, new Map(), confirmed);
  const cards = cardsOfChat(result.kanbanColumns);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].columnKey, targetKey);
});

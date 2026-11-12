import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsToKanban } from '../../src/dataService.js';
import { mapAppointment } from '../../src/services/appointments/appointmentPresentation.js';
import { availableOutcomes } from '../../src/services/appointments/appointmentOutcome.js';
import {
  appointmentRequestErrorMessage,
  appointmentRequestState,
  mergeOpenAppointmentRequests,
} from '../../src/services/appointments/appointmentRequest.js';

const CHAT = '5521999990001@s.whatsapp.net';
const NOW = Date.parse('2026-11-10T15:00:00Z');
const FUTURE = '2026-11-12T13:00:00Z';
const request = (overrides = {}) => mapAppointment({
  id: 'ap-1', title: 'Corte - Maria Silva', starts_at: FUTURE, ends_at: null, status: 'pending_confirmation', contact_name: 'Maria Silva',
  channel_type: 'whatsapp', external_conversation_id: CHAT, created_at: '2026-11-10T12:00:00Z', updated_at: '2026-11-10T12:00:00Z',
  metadata: { services: ['Corte'], request_version: 2, request_updated_at: '2026-11-10T12:00:00Z', professional: 'Ana', first_visit: 'sim' },
  ...overrides,
});
const event = (overrides = {}) => ({
  id: 'e-1', tenant_slug: 'ic_salon', channel_type: 'whatsapp', external_conversation_id: CHAT, contact_name: 'Maria Silva', direction: 'inbound',
  sender_type: 'contact', message_text: 'Ok', created_at: '2026-11-10T14:00:00Z', stage: 'Em atendimento', service: 'geral', ...overrides,
});
const keys = ['conversas_ia', 'aguardando_humano', 'confirmar_agendamento', 'agendamentos', 'finalizadas'];
const config = (withColumn = true) => ({ columns: keys.filter((key) => withColumn || key !== 'confirmar_agendamento').map((key, position) => ({ id: key, title: key, automationKey: key, position })) });
const columnOf = (columns) => columns.find((column) => column.cards.some((card) => card.externalConversationId === CHAT));
const cardOf = (columns) => columnOf(columns)?.cards.find((card) => card.externalConversationId === CHAT);

test('pedido aberto vai para a coluna e traz a ação de confirmar', () => {
  const columns = eventsToKanban([], 'ic_salon', [request()], config());
  assert.equal(columnOf(columns).id, 'confirmar_agendamento');
  assert.equal(cardOf(columns).actionType, 'confirm_request');
});

test('nova mensagem da cliente não tira o cartão da coluna', () => {
  const columns = eventsToKanban([event()], 'ic_salon', [request()], config());
  assert.equal(columnOf(columns).id, 'confirmar_agendamento');
  assert.equal(columns.flatMap((column) => column.cards).filter((card) => card.externalConversationId === CHAT).length, 1);
});

test('conversa travada fica em Aguardando humano, mantendo os botões', () => {
  const held = event({ direction: 'outbound', sender_type: 'assistant', handoff: true, stage: 'Atendimento humano', service: 'atendimento_humano' });
  const columns = eventsToKanban([held], 'ic_salon', [request()], config());
  assert.equal(columnOf(columns).id, 'aguardando_humano');
  assert.equal(cardOf(columns).actionType, 'confirm_request');
  assert.equal(cardOf(columns).appointmentMetadata.request_version, 2);
});

test('quadro sem a coluna usa Agendamentos', () => {
  assert.equal(columnOf(eventsToKanban([], 'ic_salon', [request()], config(false))).id, 'agendamentos');
});

test('pedido aberto tem prioridade sobre agendamento confirmado mais recente da mesma conversa', () => {
  const confirmed = request({ id: 'ap-2', status: 'confirmed', updated_at: '2026-11-10T14:30:00Z', created_at: '2026-11-10T14:30:00Z' });
  const columns = eventsToKanban([], 'ic_salon', [request(), confirmed], config());
  assert.equal(columnOf(columns).id, 'confirmar_agendamento');
});

test('agendamento confirmado segue como antes', () => {
  const columns = eventsToKanban([], 'ic_salon', [request({ status: 'confirmed' })], config());
  assert.equal(columnOf(columns).id, 'agendamentos');
  assert.equal(cardOf(columns).actionType, '');
});

test('pedido cancelado sai da coluna', () => {
  const columns = eventsToKanban([event()], 'ic_salon', [request({ status: 'cancelled' })], config());
  assert.notEqual(columnOf(columns).id, 'confirmar_agendamento');
});

test('pedido aberto não recebe desfecho', () => {
  assert.deepEqual(availableOutcomes({ startsAt: '2020-01-01T10:00:00Z', status: 'pending_confirmation' }, NOW), []);
});

test('rótulo do status', () => {
  assert.equal(request().statusLabel, 'Aguardando confirmação');
});

test('estado do cartão: resumo, duração em aberto e confirmação liberada', () => {
  const state = appointmentRequestState({ startsAt: FUTURE, metadata: request().raw.metadata }, { now: NOW });
  assert.deepEqual(state.services, ['Corte']);
  assert.equal(state.professional, 'Ana');
  assert.equal(state.firstVisit, 'sim');
  assert.equal(state.version, 2);
  assert.equal(state.durationUnknown, true);
  assert.equal(state.canConfirm, true);
  assert.equal(state.stale, false);
});

test('pedido vencido só pode ser recusado', () => {
  const state = appointmentRequestState({ startsAt: '2026-11-10T14:00:00Z', metadata: {} }, { now: NOW });
  assert.equal(state.expired, true);
  assert.equal(state.canConfirm, false);
  assert.equal(state.canReject, true);
});

test('pedido parado alerta depois do prazo configurado', () => {
  const metadata = { request_updated_at: '2026-11-10T10:00:00Z' };
  assert.equal(appointmentRequestState({ startsAt: FUTURE, metadata }, { now: NOW, staleHours: 4 }).stale, true);
  assert.equal(appointmentRequestState({ startsAt: FUTURE, metadata }, { now: NOW, staleHours: 6 }).stale, false);
  assert.equal(appointmentRequestState({ startsAt: FUTURE, metadata }, { now: NOW }).stale, false, 'sem prazo não alerta');
});

test('entrega incerta troca os botões pela verificação', () => {
  const state = appointmentRequestState({ startsAt: FUTURE, metadata: { confirmation_state: 'uncertain' } }, { now: NOW });
  assert.equal(state.uncertain, true);
  assert.equal(state.canConfirm, false);
  assert.equal(state.canReject, false);
});

test('envio em andamento bloqueia confirmação, recusa e verificação de entrega', () => {
  const state = appointmentRequestState({ startsAt: FUTURE, metadata: { confirmation_state: 'sending' } }, { now: NOW });
  assert.equal(state.sending, true);
  assert.equal(state.uncertain, false);
  assert.equal(state.canConfirm, false);
  assert.equal(state.canReject, false);
});

test('o dono entende por que a ação foi recusada, sem ver a mensagem crua do servidor', () => {
  const fallback = 'Não foi possível confirmar o agendamento.';
  const message = (text) => appointmentRequestErrorMessage(new Error(text), fallback);
  assert.match(message('Pedido alterado pela cliente. Atualize o quadro.'), /cliente mudou este pedido/);
  assert.match(message('Pedido alterado por outro operador. Atualize o quadro.'), /Outra pessoa/);
  assert.match(message('Entrega nao comprovada. Verifique no WhatsApp antes de tentar novamente.'), /WhatsApp/);
  assert.match(message('Envio em andamento ou entrega incerta. Verifique no WhatsApp antes de tentar novamente.'), /WhatsApp/);
  assert.match(message('O horario deste pedido ja passou'), /já passou/);
  assert.match(message('Este pedido nao esta mais aguardando confirmacao'), /já foi resolvido/);
  assert.equal(message('TypeError: fetch failed https://x.test?key=segredo'), fallback);
});

test('pedidos abertos entram na lista sem duplicar e fora do limite de 200', () => {
  const loaded = [{ id: 'a' }, { id: 'b' }];
  const merged = mergeOpenAppointmentRequests(loaded, [{ id: 'b' }, { id: 'c' }]);
  assert.deepEqual(merged.map((item) => item.id), ['a', 'b', 'c']);
});

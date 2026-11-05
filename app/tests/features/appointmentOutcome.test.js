import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsToKanban } from '../../src/dataService.js';
import { mapAppointment } from '../../src/services/appointments/appointmentPresentation.js';
import {
  availableOutcomes,
  buildDepositRequiredIndex,
  createLoadDepositRequired,
  createMarkAppointmentOutcome,
  isDepositRequired,
  isOutcomeTrackingEnabled,
} from '../../src/services/appointments/appointmentOutcome.js';

const CHAT = '5521999990001@s.whatsapp.net';
const NOW = Date.parse('2026-11-10T15:00:00Z');
const row = (overrides = {}) => ({
  id: 'ap-1', title: 'Corte - Maria', starts_at: '2026-11-10T12:00:00Z', ends_at: '2026-11-10T13:00:00Z',
  status: 'confirmed', channel_type: 'whatsapp', external_conversation_id: CHAT, contact_name: 'Maria',
  created_at: '2026-11-08T10:00:00Z', updated_at: '2026-11-08T10:00:00Z', metadata: {}, ...overrides,
});
const kanbanConfig = (withNoShow = true) => ({ columns: [
  { id: 'c1', name: 'Conversas IA', automation_key: 'conversas_ia', position: 0 },
  { id: 'c2', name: 'Aguardando humano', automation_key: 'aguardando_humano', position: 1 },
  { id: 'c4', name: 'Agendamentos', automation_key: 'agendamentos', position: 4 },
  { id: 'c5', name: 'Finalizadas', automation_key: 'finalizadas', position: 5 },
  ...(withNoShow ? [{ id: 'c6', name: 'Não compareceu', automation_key: 'nao_compareceu', position: 6 }] : []),
] });
const event = (overrides = {}) => ({
  id: `e-${Math.random()}`, tenant_slug: 'ic_salon', channel_type: 'whatsapp', external_conversation_id: CHAT,
  external_message_id: `m-${Math.random()}`, direction: 'inbound', sender_type: 'contact', contact_name: 'Maria',
  message_text: 'oi', stage: 'Qualificacao', handoff: false, ai_provider: 'gemini', delivery_status: 'received',
  created_at: '2026-11-09T10:00:00Z', raw_payload: {}, ...overrides,
});
const closeEvent = (reason, at) => event({
  direction: 'outbound', sender_type: 'system', message_text: 'Atendimento encerrado', service: 'conversation_closed',
  stage: 'Finalizado', ai_provider: 'conversation_closed', delivery_status: 'closed', created_at: at,
  raw_payload: reason ? { close_reason: reason } : {},
});
const columnOf = (columns, predicate) => columns.find((column) => column.cards.some(predicate))?.automationKey || null;

test('rótulos: não compareceu e compareceu aparecem em português', () => {
  assert.equal(mapAppointment(row({ status: 'no_show' })).statusLabel, 'Não compareceu');
  assert.equal(mapAppointment(row({ status: 'completed' })).statusLabel, 'Compareceu');
  assert.equal(mapAppointment(row({ status: 'confirmed' })).statusLabel, 'Confirmado');
});

test('desfechos disponíveis dependem do horário e do status do agendamento', () => {
  const at = (overrides) => mapAppointment(row(overrides));
  assert.deepEqual(availableOutcomes(at({}), NOW), ['attended', 'no_show']);
  assert.deepEqual(availableOutcomes(at({ starts_at: '2026-11-10T18:00:00Z' }), NOW), [], 'ainda não começou');
  assert.deepEqual(availableOutcomes(at({ status: 'cancelled' }), NOW), []);
  assert.deepEqual(availableOutcomes(at({ status: 'no_show' }), NOW), ['attended'], 'corrige para compareceu');
  assert.deepEqual(availableOutcomes(at({ status: 'completed' }), NOW), ['no_show'], 'corrige para não veio');
  assert.deepEqual(availableOutcomes(null, NOW), []);
});

test('o recurso só liga para tenants que o habilitaram nas configurações', () => {
  assert.equal(isOutcomeTrackingEnabled({ settings: { appointment_outcome_tracking: true } }), true);
  assert.equal(isOutcomeTrackingEnabled({ settings: { appointment_outcome_tracking: 'true' } }), false, 'só o booleano true liga');
  assert.equal(isOutcomeTrackingEnabled({ settings: {} }), false);
  assert.equal(isOutcomeTrackingEnabled({ settings: { appointment_outcome_tracking: false } }), false);
  assert.equal(isOutcomeTrackingEnabled(null), false);
  assert.equal(isOutcomeTrackingEnabled(undefined), false);
});

test('o cartão de agendamento carrega o horário para a tela decidir se o desfecho já pode ser registrado', () => {
  const appointments = [mapAppointment(row({ status: 'confirmed' }))];
  const card = eventsToKanban([], 'ic_salon', appointments, kanbanConfig(true)).flatMap((column) => column.cards).find((item) => item.appointmentId === 'ap-1');
  assert.equal(card.appointmentStartsAt, '2026-11-10T12:00:00Z');
  const withEvent = eventsToKanban([event({ created_at: '2026-11-11T09:00:00Z' })], 'ic_salon', appointments, kanbanConfig(true))
    .flatMap((column) => column.cards).find((item) => item.externalConversationId === CHAT);
  assert.equal(withEvent.appointmentStartsAt, '2026-11-10T12:00:00Z', 'também quando o cartão vem da conversa');
});

test('índice de sinal obrigatório reconhece o mesmo contato pelo identificador canônico', () => {
  const index = buildDepositRequiredIndex([{ channel_type: 'whatsapp', external_conversation_id: CHAT, appointment_id: 'ap-1', last_no_show_at: '2026-11-10T12:00:00Z' }]);
  assert.equal(isDepositRequired(index, 'whatsapp', CHAT)?.appointmentId, 'ap-1');
  assert.equal(isDepositRequired(index, 'whatsapp', '5521999990001')?.appointmentId, 'ap-1', 'sem o sufixo do JID');
  assert.equal(isDepositRequired(index, 'whatsapp', '5521888880002@s.whatsapp.net'), null);
  assert.equal(isDepositRequired(index, 'whatsapp', ''), null);
  assert.equal(isDepositRequired(buildDepositRequiredIndex(null), 'whatsapp', CHAT), null);
});

test('marcar desfecho chama a função do banco e traduz os erros esperados', async () => {
  const calls = [];
  const client = (error = null) => ({ rpc: async (name, args) => { calls.push({ name, args }); return error ? { data: null, error } : { data: { ok: true, status: 'no_show', closed_conversation: true }, error: null }; } });
  const ok = await createMarkAppointmentOutcome({ getClient: () => client() })('ap-1', 'no_show', '  não avisou  ');
  assert.deepEqual(calls[0], { name: 'magia_mark_appointment_outcome', args: { p_appointment: 'ap-1', p_outcome: 'no_show', p_note: 'não avisou' } });
  assert.equal(ok.closed_conversation, true);
  await assert.rejects(createMarkAppointmentOutcome({ getClient: () => client({ message: 'APPOINTMENT_NOT_STARTED' }) })('ap-1', 'no_show'), /ainda não começou/);
  await assert.rejects(createMarkAppointmentOutcome({ getClient: () => client({ message: 'APPOINTMENT_OUTCOME_FORBIDDEN' }) })('ap-1', 'no_show'), /permissão/);
  await assert.rejects(createMarkAppointmentOutcome({ getClient: () => null })('ap-1', 'no_show'), /Supabase/);
  await assert.rejects(createMarkAppointmentOutcome({ getClient: () => client() })('ap-1', 'invalido'), /desfecho/i);
});

test('carregar a lista de sinal obrigatório nunca derruba a tela', async () => {
  const calls = [];
  const rows = [{ channel_type: 'whatsapp', external_conversation_id: CHAT, appointment_id: 'ap-1', last_no_show_at: '2026-11-10T12:00:00Z' }];
  const load = (rpc) => createLoadDepositRequired({ getClient: () => ({ rpc }), loadTenant: async (slug) => (slug === 'ic_salon' ? { id: 'tenant-1' } : null) });
  const index = await load(async (name, args) => { calls.push({ name, args }); return { data: rows, error: null }; })('ic_salon');
  assert.deepEqual(calls[0], { name: 'magia_deposit_required_contacts', args: { p_tenant: 'tenant-1' } });
  assert.ok(isDepositRequired(index, 'whatsapp', CHAT));
  assert.equal((await load(async () => ({ data: null, error: { message: 'boom' } }))('ic_salon')).size, 0, 'erro vira lista vazia');
  assert.equal((await load(async () => { throw new Error('rede'); })('ic_salon')).size, 0, 'exceção vira lista vazia');
  assert.equal((await load(async () => ({ data: rows, error: null }))('outro')).size, 0, 'tenant desconhecido');
  assert.equal((await createLoadDepositRequired({ getClient: () => null, loadTenant: async () => ({ id: 't' }) })('ic_salon')).size, 0, 'sem cliente Supabase');
});

test('Kanban: agendamento "não compareceu" vai para a coluna própria e cai em Agendamentos sem ela', () => {
  const appointments = [mapAppointment(row({ status: 'no_show', updated_at: '2026-11-10T14:00:00Z' }))];
  const withColumn = eventsToKanban([], 'ic_salon', appointments, kanbanConfig(true));
  assert.equal(columnOf(withColumn, (card) => card.appointmentId === 'ap-1'), 'nao_compareceu');
  const without = eventsToKanban([], 'ic_salon', appointments, kanbanConfig(false));
  assert.equal(columnOf(without, (card) => card.appointmentId === 'ap-1'), 'agendamentos', 'outros quadros não mudam');
  const confirmed = [mapAppointment(row({}))];
  assert.equal(columnOf(eventsToKanban([], 'ic_salon', confirmed, kanbanConfig(true)), (card) => card.appointmentId === 'ap-1'), 'agendamentos');
});

test('Kanban: encerramento por "cliente não veio" usa a coluna própria; encerramento comum segue em Finalizadas', () => {
  const find = (events, config) => columnOf(eventsToKanban(events, 'ic_salon', [], config), (card) => card.externalConversationId === CHAT);
  const noShow = [event({ created_at: '2026-11-09T10:00:00Z' }), closeEvent('no_show', '2026-11-10T14:00:00Z')];
  assert.equal(find(noShow, kanbanConfig(true)), 'nao_compareceu');
  assert.equal(find(noShow, kanbanConfig(false)), 'finalizadas', 'sem a coluna, comportamento antigo');
  const plain = [event({ created_at: '2026-11-09T10:00:00Z' }), closeEvent(null, '2026-11-10T14:00:00Z')];
  assert.equal(find(plain, kanbanConfig(true)), 'finalizadas', 'encerramento comum não vira falta');
});

test('Kanban: se o cliente volta a falar depois da falta, o cartão sai da coluna de não compareceu', () => {
  const events = [
    event({ created_at: '2026-11-09T10:00:00Z' }),
    closeEvent('no_show', '2026-11-10T14:00:00Z'),
    event({ message_text: 'oi, queria remarcar', created_at: '2026-11-11T09:00:00Z' }),
  ];
  const column = columnOf(eventsToKanban(events, 'ic_salon', [], kanbanConfig(true)), (card) => card.externalConversationId === CHAT);
  assert.notEqual(column, 'nao_compareceu');
  assert.ok(column, 'continua com um cartão');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_NO_SHOW_TEMPLATE, MISSING_VALUE_MARKER, buildNoShowPreview, createLoadServiceCatalog, noShowDeposit,
  noShowMessageConfig, renderNoShowMessage, sendNoShowMessageThenMark,
} from '../../src/services/appointments/noShowMessage.js';
import { mapAppointment } from '../../src/services/appointments/appointmentPresentation.js';

const timeZone = 'America/Sao_Paulo';
const catalog = [
  { external_id: 'servico_corte', name: 'Corte', price: 140, metadata: { price_type: 'fixed' } },
  { external_id: 'servico_escova', name: 'Escova', price: 50, metadata: { price_type: 'from' } },
  { external_id: 'servico_mechas', name: 'Mechas loiras', price: null, metadata: { price_type: 'from' } },
];
const tenantSettings = {
  timezone: timeZone,
  settings: { appointment_outcome_tracking: true, payment: { pix_key: '21900000000', pix_holder: 'Salão Teste' } },
};
const appointment = (metadata = { services: ['Corte'] }, extra = {}) => mapAppointment({
  id: 'appt-1', status: 'confirmed', starts_at: '2026-11-10T17:30:00Z', title: 'Corte - Ana Souza',
  contact_name: 'Ana Souza', channel_type: 'whatsapp', external_conversation_id: '5521999990000@s.whatsapp.net',
  metadata, ...extra,
});

test('mensagem de falta só fica disponível com acompanhamento de desfecho, Pix e conversa de WhatsApp', () => {
  assert.equal(noShowMessageConfig(tenantSettings, appointment()).enabled, true);
  assert.equal(noShowMessageConfig({ settings: { ...tenantSettings.settings, appointment_outcome_tracking: false } }, appointment()).enabled, false);
  assert.equal(noShowMessageConfig({ settings: { appointment_outcome_tracking: true, payment: {} } }, appointment()).enabled, false);
  assert.equal(noShowMessageConfig(tenantSettings, appointment(undefined, { channel_type: 'manual', external_conversation_id: '' })).enabled, false);
  assert.equal(noShowMessageConfig(tenantSettings, appointment()).template, DEFAULT_NO_SHOW_TEMPLATE);
  const custom = { ...tenantSettings, settings: { ...tenantSettings.settings, appointment_outcome: { no_show_message_template: 'Oi {nome}' } } };
  assert.equal(noShowMessageConfig(custom, appointment()).template, 'Oi {nome}');
});

test('sinal é 50% do catálogo, soma serviços e deixa explícito quando o preço é "a partir de"', () => {
  assert.deepEqual(noShowDeposit(appointment(), catalog), { cents: 7000, from: false, missing: [] });
  assert.deepEqual(noShowDeposit(appointment({ services: ['corte', 'Escova'] }), catalog), { cents: 9500, from: true, missing: [] });
  assert.deepEqual(noShowDeposit(appointment({ service_id: 'servico_escova' }), catalog), { cents: 2500, from: true, missing: [] });
  assert.deepEqual(noShowDeposit(appointment({ services: ['Mechas loiras'] }), catalog), { cents: 0, from: true, missing: ['Mechas loiras'] });
  assert.deepEqual(noShowDeposit(appointment({ services: ['Unha'] }), catalog), { cents: 0, from: false, missing: ['Unha'] });
});

test('template substitui todos os placeholders e mantém os desconhecidos', () => {
  const text = renderNoShowMessage('{nome}|{servicos}|{data}|{hora}|{valor_sinal}|{pix_key}|{pix_holder}|{outro}', {
    nome: 'Ana', servicos: 'Corte', data: '10/11', hora: '14:30', valor_sinal: 'R$ 70,00', pix_key: 'k', pix_holder: 'h',
  });
  assert.equal(text, 'Ana|Corte|10/11|14:30|R$ 70,00|k|h|{outro}');
});

test('prévia usa primeiro nome, data e hora no fuso do tenant, valor e Pix das configurações', () => {
  const preview = buildNoShowPreview(appointment({ services: ['Corte', 'Escova'] }), { catalog, tenantSettings });
  assert.match(preview.text, /^Olá, Ana!/);
  assert.match(preview.text, /10\/11 às 14:30/);
  assert.match(preview.text, /Corte \+ Escova/);
  assert.match(preview.text, /a partir de R\$\s?95,00/);
  assert.match(preview.text, /21900000000/);
  assert.match(preview.text, /Salão Teste/);
  assert.deepEqual(preview.warnings, ['O valor de um ou mais serviços é "a partir de": o sinal mostrado é o mínimo.']);
  assert.equal(preview.canSend, true);

  const missing = buildNoShowPreview(appointment({ services: ['Unha'] }), { catalog, tenantSettings });
  assert.ok(missing.text.includes(MISSING_VALUE_MARKER));
  assert.equal(missing.canSend, false);
  assert.match(missing.warnings[0], /Unha/);
});

test('envio manda manual_reply antes de registrar a falta, para a conversa terminar encerrada', async () => {
  const calls = [];
  const sendCommand = async (command, payload, tenantSlug) => { calls.push(['send', command, payload, tenantSlug]); return { ok: true }; };
  const markOutcome = async (id, outcome) => { calls.push(['mark', id, outcome]); return { ok: true, closed_conversation: true }; };
  await sendNoShowMessageThenMark({ appointment: appointment(), text: '  Olá, Ana!  ', tenantSlug: 'ic_salon', sentBy: 'Bia', sendCommand, markOutcome });
  assert.deepEqual(calls, [
    ['send', 'manual_reply', {
      channel_type: 'whatsapp', external_conversation_id: '5521999990000@s.whatsapp.net', contact_name: 'Ana Souza',
      message_text: 'Olá, Ana!', sent_by_user: 'Bia',
    }, 'ic_salon'],
    ['mark', 'appt-1', 'no_show'],
  ]);
});

test('falha no envio não registra a falta; falha ao registrar avisa que a mensagem já saiu', async () => {
  const marks = [];
  const markOutcome = async (id, outcome) => { marks.push([id, outcome]); };
  await assert.rejects(() => sendNoShowMessageThenMark({ appointment: appointment(), text: 'Oi', sendCommand: async () => { throw new Error('Evolution fora'); }, markOutcome }),
    (error) => error.messageSent === false && /Evolution fora/.test(error.message));
  assert.equal(marks.length, 0);

  await assert.rejects(() => sendNoShowMessageThenMark({ appointment: appointment(), text: 'Oi', sendCommand: async () => ({ ok: true }),
    markOutcome: async () => { throw new Error('APPOINTMENT_NOT_STARTED'); } }),
  (error) => error.messageSent === true && /mensagem foi enviada/.test(error.message));

  await assert.rejects(() => sendNoShowMessageThenMark({ appointment: appointment(), text: '   ', sendCommand: async () => ({ ok: true }), markOutcome }), /mensagem/);
  await assert.rejects(() => sendNoShowMessageThenMark({ appointment: appointment(), text: `Valor ${MISSING_VALUE_MARKER}`, sendCommand: async () => ({ ok: true }), markOutcome }), /valor/);
  await assert.rejects(() => sendNoShowMessageThenMark({ appointment: appointment(), text: 'Oi', sendCommand: async () => ({ ok: false, error: 'falhou' }), markOutcome }),
    (error) => error.messageSent === false);
  assert.equal(marks.length, 0);
});

test('catálogo de preços é lido do tenant ativo e falha vira lista vazia', async () => {
  const calls = [];
  const client = {
    from(table) {
      const chain = {
        select(value) { calls.push(['select', table, value]); return chain; },
        eq(column, value) { calls.push(['eq', column, value]); return chain; },
        then(resolve) { return Promise.resolve({ data: catalog, error: null }).then(resolve); },
      };
      return chain;
    },
  };
  const load = createLoadServiceCatalog({ getClient: () => client, loadTenant: async (slug) => ({ id: `tenant-${slug}` }) });
  assert.deepEqual(await load('ic_salon'), catalog);
  assert.deepEqual(calls, [['select', 'tenant_service_catalog', 'external_id,name,price,metadata'], ['eq', 'tenant_id', 'tenant-ic_salon'], ['eq', 'active', true]]);
  const failing = createLoadServiceCatalog({ getClient: () => null, loadTenant: async () => null });
  assert.deepEqual(await failing('ic_salon'), []);
});

test('card do Kanban vira agendamento para a prévia de falta', async () => {
  const { appointmentFromKanbanCard } = await import('../../src/services/appointments/noShowMessage.js');
  const card = { id: 'conv-1', title: 'Outro Contato', appointmentContactName: 'Ana Souza', appointmentId: 'appt-1', appointmentStatus: 'confirmed', appointmentStartsAt: '2026-11-10T17:30:00Z',
    appointmentTitle: 'Corte', appointmentMetadata: { services: ['Corte'] }, channelType: 'whatsapp', externalConversationId: '5521@s.whatsapp.net' };
  const appointment = appointmentFromKanbanCard(card);
  assert.equal(noShowMessageConfig(tenantSettings, appointment).enabled, true);
  assert.match(buildNoShowPreview(appointment, { catalog, tenantSettings }).text, /^Olá, Ana! .*R\$\s?70,00/);
});

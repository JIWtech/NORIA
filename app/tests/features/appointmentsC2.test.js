import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import * as Select from '@radix-ui/react-select';
import * as lucide from 'lucide-react';
import { createAppointmentDataService } from '../../src/services/appointments/appointmentDataService.js';
import { schedulingCacheByTenant, tenantCacheEpoch } from '../../src/services/tenants/tenantScopedCaches.js';
import * as conversationIdentity from '../../src/services/identity/conversationIdentity.js';
import * as appointmentOutcome from '../../src/services/appointments/appointmentOutcome.js';
import * as appointmentAgenda from '../../src/services/appointments/appointmentAgenda.js';
import * as appointmentActions from '../../src/services/appointments/appointmentActions.js';
import * as noShowMessage from '../../src/services/appointments/noShowMessage.js';
import * as renderWindow from '../../src/utils/renderWindow.js';
import * as userFacingError from '../../src/utils/userFacingError.js';
import * as cancellationFlow from '../../src/features/appointments/components/cancellationFlow.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const noriaSelectPath = path.resolve(__dirname, '../../src/components/NoriaSelect.jsx');
const appointmentsPath = path.resolve(__dirname, '../../src/features/appointments/components/Appointments.jsx');

function transpileCjs(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  return ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
}

function loadNoriaSelect(selectModule = Select) {
  const code = transpileCjs(noriaSelectPath);
  const mod = { exports: {} };
  const fn = new Function('require', 'module', 'exports', code);
  fn((id) => {
    if (id === 'react') return React;
    if (id === '@radix-ui/react-select') return selectModule;
    if (id === 'lucide-react') return lucide;
    throw new Error(`Unexpected import in NoriaSelect.jsx: ${id}`);
  }, mod, mod.exports);
  return mod.exports.NoriaSelect;
}

function loadAppointmentsModule() {
  const NoriaSelect = loadNoriaSelect(Select);
  const stub = (name) => function Stub(props) {
    return React.createElement('div', { 'data-stub': name }, props?.children);
  };
  const code = transpileCjs(appointmentsPath);
  const mocks = {
    react: React,
    'lucide-react': lucide,
    '../../../utils/userFacingError.js': userFacingError,
    '../../../components/ui/Badge': { Badge: stub('Badge') },
    '../../../components/ui/PanelTitle': { PanelTitle: stub('PanelTitle') },
    '../../../components/ui/EmptyState': { EmptyState: stub('EmptyState') },
    '../../../components/ui/ChannelIcon': {
      ChannelIcon: stub('ChannelIcon'),
      getChannelClass: (ch) => `channel-${ch || 'whatsapp'}`,
    },
    '../../../components/ui/Skeletons': {
      SkeletonBlock: stub('SkeletonBlock'),
      SkeletonLine: stub('SkeletonLine'),
    },
    '../../../components/ui/ListLoadMore.jsx': { ListLoadMore: stub('ListLoadMore') },
    '../../../components/NoriaSelect': { NoriaSelect },
    '../../../utils/renderWindow.js': renderWindow,
    '../../../dataService': {
      loadAppointmentAvailability: async () => [],
      loadAppointmentScheduling: async () => ({ enabled: false }),
      saveAppointment: async () => ({}),
    },
    '../../../services/appointments/appointmentOutcome.js': appointmentOutcome,
    '../../../services/appointments/outcomeActions.js': {
      archiveAppointment: async () => ({}),
      markAppointmentOutcome: async () => ({}),
    },
    '../../../services/appointments/appointmentAgenda.js': appointmentAgenda,
    '../utils/useAppointmentClock.js': { useAppointmentClock: () => Date.now() },
    '../../../services/appointments/appointmentActions.js': appointmentActions,
    '../../../services/appointments/noShowMessage.js': noShowMessage,
    '../utils/useDepositRequired': { useDepositRequired: () => new Map() },
    './AppointmentOutcomeActions.jsx': { AppointmentOutcomeActions: stub('AppointmentOutcomeActions') },
    './AppointmentEditDialog.jsx': { AppointmentEditDialog: stub('AppointmentEditDialog') },
    './AppointmentCancelDialog.jsx': { AppointmentCancelDialog: stub('AppointmentCancelDialog') },
    './cancellationFlow.js': cancellationFlow,
    './AppointmentConfirmDialog.jsx': { AppointmentConfirmDialog: stub('AppointmentConfirmDialog') },
    './NoShowMessageDialog.jsx': { NoShowMessageDialog: stub('NoShowMessageDialog') },
    '../../../services/tenants/tenantScopedCaches.js': { schedulingCacheByTenant, tenantCacheEpoch },
    '../../../services/identity/conversationIdentity.js': conversationIdentity,
  };

  const mod = { exports: {} };
  const fn = new Function('require', 'module', 'exports', code);
  fn((id) => {
    if (Object.prototype.hasOwnProperty.call(mocks, id)) return mocks[id];
    throw new Error(`Unexpected import in Appointments.jsx: ${id}`);
  }, mod, mod.exports);
  return mod.exports;
}

test('C2: NoriaSelect mantém valor vazio controlado e filtra opções com value vazio', () => {
  const rootValues = [];
  const itemValues = [];
  const spySelect = {
    Root: ({ value, children }) => {
      rootValues.push(value);
      return React.createElement('div', { 'data-root-value': value === undefined ? 'undefined' : value }, children);
    },
    Trigger: ({ children, ...rest }) => React.createElement('button', rest, children),
    Value: ({ placeholder, children }) => React.createElement('span', null, children ?? placeholder),
    Icon: ({ children }) => React.createElement(React.Fragment, null, children),
    Portal: ({ children }) => React.createElement(React.Fragment, null, children),
    Content: ({ children }) => React.createElement('div', null, children),
    Viewport: ({ children }) => React.createElement('div', null, children),
    Group: ({ children }) => React.createElement('div', null, children),
    Label: ({ children }) => React.createElement('div', null, children),
    Item: ({ value, children }) => {
      if (value === '') throw new Error('Select.Item recebeu value vazio');
      itemValues.push(value);
      return React.createElement('div', { 'data-item-value': value }, children);
    },
    ItemText: ({ children }) => React.createElement('span', null, children),
    ItemIndicator: ({ children }) => React.createElement('span', null, children),
  };

  const SpyNoriaSelect = loadNoriaSelect(spySelect);
  const options = [
    { value: '', label: 'Vazia' },
    { value: null, label: 'Nula' },
    { value: undefined, label: 'Indefinida' },
    { value: 'unit-1', label: 'Unidade Centro' },
  ];

  const html = renderToStaticMarkup(
    React.createElement(SpyNoriaSelect, { value: '', onValueChange: () => {}, options, placeholder: 'Selecione' }),
  );
  assert.equal(rootValues[0], '');
  assert.deepEqual(itemValues, ['unit-1']);
  assert.match(html, /Selecione/);
  assert.doesNotMatch(html, /Vazia/);

  // Também funciona sem erro com o pacote real @radix-ui/react-select.
  const RealNoriaSelect = loadNoriaSelect(Select);
  const realHtml = renderToStaticMarkup(
    React.createElement(RealNoriaSelect, { value: '', onValueChange: () => {}, options, placeholder: 'Selecione' }),
  );
  assert.match(realHtml, /Selecione/);
});

test('C2: appointmentDataService.loadAppointmentAvailability valida Array.isArray(data?.available_starts) e retorna []', async () => {
  for (const responseData of [null, undefined, {}, { available_starts: null }, { available_starts: '09:00' }]) {
    const service = createAppointmentDataService({
      getClient: () => ({ rpc: async () => ({ data: responseData, error: null }) }),
      loadTenant: async () => ({ id: 'tenant-1' }),
    });
    const result = await service.loadAppointmentAvailability('tenant-1', 'unit-1', 'svc-1', '2026-12-01');
    assert.deepEqual(result, []);
  }

  const serviceOk = createAppointmentDataService({
    getClient: () => ({ rpc: async () => ({ data: { available_starts: ['09:00', '10:30'] }, error: null }) }),
    loadTenant: async () => ({ id: 'tenant-1' }),
  });
  assert.deepEqual(
    await serviceOk.loadAppointmentAvailability('tenant-1', 'unit-1', 'svc-1', '2026-12-01'),
    ['09:00', '10:30'],
  );
});

test('C2: Appointments renderiza sem erro quando schedule.units e schedule.services estão ausentes', () => {
  const { Appointments } = loadAppointmentsModule();
  schedulingCacheByTenant.set('tenant-c2', { enabled: true, tenantId: 't-c2' });
  try {
    const html = renderToStaticMarkup(
      React.createElement(Appointments, {
        appointments: [],
        conversations: [],
        tenantSlug: 'tenant-c2',
        ready: true,
      }),
    );
    assert.match(html, /Salvar agendamento/);
    assert.match(html, /Unidade/);
    assert.match(html, /Serviço/);
  } finally {
    schedulingCacheByTenant.delete('tenant-c2');
  }
});

test('C2: select de conversas diferencia canais com o mesmo externalConversationId sem quebrar o salvamento', () => {
  const {
    conversationSelectKey,
    findConversationForInitialData,
    buildAppointmentPayloadFromSelection,
  } = loadAppointmentsModule();

  const whatsappConv = {
    id: 'conv-wa',
    channelType: 'whatsapp',
    channel: 'WhatsApp',
    externalConversationId: '12345',
    contact: 'Maria WhatsApp',
  };
  const telegramConv = {
    id: 'conv-tg',
    channelType: 'telegram',
    channel: 'Telegram',
    externalConversationId: '12345',
    contact: 'Maria Telegram',
  };

  const waKey = conversationSelectKey(whatsappConv);
  const tgKey = conversationSelectKey(telegramConv);
  assert.notEqual(waKey, tgKey);
  assert.equal(waKey, 'whatsapp::12345');
  assert.equal(tgKey, 'telegram::12345');

  const matched = findConversationForInitialData([whatsappConv, telegramConv], {
    selectedConversationId: '12345',
    channelType: 'telegram',
    externalConversationId: '12345',
  });
  assert.equal(matched, telegramConv);
  assert.equal(findConversationForInitialData([whatsappConv, telegramConv], {
    selectedConversationId: '12345',
  }), null, 'ID legado ambíguo não deve vincular uma conversa arbitrária');
  assert.equal(findConversationForInitialData([whatsappConv], {
    selectedConversationId: '12345',
  }), whatsappConv, 'ID legado único continua compatível');

  const payload = buildAppointmentPayloadFromSelection({
    title: 'Avaliação',
    contactName: 'Maria Telegram',
    schedule: { enabled: true },
    unitId: 'u1',
    serviceId: 's1',
    localDate: '2026-12-01',
    localTime: '14:00',
    timeZone: 'America/Sao_Paulo',
    requestId: 'req-1',
    conversations: [whatsappConv, telegramConv],
    selectedConversationKey: tgKey,
  });
  assert.equal(payload.channelType, 'telegram');
  assert.equal(payload.externalConversationId, '12345');
});

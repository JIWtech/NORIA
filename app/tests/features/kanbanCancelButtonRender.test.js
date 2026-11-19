// Renderiza o Kanban de verdade (via Vite) para garantir que o botão de cancelar aparece no card de agendamento.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.join(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
let React;
let server;
let Kanban;

async function setup() {
  if (Kanban) return Kanban;
  const { createServer } = await import('vite');
  server = await createServer({
    root,
    configFile: false,
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true },
  });
  const mod = await server.ssrLoadModule('/src/features/kanban/components/Kanban.jsx');
  React = require('react');
  Kanban = mod.Kanban;
  return Kanban;
}

test.after(async () => { await server?.close(); });

const APPOINTMENT_CARD = {
  id: 'appointment-appt-1',
  title: 'Cliente Teste',
  subtitle: 'Pé e Unha',
  channelType: 'whatsapp',
  externalConversationId: '5521900000001@s.whatsapp.net',
  appointmentId: 'appt-1',
  appointmentStatus: 'confirmed',
  appointmentStartsAt: '2026-12-01T15:00:00.000Z',
  appointmentContactName: 'Cliente Teste',
  appointmentMetadata: { services: ['Pé e Unha'] },
  stage: 'Agendamento',
  targetColumnId: 'agendamentos',
};

async function render(overrides = {}) {
  const Kanban = await setup();
  const { renderToStaticMarkup } = require('react-dom/server');
  const props = {
    kanbanColumns: [{ id: 'agendamentos', name: 'Agendamentos', title: 'Agendamentos', position: 0, automationKey: 'agendamentos', cards: [APPOINTMENT_CARD] }],
    tenantSlug: 'ic_salon',
    tenantName: 'I&C Salon',
    tenantSettings: { timezone: 'America/Sao_Paulo', settings: { appointment_outcome_tracking: { enabled: true } } },
    ...overrides,
  };
  return renderToStaticMarkup(React.createElement(Kanban, props));
}

function columnWith(cards) {
  return [{ id: 'agendamentos', name: 'Agendamentos', title: 'Agendamentos', position: 0, automationKey: 'agendamentos', cards }];
}

test('o card de agendamento mostra o botão de cancelar', async () => {
  const html = await render();
  assert.match(html, /kanban-card-cancel/);
  assert.match(html, /Cancelar/);
});

test('o card sem agendamento não mostra o botão de cancelar', async () => {
  const html = await render({ kanbanColumns: columnWith([{ ...APPOINTMENT_CARD, id: 'card-e1', appointmentId: '', appointmentStatus: '' }]) });
  assert.doesNotMatch(html, /kanban-card-cancel/);
});

test('agendamento já cancelado não mostra o botão de cancelar', async () => {
  const html = await render({ kanbanColumns: columnWith([{ ...APPOINTMENT_CARD, appointmentStatus: 'cancelled' }]) });
  assert.doesNotMatch(html, /kanban-card-cancel/);
});

test('o botão aparece no card, sem abrir o diálogo sozinho', async () => {
  const html = await render();
  const index = html.indexOf('class="kanban-card-cancel"');
  assert.ok(index > 0, 'o botão de cancelar não está no card');
  const button = html.slice(index, html.indexOf('</button>', index));
  assert.match(button, /Cancelar/);
  assert.match(button, /lucide-ban/, 'o botão mostra o ícone de cancelar');
  assert.doesNotMatch(html, /confirm-modal-panel/);
});

test('agendamento cancelado com aviso incerto oferece conferir o aviso', async () => {
  const html = await render({
    kanbanColumns: columnWith([{ ...APPOINTMENT_CARD, appointmentStatus: 'cancelled', appointmentMetadata: { services: ['Pé e Unha'], cancellation_notice_state: 'uncertain' } }]),
  });
  assert.match(html, /Conferir aviso/);
  assert.doesNotMatch(html, />Cancelar</, 'não deve oferecer cancelar de novo um agendamento já cancelado');
});

test('agendamento cancelado com aviso já conferido não oferece nada', async () => {
  const html = await render({
    kanbanColumns: columnWith([{ ...APPOINTMENT_CARD, appointmentStatus: 'cancelled', appointmentMetadata: { services: ['Pé e Unha'], cancellation_notice_state: 'confirmed' } }]),
  });
  assert.doesNotMatch(html, /kanban-card-cancel/);
});

test('o botão de cancelar não empurra a ação principal do card para outra linha', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const css = readFileSync(fileURLToPath(new URL('../../src/styles/components/appointment-outcome.css', import.meta.url)), 'utf8');
  const rule = css.slice(css.indexOf('.kanban-card-cancel'));
  assert.match(rule.slice(0, rule.indexOf('}')), /grid-area:\s*2\s*\/\s*1/, 'o botão reserva a segunda linha do rodapé');
});

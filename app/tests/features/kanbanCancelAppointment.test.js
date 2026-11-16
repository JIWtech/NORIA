// Botão de cancelamento direto nos cards de agendamento do Kanban.
// Antes, o cancelamento só existia na tela de Agendamentos; no Kanban a equipe tinha que trocar de aba.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { appointmentActionsFor } from '../../src/services/appointments/appointmentActions.js';
import { appointmentFromKanbanCard } from '../../src/services/appointments/noShowMessage.js';

const kanbanSource = fs.readFileSync(path.join(import.meta.dirname, '../../src/features/kanban/components/Kanban.jsx'), 'utf8');

test('o card do Kanban oferece a ação de cancelar quando o agendamento admite', () => {
  const appointment = { id: 'appt-1', status: 'confirmed', startsAt: '2026-12-01T15:00:00.000Z' };
  const actions = appointmentActionsFor(appointment, { now: Date.parse('2026-11-20T12:00:00Z') });
  assert.ok(actions.includes('cancel'));
  assert.ok(actions.includes('edit'));
});

test('agendamento já cancelado ou concluído não oferece cancelar de novo', () => {
  for (const status of ['cancelled', 'completed', 'done', 'no_show']) {
    const actions = appointmentActionsFor({ id: 'appt-1', status, startsAt: '2026-12-01T15:00:00.000Z' },
      { now: Date.parse('2026-11-20T12:00:00Z') });
    assert.equal(actions.includes('cancel'), false, status);
  }
});

test('o card do Kanban tem os dados do agendamento que o cancelamento exige', () => {
  const card = {
    appointmentId: 'appt-1', appointmentStatus: 'confirmed', appointmentStartsAt: '2026-12-01T15:00:00.000Z',
    appointmentMetadata: { services: ['Pé e Unha'] }, channelType: 'whatsapp',
    externalConversationId: '5521900000002@s.whatsapp.net', appointmentContactName: 'Cliente Teste',
  };
  const appointment = appointmentFromKanbanCard(card);
  assert.equal(appointment.id, 'appt-1');
  assert.equal(appointment.status, 'confirmed');
  assert.equal(appointment.channelType, 'whatsapp');
  assert.equal(appointment.externalConversationId, '5521900000002@s.whatsapp.net');
  assert.equal(appointment.contactName, 'Cliente Teste');
  assert.deepEqual(appointment.raw.metadata.services, ['Pé e Unha']);
});

test('o Kanban tem o botão de cancelar no card e abre o diálogo de cancelamento', () => {
  assert.match(kanbanSource, /AppointmentCancelDialog/);
  assert.match(kanbanSource, /setCancellingCard/);
  assert.match(kanbanSource, /Cancelar/);
});

test('o card do Kanban diz o motivo ao pedir o cancelamento', () => {
  assert.match(kanbanSource, /appointmentFromKanbanCard/);
});

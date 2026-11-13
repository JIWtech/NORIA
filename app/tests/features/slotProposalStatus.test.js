import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsToKanban } from '../../src/dataService.js';
import { mapAppointment } from '../../src/services/appointments/appointmentPresentation.js';
import { slotProposalBadge } from '../../src/services/appointments/slotProposalStatus.js';
import {
  appointmentRequestErrorMessage,
  appointmentRequestState,
  slotProposalSuggestionEnabled,
  rejectionSuccessMessage,
} from '../../src/services/appointments/appointmentRequest.js';

const CHAT = '5521999990002@s.whatsapp.net';
const NOW = Date.parse('2026-11-12T15:00:00Z');
const hoursAgo = (hours) => new Date(NOW - hours * 3600000).toISOString();
const cancelled = (proposal, overrides = {}) => mapAppointment({
  id: 'ap-cancelled', title: 'Corte - Ana', starts_at: '2026-11-20T13:00:00Z', status: 'cancelled', contact_name: 'Ana',
  channel_type: 'whatsapp', external_conversation_id: CHAT, created_at: hoursAgo(5), updated_at: hoursAgo(1),
  metadata: { services: ['Corte'], request_version: 2, slot_proposal: proposal }, ...overrides,
});
const inbound = { id: 'e-1', tenant_slug: 'ic_salon', channel_type: 'whatsapp', external_conversation_id: CHAT, contact_name: 'Ana', direction: 'inbound',
  sender_type: 'contact', message_text: 'Oi', created_at: hoursAgo(1), stage: 'Em atendimento', service: 'geral' };
const keys = ['conversas_ia', 'aguardando_humano', 'confirmar_agendamento', 'agendamentos', 'finalizadas'];
const config = { columns: keys.map((key, position) => ({ id: key, title: key, automationKey: key, position })) };
const cardOf = (columns) => columns.flatMap((column) => column.cards).find((card) => card.externalConversationId === CHAT);

test('proposta enviada: o cartão da conversa mostra que aguarda resposta, mesmo com o pedido cancelado', () => {
  const sent = { id: 'p1', status: 'sent', date: '2026-11-21', time: '10:00', sent_at: hoursAgo(2) };
  const card = cardOf(eventsToKanban([inbound], 'ic_salon', [cancelled(sent)], config));
  assert.equal(card.slotProposal.status, 'sent');
  assert.equal(slotProposalBadge(card.slotProposal, { now: NOW }).key, 'awaiting');
  assert.match(slotProposalBadge(card.slotProposal, { now: NOW }).label, /aguardando resposta/);
});

test('estados: recusada pela pessoa, substituída, expirada pelo prazo do tenant e padrão de 48 h', () => {
  assert.equal(slotProposalBadge({ id: 'p', status: 'rejected', resolved_at: hoursAgo(3) }, { now: NOW }).key, 'declined');
  assert.equal(slotProposalBadge({ id: 'p', status: 'superseded', sent_at: hoursAgo(3) }, { now: NOW }).key, 'superseded');
  assert.equal(slotProposalBadge({ id: 'p', status: 'sent', sent_at: hoursAgo(49) }, { now: NOW }).key, 'expired');
  assert.equal(slotProposalBadge({ id: 'p', status: 'sent', sent_at: hoursAgo(47) }, { now: NOW }).key, 'awaiting');
  assert.equal(slotProposalBadge({ id: 'p', status: 'sent', sent_at: hoursAgo(3) }, { now: NOW, ttl: 2 }).key, 'expired');
  assert.equal(slotProposalBadge({ id: 'p', status: 'sent', sent_at: hoursAgo(1) }, { now: NOW, ttl: 2 }).key, 'awaiting');
  // resolvidas há muito tempo saem do cartão; estados técnicos não viram selo
  assert.equal(slotProposalBadge({ id: 'p', status: 'rejected', resolved_at: hoursAgo(100) }, { now: NOW }), null);
  assert.equal(slotProposalBadge({ id: 'p', status: 'uncertain' }, { now: NOW }), null);
  assert.equal(slotProposalBadge(null, { now: NOW }), null);
});

test('recusada e substituída chegam ao cartão; sem proposta o cartão não ganha selo', () => {
  assert.equal(cardOf(eventsToKanban([inbound], 'ic_salon', [cancelled({ id: 'p', status: 'rejected', resolved_at: hoursAgo(2) })], config)).slotProposal.status, 'rejected');
  assert.equal(cardOf(eventsToKanban([inbound], 'ic_salon', [cancelled({ id: 'p', status: 'superseded', sent_at: hoursAgo(2) })], config)).slotProposal.status, 'superseded');
  assert.equal(cardOf(eventsToKanban([inbound], 'ic_salon', [cancelled(undefined)], config)).slotProposal, undefined);
});

test('a proposta de outra conversa não aparece neste cartão', () => {
  const other = cancelled({ id: 'p', status: 'sent', sent_at: hoursAgo(1) }, { external_conversation_id: '5521000000000@s.whatsapp.net' });
  assert.equal(cardOf(eventsToKanban([inbound], 'ic_salon', [other], config)).slotProposal, undefined);
});

test('pedido novo depois da recusa: o selo da proposta antiga sai do cartão', () => {
  const rejected = cancelled({ id: 'p', status: 'rejected', date: '2026-11-14', time: '14:00', sent_at: hoursAgo(3), resolved_at: hoursAgo(2) });
  const pending = (createdAt) => mapAppointment({
    id: 'ap-new', title: 'Corte - Ana', starts_at: '2026-11-17T16:00:00Z', status: 'pending_confirmation', contact_name: 'Ana', channel_type: 'whatsapp',
    external_conversation_id: CHAT, created_at: createdAt, updated_at: createdAt, metadata: { services: ['Corte'], request_version: 1, request_updated_at: createdAt },
  });
  // A pessoa recusou e pediu outro horário: o pedido novo é posterior à recusa.
  assert.equal(cardOf(eventsToKanban([inbound], 'ic_salon', [rejected, pending(hoursAgo(1))], config)).slotProposal, undefined);
  // Pedido pendente anterior à proposta (outro pedido da mesma conversa): a recusa continua informativa.
  assert.equal(cardOf(eventsToKanban([inbound], 'ic_salon', [rejected, pending(hoursAgo(4))], config)).slotProposal.status, 'rejected');
});

test('dois confirmados no mesmo contato aparecem sem o selo da recusa anterior', () => {
  const rejected = cancelled({ id: 'p', status: 'rejected', resolved_at: hoursAgo(3) });
  const confirmed = (id, name, startsAt, updatedAt) => mapAppointment({
    id, title: name, contact_name: name, status: 'confirmed', starts_at: startsAt,
    channel_type: 'whatsapp', external_conversation_id: CHAT, updated_at: updatedAt,
    metadata: { request_updated_at: hoursAgo(2) },
  });
  const first = confirmed('drenagem', 'Ana', '2026-11-14T16:00:00Z', hoursAgo(1));
  const second = confirmed('mao', 'João', '2026-11-17T16:00:00Z', hoursAgo(0.9));
  for (const appointments of [[rejected, first, second], [second, first, rejected]]) {
    const columns = eventsToKanban([inbound], 'ic_salon', appointments, config);
    const cards = columns.find(column => column.automationKey === 'agendamentos').cards;
    assert.deepEqual(cards.map(card => card.appointmentId).sort(), ['drenagem', 'mao']);
    assert.ok(cards.every(card => card.slotProposal === undefined));
  }
});

test('falta e proposta ativa ficam visíveis ao lado de outro confirmado no mesmo WhatsApp', () => {
  const sent = cancelled({ id: 'nova', status: 'sent', sent_at: hoursAgo(0) });
  const booked = mapAppointment({ ...sent.raw, id: 'confirmado', status: 'confirmed', metadata: {} });
  const missed = mapAppointment({ ...sent.raw, id: 'falta', status: 'no_show', metadata: {} });
  const columns = eventsToKanban([inbound], 'ic_salon', [booked, sent, missed], config);
  const cards = columns.flatMap(column => column.cards);
  assert.equal(cards.find(card => card.appointmentId === 'confirmado').slotProposal, undefined);
  assert.equal(cards.find(card => card.appointmentId === 'falta').appointmentStatus, 'no_show');
  assert.equal(cards.find(card => card.slotProposal?.id === 'nova').slotProposal.appointmentId, 'ap-cancelled');
});

test('pedido reaberto por aceite indica que veio de proposta', () => {
  const reopened = mapAppointment({
    id: 'ap-open', title: 'Corte - Ana', starts_at: '2026-11-21T13:00:00Z', status: 'pending_confirmation', contact_name: 'Ana', channel_type: 'whatsapp',
    external_conversation_id: CHAT, created_at: hoursAgo(5), updated_at: hoursAgo(1),
    metadata: { services: ['Corte'], request_version: 3, slot_proposal: { id: 'p', status: 'accepted', date: '2026-11-21', time: '10:00', resolved_at: hoursAgo(1) } },
  });
  const card = cardOf(eventsToKanban([inbound], 'ic_salon', [reopened], config));
  assert.equal(slotProposalBadge(card.slotProposal, { now: NOW }).key, 'accepted');
  assert.equal(appointmentRequestState({ startsAt: reopened.startsAt, metadata: reopened.raw.metadata }, { now: NOW }).fromProposal, true);
});

test('envio da proposta exige as duas chaves no Salon', () => {
  const both = { slot_proposal_enabled: true, slot_proposal_resolution_enabled: true };
  assert.equal(slotProposalSuggestionEnabled('ic_salon', both), true);
  assert.equal(slotProposalSuggestionEnabled('ic_salon', { slot_proposal_enabled: true }), false);
  assert.equal(slotProposalSuggestionEnabled('ic_salon', { slot_proposal_resolution_enabled: true }), false);
  assert.equal(slotProposalSuggestionEnabled('outro', both), false);
  assert.equal(slotProposalSuggestionEnabled('ic_salon', undefined), false);
});

test('sending preso há mais de 2 minutos libera a conferência; recente não', () => {
  const metadata = (preparedAt) => ({ confirmation_state: 'sending', slot_proposal: { id: 'p', status: 'sending', prepared_at: preparedAt, provider_message_id: 'prov-1' } });
  const stuck = appointmentRequestState({ startsAt: '2026-11-21T13:00:00Z', metadata: metadata(new Date(NOW - 3 * 60000).toISOString()) }, { now: NOW });
  assert.equal(stuck.proposalStuck, true); assert.equal(stuck.proposalCheckable, true); assert.equal(stuck.proposalMessageId, 'prov-1');
  const fresh = appointmentRequestState({ startsAt: '2026-11-21T13:00:00Z', metadata: metadata(new Date(NOW - 30000).toISOString()) }, { now: NOW });
  assert.equal(fresh.proposalStuck, false); assert.equal(fresh.proposalCheckable, false);
  const uncertain = appointmentRequestState({ startsAt: '2026-11-21T13:00:00Z', metadata: { confirmation_state: 'uncertain', slot_proposal: { id: 'p', status: 'uncertain' } } }, { now: NOW });
  assert.equal(uncertain.proposalCheckable, true); assert.equal(uncertain.proposalMessageId, '');
});

test('mensagens do painel: sucesso diz que a proposta aguarda resposta; erros têm texto próprio', () => {
  assert.match(rejectionSuccessMessage({ suggested_date: '2026-11-21', suggested_time: '10:00' }), /Proposta enviada.*aguarda/i);
  assert.match(rejectionSuccessMessage({}), /Aviso enviado/);
  const message = (text) => appointmentRequestErrorMessage(new Error(text), 'genérico');
  assert.match(message('O horario proposto ja passou'), /data e hora futuras/);
  assert.match(message('Data ou horario da proposta invalido'), /inválid/);
  assert.match(message('Proposta de horario nao esta ativa nesta empresa'), /desligada/);
  assert.match(message('Mensagem enviada, mas proposta nao ativada. Verifique o agendamento'), /Conferir proposta/);
  assert.match(message('Entrega nao comprovada. Verifique no WhatsApp. Nao foi possivel marcar a proposta como incerta (x)'), /2 minutos/);
  assert.match(message('Gemini nao gerou mensagem com data e horario exatos'), /IA não conseguiu/);
  assert.match(message('Envio em andamento ou entrega incerta. Verifique'), /Conferir/);
  assert.equal(message('Falha qualquer'), 'genérico');
});

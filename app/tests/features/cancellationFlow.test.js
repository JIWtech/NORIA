import test from 'node:test';
import assert from 'node:assert/strict';
import { canNotifyCancellation, cancelAndNotify, noticeState, reconcileNotice } from '../../src/features/appointments/components/cancellationFlow.js';

test('aviso exige WhatsApp e conversa vinculada', () => {
  assert.equal(canNotifyCancellation({ channelType: 'whatsapp', externalConversationId: '123' }), true);
  assert.equal(canNotifyCancellation({ channelType: 'manual', externalConversationId: '123' }), false);
  assert.equal(canNotifyCancellation({ channelType: 'whatsapp', externalConversationId: ' ' }), false);
});

test('cancelamento precede geração e envio pela IA e preserva tenant e destinatário', async () => {
  const calls = [];
  const result = await cancelAndNotify({ appointment: { id: 'a', channelType: 'whatsapp', externalConversationId: '123', contactName: 'Ana' }, tenantSlug: 'tenant-a', reason: ' Cliente pediu remarcação ', cancel: async (...args) => calls.push(['cancel', ...args]), send: async (...args) => { calls.push(['send', ...args]); return { ok: true }; } });
  assert.deepEqual(calls, [['cancel', 'a', 'Cliente pediu remarcação'], ['send', 'notify_appointment_cancellation', { appointment_id: 'a', channel_type: 'whatsapp', external_conversation_id: '123', contact_name: 'Ana', cancellation_reason: 'Cliente pediu remarcação' }, 'tenant-a']]);
  assert.equal(result.alreadySent, false);
});

test('aviso que já havia sido enviado não é apresentado como envio novo', async () => {
  const result = await cancelAndNotify({ appointment: { id: 'a', channelType: 'whatsapp', externalConversationId: '123' }, tenantSlug: 't', reason: 'Sem vaga', cancel: async () => {}, send: async () => ({ ok: true, already_sent: true }) });
  assert.equal(result.alreadySent, true);
});

test('falha no envio informa cancelamento e permite tentar apenas envio', async () => {
  let cancels = 0;
  const args = { appointment: { id: 'a', channelType: 'whatsapp', externalConversationId: '123' }, tenantSlug: 'tenant-a', reason: 'Sem vaga', cancel: async () => { cancels++; }, send: async () => { throw Error('falha'); } };
  await assert.rejects(() => cancelAndNotify(args), error => error.cancelled === true && error.noticeUncertain === false);
  await cancelAndNotify({ ...args, alreadyCancelled: true, send: async () => ({ ok: true }) });
  assert.equal(cancels, 1);
});

test('entrega incerta ou envio em andamento levam à conferência, não a um reenvio inútil', async () => {
  for (const text of ['Entrega nao comprovada. Verifique no WhatsApp antes de tentar novamente.', 'Envio em andamento ou entrega incerta. Verifique no WhatsApp antes de tentar novamente.',
    'Mensagem enviada, mas o registro nao foi atualizado. Entrega incerta: confira no WhatsApp e registre o resultado.']) {
    await assert.rejects(() => cancelAndNotify({ appointment: { id: 'a', channelType: 'whatsapp', externalConversationId: '1' }, tenantSlug: 't', reason: 'x', cancel: async () => {}, send: async () => ({ ok: false, error: text }) }),
      error => error.cancelled === true && error.noticeUncertain === true && /confira/i.test(error.message), text);
  }
});

test('estado do aviso: incerto e preso em envio (> 2 min) podem ser conferidos; enviado e recente não', () => {
  const now = Date.parse('2026-11-12T15:00:00Z');
  assert.deepEqual(noticeState({ cancellation_notice_state: 'uncertain' }, now), { state: 'uncertain', canReconcile: true });
  assert.equal(noticeState({ cancellation_notice_state: 'sending', cancellation_notice_at: '2026-11-12T14:55:00Z' }, now).canReconcile, true);
  assert.equal(noticeState({ cancellation_notice_state: 'sending', cancellation_notice_at: '2026-11-12T14:59:30Z' }, now).canReconcile, false);
  assert.equal(noticeState({ cancellation_notice_state: 'sent' }, now).canReconcile, false);
  assert.deepEqual(noticeState({}, now), { state: '', canReconcile: false });
  assert.deepEqual(noticeState(undefined, now), { state: '', canReconcile: false });
});

test('conferência do aviso usa o comando certo, no tenant e conversa do agendamento', async () => {
  const calls = [];
  const send = async (...args) => { calls.push(args); return { ok: true, resolved: true }; };
  const appointment = { id: 'a', channelType: 'whatsapp', externalConversationId: '123', contactName: 'Ana' };
  await reconcileNotice({ appointment, tenantSlug: 't', reason: 'Sem vaga', resolution: 'delivered', send });
  assert.deepEqual(calls[0], ['notify_appointment_cancellation', { appointment_id: 'a', channel_type: 'whatsapp', external_conversation_id: '123', contact_name: 'Ana', cancellation_reason: 'Sem vaga', notice_resolution: 'delivered' }, 't']);
  await assert.rejects(() => reconcileNotice({ appointment, tenantSlug: 't', reason: 'Sem vaga', resolution: 'talvez', send }));
  await assert.rejects(() => reconcileNotice({ appointment: {}, tenantSlug: 't', reason: 'x', resolution: 'delivered', send }));
  await assert.rejects(() => reconcileNotice({ appointment, tenantSlug: 't', reason: 'x', resolution: 'delivered', send: async () => ({ ok: false, error: 'falhou' }) }), /falhou/);
  assert.equal(calls.length, 1);
});

test('entrada inválida não cancela nem envia', async () => {
  let calls = 0;
  await assert.rejects(() => cancelAndNotify({ appointment: { id: 'a' }, tenantSlug: 'tenant-a', reason: 'aviso', cancel: async () => calls++, send: async () => calls++ }));
  await assert.rejects(() => cancelAndNotify({ appointment: { id: 'a', channelType: 'whatsapp', externalConversationId: '123' }, tenantSlug: 'tenant-a', reason: ' ', cancel: async () => calls++, send: async () => calls++ }));
  assert.equal(calls, 0);
});

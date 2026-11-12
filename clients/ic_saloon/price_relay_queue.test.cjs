const assert = require('node:assert/strict');
const { test } = require('node:test');
const { tenantId } = require('./price_relay.cjs');
const { setupQueue, rpc, issue, enqueue, beginDelivery, other, ordinaryActor } = require('./price_relay_queue_fixture.cjs');

test('recusa comprovada libera apenas o próximo lote do salão', async t => {
  const db = await setupQueue();
  t.after(() => db.close());
  const chat = '5511000000000@s.whatsapp.net';
  const { claim, delivery } = await beginDelivery(db, tenantId, chat);
  await assert.rejects(issue(db, chat, ordinaryActor), /IC_SALON_PRICE_RELAY_FORBIDDEN/);

  const proof = await issue(db, chat);
  assert.equal(proof.issued, true);
  assert.match(proof.message, /^IC_SALON_PRICE_REJECTED:[0-9A-F]{32}$/);
  const error = 'SUPABASE_RAISED:' + proof.message;
  const fail = (tid, id, token, reason = error) => rpc(db, 'magia_fail_turn', [tid, id, token, reason, false]);
  const take = (tid, id) => rpc(db, 'magia_claim_turn', [tid, id]);

  const otherTurn = await beginDelivery(db, other, chat);
  await fail(other, chat, otherTurn.claim.token);
  assert.equal((await take(other, chat)).reason, 'delivery_uncertain');

  const wrongChat = '5511000000001@s.whatsapp.net';
  const wrongTurn = await beginDelivery(db, tenantId, wrongChat);
  await fail(tenantId, wrongChat, wrongTurn.claim.token);
  assert.equal((await take(tenantId, wrongChat)).reason, 'delivery_uncertain');

  const booking = 'Quero marcar corte amanhã às 10h.';
  await enqueue(db, tenantId, chat, booking);
  await fail(tenantId, chat, claim.token);
  const receipt = (await db.query('select * from conversation_turn_terminal_receipts where turn_token=$1', [claim.token])).rows[0];
  assert.equal(receipt.outcome, 'cancelled');
  assert.deepEqual(receipt.claimed.map(item => item.text), ['Quanto custa o corte?']);
  assert.equal(receipt.evidence.kind, 'ic_salon_price_rejected_before_provider');
  assert.equal(receipt.evidence.delivery_attempt_id, delivery.id);
  const settled = (await db.query('select status, provider_message_id from conversation_turn_delivery_attempts where id=$1', [delivery.id])).rows[0];
  assert.deepEqual(settled, { status: 'superseded_uncertain', provider_message_id: null });
  assert.equal((await db.query('select count(*)::int n from noria_ic_salon.price_rejections')).rows[0].n, 0);

  const next = await take(tenantId, chat);
  assert.equal(next.claimed, true);
  assert.notEqual(next.token, claim.token);
  assert.deepEqual(next.messages.map(item => item.text), [booking]);
  assert.equal((await rpc(db, 'magia_commit_turn', [tenantId, chat, next.token])).committed, true);
  const nextDelivery = await rpc(db, 'magia_begin_turn_delivery', [tenantId, chat, next.token]);
  assert.equal(nextDelivery.dispatch_allowed, true);

  // Não pode reutilizar uma prova para liberar uma falha real em outra tentativa.
  await fail(tenantId, chat, next.token);
  assert.equal((await take(tenantId, chat)).reason, 'delivery_uncertain');

  const expiredChat = '5511000000002@s.whatsapp.net';
  const expiredTurn = await beginDelivery(db, tenantId, expiredChat);
  const expired = await issue(db, expiredChat);
  await db.exec("update noria_ic_salon.price_rejections set expires_at = clock_timestamp() - interval '1 second'");
  await fail(tenantId, expiredChat, expiredTurn.claim.token, 'SUPABASE_RAISED:' + expired.message);
  assert.equal((await take(tenantId, expiredChat)).reason, 'delivery_uncertain');
});

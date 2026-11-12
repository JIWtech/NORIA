const assert = require('node:assert/strict');
const { once } = require('node:events');
const { test } = require('node:test');
const { createServer, sendText, tenantId } = require('./price_relay.cjs');

const headers = { apikey: 'local-test-only', 'Content-Type': 'application/json' };
const row = (id, name, price, tenant = tenantId) => ({
  tenant_id: tenant, active: true, external_id: id, name, price, metadata: { price_type: 'fixed' },
});
const catalog = [row('corte', 'Corte', 140), row('escova', 'Escova', 50), row('mechas', 'Mechas', null)];
const nonPrice = text => ({ text, kind: 'non_price' });
const price = (text, id, cents) => ({
  text, kind: 'catalog_price', service_id: id, amount_cents: cents, price_type: 'fixed',
});
const tests = [
  ['preço correto', 'O corte custa R$ 140,00.', t => [price(t, 'corte', 14000)], 201],
  ['preço indevido', 'O corte custa R$ 50.', t => [price(t, 'corte', 5000)], 422],
  ['valor de outro serviço', 'O corte custa R$ 50.', t => [{ text: t, kind: 'reject' }], 422],
  ['auditor atribui preço de escova ao corte', 'O corte custa R$ 50.', t => [price(t, 'escova', 5000)], 422],
  ['duas cifras em um trecho', 'O corte custa R$ 140 e R$ 140 no cartão.', t => [price(t, 'corte', 14000)], 422],
  ['valor por extenso', 'O corte custa cinquenta reais.', t => [{ text: t, kind: 'reject' }], 422],
  ['cifra omitida pelo auditor', 'O corte custa R$ 50.', t => [nonPrice(t)], 422],
  ['cifra dividida em trechos', 'O corte custa R$ 50.', t => [nonPrice(t.slice(0, -3)), nonPrice(t.slice(-3))], 422],
  ['valor com formato não autorizado', 'O corte custa R$ 140.99.', t => [price(t, 'corte', 14000)], 422],
  ['preço inventado onde o cadastro está vazio', 'Mechas custam R$ 50.', t => [price(t, 'mechas', 5000)], 422],
  ['preço fixo apresentado como inicial', 'O corte é a partir de R$ 140.', t => [{ ...price(t, 'corte', 14000), price_type: 'from' }], 422],
  ['pedido de agendamento', 'Anotei: corte dia 29/09 às 10:00. A equipe vai confirmar.', t => [nonPrice(t)], 201],
  ['endereço', 'Av. das Acácias, 207, Loja 4, Cidade Jardim.', t => [nonPrice(t)], 201],
  ['mechas sob consulta', 'A avaliação presencial é gratuita e define o orçamento.', t => [nonPrice(t)], 201],
  ['texto alterado pelo auditor', 'O corte custa R$ 50.', () => [nonPrice('A equipe vai confirmar.')], 422],
];

test('a ponte entrega apenas texto aprovado para a instância do salão', async t => {
  const forwarded = [];
  let rows = catalog;
  let audit;
  const proof = 'IC_SALON_PRICE_REJECTED:' + 'A'.repeat(32);
  let proofAvailable = true;
  const server = createServer({ relayKey: headers.apikey }, {
    catalog: async () => rows,
    audit: async text => ({ complete: true, segments: audit(text) }),
    attestRejection: async number => {
      assert.equal(number, '5511000000000');
      if (!proofAvailable) throw Error('unavailable');
      return proof;
    },
    forward: async (path, bytes) => {
      forwarded.push({ path, body: JSON.parse(bytes) });
      return Response.json({ key: { id: 'mock-1' } }, { status: 201 });
    },
  }, () => {});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = (text, path = sendText, auth = headers) =>
    fetch(base + path, { method: 'POST', headers: auth, body: JSON.stringify({ number: '5511000000000', text }) });
  for (const [label, text, makeAudit, status] of tests) {
    await t.test(label, async () => {
      const before = forwarded.length;
      audit = makeAudit;
      const result = await post(text);
      assert.equal(result.status, status);
      if (status === 422) assert.equal((await result.json()).message, proof);
      assert.equal(forwarded.length - before, status === 201 ? 1 : 0);
      if (status === 201) assert.equal(forwarded.at(-1).body.text, text);
    });
  }
  const before = forwarded.length;
  proofAvailable = false;
  audit = text => [nonPrice(text)];
  const unproven = await post('O corte custa R$ 50.');
  assert.equal(unproven.status, 422);
  assert.deepEqual(await unproven.json(), { error: 'IC_SALON_PRICE_UNVERIFIED' });
  assert.equal((await post('Oi', '/message/sendText/outro_tenant')).status, 404);
  assert.equal((await post('Oi', sendText, { ...headers, apikey: 'invalid' })).status, 401);
  rows = [row('corte', 'Corte', 50, 'outro_tenant')];
  assert.equal((await post('O corte custa R$ 50.')).status, 503);
  rows = catalog;
  audit = () => { throw Error('timeout'); };
  assert.equal((await post('O corte custa R$ 50.')).status, 503);
  assert.equal(forwarded.length, before);
  assert.equal((await post('irrelevante', '/chat/getBase64FromMediaMessage/ic_saloon')).status, 201);
  assert.equal((await post('irrelevante', '/chat/fetchProfilePictureUrl/ic_saloon')).status, 201);
});

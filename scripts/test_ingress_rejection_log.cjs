// 05/11/2026: o webhook da Núbia foi salvo com token diferente do ingresso. Cada mensagem recebia 502 e o ingresso não
// registrava nada, porque o catch descartava o motivo. Agora toda recusa grava um código fixo no log do serviço. O código
// nunca carrega token, corpo da mensagem nem texto livre de erro.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createIngressServer, ingressRejectionCode } = require('./turn_queue_operational_bridge.cjs');

const token = 'tokenCorretoDoIngressoComMaisDe32Caracteres';
const cfg = { providerToken: token, signingSecret: 'segredo', instance: 'clinica_nubia', maxBytes: 1024 };

async function post(authorization, body = '{"instance":"clinica_nubia"}', overrides = {}) {
  const lines = [];
  const server = createIngressServer({ ...cfg, ...overrides }, line => lines.push(line));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/ingress', {
      method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json' }, body,
    });
    return { status: response.status, lines };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('token diferente registra o motivo e continua respondendo 502', async () => {
  const { status, lines } = await post('Bearer tokenErrado');
  assert.equal(status, 502);
  assert.deepEqual(lines, ['INGRESS_REJECTED code=PROVIDER_AUTH_REJECTED instance=clinica_nubia']);
});

test('instância errada registra o motivo', async () => {
  const { status, lines } = await post('Bearer ' + token, '{"instance":"outra"}');
  assert.equal(status, 502);
  assert.deepEqual(lines, ['INGRESS_REJECTED code=INGRESS_INSTANCE_MISMATCH instance=clinica_nubia']);
});

test('corpo acima do limite registra o motivo', async () => {
  const { status, lines } = await post('Bearer ' + token, '{"instance":"clinica_nubia"}', { maxBytes: 5 });
  assert.equal(status, 502);
  assert.deepEqual(lines, ['INGRESS_REJECTED code=INGRESS_BODY_LIMIT instance=clinica_nubia']);
});

test('o log nunca traz token nem conteúdo da mensagem', async () => {
  const { lines } = await post('Bearer tokenSecretoQueNaoPodeVazar', '{"text":"dados do cliente"}');
  assert.doesNotMatch(lines.join('\n'), /tokenSecretoQueNaoPodeVazar|dados do cliente/);
});

test('erro fora da lista de códigos vira código genérico', () => {
  assert.equal(ingressRejectionCode(new Error('INGRESS_FORWARD_FAILED')), 'INGRESS_FORWARD_FAILED');
  assert.equal(ingressRejectionCode(new Error('DATABASE_RPC_REJECTED')), 'DATABASE_RPC_REJECTED');
  assert.equal(ingressRejectionCode(new SyntaxError('Unexpected token dados do cliente')), 'INGRESS_INTERNAL_ERROR');
  assert.equal(ingressRejectionCode(new TypeError('fetch failed https://x.test?key=segredo')), 'INGRESS_INTERNAL_ERROR');
  assert.equal(ingressRejectionCode(new Error('MISSING_TOKEN_abc123')), 'INGRESS_INTERNAL_ERROR');
  assert.equal(ingressRejectionCode(null), 'INGRESS_INTERNAL_ERROR');
});

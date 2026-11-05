// Restrições de compra usam a marca estruturada, não palavras da conversa ou aproximação lexical.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../n8n/sources/genesis_extension.js'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const engine = new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', 'return { rejectedBrandOf };\n' + code);
const blocked = ['Peugeot', 'Citroen', 'Ford', 'Renault'];
async function rejected(vehicle, brands = blocked) {
  const ext = await engine.call({ helpers: {} }, {}, {}, {}, () => ({}));
  return ext.rejectedBrandOf(vehicle, brands);
}

test('marca mencionada em contexto não substitui a marca do veículo oferecido', async () => {
  assert.equal(await rejected({ brand: 'Chevrolet', model: 'Celta', raw_mention: 'Já tive um Ford; agora quero vender meu Celta' }), null);
});

test('marca estruturada configurada continua bloqueada independentemente do texto livre', async () => {
  assert.equal(await rejected({ brand: 'Ford', model: 'Fiesta', raw_mention: 'Quero comprar um Chevrolet depois' }), 'ford');
  assert.equal(await rejected({ brand: 'Citroën', model: 'C3' }), 'citroen');
});

test('sem marca estruturada não se inventa uma marca pelo modelo ou pela frase', async () => {
  assert.equal(await rejected({ brand: '', model: 'Fiesta', raw_mention: 'Tive Ford e Renault' }), null);
});

test('marca desconhecida não vira uma marca recusada por distância de edição', async () => {
  assert.equal(await rejected({ brand: 'Foro', model: 'Desconhecido' }), null);
});

test('configuração com marca composta é comparada como valor completo', async () => {
  assert.equal(await rejected({ brand: 'Marca Composta', model: 'Modelo' }, ['Marca Composta']), 'marca composta');
});

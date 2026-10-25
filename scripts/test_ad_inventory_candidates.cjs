// Gênesis 24/10 21:48: anúncio "PXC 2023 / Crosser 2021 / Tornado 2025" + "Olá! Posso ter mais informações sobre isso?"
// recebeu resposta genérica. O motor passa a extrair do texto do anúncio os veículos do estoque como dado explícito.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = fs.readFileSync(path.join(__dirname, '../n8n/sources/noria_core.js'), 'utf8').replace(/\r\n/g, '\n');
const ext = fs.readFileSync(path.join(__dirname, '../n8n/sources/genesis_extension.js'), 'utf8');
const slice = name => { const start = core.indexOf('function ' + name + '('); assert.ok(start >= 0, name); return core.slice(start, core.indexOf('\n}\n', start) + 3); };
const api = new Function(slice('normalizeText') + slice('salesAdTokenMatches') + slice('salesAdInventoryCandidates') + slice('salesAdVehicleNotAddressed')
  + '; return { salesAdInventoryCandidates, salesAdVehicleNotAddressed };')();

const row = (id, brand, model, year, status) => ({ id, brand, model, year, status, name: brand + ' ' + model });
const inventory = [
  row('honda|tornado 300l|2025|vermelho', 'HONDA', 'TORNADO 300L', 2025, 'announced'),
  row('honda|pcx|2023|branca', 'HONDA', 'PCX', 2023, 'announced'),
  row('yamaha|crosser|2021|preto', 'YAMAHA', 'CROSSER', 2021, 'sold'),
  row('honda|pcx|2018|prata', 'HONDA', 'PCX', 2018, 'unverified'),
  row('renault|sandero gt line|2016|branco', 'RENAULT', 'SANDERO GT LINE', 2016, 'sold'),
  row('nissan|versa sl|2013|prata', 'NISSAN', 'VERSA SL', 2013, 'announced'),
  row('yamaha|crosser|2023|', 'YAMAHA', 'CROSSER', 2023, 'announced'),
  row('chevrolet|onix|2020|', 'CHEVROLET', 'ONIX', 2020, 'announced'),
];
const ids = body => api.salesAdInventoryCandidates({ title: 'Gênesis automóveis', body }, inventory).map(item => item.id);

test('anúncio com várias motos lista todas, tolerando letras trocadas (produção 21:48)', () => {
  assert.deepEqual(ids('PXC 2023 - km baixo \nCrosser 2021 - revisada \nTornado 2025 - na garantia'),
    ['honda|pcx|2023|branca', 'yamaha|crosser|2021|preto', 'honda|tornado 300l|2025|vermelho']);
  const crosser = api.salesAdInventoryCandidates({ body: 'Crosser 2021 - revisada' }, inventory)[0];
  assert.equal(crosser.status, 'sold', 'o status do estoque acompanha o veículo');
});

test('anúncio de um veículo identifica só ele', () => {
  assert.deepEqual(ids('Versa SL 2013 \n2013 \nApenas R$27.980,00 à vista \n130 mil km apenas'), ['nissan|versa sl|2013|prata']);
  assert.deepEqual(ids('Corre pra cá ! Ônix 2020 \nKm baixo \nCompleto'), ['chevrolet|onix|2020|']);
});

test('anúncio sem veículo ou de compra não inventa candidato', () => {
  assert.deepEqual(ids('De: 40 mil \nPor: 26,900 \nAté 60x \nOportunidade ✅'), []);
  assert.deepEqual(ids('Atenção ⚠️ \nNão compramos: \nPeugeot \nCitroen \nRenault ( excessões)'), []);
  assert.deepEqual(api.salesAdInventoryCandidates(null, inventory), []);
});

test('resposta a clique de anúncio que não cita nenhum veículo do anúncio é detectada', () => {
  const ad = api.salesAdInventoryCandidates({ body: 'PXC 2023\nCrosser 2021\nTornado 2025' }, inventory);
  assert.equal(api.salesAdVehicleNotAddressed('Olá! Tudo bem? Vi que você clicou no nosso anúncio. Como posso te ajudar hoje?', ad), true);
  assert.equal(api.salesAdVehicleNotAddressed('Opa! Nesse anúncio temos a PCX 2023 e a Tornado 2025. Qual te interessa?', ad), false);
  assert.equal(api.salesAdVehicleNotAddressed('Qualquer texto', []), false);
});

test('o modelo recebe ad_vehicles e a frase automática de anúncio conta como pedido', () => {
  assert.match(core, /ad_vehicles: salesAdInventoryCandidates\(referral, inventory\)/);
  assert.match(core, /'AD_VEHICLE_NOT_ADDRESSED'/);
  assert.match(ext, /ad_vehicles/);
  assert.match(ext, /nunca é saudação/);
});

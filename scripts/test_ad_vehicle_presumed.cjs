// Gênesis 29/10 01:07 (…1977): o anúncio listava PCX 2023, Crosser 2021 (vendida) e Tornado 2025. A IA respondeu
// "Vi que você tem interesse na PCX 2023…" e o cliente corrigiu: "Crosser*". Com vários veículos ofertáveis no anúncio
// e nenhum citado pelo cliente, nomear só um presume um interesse que o cliente não declarou. A checagem de estilo pede
// uma reformulação auditada; se ela falhar, a resposta original continua (nunca trava a conversa).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = fs.readFileSync(path.join(__dirname, '../n8n/sources/noria_core.js'), 'utf8').replace(/\r\n/g, '\n');
const slice = name => { const start = core.indexOf('function ' + name + '('); assert.ok(start >= 0, name); return core.slice(start, core.indexOf('\n}\n', start) + 3); };
const presumed = new Function(['normalizeText', 'salesAdTokenMatches', 'salesAdVehiclePresumed'].map(slice).join('') + '; return salesAdVehiclePresumed;')();

const ad = [
  { id: 'pcx', brand: 'HONDA', model: 'PCX', year: 2023, status: 'announced' },
  { id: 'crosser21', brand: 'YAMAHA', model: 'CROSSER', year: 2021, status: 'sold' },
  { id: 'tornado', brand: 'HONDA', model: 'TORNADO 300L', year: 2025, status: 'announced' },
];
const click = 'Olá! Posso ter mais informações sobre isso?';

test('resposta que escolhe um dos veículos do anúncio sem o cliente indicar é presumida (produção 01:07)', () => {
  assert.equal(presumed('Olá! Vi que você tem interesse na PCX 2023. Ela tem 12.500 km rodados.', ad, click), true);
});

test('citar os veículos ofertáveis e perguntar qual interessa não é presumir', () => {
  assert.equal(presumed('Oi! Nesse anúncio temos a PCX 2023 e a Tornado 2025. Qual delas te interessa?', ad, click), false);
});

test('se o cliente já citou o veículo, responder só sobre ele é o certo', () => {
  assert.equal(presumed('A Tornado 2025 está anunciada por R$ 25.000,00.', ad, 'Quero saber da Tornado'), false);
  assert.equal(presumed('A PCX 2023 tem 12.500 km.', ad, 'pxc'), false);
});

test('anúncio com um só veículo ofertável: responder sobre ele não é presumir', () => {
  assert.equal(presumed('A PCX 2023 tem 12.500 km.', ad.filter(item => item.id !== 'tornado'), click), false);
  assert.equal(presumed('A PCX 2023 tem 12.500 km.', [], click), false);
});

test('resposta sem nenhum veículo não é presumida (outra checagem cobre)', () => {
  assert.equal(presumed('Olá! Como posso te ajudar?', ad, click), false);
});

test('entra na checagem de estilo da fase final e tem instrução de reformulação', () => {
  const finalize = core.slice(core.indexOf('async function runSalesTurnFinalize('));
  assert.match(finalize, /salesAdVehiclePresumed\(text, auditExecution\.ad_vehicles, auditExecution\.turn_text\) \? \['AD_VEHICLE_PRESUMED'\] : \[\]/);
  const repair = core.slice(core.indexOf('async function salesRepairRejectedDialogue('), core.indexOf('async function salesAuditPrimaryDialogue('));
  assert.match(repair, /AD_VEHICLE_PRESUMED:/);
});

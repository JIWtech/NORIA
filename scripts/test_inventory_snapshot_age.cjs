// Estoque da Gênesis parado desde 19/10: um veículo vendido continuou "announced" no snapshot e a IA o ofereceu
// (22/10 15:50). Com settings.sales.inventory_max_age_hours, linha mais velha que o limite não é oferecida
// (EXT e contingência do CORE). Sem o limite, nada muda.
// Rodar: node --test scripts/test_inventory_snapshot_age.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
// Function declarations are hoisted: returning first exposes them without running the node body.
const expose = (file, names) => new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData',
  'return { ' + names.join(',') + ' };\n' + fs.readFileSync(path.join(root, file), 'utf8'))
  .call({ helpers: { httpRequest: async () => ({}) } }, {}, {}, {}, () => ({}));

const hoursAgo = hours => new Date(Date.now() - hours * 3600 * 1000).toISOString();
const rows = [
  { vehicle_id: 'nissan|versa|2013|prata', sheet_row: 2, brand: 'Nissan', model: 'Versa', model_year: 2013, status: 'announced', price_cents: 2798000, synced_at: hoursAgo(96) },
  { vehicle_id: 'chevrolet|onix|2020|', sheet_row: 3, brand: 'Chevrolet', model: 'Onix', model_year: 2020, status: 'announced', price_cents: 4698000, synced_at: hoursAgo(2) },
  { vehicle_id: 'honda|pcx|2023|branca', sheet_row: 4, brand: 'Honda', model: 'PCX', model_year: 2023, status: 'sold', price_cents: 1749900, synced_at: hoursAgo(96) },
];

test('EXT: linha velha deixa de ser oferecida; recente continua; vendida continua vendida', async () => {
  const { parseSupabaseInventoryRows } = await expose('n8n/sources/genesis_extension.js', ['parseSupabaseInventoryRows']);
  const parsed = parseSupabaseInventoryRows(rows, { maxAgeHours: 48 });
  assert.deepEqual(parsed.map(item => [item.id, item.status, item.offerable]), [
    ['nissan|versa|2013|prata', 'unverified', false],
    ['chevrolet|onix|2020|', 'announced', true],
    ['honda|pcx|2023|branca', 'sold', false],
  ]);
});

test('EXT: sem limite configurado o snapshot mantém o status da fonte', async () => {
  const { parseSupabaseInventoryRows } = await expose('n8n/sources/genesis_extension.js', ['parseSupabaseInventoryRows']);
  assert.deepEqual(parseSupabaseInventoryRows(rows).map(item => item.offerable), [true, true, false]);
});

test('CORE (contingência): mesma regra de idade', async () => {
  const code = fs.readFileSync(path.join(root, 'n8n/code/whatsapp_conversation_core.generated.js'), 'utf8');
  const hook = /try \{\r?\n\s*const turnResult = await runTurn\(\);/.exec(code);
  const core = await new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', code.replace(hook[0], 'return { parseCanonicalInventoryRows };\n' + hook[0]))
    .call({ helpers: { httpRequest: async () => ({}) } }, { tenant_slug: 'wesley_automoveis', tenant_id: 't', remoteJid: '5511@s.whatsapp.net', instance: 'i' }, {}, {}, () => ({}));
  assert.deepEqual(core.parseCanonicalInventoryRows(rows, { maxAgeHours: 48 }).map(item => item.offerable), [false, true, false]);
  assert.deepEqual(core.parseCanonicalInventoryRows(rows).map(item => item.offerable), [true, true, false]);
});

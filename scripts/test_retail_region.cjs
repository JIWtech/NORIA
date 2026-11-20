// A região retail_v1 do motor é a projeção exata de n8n/sources/noria_retail.js e a sincronização é idempotente.
// Rodar: node --test scripts/test_retail_region.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { syncRetailRegion, extractRetailRegion, retailRegionBody, START, END } = require('./lib/retail_region.cjs');

const core = fs.readFileSync(path.join(__dirname, '../n8n/sources/noria_core.js'), 'utf8').replace(/\r\n/g, '\n');
const retail = fs.readFileSync(path.join(__dirname, '../n8n/sources/noria_retail.js'), 'utf8');

test('motor contém exatamente uma região retail_v1, igual à fonte canônica', () => {
  assert.equal(core.split(START).length - 1, 1);
  assert.equal(core.split(END).length - 1, 1);
  assert.equal(extractRetailRegion(core), retailRegionBody(retail), 'região desatualizada: rode scripts/build_noria_workflows.cjs');
});

test('sincronizar de novo não muda o motor; região sem exportação de testes', () => {
  assert.equal(syncRetailRegion(core, retail), core);
  assert.doesNotMatch(extractRetailRegion(core), /module\.exports/);
});

test('região fica antes do código que a usa e marcadores corrompidos falham', () => {
  assert.ok(core.indexOf(START) > core.indexOf('const TURN_PIPELINE_FIELDS'));
  assert.throws(() => syncRetailRegion(core + '\n' + START, retail), /MARKERS_INVALID/);
  assert.throws(() => syncRetailRegion('sem ancora', retail), /ANCHOR_MISSING/);
  assert.throws(() => syncRetailRegion(core, 'sem marcador de fim'), /END_MARKER_MISSING/);
});

'use strict';

// 21/10 21h07-21h12 (+55 21 98519-8468): "Mercedes" e "Essa Honda tornado aí, deixa eu ver" ficaram sem
// interpretação válida porque o modelo carregou um filtro de catálogo ou uma memória de contexto sem
// evidência da sessão. Contexto sem prova não autoriza nada: é descartado, como offer_response sem
// evidência já é, em vez de invalidar o turno inteiro. Um pedido de catálogo continua exigindo evidência.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(root + '/n8n/sources/noria_core.js', 'utf8');
const ts = require(root + '/app/node_modules/typescript');
const ast = ts.createSourceFile('core.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const ctx = { normalizeText: s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() };
vm.createContext(ctx);
for (const node of ast.statements) {
  if (ts.isFunctionDeclaration(node)) vm.runInContext(node.getText(ast), ctx);
  else if (ts.isVariableStatement(node) && /salesNaturalDialogue|SALES_INTENT_CLARIFICATION|salesDialogueTopics/.test(node.getText(ast).slice(0, 80))) {
    try { vm.runInContext(node.getText(ast).replace(/^const /, 'var '), ctx); } catch { /* depends on runtime-only globals */ }
  }
}

const inventory = [{ id: 'honda|tornado 300l|2025|vermelho' }, { id: 'mercedes|c180|2015|' }];
const semantic = (overrides = {}) => ({
  primary_intent: 'product_details', secondary_intents: [], topics: ['photos'],
  customer_disposition: { value: 'active', evidence_ids: [] },
  catalog: { requested: false, category: 'unspecified', price_min_cents: null, price_max_cents: null, preferences: [], exclusions: [], evidence_ids: [] },
  customer_vehicle: { purpose: 'none', evidence_ids: [] },
  references: { previous_catalog: true, selected_ordinal: null, mentioned_product_ids: ['honda|tornado 300l|2025|vermelho'], evidence_ids: ['in-2'], product_references: [], product_role: 'asked_info' },
  conversation: { continues_previous_topic: true, changes_preference: false, requires_clarification: false, frustration: { value: 'none', evidence_ids: [] } },
  auction: { intent: 'none', product_id: null, evidence_ids: [] }, ambiguities: [], confidence: 'high',
  offer_response: { value: 'none', evidence_ids: [], offer_ref: '' }, ...overrides,
});

test('filtro de catálogo herdado sem evidência é descartado num turno que não pede catálogo', () => {
  const out = ctx.salesValidateSemanticIntent(semantic({ catalog: { requested: false, category: 'motorcycles', price_min_cents: null, price_max_cents: null, preferences: [], exclusions: [], evidence_ids: [] } }),
    inventory, ['in-1', 'in-2'], ['in-2']);
  assert.equal(out.valid, true, JSON.stringify(out.validation_errors));
  assert.equal(out.catalog.category, 'unspecified');
  assert.equal(out.catalog.evidence_ids.length, 0);
});

test('pedido de catálogo sem evidência continua inválido', () => {
  const out = ctx.salesValidateSemanticIntent(semantic({ catalog: { requested: true, category: 'motorcycles', price_min_cents: null, price_max_cents: null, preferences: [], exclusions: [], evidence_ids: [] } }),
    inventory, ['in-1', 'in-2'], ['in-2']);
  assert.equal(out.valid, false);
  assert.ok(out.validation_errors.includes('MISSING_CATALOG_EVIDENCE'));
});

test('memória de contexto sem evidência da sessão é ignorada, sem rejeitar o plano', () => {
  const merge = ctx.salesNaturalDialogue.mergeMemory;
  const sessionIds = ['in-1', 'in-2'];
  const audience = merge({}, { trade_in_status: 'none', evidence_ids: [], catalog_audience: 'cars', catalog_audience_evidence_ids: ['out-9'] }, sessionIds);
  assert.equal(audience.catalog_audience, undefined);
  const kept = merge({ catalog_audience: 'motorcycles', catalog_audience_evidence_ids: ['in-1'] }, { trade_in_status: 'none', evidence_ids: [], catalog_audience: 'cars', catalog_audience_evidence_ids: [] }, sessionIds);
  assert.equal(kept.catalog_audience, 'motorcycles');
  const purpose = merge({}, { trade_in_status: 'none', evidence_ids: [], customer_vehicle_purpose: 'entry', customer_vehicle_purpose_evidence_ids: ['old'] }, sessionIds);
  assert.equal(purpose.customer_vehicle_purpose, undefined);
  const trade = merge({}, { trade_in_status: 'offered', evidence_ids: ['old'] }, sessionIds);
  assert.equal(trade.trade_in_status, 'none');
  const kind = merge({}, { trade_in_status: 'none', evidence_ids: [], vehicle_kind: 'car', vehicle_kind_evidence_ids: ['old'] }, sessionIds);
  assert.equal(kind.vehicle_kind, 'unknown');
});

test('memória com evidência da sessão continua valendo', () => {
  const merge = ctx.salesNaturalDialogue.mergeMemory;
  const out = merge({}, { trade_in_status: 'offered', evidence_ids: ['in-2'], catalog_audience: 'cars', catalog_audience_evidence_ids: ['in-1'] }, ['in-1', 'in-2']);
  assert.equal(out.trade_in_status, 'offered');
  assert.equal(out.catalog_audience, 'cars');
});

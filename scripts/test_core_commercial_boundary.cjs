const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../n8n/sources/noria_core.js'), 'utf8');
const vm = require('node:vm');
test('CORE não contém identidade, tabela ou instrução comercial específica da Gênesis', () => {
  assert.doesNotMatch(source, /['"]wesley_automoveis['"]|\/rest\/v1\/genesis_inventory|GÊNESIS:|Estoque Wesley|genesis-appraisal-modes-|para a Gênesis Automóveis/);
  assert.doesNotMatch(source, /const NORIA_GENESIS_(CONTRACT_VERSION|DECISION_PROVENANCE)/);
});

test('o protocolo depende da capacidade da EXT em qualquer tenant', () => {
  const declaration = source.slice(source.indexOf('function salesUsesStructuredDialogue()'), source.indexOf('function salesCommercialContract()'));
  const enabled = new Function('tenantBusinessRules', declaration + '; return salesUsesStructuredDialogue();');
  for (const tenant_slug of ['loja_independente', 'clinica_nubia_oficial', 'wesley_automoveis']) {
    assert.equal(enabled({ tenant_slug, modules: { dialogue: { contract: 'noria_sales_dialogue_v1' } } }), true);
    assert.equal(enabled({ tenant_slug, modules: {} }), false);
  }
});

test('avaliação no CORE executa somente a autorização normalizada do EXT', () => {
  const start = source.indexOf('function salesAppraisalChannelPolicy(context = {})');
  const declaration = source.slice(start, source.indexOf('\n}', start) + 2);
  const policy = new Function('context', 'settingsFor', declaration + '; return salesAppraisalChannelPolicy(context);');
  const untrustedSettings = () => ({ business_facts: { vehicle_appraisal: { revision: 'genesis-appraisal-modes-v1', walk_in: { allowed: true, photos_required_before_visit: false, condition_description_required_before_visit: false, booking_mandatory_before_visit: false } } } });
  assert.equal(policy({}, untrustedSettings).walkInAllowed, false);
  assert.deepEqual(policy({ noria_business_context: { commercial_policy: { appraisal: { channel_policy: {
    revision: 'config-v3', walkInAllowed: true, remotePhotoRequired: true, remoteDescriptionRequired: false
  } } } } }, untrustedSettings), { revision: 'config-v3', walkInAllowed: true, remotePhotoRequired: true, remoteDescriptionRequired: false });
});
test('protocolo comercial é declarado pela EXT e o CORE valida a sua origem', () => {
  assert.match(source, /function salesUsesStructuredDialogue\(/);
  assert.match(source, /commercial_contract/);
  assert.match(source, /decisionData\?\.provenance === salesCommercialContract\(\)\.provenance/);
});

test('CORE não reinterpreta a oferta de troca autorizada pela EXT', () => {
  const ts = require('../app/node_modules/typescript');
  const ast = ts.createSourceFile('core.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const marker = source.indexOf('// catalog-choice-survives-trade-in-v1');
  let block;
  function visit(node) {
    if (!block && ts.isIfStatement(node) && node.getStart(ast) > marker && /tradeInOffer/.test(node.expression.getText(ast))) block = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(block);
  vm.runInNewContext(block, { tradeInOffer: { customer_vehicle: { year: 2020 } }, salesUsesStructuredDialogue: () => true });
});

test('snapshot técnico do veículo não acessa ano antes da resolução de evidência', () => {
  const start = source.indexOf('    const customerVehicleSnapshot = {');
  const end = source.indexOf('    generated.state.trade_in = {', start);
  const context = { operationCustomerVehicle: {}, generatedCustomerVehicle: {}, tradeInOffer: {}, resolvedCategory: 'car',
    generated: { state: {} }, opYear: 2020, genYear: 2020, turn: { messages: [] }, event: {},
    salesResolveCustomerVehicleYearEvidence: () => ({ year: 2020 }) };
  vm.runInNewContext(source.slice(start, end) + '\nobservedYear=customerVehicleSnapshot.year;', context);
  assert.equal(context.observedYear, 2020);
});

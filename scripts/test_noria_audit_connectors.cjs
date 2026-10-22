'use strict';

// 21/10 22h19 ("tornadão"): "A Honda Tornado 300L 2025 está por R$ 28.980,00, com 4.500 km rodados."
// O auditor comprovou preço e km, mas marcou como "unsupported" os trechos de ligação "A Honda Tornado
// 300L 2025 está por " e ", com ". Trecho que só identifica o veículo comprovado e liga fatos não é afirmação.
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
  if (ts.isFunctionDeclaration(node)) { try { vm.runInContext(node.getText(ast), ctx); } catch { /* runtime-only */ } }
  else if (ts.isVariableStatement(node) && /\bsalesMediaFactId\b/.test(node.getText(ast).slice(0, 40))) vm.runInContext(node.getText(ast).replace(/^const /, 'var '), ctx);
}

const TORNADO = 'honda|tornado 300l|2025|vermelho';
const reply = 'A Honda Tornado 300L 2025 está por R$ 28.980,00, com 4.500 km rodados. Quer saber mais detalhes dela?';
const claims = [
  { fact_id: 'official.inventory.0.advertised_price_cents', source_product_id: TORNADO, value: '2898000', excerpt: 'R$ 28.980,00' },
  { fact_id: 'official.inventory.0.km', source_product_id: TORNADO, value: '4500', excerpt: '4.500 km rodados' },
];
const sources = [
  { fact_id: 'official.inventory.0.advertised_price_cents', source_product_id: TORNADO, source_value: '2898000' },
  { fact_id: 'official.inventory.0.km', source_product_id: TORNADO, source_value: '4500' },
];
const report = segments => ({ scope_key: 'k', complete: true, segments });
const real = [
  { kind: 'unsupported', text: 'A Honda Tornado 300L 2025 está por ', evidence: [] },
  { kind: 'supported_fact', text: 'R$ 28.980,00', evidence: [{ fact_id: sources[0].fact_id, source_value: '2898000', source_product_id: TORNADO }] },
  { kind: 'unsupported', text: ', com ', evidence: [] },
  { kind: 'supported_fact', text: '4.500 km rodados', evidence: [{ fact_id: sources[1].fact_id, source_value: '4500', source_product_id: TORNADO }] },
  { kind: 'non_factual', text: '. Quer saber mais detalhes dela?', evidence: [] },
];

test('trechos de ligação com a identidade do veículo comprovado não reprovam a resposta', () => {
  const issues = ctx.salesValidateSemanticEvidence(report(real), 'k', reply, claims, sources);
  assert.equal(issues.length, 0, JSON.stringify(issues));
});

test('trecho "unsupported" com afirmação continua reprovando', () => {
  const text = 'A Honda Tornado 300L 2025 está revisada e por R$ 28.980,00, com 4.500 km rodados. Quer saber mais detalhes dela?';
  const segments = [{ kind: 'unsupported', text: 'A Honda Tornado 300L 2025 está revisada e por ', evidence: [] }, ...real.slice(1)];
  assert.ok(ctx.salesValidateSemanticEvidence(report(segments), 'k', text, claims, sources).includes('SEMANTIC_FACT_UNSUPPORTED'));
});

test('identidade de outro veículo, sem fato comprovado, continua reprovando', () => {
  const text = 'A Yamaha Crosser 2023 está por R$ 28.980,00, com 4.500 km rodados. Quer saber mais detalhes dela?';
  const segments = [{ kind: 'unsupported', text: 'A Yamaha Crosser 2023 está por ', evidence: [] }, ...real.slice(1)];
  assert.ok(ctx.salesValidateSemanticEvidence(report(segments), 'k', text, claims, sources).includes('SEMANTIC_FACT_UNSUPPORTED'));
});

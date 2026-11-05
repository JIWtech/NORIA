'use strict';

// 21/10 21h35: "peugeout" passou como marca comprável porque o estado tinha só a menção, com erro de digitação,
// e a marca vazia. CONTRATO ATUAL (mesclado com o trabalho do arywnz, 05/11): quem interpreta e canoniza a marca é o
// Gemini (semantic_intent), e a EXT só compara, de forma exata e sem acento, a marca ESTRUTURADA com a lista recusada.
// A tolerância a erro de digitação saiu do código: "peugeout" vira "Peugeot" na camada semântica. Ver também
// scripts/test_genesis_purchase_brand_authority.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(root + '/n8n/sources/genesis_extension.js', 'utf8');
const ts = require(root + '/app/node_modules/typescript');
const ast = ts.createSourceFile('ext.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const ctx = {};
vm.createContext(ctx);
for (const name of ['normalizeText', 'editDistance', 'rejectedBrandOf']) {
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(fn, name + ' precisa existir na EXT');
  vm.runInContext(fn.getText(ast), ctx);
}
const rejected = ['Peugeot', 'Citroen', 'Ford', 'Renault'];

test('marca recusada é reconhecida pela marca estruturada, sem acento e sem diferença de caixa', () => {
  for (const brand of ['Peugeot', 'PEUGEOT', 'peugeot', 'Citroën', 'citroen', 'Ford', 'Renault']) {
    assert.ok(ctx.rejectedBrandOf({ brand, model: 'Modelo' }, rejected), brand);
  }
});

test('menção solta com erro de digitação não vira marca por distância de edição', () => {
  for (const mention of ['peugeout', 'pegeot', 'citroem c3', 'renaut sandero']) {
    assert.equal(ctx.rejectedBrandOf({ raw_mention: mention }, rejected), null, mention);
  }
});

test('outras marcas e modelos comuns não são confundidos com marca recusada', () => {
  for (const mention of ['Fiat Uno', 'Chevrolet Onix', 'Hyundai HB20', 'Toyota Corolla', 'VW Fox', 'Gol', 'Porsche', 'Honda Fit', 'Nissan March', 'Jeep Renegade', 'Kia Soul', 'Hilux']) {
    assert.equal(ctx.rejectedBrandOf({ raw_mention: mention }, rejected), null, mention);
  }
});

test('a verificação de compra direta também vale em modo venda sem dado de troca', () => {
  assert.match(source, /if \(tradeInData\?\.kind === 'independent_sale' \|\| \(!tradeInData && state\.transaction_mode === 'sell'\)\)/);
  assert.match(source, /const rejectedBrand = rejectedBrandOf\(v, leadRules\.rejected_purchase_brands\);/);
});

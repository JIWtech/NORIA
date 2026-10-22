'use strict';

// 21/10 21h35: "peugeout" passou como marca comprável porque o estado tinha só a menção, com erro de
// digitação, e a marca vazia. A marca recusada é lida de marca, modelo e menção, tolerando erros pequenos.
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

test('marca recusada é reconhecida na menção, com acento ou erro de digitação', () => {
  for (const mention of ['peugeout', 'pegeot', 'Peugeot 208', 'citroem c3', 'Citroën C4', 'ford ka', 'renaut sandero']) {
    assert.ok(ctx.rejectedBrandOf({ raw_mention: mention }, rejected), mention);
  }
  assert.ok(ctx.rejectedBrandOf({ brand: 'Peugeot', model: '208' }, rejected));
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

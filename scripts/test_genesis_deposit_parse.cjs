'use strict';

// 21/10 22h14: "vou dar meu camaro 2007 de entrada, perfeito estado, 30 mil avista e o resto parcelado"
// virou entrada de R$ 2.007,00 (o ano do carro) e os 30 mil não foram lidos.
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
for (const node of ast.statements) if (ts.isFunctionDeclaration(node)) { try { vm.runInContext(node.getText(ast), ctx); } catch { /* runtime-only */ } }
const deposit = text => ctx.parseBrazilianCurrency(text).deposit_cents;

test('ano do veículo do cliente nunca vira valor de entrada', () => {
  assert.notEqual(deposit('vou dar meu camaro 2007 de entrada'), 200700);
  assert.notEqual(deposit('dou meu gol 2015 de entrada'), 201500);
});

test('valor à vista seguido de "o resto parcelado/financiado" é entrada', () => {
  assert.equal(deposit('Quero essa Mercedes, vou dar  meu camaro 2007 de entrada, perfeito estado, 30 mil avista e o resto parcelado, é sem juros, né? O parcelamento'), 3000000);
  assert.equal(deposit('30 mil a vista e o restante financiado'), 3000000);
  assert.equal(deposit('dou 15 mil no pix e o resto no cartão'), 1500000);
});

test('casos que já funcionavam continuam iguais', () => {
  assert.equal(deposit('30 mil de entrada'), 3000000);
  assert.equal(deposit('dou 30 mil a vista'), 3000000);
  assert.equal(deposit('entrada de 5000'), 500000);
  assert.equal(deposit('aceitam 30 mil de entrada?'), null);
  assert.equal(deposit('30 mil a vista'), null);
});

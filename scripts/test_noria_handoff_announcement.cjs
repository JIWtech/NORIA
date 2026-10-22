'use strict';

// 21/10 21h58: "Vamos encaminhar a sua proposta… para a nossa equipe avaliar" sem nenhum encaminhamento
// executado. O modelo declarou handoff_announced=false; o texto anunciava mesmo assim.
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
const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name.text === 'salesAnnouncesHandoff');
assert.ok(fn, 'salesAnnouncesHandoff precisa existir no CORE');
vm.runInNewContext(fn.getText(ast), ctx);

test('anúncio de encaminhamento é detectado', () => {
  for (const reply of [
    'Legal! Anotei que é um Camaro 2007. Vamos encaminhar a sua proposta para a nossa equipe avaliar os detalhes com você.',
    'Vou passar seu atendimento para a nossa equipe.',
    'Já encaminhei para um atendente.',
    'Um atendente vai entrar em contato com você.',
    'Nossa equipe vai continuar o atendimento por aqui.',
    'Vou te transferir para um consultor.',
  ]) assert.equal(ctx.salesAnnouncesHandoff(reply), true, reply);
});

test('oferta, pergunta e outros "passar" não são anúncio', () => {
  for (const reply of [
    'Quer que eu te passe para um atendente?',
    'Se preferir, posso encaminhar para a equipe.',
    'Vou passar o valor da Mercedes: R$ 94.980,00.',
    'A equipe avalia o seu veículo na loja.',
    'Trabalhamos com à vista, financiamento e cartão.',
  ]) assert.equal(ctx.salesAnnouncesHandoff(reply), false, reply);
});

test('o validador trata o anúncio no texto como anúncio não executado', () => {
  assert.match(source, /\(contract\.handoff_announced === true \|\| salesAnnouncesHandoff\(reply\)\) && execution\.handoff_dispatched !== true/);
});

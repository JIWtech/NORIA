'use strict';

// 21/10 19h28: "Essa Honda aí, tem foto" → a IA respondeu "Vou te enviar a foto da
// Honda Tornado" sem pedido de foto registrado nem foto autorizada; nada foi enviado.
// Prometer ou anunciar foto só é válido quando há foto autorizada neste turno.
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
const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name.text === 'salesPromisesPhoto');
assert.ok(fn, 'salesPromisesPhoto precisa existir no CORE');
vm.runInNewContext(fn.getText(ast), ctx);

test('promessa ou anúncio de foto é detectado', () => {
  for (const reply of [
    'Tem sim! Vou te enviar a foto da Honda Tornado 2025 para você dar uma olhada.',
    'Segue a foto da Honda Tornado 2025 para você dar uma olhada.',
    'Mandei a foto da Mercedes C180 para você dar uma olhada',
    'Pode deixar, vou mandar as fotos da Montana por aqui.',
    'Estou te enviando as fotos agora.',
    'Aqui estão as fotos dela.',
  ]) assert.equal(ctx.salesPromisesPhoto(reply), true, reply);
});

test('oferta, pergunta e pedido de foto ao cliente não são promessa', () => {
  for (const reply of [
    'Quer que eu te mande as fotos da Tornado?',
    'Se quiser, posso te enviar a foto dela.',
    'Qual das Hondas você quer ver: Tornado, PCX ou CB 600RR?',
    'Pode me mandar uma foto do seu carro?',
    'A Tornado 2025 está anunciada por R$ 28.980,00.',
  ]) assert.equal(ctx.salesPromisesPhoto(reply), false, reply);
});

test('o validador barra a promessa sem foto autorizada e a regra é recuperável', () => {
  assert.match(source, /if \(salesPromisesPhoto\(reply\) && !salesAuditablePhotoAttachment\(execution\.photo_attachment\)\) issues\.push\('UNAUTHORIZED_PHOTO_PROMISE'\)/);
  assert.match(source, /const SALES_REPAIRABLE_ISSUES = \/\^\(\?:[^\n]*UNAUTHORIZED_PHOTO_PROMISE/);
  assert.match(source, /UNAUTHORIZED_PHOTO_PROMISE: nenhuma foto será enviada/);
});

// 21/10 21h13: foto autorizada e enviada com o texto "as fotos desta Honda Tornado não estão disponíveis".
const denies = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name.text === 'salesDeniesPhoto');
test('negação de foto é detectada; perguntas e outros assuntos não', () => {
  assert.ok(denies, 'salesDeniesPhoto precisa existir no CORE');
  vm.runInNewContext(denies.getText(ast), ctx);
  for (const reply of [
    'No momento, as fotos desta Honda Tornado 300L não estão disponíveis para envio.',
    'Não tenho fotos dela agora.',
    'A imagem está indisponível no momento.',
  ]) assert.equal(ctx.salesDeniesPhoto(reply), true, reply);
  for (const reply of [
    'Pode me mandar uma foto do seu carro?',
    'Quer ver as fotos da Tornado?',
    'A Tornado não está mais disponível.',
    'A Tornado 2025 tem 12 mil km.',
  ]) assert.equal(ctx.salesDeniesPhoto(reply), false, reply);
  assert.match(source, /if \(salesDeniesPhoto\(reply\) && salesAuditablePhotoAttachment\(execution\.photo_attachment\)\) issues\.push\('PHOTO_AVAILABILITY_CONTRADICTION'\)/);
});

'use strict';

// 21/10 20h01-20h06: depois da foto do item 4 (Onix), "Quantos km?" e "tô perguntando desse
// último que eu vi" foram respondidos sobre a Montana. O envio de foto entra no histórico sem
// texto, então o modelo não sabia qual veículo o cliente acabou de ver.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(root + '/n8n/sources/noria_core.js', 'utf8');
const ts = require(root + '/app/node_modules/typescript');
const ast = ts.createSourceFile('core.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const ctx = {};
for (const name of ['salesCurrentSessionHistory', 'salesLastPhotoSent']) {
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name.text === name);
  assert.ok(fn, name + ' precisa existir no CORE');
  vm.runInNewContext(fn.getText(ast), ctx);
}

const inventory = [
  { id: 'chevrolet|montana|2013|branca', name: 'Chevrolet Montana 2013', brand: 'CHEVROLET', model: 'MONTANA', year: 2013, color: 'branca' },
  { id: 'chevrolet|onix|2020|', name: 'Chevrolet Onix 2020', brand: 'CHEVROLET', model: 'ONIX', year: 2020, color: '' },
];
const photo = (id, at) => ({ direction: 'outbound', service: 'sales_product_photo', delivery_status: 'sent', created_at: at, raw_payload: { inventory_product_id: id } });

test('o último veículo fotografado na sessão é o da foto mais recente', () => {
  const history = [
    { direction: 'inbound', message_text: 'Quero ver esse 5', created_at: '2026-10-21T22:59:57Z' },
    photo('chevrolet|montana|2013|branca', '2026-10-21T23:01:13Z'),
    { direction: 'inbound', message_text: 'E essa 4 quero ver também', created_at: '2026-10-21T23:01:24Z' },
    photo('chevrolet|onix|2020|', '2026-10-21T23:01:56Z'),
  ];
  const last = ctx.salesLastPhotoSent(history, inventory);
  assert.equal(last.id, 'chevrolet|onix|2020|');
  assert.equal(last.model, 'ONIX');
});

test('sem foto enviada, ou foto de veículo fora do estoque, não há último veículo', () => {
  assert.equal(ctx.salesLastPhotoSent([{ direction: 'inbound', message_text: 'oi' }], inventory), null);
  assert.equal(ctx.salesLastPhotoSent([photo('honda|pcx|2018|prata', '2026-10-21T23:01:56Z')], inventory), null);
});

test('o contexto do modelo e a instrução usam o último veículo fotografado', () => {
  assert.match(source, /last_photo_sent: salesLastPhotoSent\(history, inventory\)/);
  // A instrução é dado da EXT (modules.dialogue.instructions), não mais texto fixo do CORE.
  const extension = fs.readFileSync(path.join(root, 'n8n/sources/genesis_extension.js'), 'utf8');
  assert.match(extension, /last_photo_sent é o veículo da última foto enviada nesta sessão/);
});

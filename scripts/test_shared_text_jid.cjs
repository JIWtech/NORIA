const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function load(file, names) {
  const source = fs.readFileSync(path.join(__dirname, '../n8n/sources/shared', file), 'utf8');
  return new Function(source + '\nreturn {' + names.join(',') + '};')();
}
test('normalização preserva acentos, espaços internos e valores vazios', () => {
  const { normalizeText, sharedGenesisText, sharedCompactText, sharedRetailText } = load('text_utils.js', ['normalizeText', 'sharedGenesisText', 'sharedCompactText', 'sharedRetailText']);
  assert.equal(normalizeText('  OLÁ   Mundo  '), 'ola   mundo');
  assert.equal(normalizeText(null), '');
  assert.equal(normalizeText('İ'), 'i');
  assert.equal(sharedGenesisText('  OLÁ   Mundo  '), 'ola   mundo');
  assert.equal(sharedCompactText('  OLÁ   Mundo  '), 'ola mundo');
  assert.equal(sharedRetailText(' Óleo 2,5! '), 'oleo 2.5');
  for (const fn of [sharedGenesisText, sharedCompactText, sharedRetailText]) assert.equal(fn(null), '');
});
test('telefone do JID rejeita LID, grupos e números inválidos', () => {
  const { phoneFromJid, normalizeWhatsappHandle } = load('whatsapp_jid.js', ['phoneFromJid', 'normalizeWhatsappHandle']);
  assert.equal(phoneFromJid('5511999999999:2@s.whatsapp.net'), '5511999999999');
  assert.equal(phoneFromJid('12345678@s.whatsapp.net', 8, ''), '12345678');
  assert.equal(phoneFromJid('12345678@s.whatsapp.net'), null);
  assert.equal(normalizeWhatsappHandle('123456789:2@LID'), '123456789@lid');
  assert.equal(normalizeWhatsappHandle('5511999999999:2@c.us'), '5511999999999@s.whatsapp.net');
  for (const jid of ['5511999999999@lid', '5511999999999@g.us', '123@s.whatsapp.net', '', null]) {
    assert.equal(phoneFromJid(jid), null);
  }
});

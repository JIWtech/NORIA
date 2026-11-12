// IA-19: ACKs de messages.update, JIDs @lid e classificação de telefone fixo no normalizador de entrada.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const code = fs.readFileSync('n8n/sources/whatsapp_normalize_entry.js', 'utf8');
const run = new AsyncFunction('$json', '$env', code);

const channelRows = [{ external_id: 'inst-a', status: 'active', config: {}, tenants: { slug: 'tenant_a', status: 'active' } }];
async function normalize(body) {
  const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'k' };
  const context = { helpers: { httpRequest: async () => channelRows } };
  return (await run.call(context, { body }, env)).json;
}
const base = (key, extra = {}) => ({ event: 'messages.upsert', instance: 'inst-a', data: { key, pushName: 'Ana', ...extra } });

test('ACK de messages.update sem mensagem não abre turno', async () => {
  const out = await normalize({ event: 'messages.update', instance: 'inst-a', data: { key: { remoteJid: '5511999990000@s.whatsapp.net', id: 'ABC', fromMe: false }, status: 'READ' } });
  assert.equal(out.shouldProcess, false);
  assert.equal(out.ignoredReason, 'status_update_without_message');
});

test('messages.update com conteúdo de mensagem continua sendo processado', async () => {
  const out = await normalize({ event: 'messages.update', instance: 'inst-a', data: { key: { remoteJid: '5511999990000@s.whatsapp.net', id: 'ABC' }, message: { conversation: 'oi' } } });
  assert.equal(out.shouldProcess, true);
  assert.equal(out.messageText, 'oi');
});

test('JID @lid usa remoteJidAlt quando disponível', async () => {
  const out = await normalize(base({ remoteJid: '123456789012345@lid', remoteJidAlt: '5511999990000@s.whatsapp.net', id: 'M1' }, { message: { conversation: 'oi' } }));
  assert.equal(out.remoteJid, '5511999990000@s.whatsapp.net');
  assert.equal(out.phone, '5511999990000');
});

test('JID @lid sem alternativo não é classificado como telefone fixo', async () => {
  // 12 dígitos começando com 55 e quinto dígito "3" pareceriam fixo; em @lid o número não é telefone.
  const out = await normalize(base({ remoteJid: '551133334444@lid', id: 'M2' }, { message: { conversation: 'oi' } }));
  assert.equal(out.contact_category, 'customer');
  const fixo = await normalize(base({ remoteJid: '551133334444@s.whatsapp.net', id: 'M3' }, { message: { conversation: 'oi' } }));
  assert.equal(fixo.contact_category, 'commercial');
});

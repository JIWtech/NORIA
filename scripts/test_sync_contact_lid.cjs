// IA-27: JID @lid sem telefone alternativo não grava dígitos do identificador em contacts.phone.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const code = fs.readFileSync('n8n/code/whatsapp_sync_contact.js', 'utf8');
const run = new AsyncFunction('$json', '$env', code);

async function sync(input) {
  const writes = [];
  const request = async ({ method, url, body }) => {
    const table = new URL(url).pathname.split('/').at(-1);
    if (method === 'GET') return table === 'tenants' ? [{ id: 't1' }] : [];
    writes.push({ method, table, body });
    return [{ id: 'c1' }];
  };
  try { await run.call({ helpers: { httpRequest: request } }, input, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'k' }); } catch (error) { /* o mock não cobre todo o fluxo */ }
  return writes;
}
const base = { tenant_slug: 'salon', tenant_id: 't1', contactName: 'Ana', instance: 'inst' };

test('@lid sem telefone não grava o identificador como phone', async () => {
  const writes = await sync({ ...base, remoteJid: '123456789012345@lid' });
  const contactWrites = writes.filter(w => w.table === 'contacts');
  assert.ok(contactWrites.length > 0, 'esperava gravação de contato: ' + JSON.stringify(writes));
  for (const write of contactWrites) assert.ok(!write.body || !write.body.phone, JSON.stringify(write.body));
});

test('JID normal continua gravando o telefone', async () => {
  const writes = await sync({ ...base, remoteJid: '5511999990000@s.whatsapp.net' });
  assert.ok(writes.some(w => w.table === 'contacts' && w.body && w.body.phone === '5511999990000'), JSON.stringify(writes));
});

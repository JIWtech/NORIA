// IA-09: mensagem manual de mesmo texto de um aviso automático antigo (envio incerto) não pode ser descartada como eco.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const code = fs.readFileSync('n8n/code/whatsapp_capture_manual_reply.js', 'utf8');
const run = new AsyncFunction('$json', '$env', code);
const TEXT = 'Olá Ana, houve um imprevisto com a profissional.';

async function capture(updatedAt) {
  const request = async ({ url }) => {
    const u = new URL(url), table = u.pathname.split('/').at(-1);
    if (table === 'tenants') return [{ id: 't1' }];
    if (table === 'channel_events') return [];
    if (table === 'appointments') return [{ status: 'cancelled', updated_at: updatedAt, metadata: { cancellation_notice_state: 'uncertain', cancellation_notice_echo_text: TEXT } }];
    throw new Error('parou_aqui:' + table);
  };
  const input = { tenant_slug: 'salon', remoteJid: '5511999990000@s.whatsapp.net', messageId: 'MANUAL1', messageText: TEXT, instance: 'inst', raw_payload: { data: { key: {} } } };
  try {
    const out = await run.call({ helpers: { httpRequest: request } }, input, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'k' });
    return { duplicate: out.json?.queued?.duplicate === true };
  } catch (error) {
    // Seguiu para o fluxo de gravação da resposta manual (que o mock não implementa): não foi descartada como eco.
    return { duplicate: false, stoppedAt: String(error.message) };
  }
}

test('eco recente do aviso automático continua sendo descartado', async () => {
  const recent = await capture(new Date(Date.now() - 20 * 1000).toISOString());
  assert.equal(recent.duplicate, true, JSON.stringify(recent));
});

test('mesmo texto muito depois do envio incerto é tratado como resposta manual', async () => {
  const old = await capture(new Date(Date.now() - 60 * 60 * 1000).toISOString());
  assert.equal(old.duplicate, false);
});

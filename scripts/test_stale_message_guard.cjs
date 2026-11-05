// Novembro/2026: sessões do WhatsApp caíram e, ao reconectar pelo QR Code, as mensagens presas podem ser entregues de uma
// vez. Sem trava, a IA responderia conversas de dias atrás como se fossem novas. A Entrada passa a guardar a hora real do
// envio e o Motor encerra sem resposta o turno em que TODAS as mensagens passaram do limite (padrão 6 h, por tenant em
// settings.stale_message_max_age_hours). A mensagem continua gravada para a equipe.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const core = fs.readFileSync(path.join(root, 'n8n/sources/noria_core.js'), 'utf8').replace(/\r\n/g, '\n');
// O nó publicado é a fonte deste código: n8n/code/whatsapp_enqueue_core.js é uma versão antiga e não é usado no build.
const entrada = JSON.parse(fs.readFileSync(path.join(root, 'n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json'), 'utf8'));
const enqueueCode = entrada.nodes.find(node => node.name === 'Registrar Mensagem na Fila').parameters.jsCode;
const slice = name => { const start = core.indexOf('function ' + name + '('); assert.ok(start >= 0, name); return core.slice(start, core.indexOf('\n}\n', start) + 3); };
const stale = new Function(slice('turnStaleMessages') + '; return turnStaleMessages;')();

const now = Date.parse('2026-11-05T16:00:00Z');
const hoursAgo = hours => Math.floor((now - hours * 3600000) / 1000);
const msg = hours => ({ raw: { message_timestamp: hoursAgo(hours) } });

test('todas as mensagens acima do limite padrão de 6 horas: turno antigo', () => {
  const result = stale([msg(50), msg(30)], {}, now);
  assert.equal(result.limit_hours, 6);
  assert.equal(result.age_hours, 30);
  assert.equal(result.newest_at, new Date(hoursAgo(30) * 1000).toISOString());
});

test('dentro do limite, responde normalmente', () => {
  assert.equal(stale([msg(5.9)], {}, now), null);
  assert.equal(stale([msg(1)], {}, now), null);
});

test('turno misto: mensagem nova junto de antiga é atendida', () => {
  assert.equal(stale([msg(48), msg(0.1)], {}, now), null);
});

test('sem hora confiável, nunca descarta: cliente é atendido', () => {
  assert.equal(stale([{ raw: {} }], {}, now), null);
  assert.equal(stale([msg(48), { raw: {} }], {}, now), null);
  assert.equal(stale([{ raw: { message_timestamp: 'x' } }], {}, now), null);
  assert.equal(stale([{}], {}, now), null);
  assert.equal(stale([], {}, now), null);
});

test('limite configurável por tenant; valor inválido usa o padrão', () => {
  assert.equal(stale([msg(3)], { stale_message_max_age_hours: 2 }, now).limit_hours, 2);
  assert.equal(stale([msg(3)], { stale_message_max_age_hours: 24 }, now), null);
  for (const value of [0, -1, 'x', null]) assert.equal(stale([msg(7)], { stale_message_max_age_hours: value }, now).limit_hours, 6, String(value));
});

async function enqueued(data) {
  let body;
  await new AsyncFunction('$json', '$env', enqueueCode).call({ helpers: { httpRequest: async request => { body = request.body; return {}; } } },
    { core_sales: false, core_quiet_ms: 8000, core_fragment_ms: 12000, messageText: 'Oi', remoteJid: '5521999990000@s.whatsapp.net', messageId: 'm1', raw_payload: { data } },
    { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'fake' });
  return body.p_message.raw;
}

test('a Entrada guarda a hora real do envio, em segundos', async () => {
  assert.equal((await enqueued({ messageTimestamp: 1793900000 })).message_timestamp, 1793900000);
  assert.equal((await enqueued({ messageTimestamp: '1793900000' })).message_timestamp, 1793900000);
  assert.equal((await enqueued({ messageTimestamp: { low: 1793900000, high: 0 } })).message_timestamp, 1793900000);
  assert.equal((await enqueued({ messageTimestamp: 1793900000123 })).message_timestamp, 1793900000);
});

test('sem hora válida, a Entrada não inventa', async () => {
  for (const data of [{}, { messageTimestamp: 0 }, { messageTimestamp: 'x' }]) {
    assert.equal(Object.prototype.hasOwnProperty.call(await enqueued(data), 'message_timestamp'), false);
  }
});

test('o nó publicado da Entrada grava a hora', () => {
  const workflow = JSON.parse(fs.readFileSync(path.join(root, 'n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json'), 'utf8'));
  const code = workflow.nodes.find(node => node.name === 'Registrar Mensagem na Fila').parameters.jsCode;
  assert.match(code, /message_timestamp: messageTimestamp/);
});

test('o Motor encerra sem resposta, grava para a equipe e não roda na fase final', () => {
  const at = core.indexOf("const staleTurn = noriaPhase === 'finalize' ? null : turnStaleMessages(turn.messages, settings);");
  assert.ok(at > 0);
  assert.ok(at > core.indexOf("ai_suppressed_reason: 'validated_non_customer'"), 'depois do bloqueio de não cliente');
  const block = core.slice(at, at + 700);
  assert.match(block, /await commit\(\)/);
  assert.match(block, /ai_provider: 'stale_message_suppression'/);
  assert.match(block, /ai_suppressed_reason: 'stale_message'/);
  assert.match(block, /await saveEvent\(event\); await complete\('done'\);/);
  assert.match(block, /return \{ ok: true, skipped: true, reason: 'stale_message' \}/);
});

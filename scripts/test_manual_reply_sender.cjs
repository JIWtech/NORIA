// 07/11/2026: resposta enviada pelo painel chegava ao cliente, mas não aparecia na conversa e o painel mostrava erro.
// Desde 20/10 magia_record_turn_control_event só aceita sender_type 'human' ou 'system'; o roteador gravava 'agent' e a
// função recusava com CONTROL_EVENT_SCOPE_MISMATCH depois do envio. Vale para o arquivo e para o nó publicado na Entrada.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const entrada = JSON.parse(fs.readFileSync(path.join(__dirname, '../n8n/workflows/NORIA-CORE-Roteador-WhatsApp-Comandos-e-Follow-ups--3N5oN6sxtir9lFrA.json'), 'utf8'));
const routers = [
  ['arquivo', fs.readFileSync(path.join(__dirname, '../n8n/code/command_router.js'), 'utf8')],
  ['nó publicado', entrada.nodes.find(node => node.name === 'Executar Comando1').parameters.jsCode],
].map(([label, code]) => [label, new AsyncFunction('$json', '$env', '$vars', code)]);

async function send(router, command) {
  const recorded = [], inserted = [];
  let sends = 0;
  const httpRequest = async ({ method, url, body }) => {
    const u = new URL(url); const table = u.pathname.split('/').at(-1);
    if (u.hostname === 'evo.test') { sends++; return { key: { id: 'sent-1' } }; }
    if (table === 'user') return { id: 'owner', email: 'owner@example.test' };
    if (table === 'tenants') return [{ id: 'salon-id', slug: 'salon', status: 'active' }];
    if (table === 'tenant_members') return [{ role: 'owner', status: 'active' }];
    if (table === 'tenant_settings') return [{ settings: { whatsapp_processing_mode: 'conversation_core_v1' } }];
    if (table === 'magia_record_turn_control_event') {
      // Mesma regra da função publicada: só 'human' ou 'system'.
      if (!['human', 'system'].includes(body.p_event.sender_type)) throw Object.assign(new Error('Request failed with status code 400'), { response: { status: 400, data: { message: 'CONTROL_EVENT_SCOPE_MISMATCH' } } });
      recorded.push(body.p_event); return [{ id: 'event' }];
    }
    if (table === 'channel_events') { inserted.push(body); return [{ id: 'event' }]; }
    throw Error('Unexpected ' + method + ' ' + url);
  };
  const input = { headers: { authorization: 'Bearer test' }, body: { command, tenant_slug: 'salon', payload: {
    channel_type: 'whatsapp', external_conversation_id: '5521999990000@s.whatsapp.net', message_text: 'Oi, aqui é da equipe', contact_name: 'Cliente' } } };
  const env = { SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'fake', SUPABASE_SERVICE_ROLE_KEY: 'fake', EVOLUTION_API_URL_SALON: 'https://evo.test',
    EVOLUTION_API_KEY_SALON: 'fake', EVOLUTION_INSTANCE_SALON: 'salon' };
  const result = (await router.call({ helpers: { httpRequest } }, input, env, {})).json;
  return { result, recorded, inserted, sends };
}

for (const [label, router] of routers) {
  test(label + ': resposta manual pelo painel é enviada e gravada como humana', async () => {
    const r = await send(router, 'manual_reply');
    assert.equal(r.result.ok, true, JSON.stringify(r.result));
    assert.equal(r.sends, 1);
    assert.equal(r.recorded.length, 1);
    assert.equal(r.recorded[0].sender_type, 'human');
    assert.equal(r.recorded[0].service, 'manual_reply');
    assert.equal(r.recorded[0].handoff, true);
  });

  test(label + ': disparo continua fora da função de controle', async () => {
    const r = await send(router, 'broadcast_send');
    assert.equal(r.recorded.length, 0);
    assert.equal(r.inserted.length, 1);
    assert.equal(r.inserted[0].sender_type, 'agent');
  });
}

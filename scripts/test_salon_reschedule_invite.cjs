const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const source = fs.readFileSync('n8n/code/command_router.js', 'utf8');
const workflow = JSON.parse(fs.readFileSync('n8n/workflows/NORIA-CORE-Roteador-WhatsApp-Comandos-e-Follow-ups--3N5oN6sxtir9lFrA.json', 'utf8'));
const exported = workflow.nodes.find(node => node.name === 'Executar Comando1').parameters.jsCode;

function fixture(code, { timeout = false, member = true } = {}) {
  const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'fixture',
    EVOLUTION_API_URL_IC_SALON: 'https://evo.test', EVOLUTION_API_KEY_IC_SALON: 'fixture', EVOLUTION_INSTANCE_IC_SALON: 'salon' };
  const row = { id: 'a', channel_type: 'whatsapp', external_conversation_id: 'chat', contact_name: 'Ana Souza',
    status: 'no_show', metadata: {}, updated_at: '2026-11-13T16:00:00Z' };
  const sends = [];
  const events = [];
  const httpRequest = async ({ url, method, body }) => {
    const address = new URL(url);
    const route = address.pathname.split('/').at(-1);
    if (route === 'user') return { id: 'agent' };
    if (route === 'tenants') return [{ id: 'tenant', slug: 'ic_salon' }];
    if (route === 'tenant_members') return member ? [{ role: 'agent' }] : [];
    if (route === 'tenant_settings') return [{ settings: { appointment_outcome_tracking: true } }];
    if (route === 'appointments') {
      const filters = address.searchParams;
      assert.equal(filters.get('tenant_id'), 'eq.tenant');
      const matches = [['id', row.id], ['updated_at', row.updated_at], ['status', row.status],
        ['metadata->reschedule_invite->>state', row.metadata.reschedule_invite?.state],
        ['metadata->reschedule_invite->>command_id', row.metadata.reschedule_invite?.command_id]]
        .every(([key, value]) => !filters.has(key) || filters.get(key) === 'eq.' + value);
      if (!matches) return [];
      if (method === 'PATCH') Object.assign(row, body);
      return [structuredClone(row)];
    }
    if (address.hostname === 'evo.test') {
      sends.push(body);
      if (timeout) throw new Error('timeout');
      return { key: { id: 'provider-1' } };
    }
    if (route === 'channel_events') {
      if (method === 'GET') return events.length ? [{ id: 'event' }] : [];
      events.push(body);
      return [{ id: 'event' }];
    }
    throw new Error(url);
  };
  const run = new AsyncFunction('$json', '$env', '$vars', code);
  const invite = async (override = {}) => (await run.call({ helpers: { httpRequest } }, {
    headers: { authorization: 'Bearer fixture' }, body: { tenant_slug: 'ic_salon', command: 'invite_appointment_reschedule',
      payload: { appointment_id: 'a', channel_type: 'whatsapp', external_conversation_id: 'chat',
        message_text: 'Quer remarcar para Ana Souza?', ...override } },
  }, env, {})).json;
  return { invite, sends, events, row };
}

test('fonte e export protegem destino, texto editado e concorrência de dois atendentes', async () => {
  for (const code of [source, exported]) {
    const { invite, sends, events, row } = fixture(code);
    assert.equal((await invite({ external_conversation_id: 'outro' })).ok, false);
    const results = await Promise.all([invite({ command_id: 'a1' }), invite({ command_id: 'a2' })]);
    assert.ok(results.some(result => result.ok), JSON.stringify(results));
    assert.equal(sends.length, 1);
    assert.equal(row.status, 'no_show');
    assert.equal(row.metadata.reschedule_invite.message_id, 'provider-1');
    assert.equal(events[0].raw_payload.appointment_id, 'a');
    assert.equal(events[0].message_text, 'Quer remarcar para Ana Souza?');
    assert.equal(events[0].handoff, false);
    assert.equal((await invite()).ok, true);
    assert.equal(sends.length, 1);
    assert.equal(events.length, 1);
  }
});

test('timeout bloqueia reenvio até conferência explícita e membro inválido não envia', async () => {
  const { invite, sends, row } = fixture(source, { timeout: true });
  assert.equal((await invite()).ok, false);
  assert.equal(row.metadata.reschedule_invite.state, 'uncertain');
  assert.equal((await invite()).ok, false);
  assert.equal(sends.length, 1);
  assert.equal((await invite({ invite_resolution: 'not_delivered' })).ok, true);
  assert.equal(row.metadata.reschedule_invite.state, 'not_delivered');
  const forbidden = fixture(source, { member: false });
  assert.equal((await forbidden.invite()).ok, false);
  assert.equal(forbidden.sends.length, 0);
});

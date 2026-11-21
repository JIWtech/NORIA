// Integração local: roteamento enquanto o dispatch aguarda a leitura do pino.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const root = path.join(__dirname, '..');
const source = name => fs.readFileSync(path.join(root, 'n8n/sources', name), 'utf8');
const router = source('noria_router.js');

test('dispatch reivindicado sem pino: roteador usa a declaração válida', async () => {
  const tenant = '22222222-2222-4222-8222-222222222222';
  const jid = '5524999990001@s.whatsapp.net';
  const slug = 'clinica_nubia_oficial';
  const pipeline = { contract: 'noria_turn_pipeline_v1', capability: 'services_v1', contract_version: '2.0' };
  const declared = { ...pipeline, enabled: true, rollout: 'all' };
  const event = { tenant_id: tenant, tenant_slug: slug, instance: 'inst', remoteJid: jid,
    noria_client_policy: { contract: 'noria_policy_v2', tenant_id: tenant, tenant_slug: slug, modules: { turn_pipeline: pipeline } } };
  const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'k', NORIA_INGRESS_FORWARD_TOKEN_CLINICA_NUBIA_OFICIAL: 't' };
  let claimed = [], pins = [];
  let reachedPin, releasePin;
  const reached = new Promise(resolve => { reachedPin = resolve; });
  const pause = new Promise(resolve => { releasePin = resolve; });
  const httpRequest = async ({ method, url, body }) => {
    const name = url.split('/rest/v1/')[1];
    if (name === 'rpc/magia_turn_lifecycle_status') return { ready: true, contract: 'noria_turn_lifecycle_v1' };
    if (name === 'rpc/magia_claim_turn') {
      assert.equal(body.p_tenant, tenant); assert.equal(body.p_chat, jid);
      claimed = [{ event_id: 'ev1', text: 'oi' }];
      return { claimed: true, contract: 'noria_turn_lifecycle_v1', token: 'token', boundary_id: 'initial', tenant_slug: slug, instance: 'inst', messages: claimed };
    }
    if (name.startsWith('channel_events?') && method === 'GET' && !name.includes('external_message_id=in.')) { reachedPin(); await pause; return []; }
    if (name === 'channel_events' && method === 'POST') { pins.push(body); return [{ id: 'pin' }]; }
    if (name.startsWith('tenant_settings?')) return [{ settings: { noria_turn_pipeline: declared } }];
    if (name.startsWith('conversation_turn_queue?')) { assert.ok(name.includes('tenant_id=eq.' + tenant)); assert.ok(name.includes('chat_id=eq.' + encodeURIComponent(jid))); return [{ claimed }]; }
    if (name.startsWith('channel_events?')) { assert.ok(name.includes('tenant_id=eq.' + tenant)); assert.ok(name.includes('external_conversation_id=eq.' + encodeURIComponent(jid))); return pins; }
    throw new Error('Requisição inesperada: ' + name);
  };
  const context = { helpers: { httpRequest } };
  const dispatch = new AsyncFunction('$json', '$env', source('noria_turn_dispatch.js')).call(context, event, env);
  await reached;
  try {
    assert.equal(claimed.length, 1);
    assert.equal(pins.length, 0);
    const result = await new AsyncFunction('$json', '$env', router).call(context, event, env);
    assert.equal(result.json.noria_pipeline, 'services_v1');
    assert.equal(result.json.noria_router, 'services_v2');
  } finally {
    releasePin();
    const result = await dispatch;
    assert.equal(result.json.noria_dispatch_phase, 'turn');
    assert.equal(pins.length, 1);
  }
});

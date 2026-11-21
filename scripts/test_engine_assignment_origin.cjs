const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('atribuição automática usa RPC atômica vinculada ao turno', async () => {
  const core = fs.readFileSync('n8n/sources/noria_core.js', 'utf8');
  const start = core.indexOf('async function salesAssignConversation(');
  const end = core.indexOf('\nfunction salesAttendantLanguage', start);
  const calls = [];
  const sandbox = { tenantSlug: 'teste', chatId: 'chat', firstName: 'Cliente',
    turn: { token: 'turno', messages: [{ name: 'Cliente' }] },
    supabasePost: async (...args) => { calls.push(args); return [{ id: 'evento' }]; } };
  vm.createContext(sandbox);
  vm.runInContext('let salesCurrentAssignmentCommandId = null;\n' + core.slice(start, end), sandbox);
  await sandbox.salesAssignConversation({ tenant: { id: 'tenant', slug: 'teste' } }, { name: 'Will' }, null, 'NORIA - serviços');
  assert.equal(calls[0][0], '/rest/v1/rpc/magia_record_engine_assignment');
  assert.equal(calls[0][1].p_tenant, 'tenant');
  assert.equal(calls[0][1].p_chat, 'chat');
  assert.equal(calls[0][1].p_token, 'turno');
  assert.equal(calls[0][1].p_event.service, 'conversation_assigned');
});

function loadAssign(supabasePost) {
  const core = fs.readFileSync('n8n/sources/noria_core.js', 'utf8');
  const start = core.indexOf('async function salesAssignConversation(');
  const end = core.indexOf('\nfunction salesAttendantLanguage', start);
  const sandbox = { tenantSlug: 'teste', chatId: 'chat', firstName: 'Cliente',
    turn: { token: 'turno', messages: [{ name: 'Cliente' }] }, supabasePost };
  vm.createContext(sandbox);
  vm.runInContext('let salesCurrentAssignmentCommandId = null;\n' + core.slice(start, end), sandbox);
  return sandbox.salesAssignConversation;
}

test('encaminhamento não falha se a RPC de origem recusar: grava como antes e marca origem não comprovada', async () => {
  const calls = [];
  const assign = loadAssign(async (route, body) => {
    calls.push([route, body]);
    if (route.includes('/rpc/')) throw new Error('ENGINE_ASSIGNMENT_TURN_INVALID');
    return [{ id: 'evento' }];
  });
  const result = await assign({ tenant: { id: 'tenant', slug: 'teste' } }, { name: 'Will' }, null, 'NORIA - serviços');
  assert.deepEqual(result, [{ id: 'evento' }]);
  assert.equal(calls[1][0], '/rest/v1/channel_events');
  assert.equal(calls[1][1].service, 'conversation_assigned');
  assert.equal(calls[1][1].raw_payload.control_origin, 'unproven_fallback');
  assert.match(calls[1][1].raw_payload.control_origin_error, /ENGINE_ASSIGNMENT_TURN_INVALID/);
});

test('se a RPC e a gravação de reserva falharem, o erro original da RPC é propagado', async () => {
  const assign = loadAssign(async (route) => {
    throw new Error(route.includes('/rpc/') ? 'RPC_FALHOU' : 'POST_FALHOU');
  });
  await assert.rejects(assign({ tenant: { id: 'tenant', slug: 'teste' } }, { name: 'Will' }, null), /RPC_FALHOU/);
});

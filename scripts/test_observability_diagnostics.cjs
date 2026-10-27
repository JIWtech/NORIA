// Itens 2 e 3 do plano de 27/10 (docs/operations/plano_correcao_conversas_2026-10-27.md): só observabilidade.
// P0-2: falha HTTP fora do Gemini descrita sem dados sensíveis (produção 27/10 08:22: "Request failed with status code 400" sem origem).
// P0-3 passo 0: contagem de veículos do anúncio nas duas fases e motivo de a checagem de estilo não rodar.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = fs.readFileSync(path.join(__dirname, '../n8n/sources/noria_core.js'), 'utf8').replace(/\r\n/g, '\n');
const slice = name => { const start = core.indexOf('function ' + name + '('); assert.ok(start >= 0, name); return core.slice(start, core.indexOf('\n}\n', start) + 3); };
const describe = new Function('env', slice('supabaseRaisedToken') + slice('httpFailureDescriptor') + '; return httpFailureDescriptor;')(
  name => ({ SUPABASE_URL: 'https://projeto-x.supabase.co' })[name] || '');

const leak = (descriptor, ...forbidden) => {
  const text = JSON.stringify(descriptor);
  for (const value of forbidden) assert.ok(!text.includes(value), 'vazou: ' + value + ' em ' + text);
};

test('RPC do Supabase com RAISE: provedor, rota e token, sem identificadores', () => {
  const error = Object.assign(new Error('Request failed with status code 400'),
    { response: { status: 400, data: { code: 'P0001', message: 'TURN_CONTROL_ORIGIN_REQUIRED', details: 'chat 5521999998888@s.whatsapp.net' } } });
  const d = describe('https://projeto-x.supabase.co/rest/v1/rpc/magia_fail_turn', 'post', error, 'http_request');
  assert.deepEqual(d, { provider: 'supabase_rpc', operation: 'http_request', method: 'POST', route: '/rest/v1/rpc/magia_fail_turn', status: 400, code: 'TURN_CONTROL_ORIGIN_REQUIRED' });
  leak(d, '5521999998888', 'projeto-x');
});

test('REST do Supabase: tabela sem filtros, IDs nem valores', () => {
  const error = Object.assign(new Error('Request failed with status code 400'),
    { response: { status: 400, data: JSON.stringify({ code: 'PGRST100', message: 'failed to parse filter (eq.5521999998888)' }) } });
  const d = describe('https://projeto-x.supabase.co/rest/v1/channel_events?tenant_id=eq.74b57037-9349&external_conversation_id=eq.5521999998888', 'GET', error);
  assert.equal(d.provider, 'supabase_rest');
  assert.equal(d.route, '/rest/v1/channel_events');
  assert.equal(d.code, 'PGRST100');
  leak(d, '5521999998888', '74b57037', 'eq.');
});

test('provedor externo (Evolution): rota genérica sem host, instância nem telefone', () => {
  const error = Object.assign(new Error('Request failed with status code 400'),
    { response: { status: 400, data: { message: ['number 5521999998888 invalid'] } } });
  const d = describe('https://evolution.exemplo.com/message/sendText/wesley-carros', 'POST', error);
  assert.deepEqual(d, { provider: 'external', operation: 'http_request', method: 'POST', route: '/message/sendText/{id}', status: 400, code: '' });
  leak(d, 'evolution.exemplo.com', 'wesley-carros', '5521999998888');
});

test('mensagem do provedor que não é token técnico não é copiada; URL inválida não quebra', () => {
  const error = Object.assign(new Error('timeout'), { response: { status: 500, data: { message: 'senha incorreta para joao@x.com' } } });
  const d = describe('https://projeto-x.supabase.co/rest/v1/rpc/minha%20funcao', 'POST', error);
  assert.equal(d.code, '');
  assert.equal(d.route, '/rest/v1/rpc/{id}');
  leak(d, 'joao@x.com', 'senha');
  assert.equal(describe('não é url', 'GET', new Error('x')).provider, 'other');
});

test('a falha descrita na fronteira HTTP chega ao evento técnico', () => {
  const http = slice('httpJson');
  assert.match(http, /if \(!isGemini\) \{[\s\S]{0,300}error\.noria_http = httpFailureDescriptor\(url, method, error, metadata\.operation\)/);
  assert.match(core, /\.\.\.\(error\?\.noria_http \? \{ http_failure: error\.noria_http \} : \{\}\)/);
});

test('contagem de veículos do anúncio nas duas fases e motivo da checagem de estilo', () => {
  assert.match(core, /ad_vehicles_prepare_count: salesAdInventoryCandidates\(referral, inventory\)\.length/);
  assert.match(core, /ad_vehicles_finalize_count: auditExecution\.ad_vehicles\.length/);
  assert.match(core, /style_check: \{ evaluated: styleCheckSkipped === null, skipped_reason: styleCheckSkipped/);
  assert.match(core, /audit\.status !== 'accepted' \? 'audit_not_accepted' : dialogueRepair \? 'prior_repair' : null/);
});

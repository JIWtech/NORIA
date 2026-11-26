#!/usr/bin/env node
'use strict';
// Simulador de conversas da Núbia (NB Bronze) sem WhatsApp: roda as fases REAIS do motor (prepare e finalize do services_v1)
// e a EXT REAL da Núbia, com o Gemini de verdade e a configuração e o catálogo REAIS do tenant, lidos do Supabase em tempo de
// execução (somente GET, só do tenant da Núbia e só das tabelas que a EXT lê). Nada é gravado: eventos, agenda e fila ficam em
// memória, toda RPC de escrita é bloqueada e nenhuma mensagem sai. As chaves vêm do .env só para este processo (nunca impressas)
// e os dados do tenant não são salvos em disco.
// Uso: node clients/clinica_nubia_oficial/simulador/simular_conversa.cjs [cenario ...] | --cenarios <arquivo.json>
// Teto de gasto: SIM_MAX_CHAMADAS ao Gemini (padrão 5), SIM_MAX_MENSAGENS (padrão 15) e SIM_MAX_TOKENS (padrão 80000);
// para ao primeiro 429. Cada turno gasta de 3 a 5 chamadas (interpretação, redação, auditoria e, se reprovar, mais uma de cada).
// SIM_SECO=1 confere a montagem sem nenhuma chamada.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.join(__dirname, '../../..');
const ts = require(path.join(root, 'app/node_modules/typescript'));

// ------------------------------------------------------------------- chaves (só no processo)
const envFile = fs.readFileSync(path.join(root, '.env'), 'utf8');
const envValue = name => (new RegExp('^' + name + '=(.+)$', 'm').exec(envFile) || [])[1]?.trim().replace(/^["']|["']$/g, '');
const GEMINI_KEY = envValue('GEMINI_API_KEY'), SUPABASE_URL = (envValue('SUPABASE_URL') || '').replace(/\/$/, ''), SERVICE_KEY = envValue('SUPABASE_SERVICE_ROLE_KEY');
if (!GEMINI_KEY || !SUPABASE_URL || !SERVICE_KEY) throw new Error('GEMINI_API_KEY, SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausente no .env');
const TENANT = '563a93cd-a5c1-4412-a65f-be2e2d41bb88';
const SLUG = 'clinica_nubia_oficial';

// ------------------------------------------------------------------- leitura do tenant real (somente GET, escopo fixo)
const READ_TABLES = new Set(['tenants', 'channels', 'tenant_settings', 'tenant_service_catalog', 'follow_up_policies']);
async function prodGet(endpoint) {
  const u = new URL(endpoint.startsWith('http') ? endpoint : SUPABASE_URL + endpoint);
  const table = u.pathname.split('/').pop();
  if (u.origin !== new URL(SUPABASE_URL).origin || !u.pathname.startsWith('/rest/v1/') || !READ_TABLES.has(table)) throw new Error('SIM_LEITURA_FORA_DO_ESCOPO:' + table);
  const scoped = table === 'tenants' ? u.searchParams.get('id') === 'eq.' + TENANT : u.searchParams.get('tenant_id') === 'eq.' + TENANT;
  if (!scoped) throw new Error('SIM_LEITURA_SEM_ESCOPO_DO_TENANT:' + table);
  const response = await fetch(u, { method: 'GET', headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('SIM_SUPABASE_HTTP_' + response.status);
  return response.json();
}

// ------------------------------------------------------------------- banco em memória (eventos e agenda da simulação)
const memory = { channel_events: [], appointments: [] };
function memoryQuery(endpoint) {
  const u = new URL(endpoint.startsWith('http') ? endpoint : SUPABASE_URL + endpoint);
  const table = u.pathname.split('/').pop();
  let rows = [...(memory[table] || [])];
  for (const [key, raw] of u.searchParams) {
    if (['select', 'order', 'limit', 'or', 'and'].includes(key)) continue;
    if (raw.startsWith('eq.')) rows = rows.filter(r => String(r[key]) === decodeURIComponent(raw.slice(3)));
    else if (raw.startsWith('gte.')) rows = rows.filter(r => String(r[key] || '') >= decodeURIComponent(raw.slice(4)));
    else if (raw.startsWith('gt.')) rows = rows.filter(r => String(r[key] || '') > decodeURIComponent(raw.slice(3)));
  }
  return rows.slice(0, Number(u.searchParams.get('limit')) || rows.length);
}
const supabaseGet = async endpoint => {
  const table = new URL(endpoint.startsWith('http') ? endpoint : SUPABASE_URL + endpoint).pathname.split('/').pop();
  return READ_TABLES.has(table) ? prodGet(endpoint) : memoryQuery(endpoint);
};
const blockedRpc = [];
const supabasePost = async (endpoint, row) => {
  const u = new URL(endpoint.startsWith('http') ? endpoint : SUPABASE_URL + endpoint);
  if (u.pathname === '/rest/v1/channel_events') { const stored = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...row }; memory.channel_events.push(stored); return [stored]; }
  // Nenhuma RPC vai ao banco real: reserva, disponibilidade, atribuição, fila e uso ficam registrados como bloqueados.
  blockedRpc.push(u.pathname.split('/').pop());
  throw new Error('SIM_RPC_BLOQUEADA:' + u.pathname.split('/').pop());
};
const supabasePatch = async endpoint => { blockedRpc.push('PATCH ' + new URL(SUPABASE_URL + endpoint).pathname.split('/').pop()); throw new Error('SIM_ESCRITA_BLOQUEADA'); };

// ------------------------------------------------------------------- Gemini real
const usage = {};
const spentTokens = () => Object.values(usage).reduce((sum, u) => sum + u.input + u.output, 0);
async function httpJson(method, url, headers, body) {
  if (!url.startsWith('https://generativelanguage.googleapis.com/')) throw new Error('SIM_HTTP_INESPERADO');
  // SIM_SECO=1: confere a montagem das fases sem gastar nenhuma chamada.
  if (process.env.SIM_SECO === '1') throw new Error('SIM_SECO_SEM_GEMINI');
  // Teto rígido de chamadas ao Gemini por execução (padrão 5); passar dele exige pedido explícito.
  const maxCalls = Number(process.env.SIM_MAX_CHAMADAS || 5);
  if (Object.values(usage).reduce((sum, u) => sum + u.calls, 0) >= maxCalls) throw new Error('SIM_TETO_DE_CHAMADAS_ATINGIDO:' + maxCalls);
  const response = await fetch(url, { method, headers: { ...headers, 'x-goog-api-key': GEMINI_KEY }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
  const text = await response.text();
  if (response.status === 429) { console.log('\n[SIMULAÇÃO INTERROMPIDA] Gemini respondeu 429. Nada mais será enviado.'); printUsage(); process.exit(2); }
  if (!response.ok) throw Object.assign(new Error('GEMINI_HTTP_' + response.status + ': ' + text.slice(0, 200)), { statusCode: response.status });
  const parsed = JSON.parse(text);
  const model = (/\/models\/([^:]+):/.exec(url) || [])[1] || '?';
  const u = parsed.usageMetadata || {}, acc = (usage[model] ||= { calls: 0, input: 0, output: 0 });
  acc.calls++; acc.input += u.promptTokenCount || 0; acc.output += (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
  return parsed;
}
function printUsage() {
  for (const [model, u] of Object.entries(usage)) console.log(model + ': ' + u.calls + ' chamadas, entrada ' + u.input + ', saída (inclui raciocínio) ' + u.output);
}

// ------------------------------------------------------------------- motor real carregado pela AST
const coreCode = fs.readFileSync(path.join(root, 'n8n/sources/noria_core.js'), 'utf8').replace(/\r\n/g, '\n');
const ast = ts.createSourceFile('core.js', coreCode, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
// Funções do motor substituídas pelo simulador (rede, fila, persistência e envio).
const OVERRIDES = new Set(['supabaseGet', 'supabasePost', 'supabasePatch', 'httpJson', 'env', 'commit', 'complete', 'saveEvent', 'sendChannelMessage',
  'queueRpc', 'transcribeTurnAudio', 'usageGate', 'markUsage']);
// Variáveis de topo que o n8n deriva da entrada do nó: o simulador as fornece por turno.
const INPUT_GLOBALS = new Set(['helpers', 'ingressItem', 'inputJson', 'noriaPhase', 'tenantSlug', 'chatId', 'from', 'firstName', 'chat', 'message', 'update',
  'rawText', 'originalTextOrCaption', 'displayMessageText', 'normalized', 'turn', 'tenantBusinessRules']);
const moduleSource = ast.statements.filter(s => {
  if (ts.isFunctionDeclaration(s)) return !OVERRIDES.has(s.name.text);
  if (ts.isVariableStatement(s)) return s.declarationList.declarations.every(d => !INPUT_GLOBALS.has(d.name.getText(ast)));
  return false;
}).map(s => s.getText(ast)).join('\n');
const EXPORTS = ['runServicesTurnPrepare', 'runServicesTurnFinalize', 'turnPipelineFor'];
const extCode = fs.readFileSync(path.join(root, 'n8n/sources/nubia_extension.js'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runExt = input => new AsyncFunction('$json', '$env', extCode).call({ helpers: { httpRequest: async ({ url, method }) => {
  if (method !== 'GET') throw new Error('EXT tentou escrever');
  return prodGet(url);
} } }, input, { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY });

function loadEngine(input, turn, sink) {
  const g = {
    helpers: {}, ingressItem: {}, inputJson: input, noriaPhase: input.noria_phase || 'prepare', tenantSlug: SLUG, chatId: input.remoteJid,
    from: { first_name: 'Cliente' }, firstName: 'Cliente', chat: { id: input.remoteJid }, message: {}, update: {},
    rawText: turn.messages.map(m => m.text).join('\n'), originalTextOrCaption: '', displayMessageText: '', normalized: turn.messages.map(m => m.text).join('\n').toLowerCase().trim(),
    turn, tenantBusinessRules: input.noria_client_policy || {},
    supabaseGet, supabasePost, supabasePatch, httpJson, env: name => ({ SUPABASE_URL, GEMINI_API_KEY: 'via-simulador' }[name] || ''),
    commit: async () => true, complete: async status => { sink.completed = status; }, saveEvent: async event => { sink.events.push(JSON.parse(JSON.stringify(event))); },
    sendChannelMessage: async (context, text, event) => {
      sink.delivered = { text, handoff: event.handoff === true };
      memory.channel_events.push({ id: crypto.randomUUID(), tenant_id: TENANT, tenant_slug: SLUG, channel_type: 'whatsapp', external_conversation_id: input.remoteJid,
        direction: 'outbound', sender_type: 'assistant', message_text: text, handoff: event.handoff === true, ai_provider: event.ai_provider, created_at: new Date().toISOString() });
      return { sent: true };
    },
    queueRpc: async () => ({ committed: true, contract: 'noria_turn_lifecycle_v1' }), transcribeTurnAudio: async () => {}, usageGate: () => ({ allowed: true }), markUsage: () => {},
  };
  const keys = Object.keys(g);
  return new Function(...keys, moduleSource + '\nreturn {' + EXPORTS.join(',') + '};')(...keys.map(k => g[k]));
}

// ------------------------------------------------------------------- um turno completo: prepare -> EXT -> finalize
let settingsCache = null, policyCache = null, instanceCache = null;
async function runTurn(chatId, texts) {
  if (!settingsCache) {
    settingsCache = (await prodGet('/rest/v1/tenant_settings?select=settings&tenant_id=eq.' + TENANT + '&limit=1'))[0].settings;
    const channel = (await prodGet('/rest/v1/channels?select=external_id,config,status&tenant_id=eq.' + TENANT + '&type=eq.whatsapp&status=eq.active&limit=5'))[0];
    instanceCache = channel?.config?.instance_name || channel?.external_id;
  }
  // Cada mensagem do lote é um evento próprio, como no WhatsApp quando a cliente manda várias seguidas.
  const messages = texts.map((text, i) => {
    const created = new Date(Date.now() + i * 1000).toISOString();
    const eventId = crypto.randomUUID();
    memory.channel_events.push({ id: eventId, tenant_id: TENANT, tenant_slug: SLUG, channel_type: 'whatsapp', external_conversation_id: chatId, external_message_id: 'SIM' + eventId.slice(0, 8),
      direction: 'inbound', sender_type: 'contact', message_text: text, created_at: created, ai_provider: null });
    return { event_id: eventId, id: 'SIM' + eventId.slice(0, 8), text, name: 'Cliente', received_at: created, raw: { content_type: 'text' } };
  });
  const eventId = messages.at(-1).event_id;
  const token = crypto.randomUUID();
  const turn = { claimed: true, contract: 'noria_turn_lifecycle_v1', tenant_slug: SLUG, instance: instanceCache, token, boundary_id: 'initial', messages };
  const base = { tenant_id: TENANT, tenant_slug: SLUG, instance: instanceCache, remoteJid: chatId, noria_extension: 'nubia', noria_contract_version: '2.0',
    noria_business_context: { contract: 'noria_business_result_v1', session_id: 'initial', request_id: eventId + ':' + token, provenance: 'noria_turn_dispatch_v1' } };
  if (!policyCache) policyCache = (await runExt({ ...base, noria_dispatch_phase: 'bootstrap', turn })).json.noria_client_policy;
  const context = { tenant: { id: TENANT, slug: SLUG, name: settingsCache.business_facts?.name || 'NB Bronze' }, settings: { settings: settingsCache } };
  const currentIds = new Set(messages.map(m => m.event_id));
  const history = memory.channel_events.filter(r => r.external_conversation_id === chatId && !currentIds.has(r.id));
  const sink = { events: [], delivered: null, completed: null };
  const input = { ...base, noria_client_policy: policyCache, noria_preclaimed_turn: turn, turn };
  const pipeline = loadEngine(input, turn, sink).turnPipelineFor(context);
  if (!pipeline) throw new Error('SIM_PIPELINE_NAO_SELECIONADO');
  const prepared = await loadEngine(input, turn, sink).runServicesTurnPrepare(context, pipeline, history, { raw_payload: {} }, { lockedByHuman: false });
  if (prepared.noria_terminal) return { prepared, sink };
  const decided = (await runExt(prepared)).json;
  const availability = decided.commercial_decision?.actions?.check_availability?.allowed === true;
  const result = await loadEngine({ ...decided, availability: null }, turn, sink)
    .runServicesTurnFinalize(context, pipeline, history, { raw_payload: {}, tenant_id: TENANT, external_conversation_id: chatId }, { lockedByHuman: false });
  return { prepared, decided, result, sink, availabilitySkipped: availability };
}

function report(text, r) {
  console.log('\nCLIENTE: ' + text);
  const s = r.prepared?.semantic_intent || {};
  if (r.prepared?.semantic_failure) console.log('  [interpretação falhou] ' + r.prepared.semantic_failure);
  console.log('  [interpretação] intenção=' + s.primary_intent + ' pedidos=' + (s.info_requests || []).map(i => i.topic).join(',') + ' serviços=' + (s.services || []).map(x => x.service_id).join(','));
  const d = r.decided?.commercial_decision || {};
  console.log('  [EXT] status=' + (d.status || r.decided?.commercial_decision_status) + ' motivos=' + (d.reason_codes || []).join(',') + ' fatos=' + (d.facts || []).length
    + ' blocos=' + (d.approved_blocks || []).map(b => b.key).join(',') + ' handoff=' + (d.actions?.handoff?.required ? d.actions.handoff.reason : 'não')
    + (r.availabilitySkipped ? ' | disponibilidade pedida (não consultada no simulador)' : ''));
  const event = r.sink.events.at(-1) || {};
  const sp = event.raw_payload?.services_pipeline || {};
  console.log('IA: ' + (r.sink.delivered?.text || '(sem resposta)').replace(/\n/g, '\n    '));
  console.log('  [resultado] handoff=' + (r.sink.delivered?.handoff === true) + ' provedor=' + event.ai_provider + (event.ai_error ? ' erro=' + event.ai_error : '')
    + (sp.audit?.semantic?.tolerated_failures ? ' | TOLERADO=' + sp.audit.semantic.tolerated_failures.join(',') + ' pedido descoberto="' + (sp.audit.semantic.tolerated_uncovered_request || '') + '"' : ''));
  for (const c of sp.rejected_candidates || []) console.log('  [candidata rejeitada] ' + c.failures.join(',') + (c.uncovered_request ? ' (descoberto: ' + c.uncovered_request + ')' : '') + ' :: ' + c.reply.slice(0, 160));
}

// Mensagens parecidas com as que as clientes enviaram na semana de 23/11 (cada cenário é uma conversa nova).
const SCENARIOS = {
  preco_generico: ['Qual é o preço do bronzeamento?'],
  vaga_e_tabela: ['Bom dia', 'Gostaria de saber se tem vaga e se pode me passar tabela de valores'],
  anuncio_valores: ['Olá! Posso ter mais informações sobre isso?', 'Qual valores'],
  primeira_vez: ['Gostaria de saber valores de bronze', 'Como funciona', 'Não entendo nada, será primeira vez que faço...'],
  endereco_valor_vaga: ['Olá! Posso ter mais informações sobre isso?', 'Onde você está?', 'Gostaria de saber o valor e que dia tem vaga'],
};

(async () => {
  const args = process.argv.slice(2);
  const fileIndex = args.indexOf('--cenarios');
  let scenarios = SCENARIOS, wanted = args.filter(arg => !arg.startsWith('--'));
  if (fileIndex >= 0) { scenarios = JSON.parse(fs.readFileSync(path.resolve(args[fileIndex + 1]), 'utf8')); wanted = Object.keys(scenarios); }
  else if (!wanted.length) wanted = Object.keys(SCENARIOS);
  const maxTurns = Number(process.env.SIM_MAX_MENSAGENS || 15), maxTokens = Number(process.env.SIM_MAX_TOKENS || 80000);
  console.log('Simulação Núbia: ' + wanted.length + ' cenários; teto ' + maxTurns + ' turnos e ' + maxTokens + ' tokens. Cada cenário envia suas mensagens juntas, como um lote.');
  let turns = 0;
  for (const [i, label] of wanted.entries()) {
    if (turns >= maxTurns || spentTokens() >= maxTokens) { console.log('\n[TETO DE GASTO ATINGIDO] ' + turns + ' turnos, ' + spentTokens() + ' tokens.'); break; }
    turns++;
    const chatId = '5500' + String(90000000 + i) + '@s.whatsapp.net';
    console.log('\n==================== ' + label + ' ====================');
    try { report(scenarios[label].join(' | '), await runTurn(chatId, scenarios[label])); }
    catch (error) { console.log('  [ERRO] ' + String(error?.stack || error).slice(0, 700)); }
  }
  if (blockedRpc.length) console.log('\n[RPCs bloqueadas pelo simulador] ' + [...new Set(blockedRpc)].join(', '));
  console.log('\n==================== tokens por modelo ====================');
  printUsage();
})();

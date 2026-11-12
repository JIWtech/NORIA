// Homologação isolada do CORE pai no runtime real do n8n (CLI, SQLite temporário).
//
// Uso:
//   NORIA_ROOT=<raiz com n8n/workflows> node scripts/homolog/n8n_parent_runtime.cjs <bin-n8n> [--suite=resolver,entry,recovery,engine] [--only=<trecho do nome>]
//
// Topologia: roteador leve (pai) + 'NORIA CORE | Motor de Atendimento' (uma cópia do motor) + 'NORIA EXT | NORIA | Política'.
// O grafo de cada cenário é DERIVADO do artefato real do pai: os nós incluídos são cópias exatas e as conexões são as do
// pai. Todo destino não incluído vira um terminal "STUB" que apenas registra (HTTP em 127.0.0.1) qual nó seria acionado.
// Os gatilhos (Webhook e agendador) são trocados por nós Code de mesmo nome que emitem o item sintético.
// As EXTs (NORIA, Gênesis, Núbia v1 e v2) são os artefatos reais, importados no mesmo banco com os IDs que o pai referencia.
// O motor e o motor do I&C Salon são sub-workflows OBSERVADORES (registram fase e contrato recebidos), exceto na suíte 'engine',
// em que o motor REAL (artefato exportado) é importado no lugar do observador.
// Supabase é um servidor local sintético, com isolamento por tenant verificado a cada requisição. Nada sai de 127.0.0.1:
// sem Gemini, Evolution ou credenciais reais; o ambiente do n8n é montado do zero (não herda variáveis do processo).
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');

const root = process.env.NORIA_ROOT ? path.resolve(process.env.NORIA_ROOT) : path.resolve(__dirname, '../..');
const args = process.argv.slice(2);
const cli = args.find(a => !a.startsWith('--'));
if (!cli || !fs.existsSync(cli)) throw new Error('Informe o caminho existente do binário JavaScript do n8n.');
const opt = name => (args.find(a => a.startsWith('--' + name + '=')) || '').split('=').slice(1).join('=');
const suites = (opt('suite') || 'resolver,entry,recovery,engine').split(',');
const only = opt('only');
const logDir = opt('logdir');
if (logDir) fs.mkdirSync(logDir, { recursive: true });

const wf = file => JSON.parse(fs.readFileSync(path.join(root, 'n8n/workflows', file), 'utf8'));
const parent = wf('NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json');
const callId = name => parent.nodes.find(n => n.name === name)?.parameters?.workflowId?.value;
const ENGINE_ID = callId('CORE | Preparar resposta');
const NORIA_EXT_ID = callId('CORE | Executar EXT NORIA');
const SALON_ID = /\? "([^"]+)" : "([^"]+)" \}\}$/.exec(callId('CORE | Motor conversacional único') || '');
assert.ok(SALON_ID && SALON_ID[2] === ENGINE_ID, 'o nó único deve escolher entre o motor do Salon e o motor compartilhado');
const SALON_ENGINE_ID = SALON_ID[1];
assert.notEqual(NORIA_EXT_ID, ENGINE_ID, 'a EXT NORIA nunca usa o ID do motor');
const engineWorkflow = wf('NORIA CORE _ Motor conversacional.json');
const EXTS = [
  { file: 'NORIA EXT _ NORIA _ Política.json', id: NORIA_EXT_ID },
  { file: 'NORIA EXT _ Gênesis _ Política comercial v2 (1).json', id: 'fXGorIlPbyf9Qtsp' },
  { file: 'NORIA EXT _ NB Bronze _ Política de negócio v2.json', id: 'vCDXJLqIBCZJRTVv' },
  { file: 'NORIA EXT _ NB Bronze.json', id: '6jSiEH2ugboYSack' },
];
// O pai precisa referenciar exatamente esses IDs (nada é religado: o artefato é usado como está).
const referenced = new Set(parent.nodes.filter(n => n.type.endsWith('executeWorkflow')).map(n => n.parameters.workflowId.value));
for (const e of EXTS) assert.ok(referenced.has(e.id), 'O pai não referencia o ID ' + e.id);
assert.ok(referenced.has(ENGINE_ID), 'O pai não referencia o motor');

// ----------------------------------------------------------------------------------------------------------------- mundo sintético
const ID = {
  noria: '11111111-1111-4111-8111-111111111111', genesis: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', nubia: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  salon: '76aff8a0-0466-42b9-a80d-db186ff3d8bd', saas: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', royal: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
};
const SLUG = { noria: 'noria', genesis: 'wesley_automoveis', nubia: 'clinica_nubia_oficial', salon: 'ic_salon', saas: 'cliente_sintetico', royal: 'royal_4x4' };
const INSTANCE = { noria: 'teste', genesis: 'inst_genesis', nubia: 'inst_nubia', salon: 'ic_saloon', saas: 'inst_saas', royal: 'Royal 4x4' };
const TOKEN = { genesis: 'token-sintetico-genesis', nubia: 'token-sintetico-nubia', salon: 'token-sintetico-salon' };
const PIPELINE = { enabled: true, contract: 'noria_turn_pipeline_v1', capability: 'services_v1', contract_version: '2.0', rollout: 'all' };
const baseSettings = extra => ({ whatsapp_processing_mode: 'conversation_core_v1', debounce_window_ms: 3000, fragment_debounce_window_ms: 3000, ...extra });
function makeWorld(tweak = () => {}) {
  const policy = { profile: 'fixture', modules: {} };
  const world = {
    tenants: Object.keys(ID).map(k => ({ key: k, id: ID[k], slug: SLUG[k], status: 'active' })),
    channels: Object.keys(ID).map(k => ({ tenant: k, tenant_id: ID[k], type: 'whatsapp', status: 'active', external_id: INSTANCE[k], config: {} })),
    settings: {
      noria: baseSettings({ noria_client_policy: policy }),
      genesis: baseSettings({ conversation_capability: 'sales_v1', sales: {}, business_facts: {}, sdr_rules: {}, sales_follow_up: {} }),
      nubia: baseSettings({ conversation_capability: 'standard' }),
      salon: baseSettings({ noria_client_policy: policy }),
      saas: baseSettings({ noria_client_policy: policy }),
      royal: baseSettings({}),
    },
    queue: [], claimEmpty: false,
  };
  tweak(world);
  return world;
}

function splitTop(select) { const out = []; let depth = 0, cur = ''; for (const ch of select) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch; } if (cur) out.push(cur); return out; }
function projectSettings(settings, fields) {
  const out = {};
  for (const token of splitTop(fields)) {
    const m = /^(\w+):settings(->>?)(\w+)$/.exec(token.trim());
    if (!m) continue;
    const value = settings[m[3]];
    out[m[1]] = value === undefined ? null : (m[2] === '->>' ? (value === null ? null : String(value)) : value);
  }
  return out;
}

// ----------------------------------------------------------------------------------------------------------------- servidor local
function startServer(state) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const u = new URL(req.url, 'http://127.0.0.1');
      let body = null;
      try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null; } catch { body = null; }
      const send = (code, data) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(code === 204 ? '' : JSON.stringify(data)); };
      const w = state.world;
      const record = { method: req.method, path: u.pathname, query: u.search, tenants: [] };
      const q = u.searchParams;
      const eq = key => { const v = q.get(key); return v && v.startsWith('eq.') ? v.slice(3) : null; };
      // Referências de tenant em qualquer requisição, para a verificação de vazamento.
      for (const key of ['tenant_id', ...(u.pathname.endsWith('/tenants') ? ['id'] : [])]) if (eq(key)) record.tenants.push(eq(key));
      if (body && typeof body === 'object' && body.p_tenant) record.tenants.push(String(body.p_tenant));
      state.requests.push(record);
      if (u.pathname === '/__observe') { state.observed.push(body); return send(200, {}); }
      if (req.headers.apikey !== 'fixture') return send(401, { message: 'apikey' });
      const tenantByKey = key => w.tenants.find(t => t.key === key);
      const tenantById = id => w.tenants.find(t => t.id === id);
      const filterRows = rows => rows.filter(r => [...q.entries()].every(([k, v]) => {
        if (['select', 'limit', 'order', 'or', 'and'].includes(k)) return true;
        if (v.startsWith('eq.')) return String(r[k]) === v.slice(3);
        if (v.startsWith('in.(')) return v.slice(4, -1).split(',').includes(String(r[k]));
        return true;
      }));
      const tenantRow = t => ({ id: t.id, slug: t.slug, status: t.status });
      if (u.pathname === '/rest/v1/tenants' && req.method === 'GET') {
        const select = q.get('select') || '';
        const rows = filterRows(w.tenants.map(tenantRow)).map(r => {
          const embed = /tenant_settings\((.*)\)/.exec(select);
          if (!embed) return r;
          const t = tenantById(r.id);
          return { ...r, tenant_settings: [projectSettings(w.settings[t.key] || {}, embed[1])] };
        });
        return send(200, rows);
      }
      if (u.pathname === '/rest/v1/channels' && req.method === 'GET') {
        let rows = w.channels.map(c => ({ ...c, tenants: { slug: tenantByKey(c.tenant).slug, status: tenantByKey(c.tenant).status } }));
        rows = filterRows(rows).map(({ tenant, ...c }) => c);
        return send(200, rows);
      }
      if (u.pathname === '/rest/v1/tenant_settings' && req.method === 'GET') {
        const t = tenantById(eq('tenant_id'));
        const rows = t && w.settings[t.key] ? [w.settings[t.key]] : [];
        const select = q.get('select') || 'settings';
        return send(200, rows.map(s => select === 'settings' ? { settings: s } : projectSettings(s, select)));
      }
      if (u.pathname === '/rest/v1/conversation_turn_queue' && req.method === 'GET') {
        // Com tenant_id: leitura de pino do resolvedor (nenhum lote em andamento). Sem: varredura da recuperação.
        if (eq('tenant_id')) return send(200, []);
        return send(200, w.queue.map(row => ({ tenant_id: ID[row.tenant], chat_id: row.chat, instance_name: row.instance, tenants: { slug: SLUG[row.tenant] } })));
      }
      if (u.pathname === '/rest/v1/rpc/magia_turn_lifecycle_status') return send(200, { ready: true, contract: 'noria_turn_lifecycle_v1' });
      if (u.pathname === '/rest/v1/rpc/magia_enqueue_turn') return send(200, { queued: true, contract: 'noria_turn_lifecycle_v1' });
      if (u.pathname === '/rest/v1/rpc/magia_claim_turn') {
        if (w.claimEmpty) return send(200, { claimed: false, reason: 'queue_empty' });
        const t = tenantById(body.p_tenant);
        if (!t) return send(200, { claimed: false, reason: 'tenant_unknown' });
        return send(200, { claimed: true, contract: 'noria_turn_lifecycle_v1', token: '99999999-9999-4999-8999-999999999999', boundary_id: 'sessao-sintetica',
          tenant_slug: t.slug, instance: INSTANCE[t.key], messages: [{ id: 'm1', event_id: 'e1', text: 'mensagem sintética' }] });
      }
      if (u.pathname === '/rest/v1/contacts') return req.method === 'POST' ? send(201, [{ id: 'contato-sintetico', name: null, phone: null, metadata: {} }]) : req.method === 'GET' ? send(200, []) : send(204, null);
      if (u.pathname === '/rest/v1/channel_events' && req.method === 'POST') { if (body && body.tenant_id) record.tenants.push(String(body.tenant_id)); return send(201, [{ id: 'evento-sintetico' }]); }
      if (['/rest/v1/tenant_ai_excluded_contacts', '/rest/v1/sales_leads', '/rest/v1/channel_events'].includes(u.pathname)) return send(200, []);
      state.unhandled.push(req.method + ' ' + u.pathname + u.search);
      return send(404, { message: 'não simulado: ' + u.pathname });
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ----------------------------------------------------------------------------------------------------------------- derivação do grafo
const node = name => { const n = parent.nodes.find(x => x.name === name); assert.ok(n, 'Nó ausente no pai: ' + name); return structuredClone(n); };
const pos = [0, 0];
const codeNode = (name, jsCode, id) => ({ id: id || 'h-' + name.replace(/\W+/g, '-'), name, type: 'n8n-nodes-base.code', typeVersion: 2, position: pos, parameters: { jsCode } });
const stubCode = target => `
const out = [];
for (const item of $input.all()) {
  const j = item.json || {};
  const pick = { route: ${JSON.stringify(target)}, tenant_id: j.tenant_id, tenant_slug: j.tenant_slug, instance: j.instance, remoteJid: j.remoteJid,
    noria_extension: j.noria_extension, noria_router: j.noria_router, noria_contract_version: j.noria_contract_version, noria_pipeline: j.noria_pipeline,
    noria_dispatch_phase: j.noria_dispatch_phase, noria_engine_phase: j.noria_engine_phase, noria_engine_contract: j.noria_engine_contract, noria_terminal: j.noria_terminal, noria_dispatch_skip: j.noria_dispatch_skip,
    has_policy: !!j.noria_client_policy, policy_profile: j.noria_client_policy?.profile, policy_tenant_id: j.noria_client_policy?.tenant_id,
    verified_tenant_id: j.noria_verified_settings?.tenant_id, claim_token: j.noria_preclaimed_turn?.token, recovered: j.recovered === true,
    use_conversation_core: j.use_conversation_core, ack_context_restored: j.ack_context_restored, messageText: j.messageText };
  await this.helpers.httpRequest({ method: 'POST', url: String($env.SUPABASE_URL).replace(/\\/$/, '') + '/__observe', body: pick, json: true, timeout: 5000 });
  out.push({ json: { ...j, __rota_observada: ${JSON.stringify(target)} } });
}
return out;`;
function buildWorkflow(id, include, replacements) {
  const names = new Set(include);
  const nodes = [];
  for (const name of include) nodes.push(replacements[name] ? codeNode(name, replacements[name]) : node(name));
  const connections = {};
  const stubs = new Map();
  const stubFor = target => { if (!stubs.has(target)) stubs.set(target, codeNode('STUB › ' + target, stubCode(target))); return stubs.get(target).name; };
  const link = to => ({ node: to, type: 'main', index: 0 });
  for (const name of include) {
    const src = parent.connections[name]?.main;
    if (!src) continue;
    connections[name] = { main: src.map(branch => branch.map(item => link(names.has(item.node) ? item.node : stubFor(item.node)))) };
  }
  const start = { id: 'h-start', name: 'Início sintético', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: pos, parameters: {} };
  return { workflow: { id, name: 'NORIA homologação isolada', nodes: [start, ...nodes, ...stubs.values()], connections, settings: { executionOrder: 'v1' }, active: false } };
}

const RESOLVER = ['CORE - Resolver extensão do tenant', 'CORE | É tenant NORIA?', 'CORE | Serviços | Núbia v2?', 'CORE - É Núbia?', 'CORE - É Gênesis?', 'CORE - Roteador Dinâmico SaaS', 'CORE | Motor conversacional único | Fase', 'CORE | Motor conversacional único'];
const EXT_REAL = ['CORE | Executar EXT NORIA', 'CORE | Executar EXT Núbia', 'CORE | Executar EXT Gênesis', 'CORE | Preparar dispatch Genesis', 'CORE | Turno terminal Genesis?',
  'CORE | Serviços | Executar EXT bootstrap', 'CORE | Serviços | Preparar dispatch', 'CORE | Serviços | Turno terminal?'];
const ENTRY = ['Webhook WhatsApp Evolution', 'Normalizar Entrada WhatsApp', 'CORE | Rota Royal 4x4?', 'CORE | Responder ACK Royal', 'Mensagem valida?', 'Mensagem enviada fora da NORIA?',
  'Sincronizar Contato WhatsApp', 'Selecionar Motor WhatsApp', 'Usar Core Conversacional?', 'Registrar Mensagem na Fila', 'Preparar Mídia WhatsApp',
  'Mídia WhatsApp precisa de upload?', 'Confirmar Mídia WhatsApp', 'Confirmar Recebimento Core', 'Restaurar Contexto após ACK Core', 'Aguardar Janela de Mensagens'];
const RECOVERY = ['Recuperar Fila WhatsApp', 'Ler Fila WhatsApp'];
const emit = data => `return [{ json: ${JSON.stringify(data)} }];`;
// Arcos de entrada e recuperação do pai que o harness usa.
assert.equal(parent.connections['Aguardar Janela de Mensagens'].main[0][0].node, 'CORE - Resolver extensão do tenant');
assert.equal(parent.connections['Ler Fila WhatsApp'].main[0][0].node, 'CORE - Resolver extensão do tenant');

// ----------------------------------------------------------------------------------------------------------------- cenários
const CORE = 'MOTOR (sub-workflow observador)', SALON = 'SALON (sub-workflow observador)';
const G_TERM = 'CORE | Finalizar resposta | Fase', G_TURN = 'CORE | Executar EXT Genesis por turno';
const S_TERM = 'CORE | Serviços | Finalizar resposta | Fase', S_TURN = 'CORE | Serviços | Preparar resposta | Fase';
const resolverInput = (key, over = {}) => ({ tenant_id: ID[key], tenant_slug: SLUG[key], instance: INSTANCE[key], remoteJid: '5511999999999@s.whatsapp.net', messageText: 'mensagem sintética', ...over });
const webhook = (key, over = {}) => {
  const { instance = INSTANCE[key], text = 'quero saber mais sobre o atendimento', token = TOKEN[key], jid = '5511988887777@s.whatsapp.net', id = 'MSG-' + key.toUpperCase() } = over;
  return { headers: token ? { authorization: 'Bearer ' + token } : {}, params: {}, query: {}, body: { event: 'messages.upsert', instance,
    data: { key: { remoteJid: jid, fromMe: false, id }, pushName: 'Cliente Sintético', message: { conversation: text }, messageType: 'conversation', messageTimestamp: Math.floor(Date.now() / 1000), source: 'android' } } };
};
const scenarios = [];
const add = s => scenarios.push(s);
// ---- resolver: os casos do harness original, agora com EXTs reais, verificação de escopo e guardas cruzadas.
const resolverCase = (name, key, over, world, expect) => add({ suite: 'resolver', name, input: resolverInput(key, over), world, expect, include: [...RESOLVER, ...EXT_REAL] });
resolverCase('NORIA e EXT', 'noria', {}, () => {}, { routes: [CORE] });
resolverCase('Gênesis (EXT real, claim sintético)', 'genesis', {}, () => {}, { routes: [G_TURN] });
resolverCase('Gênesis (EXT real, fila vazia)', 'genesis', {}, w => { w.claimEmpty = true; }, { routes: [G_TERM] });
resolverCase('Núbia v1 (EXT real)', 'nubia', {}, () => {}, { routes: [CORE] });
resolverCase('Núbia v2 (EXT real, bootstrap)', 'nubia', {}, w => { w.settings.nubia.noria_turn_pipeline = PIPELINE; }, { routes: [S_TURN] });
resolverCase('Núbia v2 (EXT real, fila vazia)', 'nubia', {}, w => { w.settings.nubia.noria_turn_pipeline = PIPELINE; w.claimEmpty = true; }, { routes: [S_TERM] });
resolverCase('SaaS genérico', 'saas', {}, () => {}, { routes: [CORE], saas: true });
resolverCase('Salon', 'salon', {}, () => {}, { routes: [SALON] });
resolverCase('Salon com slug divergente', 'salon', { tenant_slug: 'outro_salon' }, () => {}, { error: /NORIA_ROTEAMENTO_TENANT_INVALIDO/ });
resolverCase('Salon com instância divergente', 'salon', { instance: 'outra' }, () => {}, { error: /NORIA_ROTEAMENTO_INSTANCIA_NAO_PERTENCE/ });
resolverCase('Salon com instância de outro tenant', 'salon', { instance: INSTANCE.saas }, () => {}, { error: /NORIA_ROTEAMENTO_INSTANCIA_NAO_PERTENCE/ });
resolverCase('SaaS com instância de outro tenant', 'saas', { instance: INSTANCE.salon }, () => {}, { error: /NORIA_ROTEAMENTO_INSTANCIA_NAO_PERTENCE/ });
resolverCase('Salon com canal inativo', 'salon', {}, w => { w.channels.find(c => c.tenant === 'salon').status = 'inactive'; }, { error: /NORIA_ROTEAMENTO_INSTANCIA_NAO_PERTENCE/ });
resolverCase('NORIA sem canal válido', 'noria', {}, w => { w.channels = w.channels.filter(c => c.tenant !== 'noria'); }, { error: /NORIA_INSTANCIA_NAO_PERTENCE_AO_TENANT/ });
resolverCase('NORIA com instância de outro tenant', 'noria', { instance: INSTANCE.nubia }, () => {}, { error: /NORIA_INSTANCIA_NAO_PERTENCE_AO_TENANT/ });
resolverCase('SaaS sem política', 'saas', {}, w => { delete w.settings.saas.noria_client_policy; }, { error: /NORIA_SEM_EXTENSAO_CONFIGURADA/ });
resolverCase('SaaS com tenant_id do Salon (identidade cruzada)', 'saas', { tenant_id: ID.salon }, () => {}, { error: /NORIA_ROTEAMENTO_TENANT_INVALIDO/ });
resolverCase('Gênesis com tenant_id da Núbia (EXT real)', 'genesis', { tenant_id: ID.nubia }, () => {}, { error: /NORIA_TENANT_INVALIDO/ });
resolverCase('Núbia v1 com tenant_id da Gênesis (EXT real)', 'nubia', { tenant_id: ID.genesis }, () => {}, { error: /NORIA_TENANT_INVALIDO/ });
resolverCase('Núbia v2 com tenant_id da Gênesis (EXT real)', 'nubia', { tenant_id: ID.genesis }, w => { w.settings.genesis.noria_turn_pipeline = PIPELINE; }, { error: /NORIA_TENANT_INVALIDO/ });
resolverCase('Núbia v1 com instância de outro tenant (EXT real)', 'nubia', { instance: INSTANCE.genesis }, () => {}, { error: /NORIA_INSTANCIA_NAO_PERTENCE_AO_TENANT/ });
resolverCase('Gênesis com instância de outro tenant (EXT real)', 'genesis', { instance: INSTANCE.nubia }, () => {}, { error: /NORIA_INSTANCIA_NAO_PERTENCE_AO_TENANT/ });
// ---- motor real: o marcador do pai e o motor exportado (única cópia). Ficam fora dos observadores.
const engineCase = (name, input, entryNode, expect, salonReal = false) => add({ suite: 'engine', engine: 'real', salonReal, name, input, entryNode, include: ['CORE | Motor conversacional único | Fase', 'CORE | Motor conversacional único'], world: () => {}, expect });
const terminalItem = { ...resolverInput('noria'), noria_terminal: true, ok: true, skipped: true, reason: 'sintetico' };
engineCase('Motor real: item terminal passa pelo marcador e volta sem fase nem contrato', terminalItem, 'CORE | Motor conversacional único | Fase', { engineOutput: true });
engineCase('Motor real: item do Salon não vai ao motor compartilhado (observador do Salon recebe)', { ...resolverInput('salon'), noria_terminal: true }, 'CORE | Motor conversacional único | Fase', { routes: [SALON], engineStubFor: 'salon' });
engineCase('Motor real: chamada sem marcador de fase falha fechada', terminalItem, 'CORE | Motor conversacional único', { error: /NORIA_ENGINE_PHASE_REQUIRED/ });
engineCase('Motor real: contrato divergente falha fechado', { ...terminalItem, noria_engine_phase: 'single', noria_engine_contract: 'noria_engine_phase_v0' }, 'CORE | Motor conversacional único', { error: /NORIA_ENGINE_CONTRACT_MISMATCH/ });
engineCase('Salon real: artefato corrigido recebe o contrato novo e devolve o item terminal', { ...resolverInput('salon'), noria_terminal: true }, 'CORE | Motor conversacional único | Fase', { engineOutput: true }, true);
// ---- entrada: webhook sintético, nós reais de normalização, fila e espera.
const entryCase = (name, key, over, world, expect) => add({ suite: 'entry', name, webhook: webhook(key, over), world, expect, include: [...ENTRY, ...RESOLVER, ...EXT_REAL] });
entryCase('Entrada NORIA', 'noria', {}, () => {}, { routes: [CORE], queued: 'noria' });
entryCase('Entrada Gênesis', 'genesis', {}, () => {}, { routes: [G_TURN], queued: 'genesis' });
entryCase('Entrada Núbia v1', 'nubia', {}, () => {}, { routes: [CORE], queued: 'nubia' });
entryCase('Entrada Núbia v2', 'nubia', {}, w => { w.settings.nubia.noria_turn_pipeline = PIPELINE; }, { routes: [S_TURN], queued: 'nubia' });
entryCase('Entrada SaaS', 'saas', {}, () => {}, { routes: [CORE], queued: 'saas' });
entryCase('Entrada Salon', 'salon', {}, () => {}, { routes: [SALON], queued: 'salon' });
entryCase('Entrada Royal 4x4 (ACK)', 'royal', {}, () => {}, { royalAck: true });
entryCase('Entrada Gênesis com token da Núbia', 'genesis', { token: TOKEN.nubia }, () => {}, { error: /AUTHENTICATED_INGRESS_REQUIRED/, noQueue: true });
entryCase('Entrada Gênesis sem token', 'genesis', { token: '' }, () => {}, { error: /AUTHENTICATED_INGRESS_REQUIRED/, noQueue: true });
entryCase('Entrada com instância desconhecida', 'saas', { instance: 'instancia_inexistente', token: '' }, () => {}, { legacyNoCore: true });
// ---- recuperação: leitura real da fila, vários tenants na mesma varredura.
add({ suite: 'recovery', name: 'Recuperação: NORIA, Gênesis, Núbia v1, SaaS e Salon na mesma varredura', include: [...RECOVERY, ...RESOLVER, ...EXT_REAL],
  world: w => { w.queue = ['noria', 'genesis', 'nubia', 'saas', 'salon'].map(k => ({ tenant: k, chat: '5511977776666@s.whatsapp.net', instance: INSTANCE[k] })); },
  expect: { multi: { noria: CORE, genesis: G_TURN, nubia: CORE, saas: CORE, salon: SALON } } });
add({ suite: 'recovery', name: 'Recuperação: Núbia v2 (pipeline declarado)', include: [...RECOVERY, ...RESOLVER, ...EXT_REAL],
  world: w => { w.settings.nubia.noria_turn_pipeline = PIPELINE; w.queue = [{ tenant: 'nubia', chat: '5511977776666@s.whatsapp.net', instance: INSTANCE.nubia }]; },
  expect: { multi: { nubia: S_TURN } } });
add({ suite: 'recovery', name: 'Recuperação: SaaS na fila sem política', include: [...RECOVERY, ...RESOLVER, ...EXT_REAL],
  world: w => { w.queue = [{ tenant: 'saas', chat: '5511977776666@s.whatsapp.net', instance: INSTANCE.saas }]; delete w.settings.saas.noria_client_policy; },
  expect: { error: /NORIA_SEM_EXTENSAO_CONFIGURADA/ } });

// ----------------------------------------------------------------------------------------------------------------- execução
const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); s.on('error', reject); });
async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'noria-n8n-homolog-'));
  const state = { world: makeWorld(), requests: [], observed: [], unhandled: [] };
  const server = await startServer(state);
  const results = [];
  try {
    const sbPort = server.address().port;
    const [p1, p2] = [await freePort(), await freePort()];
    const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: temp, TMP: temp, USERPROFILE: temp, N8N_USER_FOLDER: temp,
      N8N_PORT: String(p1), N8N_RUNNERS_BROKER_PORT: String(p2),
      N8N_DIAGNOSTICS_ENABLED: 'false', N8N_VERSION_NOTIFICATIONS_ENABLED: 'false', N8N_PERSONALIZATION_ENABLED: 'false', N8N_TEMPLATES_ENABLED: 'false',
      N8N_BLOCK_ENV_ACCESS_IN_NODE: 'false', N8N_USE_WORKFLOW_PUBLICATION_SERVICE: 'false', N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS: 'false',
      SUPABASE_URL: `http://127.0.0.1:${sbPort}`, SUPABASE_SERVICE_ROLE_KEY: 'fixture',
      NORIA_INGRESS_FORWARD_TOKEN_WESLEY_AUTOMOVEIS: TOKEN.genesis, NORIA_INGRESS_FORWARD_TOKEN_CLINICA_NUBIA_OFICIAL: TOKEN.nubia, NORIA_INGRESS_FORWARD_TOKEN_IC_SALON: TOKEN.salon,
      // Retaguarda: clientes que respeitam proxy falham rápido se tentarem sair de 127.0.0.1. Não há chaves de API no ambiente.
      HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9', NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' };
    console.log(`# node ${process.version} | n8n bin ${path.resolve(cli)} | Supabase sintético 127.0.0.1:${sbPort} | portas n8n ${p1}/${p2} | raiz ${root}`);
    const run = argv => new Promise((resolve, reject) => { const p = spawn(process.execPath, [path.resolve(cli), ...argv], { cwd: temp, env, windowsHide: true }); let out = '', err = ''; p.stdout.on('data', x => out += x); p.stderr.on('data', x => err += x); p.on('error', reject); p.on('close', code => resolve({ code, out, err })); });
    // EXTs reais: importadas uma vez, no mesmo banco, com os IDs referenciados pelo pai.
    for (const e of EXTS) {
      // Somente o conteúdo do workflow: metadados de exportação (shared, activeVersion, projeto) não existem no banco isolado.
      const src = wf(e.file);
      const w = { id: e.id, name: src.name, nodes: src.nodes, connections: src.connections, settings: src.settings || {}, pinData: {}, active: false };
      const file = path.join(temp, 'ext-' + e.id + '.json'); fs.writeFileSync(file, JSON.stringify(w));
      const imp = await run(['import:workflow', '--input', file]);
      assert.equal(imp.code, 0, 'Importação da EXT falhou: ' + e.file + '\n' + imp.out + imp.err);
      // Sub-workflow só executa se estiver publicado; a publicação ocorre apenas neste SQLite temporário (sem webhooks nem gatilhos de rede).
      const pub = await run(['publish:workflow', '--id', e.id]);
      assert.equal(pub.code, 0, 'Publicação isolada da EXT falhou: ' + e.id + '\n' + pub.out + pub.err);
      console.log(`# EXT real importada: ${w.name} -> ${e.id} (${w.nodes.length} nós)`);
    }
    // Motor e motor do I&C Salon: observadores com os IDs que o pai referencia (o motor real entra só na suíte 'engine').
    const observer = (id, name, route) => ({ id, name, active: false, pinData: {}, settings: { executionOrder: 'v1' },
      nodes: [{ id: 'o-trigger', name: 'Entrada', type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.1, position: [0, 0], parameters: { inputSource: 'passthrough' } },
        codeNode('Observador', stubCode(route))],
      connections: { Entrada: { main: [[{ node: 'Observador', type: 'main', index: 0 }]] } } });
    const install = async (w, label) => {
      const file = path.join(temp, 'sub-' + w.id + '.json'); fs.writeFileSync(file, JSON.stringify(w));
      const imp = await run(['import:workflow', '--input', file]);
      assert.equal(imp.code, 0, 'Importação falhou: ' + label + '\n' + imp.out + imp.err);
      const pub = await run(['publish:workflow', '--id', w.id]);
      assert.equal(pub.code, 0, 'Publicação isolada falhou: ' + label + '\n' + pub.out + pub.err);
      console.log('# sub-workflow instalado: ' + label + ' -> ' + w.id);
    };
    const unpublishFixture = async id => {
      const result = await run(['unpublish:workflow', '--id', id]);
      assert.equal(result.code, 0, 'Falha ao desativar fixture no SQLite isolado: ' + id + '\n' + result.out + result.err);
    };
    let engineInstalled = null;
    const useEngine = async mode => {
      if (engineInstalled === mode) return;
      if (engineInstalled) await unpublishFixture(ENGINE_ID);
      if (mode === 'real') await install({ id: ENGINE_ID, name: engineWorkflow.name, nodes: engineWorkflow.nodes, connections: engineWorkflow.connections, settings: engineWorkflow.settings || {}, pinData: {}, active: false }, 'motor REAL (' + engineWorkflow.name + ', ' + engineWorkflow.nodes.length + ' nós)');
      else await install(observer(ENGINE_ID, 'Observador do motor', CORE), 'observador do motor');
      engineInstalled = mode;
    };
    const selectedScenarios = scenarios.filter(sc => suites.includes(sc.suite) && (!only || sc.name.includes(only)));
    const salonObserver = selectedScenarios.some(sc => !sc.salonReal);
    if (salonObserver) await install(observer(SALON_ENGINE_ID, 'Observador do motor do Salon', SALON), 'observador do motor do I&C Salon');
    let index = 0;
    // O motor real entra por último: troca o observador pelo artefato exportado uma única vez.
    for (const sc of selectedScenarios.sort((x, y) => (x.engine === 'real') - (y.engine === 'real'))) {
      index += 1;
      state.world = makeWorld(sc.world); state.requests = []; state.observed = []; state.unhandled = [];
      await useEngine(sc.engine || 'stub');
      if (sc.salonReal) {
        const { buildSalonEngine } = require(path.join(root, 'clients/ic_saloon/build_conversation_adapter.cjs'));
        if (salonObserver) await unpublishFixture(SALON_ENGINE_ID);
        await install({ ...buildSalonEngine(engineWorkflow), id: SALON_ENGINE_ID }, 'motor real do I&C Salon');
      }
      let startName;
      const replacements = {};
      if (sc.suite === 'entry') { startName = 'Webhook WhatsApp Evolution'; replacements[startName] = emit(sc.webhook); }
      if (sc.suite === 'recovery') { startName = 'Recuperar Fila WhatsApp'; replacements[startName] = emit({ tick: true }); }
      const { workflow } = buildWorkflow('homolog-' + index, sc.include, replacements);
      if (sc.suite === 'resolver' || sc.suite === 'engine') {
        workflow.nodes.push(codeNode('Fixture', emit(sc.input)));
        workflow.connections['Início sintético'] = { main: [[{ node: 'Fixture', type: 'main', index: 0 }]] };
        workflow.connections['Fixture'] = { main: [[{ node: sc.entryNode || 'CORE - Resolver extensão do tenant', type: 'main', index: 0 }]] };
      } else {
        workflow.connections['Início sintético'] = { main: [[{ node: startName, type: 'main', index: 0 }]] };
      }
      const file = path.join(temp, 'workflow.json'); fs.writeFileSync(file, JSON.stringify(workflow));
      const t0 = Date.now();
      const imp = await run(['import:workflow', '--input', file]);
      const record = { name: `[${sc.suite}] ${sc.name}`, status: 'falhou', detail: '' };
      try {
        assert.equal(imp.code, 0, 'importação do cenário falhou\n' + imp.out + imp.err);
        const exec = await run(['execute', '--id', workflow.id, '--rawOutput']);
        const combined = exec.out + '\n' + exec.err;
        if (logDir) fs.writeFileSync(path.join(logDir, String(index).padStart(2, '0') + '-' + sc.suite + '.log'), `# ${sc.name}
# exit=${exec.code}
# requisições: ${JSON.stringify(state.requests.map(r => r.method + ' ' + r.path + r.query))}
# observado: ${JSON.stringify(state.observed)}
${combined}`);
        const obs = state.observed;
        record.observed = obs.map(o => `${o.route} [slug=${o.tenant_slug} id=${o.tenant_id === undefined ? '-' : String(o.tenant_id).slice(0, 8)} ext=${o.noria_extension} router=${o.noria_router} policy=${o.has_policy}${o.noria_dispatch_phase ? ' fase=' + o.noria_dispatch_phase : ''}]`);
        const enq = state.requests.filter(r => r.path.endsWith('/magia_enqueue_turn'));
        const ex = sc.expect;
        if (ex.error) {
          assert.match(combined, ex.error, 'erro esperado não observado\n' + combined.slice(-1500));
          assert.notEqual(exec.code, 0, 'a execução deveria falhar');
          if (ex.noQueue) assert.equal(enq.length, 0, 'mensagem enfileirada apesar da falha de autenticação');
          assert.equal(obs.length, 0, 'houve atendimento apesar do erro: ' + JSON.stringify(obs.map(o => o.route)));
          record.detail = 'falha fechada: ' + (ex.error.exec(combined) || [''])[0] + '; nenhum destino acionado';
        } else if (ex.engineOutput) {
          assert.equal(exec.code, 0, 'n8n falhou\n' + combined.slice(-2000));
          // A saída do n8n traz o runData de todos os nós: o marcador DEVE ter gravado fase e contrato; o motor real DEVE devolver o item sem eles.
          const dump = JSON.parse(combined.slice(combined.indexOf('\n{') + 1, combined.lastIndexOf('}') + 1));
          const outputOf = name => dump.data.resultData.runData[name][0].data.main[0][0].json;
          const marked = outputOf('CORE | Motor conversacional único | Fase'), returned = outputOf('CORE | Motor conversacional único');
          assert.equal(marked.noria_engine_phase, 'single'); assert.equal(marked.noria_engine_contract, 'noria_engine_phase_v1');
          assert.equal(returned.noria_terminal, true, 'item terminal não devolvido pelo motor real');
          assert.ok(!('noria_engine_phase' in returned) && !('noria_engine_contract' in returned), 'fase/contrato vazaram para a saída do motor');
          assert.equal(returned.tenant_id, sc.input.tenant_id);
          record.detail = 'motor real recebeu fase e contrato do marcador do pai e devolveu o item terminal sem eles';
        } else if (ex.royalAck) {
          assert.equal(exec.code, 0, 'n8n falhou\n' + combined.slice(-2000));
          assert.equal(obs.length, 0, 'Royal alcançou rota do CORE: ' + JSON.stringify(obs.map(o => o.route)));
          for (const forbidden of ['/magia_enqueue_turn', '/contacts', '/tenant_settings', '/tenants']) assert.equal(state.requests.filter(r => r.path.includes(forbidden)).length, 0, 'efeito colateral inesperado em ' + forbidden);
          assert.match(combined, /Royal 4x4/, 'ACK sem o item normalizado');
          assert.match(combined, /royal_4x4/, 'ACK sem o slug resolvido pelo registro de canais');
          record.detail = 'ACK devolvido sem fila, contato, tenant_settings ou rota do CORE; requisições: ' + state.requests.map(r => r.method + ' ' + r.path.replace('/rest/v1', '')).join(', ');
        } else if (ex.legacyNoCore) {
          assert.equal(exec.code, 0, 'n8n falhou: ' + combined.split('\n').filter(l => /error|NORIA_|cannot|failed|not found/i.test(l)).slice(0, 8).join(' || '));
          assert.deepEqual(obs.map(o => o.route), ['Consultar Deduplicacao no Redis'], 'rotas observadas: ' + JSON.stringify(obs.map(o => o.route)));
          assert.equal(obs[0].use_conversation_core, false);
          assert.equal(enq.length, 0, 'enfileirou no CORE');
          record.finding = true;
          record.detail = 'ACHADO: instância sem canal registrado não entra no CORE, mas segue ao caminho legado (Redis/Assistente JIW) com o tenant de fallback do ambiente (' + obs[0].tenant_slug + '), em vez de ser recusada';
        } else if (ex.multi) {
          assert.equal(exec.code, 0, 'n8n falhou\n' + combined.slice(-2000));
          assert.equal(obs.length, Object.keys(ex.multi).length, 'quantidade de itens observados: ' + obs.length);
          for (const [key, route] of Object.entries(ex.multi)) {
            const o = obs.find(x => x.tenant_slug === SLUG[key]);
            assert.ok(o, 'tenant sem observação: ' + key);
            assert.equal(o.route, route, `${key}: rota ${o.route}`);
            assert.equal(o.tenant_id, ID[key], `${key}: tenant_id divergente`);
            assert.equal(o.recovered, true);
          }
          record.detail = 'cada item roteado ao destino do próprio tenant';
        } else {
          if (ex.routes) {
            assert.equal(exec.code, 0, 'n8n falhou\n' + combined.slice(-2500));
            assert.deepEqual(obs.map(o => o.route), ex.routes, 'rotas observadas: ' + JSON.stringify(obs.map(o => o.route)));
            if (ex.saas) { assert.equal(obs[0].noria_extension, 'saas_dynamic'); assert.equal(obs[0].has_policy, true); }
            if ([CORE, SALON].includes(obs[0].route)) { assert.equal(obs[0].noria_engine_phase, 'single', 'fase do marcador'); assert.equal(obs[0].noria_engine_contract, 'noria_engine_phase_v1', 'contrato do marcador'); }
            if (ex.queued) { assert.equal(enq.length, 1, 'enfileiramento'); assert.equal(obs[0].tenant_id, ID[ex.queued]); assert.equal(obs[0].ack_context_restored, true); }
            if (sc.suite === 'resolver') assert.equal(obs[0].tenant_id, sc.input.tenant_id, 'tenant_id mudou');
          }
          if (ex.observe) {
            // Comportamento observado, sem presumir o resultado. Falha fechada = nenhum atendimento.
            record.status = obs.length === 0 ? 'observado: FALHA FECHADA' : 'observado: NAO falha fechada (atendeu)';
            record.finding = obs.length > 0;
            record.detail = `${ex.observe}: exit=${exec.code}; destino=${obs.map(o => o.route).join(',') || 'nenhum'}; erro=${exec.code === 0 ? '-' : (/NORIA_[A-Z_]+/.exec(combined) || ['?'])[0]}`;
          }
        }
        // Isolamento: toda requisição que cita tenant deve citar apenas o tenant do cenário (a recuperação varre vários).
        const scoped = sc.suite === 'resolver' || sc.suite === 'engine' ? [sc.input.tenant_id] : sc.suite === 'entry' && ex.queued ? [ID[ex.queued]] : null;
        if (scoped) {
          const foreign = state.requests.filter(r => r.tenants.some(t => !scoped.includes(t)));
          assert.equal(foreign.length, 0, 'requisição citando outro tenant: ' + JSON.stringify(foreign));
        }
        assert.equal(state.unhandled.length, 0, 'requisições não simuladas: ' + state.unhandled.join(' | '));
        if (record.status === 'falhou') record.status = record.finding ? 'observado: comportamento legado (achado)' : 'passou';
        if (!record.detail) record.detail = 'destino(s): ' + (obs.map(o => o.route).join(', ') || '-');
      } catch (error) {
        record.status = 'falhou';
        record.detail = String(error.message || error).split('\n').slice(0, 14).join(' | ').slice(0, 2000);
      }
      record.seconds = Math.round((Date.now() - t0) / 1000);
      results.push(record);
      console.log(`${record.status.toUpperCase()} ${record.name} (${record.seconds}s)\n    ${record.detail}${record.observed && record.observed.length ? '\n    observado: ' + record.observed.join(' ; ') : ''}`);
    }
  } finally {
    server.close();
    const resolved = path.resolve(temp);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()), 'Diretório temporário fora do local esperado');
    assert.ok(path.basename(resolved).startsWith('noria-n8n-homolog-'), 'Prefixo temporário inesperado');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
  const failed = results.filter(r => r.status === 'falhou');
  console.log(`\nResumo: ${results.length - failed.length}/${results.length} conforme o esperado; falhas: ${failed.length}; achados (atendeu quando deveria falhar fechado): ${results.filter(r => r.finding).length}`);
  if (failed.length) process.exitCode = 1;
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });

#!/usr/bin/env node
'use strict';
// Simulador de conversas da JOYERÍA sem WhatsApp: roda as fases REAIS do motor (prepare/finalize do retail_v1) e a EXT REAL,
// com o Gemini de verdade. Banco, fila e Evolution ficam em memória: nada é gravado no Supabase e nenhuma mensagem sai.
// A chave do Gemini é lida do .env da raiz só para este processo (nunca é impressa).
// Uso: node clients/joyeria/simulador/simular_conversa.cjs [cenario ...]   (sem argumento roda todos)

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.join(__dirname, '../../..');
const ts = require(path.join(root, 'app/node_modules/typescript'));
const { extractRetailRegion } = require(path.join(root, 'scripts/lib/retail_region.cjs'));
const { buildSpec } = require(path.join(root, 'clients/joyeria/catalogo_pdf/gerar_carga_catalogo.cjs'));

// ------------------------------------------------------------------- chave do Gemini (só no processo)
const envFile = fs.readFileSync(path.join(root, '.env'), 'utf8');
const GEMINI_KEY = (/^GEMINI_API_KEY=(.+)$/m.exec(envFile) || [])[1]?.trim().replace(/^["']|["']$/g, '');
if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY ausente no .env');
// Modelo de produção por padrão; SIM_MODEL permite comparar outro modelo sem mudar nada no tenant.
const MODEL = process.env.SIM_MODEL || 'gemini-3.5-flash-lite';

// ------------------------------------------------------------------- dados do tenant em memória
const TENANT = '9f3c1e2a-5b7d-4c8e-9a1b-2c3d4e5f6a7b';
const ORIGIN = 'https://simulador.supabase.co';
const uuid = seed => { const h = crypto.createHash('sha1').update(seed).digest('hex'); return h.slice(0, 8) + '-' + h.slice(8, 12) + '-4' + h.slice(13, 16) + '-8' + h.slice(17, 20) + '-' + h.slice(20, 32); };
const proposta = JSON.parse(fs.readFileSync(path.join(root, 'clients/joyeria/configuracao/tenant_settings_proposta.json'), 'utf8').replace('<TENANT_ID>', TENANT).replace('<NUMERO_DE_TESTE>', '5500000000000'));
const settings = { ...proposta, ai_model: MODEL, ...(process.env.SIM_SEMANTIC_MODEL ? { semantic_model: process.env.SIM_SEMANTIC_MODEL } : {}), system_prompt: fs.readFileSync(path.join(root, 'clients/joyeria/prompts/system_prompt_v1.txt'), 'utf8'),
  noria_turn_pipeline: { ...proposta.noria_turn_pipeline, enabled: true, rollout: 'all' } };
const policy = settings.noria_client_policy;

const { spec } = buildSpec(ORIGIN);
const db = { product_catalog_items: [], product_catalog_item_images: [], product_catalog_assets: [], channel_events: [] };
for (const item of spec.items) db.product_catalog_items.push({ ...item, id: uuid(item.item_code), tenant_id: TENANT, active: true, price_status: item.price_status, width_mm: String(item.width_mm) });
for (const asset of spec.assets) {
  const storage_path = 'catalog/' + TENANT + '/' + asset.sha256 + '.' + (asset.mime_type === 'image/png' ? 'png' : 'jpg');
  db.product_catalog_assets.push({ id: uuid(asset.sha256), tenant_id: TENANT, storage_bucket: 'product-catalog', storage_path,
    public_url: ORIGIN + '/storage/v1/object/public/product-catalog/' + storage_path, sha256: asset.sha256, mime_type: asset.mime_type });
}
for (const link of spec.item_images) db.product_catalog_item_images.push({ tenant_id: TENANT, item_id: uuid(link.item_code), asset_id: uuid(link.asset_sha256),
  display_order: link.display_order, review_status: link.review_status, shared_note: link.shared_note });
// Dois produtos do site, só para testar o fluxo do cliente orientado (composição pelo nome do anúncio).
for (const [code, name, cents, material, url] of [
  ['site-pingente-coracao', 'Pingente Coração Banhado em Ouro 18k e Zircônia Branca', 12990, 'banhado_revestido', 'https://www.joyeria.com.br/pingente-de-prata-coracao-revestido-em-ouro-18k-e-zirconia-branca'],
  ['site-brinco-bolinha-ipg', 'Brinco de Aço Bolinha 2.8mm IPG', 7990, 'aco', 'https://www.joyeria.com.br/brinco-de-aco-bolinha-28mm-ipg'],
]) db.product_catalog_items.push({ id: uuid(code), tenant_id: TENANT, item_code: code, name, description: '', category: 'semijoias', product_line: null, model: null,
  width_mm: null, sale_unit: 'unidade', material_class: material, material_evidence: 'nome do anúncio no site', price_cents: cents, currency: 'BRL', price_status: 'aprovado',
  availability: 'desconhecida', site_url: url, offerable: true, active: true });

// Demais produtos do site (exceto as alianças blend, que vêm do PDF), com composição "desconhecida" como estariam sem a
// classificação do cadastro. Preço do site tratado como aprovado só no simulador.
const siteInventory = JSON.parse(fs.readFileSync(path.join(root, 'clients/joyeria/fontes/inventario-site-2026-11-20.json'), 'utf8'));
const knownUrls = new Set(db.product_catalog_items.map(item => item.site_url).filter(Boolean));
for (const p of siteInventory.produtos) {
  if (/blend/i.test(p.nome) || knownUrls.has(p.url) || !Number(p.preco)) continue;
  db.product_catalog_items.push({ id: uuid('site-' + p.id), tenant_id: TENANT, item_code: 'site-' + p.id, name: p.nome, description: '',
    category: 'site', product_line: null, model: null, width_mm: null, sale_unit: 'unidade', material_class: 'desconhecido', material_evidence: null,
    price_cents: Math.round(Number(p.preco) * 100), currency: 'BRL', price_status: 'aprovado', availability: 'desconhecida', site_url: p.url,
    offerable: true, active: true });
}

// ------------------------------------------------------------------- PostgREST mínimo em memória
function query(url) {
  const u = new URL(url.startsWith('http') ? url : ORIGIN + url);
  const table = u.pathname.split('/').pop();
  let rows = [...(db[table] || [])];
  for (const [key, raw] of u.searchParams) {
    if (['select', 'order', 'limit'].includes(key)) continue;
    if (key === 'or' || /^(gt|lt|gte|lte)\./.test(raw)) { if (key === 'or') rows = rows.filter(r => r.service === 'conversation_assigned' || r.sender_type === 'human'); continue; }
    if (raw.startsWith('eq.')) rows = rows.filter(r => String(r[key]) === raw.slice(3));
    else if (raw.startsWith('in.(')) { const set = raw.slice(4, -1).split(','); rows = rows.filter(r => set.includes(String(r[key]))); }
  }
  const limit = Number(u.searchParams.get('limit')) || rows.length;
  return rows.slice(0, limit);
}

// ------------------------------------------------------------------- Gemini real; Evolution simulada
const outbox = [];
const usage = {};
process.on('exit', () => {
  const total = Object.entries(usage);
  if (!total.length) return;
  console.log('\n==================== tokens por modelo ====================');
  for (const [model, u] of total) console.log(model + ': ' + u.calls + ' chamadas, entrada ' + u.input + ', saída (inclui raciocínio) ' + u.output);
});
async function httpJson(method, url, headers, body) {
  if (url.startsWith('https://generativelanguage.googleapis.com/')) {
    const response = await fetch(url, { method, headers: { ...headers, 'x-goog-api-key': GEMINI_KEY }, body: JSON.stringify(body) });
    const text = await response.text();
    // Limite de uso ou teto de gasto do projeto: para a simulação na hora (não insiste e não consome mais).
    if (response.status === 429) {
      console.log('\n[SIMULAÇÃO INTERROMPIDA] Gemini respondeu 429 (limite de uso ou teto de gasto). Nada mais será enviado.');
      process.exit(2);
    }
    if (!response.ok) throw Object.assign(new Error('Gemini HTTP ' + response.status + ': ' + text.slice(0, 300)), { statusCode: response.status });
    const parsed = JSON.parse(text);
    // Soma de tokens por modelo, como o próprio Gemini informa (para estimar custo).
    const model = (/\/models\/([^:]+):/.exec(url) || [])[1] || '?';
    const u = parsed.usageMetadata || {}, acc = (usage[model] ||= { calls: 0, input: 0, output: 0 });
    acc.calls++; acc.input += u.promptTokenCount || 0; acc.output += (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
    return parsed;
  }
  if (url.includes('/message/sendMedia/') || url.includes('/message/sendText/')) {
    outbox.push({ kind: url.includes('sendMedia') ? 'foto' : 'texto', to: body.number, body });
    return { key: { id: 'SIM' + outbox.length } };
  }
  throw new Error('HTTP inesperado: ' + url);
}

// ------------------------------------------------------------------- carregamento das funções reais do motor
const coreCode = fs.readFileSync(path.join(root, 'n8n/sources/noria_core.js'), 'utf8').replace(/\r\n/g, '\n');
const region = extractRetailRegion(coreCode);
const ast = ts.createSourceFile('core.js', coreCode, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const CORE_FUNCTIONS = ['runRetailTurnPrepare', 'runRetailTurnFinalize', 'retailTenantPath', 'retailLoadMediaState', 'retailLoadItems', 'retailFormatPrice',
  'retailAuditReply', 'retailAuditHint', 'retailComposeReply', 'retailPreviousContactHours', 'retailInsertEvent', 'retailCanContinue', 'retailEvolution', 'retailPlanProductMedia', 'retailSendProductMedia',
  // Proteções dos pipelines em fases (contato automático, repetição e trava de laço).
  'pipelineLoopGuardTrip', 'pipelineLoopGuardConfig', 'pipelineContactRepetition', 'pipelineStopForLoopGuard', 'pipelineWithContactContext', 'pipelineSemanticMessage',
  'pipelineAutomatedContact', 'groundingAutomatedContactVerdict', 'ignoreAutomatedContact', 'normalizeText',
  'retailNoticeAlreadyReserved', 'retailSendSpecialistNotice', 'servicesGeminiJson', 'servicesTerminal', 'pipelineIdentity', 'salesMediaHttpsLocation', 'settingsFor',
  // Classificação de falha passageira (nova tentativa pela fila), usada no prepare e no finalize.
  'turnFailureIsTransient', 'salesSafeFailureDiagnostics', 'httpSafeDiagnostic', 'httpErrorHeaders', 'httpHeaderValue', 'httpProviderBody', 'httpRetryAfterMs'];
const coreSource = ast.statements.filter(ts.isFunctionDeclaration).filter(n => CORE_FUNCTIONS.includes(n.name.text)).map(n => n.getText(ast)).join('\n');
const extCode = fs.readFileSync(path.join(root, 'n8n/sources/joyeria_extension.js'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function runTurn(chatId, text, turnIndex, name) {
  const created = new Date(Date.now() + turnIndex * 1000).toISOString();
  const eventId = 'evt-' + crypto.randomUUID();
  db.channel_events.push({ id: eventId, tenant_id: TENANT, external_conversation_id: chatId, channel_type: 'whatsapp', direction: 'inbound', sender_type: 'contact',
    message_text: text, created_at: created, ai_provider: null });
  const token = crypto.randomUUID();
  const turn = { claimed: true, contract: 'noria_turn_lifecycle_v1', tenant_slug: 'joyeria', instance: 'joyeria', token, boundary_id: 'initial',
    messages: [{ event_id: eventId, id: eventId, text, name, received_at: created }] };
  const business = { contract: 'noria_business_result_v1', session_id: 'initial', request_id: eventId + ':' + token, provenance: 'noria_turn_dispatch_v1' };
  const history = db.channel_events.filter(r => r.external_conversation_id === chatId && r.id !== eventId && r.message_text)
    .map(r => ({ ...r, sender_type: r.sender_type }));
  const pipeline = { contract: 'noria_turn_pipeline_v1', capability: 'retail_v1', contract_version: '1.0', semantic_contract: 'noria_retail_semantic_intent_v1',
    decision_contract: 'noria_retail_decision_v1', decision_provenance: 'joyeria_extension_commercial_decide_v1',
    semantic_vocabulary: policy.modules.turn_pipeline.semantic_vocabulary };
  let delivered = null, savedError = null;
  const makeGlobals = inputJson => ({
    inputJson, turn, chatId, tenantSlug: 'joyeria', tenantBusinessRules: policy, firstName: name, normalized: text.toLowerCase().trim(),
    workflowStartedAtMs: Date.now() - 1000,
    commit: async () => true, complete: async () => {}, saveEvent: async event => { savedError = event.ai_error || null; },
    sendChannelMessage: async (context, replyText, event) => {
      delivered = { text: replyText, handoff: event.handoff === true };
      db.channel_events.push({ id: 'out-' + crypto.randomUUID(), tenant_id: TENANT, external_conversation_id: chatId, channel_type: 'whatsapp', direction: 'outbound',
        sender_type: 'assistant', message_text: replyText, created_at: new Date().toISOString(), ai_provider: event.ai_provider, handoff: event.handoff === true });
      return { sent: true };
    },
    transcribeTurnAudio: async () => {}, usageGate: () => ({ allowed: true }), sessionUsageDiagnostic: () => ({}),
    audioHistoryText: row => row.message_text || '', sessionHandoffMessage: () => 'Só um momentinho, por favor. Vou chamar a equipe para continuar seu atendimento por aqui.',
    servicesHasRecentBusiness: rows => rows.some(r => r.direction === 'outbound'), tenantBusinessHoursStatus: () => ({ configured: true, is_open: true }),
    cleanReplyText: value => String(value || '').trim(), turnQueueState: async () => ({ token, lease_until: new Date(Date.now() + 60000).toISOString() }),
    env: key => ({ SUPABASE_URL: ORIGIN, EVOLUTION_API_URL_JOYERIA: 'https://evolution.simulador', EVOLUTION_API_KEY_JOYERIA: 'sim', EVOLUTION_INSTANCE_JOYERIA: 'joyeria' }[key] || ''),
    tenantEnvSuffix: slug => slug.toUpperCase(), encodeFilter: value => encodeURIComponent(String(value)),
    supabaseGet: async url => query(url),
    supabasePost: async (url, row) => {
      if (db.channel_events.some(r => r.external_conversation_id === row.external_conversation_id && r.external_message_id && r.external_message_id === row.external_message_id)) {
        throw Object.assign(new Error('duplicate key'), { statusCode: 409 });
      }
      const stored = { id: 'ev-' + crypto.randomUUID(), created_at: new Date().toISOString(), ...row };
      db.channel_events.push(stored); return [stored];
    },
    httpJson,
  });
  const load = inputJson => {
    const g = makeGlobals(inputJson); const keys = Object.keys(g);
    return new Function(...keys, region + '\n' + coreSource + '\nreturn { runRetailTurnPrepare, runRetailTurnFinalize };')(...keys.map(k => g[k]));
  };
  const context = { tenant: { id: TENANT, slug: 'joyeria' }, settings: { settings } };
  // 1. prepare
  const prepareInput = { tenant_id: TENANT, tenant_slug: 'joyeria', instance: 'joyeria', remoteJid: chatId, noria_extension: 'saas_dynamic',
    noria_contract_version: '1.0', noria_business_context: business, noria_preclaimed_turn: turn };
  const prepared = await load(prepareInput).runRetailTurnPrepare(context, pipeline, history, { raw_payload: {} }, { lockedByHuman: false });
  // 2. EXT real (somente leitura, sobre o banco em memória)
  const extOut = await new AsyncFunction('$json', '$env', extCode).call({ helpers: { httpRequest: async ({ url, method }) => {
    if (method !== 'GET') throw new Error('EXT tentou escrever');
    const table = new URL(url).pathname.split('/').pop();
    if (table === 'tenants') return [{ id: TENANT, slug: 'joyeria', status: 'active' }];
    if (table === 'channels') return [{ external_id: 'joyeria', status: 'active', config: {} }];
    if (table === 'tenant_settings') return [{ settings }];
    return query(url);
  } } }, prepared, { SUPABASE_URL: ORIGIN, SUPABASE_SERVICE_ROLE_KEY: 'sim' });
  const decided = extOut.json;
  // 3. finalize
  const before = outbox.length;
  const result = await load(decided).runRetailTurnFinalize(context, pipeline, history, { raw_payload: {} }, { lockedByHuman: false });
  return { semantic: prepared.semantic_intent, semanticFailure: prepared.semantic_failure, semanticCatalog: prepared.semantic_catalog, decision: decided.commercial_decision, delivered, execution: result.retail_execution, error: savedError,
    sent: outbox.slice(before) };
}

const nameOf = id => db.product_catalog_items.find(item => item.id === id)?.name || id;
function report(label, text, r) {
  const d = r.decision || {}, a = d.actions || {};
  console.log('\nCLIENTE: ' + text);
  if (r.semanticFailure) console.log('  [interpretação falhou] ' + r.semanticFailure);
  const s = r.semantic || {};
  console.log('  [interpretação] intenção=' + s.primary_intent + ' confiança=' + s.confidence + ' decisão=' + s.customer_decision?.value
    + ' interesse=' + s.commercial_interest?.present + ' material=' + s.material_requested?.value
    + ' produtos=' + (s.products || []).map(p => nameOf(p.item_id) + '(' + p.role + ')').join('; ')
    + (r.semanticCatalog ? ' | catálogo=' + r.semanticCatalog.mode + ' ' + r.semanticCatalog.sent + '/' + r.semanticCatalog.total : ''));
  console.log('  [EXT] status=' + d.status + ' motivos=' + (d.reason_codes || []).join(',')
    + ' | aviso=' + (a.notify_specialist?.required ? a.notify_specialist.reasons.join('+') : 'não')
    + ' | handoff=' + (a.handoff?.required ? a.handoff.reason : 'não')
    + ' | fotos=' + (a.send_product_media?.allowed ? (a.send_product_media.items || [a.send_product_media])
      .map(entry => nameOf(entry.item_id) + ' x' + entry.asset_ids.length).join(' + ') : 'não (' + a.send_product_media?.reason + ')')
    + ' | link=' + (a.send_site_link?.allowed ? 'sim' : 'não'));
  console.log('IA: ' + (r.delivered?.text || '(sem resposta)').replace(/\n/g, '\n    '));
  for (const m of r.sent) console.log('  [envio simulado] ' + (m.kind === 'foto' ? 'foto ' + m.body.fileName + ' para o lead' : 'texto para ' + m.to + ':\n      ' + m.body.text.replace(/\n/g, '\n      ')));
  console.log('  [execução] fotos=' + (r.execution?.media?.status || '-') + ' aviso=' + (r.execution?.notice?.status || '-') + ' handoff=' + r.execution?.handoff?.executed
    + (r.error ? ' | erro da redação: ' + r.error : ''));
}

const SCENARIOS = {
  indeciso: ['Oi! Quero ver alianças de noivado mas não sei qual escolher', 'Gosto das mais finas e discretas. Qual o valor?'],
  blend_preco: ['Quanto custa a aliança blend abaulada de 2mm?'],
  decidido: ['Quero fechar a Elegance de 6mm, como faço o pedido?'],
  ouro_macico: ['Vocês têm aliança de ouro maciço 18k?'],
  cuidados: ['Como eu limpo minha aliança blend? Comprei com vocês ano passado'],
  troca: ['Comprei uma aliança com vocês e ficou apertada, preciso trocar'],
  humano: ['Quero falar com uma pessoa, por favor'],
  visita: ['Vocês atendem em casa?', 'Moro em Macaé'],
  fotos: ['Me manda foto da Prisma de 6mm'],
  semijoia: ['Vocês têm pingente de coração? Queria dar de presente', 'Gostei, quanto custa?'],
  // Caso real de 26/11: conversa de 4 dias antes (gravada no histórico abaixo) e só um "Olá" agora.
  retomada: ['Olá'],
};
// Histórico anterior de alguns cenários: [quem, texto, horas atrás].
const PRIOR_HISTORY = {
  retomada: [['customer', 'Quero aliança', 96.1], ['business', 'Você busca alianças para namoro, noivado ou casamento?', 96.08],
    ['customer', 'Não tem pra bodas?', 96.06], ['business', 'Temos sim opções lindas para bodas. Você prefere algo clássico ou com algum detalhe diferente?', 96.04],
    ['customer', 'Quero com ametista escarlate', 96.02], ['business', 'Vou verificar com a equipe sobre a ametista escarlate para a sua comemoração.', 96]],
};

// Argumentos: nomes de cenários embutidos, ou --cenarios <arquivo.json> no formato { "nome": ["mensagem 1", "mensagem 2"] }.
(async () => {
  const args = process.argv.slice(2);
  const fileIndex = args.indexOf('--cenarios');
  let scenarios = SCENARIOS, wanted = args.filter(arg => !arg.startsWith('--'));
  if (fileIndex >= 0) {
    scenarios = JSON.parse(fs.readFileSync(path.resolve(args[fileIndex + 1]), 'utf8'));
    if (!scenarios || typeof scenarios !== 'object' || Object.values(scenarios).some(list => !Array.isArray(list) || list.some(m => typeof m !== 'string'))) {
      throw new Error('Arquivo de cenários inválido: use { "nome": ["mensagem", ...] }');
    }
    wanted = Object.keys(scenarios);
  } else if (!wanted.length) wanted = Object.keys(SCENARIOS);
  // Teto de gasto da simulação (Gemini real é pago): por padrão no máximo 15 mensagens e 80 mil tokens por execução.
  // Para rodar mais, é preciso pedir explicitamente: SIM_MAX_MENSAGENS e SIM_MAX_TOKENS.
  const maxMessages = Number(process.env.SIM_MAX_MENSAGENS || 15);
  const maxTokens = Number(process.env.SIM_MAX_TOKENS || 80000);
  const spentTokens = () => Object.values(usage).reduce((sum, u) => sum + u.input + u.output, 0);
  const planned = wanted.reduce((sum, label) => sum + (scenarios[label] || []).length, 0);
  console.log('Simulação: ' + planned + ' mensagens planejadas; teto ' + maxMessages + ' mensagens e ' + maxTokens + ' tokens.');
  let sent = 0;
  for (const [i, label] of wanted.entries()) {
    const chatId = '55219' + String(10000000 + i).slice(-8) + '@s.whatsapp.net';
    console.log('\n==================== ' + label + ' ====================');
    for (const [from, text, hours] of PRIOR_HISTORY[label] || []) {
      db.channel_events.push({ id: 'old-' + crypto.randomUUID(), tenant_id: TENANT, external_conversation_id: chatId, channel_type: 'whatsapp',
        direction: from === 'customer' ? 'inbound' : 'outbound', sender_type: from === 'customer' ? 'contact' : 'assistant', message_text: text,
        created_at: new Date(Date.now() - hours * 3600000).toISOString(), ai_provider: 'retail_pipeline' });
    }
    if (PRIOR_HISTORY[label]) console.log('  [histórico anterior] ' + PRIOR_HISTORY[label].length + ' mensagens de ~' + Math.round(PRIOR_HISTORY[label].at(-1)[2]) + ' h atrás');
    for (const [t, text] of scenarios[label].entries()) {
      if (sent >= maxMessages || spentTokens() >= maxTokens) {
        console.log('\n[TETO DE GASTO ATINGIDO] ' + sent + ' mensagens, ' + spentTokens() + ' tokens. Simulação encerrada.');
        return;
      }
      sent++;
      try { report(label, text, await runTurn(chatId, text, t, 'Cliente Teste')); }
      catch (error) { console.log('\nCLIENTE: ' + text + '\n  [ERRO] ' + String(error?.stack || error).slice(0, 600)); }
    }
  }
})();

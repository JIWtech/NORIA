// Validação da classificação de contato automático (contact_context) dos pipelines em fases com o Gemini real.
// Usa as funções REAIS do CORE: esquema e regras de interpretação de cada pipeline, a medida de repetição do contato e o
// veredito (pipelineAutomatedContact). Uma chamada por caso e teto rígido de chamadas; não grava nada.
// A chave é lida do .env só neste processo e nunca é impressa.
// Uso: node scripts/validate_pipeline_contact_gemini.cjs [--max=N] [--set=basico|repeticao]
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../app/node_modules/typescript');
const { extractRetailRegion } = require('./lib/retail_region.cjs');
const root = path.join(__dirname, '..');
const coreCode = fs.readFileSync(path.join(root, 'n8n/sources/noria_core.js'), 'utf8').replace(/\r\n/g, '\n');
const env = Object.fromEntries(fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)
  .filter(l => /^[A-Z0-9_]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; }));
if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY ausente no .env');
const arg = (name, fallback) => (process.argv.find(a => a.startsWith('--' + name + '=')) || '').split('=')[1] || fallback;
const MAX = Number(arg('max', '5'));
const SET = arg('set', 'repeticao');

const ast = ts.createSourceFile('core.js', coreCode, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const constNames = ['SERVICES_SEMANTIC_RULES'];
const constSource = ast.statements.filter(ts.isVariableStatement)
  .filter(n => n.declarationList.declarations.some(d => constNames.includes(d.name.getText(ast)))).map(n => n.getText(ast)).join('\n');
const fnNames = ['servicesGeminiJson', 'servicesSemanticSchema', 'pipelineWithContactContext', 'pipelineSemanticMessage', 'groundingAutomatedContactVerdict',
  'pipelineContactRepetition', 'pipelineAutomatedContact', 'normalizeText'];
const fnSource = ast.statements.filter(ts.isFunctionDeclaration).filter(n => fnNames.includes(n.name.text)).map(n => n.getText(ast)).join('\n');

let calls = 0, currentTurn = { messages: [] }, currentSettings = {};
const scope = {
  settingsFor: () => currentSettings, usageGate: () => ({ allowed: true }), env: name => env[name] || '',
  get turn() { return currentTurn; },
  httpJson: async (method, url, headers, body) => {
    if (++calls > MAX) throw new Error('LIMITE_DE_CHAMADAS_ATINGIDO');
    const response = await fetch(url, { method, headers, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
    if (!response.ok) throw new Error('GEMINI_HTTP_' + response.status + ': ' + (await response.text()).slice(0, 200));
    return response.json();
  },
};
const core = new Function('scope', 'with (scope) {\n' + extractRetailRegion(coreCode) + '\n' + constSource + '\n' + fnSource
  + '\nreturn {' + [...fnNames, 'SERVICES_SEMANTIC_RULES', 'RETAIL_SEMANTIC_RULES', 'retailSemanticSchema'].join(',') + '};\n}')(scope);

// Vocabulários reais declarados pelas EXTs (clients/joyeria/configuracao e n8n/sources/nubia_extension.js).
const JOYERIA_VOCAB = { intents: ['product_inquiry', 'price_inquiry', 'browsing', 'purchase_intent', 'exchange_request', 'home_visit_request', 'care_or_warranty', 'store_info', 'human_request', 'complaint', 'other', 'ambiguous'],
  roles: ['mentioned', 'asked_about', 'compared', 'interested', 'selected'], materials: ['ouro_macico', 'material_nobre', 'blend', 'banhado_revestido', 'prata', 'aco', 'outro', 'desconhecido', 'none'],
  decisions: ['decided', 'exploring', 'undefined'], confidence: ['low', 'medium', 'high'] };
const NUBIA_VOCAB = { intents: ['info_inquiry', 'comparison', 'availability_request', 'booking_intent', 'slot_change', 'reschedule', 'cancellation', 'payment_report', 'human_request', 'complaint', 'other', 'ambiguous'],
  roles: ['mentioned', 'asked_about', 'compared', 'interested', 'selected', 'booking_target'],
  topics: ['presentation', 'price', 'preparation', 'what_to_bring', 'general_info', 'catalog', 'location', 'payment_terms', 'health_or_safety', 'audience'],
  dispositions: ['active', 'declined', 'closed_by_customer', 'resolved'], ambiguity_kinds: ['service', 'date', 'time', 'unit', 'other'], confidence: ['low', 'medium', 'high'] };
const JOYERIA = { tenant: { id: 't-joyeria', name: 'JOYERÍA' }, kind: 'retail', settings: { ai_model: 'gemini-3.5-flash-lite', semantic_model: 'gemini-3.5-flash' } };
const NUBIA = { tenant: { id: 't-nubia', name: 'NB Bronze' }, kind: 'services', settings: { ai_model: 'gemini-3.5-flash-lite' } };

// Textos reais de produção (25/11 Joyería, 23/11 Núbia, 12/10 Wesley); telefones mascarados.
const CLARO = '*Importante: evite a desativação da linha.*\n\nOlá, eu sou da Claro e este é o nosso *canal oficial no WhatsApp*.✅\n\nA *chance de regularizar a linha* 21900000000 está *encerrando.* Regularize seu número o quanto antes e volte a utlizar os serviços oferecidos: *WhatsApp, Pix, gov.br, aplicativos bancários, e-mail, redes sociais.* Evite essa situação e regularize a linha agora.';
const LOGIN = 'Claro\nPara fazer login, clique no link abaixo ⬇️';
const MENU = 'Identifiquei que você ainda não fez o login, você prefere:\n\n*1-* Tentar fazer o login novamente\n*2-* Ajuda com cadastro/senha\n*3-* Voltar para o Menu';
const REPLY = 'Olá! Que alegria conversar com você na JOYERÍA. Para que eu possa te ajudar da melhor forma, você busca uma joia para qual ocasião?';
const at = min => new Date(Date.now() - min * 60000).toISOString();
const conversation = (pairs) => pairs.flatMap(([text, reply], i) => [
  { id: 'h' + i, direction: 'inbound', sender_type: 'contact', message_text: text, created_at: at(20 - i) },
  ...(reply ? [{ id: 'r' + i, direction: 'outbound', sender_type: 'assistant', message_text: reply, created_at: at(20 - i) }] : []),
]);

const SETS = {
  basico: [
    { ...JOYERIA, name: 'Joyería: template da operadora (deve ser ignorado)', expectIgnore: true, history: [], current: [{ text: CLARO, content_type: 'template' }] },
    { ...NUBIA, name: 'Núbia: cliente real pergunta preço (não pode ser ignorado)', expectIgnore: false, history: [], current: [{ text: 'Qual é o preço do bronzeamento?' }] },
  ],
  repeticao: [
    { ...JOYERIA, name: 'Joyería: robô repete o menu SEM citar a empresa (deve ser ignorado pelo histórico)', expectIgnore: true,
      history: conversation([[CLARO, REPLY], [LOGIN, REPLY], [MENU, REPLY], [LOGIN, REPLY], [MENU, REPLY], [LOGIN, REPLY]]), current: [{ text: MENU, content_type: 'text' }] },
    { ...JOYERIA, name: 'Joyería: cliente impaciente repete a mesma pergunta (não pode ser ignorado)', expectIgnore: false,
      history: conversation([['Olá, vocês têm aliança de ouro 18k de 4mm? Quanto custa o par?', null], ['Olá, vocês têm aliança de ouro 18k de 4mm? Quanto custa o par?', null]]),
      current: [{ text: 'Olá, vocês têm aliança de ouro 18k de 4mm? Quanto custa o par?' }] },
    { ...JOYERIA, name: 'Joyería: lojista de outra empresa pedindo atacado (não pode ser ignorado)', expectIgnore: false, history: [],
      current: [{ text: 'Boa tarde! Aqui é da Ouro Fino Joias, de Petrópolis. Queremos comprar 50 pares de alianças para revenda. Vocês fazem preço de atacado?' }] },
    { ...NUBIA, name: 'Núbia: texto padrão de anúncio repetido pela cliente (não pode ser ignorado)', expectIgnore: false,
      history: conversation([['Olá! Posso ter mais informações sobre isso?', null]]), current: [{ text: 'Olá! Posso ter mais informações sobre isso?' }] },
  ],
};

(async () => {
  let failures = 0;
  for (const c of SETS[SET]) {
    currentSettings = c.settings;
    currentTurn = { messages: c.current.map((m, i) => ({ event_id: 'm' + (i + 1), text: m.text, raw: { content_type: m.content_type || 'text' } })) };
    const repetition = core.pipelineContactRepetition(c.history, currentTurn.messages, 30);
    const session = c.history.filter(row => row.direction === 'inbound').map(row => ({ id: row.id, text: row.message_text, scope: 'session' }));
    const assistant = c.history.filter(row => row.direction === 'outbound').slice(-4).map(row => row.message_text);
    const ids = currentTurn.messages.map(m => m.event_id);
    const contract = c.kind === 'retail'
      ? core.pipelineWithContactContext(core.retailSemanticSchema(JOYERIA_VOCAB, []), core.RETAIL_SEMANTIC_RULES)
      : core.pipelineWithContactContext(core.servicesSemanticSchema({ semantic_vocabulary: NUBIA_VOCAB }, ['bronze_classico', 'bronze_jato']), core.SERVICES_SEMANTIC_RULES);
    const input = c.kind === 'retail'
      ? { current_message_ids: ids, customer_messages: [...session, ...currentTurn.messages.map(m => core.pipelineSemanticMessage(m))], assistant_context: assistant,
        contact_repetition: repetition, catalog: [], catalog_complete: false, session_id: 's1' }
      : { date: {}, current_message_ids: ids, customer_messages: [...session.map(s => ({ ...s, received_local_date: '2026-11-26' })),
        ...currentTurn.messages.map(m => core.pipelineSemanticMessage(m, { received_local_date: '2026-11-26' }))], ad_context: null, contact_repetition: repetition,
        assistant_context: assistant, services: [{ service_id: 'bronze_classico', name: 'Bronze Clássico' }, { service_id: 'bronze_jato', name: 'Bronze a Jato' }], units: [], session_id: 's1', reservations: [] };
    try {
      const generated = await core.servicesGeminiJson({ tenant: c.tenant }, c.kind + '_semantic_intent', input, contract.schema, contract.rules,
        { persona: false, model: c.settings.semantic_model || '' });
      const result = core.pipelineAutomatedContact(generated.value?.contact_context, { tenant: c.tenant }, repetition, c.history, generated.model);
      const ok = Boolean(result.verdict) === c.expectIgnore;
      if (!ok) failures++;
      console.log((ok ? 'OK   ' : 'FALHA') + ' | ' + c.name + ' | modelo ' + generated.model + ' | tokens ' + (generated.usage?.totalTokenCount ?? '?'));
      console.log('      repetição: ' + JSON.stringify(repetition) + ' | contact_context: ' + JSON.stringify(generated.value?.contact_context)
        + ' | veredito: ' + (result.verdict ? 'ignorar (' + result.verdict.other_business + ')' : 'seguir' + (result.unconfirmed ? ' [' + result.unconfirmed + ']' : '')));
    } catch (error) { failures++; console.log('ERRO  | ' + c.name + ' | ' + String(error.message).slice(0, 200)); if (/429|LIMITE/.test(error.message)) break; }
  }
  console.log('chamadas: ' + calls + ' | falhas: ' + failures);
  process.exitCode = failures ? 1 : 0;
})();

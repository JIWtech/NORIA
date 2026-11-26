// Validação da classificação de contato automático (contact_context) dos pipelines em fases com o Gemini real.
// Usa as funções REAIS do CORE: esquema e regras de interpretação de cada pipeline + o veredito groundingAutomatedContactVerdict.
// Exatamente uma chamada por caso e teto rígido de chamadas; não grava nada. A chave é lida do .env só neste processo.
// Uso: node scripts/validate_pipeline_contact_gemini.cjs [--max=2]
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
const MAX = Number((process.argv.find(a => a.startsWith('--max=')) || '--max=2').slice(6));

const ast = ts.createSourceFile('core.js', coreCode, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const constNames = ['SERVICES_SEMANTIC_RULES'];
const constSource = ast.statements.filter(ts.isVariableStatement)
  .filter(n => n.declarationList.declarations.some(d => constNames.includes(d.name.getText(ast)))).map(n => n.getText(ast)).join('\n');
const fnNames = ['servicesGeminiJson', 'servicesSemanticSchema', 'pipelineWithContactContext', 'pipelineSemanticMessage', 'groundingAutomatedContactVerdict', 'normalizeText'];
const fnSource = ast.statements.filter(ts.isFunctionDeclaration).filter(n => fnNames.includes(n.name.text)).map(n => n.getText(ast)).join('\n');

let calls = 0, currentTurn = { messages: [] }, currentModel = '';
const globals = {
  settingsFor: () => ({ ai_model: currentModel }), usageGate: () => ({ allowed: true }), env: name => env[name] || '',
  get turn() { return currentTurn; },
  httpJson: async (method, url, headers, body) => {
    if (++calls > MAX) throw new Error('LIMITE_DE_CHAMADAS_ATINGIDO');
    const response = await fetch(url, { method, headers, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
    if (!response.ok) throw new Error('GEMINI_HTTP_' + response.status + ': ' + (await response.text()).slice(0, 200));
    return response.json();
  },
};
const keys = ['settingsFor', 'usageGate', 'env', 'httpJson'];
const core = new Function(...keys, 'scope', 'with (scope) {\n' + extractRetailRegion(coreCode) + '\n' + constSource + '\n' + fnSource
  + '\nreturn {' + [...fnNames, 'SERVICES_SEMANTIC_RULES', 'RETAIL_SEMANTIC_RULES', 'retailSemanticSchema'].join(',') + '};\n}')(...keys.map(k => globals[k]), globals);

// Vocabulários reais declarados pelas EXTs (clients/joyeria/configuracao e n8n/sources/nubia_extension.js).
const JOYERIA_VOCAB = { intents: ['product_inquiry', 'price_inquiry', 'browsing', 'purchase_intent', 'exchange_request', 'home_visit_request', 'care_or_warranty', 'store_info', 'human_request', 'complaint', 'other', 'ambiguous'],
  roles: ['mentioned', 'asked_about', 'compared', 'interested', 'selected'], materials: ['ouro_macico', 'material_nobre', 'blend', 'banhado_revestido', 'prata', 'aco', 'outro', 'desconhecido', 'none'],
  decisions: ['decided', 'exploring', 'undefined'], confidence: ['low', 'medium', 'high'] };
const NUBIA_VOCAB = { intents: ['info_inquiry', 'comparison', 'availability_request', 'booking_intent', 'slot_change', 'reschedule', 'cancellation', 'payment_report', 'human_request', 'complaint', 'other', 'ambiguous'],
  roles: ['mentioned', 'asked_about', 'compared', 'interested', 'selected', 'booking_target'],
  topics: ['presentation', 'price', 'preparation', 'what_to_bring', 'general_info', 'catalog', 'location', 'payment_terms', 'health_or_safety', 'audience'],
  dispositions: ['active', 'declined', 'closed_by_customer', 'resolved'], ambiguity_kinds: ['service', 'date', 'time', 'unit', 'other'], confidence: ['low', 'medium', 'high'] };

// Textos reais de produção (25/11 Joyería e 23/11 Núbia); número de telefone mascarado.
const CASES = [
  { name: 'Joyería: template da operadora (deve ser ignorado)', kind: 'retail', model: 'gemini-3.5-flash', tenant: { id: 't-joyeria', name: 'JOYERÍA' }, expectIgnore: true,
    messages: [{ event_id: 'm1', raw: { content_type: 'template' }, text: '*Importante: evite a desativação da linha.*\n\nOlá, eu sou da Claro e este é o nosso *canal oficial no WhatsApp*.✅\n\nA *chance de regularizar a linha* 21900000000 está *encerrando.* Regularize seu número o quanto antes e volte a utlizar os serviços oferecidos: *WhatsApp, Pix, gov.br, aplicativos bancários, e-mail, redes sociais.* Evite essa situação e regularize a linha agora.' }] },
  { name: 'Núbia: cliente real pergunta preço (não pode ser ignorado)', kind: 'services', model: 'gemini-3.5-flash-lite', tenant: { id: 't-nubia', name: 'NB Bronze' }, expectIgnore: false,
    messages: [{ event_id: 'm1', raw: { content_type: 'text' }, text: 'Qual é o preço do bronzeamento?' }] },
];

(async () => {
  let failures = 0;
  for (const c of CASES) {
    currentTurn = { messages: c.messages }; currentModel = c.model;
    const contract = c.kind === 'retail'
      ? core.pipelineWithContactContext(core.retailSemanticSchema(JOYERIA_VOCAB, []), core.RETAIL_SEMANTIC_RULES)
      : core.pipelineWithContactContext(core.servicesSemanticSchema({ semantic_vocabulary: NUBIA_VOCAB }, ['bronze_classico', 'bronze_jato']), core.SERVICES_SEMANTIC_RULES);
    const input = c.kind === 'retail'
      ? { current_message_ids: ['m1'], customer_messages: c.messages.map(m => core.pipelineSemanticMessage(m)), assistant_context: [], catalog: [], catalog_complete: false, session_id: 's1' }
      : { date: {}, current_message_ids: ['m1'], customer_messages: c.messages.map(m => core.pipelineSemanticMessage(m, { received_local_date: '2026-11-23' })), ad_context: null,
        assistant_context: [], services: [{ service_id: 'bronze_classico', name: 'Bronze Clássico' }, { service_id: 'bronze_jato', name: 'Bronze a Jato' }], units: [], session_id: 's1', reservations: [] };
    try {
      const generated = await core.servicesGeminiJson({ tenant: c.tenant }, c.kind + '_semantic_intent', input, contract.schema, contract.rules, { persona: false });
      const verdict = core.groundingAutomatedContactVerdict(generated.value?.contact_context, { tenant: c.tenant });
      const ok = Boolean(verdict) === c.expectIgnore;
      if (!ok) failures++;
      console.log((ok ? 'OK   ' : 'FALHA') + ' | ' + c.name + ' | modelo ' + generated.model + ' | tokens ' + (generated.usage?.totalTokenCount ?? '?'));
      console.log('      contact_context: ' + JSON.stringify(generated.value?.contact_context) + ' | veredito: ' + (verdict ? 'ignorar (' + verdict.other_business + ')' : 'seguir'));
    } catch (error) { failures++; console.log('ERRO  | ' + c.name + ' | ' + String(error.message).slice(0, 200)); if (/429|LIMITE/.test(error.message)) break; }
  }
  console.log('chamadas: ' + calls + ' | falhas: ' + failures);
  process.exitCode = failures ? 1 : 0;
})();

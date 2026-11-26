// Validação local da auditoria semântica do pipeline de serviços com o Gemini real (custo controlado).
// Usa as funções REAIS do CORE (n8n/sources/noria_core.js). Faz exatamente uma chamada por caso; não grava nada.
// Uso: node scripts/validate_services_audit_gemini.cjs [--max=N]  (GEMINI_API_KEY lido do .env)
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../app/node_modules/typescript');

const root = path.join(__dirname, '..');
const coreCode = fs.readFileSync(path.join(root, 'n8n/sources/noria_core.js'), 'utf8');
const env = Object.fromEntries(fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)
  .filter(l => /^[A-Z0-9_]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; }));
if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY ausente no .env');
const MAX = Number((process.argv.find(a => a.startsWith('--max=')) || '--max=5').slice(6));
const MODEL = process.env.NORIA_AUDIT_MODEL || 'gemini-3.5-flash-lite';

const ast = ts.createSourceFile('core.js', coreCode, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const consts = ['SERVICES_ASSERTION_CATEGORIES', 'SERVICES_SUPPORT_KINDS', 'SERVICES_SUPPORT_RULES'];
const constSource = ast.statements.filter(ts.isVariableStatement)
  .filter(n => n.declarationList.declarations.some(d => consts.includes(d.name.getText(ast)))).map(n => n.getText(ast)).join('\n');
const fnNames = ['servicesSemanticAudit', 'servicesVerifySemanticReport', 'servicesGeminiJson', 'servicesAssertionSharesAuthorityTerms',
  'tenantBusinessHoursSource', 'tenantBusinessHoursFacts', 'tenantBusinessHoursStatus', 'tenantTimeZone', 'resolveTenantDayHours', 'normalizeText'];
const fnSource = ast.statements.filter(ts.isFunctionDeclaration).filter(n => fnNames.includes(n.name.text)).map(n => n.getText(ast)).join('\n');
let calls = 0, lastReport = null;
const globals = {
  settingsFor: context => ({ ai_model: MODEL, ...(context?.settings?.settings || {}) }),
  usageGate: () => ({ allowed: true }),
  env: name => env[name] || '',
  httpJson: async (method, url, headers, body) => {
    if (++calls > MAX) throw new Error('LIMITE_DE_CHAMADAS_ATINGIDO');
    const response = await fetch(url, { method, headers, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error('GEMINI_HTTP_' + response.status + ': ' + (await response.text()).slice(0, 200));
    const parsed = await response.json();
    try { lastReport = JSON.parse(parsed.candidates[0].content.parts.filter(p => !p.thought).map(p => p.text || '').join('')); } catch { lastReport = null; }
    return parsed;
  },
};
const core = new Function(...Object.keys(globals), constSource + '\n' + fnSource + '\nreturn {' + fnNames.join(',') + '};')(...Object.values(globals));

const MENU = fs.readFileSync(path.join(__dirname, 'fixtures/nubia_menu_block.txt'), 'utf8').trim();
const menu = { key: 'menu_bronze_cuidados', text: MENU };
const prep = { key: 'preparo_bronze_jato', text: fs.readFileSync(path.join(__dirname, 'fixtures/nubia_preparo_jato_block.txt'), 'utf8').trim() };
const ADDRESS = 'Av. Itaguaí, 200 - Nova Angra, Angra dos Reis - RJ, 23933-115, Brasil';
const decision = { facts: [{ fact_id: 'business_address', value: ADDRESS }], approved_blocks: [{ key: menu.key }, { key: prep.key }] };
const base = { decision, execution: { reservation: { status: 'not_attempted' }, payment_forward: { status: 'not_attempted' }, handoff: { executed: false } },
  proof: null, semantic: { slots: {} }, blocks: [menu, prep], hasRecentBusiness: false };

// Segundo conjunto: cenários diferentes dos primeiros (agendamento sem bloco, duas perguntas no mesmo lote, preparo).
const novos = [
  { name: 'A. pedido de agendamento respondido com próximo passo (sem bloco)', customer: ['Oi', 'Queria marcar um bronze pra sábado de manhã'],
    reply: 'Oie, maravilhosa! ✨ Vamos marcar sim! Qual tipo de bronze você prefere: na máquina, ao sol ou a jato? E qual horário de sábado de manhã fica melhor pra você?',
    attached: [], expect: 'approved' },
  { name: 'B. duas perguntas (preço e endereço): endereço no texto, preços no menu', customer: ['Qual o valor do bronze a jato?', 'E onde vocês ficam?'],
    reply: `Oie, maravilhosa! ✨ Nosso espaço fica na ${ADDRESS}. E os valores estão aqui embaixo:`, attached: [menu.key], expect: 'approved' },
  { name: 'C. pergunta de preparo respondida pelo bloco de preparo', customer: ['O que eu preciso fazer antes do bronze a jato?'],
    reply: 'Oie, maravilhosa! ✨ Separei as orientações de preparo pra você:', attached: [prep.key], expect: 'approved' },
];

// Terceiro conjunto: horário de funcionamento como fato (mesma configuração da Núbia: segunda a sábado, 08:00 às 18:00).
const hoursFacts = core.tenantBusinessHoursFacts({ settings: { business_hours: { start: '08:00', end: '18:00',
  days: ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'], timezone: 'America/Sao_Paulo' } } });
const horario = [
  { name: 'H1. "até que horas?" respondido com o horário cadastrado', customer: ['Vocês atendem até que horas dia de semana?'],
    reply: 'Oie, maravilhosa! ✨ De segunda a sábado a gente atende das 08:00 às 18:00 💖', attached: [], expect: 'approved', facts: hoursFacts },
  { name: 'H2. "abre domingo?" respondido com domingo fechado', customer: ['Vocês abrem domingo?'],
    reply: 'Oie, maravilhosa! ✨ Aos domingos o espaço fica fechado; atendemos de segunda a sábado, das 08:00 às 18:00 💖', attached: [], expect: 'approved', facts: hoursFacts },
];

const primeiros = [
  { name: '1. preço + menu, auditor SEM o menu (comportamento antigo)', customer: ['Oi boa noite', 'Gostaria de saber valores'],
    reply: 'Oie, maravilhosa! ✨ Temos várias opções lindas de bronze para realçar o seu brilho, olha só:', attached: [], expect: 'rejected' },
  { name: '2. preço + menu, auditor COM o menu (correção)', customer: ['Oi boa noite', 'Gostaria de saber valores'],
    reply: 'Oie, maravilhosa! ✨ Temos várias opções lindas de bronze para realçar o seu brilho, olha só:', attached: [menu.key], expect: 'approved' },
  { name: '3. pedido de informações do anúncio + menu (correção)', customer: ['Olá! Posso ter mais informações sobre isso?'],
    reply: 'Oie, maravilhosa! ✨ Separei nossas opções de bronze e cuidados para você conhecer:', attached: [menu.key], expect: 'approved' },
  { name: '4. preço sem resposta nem menu (controle negativo)', customer: ['Qual o valor do bronze?'],
    reply: 'Oie, maravilhosa! ✨ Como posso te ajudar hoje?', attached: [], expect: 'rejected' },
  { name: '5. pergunta de horário respondida só com o menu de preços (controle negativo)', customer: ['Vocês atendem até que horas dia de semana?'],
    reply: 'Oie, maravilhosa! ✨ Olha só nossas opções:', attached: [menu.key], expect: 'rejected' },
];
// Produção 26/11 18:02 UTC: esclarecimento pedido pela EXT (CLARIFICATION_REQUIRED) respondido com as opções reais; reprovado
// com AUDIT_QUOTE_MISMATCH:fact. Os fatos são os nomes completos dos candidatos (service.<id>.name), como a EXT entrega.
const nameFact = (id, value) => ({ fact_id: 'service.' + id + '.name', value });
const opcoes = [
  { name: 'O1. opções de bronze listadas pelo nome curto, pedindo qual prefere', customer: ['Oi Aninha aqui mandei msg no insta', 'Queria marca pra fazer bronze'],
    reply: 'Oie, maravilhosa! ✨ Que alegria te ver por aqui. Temos algumas opções lindas de bronze, como o Clássico, Premium, Comfort, de Sol e a Jato. Qual delas faz mais o seu estilo para eu te ajudar com o agendamento? 💖',
    attached: [], expect: 'approved', reasons: ['CLARIFICATION_REQUIRED'], noBlocks: true,
    facts: [nameFact('bronze_classico', 'Bronze Clássico'), nameFact('bronze_premium', 'Bronze Premium'), nameFact('bronze_comfort', 'Bronze Comfort'),
      nameFact('bronze_no_sol', 'Bronze de Sol'), nameFact('bronze_jato_corpo_todo', 'Bronze a Jato')] },
];
const cases = (process.argv.includes('--cenarios=novos') ? novos : process.argv.includes('--cenarios=horario') ? horario
  : process.argv.includes('--cenarios=opcoes') ? opcoes : primeiros).slice(0, MAX);

(async () => {
  let ok = 0;
  for (const item of cases) {
    const caseDecision = { ...(item.facts ? { ...decision, facts: [...decision.facts, ...item.facts] } : decision), ...(item.reasons ? { reason_codes: item.reasons } : {}) };
    // noBlocks: decisão sem bloco aprovado (como a EXT entrega no esclarecimento entre serviços), só com os fatos do caso.
    const scoped = item.noBlocks ? { ...base, blocks: [], decision: { ...caseDecision, approved_blocks: [], facts: item.facts } } : { ...base, decision: caseDecision };
    const result = await core.servicesSemanticAudit({}, { ...scoped, reply: item.reply, customerMessages: item.customer, attachedBlockKeys: item.attached });
    const pass = result.status === item.expect;
    if (pass) ok += 1;
    console.log(`${pass ? 'OK  ' : 'FALHA'} ${item.name}\n      esperado=${item.expect} obtido=${result.status} ${result.failures.join(',') || ''}${result.error ? ' erro=' + result.error : ''}`);
    // Citações que o auditor devolveu (só o que ele afirmou sustentar com fato ou bloco), para diagnosticar reprovações.
    if (process.argv.includes('--detalhe')) for (const a of lastReport?.assertions || []) {
      if (['fact', 'block'].includes(a.support)) console.log(`      [${a.category}/${a.support}] ref=${a.reference} quote="${a.quote}" text="${String(a.text).slice(0, 90)}"`);
    }
  }
  console.log(`\n${ok}/${cases.length} casos como esperado; chamadas ao Gemini: ${calls} (limite ${MAX}); modelo ${MODEL}`);
  if (ok !== cases.length) process.exitCode = 1;
})().catch(error => { console.error('ERRO: ' + error.message); process.exitCode = 1; });

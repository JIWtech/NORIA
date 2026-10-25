// Gênesis 24/10: leads de anúncio recebiam frase-modelo pedindo o veículo, embora o anúncio o nomeasse; e a IA
// repetia a mesma pergunta mesmo depois de o cliente responder outra coisa (S10: "Sou o segundo dono").
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = fs.readFileSync(path.join(__dirname, '../n8n/sources/noria_core.js'), 'utf8').replace(/\r\n/g, '\n');
const ext = fs.readFileSync(path.join(__dirname, '../n8n/sources/genesis_extension.js'), 'utf8');
const slice = name => { const start = core.indexOf('function ' + name + '('); assert.ok(start >= 0, name); return core.slice(start, core.indexOf('\n}\n', start) + 3); };
const repeats = new Function('salesCurrentSessionHistory', slice('normalizeText') + slice('salesQuestionSentences') + slice('salesRepeatsLastQuestion')
  + '; return salesRepeatsLastQuestion;')(history => history);

const s10 = 'Para avaliarmos a S10 Executive 2010, você pode nos enviar fotos dela por aqui e nos confirmar se possui histórico de leilão ou sinistro?';
const out = text => ({ direction: 'outbound', ai_provider: 'sales_core', message_text: text });

test('mesma pergunta da mensagem anterior é detectada (produção …3182, 14:30)', () => {
  const again = 'Para avaliarmos a S10, você pode nos enviar fotos dela por aqui e nos confirmar se possui histórico de leilão ou sinistro?';
  assert.equal(repeats(again, [out(s10), { direction: 'inbound', message_text: 'Sou o segundo dono' }]), true);
});

test('pergunta nova ou resposta sem pergunta não é repetição', () => {
  assert.equal(repeats('Que bom, segundo dono ajuda! Ela tem algum histórico de leilão?', [out(s10)]), false);
  assert.equal(repeats('Estamos na Av. Itapemirim, 747.', [out(s10)]), false);
  assert.equal(repeats(s10, []), false);
  assert.equal(repeats(s10, [{ direction: 'outbound', ai_provider: 'human_operator', message_text: s10 }]), false);
});

test('mensagem inteira repetida depois de um follow-up é detectada (produção …1919, 15:27)', () => {
  const renault = 'A loja não compra Renault diretamente. Mas, se você for levar um veículo da loja, ele pode entrar como parte do pagamento, sujeito à avaliação.';
  const history = [out(renault), { direction: 'outbound', ai_provider: 'configured_follow_up', message_text: 'Oi! Podemos continuar seu atendimento na Genesis Automóveis?' },
    { direction: 'inbound', message_text: 'Não' }];
  const recent = new Function('salesCurrentSessionHistory', slice('normalizeText') + slice('salesComparableReply') + slice('salesQuestionSentences')
    + slice('salesRepeatsLastQuestion') + slice('salesRepeatsRecentAssistant') + '; return salesRepeatsRecentAssistant;')(h => h);
  assert.equal(recent(renault, history), true);
  assert.equal(recent('Tudo bem, obrigado pelo retorno! Se precisar, é só chamar.', history), false);
});

test('o Gemini vê follow-ups e mensagens do atendente, identificados pelo autor', () => {
  const line = core.split('\n').find(l => l.includes('recent_assistant_messages:'));
  assert.match(line, /configured_follow_up/);
  assert.match(line, /human_operator/);
  assert.match(line, /author/);
});

test('repetição é corrigida por reformulação auditada e nunca deixa o cliente sem resposta', () => {
  const finalize = core.slice(core.indexOf('async function runSalesTurnFinalize('));
  assert.ok(finalize.indexOf('salesRepeatsRecentAssistant(') > 0);
  const block = finalize.slice(finalize.indexOf('salesRepeatsRecentAssistant('), finalize.indexOf('salesRepeatsRecentAssistant(') + 1400);
  assert.match(block, /audit\.status === 'accepted'/, 'só depois de a resposta original ter sido aceita');
  assert.match(core, /\? \['REPEATED_QUESTION'\] : \[\]/);
  assert.match(block, /salesRepairRejectedDialogue\([^)]*styleIssues/);
  assert.match(block, /salesAuditPrimaryDialogue\(/, 'a reformulação passa pelo mesmo auditor');
  assert.match(block, /catch/, 'falha da reformulação mantém a resposta original aceita');
  const repair = core.slice(core.indexOf('async function salesRepairRejectedDialogue('), core.indexOf('async function salesAuditPrimaryDialogue('));
  assert.match(repair, /REPEATED_QUESTION:/);
});

test('EXT Gênesis identifica o veículo pelo anúncio de origem e não proíbe inferir pelo anúncio', () => {
  assert.doesNotMatch(ext, /nao infira qual e o carro sem um vinculo verificavel/);
  assert.match(ext, /ANÚNCIO DE ORIGEM:[^"]*official_facts\.referral/);
  assert.match(ext, /ANÚNCIO DE ORIGEM:[^"]*Preço sempre da ficha/);
  assert.match(ext, /NÃO REPITA PERGUNTA:/);
});

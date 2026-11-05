// Cortesia na resposta: uma frase de opinião ("ótima escolha") que repete um fato já provado em outra frase não
// bloqueia o atendimento. Um fato declarado SÓ dentro de opinião continua sem prova. Caso real: Gênesis, 24/10 14:03.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../n8n/sources/noria_core.js'), 'utf8').replace(/\r\n/g, '\n');
const slice = name => { const start = source.indexOf('function ' + name + '('); assert.ok(start >= 0, name); return source.slice(start, source.indexOf('\n}\n', start) + 3); };
const validate = new Function('salesMediaFactId', 'salesOperationalAssertionMatches',
  slice('salesAlignSemanticSegments') + slice('salesValidateSemanticEvidence') + '; return salesValidateSemanticEvidence;')(/^official\.media\./, () => true);

const product = 'nissan|versa sl|2013|prata';
const sources = [
  { fact_id: 'official.inventory.2.year', source_value: '2013', source_product_id: product },
  { fact_id: 'official.inventory.2.color', source_value: 'PRATA', source_product_id: product },
  { fact_id: 'official.inventory.2.advertised_price_cents', source_value: '2798000', source_product_id: product },
];
const evidence = id => ({ fact_id: id, source_value: sources.find(s => s.fact_id === id).source_value, source_product_id: product });
const courtesy = 'O Nissan Versa SL 2013 é uma ótima escolha. ';
const facts = 'Ele é 2013, cor prata, e o valor anunciado é R$ 27.980,00. ';
const question = 'Quer saber mais detalhes sobre ele?';
const report = segments => ({ scope_key: 'k', complete: true, segments });

test('cortesia que repete um fato provado em outra frase é aceita (produção 24/10 14:03)', () => {
  const reply = courtesy + facts + question;
  const claims = [
    { fact_id: 'official.inventory.2.year', excerpt: '2013' },
    { fact_id: 'official.inventory.2.color', excerpt: 'cor prata' },
    { fact_id: 'official.inventory.2.advertised_price_cents', excerpt: 'R$ 27.980,00' },
  ];
  const issues = validate(report([
    { kind: 'non_factual', text: courtesy, evidence: [] },
    { kind: 'supported_fact', text: facts, evidence: ['official.inventory.2.year', 'official.inventory.2.color', 'official.inventory.2.advertised_price_cents'].map(evidence) },
    { kind: 'non_factual', text: question, evidence: [] },
  ]), 'k', reply, claims, sources);
  assert.deepEqual(issues, []);
});

test('fato declarado só dentro de opinião continua sem prova', () => {
  const reply = 'Ótima escolha, ele é prata. ' + question;
  const issues = validate(report([
    { kind: 'non_factual', text: 'Ótima escolha, ele é prata. ', evidence: [] },
    { kind: 'non_factual', text: question, evidence: [] },
  ]), 'k', reply, [{ fact_id: 'official.inventory.2.color', excerpt: 'prata' }], sources);
  assert.ok(issues.includes('FACT_CLASSIFIED_AS_NON_FACTUAL'));
  assert.ok(issues.includes('UNSUPPORTED_SEMANTIC_CLAIM'));
});

test('trecho de opinião com evidência anexada continua inválido', () => {
  const reply = courtesy + question;
  const issues = validate(report([
    { kind: 'non_factual', text: courtesy, evidence: [evidence('official.inventory.2.year')] },
    { kind: 'non_factual', text: question, evidence: [] },
  ]), 'k', reply, [], sources);
  assert.ok(issues.includes('FACT_CLASSIFIED_AS_NON_FACTUAL'));
});

test('a reescrita preserva cortesia e o EXT Gênesis permite tom caloroso sem fato novo', () => {
  const repair = source.slice(source.indexOf('async function salesRepairRejectedDialogue('), source.indexOf('async function salesAuditPrimaryDialogue('));
  assert.doesNotMatch(repair, /não use elogios/);
  assert.match(repair, /FACT_CLASSIFIED_AS_NON_FACTUAL:[^']*cortesia/);
  const ext = fs.readFileSync(path.join(__dirname, '../n8n/sources/genesis_extension.js'), 'utf8');
  assert.match(ext, /TOM HUMANO/);
});

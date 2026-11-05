// Auditoria do diálogo (salesValidatePrimaryDialogue, função REAL do CORE gerado):
// - negação sobre o negócio sem fato citado ("Nós não fazemos regularização de documentos", Gênesis 22/10 22:32)
//   passa a exigir a auditoria semântica independente;
// - comparar dois veículos do estoque não é mais "identidade trocada": cada fato de inventory.N pertence ao próprio
//   veículo; official.product.* continua sendo o produto em foco; id trocado continua bloqueado.
// Rodar: node --test scripts/test_dialogue_audit_business_claims.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const code = fs.readFileSync(path.join(__dirname, '..', 'n8n/code/whatsapp_conversation_core.generated.js'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
async function engine(names) {
  const hook = /try \{\r?\n\s*const turnResult = await runTurn\(\);/.exec(code);
  return new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', code.replace(hook[0], 'turn = inputJson.noria_preclaimed_turn; return { ' + names.join(',') + ' };\n' + hook[0])).call({ helpers: { httpRequest: async () => ({}) } },
    { tenant_slug: 'wesley_automoveis', tenant_id: 't', remoteJid: '5511@s.whatsapp.net', instance: 'i', noria_preclaimed_turn: { boundary_id: 'b', messages: [], claimed: true, token: 'x' } }, {}, {}, () => ({}));
}
const contract = (over = {}) => ({ fact_evidence_mode: 'standard', answers: [], requested_fields: [], facts: [], availability_asserted: false, assignment_confirmed: false, photo_sent: false, handoff_announced: false, ...over });
const validate = async (generated, plan, execution) => (await engine(['salesValidatePrimaryDialogue'])).salesValidatePrimaryDialogue(generated, plan, { active: false }, execution).issues;

test('negação de serviço sem fato citado exige auditoria semântica', async () => {
  const issues = await validate(
    { primary_reply: 'Nós não fazemos regularização de documentos por aqui. Posso ajudar em algo mais?', state: {}, primary_facts: [],
      response_contract: contract({ answers: [{ request_id: 'request_1', excerpt: 'Nós não fazemos regularização de documentos por aqui' }] }) },
    { requests: [{ id: 'request_1', topic: 'other' }], next_requirement: 'none' },
    { fact_ledger: [], turn_text: 'queria regularizar meu documento', inventory: [], handoff_claim_required: false });
  assert.ok(issues.includes('SEMANTIC_FACT_AUDIT_REQUIRED'), JSON.stringify(issues));
});

test('turno social sem pedido não chama a auditoria semântica', async () => {
  const issues = await validate(
    { primary_reply: 'Por nada! Qualquer coisa é só chamar', state: {}, primary_facts: [], response_contract: contract() },
    { requests: [], next_requirement: 'none' },
    { fact_ledger: [], turn_text: 'obrigado', inventory: [], handoff_claim_required: false });
  assert.ok(!issues.includes('SEMANTIC_FACT_AUDIT_REQUIRED'), JSON.stringify(issues));
});

const inventory = [
  { id: 'chevrolet|onix|2020|', brand: 'CHEVROLET', model: 'ONIX', year: 2020, price_cents: 4698000, status: 'listed' },
  { id: 'chevrolet|montana|2013|', brand: 'CHEVROLET', model: 'MONTANA', year: 2013, price_cents: 2798000, status: 'listed' },
];
const ledger = [
  { id: 'official.product.id', value: inventory[0].id }, { id: 'official.product.advertised_price_cents', value: 4698000 },
  { id: 'official.inventory.0.id', value: inventory[0].id }, { id: 'official.inventory.0.advertised_price_cents', value: 4698000 },
  { id: 'official.inventory.1.id', value: inventory[1].id }, { id: 'official.inventory.1.advertised_price_cents', value: 2798000 },
];
const comparison = facts => validate(
  { primary_reply: 'O Onix 2020 está anunciado por R$ 46.980,00 e a Montana 2013 por R$ 27.980,00', state: {}, primary_facts: [],
    response_contract: contract({ fact_evidence_mode: 'semantic', facts, answers: [{ request_id: 'request_1', excerpt: 'O Onix 2020 está anunciado por R$ 46.980,00' }] }) },
  { requests: [{ id: 'request_1', topic: 'price' }], next_requirement: 'none' },
  { product: inventory[0], fact_ledger: ledger, inventory, turn_text: 'qual o preço do onix e da montana?', handoff_claim_required: false });

test('comparar dois veículos do estoque: cada fato pertence ao próprio veículo', async () => {
  const issues = await comparison([
    { fact_id: 'official.inventory.0.advertised_price_cents', value: '4698000', source_product_id: inventory[0].id, excerpt: 'R$ 46.980,00' },
    { fact_id: 'official.inventory.1.advertised_price_cents', value: '2798000', source_product_id: inventory[1].id, excerpt: 'R$ 27.980,00' },
  ]);
  assert.ok(!issues.some(issue => issue.startsWith('FACT_PRODUCT_IDENTITY_MISMATCH')), JSON.stringify(issues));
});

test('id de outro veículo num fato continua bloqueado', async () => {
  const issues = await comparison([
    { fact_id: 'official.inventory.1.advertised_price_cents', value: '2798000', source_product_id: inventory[0].id, excerpt: 'R$ 27.980,00' },
  ]);
  assert.ok(issues.includes('FACT_PRODUCT_IDENTITY_MISMATCH:official.inventory.1.advertised_price_cents'), JSON.stringify(issues));
});

test('official.product precisa ser o produto em foco', async () => {
  const issues = await validate(
    { primary_reply: 'Está anunciado por R$ 46.980,00', state: {}, primary_facts: [],
      response_contract: contract({ fact_evidence_mode: 'semantic', facts: [{ fact_id: 'official.product.advertised_price_cents', value: '4698000', source_product_id: inventory[0].id, excerpt: 'R$ 46.980,00' }],
        answers: [{ request_id: 'request_1', excerpt: 'Está anunciado por R$ 46.980,00' }] }) },
    { requests: [{ id: 'request_1', topic: 'price' }], next_requirement: 'none' },
    { product: inventory[1], fact_ledger: ledger, inventory, turn_text: 'qual o preço?', handoff_claim_required: false });
  assert.ok(issues.some(issue => issue.startsWith('FACT_PRODUCT_IDENTITY_MISMATCH:official.product')), JSON.stringify(issues));
});

test('auditor rejeita preço sem prova mesmo quando ele coincide com o ano do veículo', async () => {
  const { salesValidateSemanticEvidence } = await engine(['salesValidateSemanticEvidence']);
  const reply = 'O Onix custa 2020. Ano 2020.';
  const source = { fact_id: 'official.inventory.0.year', source_product_id: inventory[0].id, source_value: '2020' };
  const claim = { fact_id: source.fact_id, source_product_id: source.source_product_id, value: '2020', excerpt: 'Ano 2020.' };
  const report = { scope_key: 'scope', complete: true, segments: [
    { text: 'O Onix custa 2020. ', kind: 'unsupported', evidence: [] },
    { text: 'Ano 2020.', kind: 'supported_fact', evidence: [source] },
  ] };
  const issues = salesValidateSemanticEvidence(report, 'scope', reply, [claim], [source]);
  assert.ok(issues.includes('SEMANTIC_FACT_UNSUPPORTED'), JSON.stringify(issues));
});

test('trecho de ligação rejeitado pelo auditor não é promovido por palavras conhecidas', async () => {
  const { salesValidateSemanticEvidence } = await engine(['salesValidateSemanticEvidence']);
  const source = { fact_id: 'official.inventory.0.year', source_product_id: inventory[0].id, source_value: '2020' };
  const claim = { fact_id: source.fact_id, source_product_id: source.source_product_id, value: '2020', excerpt: '2020' };
  const report = { scope_key: 'scope', complete: true, segments: [
    { text: 'O Onix está por ', kind: 'unsupported', evidence: [] },
    { text: '2020', kind: 'supported_fact', evidence: [source] },
  ] };
  assert.ok(salesValidateSemanticEvidence(report, 'scope', 'O Onix está por 2020', [claim], [source])
    .includes('SEMANTIC_FACT_UNSUPPORTED'));
});

test('proposição inteira sustentada pelo auditor continua aceita', async () => {
  const { salesValidateSemanticEvidence } = await engine(['salesValidateSemanticEvidence']);
  const reply = 'O Onix é de 2020.';
  const source = { fact_id: 'official.inventory.0.year', source_product_id: inventory[0].id, source_value: '2020' };
  const claim = { fact_id: source.fact_id, source_product_id: source.source_product_id, value: '2020', excerpt: '2020' };
  const report = { scope_key: 'scope', complete: true, segments: [{ text: reply, kind: 'supported_fact', evidence: [source] }] };
  assert.deepEqual(salesValidateSemanticEvidence(report, 'scope', reply, [claim], [source]), []);
});

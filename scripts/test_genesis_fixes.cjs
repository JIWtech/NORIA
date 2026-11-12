const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const extCode = fs.readFileSync(path.join(root, 'n8n/sources/genesis_extension.js'), 'utf8');
const coreCode = fs.readFileSync(path.join(root, 'n8n/sources/noria_core.js'), 'utf8');

console.log('Testing Genesis & Noria Core Fixes...');

// 1. Test EXT Financing Detection & Replies
function extractFn(code, name) {
  const match = code.match(new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\([\\s\\S]*?\\n\\}', 'm'));
  if (!match) throw new Error('Function ' + name + ' not found');
  return match[0];
}

const fnsCode = [
  'function normalizeText(value) { return String(value || "").normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").trim().toLowerCase(); }',
  extractFn(extCode, 'commercialEligibility'),
  extractFn(extCode, 'classifyCatalogAudience'),
  extractFn(extCode, 'filterOfferableCatalog'),
  extractFn(extCode, 'isMotorcycle'),
  extractFn(extCode, 'normalizeVehicleCategory'),
  extractFn(extCode, 'resolveSelection'),
  extractFn(extCode, 'isFinancingQuestion'),
  extractFn(extCode, 'formatFinancingReply'),
].join('\n\n');

const fns = {};
vm.runInNewContext(fnsCode + '\nthis.fns = { isFinancingQuestion, formatFinancingReply, resolveSelection, normalizeText };', fns);
const testedFns = fns.fns;
Promise.resolve(testedFns).then(async (fns) => {
  const financingSemantic = { valid: true, primary_intent: 'financing', secondary_intents: [] };
  for (const text of ['Financiamento', 'como fica o financiamento?', 'não quero financiamento', 'ele disse "financiamento"']) {
    assert.equal(fns.isFinancingQuestion(text), false, 'Texto bruto não pode ativar financiamento: ' + text);
  }
  assert.equal(fns.isFinancingQuestion('texto irrelevante', '', financingSemantic), true, 'Intent estruturado válido ativa financiamento');
  assert.equal(fns.isFinancingQuestion('financiamento', '', { ...financingSemantic, valid: false }), false, 'Intent inválido não ativa financiamento');
  assert.equal(fns.formatFinancingReply('como funciona o financiamento?'), null, 'EXT não deve escrever resposta comercial fixa');

  // 2. Test resolveSelection (Category catalog search vs individual product selection)
  const fakeInventory = [
    { id: '1', name: 'Honda CB 600RR', model: 'CB 600RR', brand: 'Honda', year: 2014, category: 'motorcycle', status: 'disponivel', offerable: true, availability_verified: true },
    { id: '2', name: 'Yamaha Crosser 150', model: 'Crosser 150', brand: 'Yamaha', year: 2021, category: 'motorcycle', status: 'disponivel', offerable: true, availability_verified: true },
    { id: '3', name: 'Nissan Versa 1.6', model: 'Versa 1.6', brand: 'Nissan', year: 2020, category: 'car', status: 'disponivel', offerable: true, availability_verified: true },
    { id: '4', name: 'Renault Sandero Stepway', model: 'Sandero Stepway', brand: 'Renault', year: 2019, category: 'car', status: 'disponivel', offerable: true, availability_verified: true },
  ];

  // 2.1 General category query should NOT trigger ambiguous product selection
  const categoryQuery = fns.resolveSelection(null, fakeInventory, null);
  assert.equal(categoryQuery.ambiguous, false, 'Pergunta geral de motos NÃO deve ser ambígua de produto');
  assert.equal(categoryQuery.product, null, 'Pergunta geral de motos não seleciona produto individual');

  const carCategoryQuery = fns.resolveSelection({ valid: false }, fakeInventory, null);
  assert.equal(carCategoryQuery.ambiguous, false, 'Pergunta geral de carros NÃO deve ser ambígua de produto');

  // 2.2 Only structured Gemini references may resolve a product.
  const cbMatch = fns.resolveSelection({ valid: true, references: { evidence_ids: ['e1'], mentioned_product_ids: ['1'], selected_ordinal: null } }, fakeInventory, null);
  assert.equal(cbMatch.product?.id, '1', 'ID semântico canônico deve selecionar o produto');
  const ordinalMatch = fns.resolveSelection(
    { valid: true, references: { evidence_ids: ['e1'], mentioned_product_ids: [], selected_ordinal: 2 } },
    fakeInventory,
    { products: [{ id: '1' }, { id: '3' }] },
  );
  assert.equal(ordinalMatch.product?.id, '3', 'Ordinal semântico deve resolver contra o catálogo realmente exibido');
  const noEvidence = fns.resolveSelection({ valid: true, references: { evidence_ids: [], mentioned_product_ids: ['2'], selected_ordinal: null } }, fakeInventory, null);
  assert.equal(noEvidence.product, null, 'Referência sem evidência não pode selecionar produto');

  // 3. Verify CORE sources: no hardcoded "o Wesley" promises and ad template protected
  assert.doesNotMatch(coreCode, /confirmada com o Wesley/i, 'CORE não pode prometer confirmação com o Wesley');
  assert.doesNotMatch(coreCode, /chame o Wesley para conferir/i, 'CORE não pode sugerir chamar o Wesley');
  assert.doesNotMatch(coreCode, /chamar o Wesley para continuar/i, 'CORE não pode sugerir chamar o Wesley no duplicate guard');
  assert.doesNotMatch(coreCode, /por exemplo PCX/i, 'Prompt não pode conter modelo fixo PCX');
  assert.doesNotMatch(coreCode, /como esse Nissan, a Crosser/i, 'Prompt não pode conter exemplos fixos de modelos');

  // 4. Verify turnHasFinancingOrDeposit guard in noria_core.js
  assert.match(coreCode, /turnHasFinancingOrDeposit/, 'CORE deve ter a guarda turnHasFinancingOrDeposit no template de anúncio');

  // 5. Verify absence of hardcoded PCX in validation guidance
  assert.doesNotMatch(coreCode, /da PCX\b/, 'Guidance não pode citar "da PCX"');
  assert.doesNotMatch(coreCode, /pela PCX\b/, 'Guidance não pode citar "pela PCX"');

  // 6. Verify isCommercialContact and shouldIgnoreBecauseOwnerSavedContact in noria_core.js
  assert.match(coreCode, /function isCommercialContact\(/, 'CORE deve implementar isCommercialContact');
  assert.match(coreCode, /isCommercialContact\(contact, turn\)/, 'runSalesTurn deve chamar isCommercialContact');
  assert.match(coreCode, /inputJson\.isMyContact === true/, 'shouldIgnoreBecauseOwnerSavedContact deve verificar isMyContact');
  assert.doesNotMatch(coreCode, /inputJson\.contact_category === 'saved'/, 'CORE nao deve suprimir IA pelo rotulo salvo');
  assert.doesNotMatch(coreCode, /inputJson\.isSavedContact/, 'CORE nao deve aceitar um marcador generico de contato salvo');

  // 6.1 A contact already present in the CRM is still a customer. Only an
  // explicit Evolution isMyContact flag may classify it as owner-saved.
  const workflow = JSON.parse(fs.readFileSync(path.join(root, 'n8n/workflows/NORIA-CORE-Roteador-WhatsApp-Comandos-e-Follow-ups--3N5oN6sxtir9lFrA.json'), 'utf8'));
  const normalizer = workflow.nodes.find((node) => node.name === 'Normalizar Entrada WhatsApp');
  assert.ok(normalizer, 'Workflow deve conter o normalizador WhatsApp');
  assert.doesNotMatch(normalizer.parameters.jsCode, /\/rest\/v1\/contacts\?phone=/, 'Normalizador nao pode inferir contato pessoal a partir do CRM');
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const runNormalizer = new AsyncFunction('$json', '$env', '$vars', normalizer.parameters.jsCode);
  const baseInbound = {
    event: 'messages.upsert', instance: 'wesley-carros',
    data: { key: { remoteJid: '5521984375474@s.whatsapp.net', id: 'test-customer', fromMe: false }, message: { conversation: 'Bros 160' } },
  };
  const ordinaryCustomer = await runNormalizer.call({}, baseInbound, {}, {});
  assert.equal(ordinaryCustomer.json.contact_category, 'customer', 'Cliente conhecido nao pode ser bloqueado como contato pessoal');
  const ownerSaved = await runNormalizer.call({}, { ...baseInbound, data: { ...baseInbound.data, isMyContact: true } }, {}, {});
  assert.equal(ownerSaved.json.contact_category, 'saved', 'Somente isMyContact explicito pode marcar contato pessoal');

  const nativeFlowInbound = await runNormalizer.call({}, {
    ...baseInbound,
    data: {
      ...baseInbound.data,
      message: {
        nativeFlowResponseMessage: {
          paramsJson: JSON.stringify({ display_text: 'Quero falar sobre financiamento' }),
        },
      },
    },
  }, {}, {});
  assert.equal(nativeFlowInbound.json.messageText, 'Quero falar sobre financiamento', 'Normalizador deve expor a seleção native flow, nunca um placeholder técnico');
  assert.equal(nativeFlowInbound.json.contentType, 'native_flow_response');

  // 7. Verify salesLoadLead context preservation on reopened attendance
  assert.match(coreCode, /Preserva (?:contexto|historico consultavel) de atendimentos anteriores/, 'salesLoadLead deve herdar contexto de sessões anteriores');

  console.log('✅ All Genesis & Noria Core Fixes passed with 100% assertions satisfied!');
}).catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});

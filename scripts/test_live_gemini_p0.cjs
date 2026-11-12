const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Load environment variables
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let val = (match[2] || '').trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

const coreCode = fs.readFileSync(path.join(__dirname, '../n8n/code/whatsapp_conversation_core.generated.js'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

let engineModule = null;
async function getEngine() {
  if (engineModule) return engineModule;
  const modifiedCode = coreCode.replace(
    'try {\n  const turnResult = await runTurn();',
    'return { salesResolveInventoryItemForFact, salesValidatePrimaryDialogue, salesSanitizeSemanticState, salesNaturalDialogue, normalizeText, salesRecoverSafeDialogue, salesCatalogPresentationProof, salesDialogueSalesSchema };\ntry {\n  const turnResult = await runTurn();'
  );
  const runner = new AsyncFunction(
    '$json', '$env', '$vars', '$getWorkflowStaticData',
    modifiedCode
  );
  engineModule = await runner.call(
    { helpers: { httpRequest: async () => ({}) } },
    {
      tenant_slug: 'wesley_automoveis', tenant_id: 'tenant-genesis', remoteJid: '5511999999999@s.whatsapp.net', instance: 'genesis-instance',
      noria_preclaimed_turn: { boundary_id: 'b1', messages: [{ id: 'm1', text: 'oi' }] }, noria_business_context: { inventory: [] },
      noria_client_policy: { profile: 'vehicle_sales_v1', capability: 'sales_v1', contract: 'noria_policy_v2', tenant_slug: 'wesley_automoveis', tenant_id: 'tenant-genesis', audio_enabled: false, scheduling_enabled: false },
    },
    process.env,
    {},
    () => ({})
  );
  return engineModule;
}

test('motor atual: schema de vendas e saneamento do estado do veículo de troca (local, sem rede)', async () => {
  const engine = await getEngine();
  for (const name of ['salesDialogueSalesSchema', 'salesSanitizeSemanticState', 'salesResolveInventoryItemForFact', 'salesValidatePrimaryDialogue', 'salesRecoverSafeDialogue', 'salesCatalogPresentationProof']) {
    assert.equal(typeof engine[name], 'function', name);
  }
  const schema = engine.salesDialogueSalesSchema();
  assert.equal(schema.type, 'OBJECT');
  assert.ok(schema.properties.reply && schema.properties.response_contract && schema.properties.state, 'schema declara reply, response_contract e state');
  const state = engine.salesSanitizeSemanticState(
    { sell_vehicle: { brand: '', model: 'Modelo 2013', year: 2012 } },
    [{ id: 'm3', text: 'Ano 2012 \n Modelo 2013 \n 2 anos de documento \n 1.500 de multa', direction: 'inbound' }]
  );
  assert.equal(state.sell_vehicle.year, 2012, 'Year 2012 must be captured/preserved');
  assert.notEqual(state.sell_vehicle.model, 'Modelo 2013', 'Modelo 2013 must not be kept as vehicle model name');
});

// Chamada real ao Gemini: só com autorização explícita (NORIA_LIVE_GEMINI=1) e chave presente; nunca por padrão.
test('Controlled Real Gemini Call: Motorcycle catalog and Contact (xx) trade-in', async (t) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (process.env.NORIA_LIVE_GEMINI !== '1' || !apiKey) {
    t.skip('chamada real ao Gemini exige NORIA_LIVE_GEMINI=1 e GEMINI_API_KEY');
    return;
  }

  const engine = await getEngine();
  const model = 'gemini-3.5-flash-lite';
  const schema = engine.salesDialogueSalesSchema();

  // Official offerable inventory from Supabase genesis_inventory_vehicles
  const offerableInventory = [
    { id: 'honda|tornado 300l|2025|vermelho', brand: 'HONDA', model: 'TORNADO 300L', year: 2025, color: 'vermelho', price_cents: 2898000, status: 'announced', offerable: true, category: 'motorcycle' },
    { id: 'honda|pcx|2023|branca', brand: 'HONDA', model: 'PCX', year: 2023, color: 'branca', price_cents: 1749900, status: 'announced', offerable: true, category: 'motorcycle' },
    { id: 'yamaha|crosser|2023|', brand: 'YAMAHA', model: 'CROSSER', year: 2023, color: '', price_cents: 1798000, status: 'announced', offerable: true, category: 'motorcycle' },
    { id: 'honda|cb 600rr|2007|', brand: 'HONDA', model: 'CB 600RR', year: 2007, color: '', price_cents: 3498000, status: 'announced', offerable: true, category: 'motorcycle' }
  ];

  // Helper to make live Gemini call
  async function callGemini(userPayload) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const start = Date.now();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: {
          parts: [{
            text: `Você é a inteligência artificial de vendas da Gênesis Automóveis (WhatsApp).
Responda sempre em conformidade estrita com as regras comerciais e com o inventário fornecido em official_facts.inventory.
NUNCA invente veículos, modelos ou preços não cadastrados.
Preencha fielmente os campos: state, dialogue_plan, response_contract e semantic_intent conforme o schema JSON.`
          }]
        },
        contents: [{
          role: 'user',
          parts: [{ text: JSON.stringify(userPayload) }]
        }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 8192,
          thinkingConfig: /^gemini-3\./.test(model) ? { thinkingLevel: 'low' } : { thinkingBudget: 256 },
          responseMimeType: 'application/json',
          responseSchema: schema
        }
      })
    });

    const elapsed = Date.now() - start;
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini HTTP ${res.status}: ${errText}`);
    }
    const data = await res.json();
    const usage = data.usageMetadata || {};
    const candidate = data.candidates?.[0];
    assert.equal(candidate?.finishReason, 'STOP', 'Finish reason must be STOP');
    const textPart = candidate.content.parts.filter(p => !p.thought).map(p => p.text || '').join('');
    const parsed = JSON.parse(textPart);
    return { parsed, usage, elapsed };
  }

  // Turn 1: Catalog inquiry
  console.log('\n--- Test Turn 1: "Quais motos vocês têm à venda?" ---');
  const payload1 = {
    customer_messages: [{ id: 'm1', text: 'Quais motos vocês têm à venda?' }],
    current_message_ids: ['m1'],
    official_facts: {
      inventory: offerableInventory
    },
    current_lead_state: {
      customer_name: 'João Victor Santos'
    }
  };
  const turn1 = await callGemini(payload1);
  console.log('Turn 1 Duration:', turn1.elapsed, 'ms');
  console.log('Turn 1 Token Usage:', turn1.usage);
  console.log('Turn 1 Parsed:', JSON.stringify(turn1.parsed, null, 2));

  // Validate Turn 1 reply and action
  assert.ok(turn1.parsed.reply, 'Should generate a reply');
  assert.ok(!/Bros/i.test(turn1.parsed.reply), 'Must NEVER mention fictitious Honda Bros');

  // Turn 2: Alternative options inquiry
  console.log('\n--- Test Turn 2: "Quais as outras motocas?" ---');
  const payload2 = {
    customer_messages: [{ id: 'm2', text: 'Quais as outras motocas?' }],
    current_message_ids: ['m2'],
    official_facts: {
      inventory: offerableInventory
    },
    conversation_context: {
      last_assistant_message: 'A Crosser 2023 tá anunciada por R$ 17.980.'
    },
    current_lead_state: {
      customer_name: 'João Victor Santos',
      product_id: 'yamaha|crosser|2023|'
    }
  };
  const turn2 = await callGemini(payload2);
  console.log('Turn 2 Duration:', turn2.elapsed, 'ms');
  console.log('Turn 2 Token Usage:', turn2.usage);
  console.log('Turn 2 Reply:', turn2.parsed.reply);
  console.log('Turn 2 Facts:', turn2.parsed.response_contract?.facts);

  assert.ok(turn2.parsed.reply, 'Should generate a reply');
  assert.ok(!/Bros/i.test(turn2.parsed.reply), 'Must NEVER mention fictitious Honda Bros');

  // Turn 3: Trade-in details from Contact (xx)
  console.log('\n--- Test Turn 3: "Ano 2012 \\n Modelo 2013 \\n 2 anos de documento \\n 1.500 de multa" ---');
  const payload3 = {
    customer_messages: [{ id: 'm3', text: 'Ano 2012 \n Modelo 2013 \n 2 anos de documento \n 1.500 de multa' }],
    current_message_ids: ['m3'],
    official_facts: {
      inventory: offerableInventory
    },
    current_lead_state: {
      customer_name: null,
      sell_vehicle: {
        brand: '',
        model: '',
        year: null
      }
    }
  };
  const turn3 = await callGemini(payload3);
  console.log('Turn 3 Duration:', turn3.elapsed, 'ms');
  console.log('Turn 3 Token Usage:', turn3.usage);
  console.log('Turn 3 Reply:', turn3.parsed.reply);
  console.log('Turn 3 State sell_vehicle:', turn3.parsed.state?.sell_vehicle);
  console.log('Turn 3 Plan:', turn3.parsed.dialogue_plan);

  // Sanitize the returned state
  const sanitizedState = engine.salesSanitizeSemanticState(
    turn3.parsed.state,
    [{ id: 'm3', text: 'Ano 2012 \n Modelo 2013 \n 2 anos de documento \n 1.500 de multa', direction: 'inbound' }]
  );
  console.log('Turn 3 Sanitized sell_vehicle:', sanitizedState.sell_vehicle);

  // Assertions on Turn 3
  assert.equal(sanitizedState.sell_vehicle.year, 2012, 'Year 2012 must be captured/preserved');
  assert.notEqual(sanitizedState.sell_vehicle.model, 'Modelo 2013', 'Modelo 2013 must not be kept as vehicle model name');
});

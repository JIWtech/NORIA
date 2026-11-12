const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const coreSource = fs.readFileSync(path.join(root, 'n8n/sources/noria_core.js'), 'utf8');
const extSource = fs.readFileSync(path.join(root, 'n8n/sources/genesis_extension.js'), 'utf8');
const coreCode = fs.readFileSync(path.join(root, 'n8n/code/whatsapp_conversation_core.generated.js'), 'utf8');
const salesConfig = JSON.parse(fs.readFileSync(path.join(root, 'clients/wesley_automoveis/sales.json'), 'utf8'));
const rawInventory = JSON.parse(fs.readFileSync(path.join(root, 'clients/wesley_automoveis/estoque_referencia.json'), 'utf8')).vehicles;

const inventory = rawInventory.slice(0, 4).map((row) => ({
  ...row,
  id: [row.brand, row.model, row.year, row.color].map((value) => String(value || '').toLowerCase()).join('|'),
  name: [row.brand, row.model, row.year].filter(Boolean).join(' '),
  commercial_name: [row.brand, row.model, row.year].filter(Boolean).join(' '),
  category: /moto|tornado|crosser|biz|titan|fazer/i.test(row.model) ? 'motorcycle' : 'car',
  status: 'announced', offerable: true, availability_verified: false,
  price_source: 'genesis_sheet',
}));

function emptyState() {
  return {
    intent: 'unknown', transaction_mode: 'unknown', payment_mode: 'unknown', payment_evidence: '',
    customer_name: '', name_evidence: '', product_id: '', product_evidence: '', product_variant_evidence: '',
    deposit_cents: null, deposit_evidence: '', sell_brand: '', sell_model: '', sell_year: null,
    sell_brand_evidence: '', sell_model_evidence: '', sell_year_evidence: '',
    sell_vehicle: {
      brand: '', model: '', year: null, category: 'unknown', mileage_km: null,
      auction_history: 'unknown', sinister_history: 'unknown', raw_mention: '', description_summary: '',
      reported_facts: [], concerns: [], maintenance_history: [], evidence_ids: [],
      maintenance_reported: false, maintenance_evidence_ids: [], condition_reported: false,
      condition_evidence_ids: [], eligibility: 'unknown', rejection_reason: '',
      rejection_evidence_ids: [], rejected_at: '',
    },
    buy_interest: { brand: '', model: '', year: null, raw_mention: '', product_id: '', evidence_ids: [] },
  };
}

function semanticIntent({ primary = 'other', secondary = [], purpose = 'none', evidence = [] } = {}) {
  return {
    valid: true,
    primary_intent: primary, secondary_intents: secondary, topics: [],
    customer_disposition: { value: 'active', evidence_ids: [] },
    catalog: { requested: false, category: 'unspecified', price_min_cents: null, price_max_cents: null, preferences: [], exclusions: [], evidence_ids: [] },
    customer_vehicle: { purpose, evidence_ids: evidence },
    references: { previous_catalog: false, selected_ordinal: null, mentioned_product_ids: [], evidence_ids: [] },
    conversation: { continues_previous_topic: false, changes_preference: false, requires_clarification: purpose === 'ambiguous_possession' },
    ambiguities: purpose === 'ambiguous_possession' ? ['customer_vehicle_purpose'] : [], confidence: 'high',
  };
}

function primaryResponse({ kind = 'greeting', product = inventory[0] } = {}) {
  const state = emptyState();
  let action = 'reply';
  let reason = 'none';
  let reply = 'Olá! Como posso ajudar?';
  let topic = 'other';
  let primary = 'other';
  let secondary = [];
  let purpose = 'none';
  let evidence = [];
  let status = 'none';
  let vehicleKind = 'unknown';
  let humanRequested = false;
  let handoffReason = 'none';
  let nextRequirement = 'none';

  if (kind === 'human') {
    action = 'handoff'; reason = 'human'; reply = 'Vou chamar um atendente para ajudar.';
    topic = 'human'; primary = 'human_handoff'; humanRequested = true; handoffReason = 'human_requested';
  } else if (kind === 'trade') {
    action = 'reply'; reply = 'Entendi: você quer o ' + product.model + ' e oferece seu caminhão como entrada, com financiamento do restante. A avaliação e as condições precisam ser confirmadas pela equipe.';
    topic = 'trade_in'; primary = 'buy_and_sell'; secondary = ['trade_in', 'financing']; purpose = 'entry'; evidence = ['e0'];
    status = 'offered'; vehicleKind = 'other'; handoffReason = 'appraisal_review';
    Object.assign(state, {
      intent: 'buy', transaction_mode: 'buy_and_sell', payment_mode: 'financing', payment_evidence: 'e0',
      product_id: product.id, product_evidence: 'e0', product_variant_evidence: 'e0',
      sell_brand: 'Ford', sell_model: 'Cargo', sell_year: 1988,
      sell_brand_evidence: 'e0', sell_model_evidence: 'e0', sell_year_evidence: 'e0',
      buy_interest: { brand: product.brand, model: product.model, year: product.year, raw_mention: product.model, product_id: product.id, evidence_ids: ['e0'] },
      sell_vehicle: {
        ...state.sell_vehicle, brand: 'Ford', model: 'Cargo', year: 1988, category: 'truck',
        auction_history: 'reported_yes', raw_mention: 'meu Ford Cargo 1988 de leilão',
        evidence_ids: ['e0'], reported_facts: ['histórico de leilão declarado pelo cliente'],
      },
    });
  } else if (kind === 'policy') {
    reply = 'O veiculo pode ser apresentado para avaliacao da equipe. Qual veiculo da loja voce pretende comprar?';
    topic = 'trade_in'; primary = 'trade_in'; purpose = 'entry_inquiry'; evidence = ['e0'];
    status = 'policy_discussed'; vehicleKind = 'other'; nextRequirement = 'purchase_product';
  } else if (kind === 'independent') {
    reply = 'Entendi que voce quer vender seu veiculo separadamente. Pode me contar o modelo, ano e estado dele?';
    topic = 'trade_in'; primary = 'sale'; purpose = 'independent_sale'; evidence = ['e0'];
    status = 'declined'; vehicleKind = 'car'; nextRequirement = 'vehicle_description';
    Object.assign(state, {
      intent: 'sell', transaction_mode: 'sell', sell_brand: 'Honda', sell_model: 'Fazer 250',
      sell_brand_evidence: 'e0', sell_model_evidence: 'e0',
      sell_vehicle: {
        ...state.sell_vehicle, brand: 'Honda', model: 'Fazer 250', category: 'motorcycle',
        raw_mention: 'minha Fazer 250', evidence_ids: ['e0'],
      },
    });
  } else if (kind === 'correction') {
    reply = 'Certo, vamos seguir somente com a compra da moto, sem usar seu veiculo como entrada.';
    topic = 'trade_in'; primary = 'purchase'; purpose = 'buy_only_correction'; evidence = ['e0'];
    status = 'declined'; nextRequirement = 'none';
    Object.assign(state, {
      intent: 'buy', transaction_mode: 'buy', product_id: product.id, product_evidence: 'e0',
      product_variant_evidence: 'e0',
      buy_interest: { brand: product.brand, model: product.model, year: product.year, raw_mention: product.model, product_id: product.id, evidence_ids: ['e0'] },
    });
  } else if (kind === 'ambiguous') {
    reply = 'O que voce pretende fazer com a sua Fazer 250: vender separadamente ou usar em uma negociacao?';
    topic = 'trade_in'; primary = 'ambiguous'; purpose = 'ambiguous_possession'; evidence = ['e0'];
    status = 'none'; vehicleKind = 'motorcycle'; nextRequirement = 'trade_in_confirmation';
    Object.assign(state, {
      sell_model: 'Fazer 250', sell_model_evidence: 'e0',
      sell_vehicle: {
        ...state.sell_vehicle, model: 'Fazer 250', category: 'motorcycle',
        raw_mention: 'minha Fazer 250', evidence_ids: ['e0'],
      },
    });
  }

  const semantic = semanticIntent({ primary, secondary, purpose, evidence });
  if (kind === 'trade' || kind === 'correction') {
    semantic.references.mentioned_product_ids = [product.id];
    semantic.references.evidence_ids = ['e0'];
  }
  return {
    action, reason, reply, state,
    dialogue_plan: {
      requests: [{ id: 'request_1', topic }], next_requirement: nextRequirement,
      memory: {
        trade_in_status: status, evidence_ids: evidence,
        vehicle_kind: vehicleKind, vehicle_kind_evidence_ids: evidence,
        customer_vehicle_purpose: purpose === 'buy_only_correction' ? 'none' : purpose,
        customer_vehicle_purpose_evidence_ids: evidence,
      },
      human_requested: humanRequested, handoff_reason: handoffReason,
    },
    semantic_intent: semantic,
    response_contract: {
      answers: [{ request_id: 'request_1', excerpt: reply.slice(0, Math.max(3, Math.min(45, reply.length))) }],
      requested_fields: [], facts: [], availability_asserted: false,
      assignment_confirmed: false, photo_sent: false,
    },
  };
}

async function runCore({ text = 'Oi', response = primaryResponse(), priorLead = null, boundary = 'initial',
  closedAt = null, assignmentMode = 'normal', tradeOperation = null, providerFailure = false } = {}) {
  const sent = [];
  const salesSaves = [];
  const savedEvents = [];
  const assignmentEvents = [];
  const providerBodies = [];
  let currentLead = null;
  let conflictInjected = false;
  const receivedAt = new Date(Date.now() + 1000).toISOString();
  const turn = { claimed: true, token: 'turn-token', boundary_id: boundary, messages: [{ id: 'm0', event_id: 'e0', text, received_at: receivedAt }] };
  const settings = {
    conversation_capability: 'sales_v1', whatsapp_processing_mode: 'conversation_core_v1', grounding_mode: 'canonical_v2',
    system_prompt: 'Gênesis test', ai_model: 'gemini-3.5-flash-lite', ai_enabled: true, gemini_daily_limit: 100,
    whatsapp_audio_enabled: false, appointment_scheduling: { enabled: false }, contact_exclusion_enabled: false,
    follow_up_enabled: false, sales_follow_up: { enabled: false },
    business_facts: { locations: [{ verified: true, address: 'Endereço oficial' }] },
    sdr_rules: { hot_lead_percent: 30, minimum_purchase_year: 1995, rejected_purchase_brands: ['Peugeot', 'Citroen'] },
    sales: { ...salesConfig },
  };
  const context = {
    contract: 'noria_business_result_v1', tenant_slug: 'wesley_automoveis', phase: 'turn',
    session_id: boundary, request_id: 'e0:turn-token', inventory, offerable_catalog: inventory,
    commercial_policy: { contract: 'noria_commercial_policy_v1', tenant_id: 'tenant-genesis',
      financing: { qualification_enabled: true, offered_by_business: true, offered_by_business_status: 'enabled', hot_lead_percent: 30, required_documents: ['cpf','cnh','birth_date'] },
      trade_in: { accepted_subject_to_appraisal: true, status: 'enabled' },
      appraisal: { vehicle_appraisal: settings.business_facts?.vehicle_appraisal || {} } },
    conversation_facts: { contract: 'noria_genesis_conversation_facts_v1', selection_status: 'none', selection_source: 'none', selected_product: null },
    operations: {
      'vehicle.trade_in': tradeOperation || { contract: 'noria_business_result_v1', operation: 'vehicle.trade_in', status: 'ok', data: null, handoff: { required: false, reason: null, message: null } },
      'customer.name_progress': { contract: 'noria_business_result_v1', operation: 'customer.name_progress', status: 'ok', data: { reply: '' }, handoff: { required: false, reason: null, message: null } },
    },
  };

  const request = async ({ url, method = 'GET', body }) => {
    const parsed = new URL(url);
    const table = parsed.pathname.split('/').at(-1);
    if (parsed.hostname === 'generativelanguage.googleapis.com') {
      providerBodies.push(body);
      if (providerFailure) throw new Error('mock Gemini unavailable');
      return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(response) }] } }] };
    }
    if (parsed.hostname === 'evo.test') {
      sent.push(body.text);
      return { key: { id: 'outbound-id' } };
    }
    if (table === 'tenants') return [{ id: 'tenant-genesis', slug: 'wesley_automoveis', status: 'active', name: 'Gênesis' }];
    if (table === 'tenant_settings') return [{ tenant_id: 'tenant-genesis', settings }];
    if (table === 'channels') return [{ id: 'channel-genesis', external_id: 'genesis-instance', status: 'active' }];
    if (table === 'contacts') return [];
    if (table === 'magia_contact_exclusion_status') return { blocked: false };
    if (table === 'sales_documents') return [];
    if (table === 'team_agents') return [{ id: 'operator-wesley', name: 'Wesley', role: 'operator' }];
    if (table === 'magia_commit_turn') return { committed: true };
    if (table === 'magia_finish_turn') return {};
    if (table === 'magia_begin_turn_delivery') return { id: 'delivery-attempt' };
    if (table === 'magia_confirm_turn_delivery') return { confirmed: true };
    if (table === 'magia_sales_save') {
      salesSaves.push(body);
      const stage = body.p_stage;
      const allowAi = salesConfig.stages?.[stage]?.allow_ai === true;
      currentLead = {
        id: 'lead-current', tenant_id: 'tenant-genesis', channel_type: 'whatsapp', chat_id: '5511999999999@s.whatsapp.net',
        session_id: boundary, revision: 1, stage_key: stage, state: body.p_state, product: body.p_product || null,
        hot: false, ai_locked: !allowAi, interest_registered: body.p_register === true,
      };
      return currentLead;
    }
    if (table === 'sales_leads') {
      if (method === 'PATCH') {
        if (assignmentMode === 'conflict' && body?.state?.human_dispatch && !conflictInjected) {
          conflictInjected = true;
          currentLead = {
            ...currentLead, revision: currentLead.revision + 1, ai_locked: true,
            state: { ...currentLead.state, human_dispatch: { status: 'assigned', assignee_id: 'operator-carlos', assignee_name: 'Carlos', within_business_hours: true, next_opening: null } },
          };
          return [];
        }
        currentLead = { ...currentLead, ...body, revision: body.revision ?? currentLead.revision, state: body.state || currentLead.state };
        return [currentLead];
      }
      const scopedToSession = parsed.searchParams.has('session_id');
      if (scopedToSession) return currentLead ? [currentLead] : [];
      return currentLead ? [currentLead] : (priorLead ? [priorLead] : []);
    }
    if (table === 'channel_events') {
      if (method === 'POST') {
        if (body?.raw_payload?.command === 'assign_conversation') {
          if (assignmentMode === 'timeout') throw new Error('network timeout while assignment may be in flight');
          const event = { ...body, id: 'assignment-event', created_at: new Date().toISOString() };
          assignmentEvents.unshift(event);
          currentLead = { ...currentLead, revision: currentLead.revision + 1, ai_locked: true };
          return event;
        }
        const event = { ...body, id: 'saved-event', created_at: new Date().toISOString() };
        savedEvents.push(event);
        return [event];
      }
      if (parsed.searchParams.get('service') === 'eq.conversation_assigned') return assignmentEvents;
      if (parsed.searchParams.get('id')?.startsWith('in.')) return [{ id: 'e0', raw_payload: {} }];
      if (parsed.searchParams.get('or')?.includes('conversation_closed')) {
        return closedAt ? [{ id: boundary, created_at: closedAt, service: 'conversation_closed', ai_provider: 'conversation_closed' }] : [];
      }
      if (parsed.searchParams.get('or')?.includes('sender_type.eq.human')) return [];
      return [];
    }
    throw new Error('Unexpected mocked request: ' + method + ' ' + parsed.pathname + parsed.search);
  };

  const result = await new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', coreCode).call(
    { helpers: { httpRequest: request } },
    {
      tenant_slug: 'wesley_automoveis', tenant_id: 'tenant-genesis', remoteJid: '5511999999999@s.whatsapp.net', instance: 'genesis-instance',
      noria_preclaimed_turn: turn, noria_business_context: context,
      noria_client_policy: { profile: 'vehicle_sales_v1', capability: 'sales_v1', contract: 'noria_policy_v2', tenant_slug: 'wesley_automoveis', tenant_id: 'tenant-genesis', audio_enabled: false, scheduling_enabled: false },
    },
    { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'fake', GEMINI_ENABLED: 'true', GEMINI_API_KEY: 'fake', EVOLUTION_API_URL_WESLEY_AUTOMOVEIS: 'https://evo.test', EVOLUTION_API_KEY_WESLEY_AUTOMOVEIS: 'fake', EVOLUTION_INSTANCE_WESLEY_AUTOMOVEIS: 'genesis-instance' },
    {}, () => ({}),
  );
  return { result: result.json, sent, salesSaves, savedEvents, providerBodies, currentLead };
}

async function runExtTradeIn(text, semantic = null, extraPayload = {}) {
  const input = {
    tenant_slug: 'wesley_automoveis', tenant_id: 'tenant-genesis', noria_extension: 'genesis',
    noria_verified_settings: { tenant_id: 'tenant-genesis', conversation_capability: 'sales_v1', whatsapp_processing_mode: 'conversation_core_v1' },
    contract: 'noria_business_operation_v1', operation: 'vehicle.trade_in',
    payload: { messages: [{ id: 'm1', event_id: 'e1', text }], semantic_intent: semantic, ...extraPayload },
  };
  const output = await new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', extSource).call(
    { helpers: { httpRequest: async () => { throw new Error('No external request expected'); } } },
    input, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'fake' }, {}, () => ({}),
  );
  return output.json;
}

test('canonical sources, generated JavaScript and both workflow nodes are byte-identical', () => {
  assert.equal(coreCode, "const NORIA_NODE_PHASE = 'single';\n" + coreSource);
  const coreWorkflow = JSON.parse(fs.readFileSync(path.join(root, 'n8n/workflows/NORIA-CORE-Roteador-WhatsApp-Comandos-e-Follow-ups--3N5oN6sxtir9lFrA.json'), 'utf8'));
  const extWorkflow = JSON.parse(fs.readFileSync(path.join(root, 'n8n/workflows/NORIA-EXT-Genesis-Automoveis-Politica-Comercial--fXGorIlPbyf9Qtsp.json'), 'utf8'));
  for (const name of ['CORE | Motor conversacional único', 'CORE | Preparar resposta', 'CORE | Finalizar resposta']) assert.ok(coreWorkflow.nodes.find(node => node.name === name).parameters.jsCode.endsWith(coreSource));
  assert.equal(extWorkflow.nodes.find((node) => node.name.startsWith('EXT | Política Gênesis')).parameters.jsCode, extSource);
  assert.doesNotMatch(coreSource, /^\s*humanDispatchData\s*=\s*\{/m);
  assert.equal((coreSource.match(/salesVerifyAssignmentOutcome\(/g) || []).length, 2, 'one declaration and one unified call are expected');
});

test('reopened attendance with old dialogue evidence executes the complete CORE and replies safely', async () => {
  const priorLead = {
    id: 'lead-old', tenant_id: 'tenant-genesis', revision: 7, session_id: 'old-session', ai_locked: false,
    stage_key: salesConfig.stage_keys.qualifying,
    state: {
      ...emptyState(),
      dialogue_memory: {
        trade_in_status: 'offered', evidence_ids: ['old-message'], vehicle_kind: 'car', vehicle_kind_evidence_ids: ['old-message'],
        customer_vehicle_purpose: 'entry', customer_vehicle_purpose_evidence_ids: ['old-message'],
        catalog_audience: 'cars', catalog_audience_evidence_ids: ['old-message'],
      },
      trade_in: { status: 'needs_human_appraisal', evidence_ids: ['old-message'] },
    },
  };
  const result = await runCore({
    text: 'Oi', response: primaryResponse({ kind: 'greeting' }), priorLead,
    boundary: 'close-boundary', closedAt: new Date(Date.now() - 3000).toISOString(),
  });
  assert.equal(result.result.ok, true, JSON.stringify(result.result));
  assert.equal(result.result.delivery_ok, true, JSON.stringify(result.result));
  assert.equal(result.sent.length, 1);
  assert.doesNotMatch(String(result.savedEvents.at(-1)?.ai_error || ''), /DIALOGUE_PLAN_FAILED|UNSCOPED_/);
  const prompt = JSON.parse(result.providerBodies[0].contents[0].parts[0].text);
  assert.equal(prompt.current_lead_state.dialogue_memory.trade_in_status, 'none');
  assert.equal(prompt.current_lead_state.dialogue_memory.historical_context.trade_in_status, 'offered');
  assert.equal(prompt.current_lead_state.dialogue_memory.historical_context.requires_confirmation, true);
  assert.ok(!JSON.stringify(prompt.current_lead_state.dialogue_memory).includes('old-message'));
});

test('real runSalesTurn conflict branch preserves the existing operator without const reassignment', async () => {
  const result = await runCore({ text: 'Quero falar com um atendente', response: primaryResponse({ kind: 'human' }), assignmentMode: 'conflict' });
  assert.equal(result.result.ok, true, JSON.stringify(result.result));
  assert.doesNotMatch(String(result.result.error || ''), /Assignment to constant variable/);
  const dispatch = result.savedEvents.at(-1)?.raw_payload?.human_dispatch;
  assert.equal(dispatch.status, 'assigned');
  assert.equal(dispatch.assignee_id, 'operator-carlos');
  assert.equal(dispatch.assignee_name, 'Carlos');
  assert.equal(dispatch.assignment_result, 'existing_assignment_preserved');
  assert.equal(dispatch.current_attempt_persisted, false);
  assert.equal(dispatch.existing_assignment_preserved, true);
  assert.equal(result.currentLead.ai_locked, true);
});

test('assignment timeout remains dispatch_uncertain and never unlocks the AI', async () => {
  const result = await runCore({ text: 'Quero falar com um atendente', response: primaryResponse({ kind: 'human' }), assignmentMode: 'timeout' });
  assert.equal(result.result.ok, true, JSON.stringify(result.result));
  const dispatch = result.savedEvents.at(-1)?.raw_payload?.human_dispatch;
  assert.equal(dispatch.status, 'dispatch_uncertain');
  assert.equal(dispatch.assignee_id, null);
  assert.equal(dispatch.target_assignee.id, 'operator-wesley');
  assert.equal(result.currentLead.ai_locked, true);
  assert.match(result.sent[0], /verificação da nossa equipe/i, JSON.stringify({ sent: result.sent, event: result.savedEvents.at(-1), state: result.currentLead }));
});

test('concrete vehicle plus financing keeps purchase and customer vehicle separate through the complete CORE', async () => {
  const product = inventory[0];
  const text = 'Quero pegar o ' + product.model + ' dando meu Ford Cargo 1988 de leilão como entrada e financiar o restante';
  const tradeOperation = await runExtTradeIn(text, { valid: true, customer_vehicle: { purpose: 'entry', evidence_ids: ['e1'] } });
  const coreOperation = { ...tradeOperation, data: { ...tradeOperation.data, evidence_ids: ['e0'], customer_vehicle: { ...tradeOperation.data.customer_vehicle, evidence_ids: ['e0'] } } };
  const result = await runCore({ text, response: primaryResponse({ kind: 'trade', product }), assignmentMode: 'normal', tradeOperation: coreOperation });
  assert.equal(result.result.ok, true, JSON.stringify(result.result));
  const state = result.salesSaves[0].p_state;
  assert.equal(state.product_id, product.id, JSON.stringify({ state, event: result.savedEvents.at(-1), result: result.result, prompt: JSON.parse(result.providerBodies[0].contents[0].parts[0].text) }));
  assert.equal(state.buy_interest.product_id, product.id);
  assert.equal(state.trade_in.purpose, 'trade_in');
  assert.equal(state.trade_in.customer_vehicle.category, 'truck');
  assert.equal(state.trade_in.customer_vehicle.year, 1988);
  assert.equal(state.trade_in.customer_vehicle.auction_history, 'reported_yes');
  assert.equal(state.trade_in.acceptance_confirmed, false);
  assert.equal(state.trade_in.valuation_cents, null);
  assert.equal(state.payment_mode, 'financing');
  assert.equal(state.deposit_cents, null, 'the customer vehicle year must not become a cash deposit');
  assert.doesNotMatch(result.sent[0], /quanto.*entrada|valor.*entrada/i);
  assert.equal(result.savedEvents.at(-1).raw_payload.human_dispatch.status, 'assigned');
});

test('the 16-case trade-in matrix crosses Genesis EXT and the complete generated CORE', async () => {
  const cases = [
    ['carro por carro', 'Quero o carro da loja e dou meu Gol 2008 de entrada', 'entry', 'offer', 'trade'],
    ['moto por carro', 'Dou minha Titan na compra do carro', 'entry', 'offer', 'trade'],
    ['carro por moto', 'Dou meu Celta na compra da moto', 'entry', 'offer', 'trade'],
    ['moto por moto', 'Dou minha Biz para pegar outra moto', 'entry', 'offer', 'trade'],
    ['caminhão', 'Tenho um caminhão para abater no valor', 'entry', 'offer', 'trade'],
    ['antigo', 'Quero dar minha Kombi 1985 de entrada', 'entry', 'offer', 'trade'],
    ['leilão', 'Meu carro de leilão pode entrar no negócio', 'entry', 'offer', 'trade'],
    ['política', 'Aceitam moto como entrada?', 'entry_inquiry', 'policy_inquiry', 'policy'],
    ['oferta concreta', 'Quero pegar essa Crosser dando meu Gol', 'entry', 'offer', 'trade'],
    ['venda separada', 'Quero vender meu carro, não trocar', 'independent_sale', 'independent_sale', 'independent'],
    ['veículo dinheiro financiamento', 'Dou meu carro, mais 10 mil, e financio o restante', 'entry', 'offer', 'trade'],
    ['correção', 'Não quero dar meu carro, só comprar a moto', 'buy_only_correction', null, 'correction'],
    ['continuidade', 'E se eu financiar o restante?', 'entry', 'offer', 'trade'],
    ['reabertura', 'Tenho uma Fazer 250', 'ambiguous_possession', 'ambiguous', 'ambiguous'],
    ['sem semântica válida', 'Quero dar minha van de entrada', null, null, null],
    ['posse ambígua', 'Tenho uma Fazer 250', 'ambiguous_possession', 'ambiguous', 'ambiguous'],
  ];
  for (const [index, [name, text, purpose, expected, coreKind]] of cases.entries()) {
    const semantic = purpose ? { valid: true, customer_vehicle: { purpose, evidence_ids: ['e1'] } } : null;
    const extResult = await runExtTradeIn(text, semantic);
    assert.equal(extResult.data?.kind || null, expected, name);
    assert.equal(extResult.handoff.required, false, name + ' must not bypass CORE handoff verification');
    if (expected === null) continue;
    if (expected === 'offer') {
      assert.equal(extResult.data.requires_human_appraisal, true, name);
      assert.equal(extResult.data.acceptance_confirmed, false, name);
      assert.equal(extResult.data.valuation_cents, null, name);
    }

    const priorTrade = ['correção', 'continuidade', 'reabertura'].includes(name)
      ? {
          id: 'lead-prior-' + index, tenant_id: 'tenant-genesis', revision: 3,
          session_id: name === 'reabertura' ? 'old-session-' + index : 'initial',
          ai_locked: false, stage_key: salesConfig.stage_keys.qualifying,
          state: {
            ...emptyState(), transaction_mode: 'buy_and_sell', intent: 'buy',
            dialogue_memory: {
              trade_in_status: 'offered', evidence_ids: ['old-message'], vehicle_kind: 'car',
              vehicle_kind_evidence_ids: ['old-message'], customer_vehicle_purpose: 'entry',
              customer_vehicle_purpose_evidence_ids: ['old-message'],
            },
            trade_in: { status: 'needs_human_appraisal', purpose: 'trade_in', evidence_ids: ['old-message'] },
          },
        }
      : null;
    const coreOperation = extResult.data
      ? {
          ...extResult,
          data: {
            ...extResult.data,
            evidence_ids: ['e0'],
            customer_vehicle: extResult.data.customer_vehicle
              ? { ...extResult.data.customer_vehicle, evidence_ids: ['e0'] }
              : null,
          },
        }
      : extResult;
    const providerFailure = false;
    const coreProduct = name === 'oferta concreta'
      ? inventory.find((item) => /crosser/i.test(item.model)) || inventory[0]
      : inventory[0];
    const coreResult = await runCore({
      text,
      response: primaryResponse({ kind: coreKind, product: coreProduct }),
      priorLead: priorTrade,
      boundary: name === 'reabertura' ? 'matrix-reopen-' + index : 'initial',
      closedAt: name === 'reabertura' ? new Date(Date.now() - 3000).toISOString() : null,
      tradeOperation: coreOperation,
      providerFailure,
    });
    assert.equal(coreResult.result.ok, true, name + ': ' + JSON.stringify(coreResult.result));
    assert.equal(coreResult.result.delivery_ok, true, name + ': ' + JSON.stringify(coreResult.result));
    assert.equal(coreResult.sent.length, 1, name);
    assert.ok(String(coreResult.sent[0] || '').trim(), name + ' must never be silent');

    const state = coreResult.salesSaves.at(-1)?.p_state || coreResult.currentLead?.state || {};
    const dispatch = coreResult.savedEvents.at(-1)?.raw_payload?.human_dispatch;
    if (!providerFailure && expected === 'offer') {
      assert.equal(state.trade_in?.purpose, 'trade_in', name);
      assert.equal(state.trade_in?.acceptance_confirmed, false, name);
      assert.equal(state.trade_in?.valuation_cents, null, name);
      if (name === 'veículo dinheiro financiamento') assert.equal(state.deposit_cents, 1000000, name);
      else assert.equal(state.deposit_cents, null, name + ' must not turn a vehicle year into money');
      if (name === 'oferta concreta') {
        assert.equal(dispatch?.status, 'assigned', name + ': ' + JSON.stringify({ state, event: coreResult.savedEvents.at(-1), result: coreResult.result }));
        assert.equal(coreResult.currentLead?.ai_locked, true, name);
      } else {
        assert.equal(dispatch, undefined, name + ' must wait for a concrete store product');
      }
    } else if (!providerFailure && coreKind === 'policy') {
      assert.equal(state.dialogue_memory?.trade_in_status, 'policy_discussed', name);
      assert.equal(dispatch, undefined, name);
    } else if (!providerFailure && coreKind === 'independent') {
      assert.equal(state.transaction_mode, 'sell', name);
      assert.equal(state.trade_in == null, true, name);
      assert.equal(dispatch, undefined, name);
    } else if (!providerFailure && coreKind === 'correction') {
      assert.equal(state.transaction_mode, 'buy', name);
      assert.equal(state.trade_in == null, true, name);
      assert.equal(dispatch, undefined, name);
    } else if (!providerFailure && coreKind === 'ambiguous') {
      assert.equal(state.dialogue_memory?.customer_vehicle_purpose, 'ambiguous_possession', name);
      assert.equal(dispatch, undefined, name);
    }
  }
});

test('Defeito 1: Crosser 2023 da loja não contamina Gol 2008 do cliente em EXT e CORE (Gemini válido, inválido e indisponível)', async () => {
  const crosser = inventory.find(p => /crosser/i.test(p.model)) || inventory[0];
  const text = 'Quero a Crosser 2023, dou meu Gol 2008 de entrada';

  // 1. Gemini válido
  const extGeminiValido = await runExtTradeIn(text, { valid: true, customer_vehicle: { purpose: 'entry', evidence_ids: ['e1'] } }, { product: crosser });
  assert.equal(extGeminiValido.data?.kind, 'offer');
  assert.equal(extGeminiValido.data?.customer_vehicle?.category, 'car', 'Categoria deve ser car e nunca motorcycle da loja');
  assert.equal(extGeminiValido.data?.customer_vehicle?.year, 2008, 'Ano deve ser 2008 e nunca 2023 da loja');
  assert.equal(extGeminiValido.data?.requires_human_appraisal, true);

  // Integração completa com o CORE para Gemini válido
  const coreGeminiOp = { ...extGeminiValido, data: { ...extGeminiValido.data, evidence_ids: ['e0'], customer_vehicle: { ...extGeminiValido.data.customer_vehicle, evidence_ids: ['e0'] } } };
  const coreGeminiResult = await runCore({
    text,
    response: primaryResponse({ kind: 'trade', product: crosser }),
    tradeOperation: coreGeminiOp,
  });
  assert.equal(coreGeminiResult.result.ok, true);
  const geminiState = coreGeminiResult.salesSaves[0].p_state;
  assert.equal(geminiState.product_id, crosser.id);
  assert.equal(geminiState.buy_interest.year, crosser.year);
  assert.equal(geminiState.trade_in.customer_vehicle.category, 'car');
  assert.equal(geminiState.trade_in.customer_vehicle.year, 2008);
  assert.equal(geminiState.sell_vehicle.category, 'car');
  assert.equal(geminiState.sell_vehicle.year, 2008);
  assert.equal(geminiState.sell_year, 2008);
  assert.equal(geminiState.deposit_cents, null);

  // 2. Gemini inválido (corrompido/erros sintáticos)
  const extGeminiInvalido = await runExtTradeIn(text, { valid: false, validation_errors: ['CORRUPTED'] }, { product: crosser });
  assert.equal(extGeminiInvalido.data, null);
  assert.equal(extGeminiInvalido.handoff.required, false);

  // 3. Gemini indisponível (fallback puro sem semântica)
  const extGeminiIndisponivel = await runExtTradeIn(text, null, { product: crosser });
  assert.equal(extGeminiIndisponivel.data, null);
  assert.equal(extGeminiIndisponivel.handoff.required, false);
});

test('Defeito 2: Falsas ofertas no fallback são descartadas para dúvidas e problemas sem gerar oferta nem handoff', async () => {
  const inputs = [
    'Tenho uma dúvida, quero comprar um carro',
    'Tenho um problema com o financiamento, quero comprar um carro',
    'Tenho interesse em comprar um carro',
    'Tenho uma pergunta sobre o financiamento',
  ];

  for (const text of inputs) {
    // Gemini indisponível
    const resFallback = await runExtTradeIn(text, null);
    assert.equal(resFallback.data, null, `Fallback para "${text}" não deve produzir oferta`);
    assert.equal(resFallback.handoff.required, false, `Fallback para "${text}" não deve disparar handoff`);

    // Gemini inválido
    const resInvalido = await runExtTradeIn(text, { valid: false, validation_errors: ['PARSING_ERROR'] });
    assert.equal(resInvalido.data, null, `Gemini inválido para "${text}" não deve produzir oferta`);
    assert.equal(resInvalido.handoff.required, false, `Gemini inválido para "${text}" não deve disparar handoff`);
  }
});

test('Matriz de categorias: carro por moto, moto por carro e veículo antigo mantêm separação estrita em EXT e CORE', async () => {
  const crosser = inventory.find(p => /crosser/i.test(p.model)) || inventory[0];

  // A. Carro por moto: Cliente oferece moto (Titan 2018) na compra de carro
  const textCarroPorMoto = 'Quero comprar um carro, dou minha Titan 2018 de entrada';
  const extCarroPorMoto = await runExtTradeIn(textCarroPorMoto, semanticIntent({ purpose: 'entry', evidence: ['e1'] }), { product: { model: 'Civic', year: 2020, category: 'car' } });
  assert.equal(extCarroPorMoto.data?.kind, 'offer');
  assert.equal(extCarroPorMoto.data?.customer_vehicle?.category, 'motorcycle');
  assert.equal(extCarroPorMoto.data?.customer_vehicle?.year, 2018);

  // B. Moto por carro: Cliente oferece carro (Gol 2008) na compra da moto (Crosser 2023)
  const textMotoPorCarro = 'Quero a Crosser 2023, dou meu Gol 2008 de entrada';
  const extMotoPorCarro = await runExtTradeIn(textMotoPorCarro, semanticIntent({ purpose: 'entry', evidence: ['e1'] }), { product: crosser });
  assert.equal(extMotoPorCarro.data?.kind, 'offer');
  assert.equal(extMotoPorCarro.data?.customer_vehicle?.category, 'car');
  assert.equal(extMotoPorCarro.data?.customer_vehicle?.year, 2008);

  // C. Veículo antigo: Cliente oferece Fusca 1978 (car antigo)
  const textAntigo = 'Quero a Crosser, dou meu Fusca 1978 de entrada';
  const extAntigo = await runExtTradeIn(textAntigo, semanticIntent({ purpose: 'entry', evidence: ['e1'] }), { product: crosser });
  assert.equal(extAntigo.data?.kind, 'offer');
  assert.equal(extAntigo.data?.customer_vehicle?.category, 'car');
  assert.equal(extAntigo.data?.customer_vehicle?.year, 1978);

  // Validação CORE completa para veículo antigo
  const coreAntigoOp = { ...extAntigo, data: { ...extAntigo.data, evidence_ids: ['e0'], customer_vehicle: { ...extAntigo.data.customer_vehicle, evidence_ids: ['e0'] } } };
  const coreAntigoResult = await runCore({
    text: textAntigo,
    response: primaryResponse({ kind: 'trade', product: crosser }),
    tradeOperation: coreAntigoOp,
  });
  assert.equal(coreAntigoResult.result.ok, true);
  const stateAntigo = coreAntigoResult.salesSaves[0].p_state;
  assert.equal(stateAntigo.product_id, crosser.id);
  assert.equal(stateAntigo.buy_interest.year, crosser.year);
  assert.equal(stateAntigo.trade_in.customer_vehicle.category, 'car');
  assert.equal(stateAntigo.trade_in.customer_vehicle.year, 1978);
  assert.equal(stateAntigo.sell_vehicle.category, 'car');
  assert.equal(stateAntigo.sell_vehicle.year, 1978);
  assert.equal(stateAntigo.sell_year, 1978);
});

test('Oferta mista: carro + 10 mil + financiamento preserva veículo do cliente, valor de entrada e modo financiamento', async () => {
  const crosser = inventory.find(p => /crosser/i.test(p.model)) || inventory[0];
  const text = 'Quero a Crosser, dou meu carro + 10 mil + financiamento';

  // EXT evaluation
  const extResult = await runExtTradeIn(text, semanticIntent({ purpose: 'entry', evidence: ['e1'] }), { product: crosser });
  assert.equal(extResult.data?.kind, 'offer');
  assert.equal(extResult.data?.customer_vehicle?.category, 'car');
  assert.equal(extResult.data?.customer_vehicle?.year, null, 'Sem ano explícito do cliente, deve ser null');
  assert.equal(extResult.data?.requires_human_appraisal, true);

  // CORE complete turn
  const coreOp = { ...extResult, data: { ...extResult.data, evidence_ids: ['e0'], customer_vehicle: { ...extResult.data.customer_vehicle, evidence_ids: ['e0'] } } };
  const coreResult = await runCore({
    text,
    response: primaryResponse({ kind: 'trade', product: crosser }),
    tradeOperation: coreOp,
  });
  assert.equal(coreResult.result.ok, true);
  const state = coreResult.salesSaves[0].p_state;
  assert.equal(state.product_id, crosser.id);
  assert.equal(state.deposit_cents, 1000000, 'Entrada de 10 mil deve ser 1.000.000 centavos');
  assert.equal(state.payment_mode, 'financing', 'Modo de pagamento deve ser financiamento');
  assert.equal(state.trade_in.customer_vehicle.category, 'car');
  assert.equal(state.trade_in.customer_vehicle.year, null);
  assert.equal(state.sell_vehicle.category, 'car');
});

test('Regressão 1: Ano null, undefined, vazio ou zero rejeitado em EXT e CORE nunca persiste sell_year=0', async () => {
  const crosser = inventory.find(p => /crosser/i.test(p.model)) || inventory[0];

  // 1. EXT com storeProduct sem ano (ano null, undefined, '', 0) e semanticVehicle sem ano
  const invalidYears = [null, undefined, '', 0, '0', -1, 1800, 2999];
  for (const badYear of invalidYears) {
    const extStoreYear = await runExtTradeIn('Dou meu carro de entrada', semanticIntent({ purpose: 'entry', evidence: ['e1'] }), { product: { ...crosser, year: badYear } });
    assert.equal(extStoreYear.data?.customer_vehicle?.year, null, `badYear=${badYear} não deve se tornar 0`);

    const extSemanticYear = await runExtTradeIn('Dou meu carro de entrada', {
      valid: true,
      customer_vehicle: { purpose: 'entry', year: badYear, evidence_ids: ['e1'] },
    }, { product: crosser });
    assert.equal(extSemanticYear.data?.customer_vehicle?.year, null, `semantic badYear=${badYear} não deve se tornar 0`);
  }

  // 2. CORE nunca persiste sell_year=0 por ausência de informação
  const coreOpNullYear = {
    contract: 'noria_business_result_v1',
    operation: 'vehicle.trade_in',
    status: 'ok',
    data: {
      kind: 'offer',
      customer_vehicle: { category: 'car', year: null, raw_mention: 'meu carro', evidence_ids: ['e0'] },
      evidence_ids: ['e0'],
      requires_human_appraisal: true,
      acceptance_confirmed: false,
      valuation_cents: null,
    },
    handoff: { required: false, reason: null, message: null },
  };
  const coreResult = await runCore({
    text: 'Dou meu carro de entrada',
    response: primaryResponse({ kind: 'trade', product: crosser }),
    tradeOperation: coreOpNullYear,
  });
  assert.equal(coreResult.result.ok, true);
  const state = coreResult.salesSaves[0].p_state;
  assert.equal(state.sell_year, null, 'CORE nunca deve persistir sell_year=0');
  assert.notEqual(state.sell_year, 0, 'sell_year não pode ser 0');
  assert.equal(state.sell_vehicle.year, null, 'sell_vehicle.year não pode ser 0');
  assert.notEqual(state.sell_vehicle.year, 0, 'sell_vehicle.year não pode ser 0');
  assert.equal(state.trade_in.customer_vehicle.year, null, 'trade_in.customer_vehicle.year não pode ser 0');
});

test('Regressão 2: "Tenho um Gol e quero a Crosser 2023" separa orações de posse e compra, ordem inversa, categorias e mesmo ano', async () => {
  const crosser = inventory.find(p => /crosser/i.test(p.model)) || inventory[0];

  // Caso Exato: "Tenho um Gol e quero a Crosser 2023"
  const textExato = 'Tenho um Gol e quero a Crosser 2023';
  const extExato = await runExtTradeIn(textExato, semanticIntent({ purpose: 'entry', evidence: ['e1'] }), { product: crosser });
  assert.equal(extExato.data?.customer_vehicle?.category, 'car', 'Veículo do cliente deve ser car (Gol)');
  assert.equal(extExato.data?.customer_vehicle?.year, null, 'Ano do Gol é desconhecido (não deve herdar 2023 da Crosser)');

  // Execução no CORE completo para o caso exato
  const coreOpExato = {
    ...extExato,
    data: {
      ...extExato.data,
      kind: 'offer',
      evidence_ids: ['e0'],
      customer_vehicle: { ...extExato.data.customer_vehicle, evidence_ids: ['e0'] },
    },
  };
  const coreResultExato = await runCore({
    text: textExato,
    response: primaryResponse({ kind: 'trade', product: crosser }),
    tradeOperation: coreOpExato,
  });
  assert.equal(coreResultExato.result.ok, true);
  const stateExato = coreResultExato.salesSaves[0].p_state;
  assert.equal(stateExato.product_id, crosser.id, 'Veículo da loja deve ser Crosser');
  assert.equal(stateExato.buy_interest.year, crosser.year, 'Ano da compra deve ser o da Crosser (2023)');
  assert.equal(stateExato.sell_vehicle.category, 'car', 'Veículo à venda deve ser car');
  assert.equal(stateExato.sell_vehicle.year, null, 'Veículo à venda não tem ano');
  assert.equal(stateExato.sell_year, null, 'sell_year deve ser null');

  // Ordem Inversa: "Quero a Crosser 2023 e tenho um Gol"
  const textInverso = 'Quero a Crosser 2023 e tenho um Gol';
  const extInverso = await runExtTradeIn(textInverso, semanticIntent({ purpose: 'entry', evidence: ['e1'] }), { product: crosser });
  assert.equal(extInverso.data?.customer_vehicle?.category, 'car', 'Ordem inversa: categoria deve ser car');
  assert.equal(extInverso.data?.customer_vehicle?.year, null, 'Ordem inversa: ano do Gol deve ser null');

  // Categorias diferentes: Moto cliente (Fazer) e Carro loja (Onix 2020)
  const onix = { id: 'chevrolet|onix|2020|preto', brand: 'Chevrolet', model: 'Onix', year: 2020, category: 'car' };
  const textCatDiff = 'Quero o Onix 2020 e tenho uma Fazer 2018';
  const extCatDiff = await runExtTradeIn(textCatDiff, semanticIntent({ purpose: 'entry', evidence: ['e1'] }), { product: onix });
  assert.equal(extCatDiff.data?.customer_vehicle?.category, 'motorcycle', 'Categoria do cliente deve ser motorcycle');
  assert.equal(extCatDiff.data?.customer_vehicle?.year, 2018, 'Ano da Fazer deve ser 2018');

  // Veículos com o mesmo ano: Crosser (2021) da loja e Gol 2021 do cliente
  const textMesmoAno = 'Dou meu Gol 2021 e quero a Crosser';
  const extMesmoAno = await runExtTradeIn(textMesmoAno, semanticIntent({ purpose: 'entry', evidence: ['e1'] }), { product: crosser });
  assert.equal(extMesmoAno.data?.kind, 'offer');
  assert.equal(extMesmoAno.data?.customer_vehicle?.category, 'car', 'Categoria deve ser car');
  assert.equal(extMesmoAno.data?.customer_vehicle?.year, 2021, 'Ano do Gol do cliente é 2021 e deve ser preservado');

  const coreOpMesmoAno = {
    ...extMesmoAno,
    data: {
      ...extMesmoAno.data,
      evidence_ids: ['e0'],
      customer_vehicle: { ...extMesmoAno.data.customer_vehicle, evidence_ids: ['e0'] },
    },
  };
  const coreResultMesmoAno = await runCore({
    text: textMesmoAno,
    response: primaryResponse({ kind: 'trade', product: crosser }),
    tradeOperation: coreOpMesmoAno,
  });
  assert.equal(coreResultMesmoAno.result.ok, true);
  const stateMesmoAno = coreResultMesmoAno.salesSaves[0].p_state;
  assert.equal(stateMesmoAno.product_id, crosser.id);
  assert.equal(stateMesmoAno.buy_interest.year, crosser.year);
  assert.equal(stateMesmoAno.sell_year, 2021, 'sell_year deve ser 2021');
  assert.equal(stateMesmoAno.sell_vehicle.year, 2021, 'sell_vehicle.year deve ser 2021');
});

test('Regressão 3: Ofertas com condições do veículo ("problema", "defeito", "leilão", "sinistro", "financiado") não são rejeitadas', async () => {
  const crosser = inventory.find(p => /crosser/i.test(p.model)) || inventory[0];

  // Caso 1: "Dou meu carro com problema de entrada" (oferta concreta sujeita à avaliação)
  const textProblema = 'Dou meu carro com problema de entrada';
  const extProblema = await runExtTradeIn(textProblema, semanticIntent({ purpose: 'entry', evidence: ['e1'] }), { product: crosser });
  assert.equal(extProblema.data?.kind, 'offer', 'Oferta com problema não pode ser rejeitada');
  assert.equal(extProblema.data?.customer_vehicle?.category, 'car');
  assert.equal(extProblema.data?.customer_vehicle?.year, null);
  assert.equal(extProblema.data?.requires_human_appraisal, true);

  // Execução pelo CORE completo
  const coreOpProblema = {
    ...extProblema,
    data: {
      ...extProblema.data,
      evidence_ids: ['e0'],
      customer_vehicle: { ...extProblema.data.customer_vehicle, evidence_ids: ['e0'] },
    },
  };
  const coreResultProblema = await runCore({
    text: textProblema,
    response: primaryResponse({ kind: 'trade', product: crosser }),
    tradeOperation: coreOpProblema,
  });
  assert.equal(coreResultProblema.result.ok, true);
  const stateProblema = coreResultProblema.salesSaves[0].p_state;
  assert.equal(stateProblema.transaction_mode, 'buy_and_sell');
  assert.equal(stateProblema.trade_in?.status, 'needs_human_appraisal');
  assert.equal(stateProblema.trade_in?.customer_vehicle?.category, 'car');
  assert.equal(stateProblema.sell_vehicle?.category, 'car');
  assert.equal(stateProblema.sell_vehicle?.condition_reported, true, 'Condição relatada ("problema") deve ser registrada');

  // Caso 2: "Tenho um problema" não é posse de veículo
  const extApenasProblema = await runExtTradeIn('Tenho um problema', semanticIntent({ purpose: 'none' }), { product: crosser });
  assert.equal(extApenasProblema.data, null, '"Tenho um problema" não é posse de veículo');
  assert.equal(extApenasProblema.handoff.required, false);

  // Caso 3: "Tenho um carro com problema" é posse de veículo (ambíguo)
  const extCarroComProblema = await runExtTradeIn('Tenho um carro com problema', semanticIntent({ purpose: 'ambiguous_possession', evidence: ['e1'] }), { product: crosser });
  assert.equal(extCarroComProblema.data?.kind, 'ambiguous', '"Tenho um carro com problema" é posse ambígua');
  assert.equal(extCarroComProblema.data?.customer_vehicle?.category, 'car');

  // Caso 4: Ofertas com outras condições legítimas não são descartadas
  const conditionTests = [
    { text: 'Dou meu carro com defeito de entrada', check: res => assert.equal(res.data?.kind, 'offer') },
    { text: 'Dou meu carro de leilao de entrada', check: res => { assert.equal(res.data?.kind, 'offer'); assert.equal(res.data?.customer_vehicle?.auction_history, 'reported_yes'); } },
    { text: 'Dou meu carro com sinistro de entrada', check: res => { assert.equal(res.data?.kind, 'offer'); assert.equal(res.data?.customer_vehicle?.sinister_history, 'reported_yes'); } },
    { text: 'Dou meu carro financiado de entrada', check: res => assert.equal(res.data?.kind, 'offer') },
  ];

  for (const ct of conditionTests) {
    const res = await runExtTradeIn(ct.text, semanticIntent({ purpose: 'entry', evidence: ['e1'] }), { product: crosser });
    ct.check(res);
  }
});

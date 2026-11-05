// Isolated homologation executor for the Gênesis (wesley_automoveis) pipeline.
//
// It runs the REAL workflow nodes, in the same order the n8n workflows chain them, with no copy of their logic:
//   EXT identity node -> EXT bootstrap (conversation.evaluate) -> CORE prepare -> EXT commercial.decide -> CORE finalize
// Each node is the canonical source file (n8n/sources/*.js) executed as an n8n Code node: `$json`, `$env` and
// `this.helpers.httpRequest` are provided, the rest is the file's own code. The CORE's finalisation contains the
// auditor (deterministic validator and, when enabled, the second Gemini call) and the delivery path.
//
// The only network-facing boundary is `helpers.httpRequest`, served by the world below:
//   - Supabase REST and RPC: an in-memory simulator seeded from the fixtures. Writes are recorded, never sent.
//     Unknown tables or RPCs throw HOMOLOG_MISSING_DEPENDENCY, so a missing dependency fails the run explicitly.
//   - Side-effect RPCs (follow-up scheduling and cancellation, appointments) are recorded as blocked.
//   - The WhatsApp provider (Evolution) is simulated: it returns a message id and records the text. Nothing is sent.
//   - Gemini generateContent: `fixtures` answers from the scenario, `dry` records the exact request and stops,
//     `real` sends it only with HOMOLOG_GEMINI_AUTHORIZED=1, HOMOLOG_GEMINI_KEY (never GEMINI_API_KEY) and a settings snapshot.
//   - Anything else throws HOMOLOG_BLOCKED.
//
// Modes:
//   fixtures  (default) canned Gemini answers from fixtures/genesis_scenarios.json, full pipeline, no network.
//   dry       runs the pipeline until the first Gemini request and records it. Nothing is sent.
//   real      sends Gemini requests. Gated as described above. Not executed by default.
//
// Usage:
//   node scripts/homolog/genesis_executor.cjs [--mode=fixtures] [--scenarios=path] [--out=path]

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// HOMOLOG_SOURCE_ROOT lets the same executor run against another snapshot of the sources (before/after comparison).
const root = process.env.HOMOLOG_SOURCE_ROOT ? path.resolve(process.env.HOMOLOG_SOURCE_ROOT) : path.resolve(__dirname, '../..');
const ts = require(path.resolve(__dirname, '../../app/node_modules/typescript'));

const TENANT_SLUG = 'wesley_automoveis';
const TENANT_ID = '0b5e0000-0000-4000-8000-000000000001';
const INSTANCE = 'homolog';
const CHAT_ID = '5500000000001';
const SUFFIX = 'WESLEY_AUTOMOVEIS';
const SIM_SUPABASE = 'homolog-supabase.invalid';
const SIM_EVOLUTION = 'homolog-evolution.invalid';
const GENESIS_CONTRACT_VERSION = process.env.HOMOLOG_CONTRACT_VERSION || '2.0';
const CORE_FILE = 'n8n/sources/noria_core.js';
const EXT_FILE = 'n8n/sources/genesis_extension.js';
const IDENTITY_FILE = 'n8n/sources/genesis_tenant_identity.js';

// Declarations the executor depends on. Each one must exist in the canonical source, or the run stops.
const REQUIRED_DECLARATIONS = {
  [CORE_FILE]: ['runSalesTurnPrepare', 'runSalesTurnFinalize', 'salesGenerate', 'salesPlanNaturalDialogue', 'salesSemanticCatalogChoice',
    'salesValidatePrimaryDialogue', 'salesAuditPrimaryDialogue', 'salesValidateSemanticIntent', 'salesPersistedIntentDecision',
    'salesCustomerDisposition', 'sendChannelMessage', 'cancelPendingFollowUps', 'scheduleFollowUps', 'supabaseGet', 'supabasePost', 'httpJson'],
  [EXT_FILE]: ['executeBusinessOperation', 'resolveSelection', 'decideProductPhotoAction', 'loadSupabaseInventory'],
};

// Each canonical file can come from its own snapshot (before/after comparison, mixed CORE and EXT versions).
function sourceRootFor(file) {
  if (file === CORE_FILE && process.env.HOMOLOG_CORE_SOURCE_ROOT) return path.resolve(process.env.HOMOLOG_CORE_SOURCE_ROOT);
  if ((file === EXT_FILE || file === IDENTITY_FILE) && process.env.HOMOLOG_EXT_SOURCE_ROOT) return path.resolve(process.env.HOMOLOG_EXT_SOURCE_ROOT);
  return root;
}

function assertDeclarations(file) {
  const source = fs.readFileSync(path.join(sourceRootFor(file), file), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const declared = new Set();
  const visit = node => {
    if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && node.name && ts.isIdentifier(node.name)) declared.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  const missing = (REQUIRED_DECLARATIONS[file] || []).filter(name => !declared.has(name));
  if (missing.length) throw new Error('HOMOLOG_MISSING_DEPENDENCY: ' + file + ' does not declare ' + missing.join(', '));
}

// ---------------------------------------------------------------------------------------------------------------------
// Simulated world: Supabase tables and RPCs, the Evolution provider, the Gemini boundary.
// ---------------------------------------------------------------------------------------------------------------------

// Fixture helper: fills the semantic contract's required keys with neutral values. It never interprets language.
function contractDefaults(overrides = {}) {
  const base = {
    primary_intent: 'other', secondary_intents: [], topics: [],
    customer_disposition: { value: 'active', evidence_ids: [] },
    catalog: { requested: false, category: 'unspecified', price_min_cents: null, price_max_cents: null, preferences: [], exclusions: [], evidence_ids: [] },
    customer_vehicle: { purpose: 'none', evidence_ids: [] },
    references: { previous_catalog: false, selected_ordinal: null, mentioned_product_ids: [], evidence_ids: [], product_references: [], product_role: 'none' },
    conversation: { continues_previous_topic: false, changes_preference: false, requires_clarification: false, frustration: { value: 'none', evidence_ids: [] } },
    auction: { intent: 'none', product_id: null, evidence_ids: [] },
    ambiguities: [], confidence: 'high', offer_response: { value: 'none', evidence_ids: [], offer_ref: '' },
  };
  const merged = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    merged[key] = value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])
      ? { ...base[key], ...value } : value;
  }
  return merged;
}

// The primary Gemini answer for one turn, shaped like the dialogue schema. Only the fields given are customised.
function cannedPrimaryBody(spec = {}) {
  const reply = spec.reply ?? 'Olá! Como posso ajudar?';
  const payload = {
    reply, primary_reply: reply, action: 'reply', reason: 'none', primary_facts: [],
    state: spec.state || {},
    response_contract: {
      answers: [], requested_fields: [], facts: [], fact_evidence_mode: 'standard', availability_asserted: false, assignment_confirmed: false, photo_sent: false,
      handoff_announced: false, ...(spec.response_contract || {}),
    },
    // A scenario marks a deliberately invalid contract with contract: 'invalid'; otherwise the contract is completed with neutral defaults.
    semantic_intent: spec.contract === 'invalid' ? spec.semantic_intent : contractDefaults(spec.semantic_intent || { topics: ['greeting'] }),
    dialogue_plan: { requests: [], next_requirement: 'none', memory: {}, human_requested: false, handoff_reason: 'none', location_kind: 'none', offer: { action: 'none' }, ...(spec.dialogue_plan || {}) },
  };
  return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(payload) }] } }] };
}

function createWorld({ mode, geminiKey, settings, inventory, scenarioResponses, images = [], providerFaultFor = null, rpcOverrides = null, storageObjects = {} }) {
  const world = {
    mode, geminiKey, settings, inventory,
    responses: { primary: [...(scenarioResponses?.primary || [])], other: [...(scenarioResponses?.other || [])] },
    tables: {
      tenants: [{ id: TENANT_ID, slug: TENANT_SLUG, status: 'active', name: 'Gênesis (homologação)' }],
      tenant_settings: [{ tenant_id: TENANT_ID, settings }],
      channels: [{ tenant_id: TENANT_ID, type: 'whatsapp', status: 'active', external_id: INSTANCE, config: { instance_name: INSTANCE } }],
      channel_events: [],
      conversation_turn_queue: [],
      conversation_turn_delivery_attempts: [],
      sales_leads: [],
      follow_up_jobs: [],
      ai_agents: [],
      contacts: [],
      appointments: [],
      sales_documents: [],
      team_agents: [],
      tenant_service_catalog: [],
      whatsapp_catalog_products: [],
      whatsapp_catalog_sync_state: [],
      genesis_inventory_vehicles: inventory.map(vehicleRow),
      genesis_inventory_vehicle_images: images.map(imageRow),
    },
    log: { writes: [], blocked: [], simulated_sends: [], gemini: [], gemini_responses: [], simulated_media: [], missing: [], failures: [] },
    seq: 0,
    providerFaultFor, rpcOverrides, storageObjects: new Map(Object.entries(storageObjects)),
  };
  world.env = {
    SUPABASE_URL: 'https://' + SIM_SUPABASE, SUPABASE_SERVICE_ROLE_KEY: 'homolog-simulated-service-key',
    ['EVOLUTION_API_URL_' + SUFFIX]: 'https://' + SIM_EVOLUTION, ['EVOLUTION_API_KEY_' + SUFFIX]: 'homolog-simulated',
    ['EVOLUTION_INSTANCE_' + SUFFIX]: INSTANCE, ['NORIA_INGRESS_FORWARD_TOKEN_' + SUFFIX]: 'homolog-simulated',
    GEMINI_API_KEY: mode === 'real' ? geminiKey : 'homolog-simulated', GEMINI_ENABLED: 'true',
  };
  return world;
}

// Maps a fixture inventory row to the columns the EXT inventory loader reads.
function vehicleRow(item) {
  return {
    tenant_id: TENANT_ID, vehicle_id: item.id, sheet_row: item.sheet_row ?? null, brand: item.brand, model: item.model, model_year: item.year,
    color: item.color, mileage_km: item.km, fuel: item.fuel, category: item.category || 'car', status: item.status, price_cents: item.price_cents,
    previous_price_cents: item.previous_price_cents ?? null, availability_confirmed: item.availability_verified === true, price_source: item.price_source || 'homolog',
    // An authorised snapshot keeps its own observation fields; the synthetic fixtures do not carry them.
    ...(item.observations !== undefined ? { observations: item.observations } : {}),
    source_observed_at: item.source_observed_at || new Date().toISOString(), synced_at: item.synced_at || new Date().toISOString(), offerable: item.offerable === true,
  };
}

// Maps an authorised image-registry row (metadata only) to the simulated world. The EXT authorises a photo only when the row's
// tenant, bucket, MIME type, hash, size and public URL agree with the path under its own tenant. The snapshot keeps the real
// tenant id and host; here they are translated to the simulated tenant and host, nothing else is changed or added.
function imageRow(item) {
  const parts = String(item.storage_path || '').split('/');
  if (parts[0] === 'genesis' && parts[1]) parts[1] = TENANT_ID;
  const storagePath = parts.join('/');
  return {
    tenant_id: TENANT_ID, vehicle_id: item.vehicle_id, storage_bucket: item.storage_bucket, storage_path: storagePath,
    public_url: 'https://' + SIM_SUPABASE + '/storage/v1/object/public/' + item.storage_bucket + '/' + storagePath,
    sha256: item.sha256, mime_type: item.mime_type, file_size_bytes: item.file_size_bytes, is_primary: item.is_primary === true,
  };
}

function parseFilter(searchParams) {
  const filters = [], limit = Number(searchParams.get('limit') || 0) || null;
  for (const [key, raw] of searchParams.entries()) {
    if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
    if (key === 'or') {
      const alternatives = raw.replace(/^\(|\)$/g, '').split(',').map(item => parseCondition(item));
      filters.push(row => alternatives.some(test => test(row)));
      continue;
    }
    filters.push(parseCondition(key + '.' + raw));
  }
  return { filters, limit };
}

function parseCondition(text) {
  const [column, ...rest] = text.split('.');
  const op = rest.shift();
  const value = rest.join('.');
  // PostgREST JSON path (metadata->>key): resolved on the simulated row so receipt lookups can be exercised.
  const col = row => (column.includes("->>") ? column.split("->>").reduce((value, key, index) => (index === 0 ? row[key] : value?.[key]), undefined) : row[column]);
  const cast = raw => (raw === 'null' ? null : raw === 'true' ? true : raw === 'false' ? false : (/^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw));
  if (op === 'not') { const inner = parseCondition(column + '.' + value); return row => !inner(row); }
  if (op === 'is') return row => (col(row) ?? null) === cast(value);
  if (op === 'in') {
    const set = value.replace(/^\(|\)$/g, '').split(',').map(v => String(cast(v)));
    return row => set.includes(String(col(row)));
  }
  const expected = cast(value);
  const compare = (a, b) => (typeof a === 'number' || typeof b === 'number') ? Number(a) - Number(b) : String(a).localeCompare(String(b));
  switch (op) {
    case 'eq': return row => String(col(row) ?? '') === String(expected ?? '');
    case 'neq': return row => String(col(row) ?? '') !== String(expected ?? '');
    case 'gt': return row => col(row) != null && compare(col(row), expected) > 0;
    case 'gte': return row => col(row) != null && compare(col(row), expected) >= 0;
    case 'lt': return row => col(row) != null && compare(col(row), expected) < 0;
    case 'lte': return row => col(row) != null && compare(col(row), expected) <= 0;
    default: throw new Error('HOMOLOG_MISSING_DEPENDENCY: unsupported PostgREST operator ' + op);
  }
}

function tableRequest(world, method, table, searchParams, body) {
  if (!Object.prototype.hasOwnProperty.call(world.tables, table)) {
    world.log.missing.push(table);
    throw new Error('HOMOLOG_MISSING_DEPENDENCY: no simulated table ' + table);
  }
  const rows = world.tables[table];
  const { filters, limit } = parseFilter(searchParams);
  const matches = rows.filter(row => filters.every(test => test(row)));
  if (method === 'GET') {
    const found = limit ? matches.slice(0, limit) : matches;
    // PostgREST JSON-path projection ("alias:column->key"), as the lean identity read uses; plain selects return the whole row.
    const projection = String(searchParams.get('select') || '').split(',').map(item => /^([a-z_]+):([a-z_]+)->([a-z_]+)$/.exec(item)).filter(Boolean);
    if (projection.length === 0) return found;
    return found.map(row => Object.fromEntries(projection.map(([, alias, column, key]) => [alias, row[column]?.[key] ?? null])));
  }
  if (method === 'POST') {
    const inserted = (Array.isArray(body) ? body : [body]).map(item => ({ id: 'sim-' + table + '-' + (++world.seq), created_at: new Date().toISOString(), ...item }));
    rows.push(...inserted);
    world.log.writes.push({ method, table, rows: inserted.length });
    return inserted;
  }
  if (method === 'PATCH') {
    for (const row of matches) Object.assign(row, body);
    world.log.writes.push({ method, table, rows: matches.length, patch: Object.keys(body || {}) });
    return matches;
  }
  throw new Error('HOMOLOG_BLOCKED: method ' + method + ' on ' + table);
}

function rpcError(message) {
  const error = new Error('Request failed with status code 400');
  error.response = { data: { message } };
  return error;
}

function queueFor(world, p) {
  return world.tables.conversation_turn_queue.find(row => row.tenant_id === p.p_tenant && row.channel_type === 'whatsapp' && row.chat_id === p.p_chat) || null;
}
const leaseLive = q => Boolean(q.lease_until) && Date.parse(q.lease_until) > Date.now();

// Turn lifecycle and delivery RPCs. They record the outcome the CORE checks for; they do not decide business rules.
const RPC = {
  magia_turn_lifecycle_status: () => ({ ready: true, contract: 'noria_turn_lifecycle_v1' }),
  magia_turn_suppression_status: () => ({ contract: 'noria_turn_lifecycle_v1', evidence: {} }),
  magia_contact_exclusion_status: () => ({ blocked: false }),
  // The five lifecycle RPCs mirror the definitions published in Supabase (compared read-only on 2026-10-20): arguments
  // (p_tenant, p_chat, p_token), phase guards and outcomes. NOT reproduced: row locking, the terminal-receipt table, the
  // review-ticket trigger and magia_turn_terminal_evidence (the simulator has no suppression authority, so a finish
  // without a delivery has no proof and is routed to magia_fail_turn, as the published function does when proof is null).
  magia_commit_turn: (world, p) => {
    const q = queueFor(world, p);
    if (!q || !p.p_token || q.token !== p.p_token || q.phase !== 'processing' || !leaseLive(q) || !q.retry_batch_id) return { committed: false, reason: 'lost_lease' };
    if (Array.isArray(q.pending) && q.pending.length > 0) return { committed: false, reason: 'new_messages' };
    Object.assign(q, { phase: 'sending', lease_until: new Date(Date.now() + 180000).toISOString() });
    return { committed: true, contract: 'noria_turn_lifecycle_v1' };
  },
  magia_begin_turn_delivery: (world, p) => {
    const q = queueFor(world, p);
    if (!q || !p.p_token || q.token !== p.p_token || q.phase !== 'sending' || !leaseLive(q) || !q.retry_batch_id) throw rpcError('STALE_DELIVERY_ATTEMPT');
    if (q.current_delivery_id || world.tables.conversation_turn_delivery_attempts.some(row => row.turn_token === p.p_token)) return { dispatch_allowed: false, reason: 'delivery_already_started' };
    const attempt = { id: 'sim-attempt-' + (++world.seq), tenant_id: p.p_tenant, channel_type: 'whatsapp', chat_id: p.p_chat, session_id: q.boundary_id, turn_token: p.p_token, status: 'attempting',
      claimed_event_ids: (q.claimed || []).map(item => item.event_id), provider_message_id: null, outbound_event_id: null, confirmed_at: null, error_code: null };
    world.tables.conversation_turn_delivery_attempts.push(attempt);
    q.current_delivery_id = attempt.id;
    return { id: attempt.id, status: 'attempting', dispatch_allowed: true, contract: 'noria_turn_lifecycle_v1' };
  },
  magia_confirm_turn_delivery: (world, p) => {
    const q = queueFor(world, p);
    if (!q || !p.p_token || !p.p_attempt || q.token !== p.p_token || q.current_delivery_id !== p.p_attempt || !['sending', 'uncertain', 'review'].includes(q.phase)) return { confirmed: false, reason: 'stale_delivery' };
    // The outbound event must be the assistant event persisted for this exact attempt and provider message id.
    const evidence = world.tables.channel_events.find(e => e.id === p.p_outbound_event && e.tenant_id === p.p_tenant && e.channel_type === 'whatsapp'
      && e.external_conversation_id === p.p_chat && e.direction === 'outbound' && e.sender_type === 'assistant'
      && e.external_message_id === p.p_provider_message && e.raw_payload?.delivery_attempt_id === p.p_attempt);
    if (!p.p_provider_message || !evidence) return { confirmed: false, reason: 'delivery_evidence_mismatch' };
    const attempt = world.tables.conversation_turn_delivery_attempts.find(row => row.id === p.p_attempt && row.turn_token === p.p_token && row.chat_id === p.p_chat
      && (!row.provider_message_id || row.provider_message_id === p.p_provider_message) && (!row.outbound_event_id || row.outbound_event_id === p.p_outbound_event));
    if (attempt) Object.assign(attempt, { status: 'confirmed', provider_message_id: p.p_provider_message, outbound_event_id: p.p_outbound_event, confirmed_at: attempt.confirmed_at || new Date().toISOString() });
    return { confirmed: Boolean(attempt), contract: 'noria_turn_lifecycle_v1' };
  },
  magia_finish_turn: (world, p) => {
    if (!['done', 'retry', 'cancelled', 'failed', 'uncertain', 'review'].includes(p.p_outcome)) throw rpcError('Invalid outcome');
    const q = queueFor(world, p);
    if (!q || !p.p_token || q.token !== p.p_token) return { finished: false };
    if (p.p_outcome === 'retry' && q.phase !== 'processing') throw rpcError('Cannot retry committed turn');
    const attempts = world.tables.conversation_turn_delivery_attempts.filter(row => row.turn_token === p.p_token);
    if (p.p_outcome === 'retry') {
      if (q.retry_batch_id && !q.current_delivery_id && q.pending.length > 0 && !attempts.length) {
        Object.assign(q, { phase: 'ready', lease_until: new Date().toISOString(), next_attempt_at: null, attempt_count: Math.max(q.attempt_count - 1, 0), last_error_code: 'new_messages_before_commit', review_required_at: null });
        return { finished: true, outcome: 'ready', reason: 'new_messages_coalesced', retry_queued: true, attempt_count: q.attempt_count, contract: 'noria_turn_lifecycle_v1' };
      }
      return RPC.magia_fail_turn(world, { ...p, p_error: 'new_messages_before_commit', p_retryable: true });
    }
    if (p.p_outcome === 'failed') return RPC.magia_fail_turn(world, { ...p, p_error: 'legacy_failed_outcome', p_retryable: false });
    if (['uncertain', 'review'].includes(p.p_outcome)) {
      const phase = q.current_delivery_id ? 'uncertain' : p.p_outcome;
      Object.assign(q, { phase, last_error_code: q.last_error_code || 'explicit_technical_hold', review_required_at: new Date().toISOString(), lease_until: new Date().toISOString() });
      return { finished: true, outcome: phase, retry_queued: false, contract: 'noria_turn_lifecycle_v1' };
    }
    const attempt = world.tables.conversation_turn_delivery_attempts.find(row => row.id === q.current_delivery_id && row.turn_token === p.p_token);
    const outbound = attempt && world.tables.channel_events.find(e => e.id === attempt.outbound_event_id);
    const confirmed = Boolean(attempt && attempt.status === 'confirmed' && attempt.confirmed_at && attempt.provider_message_id && outbound
      && outbound.direction === 'outbound' && outbound.sender_type === 'assistant' && outbound.external_message_id === attempt.provider_message_id
      && outbound.raw_payload?.delivery_attempt_id === attempt.id);
    if (attempts.length || q.current_delivery_id) {
      if (p.p_outcome !== 'done' || !confirmed) throw rpcError('DELIVERY_RECONCILIATION_REQUIRED');
    } else if (!['processing', 'sending'].includes(q.phase) || !q.retry_batch_id || !leaseLive(q) || (p.p_outcome === 'done' && q.phase !== 'sending')) {
      throw rpcError('UNRESOLVED_TURN_REQUIRES_REVIEW');
    } else {
      return RPC.magia_fail_turn(world, { ...p, p_error: 'TERMINAL_EVIDENCE_MISSING:' + p.p_outcome, p_retryable: false });
    }
    Object.assign(q, { claimed: [], token: null, lease_until: null, phase: 'ready', current_delivery_id: null, retry_batch_id: null, attempt_count: 0,
      retry_max_attempts: null, retry_base_seconds: null, retry_cap_seconds: null, next_attempt_at: null, last_error_code: null, review_required_at: null });
    return { finished: true, outcome: p.p_outcome, retry_queued: false, contract: 'noria_turn_lifecycle_v1' };
  },
  // magia_claim_turn as published, for the branches the cutover recovery depends on. NOT reproduced: boundary lookup, inactive tenant,
  // legacy untracked batches and the quiet window.
  magia_claim_turn: (world, p) => {
    const q = queueFor(world, { p_tenant: p.p_tenant, p_chat: p.p_chat });
    if (!q) return { claimed: false, reason: 'empty' };
    if (['uncertain', 'review'].includes(q.phase)) return { claimed: false, reason: q.phase === 'review' ? 'technical_review_required' : 'delivery_uncertain' };
    if (q.token && leaseLive(q)) return { claimed: false, reason: 'busy' };
    if (['processing', 'sending'].includes(q.phase)) return { claimed: false, reason: RPC.magia_fail_turn(world, { ...p, p_token: q.token, p_error: 'lease_expired', p_retryable: true }).reason };
    if (q.next_attempt_at && Date.parse(q.next_attempt_at) > Date.now()) return { claimed: false, reason: 'retry_backoff' };
    const batch = [...(q.claimed || []), ...(q.pending || [])];
    if (!batch.length) return { claimed: false, reason: 'quiet_window' };
    if (q.retry_batch_id && (q.retry_max_attempts == null || q.attempt_count >= q.retry_max_attempts)) {
      Object.assign(q, { phase: 'review', review_required_at: new Date().toISOString(), last_error_code: q.retry_max_attempts == null ? 'retry_policy_missing' : 'retry_budget_exhausted' });
      return { claimed: false, reason: 'technical_review_required' };
    }
    const token = 'homolog-token-reclaim-' + (++world.seq);
    Object.assign(q, { token, phase: 'processing', claimed: batch, pending: [], lease_until: new Date(Date.now() + 180000).toISOString(), claimed_at: new Date().toISOString(),
      current_delivery_id: null, attempt_count: q.attempt_count + 1, next_attempt_at: null, review_required_at: null });
    return { claimed: true, token, messages: batch, boundary_id: q.boundary_id, retry_batch_id: q.retry_batch_id, attempt_count: q.attempt_count, contract: 'noria_turn_lifecycle_v1' };
  },
  magia_sales_save: (world, p) => {
    const existing = world.tables.sales_leads.find(row => row.chat_id === CHAT_ID);
    const revision = existing ? existing.revision : 0;
    if (Number(p.p_revision || 0) !== revision) throw rpcError('STALE_SALES_REVISION');
    const interest = Boolean(existing?.interest_registered) || Boolean(p.p_register);
    const row = Object.assign(existing || { id: 'sim-lead-' + (++world.seq), chat_id: CHAT_ID, tenant_id: TENANT_ID, channel_type: 'whatsapp', session_id: p.p_session }, {
      revision: revision + 1, state: p.p_state, product_id: p.p_product?.id || null, stage_key: p.p_stage,
      interest_registered: interest, updated_at: new Date().toISOString(),
    });
    if (!existing) world.tables.sales_leads.push(row);
    world.log.writes.push({ method: 'RPC', table: 'sales_leads', rows: 1, rpc: 'magia_sales_save' });
    return { id: row.id, revision: row.revision, stage_key: row.stage_key, hot: row.stage_key === 'sales_hot' };
  },
  // Side-effect RPCs: recorded, never executed.
  magia_schedule_followups: (world, p) => { world.log.blocked.push({ rpc: 'magia_schedule_followups', payload: p }); return { scheduled: 0, blocked: true }; },
  magia_cancel_followups_from_event: (world, p) => { world.log.blocked.push({ rpc: 'magia_cancel_followups_from_event', payload: p }); return { cancelled: 0, blocked: true }; },
  magia_merge_channel_event_raw: (world, p) => ({ merged: true, event: p.p_event }),
  magia_fail_turn: (world, p) => {
    const q = queueFor(world, p);
    world.log.failures.push({ error: p.p_error, retryable: p.p_retryable === true });
    if (!q || !p.p_token || q.token !== p.p_token) return { finished: false, reason: 'stale_token' };
    const attempts = world.tables.conversation_turn_delivery_attempts.filter(row => row.turn_token === p.p_token);
    if (['uncertain', 'review'].includes(q.phase)) return { finished: true, outcome: q.phase, retry_queued: false, contract: 'noria_turn_lifecycle_v1' };
    if (!['processing', 'sending'].includes(q.phase)) return { finished: false, reason: 'invalid_phase' };
    let target, reason, delay = null;
    if (attempts.length || q.current_delivery_id) { target = 'uncertain'; reason = 'delivery_reconciliation_required'; }
    else if (!q.retry_batch_id) { target = 'review'; reason = 'legacy_untracked_batch'; }
    else if (p.p_retryable !== true) { target = 'review'; reason = 'permanent_or_unclassified_failure'; }
    else if (q.retry_max_attempts == null) { target = 'review'; reason = 'retry_policy_missing'; }
    else if (q.attempt_count >= q.retry_max_attempts) { target = 'review'; reason = 'retry_budget_exhausted'; }
    else { target = 'ready'; reason = 'retry_scheduled'; delay = Math.min(q.retry_cap_seconds, q.retry_base_seconds * 2 ** Math.min(Math.max(q.attempt_count - 1, 0), 100)); }
    // claimed, pending, token, batch identity and delivery reference stay intact; the lease expires to fence the old worker.
    Object.assign(q, { phase: target, lease_until: new Date().toISOString(), next_attempt_at: target === 'ready' ? new Date(Date.now() + delay * 1000).toISOString() : null,
      last_error_code: String(p.p_error || reason).slice(0, 300), review_required_at: ['review', 'uncertain'].includes(target) ? new Date().toISOString() : null });
    for (const row of attempts) if (row.status !== 'confirmed') Object.assign(row, { status: 'uncertain', error_code: row.error_code || String(p.p_error || '').slice(0, 300) });
    return { finished: true, outcome: target, reason, retry_queued: target === 'ready', attempt_count: q.attempt_count, contract: 'noria_turn_lifecycle_v1' };
  },
  magia_gemini_reserve: () => ({ allowed: true, mode: 'homolog_simulated', reservation_id: 'homolog' }),
  magia_gemini_acquire: () => ({ allowed: true, mode: 'homolog_simulated', lease_id: 'homolog' }),
  magia_gemini_release: () => ({ released: true }),
};

function sideEffectGuard(world, method, pathname) {
  // Anything that would touch a human, an appointment or a WhatsApp conversation outside the simulated attempt.
  if (method !== 'GET' && /magia_(appointment|reserve_appointment|reserve_session_appointment|command_router|operator)/.test(pathname)) {
    world.log.blocked.push({ rpc: pathname.split('/').pop(), method });
    throw new Error('HOMOLOG_BLOCKED: ' + pathname.split('/').pop() + ' is a side effect');
  }
}

function supabaseRequest(world, method, url, body) {
  const pathname = url.pathname, search = url.searchParams;
  if (process.env.HOMOLOG_TRACE) console.error('TRACE', method, pathname, decodeURIComponent(url.search).slice(0, 220));
  // Optional extension points used only by other homologation drivers (services): per-world RPC adapters and injected faults.
  const rpcName = pathname.startsWith('/rest/v1/rpc/') ? pathname.slice('/rest/v1/rpc/'.length) : null;
  if (world.faultFor) { const fault = world.faultFor(method, pathname, body); if (fault) throw fault; }
  if (pathname.startsWith('/storage/v1/object/') && method === 'GET') {
    const [, , , , bucket, ...segments] = pathname.split('/');
    const key = bucket + '/' + segments.map(decodeURIComponent).join('/');
    world.log.storage_reads = [...(world.log.storage_reads || []), key];
    const bytes = world.storageObjects.get(key);
    if (!bytes) throw new Error('HOMOLOG_STORAGE_OBJECT_MISSING');
    return { body: Buffer.from(bytes) };
  }
  if (rpcName && world.rpcOverrides?.[rpcName]) { world.log.writes.push({ method, rpc: rpcName }); return world.rpcOverrides[rpcName](world, body || {}); }
  sideEffectGuard(world, method, pathname);
  if (pathname.startsWith('/rest/v1/rpc/')) {
    const name = pathname.slice('/rest/v1/rpc/'.length);
    const handler = RPC[name];
    if (!handler) { world.log.missing.push(name); throw new Error('HOMOLOG_MISSING_DEPENDENCY: no simulated RPC ' + name); }
    world.log.writes.push({ method, rpc: name });
    return handler(world, body || {});
  }
  if (pathname.startsWith('/rest/v1/')) return tableRequest(world, method, pathname.slice('/rest/v1/'.length), search, body);
  throw new Error('HOMOLOG_BLOCKED: unsupported Supabase path ' + pathname);
}

function providerRequest(world, method, url, body) {
  if (world.providerFaultFor) { const fault = world.providerFaultFor(method, url, body); if (fault) throw fault; }
  if (method === 'POST' && /^\/message\/sendMedia\//.test(url.pathname)) {
    // The media URL is recorded, never fetched. The provider acceptance is simulated.
    const mediaId = 'SIM-MEDIA-' + (++world.seq);
    world.log.simulated_media.push({ id: mediaId, to: body?.number, mediatype: body?.mediatype, media: body?.media, caption: String(body?.caption || '').slice(0, 200) });
    return { key: { id: mediaId } };
  }
  if (method !== 'POST' || !/^\/message\/sendText\//.test(url.pathname)) throw new Error('HOMOLOG_BLOCKED: provider ' + method + ' ' + url.pathname);
  const text = String(body?.text || '');
  const id = 'SIM-MSG-' + (++world.seq);
  world.log.simulated_sends.push({ id, to: body?.number, text: text.slice(0, 200) });
  return { key: { id } };
}

// Gemini boundary: the only request that can leave the process, and only in `real` mode with the homologation key.
async function geminiRequest(world, url, body) {
  const model = url.pathname.split('/models/')[1].split(':')[0];
  const schema = body?.generationConfig?.responseSchema || {};
  world.log.gemini.push({ model, schema_properties: Object.keys(schema.properties || {}).slice(0, 40), body });
  // Optional per-world override (services homologation): a driver may answer chosen requests itself, e.g. to feed a real auditor a canned reply.
  if (world.geminiOverride) { const overridden = world.geminiOverride(body, schema); if (overridden !== undefined) return overridden; }
  if (world.mode === 'dry') throw new Error('HOMOLOG_DRY_RUN: Gemini request recorded, not sent');
  if (world.mode === 'real') {
    const response = await fetch(url.href, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': world.geminiKey },
      body: JSON.stringify(body), signal: AbortSignal.timeout(45000),
    });
    const text = await response.text();
    if (!response.ok) { const error = new Error('Request failed with status code ' + response.status); error.statusCode = response.status; throw error; }
    const parsed = JSON.parse(text);
    // Kept so the run can report what the model actually interpreted, not only whether the JSON was valid.
    world.log.gemini_responses.push({ primary: Boolean(schema.properties?.semantic_intent), model, parsed });
    return parsed;
  }
  // Fixtures: the primary dialogue call consumes the scenario's answer for that turn. Any other Gemini call (the
  // auditor) consumes its own queue. An empty queue stops the run: a missing answer is a missing dependency.
  const isPrimary = Boolean(schema.properties?.semantic_intent);
  const queue = isPrimary ? world.responses.primary : world.responses.other;
  const next = queue.shift();
  if (!next) throw new Error('HOMOLOG_MISSING_DEPENDENCY: no canned Gemini answer left for this ' + (isPrimary ? 'primary' : 'auditor') + ' call (' + model + ')');
  // A fixture may be a function of the request (a canned auditor that must echo the request's scope key).
  return typeof next === 'function' ? next(body) : next;
}

function makeHttpRequest(world) {
  return async function homologHttpRequest(options = {}) {
    const url = new URL(String(options.url || ''));
    const method = String(options.method || 'GET').toUpperCase();
    const body = options.body === undefined ? null : options.body;
    if (url.hostname === SIM_SUPABASE) return supabaseRequest(world, method, url, body);
    if (url.hostname === SIM_EVOLUTION) return providerRequest(world, method, url, body);
    if (url.hostname === 'generativelanguage.googleapis.com') {
      if (method !== 'POST' || !/^\/v1beta\/models\/[a-z0-9.\-]+:generateContent$/.test(url.pathname)) {
        throw new Error('HOMOLOG_BLOCKED: only Gemini generateContent is reachable (' + method + ' ' + url.pathname + ')');
      }
      return geminiRequest(world, url, body);
    }
    throw new Error('HOMOLOG_BLOCKED: no route for host ' + url.hostname);
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Node execution. Each call runs the canonical file as an n8n Code node in a fresh VM realm.
// ---------------------------------------------------------------------------------------------------------------------

async function runNode(file, { json, phase = null, world }) {
  assertDeclarations(file);
  const source = fs.readFileSync(path.join(sourceRootFor(file), file), 'utf8');
  const sandbox = {
    console, Buffer, URL, URLSearchParams, JSON, Math, Date, Number, String, Boolean, Array, Object, Map, Set, Promise, Error, TypeError, RegExp,
    encodeURIComponent, decodeURIComponent, setTimeout, clearTimeout, AbortSignal,
    $json: JSON.parse(JSON.stringify(json)), $env: world.env, $vars: {}, $getWorkflowStaticData: () => ({}),
  };
  if (phase) sandbox.NORIA_NODE_PHASE = phase;
  const context = vm.createContext(sandbox);
  const script = new vm.Script('(async function () {\n' + source + '\n})', { filename: file });
  const node = script.runInContext(context);
  const result = await node.call({ helpers: { httpRequest: makeHttpRequest(world) } });
  // An n8n Code node returns { json }; the CORE returns its phase result directly.
  return result && typeof result === 'object' && Object.keys(result).length === 1 && 'json' in result ? result.json : result;
}

// ---------------------------------------------------------------------------------------------------------------------
// One customer message through the real chain.
// ---------------------------------------------------------------------------------------------------------------------

// The contract version the CORE workflow router node ("CORE - Resolver extensão do tenant") puts on the request that reaches
// the EXT identity. It is read from the workflow JSON, not assumed. workflowJsonText lets a check present an earlier publication.
const ROUTER_NODE = 'CORE - Resolver extensão do tenant';
const CORE_WORKFLOW_FILE = 'n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json';
async function routerContractVersion(workflowJsonText) {
  const text = workflowJsonText || fs.readFileSync(path.join(sourceRootFor(CORE_FILE), CORE_WORKFLOW_FILE), 'utf8');
  const node = JSON.parse(text).nodes.find(item => item.name === ROUTER_NODE);
  if (!node) throw new Error('HOMOLOG_MISSING_DEPENDENCY: workflow node ' + ROUTER_NODE);
  const context = vm.createContext({ $json: { tenant_slug: TENANT_SLUG, tenant_id: TENANT_ID, instance: INSTANCE, remoteJid: CHAT_ID }, $env: {}, Error, String, RegExp, encodeURIComponent });
  const run = new vm.Script('(async function () {\n' + node.parameters.jsCode + '\n})', { filename: ROUTER_NODE }).runInContext(context);
  const out = await run.call({ helpers: { httpRequest: () => { throw new Error('HOMOLOG_BLOCKED: router must not call the network for a legacy tenant'); } } });
  return out.json.noria_contract_version;
}

async function runCustomerTurn(world, text, index, options = {}) {
  // options.resume: the turn was already claimed (or re-claimed by magia_claim_turn); nothing new is enqueued.
  const existing = world.tables.conversation_turn_queue.find(row => row.chat_id === CHAT_ID);
  const eventId = options.resume ? existing.claimed[0].event_id : 'in-' + (index + 1);
  const token = options.resume ? existing.token : 'homolog-token-' + (index + 1), boundary = 'initial';
  const createdAt = new Date(Date.now() - 1000 * (100 - index)).toISOString();
  if (!options.resume) world.tables.channel_events.push({
    id: eventId, tenant_id: TENANT_ID, tenant_slug: TENANT_SLUG, channel_type: 'whatsapp', external_conversation_id: CHAT_ID,
    direction: 'inbound', sender_type: 'customer', message_text: text, created_at: createdAt, raw_payload: options.inboundMedia || {}, service: 'sales_qualification',
  });
  const queueRow = existing;
  const messages = options.resume ? existing.claimed : [{ id: eventId, event_id: eventId, text, direction: 'inbound', created_at: createdAt }];
  // magia_claim_turn leaves the queue in `processing` with a tracked batch and the tenant's retry policy
  // (3 attempts, 30s base, 900s cap: read from production, config table only).
  const claimed = { token, phase: 'processing', boundary_id: boundary, claimed: messages, pending: [], retry_batch_id: 'sim-batch-' + (index + 1), attempt_count: 1,
    retry_max_attempts: 3, retry_base_seconds: 30, retry_cap_seconds: 900, current_delivery_id: null, next_attempt_at: null, last_error_code: null, review_required_at: null,
    claimed_at: new Date().toISOString(), lease_until: new Date(Date.now() + 600000).toISOString() };
  if (options.resume) { /* the claim was made by magia_claim_turn */ }
  else if (queueRow) Object.assign(queueRow, claimed);
  else world.tables.conversation_turn_queue.push({ tenant_id: TENANT_ID, channel_type: 'whatsapp', chat_id: CHAT_ID, ...claimed });
  const turn = { claimed: true, token, boundary_id: boundary, messages, contract: 'noria_turn_lifecycle_v1' };
  const base = { tenant_slug: TENANT_SLUG, tenant_id: TENANT_ID, instance: INSTANCE, remoteJid: CHAT_ID, noria_extension: 'genesis', contactName: 'Cliente Homolog', messageId: eventId, messageText: text };
  // The version reaching the EXT identity comes from the workflow router node (options.routerVersion overrides it for an earlier publication).
  const routerVersion = options.routerVersion || await routerContractVersion();
  let verified, requestId, bootstrap, businessContext;
  try {
    const identity = await runNode(IDENTITY_FILE, { json: { ...base, noria_contract_version: routerVersion }, world });
    verified = identity.noria_verified_settings;
    // Bootstrap: the EXT builds the business context the CORE validates before the model is consulted.
    requestId = 'homolog:' + token;
    const dispatch = { tenant_id: TENANT_ID, tenant_slug: TENANT_SLUG, session_id: boundary, request_id: requestId, turn: { token, boundary_id: boundary, grouped_messages: messages } };
    bootstrap = await runNode(EXT_FILE, { json: { ...base, noria_extension: 'genesis', noria_contract_version: routerVersion, noria_verified_settings: verified, operation: 'conversation.evaluate', payload: dispatch }, world });
    businessContext = bootstrap.noria_business_context;
  } catch (extError) {
    if (!options.continueOnExtError) throw extError;
    // The Execute Workflow node is set to onError=continueRegularOutput: the CORE node receives the item carrying the error.
    // ASSUMPTION (not verifiable offline): the item keeps the dispatch context and adds an error field.
    const failed = await runNode(CORE_FILE, { json: { ...base, noria_contract_version: routerVersion, noria_phase: 'prepare', noria_preclaimed_turn: turn, error: String(extError.message || extError) }, phase: 'prepare', world });
    return { ext_error: String(extError.message || extError), intermediate: failed, finalized: failed };
  }
  // CORE prepare: sales context, the Gemini call (the real prompt and schema), the semantic validation and the plan.
  const intermediate = await runNode(CORE_FILE, {
    json: { ...base, noria_contract_version: GENESIS_CONTRACT_VERSION, noria_phase: 'prepare', noria_preclaimed_turn: turn, noria_business_context: businessContext, noria_verified_settings: verified, noria_client_policy: bootstrap.noria_client_policy },
    phase: 'prepare', world,
  });
  if (intermediate.skipped) return { skipped: intermediate.reason || 'skipped', intermediate: null };
  // EXT commercial decision on the validated contract, with the EXT's own authorised inventory.
  const decided = await runNode(EXT_FILE, {
    json: { ...intermediate, noria_verified_settings: verified, noria_client_policy: bootstrap.noria_client_policy, noria_phase: 'commercial_decision', operation: 'commercial.decide' }, world,
  });
  // CORE finalise: persistence through the simulated RPCs, delivery through the simulated provider, then the auditor.
  // The hook exists for the checks only: it lets a check present a decision the CORE must refuse.
  const decisionForCore = options.tamperDecision ? options.tamperDecision(decided) : decided;
  const finalized = await runNode(CORE_FILE, { json: { ...decisionForCore }, phase: 'finalize', world });
  return { intermediate, decided, finalized, sim_request_id: requestId, verified };
}

// ---------------------------------------------------------------------------------------------------------------------
// Scenario runner. A scenario is a short dialogue with canned Gemini answers (fixtures) and expectations on the
// observed effects, read back from the simulated tables. The expectations are on effects, not on the code.
// ---------------------------------------------------------------------------------------------------------------------

function observed(world) {
  const lead = world.tables.sales_leads[0] || null;
  const outbound = world.tables.channel_events.filter(row => row.direction === 'outbound').map(row => row.message_text);
  return {
    lead_state_intent: lead?.state?.intent ?? null,
    lead_state_transaction_mode: lead?.state?.transaction_mode ?? null,
    lead_product_id: lead?.state?.product_id ?? null,
    lead_stage: lead?.stage_key ?? null,
    lead_interest_registered: lead?.interest_registered ?? false,
    follow_up_disposition: lead?.state?.follow_up_disposition ?? null,
    simulated_sends: world.log.simulated_sends.length,
    simulated_media: world.log.simulated_media.map(item => item.media),
    outbound_texts: outbound,
    follow_up_calls_blocked: world.log.blocked.filter(item => /followups/.test(item.rpc)).map(item => item.rpc),
    delivery_confirmed: world.tables.conversation_turn_delivery_attempts.some(row => row.status === 'confirmed'),
    turn_failures: world.log.failures.map(item => item.error),
    events: world.tables.channel_events.map(row => ({ dir: row.direction, provider: row.ai_provider || null, service: row.service || null, error: row.ai_error || null, text: String(row.message_text || '').slice(0, 60), payload_keys: Object.keys(row.raw_payload || {}).slice(0, 12) })),
  };
}

// What the model interpreted for one turn, compact. Only contract fields; no customer text, no key.
function interpretationSince(world, from) {
  return world.log.gemini_responses.slice(from).map(item => {
    let body = null;
    try { body = JSON.parse(item.parsed?.candidates?.[0]?.content?.parts?.[0]?.text || 'null'); } catch { body = null; }
    if (!body) return { primary: item.primary, unparsed: true };
    if (!item.primary) return { auditor: { ok: body.ok ?? null, issues: body.issues || [] } };
    const si = body.semantic_intent || {};
    return { primary: true, primary_intent: si.primary_intent ?? null, topics: si.topics || [], catalog_requested: si.catalog?.requested ?? null,
      customer_disposition: si.customer_disposition?.value ?? null, product_role: si.references?.product_role ?? null,
      product_ids: si.references?.mentioned_product_ids || [], offer_response: si.offer_response?.value ?? null,
      customer_vehicle_purpose: si.customer_vehicle?.purpose ?? null, human_requested: body.dialogue_plan?.human_requested ?? null,
      action: body.action ?? null, confidence: si.confidence ?? null };
  });
}

async function runScenario(scenario, { mode, geminiKey, settings, inventory, images = [], seed = null, turnOptions = {}, providerFaultFor = null, rpcOverrides = null, storageObjects = {}, geminiOverride = null }) {
  const world = createWorld({ mode, geminiKey, settings, inventory, images, providerFaultFor, rpcOverrides, storageObjects, scenarioResponses: { primary: scenario.turns.map(turn => cannedPrimaryBody(turn.gemini || {})), other: scenario.auditor_responses || [] } });
  world.geminiOverride = geminiOverride;
  if (seed) seed(world);
  const steps = [];
  let responsesSeen = 0;
  try {
    for (let index = 0; index < scenario.turns.length; index += 1) {
      const text = scenario.turns[index].text;
      const outcome = await runCustomerTurn(world, text, index, { ...turnOptions, inboundMedia: scenario.turns[index].inbound_media || turnOptions.inboundMedia });
      const f = outcome.finalized || {};
      steps.push({ customer: text, state: observed(world), final: { ok: f.ok ?? null, keys: Object.keys(f).slice(0, 30), cancelled: f.cancelled ?? null, reason: f.reason ?? null, silent: f.silent ?? null, review: f.review_required ?? null, error_code: f.error_code ?? null, delivery_ok: f.delivery_ok ?? null }, finalized_ok: outcome.finalized?.ok ?? null, skipped: outcome.skipped || null,
        error_code: outcome.finalized?.error_code ?? null, decision_status: outcome.decided?.commercial_decision_status ?? null,
        ...(mode === 'real' ? { interpretation: interpretationSince(world, responsesSeen), reply: world.log.simulated_sends.at(-1)?.text ?? null } : {}) });
      responsesSeen = world.log.gemini_responses.length;
      if (outcome.skipped) break;
    }
  } catch (error) {
    const where = process.env.HOMOLOG_DEBUG ? String(error.stack).split('\n').slice(0, 6).join(' | ') : undefined;
    steps.push({ stopped: String(error.message || error).slice(0, 240), where });
  }
  // Dry mode stops at the first Gemini request: there is no answer to judge, so no expectation is evaluated.
  const failures = [];
  if (mode !== 'dry') {
    for (const [key, expected] of Object.entries(scenario.expect || {})) {
      const got = steps.at(-1)?.state?.[key];
      if (JSON.stringify(got) !== JSON.stringify(expected)) failures.push(key + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(got));
    }
  }
  const recorded = mode === 'dry' ? world.log.gemini.map(item => ({ model: item.model, schema_properties: item.schema_properties, request_chars: JSON.stringify(item.body).length })) : [];
  return { name: scenario.name, steps, failures, recorded, gemini_requests: world.log.gemini.length, missing: world.log.missing, world };
}

function loadSettings() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'genesis_settings_synthetic.json'), 'utf8'));
}

// Everything the isolated real run needs, checked without any network call. Returns one row per requirement.
function homologationReadiness(args) {
  const env = process.env, rows = [];
  const add = (requirement, ok, detail) => rows.push({ requirement, ok: Boolean(ok), detail });
  add('authorization flag HOMOLOG_GEMINI_AUTHORIZED=1', env.HOMOLOG_GEMINI_AUTHORIZED === '1', env.HOMOLOG_GEMINI_AUTHORIZED === '1' ? 'set' : 'not set');
  const key = env.HOMOLOG_GEMINI_KEY || '';
  add('dedicated homologation key HOMOLOG_GEMINI_KEY', Boolean(key), key ? 'present (value never printed)' : 'missing');
  // The key must not be any key this project already uses: the process environment or the repository .env.
  let dotenvKey = '';
  try { dotenvKey = (fs.readFileSync(path.join(root, '.env'), 'utf8').match(/^GEMINI_API_KEY=(.*)$/m) || [])[1] || ''; } catch { dotenvKey = ''; }
  const projectKeys = [env.GEMINI_API_KEY, dotenvKey.trim().replace(/^["']|["']$/g, '')].filter(Boolean);
  const reused = Boolean(key) && projectKeys.includes(key);
  add('homologation key differs from GEMINI_API_KEY (environment and .env)', Boolean(key) && !reused, reused ? 'IDENTICAL to a project key: refused' : (key ? 'distinct' : 'not evaluated'));
  let settings = null;
  const settingsPath = env.HOMOLOG_SETTINGS_SNAPSHOT;
  try { settings = settingsPath ? JSON.parse(fs.readFileSync(settingsPath, 'utf8')) : null; } catch { settings = null; }
  add('settings snapshot HOMOLOG_SETTINGS_SNAPSHOT (authorised read-only export of the Gênesis settings)',
    settings && settings.conversation_capability === 'sales_v1' && settings.whatsapp_processing_mode === 'conversation_core_v1',
    settings ? 'readable; capability ' + settings.conversation_capability : (settingsPath ? 'unreadable' : 'missing'));
  let inventory = null;
  const inventoryPath = env.HOMOLOG_INVENTORY_SNAPSHOT;
  try { inventory = inventoryPath ? JSON.parse(fs.readFileSync(inventoryPath, 'utf8')) : null; } catch { inventory = null; }
  const shaped = Array.isArray(inventory) && inventory.length > 0 && inventory.every(item => item && item.id && item.brand && item.model && 'status' in item && 'price_cents' in item);
  add('inventory snapshot HOMOLOG_INVENTORY_SNAPSHOT (authorised export: id, brand, model, year, status, price_cents, ...)', shaped,
    shaped ? inventory.length + ' vehicles' : (inventoryPath ? 'unreadable or wrong shape' : 'missing'));
  let images = null;
  const imagesPath = env.HOMOLOG_IMAGES_SNAPSHOT;
  try { images = imagesPath ? JSON.parse(fs.readFileSync(imagesPath, 'utf8')) : null; } catch { images = null; }
  const photosEnabled = [settings?.sales?.whatsapp_catalog_photo_enabled, settings?.sales?.vehicle_photos_enabled].some(value => value === true || value === 'true');
  const imagesShaped = Array.isArray(images) && images.every(item => item && item.vehicle_id && item.storage_bucket && item.storage_path && item.sha256 && item.mime_type);
  add('image registry snapshot HOMOLOG_IMAGES_SNAPSHOT (authorised metadata; required when the tenant enables photos)', !photosEnabled || (imagesShaped && images.length > 0),
    !photosEnabled ? 'tenant photos disabled: not required' : (imagesShaped ? images.length + ' image rows' : (imagesPath ? 'unreadable or wrong shape' : 'missing: photo authorisation cannot be exercised')));
  const dialoguesPath = args.scenarios || path.join(__dirname, 'fixtures', 'genesis_dialogues.json');
  let dialogues = null;
  try { dialogues = JSON.parse(fs.readFileSync(dialoguesPath, 'utf8')); } catch { dialogues = null; }
  const list = dialogues ? (dialogues.scenarios || dialogues.dialogues || []) : [];
  add('dialogues file', list.length > 0 && list.every(item => Array.isArray(item.turns) && item.turns.length > 0), list.length + ' dialogues, ' + list.reduce((n, item) => n + item.turns.length, 0) + ' turns');
  let declarations = true, declarationDetail = 'present';
  try { for (const file of [CORE_FILE, EXT_FILE, IDENTITY_FILE]) assertDeclarations(file); } catch (error) { declarations = false; declarationDetail = String(error.message).slice(0, 120); }
  add('CORE and EXT declarations the executor depends on', declarations, declarationDetail);
  // Isolation is structural: Supabase and Evolution are simulated hosts and every host except Gemini generateContent is blocked.
  add('Supabase and Evolution isolated (simulated hosts, other hosts blocked)', true, 'structural: see makeHttpRequest');
  return rows;
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split('=')));
  const mode = args.mode || 'fixtures';
  if (!['fixtures', 'dry', 'real'].includes(mode)) throw new Error('unknown mode ' + mode);
  if (Object.prototype.hasOwnProperty.call(args, 'preflight')) {
    const rows = homologationReadiness(args);
    for (const row of rows) console.log((row.ok ? 'OK      ' : 'MISSING ') + row.requirement + '  [' + row.detail + ']');
    const ready = rows.every(row => row.ok);
    console.log('\n' + (ready ? 'Ready for the isolated real run.' : 'NOT ready: the real run stays blocked.') + ' No network call was made.');
    process.exitCode = ready ? 0 : 3;
    return;
  }
  let geminiKey = null, inventorySnapshot = null, imagesSnapshot = [];
  if (mode === 'real') {
    const blocking = homologationReadiness(args).filter(row => !row.ok);
    if (blocking.length) {
      const first = blocking[0].requirement;
      const code = /AUTHORIZED/.test(first) ? 'REAL_MODE_NOT_AUTHORIZED' : /differs/.test(first) ? 'REAL_MODE_KEY_REFUSED' : /HOMOLOG_GEMINI_KEY/.test(first) ? 'REAL_MODE_KEY_MISSING'
        : /settings/.test(first) ? 'REAL_MODE_SNAPSHOT_MISSING' : /inventory/.test(first) ? 'REAL_MODE_INVENTORY_MISSING' : /image/.test(first) ? 'REAL_MODE_IMAGES_MISSING' : 'REAL_MODE_NOT_READY';
      throw new Error(code + ': ' + blocking.map(row => row.requirement + ' [' + row.detail + ']').join('; '));
    }
    geminiKey = process.env.HOMOLOG_GEMINI_KEY;
    inventorySnapshot = JSON.parse(fs.readFileSync(process.env.HOMOLOG_INVENTORY_SNAPSHOT, 'utf8'));
    if (process.env.HOMOLOG_IMAGES_SNAPSHOT) imagesSnapshot = JSON.parse(fs.readFileSync(process.env.HOMOLOG_IMAGES_SNAPSHOT, 'utf8'));
  }
  // Dry mode may also run over the authorised snapshots (no key needed): it records the exact requests and sends nothing.
  const dryOnSnapshots = mode === 'dry' && Boolean(process.env.HOMOLOG_SETTINGS_SNAPSHOT && process.env.HOMOLOG_INVENTORY_SNAPSHOT);
  if (dryOnSnapshots) {
    inventorySnapshot = JSON.parse(fs.readFileSync(process.env.HOMOLOG_INVENTORY_SNAPSHOT, 'utf8'));
    if (process.env.HOMOLOG_IMAGES_SNAPSHOT) imagesSnapshot = JSON.parse(fs.readFileSync(process.env.HOMOLOG_IMAGES_SNAPSHOT, 'utf8'));
  }
  for (const file of [CORE_FILE, EXT_FILE, IDENTITY_FILE]) assertDeclarations(file);
  const settings = (mode === 'real' || dryOnSnapshots) ? JSON.parse(fs.readFileSync(process.env.HOMOLOG_SETTINGS_SNAPSHOT, 'utf8')) : loadSettings();
  const file = JSON.parse(fs.readFileSync(args.scenarios || path.join(__dirname, 'fixtures', 'genesis_scenarios.json'), 'utf8'));
  // The dialogues carry no canned model answers. A fixtures run over them would pass without interpreting anything.
  if (mode === 'fixtures' && !file.scenarios) throw new Error('DIALOGUES_REQUIRE_A_MODEL: use --mode=dry (records the requests) or --mode=real (authorised)');
  const results = [];
  // --only=3 runs just the dialogue whose name starts with "3 ": a gradual start, one conversation at a time.
  const selected = (file.scenarios || file.dialogues).filter(item => args.only === undefined || item.name.startsWith(String(args.only) + ' '));
  if (!selected.length) throw new Error('NO_DIALOGUE_MATCHES_ONLY=' + args.only);
  for (const scenario of selected) {
    const result = await runScenario(scenario, { mode, geminiKey, settings, inventory: inventorySnapshot || file.inventory, images: imagesSnapshot });
    results.push(result);
    if (mode === 'dry') {
      console.log('DRY ' + result.name + '  (recorded Gemini requests: ' + result.recorded.length + ')');
      for (const request of result.recorded) console.log('    ' + JSON.stringify(request));
      if (result.steps.at(-1)?.stopped) console.log('    stopped after recording: ' + result.steps.at(-1).stopped);
      continue;
    }
    console.log((result.failures.length ? 'FAIL ' : 'PASS ') + result.name + '  (gemini requests: ' + result.gemini_requests + ')');
    for (const step of result.steps) console.log('    ' + JSON.stringify(step).slice(0, mode === 'real' ? 1600 : 600));
    for (const failure of result.failures) console.log('    ! ' + failure);
    if (result.missing.length) console.log('    missing dependencies: ' + result.missing.join(', '));
  }
  const failed = results.filter(result => result.failures.length).length;
  if (mode === 'dry') console.log('\n' + results.length + ' dialogues recorded up to the first Gemini request. Nothing was sent.');
  else console.log('\n' + (results.length - failed) + '/' + results.length + ' scenarios match (mode: ' + mode + ').');
  if (args.out) fs.writeFileSync(args.out, JSON.stringify(results.map(({ world, ...rest }) => rest), null, 2));
  process.exitCode = failed ? 1 : 0;
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 2; });
module.exports = { homologationReadiness, routerContractVersion, ROUTER_NODE, CORE_WORKFLOW_FILE, runNode, createWorld, makeHttpRequest, assertDeclarations, observed, runCustomerTurn, runScenario, sourceRootFor, cannedPrimaryBody, loadSettings, REQUIRED_DECLARATIONS, RPC, TENANT_ID, CHAT_ID, CORE_FILE, EXT_FILE, IDENTITY_FILE, GENESIS_CONTRACT_VERSION };

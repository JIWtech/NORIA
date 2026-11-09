// Harness dos testes de disparo no servidor: PGlite com as migrações reais, um mini-PostgREST
// (só as rotas que o worker usa) e um provedor de envio falso. Nada sai para a rede.
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(path.join(
  process.env.MAGIA_TEST_MODULES || path.join(require('node:os').tmpdir(), 'magia-diag-tools/node_modules'),
  '@electric-sql/pglite'
));

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const BROADCAST_MIGRATIONS = [
  'supabase/migrations/010_broadcasts_and_appointments.sql',
  'supabase/migrations/023_broadcast_campaign_controls.sql',
  'supabase/migrations/20261109192247_broadcast_production_alignment.sql',
  'supabase/migrations/20261109192323_broadcast_server_dispatch.sql',
];
const OPTIONAL_MIGRATIONS = [
  'supabase/migrations/20261109192353_broadcast_number_protection.sql',
  'supabase/migrations/20261109192425_broadcast_opt_out.sql',
  'supabase/migrations/20261109200000_broadcast_opt_out_detection.sql',
];

const SUPABASE_URL = 'https://db.test';
const SERVICE_KEY = 'service-key-test';

const TENANT_A = { id: '11111111-1111-1111-1111-111111111111', slug: 'salao_a', instance: 'inst-a' };
const TENANT_B = { id: '22222222-2222-2222-2222-222222222222', slug: 'loja_b', instance: 'inst-b' };
const MEMBER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MEMBER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

async function bootstrap() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table tenants(id uuid primary key, slug text, status text default 'active', deleted_at timestamptz);
    create table tenant_members(tenant_id uuid, user_id uuid, role text, status text);
    create table tenant_settings(id uuid primary key default gen_random_uuid(), tenant_id uuid unique, timezone text, settings jsonb default '{}');
    create table channels(id uuid primary key default gen_random_uuid(), tenant_id uuid, type text, external_id text, status text);
    create table appointments(id uuid primary key default gen_random_uuid(), tenant_id uuid, starts_at timestamptz);
    create table channel_events(
      id uuid primary key default gen_random_uuid(), tenant_id uuid, tenant_slug text, channel_type text,
      external_conversation_id text, external_message_id text, direction text, sender_type text, contact_name text,
      message_text text, service text, stage text, handoff boolean, response_text text, raw_payload jsonb,
      ai_provider text, ai_model text, delivery_status text, command_id text, sent_by_user text,
      created_at timestamptz default clock_timestamp());
    create publication supabase_realtime;
    -- Stand-in da cota de Gemini do tenant (mesma assinatura de produção); test_gemini_quota controla a resposta.
    create table test_gemini_quota(allowed boolean not null default true, calls integer not null default 0);
    insert into test_gemini_quota default values;
    create function magia_gemini_reserve(p_tenant_id uuid, p_daily_limit integer, p_model text, p_lease_id text, p_estimated_tokens integer,
      p_scope text default null, p_max_concurrent integer default null, p_max_rpm integer default null, p_max_tpm integer default null,
      p_max_rpd integer default null, p_lease_ttl_ms integer default null, p_probe_cooldown_ms integer default null)
    returns jsonb language plpgsql as $$
    begin
      update test_gemini_quota set calls = calls + 1;
      return case when (select allowed from test_gemini_quota) then '{"allowed": true}'::jsonb else '{"allowed": false, "reason": "daily_limit"}'::jsonb end;
    end $$;
    create function magia_gemini_release(p_scope text, p_model text, p_lease_id text, p_outcome text, p_cooldown_ms integer default 30000)
    returns jsonb language sql as $$ select '{"ok": true}'::jsonb $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    insert into auth.users values ('${MEMBER_A}'), ('${MEMBER_B}');
    insert into tenants(id, slug) values ('${TENANT_A.id}', '${TENANT_A.slug}'), ('${TENANT_B.id}', '${TENANT_B.slug}');
    insert into tenant_members values ('${TENANT_A.id}', '${MEMBER_A}', 'agent', 'active'), ('${TENANT_B.id}', '${MEMBER_B}', 'owner', 'active');
    insert into tenant_settings(tenant_id, timezone, settings) values ('${TENANT_A.id}', 'America/Sao_Paulo', '{"ai_model": "gemini-test"}'), ('${TENANT_B.id}', 'America/Sao_Paulo', '{"ai_model": "gemini-test"}');
    insert into channels(tenant_id, type, external_id, status) values
      ('${TENANT_A.id}', 'whatsapp', '${TENANT_A.instance}', 'active'), ('${TENANT_B.id}', 'whatsapp', '${TENANT_B.instance}', 'active');
  `);
  for (const file of BROADCAST_MIGRATIONS) await db.exec(read(file).replace(/notify pgrst[^;]*;/g, ''));
  for (const file of OPTIONAL_MIGRATIONS) if (fs.existsSync(path.join(root, file))) await db.exec(read(file).replace(/notify pgrst[^;]*;/g, ''));
  await db.exec(`grant select, insert, update on all tables in schema public to authenticated, service_role;`);
  return db;
}

async function asUser(db, uid, sql, params = []) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`);
  try { return await db.query(sql, params); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}

async function setSettings(db, tenant, broadcast) {
  await db.query(`update tenant_settings set settings = jsonb_set(coalesce(settings, '{}'), '{broadcast}', $2::jsonb) where tenant_id = $1`,
    [tenant.id, JSON.stringify(broadcast)]);
}

async function createCampaign(db, { tenant = TENANT_A, member = MEMBER_A, contacts = 2, text = 'Oi {nome}, novidades!', enqueue = true, scheduledAt = null } = {}) {
  const { rows: [campaign] } = await db.query(
    `insert into broadcast_campaigns(tenant_id, name, channel_type, message_text, status, created_by)
     values ($1, 'Campanha teste', 'whatsapp', $2, 'draft', $3) returning id`, [tenant.id, text, member]);
  for (let i = 0; i < contacts; i += 1) {
    const external = '552199000' + String(i).padStart(4, '0');
    await db.query(
      `insert into broadcast_campaign_recipients(tenant_id, campaign_id, channel_type, external_conversation_id, contact_name, idempotency_key, created_at)
       values ($1, $2, 'whatsapp', $3, $4, $5, now() + make_interval(secs => $6))`,
      [tenant.id, campaign.id, external, 'Contato ' + i, 'bcast:' + campaign.id + ':' + external, i]);
  }
  await db.query(`update broadcast_campaigns set total_recipients = $2 where id = $1`, [campaign.id, contacts]);
  if (enqueue) {
    await asUser(db, member, `select broadcast_enqueue_campaign($1, $2, true) as r`, [campaign.id, scheduledAt]);
  }
  return campaign.id;
}

// Mini-PostgREST: só as formas de URL que o worker usa. Filtros sempre parametrizados.
function createPostgrest(db) {
  const calls = [];
  async function rpc(name, body) {
    const { rows: [fn] } = await db.query(`select proretset from pg_proc where proname = $1`, [name]);
    if (!fn) throw Object.assign(new Error('rpc inexistente: ' + name), { statusCode: 404 });
    const keys = Object.keys(body || {});
    const args = keys.map((key, index) => key + ' => $' + (index + 1)).join(', ');
    const values = keys.map(key => (body[key] !== null && typeof body[key] === 'object') ? JSON.stringify(body[key]) : body[key]);
    const { rows } = await db.query(`select to_jsonb(r) as row from ${name}(${args}) r`, values);
    if (fn.proretset) return rows.map(row => row.row);
    const value = rows[0]?.row;
    return value && typeof value === 'object' && !Array.isArray(value) && name in value && Object.keys(value).length === 1 ? value[name] : value;
  }
  async function select(table, params) {
    const where = []; const values = []; let limit = ''; let order = '';
    const columns = params.get('select') || '*';
    for (const [key, raw] of params.entries()) {
      if (key === 'select') continue;
      if (key === 'limit') { limit = ' limit ' + Number(raw); continue; }
      if (key === 'order') { const [col, dir] = raw.split('.'); order = ` order by ${col} ${dir === 'desc' ? 'desc' : 'asc'}`; continue; }
      const [op, ...rest] = raw.split('.'); const value = rest.join('.');
      if (op === 'eq') { values.push(value); where.push(`${key}::text = $${values.length}`); }
      else if (op === 'in') { const list = value.replace(/^\(|\)$/g, '').split(','); values.push(list); where.push(`${key}::text = any($${values.length})`); }
      else if (op === 'gte') { values.push(value); where.push(`${key} >= $${values.length}`); }
      else throw new Error('filtro nao suportado no harness: ' + key + '=' + raw);
    }
    const sql = `select to_jsonb(t) as row from (select ${columns} from ${table}${where.length ? ' where ' + where.join(' and ') : ''}${order}${limit}) t`;
    const { rows } = await db.query(sql, values);
    return rows.map(row => row.row);
  }
  async function insert(table, body) {
    const rows = Array.isArray(body) ? body : [body];
    const out = [];
    for (const row of rows) {
      const cols = Object.keys(row).filter(key => /^[a-z_]+$/.test(key)).join(', ');
      const { rows: [inserted] } = await db.query(
        `insert into ${table} (${cols}) select ${cols} from jsonb_populate_record(null::${table}, $1::jsonb) returning to_jsonb(${table}.*) as row`,
        [JSON.stringify(row)]);
      out.push(inserted.row);
    }
    return out;
  }
  async function handle(options) {
    const url = new URL(options.url);
    if (options.headers?.apikey !== SERVICE_KEY) throw Object.assign(new Error('unauthorized'), { statusCode: 401 });
    const route = url.pathname.replace(/^\/rest\/v1\//, '');
    calls.push({ method: options.method, route, query: url.search, body: options.body });
    if (route.startsWith('rpc/')) return rpc(route.slice(4), options.body);
    if (options.method === 'GET') return select(route, url.searchParams);
    if (options.method === 'POST') return insert(route, options.body);
    throw new Error('rota nao suportada no harness: ' + options.method + ' ' + route);
  }
  return { handle, calls };
}

// Provedor de envio falso. `respond(request)` devolve { statusCode, body } ou lança erro de transporte.
function createProvider(respond) {
  const sent = [];
  async function handle(options) {
    const request = { url: options.url, headers: options.headers, body: options.body };
    sent.push(request);
    return respond ? respond(request, sent.length) : { statusCode: 201, body: { key: { id: 'wamid-' + sent.length } } };
  }
  return { handle, sent };
}

function envFor(extra = {}) {
  const env = { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, BROADCAST_WORKER_BUDGET_SECONDS: '0', GEMINI_API_KEY: 'gemini-key-test' };
  for (const tenant of [TENANT_A, TENANT_B]) {
    const suffix = tenant.slug.toUpperCase();
    env['EVOLUTION_API_URL_' + suffix] = 'https://evo.test/' + tenant.slug;
    env['EVOLUTION_API_KEY_' + suffix] = 'key-' + tenant.slug;
    env['EVOLUTION_INSTANCE_' + suffix] = tenant.instance;
  }
  return { ...env, ...extra };
}

// Gemini falso: decide(input) devolve o objeto estruturado { requested, evidence_ids } ou lança erro.
function createGemini(decide) {
  const calls = [];
  async function handle(options) {
    const input = JSON.parse(options.body.contents[0].parts[0].text);
    calls.push({ url: options.url, headers: options.headers, body: options.body, input });
    const value = decide ? await decide(input, calls.length) : { requested: false, evidence_ids: [] };
    return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }], usageMetadata: { totalTokenCount: 10 } };
  }
  return { handle, calls };
}

async function runWorker(db, { provider = createProvider(), env = envFor(), postgrest = createPostgrest(db), gemini = createGemini() } = {}) {
  const code = read('n8n/code/broadcast_campaign_worker.js');
  const helpers = {
    async httpRequest(options) {
      if (options.url.startsWith(SUPABASE_URL)) {
        const body = await postgrest.handle(options);
        return options.returnFullResponse ? { statusCode: 200, body } : body;
      }
      if (options.url.startsWith('https://generativelanguage.googleapis.com/')) return gemini.handle(options);
      const response = await provider.handle(options);
      if (options.returnFullResponse) return response;
      if (response.statusCode >= 400) throw Object.assign(new Error('HTTP ' + response.statusCode), { httpCode: String(response.statusCode) });
      return response.body;
    },
  };
  const items = await new AsyncFunction('$env', '$json', code).call({ helpers }, env, {});
  return { items: (items || []).map(item => item.json), provider, postgrest, gemini };
}

module.exports = {
  bootstrap, asUser, setSettings, createCampaign, createPostgrest, createProvider, createGemini, envFor, runWorker, read,
  TENANT_A, TENANT_B, MEMBER_A, MEMBER_B,
};

// PostgreSQL isolado via PGlite instalado fora do repositório. PGLITE_PATH aponta ao pacote.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_PATH
  || path.join(process.env.MAGIA_TEST_MODULES || path.join(__dirname, '../app/node_modules'), '@electric-sql/pglite'));
const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations_pending_review/slot_proposal_v1.sql'), 'utf8');
const rollback = fs.readFileSync(path.join(__dirname, '../supabase/migrations_pending_review/slot_proposal_v1_rollback.sql'), 'utf8');
const enableFlags = fs.readFileSync(path.join(__dirname, '../clients/ic_saloon/14_proposta_slot_proposal_settings.sql'), 'utf8');
const rollbackFlags = fs.readFileSync(path.join(__dirname, '../clients/ic_saloon/14_proposta_slot_proposal_settings_rollback.sql'), 'utf8');
const tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', a = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const b = 'cccccccc-cccc-cccc-cccc-cccccccccccc', turn = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

test('RPCs isolam conversa, serializam propostas, validam turno e reabrem somente pendente', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table tenants(id uuid,slug text);
      create table tenant_settings(tenant_id uuid, timezone text, settings jsonb, updated_at timestamptz default now());
      create table appointments(id uuid primary key, tenant_id uuid, channel_type text, external_conversation_id text,
        status text, starts_at timestamptz, ends_at timestamptz, metadata jsonb, updated_at timestamptz);
      create unique index one_open on appointments(tenant_id,channel_type,external_conversation_id) where status='pending_confirmation';
      create table channel_events(id uuid primary key,tenant_id uuid,channel_type text,external_conversation_id text,
        direction text,sender_type text,created_at timestamptz);
      insert into tenants values('${tenant}','ic_salon');
      insert into tenant_settings(tenant_id,timezone,settings) values('${tenant}','America/Sao_Paulo', '{"appointment_request":{"mode":"operator_confirmation"}}');
      insert into appointments values('${a}','${tenant}','whatsapp','chat','pending_confirmation','2099-01-01 13:00Z','2099-01-01 14:00Z', '{"request_version":1}',now());`);
    await db.exec(enableFlags);
    await assert.rejects(() => db.exec(enableFlags), /FLAGS_PRESENT/);
    await db.exec('rollback');
    await db.exec(migration);
    const rpc = async (name, values) => (await db.query(`select ${name}(${values.map((_, i) => '$' + (i + 1)).join(',')}) as result`, values)).rows[0].result;
    const prep = (id, proposal, version = 1) => rpc('magia_slot_proposal_prepare', [tenant, 'whatsapp', 'chat', id, version, proposal, '2099-02-01', '11:30', 'Eco']);
    const finalize = (id, proposal) => rpc('magia_slot_proposal_finalize', [tenant, 'whatsapp', 'chat', id, proposal, 'provider-id']);
    const resolve = (id, proposal, decision = 'accept', event = turn) => rpc('magia_slot_proposal_resolve', [tenant, 'whatsapp', 'chat', id, proposal, decision, event]);
    const first = await prep(a, 'p1');
    assert.equal(first.proposal.status, 'sending');
    assert.equal(first.proposal.starts_at, '2099-02-01T14:30:00+00:00');
    assert.equal((await prep(a, 'p1')).already, true);
    await assert.rejects(() => resolve(a, 'p1'), /NOT_SENT/);
    await assert.rejects(() => prep(a, 'different'), /CHANGED/);
    assert.equal((await finalize(a, 'p1')).appointment.status, 'cancelled');
    assert.equal((await finalize(a, 'p1')).already, true);
    await db.exec(`insert into channel_events values('${turn}','${tenant}','whatsapp','chat','inbound','contact',clock_timestamp() - interval '1 hour')`);
    await assert.rejects(() => resolve(a, 'p1'), /INVALID_TURN/);
    await db.exec(`update channel_events set created_at=clock_timestamp()+interval '1 second' where id='${turn}'`);
    await assert.rejects(() => rpc('magia_slot_proposal_resolve', [tenant,'whatsapp','other',a,'p1','accept',turn]), /SCOPE/);
    const accepted = await resolve(a, 'p1');
    assert.equal(accepted.appointment.status, 'pending_confirmation');
    assert.equal(accepted.appointment.metadata.request_version, 2);
    assert.equal(accepted.appointment.metadata.requested_time, '11:30');
    assert.equal((await resolve(a, 'p1')).already, true);
    await assert.rejects(() => resolve(a, 'p1', 'reject'), /ALREADY_RESOLVED/);
    await db.exec(`update appointments set status='cancelled' where id='${a}';
      insert into appointments values('${b}','${tenant}','whatsapp','chat','pending_confirmation','2099-01-02 13:00Z',null,'{"request_version":1}',now());`);
    await prep(b, 'p2'); await finalize(b, 'p2');
    await db.exec(`update appointments set status='pending_confirmation',metadata='{"request_version":3}' where id='${a}'`);
    await prep(a, 'p3', 3);
    await assert.rejects(() => resolve(b, 'p2'), /NOT_SENT/);
    await finalize(a, 'p3');
    const rejected = await resolve(a, 'p3', 'reject');
    assert.equal(rejected.appointment.status, 'cancelled');
    await db.exec(`update appointments set status='pending_confirmation',metadata='{"request_version":4}' where id='${a}'`);
    await prep(a, 'p4', 4);
    const reconcile = (resolution, messageId = null) => rpc('magia_slot_proposal_reconcile', [tenant,'whatsapp','chat',a,'p4',resolution,tenant,messageId]);
    await assert.rejects(() => reconcile('not_delivered'), /CHANGED/);
    assert.equal((await rpc('magia_slot_proposal_mark_uncertain',[tenant,'whatsapp','chat',a,'p4'])).proposal.status, 'uncertain');
    await assert.rejects(() => reconcile('not_delivered', 'id-indevido'), /INVALID/);
    assert.equal((await reconcile('not_delivered')).proposal.status, 'not_delivered');
    assert.equal((await reconcile('not_delivered')).already, true);
    await assert.rejects(() => reconcile('delivered','provider-id'), /CHANGED/);
    await prep(a, 'p5', 4);
    await rpc('magia_slot_proposal_mark_uncertain',[tenant,'whatsapp','chat',a,'p5']);
    const delivered = await rpc('magia_slot_proposal_reconcile',[tenant,'whatsapp','chat',a,'p5','delivered',tenant,'real-id']);
    assert.equal(delivered.proposal.status, 'sent');
    assert.equal(delivered.proposal.reconciliation.actor, tenant);
    await db.exec(rollbackFlags);
    assert.equal((await db.query(`select settings->'appointment_request' ? 'slot_proposal_enabled' as enabled from tenant_settings`)).rows[0].enabled, false);
    await db.exec(rollback);
    await assert.rejects(() => prep(a, 'p4'), /does not exist/);
  } finally { await db.close(); }
});

test('aceite de proposta antiga com outro pedido pendente na conversa é recusado de forma explícita', async () => {
  const db = new PGlite();
  try {
    const c = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table tenants(id uuid,slug text);
      create table tenant_settings(tenant_id uuid, timezone text, settings jsonb, updated_at timestamptz default now());
      create table appointments(id uuid primary key, tenant_id uuid, channel_type text, external_conversation_id text,
        status text, starts_at timestamptz, ends_at timestamptz, metadata jsonb, updated_at timestamptz);
      create unique index one_open on appointments(tenant_id,channel_type,external_conversation_id) where status='pending_confirmation';
      create table channel_events(id uuid primary key,tenant_id uuid,channel_type text,external_conversation_id text,
        direction text,sender_type text,created_at timestamptz);
      insert into tenants values('${tenant}','ic_salon');
      insert into tenant_settings(tenant_id,timezone,settings) values('${tenant}','America/Sao_Paulo',
        '{"appointment_request":{"mode":"operator_confirmation","slot_proposal_enabled":true,"slot_proposal_resolution_enabled":true}}');
      insert into appointments values('${a}','${tenant}','whatsapp','chat','pending_confirmation','2099-01-01 13:00Z','2099-01-01 14:00Z', '{"request_version":1}',now());`);
    await db.exec(migration);
    const rpc = async (name, values) => (await db.query(`select ${name}(${values.map((_, i) => '$' + (i + 1)).join(',')}) as result`, values)).rows[0].result;
    await rpc('magia_slot_proposal_prepare', [tenant, 'whatsapp', 'chat', a, 1, 'p1', '2099-02-01', '11:30', 'Eco']);
    await rpc('magia_slot_proposal_finalize', [tenant, 'whatsapp', 'chat', a, 'p1', 'provider-id']);
    // Depois da proposta, a cliente pediu outro horário à IA: novo pedido pendente na mesma conversa.
    await db.exec(`insert into appointments values('${c}','${tenant}','whatsapp','chat','pending_confirmation','2099-03-01 13:00Z',null,'{"request_version":1}',now());
      insert into channel_events values('${turn}','${tenant}','whatsapp','chat','inbound','contact',clock_timestamp()+interval '1 second');`);
    await assert.rejects(() => rpc('magia_slot_proposal_resolve', [tenant, 'whatsapp', 'chat', a, 'p1', 'accept', turn]), /SLOT_PROPOSAL_OPEN_REQUEST_EXISTS/);
    const rows = (await db.query(`select id, status, metadata->'slot_proposal'->>'status' as proposal from appointments order by id`)).rows;
    assert.deepEqual(rows.map(r => [r.id, r.status, r.proposal]), [[a, 'cancelled', 'sent'], [c, 'pending_confirmation', null]], 'nada muda');
    await db.exec('alter table appointments add column contact_name text, add column created_at timestamptz');
    await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations_pending_review/20261113000100_salon_appointment_outcomes.sql'), 'utf8'));
    await assert.rejects(() => rpc('magia_slot_proposal_resolve', [tenant, 'whatsapp', 'chat', a, 'p1', 'accept', turn]), /SLOT_PROPOSAL_OPEN_REQUEST_EXISTS/, 'pedido legado sem identidade mantém a proteção');
    await db.exec(`drop index one_open;
      create unique index one_open on appointments(tenant_id,channel_type,external_conversation_id,(coalesce(metadata->>'recipient_key',''))) where status='pending_confirmation';
      update appointments set metadata=metadata || '{"recipient_key":"ana"}' where id in ('${a}','${c}');`);
    await assert.rejects(() => rpc('magia_slot_proposal_resolve', [tenant, 'whatsapp', 'chat', a, 'p1', 'accept', turn]), /SLOT_PROPOSAL_OPEN_REQUEST_EXISTS/);
    await db.exec(`update appointments set metadata=metadata || '{"recipient_key":"joao"}' where id='${c}'`);
    const accepted = await rpc('magia_slot_proposal_resolve', [tenant, 'whatsapp', 'chat', a, 'p1', 'accept', turn]);
    assert.equal(accepted.appointment.status, 'pending_confirmation');
    assert.equal((await db.query('select status from appointments where id=$1', [c])).rows[0].status, 'pending_confirmation');
  } finally { await db.close(); }
});

async function freshDb(settings) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table tenants(id uuid,slug text);
    create table tenant_settings(tenant_id uuid, timezone text, settings jsonb, updated_at timestamptz default now());
    create table appointments(id uuid primary key, tenant_id uuid, channel_type text, external_conversation_id text,
      status text, starts_at timestamptz, ends_at timestamptz, metadata jsonb, updated_at timestamptz);
    create unique index one_open on appointments(tenant_id,channel_type,external_conversation_id) where status='pending_confirmation';
    create table channel_events(id uuid primary key,tenant_id uuid,channel_type text,external_conversation_id text,
      direction text,sender_type text,created_at timestamptz);
    insert into tenants values('${tenant}','ic_salon');
    insert into tenant_settings(tenant_id,timezone,settings) values('${tenant}','America/Sao_Paulo','${JSON.stringify(settings)}');
    insert into appointments values('${a}','${tenant}','whatsapp','chat','pending_confirmation','2099-01-01 13:00Z','2099-01-01 14:00Z','{"request_version":1}',now());`);
  await db.exec(migration);
  const rpc = async (name, values) => (await db.query(`select ${name}(${values.map((_, i) => '$' + (i + 1)).join(',')}) as result`, values)).rows[0].result;
  return { db, rpc, prep: (id, proposal, version = 1) => rpc('magia_slot_proposal_prepare', [tenant, 'whatsapp', 'chat', id, version, proposal, '2099-02-01', '11:30', 'Eco']) };
}
const both = { appointment_request: { mode: 'operator_confirmation', slot_proposal_enabled: true, slot_proposal_resolution_enabled: true } };

test('envio exige as duas chaves: enabled e resolution_enabled', async () => {
  for (const settings of [{ appointment_request: { mode: 'operator_confirmation', slot_proposal_enabled: true } },
    { appointment_request: { mode: 'operator_confirmation', slot_proposal_resolution_enabled: true } }]) {
    const { db, prep } = await freshDb(settings);
    try { await assert.rejects(() => prep(a, 'p1'), /SLOT_PROPOSAL_NOT_ENABLED/); } finally { await db.close(); }
  }
  const { db, prep } = await freshDb(both);
  try { assert.equal((await prep(a, 'p1')).proposal.status, 'sending'); } finally { await db.close(); }
});

test('sending antigo e uncertain saem pela conferência; id gravado dispensa digitação; sem id marca a falta', async () => {
  const { db, rpc, prep } = await freshDb(both);
  try {
    const reconcile = (id, resolution, messageId = null) => rpc('magia_slot_proposal_reconcile', [tenant, 'whatsapp', 'chat', a, id, resolution, tenant, messageId]);
    await prep(a, 'p1');
    // sending recente não pode ser conferido (o n8n ainda pode estar enviando)
    await assert.rejects(() => reconcile('p1', 'not_delivered'), /CHANGED/);
    await assert.rejects(() => prep(a, 'p2'), /CHANGED|DELIVERY_UNCERTAIN/);
    // sending preso há mais de 2 minutos: a equipe confere e libera
    await db.exec(`update appointments set metadata=jsonb_set(metadata,'{slot_proposal,prepared_at}',to_jsonb((now() - interval '3 minutes')::text))`);
    assert.equal((await reconcile('p1', 'not_delivered')).proposal.status, 'not_delivered');
    // uncertain com id do provedor gravado: delivered sem digitar id usa o gravado
    await prep(a, 'p2');
    const marked = await rpc('magia_slot_proposal_mark_uncertain', [tenant, 'whatsapp', 'chat', a, 'p2', 'provider-77']);
    assert.equal(marked.proposal.provider_message_id, 'provider-77');
    const delivered = await reconcile('p2', 'delivered');
    assert.equal(delivered.proposal.message_id, 'provider-77');
    assert.equal(delivered.proposal.reconciliation.message_id_unknown, false);
    assert.equal(delivered.appointment.status, 'cancelled');
    // sem id nenhum: registra o ator e marca a falta de id
    await db.exec(`update appointments set status='pending_confirmation',metadata='{"request_version":2}' where id='${a}'`);
    await prep(a, 'p3', 2);
    await rpc('magia_slot_proposal_mark_uncertain', [tenant, 'whatsapp', 'chat', a, 'p3']);
    const manual = await reconcile('p3', 'delivered');
    assert.equal(manual.proposal.status, 'sent');
    assert.equal(manual.proposal.reconciliation.message_id_unknown, true);
    assert.equal(manual.proposal.reconciliation.actor, tenant);
  } finally { await db.close(); }
});

test('proposta vencida pelo prazo do tenant recusa aceite e recusa tardios; dentro do prazo funciona', async () => {
  for (const [ttl, ageHours, expected] of [[undefined, 49, /SLOT_PROPOSAL_EXPIRED/], [undefined, 47, null], [2, 3, /SLOT_PROPOSAL_EXPIRED/], [2, 1, null]]) {
    const { db, rpc, prep } = await freshDb({ appointment_request: { ...both.appointment_request, ...(ttl ? { slot_proposal_ttl_hours: ttl } : {}) } });
    try {
      await prep(a, 'p1');
      await rpc('magia_slot_proposal_finalize', [tenant, 'whatsapp', 'chat', a, 'p1', 'provider-id']);
      await db.exec(`update appointments set metadata=jsonb_set(metadata,'{slot_proposal,sent_at}',to_jsonb((now() - interval '${ageHours} hours')::text));
        insert into channel_events values('${turn}','${tenant}','whatsapp','chat','inbound','contact',clock_timestamp()+interval '1 second')`);
      const call = decision => rpc('magia_slot_proposal_resolve', [tenant, 'whatsapp', 'chat', a, 'p1', decision, turn]);
      if (expected) { await assert.rejects(() => call('accept'), expected); await assert.rejects(() => call('reject'), expected); }
      else assert.equal((await call('accept')).appointment.status, 'pending_confirmation');
    } finally { await db.close(); }
  }
});

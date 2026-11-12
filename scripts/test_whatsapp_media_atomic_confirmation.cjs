const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function codeNode(workflow, name) {
  const nodes = workflow.nodes.filter((entry) => entry.name === name && entry.type === 'n8n-nodes-base.code');
  assert.equal(nodes.length, 1, `${name} must be unique`);
  return nodes[0];
}

function rawMerge(current, patch) {
  return { ...current, ...patch };
}

function normalizeNoriaMime(value) {
  const normalized = String(value || '').toLowerCase().replace(/\s+/g, '');
  if (/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(normalized)) return { value: normalized, base: normalized };
  if (normalized === 'audio/ogg;codecs=opus') return { value: normalized, base: 'audio/ogg' };
  return null;
}

function equivalentNoriaMime(left, right) {
  const a = normalizeNoriaMime(left);
  const b = normalizeNoriaMime(right);
  return Boolean(a && b && a.base === b.base && (a.base === 'audio/ogg' || a.value === b.value));
}

function mergeWithSnapshotCas(current, patch, expectedSnapshot) {
  const patchToMerge = { ...patch };
  let reason = 'merged';
  if (Object.prototype.hasOwnProperty.call(patch, 'product_snapshot')) {
    const hasCurrent = Object.prototype.hasOwnProperty.call(current, 'product_snapshot');
    const matches = hasCurrent
      ? expectedSnapshot !== null && JSON.stringify(current.product_snapshot) === JSON.stringify(expectedSnapshot)
      : expectedSnapshot === null;
    if (!matches) {
      delete patchToMerge.product_snapshot;
      reason = 'merged_product_snapshot_stale';
    }
  }
  const next = { ...current, ...patchToMerge };
  return { applied: JSON.stringify(next) !== JSON.stringify(current), reason: JSON.stringify(next) === JSON.stringify(current) && reason !== 'merged' ? 'product_snapshot_stale' : reason, next };
}

test('media confirmation uses an atomic RPC, never GET plus full raw_payload PATCH', () => {
  const workflow = JSON.parse(fs.readFileSync(path.join(root, 'n8n/workflows/NORIA-CORE-Roteador-WhatsApp-Comandos-e-Follow-ups--3N5oN6sxtir9lFrA.json'), 'utf8'));
  const node = codeNode(workflow, 'Confirmar Mídia WhatsApp');
  assert.ok(node.parameters.jsCode.includes('/rpc/magia_confirm_whatsapp_media'));
  assert.ok(!node.parameters.jsCode.includes('select=id,raw_payload'));
  assert.ok(node.parameters.jsCode.includes("confirmationResult.reason === 'already_stored' && sameObject"));
  assert.ok(node.parameters.jsCode.includes('equivalentNoriaMime(confirmationResult.stored_media.mimeType, media.mimeType)'));
  for (const fragment of ['media_identity_missing', 'media_atomic_rpc_transport_failed', 'media_atomic_confirmation_rejected']) assert.ok(node.parameters.jsCode.includes(fragment));
  assert.ok(node.parameters.jsCode.includes('timeout: 10000'));
  assert.ok(!node.parameters.jsCode.includes('persisted: true'));
});

test('migration scopes confirmation and forbids stored-to-pending regression', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261016193000_noria_whatsapp_media_atomic_confirmation.sql'), 'utf8');
  for (const fragment of ["p_media is null or jsonb_typeof(p_media) <> 'object'", 'invalid_media_status', "coalesce(p_media->>'verified', '') <> 'true'", "requested_mime = ''", "^[1-9][0-9]{0,7}$", "coalesce(o.metadata->>'size', '') ~ '^[0-9]{1,8}$'", 'object_row.size is null', 'storage_object_missing', 'storage_metadata_mismatch', 'stored_media_conflict', 'tenant_id = p_tenant', "current_media->>'status' = 'stored'", "'{media}'"]) assert.ok(sql.includes(fragment));
  for (const fragment of ['invalid_identity', 'p_channel text, p_conversation text', 'event_scope_mismatch', 'security invoker', 'grant execute']) assert.ok(sql.includes(fragment));
});

test('merge rejects a SQL NULL patch before concatenation and has no raw_payload output collision', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261016193000_noria_whatsapp_media_atomic_confirmation.sql'), 'utf8');
  assert.ok(sql.includes('returns table (applied boolean, reason text, merged_payload jsonb)'));
  assert.ok(sql.includes("if p_patch is null or jsonb_typeof(p_patch) <> 'object'"));
  assert.ok(sql.includes('select coalesce(ce.raw_payload'));
  assert.ok(sql.includes('returning ce.raw_payload into updated_raw'));
  assert.ok(!sql.includes('returns table (applied boolean, reason text, raw_payload jsonb)'));
});

test('both RPCs revoke direct anon and authenticated EXECUTE before granting service_role', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261016193000_noria_whatsapp_media_atomic_confirmation.sql'), 'utf8');
  for (const signature of [
    'public.magia_confirm_whatsapp_media(uuid,uuid,text,text,text,jsonb) from public, anon, authenticated;',
    'public.magia_merge_channel_event_raw(uuid,uuid,text,text,text,jsonb,jsonb) from public, anon, authenticated;',
  ]) assert.ok(sql.includes(signature));
  assert.equal((sql.match(/to service_role;/g) || []).length, 2);
});

test('MIME normalization accepts only equivalent OGG/Opus forms and preserves strict types', () => {
  assert.deepEqual(normalizeNoriaMime(' audio/ogg '), { value: 'audio/ogg', base: 'audio/ogg' });
  assert.deepEqual(normalizeNoriaMime('Audio/OGG ; codecs = opus'), { value: 'audio/ogg;codecs=opus', base: 'audio/ogg' });
  assert.equal(equivalentNoriaMime('audio/ogg', 'audio/ogg; codecs=opus'), true);
  assert.equal(equivalentNoriaMime(' AUDIO/OGG ; CODECS = OPUS ', 'audio/ogg'), true);
  assert.equal(equivalentNoriaMime('audio/ogg; codecs=vorbis', 'audio/ogg'), false);
  assert.equal(equivalentNoriaMime('audio/mpeg', 'audio/ogg'), false);
  assert.equal(normalizeNoriaMime('audio/ogg; charset=utf-8'), null);
  assert.equal(normalizeNoriaMime(''), null);
  const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261016193000_noria_whatsapp_media_atomic_confirmation.sql'), 'utf8');
  for (const fragment of ["requested_mime = 'audio/ogg;codecs=opus'", "storage_mime = 'audio/ogg;codecs=opus'", "requested_mime_base <> 'audio/ogg'", 'current_mime_base = requested_mime_base']) assert.ok(sql.includes(fragment));
});

test('atomic merge preserves media, audio and unrelated fields in either ordering', () => {
  const stored = { bucket: 'channel-media', storagePath: 'tenant/whatsapp/a/file.jpg', status: 'stored', verified: true };
  const echo = { evolution_echo: { source: 'messages.upsert_fromMe' } };
  const audio = { audio_processing: { status: 'transcribed', text: 'olá' } };
  const base = { media: stored, untouched: { value: 1 } };
  for (const sequence of [[echo, audio], [audio, echo], [echo, echo, audio]]) {
    const result = sequence.reduce(rawMerge, base);
    assert.deepEqual(result.media, stored);
    assert.deepEqual(result.audio_processing, audio.audio_processing);
    assert.deepEqual(result.untouched, base.untouched);
  }
});

test('manual echo node calls the scoped atomic merge and never PATCHes raw_payload', () => {
  const workflow = JSON.parse(fs.readFileSync(path.join(root, 'n8n/workflows/NORIA-CORE-Roteador-WhatsApp-Comandos-e-Follow-ups--3N5oN6sxtir9lFrA.json'), 'utf8'));
  const node = codeNode(workflow, 'Capturar Resposta Manual WhatsApp');
  const code = node.parameters.jsCode;
  for (const fragment of ['/rpc/magia_merge_channel_event_raw', 'p_tenant: tenantId', "p_channel: 'whatsapp'", 'p_conversation: prior.external_conversation_id', 'p_external_message: input.messageId', 'evolution_echo']) assert.ok(code.includes(fragment));
  assert.ok(code.includes('p_expected_product_snapshot: prior.raw_payload?.product_snapshot || null'));
  assert.ok(code.includes('if (productSnapshot && !prior.raw_payload?.product_snapshot) patch.product_snapshot = productSnapshot;'));
  assert.ok(!code.includes('if (productSnapshot) patch.product_snapshot = productSnapshot;'));
  assert.ok(code.includes("['already_applied', 'product_snapshot_stale'].includes(mergeResult.reason)"));
  assert.ok(!code.includes('body: { raw_payload: rawPayload }'));
});

test('product_snapshot uses compare-and-set: stale work cannot overwrite newer data', () => {
  const base = {
    media: { status: 'stored', storagePath: 'tenant/file.ogg' },
    audio_processing: { status: 'transcribed' },
    evolution_echo: { source: 'old' },
    untouched: { keep: true },
  };
  const vehicleA = { product_id: 'A', title: 'Veículo A' };
  const vehicleB = { product_id: 'B', title: 'Veículo B' };
  const vehicleC = { product_id: 'C', title: 'Veículo C' };
  const newer = mergeWithSnapshotCas(base, { product_snapshot: vehicleB, evolution_echo: { source: 'B' } }, null);
  assert.equal(newer.applied, true);
  assert.deepEqual(newer.next.product_snapshot, vehicleB);
  const stale = mergeWithSnapshotCas(newer.next, { product_snapshot: vehicleA, evolution_echo: { source: 'A-late' } }, null);
  assert.equal(stale.reason, 'merged_product_snapshot_stale');
  assert.deepEqual(stale.next.product_snapshot, vehicleB);
  assert.deepEqual(stale.next.evolution_echo, { source: 'A-late' });
  const legitimate = mergeWithSnapshotCas(stale.next, { product_snapshot: vehicleC }, vehicleB);
  assert.equal(legitimate.reason, 'merged');
  assert.deepEqual(legitimate.next.product_snapshot, vehicleC);
  const retry = mergeWithSnapshotCas(legitimate.next, { product_snapshot: vehicleC }, vehicleC);
  assert.equal(retry.applied, false);
  for (const key of ['media', 'audio_processing', 'untouched']) assert.deepEqual(retry.next[key], base[key]);
  const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261016193000_noria_whatsapp_media_atomic_confirmation.sql'), 'utf8');
  for (const fragment of ['p_expected_product_snapshot jsonb default null', 'current_snapshot is not distinct from p_expected_product_snapshot', "patch_to_merge := p_patch - 'product_snapshot'", 'merged_product_snapshot_stale']) assert.ok(sql.includes(fragment));
});

test('all current raw_payload writers use scoped atomic merge when mutating an existing event', () => {
  const source = fs.readFileSync(path.join(root, 'n8n/sources/noria_core.js'), 'utf8');
  const audio = fs.readFileSync(path.join(root, 'n8n/code/whatsapp_audio.js'), 'utf8');
  for (const code of [source, audio]) assert.ok(code.includes('/rpc/magia_merge_channel_event_raw'));
  assert.ok(!source.includes('raw_payload: {\n        ...existing'));
  assert.ok(!audio.includes('supabasePatch(path,{raw_payload:'));
});

test('confirmation node never reports persisted for missing identity, transport errors, empty replies or mismatched already_stored', async () => {
  const workflow = JSON.parse(fs.readFileSync(path.join(root, 'n8n/workflows/NORIA-CORE-Roteador-WhatsApp-Comandos-e-Follow-ups--3N5oN6sxtir9lFrA.json'), 'utf8'));
  const code = codeNode(workflow, 'Confirmar Mídia WhatsApp').parameters.jsCode;
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const run = new AsyncFunction('$json', '$env', '$binary', '$', code);
  const base = {
    tenant_id: 'tenant-1', remoteJid: '5511999999999@s.whatsapp.net',
    media_ingestion: { present: true, should_upload: false, event_id: 'event-1', external_message_id: 'message-1', media: { bucket: 'channel-media', storagePath: 'tenant/whatsapp/a/file.jpg', mimeType: 'image/jpeg', size: 12, status: 'stored', verified: true } },
  };
  const execute = async (input, handler) => run.call({ helpers: { httpRequest: handler } }, input, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'key' }, {}, () => ({ item: {} }));
  const missingIdentity = await execute({ ...base, tenant_id: '' }, async () => { throw new Error('must not call'); });
  assert.equal(missingIdentity.json.media_ingestion.persisted, false);
  assert.equal(missingIdentity.json.media_ingestion.persistence_error, 'media_identity_missing');
  for (const handler of [
    async () => { throw new Error('timeout'); },
    async () => undefined,
    async () => [{ applied: false, reason: 'already_stored', stored_media: { bucket: 'channel-media', storagePath: 'other/file.jpg', mimeType: 'image/jpeg', size: 12, status: 'stored', verified: true } }],
    async () => [{ applied: false, reason: 'already_stored', stored_media: { ...base.media_ingestion.media, verified: false } }],
  ]) {
    const result = await execute(base, handler);
    assert.equal(result.json.media_ingestion.persisted, false);
  }
  const accepted = await execute(base, async () => [{ applied: true, reason: 'confirmed' }]);
  assert.equal(accepted.json.media_ingestion.persisted, true);
  const oggInput = {
    ...base,
    media_ingestion: {
      ...base.media_ingestion,
      media: { ...base.media_ingestion.media, storagePath: 'tenant/whatsapp/a/legacy.ogg', mimeType: ' Audio/OGG ; codecs = opus ' },
    },
  };
  const alreadyStoredEquivalentOgg = await execute(oggInput, async () => [{
    applied: false,
    reason: 'already_stored',
    stored_media: { ...oggInput.media_ingestion.media, mimeType: 'audio/ogg', status: 'stored', verified: true },
  }]);
  assert.equal(alreadyStoredEquivalentOgg.json.media_ingestion.persisted, true);
});

test('patching and canonical generation are idempotent and preserve workflow topology', () => {
  const workflowPath = path.join(root, 'n8n/workflows/NORIA-CORE-Roteador-WhatsApp-Comandos-e-Follow-ups--3N5oN6sxtir9lFrA.json');
  const before = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
  const beforeTopology = JSON.stringify({ connections: before.connections, nodes: before.nodes.map(({ id, name, type }) => ({ id, name, type })) });
  const { execFileSync } = require('node:child_process');
  execFileSync(process.execPath, ['scripts/patch_confirmar_midia.cjs'], { cwd: root, stdio: 'pipe' });
  const after = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
  const afterTopology = JSON.stringify({ connections: after.connections, nodes: after.nodes.map(({ id, name, type }) => ({ id, name, type })) });
  assert.equal(afterTopology, beforeTopology);
  assert.equal(codeNode(after, 'Confirmar Mídia WhatsApp').parameters.jsCode, codeNode(before, 'Confirmar Mídia WhatsApp').parameters.jsCode);
  assert.equal(codeNode(after, 'Capturar Resposta Manual WhatsApp').parameters.jsCode, codeNode(before, 'Capturar Resposta Manual WhatsApp').parameters.jsCode);
});

test('patch accepts CRLF code anchors and changes only the intended Code node', () => {
  const os = require('node:os');
  const { execFileSync } = require('node:child_process');
  const sourcePath = path.join(root, 'n8n/workflows/NORIA-CORE-Roteador-WhatsApp-Comandos-e-Follow-ups--3N5oN6sxtir9lFrA.json');
  const tempPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'noria-media-patch-')), 'workflow.json');
  const before = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const target = JSON.parse(JSON.stringify(before));
  const confirmation = codeNode(target, 'Confirmar Mídia WhatsApp');
  confirmation.parameters.jsCode = confirmation.parameters.jsCode.split('\n').join('\r\n').replace('media_identity_missing', 'legacy_identity_anchor');
  const manual = codeNode(target, 'Capturar Resposta Manual WhatsApp');
  fs.writeFileSync(tempPath, `${JSON.stringify(target, null, 2)}\n`);
  execFileSync(process.execPath, ['scripts/patch_confirmar_midia.cjs'], { cwd: root, env: { ...process.env, NORIA_WORKFLOW_FILE: tempPath }, stdio: 'pipe' });
  const after = JSON.parse(fs.readFileSync(tempPath, 'utf8'));
  const changed = after.nodes.filter((node, index) => JSON.stringify(node) !== JSON.stringify(target.nodes[index])).map((node) => node.name);
  assert.deepEqual(changed, ['Confirmar Mídia WhatsApp']);
  assert.ok(codeNode(after, 'Confirmar Mídia WhatsApp').parameters.jsCode.includes('media_identity_missing'));
  assert.ok(codeNode(after, 'Capturar Resposta Manual WhatsApp').parameters.jsCode.includes('/rpc/magia_merge_channel_event_raw'));
});

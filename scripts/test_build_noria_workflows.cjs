const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const exportsDir = process.env.NORIA_TEST_EXPORTS_DIR || path.join(root, 'n8n/workflows');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'noria-build-test-'));
// Mesmo critério do gerador: hash do conteúdo em LF, estável entre checkouts CRLF (Windows) e LF.
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
const core = path.join(root, 'n8n/sources/noria_core.js');
const before = sha(core);
try {
  fs.cpSync(exportsDir, path.join(out, 'n8n/workflows'), { recursive: true });
  const run = () => {
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/build_noria_workflows.cjs')], {
      env: { ...process.env, NORIA_BUILD_OUT_DIR: out, NORIA_RETAIL_EXT_WORKFLOW_ID: 'vE8rPAAdzkkVzPBG' }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  };
  run();
  assert.equal(sha(core), before, 'A fonte do CORE foi alterada');
  assert.equal(fs.existsSync(path.join(out, 'n8n/sources/noria_core.js')), false, 'O build gravou a fonte do CORE');
  const manifestPath = path.join(out, 'n8n/build_manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.ok(!manifest.artifacts.includes('n8n/sources/noria_router_core.js'));
  const expected = [
    'n8n/sources/noria_core.js', 'n8n/sources/noria_retail.js', 'n8n/sources/noria_router.js',
    'n8n/sources/noria_turn_dispatch.js', 'n8n/sources/genesis_extension.js', 'n8n/sources/genesis_tenant_identity.js',
    'n8n/sources/whatsapp_normalize_entry.js', 'n8n/sources/nubia_extension.js', 'n8n/sources/noria_extension.js',
    'n8n/sources/joyeria_extension.js', 'clients/ic_saloon/salon_engine.js', 'clients/ic_saloon/conversation_adapter.cjs',
    'clients/ic_saloon/conversation_route.cjs', 'scripts/lib/retail_region.cjs', 'scripts/turn_queue_operational_bridge.cjs',
    'n8n/sources/shared/tenant_identity.js', 'n8n/sources/shared/text_utils.js', 'n8n/sources/shared/whatsapp_jid.js',
    'n8n/code/whatsapp_recover_core.js', 'n8n/code/whatsapp_follow_up_dispatch.js', 'n8n/code/command_router.js',
    'n8n/code/whatsapp_sync_contact.js', 'n8n/code/broadcast_campaign_worker.js', 'n8n/code/whatsapp_capture_manual_reply.js',
    'n8n/code/whatsapp_prepare_context.js', 'n8n/code/whatsapp_avatar_refresh.js',
  ];
  assert.deepEqual(Object.keys(manifest.source_sha256).sort(), expected.sort());
  for (const file of expected) assert.equal(manifest.source_sha256[file], sha(path.join(root, file)), file);
  const first = fs.readFileSync(manifestPath, 'utf8');
  run();
  assert.equal(fs.readFileSync(manifestPath, 'utf8'), first, 'Build repetido alterou metadados');
  console.log('Gerador: fontes preservadas, hashes completos e build repetível.');
} finally {
  fs.rmSync(out, { recursive: true, force: true });
}

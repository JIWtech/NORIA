// Nó exportado real em n8n isolado; PostgREST/PGlite e Evolution locais sintéticos.
// MAGIA_TEST_MODULES=<node_modules com PGlite> node n8n_broadcast_runtime.cjs <binário n8n>
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const h = require('../broadcast_test_harness.cjs');
const cli = process.argv[2];
assert.ok(cli && fs.existsSync(cli), 'Informe o binário do n8n');
const workflow = JSON.parse(h.read('n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json'));
const worker = workflow.nodes.find(n => n.name === 'Processar Disparos');
assert.ok(worker);
const freePort = () => new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
async function main() {
  const db = await h.bootstrap();
  const postgrest = h.createPostgrest(db);
  const sent = [], errors = [];
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
      const url = `http://127.0.0.1${req.url}`;
      let result;
      if (req.url.startsWith('/rest/v1/')) result = await postgrest.handle({ url, method: req.method, headers: req.headers, body });
      else if (req.url.startsWith('/message/sendText/')) {
        assert.equal(req.headers.apikey, 'key-salao_a');
        assert.equal(req.url, '/message/sendText/inst-a');
        sent.push(body); result = { key: { id: 'synthetic-' + sent.length } };
      } else throw new Error('Rota inesperada: ' + req.url);
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(result));
    } catch (e) { errors.push(String(e.stack || e)); res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: String(e) })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'noria-broadcast-n8n-'));
  try {
    const port = server.address().port;
    const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: temp, TMP: temp, USERPROFILE: temp, N8N_USER_FOLDER: temp,
      N8N_PORT: String(await freePort()), N8N_RUNNERS_BROKER_PORT: String(await freePort()), N8N_DIAGNOSTICS_ENABLED: 'false',
      N8N_VERSION_NOTIFICATIONS_ENABLED: 'false', N8N_PERSONALIZATION_ENABLED: 'false', N8N_TEMPLATES_ENABLED: 'false',
      N8N_BLOCK_ENV_ACCESS_IN_NODE: 'false', N8N_USE_WORKFLOW_PUBLICATION_SERVICE: 'false', N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS: 'false',
      SUPABASE_URL: `http://127.0.0.1:${port}`, SUPABASE_SERVICE_ROLE_KEY: 'service-key-test', BROADCAST_WORKER_BUDGET_SECONDS: '0',
      EVOLUTION_API_URL_SALAO_A: `http://127.0.0.1:${port}`, EVOLUTION_API_KEY_SALAO_A: 'key-salao_a', EVOLUTION_INSTANCE_SALAO_A: 'inst-a',
      HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9', NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' };
    const run = args => new Promise((resolve, reject) => { const p = spawn(process.execPath, [path.resolve(cli), ...args], { cwd: temp, env, windowsHide: true }); let output = ''; p.stdout.on('data', x => output += x); p.stderr.on('data', x => output += x); p.on('error', reject); p.on('close', code => resolve({ code, output })); });
    const w = { id: 'broadcastTest001', name: 'Disparos isolado', active: false, settings: { executionOrder: 'v1' }, nodes: [
      { id: 'trigger', name: 'Início', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} }, worker
    ], connections: { 'Início': { main: [[{ node: worker.name, type: 'main', index: 0 }]] } } };
    const file = path.join(temp, 'workflow.json'); fs.writeFileSync(file, JSON.stringify(w));
    const imp = await run(['import:workflow', '--input', file]); assert.equal(imp.code, 0, imp.output);
    const execute = async () => { const r = await run(['execute', '--id', w.id, '--rawOutput']); assert.equal(r.code, 0, r.output); assert.deepEqual(errors, []); return r.output; };
    const { rows: [{ at }] } = await db.query("select now() + interval '2 hours' as at");
    const id = await h.createCampaign(db, { contacts: 2, scheduledAt: at });
    const proof = { contract: 'noria_broadcast_opt_out_v1', source: 'customer_request', evidence_ids: ['synthetic-event'] };
    await db.query("select broadcast_register_opt_out($1, 'whatsapp', $2, $3::jsonb)", [h.TENANT_A.id, '5521990000000@s.whatsapp.net', JSON.stringify(proof)]);
    await execute(); assert.equal(sent.length, 0, 'agendamento futuro');
    await db.query("update broadcast_campaigns set scheduled_at = now() - interval '1 minute' where id = $1", [id]);
    const output = await execute(); assert.equal(sent.length, 1, output); assert.equal(sent[0].number, '5521990000001');
    await execute(); assert.equal(sent.length, 1, 'reexecução não pode duplicar envio');
    const statuses = (await db.query('select status, count(*)::int as n from broadcast_campaign_recipients where campaign_id = $1 group by status order by status', [id])).rows;
    assert.deepEqual(statuses, [{ status: 'sent', n: 1 }, { status: 'skipped', n: 1 }]);
    const events = (await db.query('select tenant_id, command_id from channel_events')).rows;
    assert.equal(events.length, 1); assert.equal(events[0].tenant_id, h.TENANT_A.id); assert.ok(events[0].command_id.startsWith('bcast:' + id));
    assert.ok(postgrest.calls.filter(c => c.method === 'GET').every(c => /tenant_id=eq\./.test(c.query)));
    console.log('PASS: agendamento futuro, fila devida, opt-out, idempotência em reexecução, evento e escopo tenant no nó real.');
  } finally { await new Promise(resolve => server.close(resolve)); await db.close(); fs.rmSync(temp, { recursive: true, force: true }); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });

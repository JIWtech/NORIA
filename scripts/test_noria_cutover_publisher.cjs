// Testes do publicador do corte contra um servidor HTTP falso (127.0.0.1) que imita a API pública do n8n.
// Nenhuma chamada remota, nenhum .env, nenhum segredo real.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cutover = require('./publish_noria_cutover.cjs');

const ROOT = path.resolve(__dirname, '..');
const KEY = 'chave-falsa-de-teste-123';
const { IDS } = cutover;
const clone = v => JSON.parse(JSON.stringify(v));
const canon = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x);

// Estado inicial "vivo": deriva dos artefatos, mas com nomes, ids de nós, credenciais, webhookId, settings e staticData próprios.
function seedLive() {
  const arts = cutover.loadArtifacts(ROOT);
  const live = {};
  for (const key of ['genesis', 'nb', 'salon', 'engine', 'router']) {
    const wf = clone(arts[key].workflow);
    wf.id = IDS[key];
    wf.name = 'ANTIGO ' + wf.name;
    wf.nodes = wf.nodes.map(n => {
      const out = { ...n, id: 'vivo-' + (n.id || n.name) };
      if (out.credentials) out.credentials = Object.fromEntries(Object.entries(out.credentials).map(([t, c]) => [t, { id: 'cred-vivo-' + t, name: c.name }]));
      if (out.webhookId) out.webhookId = 'wh-vivo-' + out.webhookId;
      return out;
    });
    wf.settings = { ...(wf.settings || {}), configuracaoSoDoVivo: 'x' };
    wf.staticData = key === 'engine' ? { global: { gemini_circuit_open_until: 111, gemini_active_calls: 2 } }
      : key === 'router' ? { global: { lifecycle_checked_at: 222 } } : null;
    wf.tags = [{ id: 't1', name: 'producao' }];
    wf.active = true; wf.versionId = 'v1-' + key; wf.activeVersionId = 'v1-' + key; wf.isArchived = false;
    live[IDS[key]] = wf;
  }
  return live;
}

async function startServer({ failOn } = {}) {
  const state = { workflows: seedLive(), calls: [], seq: 0, counters: {} };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.headers['x-n8n-api-key'] !== KEY) return send(401, { message: 'unauthorized' });
      const sig = req.method + ' ' + url.pathname.replace('/api/v1', '');
      state.calls.push(sig);
      state.counters[sig] = (state.counters[sig] || 0) + 1;
      if (failOn && failOn(sig, state.counters[sig], state)) return send(500, { message: 'falha injetada' });
      const payload = raw ? JSON.parse(raw) : null;
      const m = /^\/api\/v1\/workflows(?:\/([^/]+))?(?:\/(activate|deactivate|archive))?$/.exec(url.pathname);
      if (!m) return send(404, {});
      const [, id, action] = m;
      const w = id && state.workflows[id];
      if (!id && req.method === 'GET') {
        const name = url.searchParams.get('name');
        return send(200, { data: Object.values(state.workflows).filter(x => x.name === name).map(x => ({ id: x.id, name: x.name })) });
      }
      if (!id && req.method === 'POST') {
        if (Object.keys(payload).some(k => !['name', 'nodes', 'connections', 'settings', 'staticData'].includes(k))) return send(400, { message: 'additional properties' });
        const newId = 'NovoExtNoria01';
        state.workflows[newId] = { ...payload, id: newId, active: false, versionId: 'n1', activeVersionId: null, isArchived: false, tags: [], staticData: null };
        return send(200, state.workflows[newId]);
      }
      if (!w) return send(404, { message: 'not found' });
      if (req.method === 'GET') return send(200, w);
      if (req.method === 'PUT' && !action) {
        if (Object.keys(payload).some(k => !['name', 'nodes', 'connections', 'settings', 'staticData'].includes(k))) return send(400, { message: 'additional properties' });
        Object.assign(w, { name: payload.name, nodes: payload.nodes, connections: payload.connections, settings: payload.settings });
        w.versionId = 'v' + (++state.seq) + '-' + id; // PUT em workflow ativo NÃO move a versão ativa: o publicador precisa ativar.
        return send(200, w);
      }
      if (req.method === 'POST' && action === 'activate') { w.active = true; w.activeVersionId = w.versionId; w.activeVersion = { nodes: w.nodes }; return send(200, w); }
      if (req.method === 'POST' && action === 'deactivate') { w.active = false; w.activeVersionId = null; delete w.activeVersion; return send(200, w); }
      if (req.method === 'POST' && action === 'archive') { w.isArchived = true; return send(200, w); }
      return send(405, {});
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { state, url: 'http://127.0.0.1:' + server.address().port, close: () => new Promise(r => server.close(r)) };
}

const fresh = () => ({ lines: [], tmp: fs.mkdtempSync(path.join(os.tmpdir(), 'noria-cutover-')) });
async function run(server, tmp, lines, argv, env = {}) {
  return cutover.main(argv, {
    root: ROOT, log: l => lines.push(l),
    env: { N8N_BASE_URL: server.url, N8N_API_KEY: KEY, NORIA_CUTOVER_BACKUP_DIR: tmp, ...env },
  });
}
const AUTH = { NORIA_PUBLISH_AUTHORIZED: '1' };
const snapshot = state => canon(Object.fromEntries(Object.entries(state.workflows).filter(([id]) => Object.values(IDS).includes(id))
  .map(([id, w]) => [id, { name: w.name, nodes: w.nodes, connections: w.connections, settings: w.settings, staticData: w.staticData, tags: w.tags, active: w.active }])));
const isWrite = c => /^(PUT|POST) /.test(c) && !/\/workflows\/[^/]+\/(activate|deactivate|archive)$/.test(c) || /(activate|deactivate|archive)$/.test(c);

test('plan: offline, valida artefatos e imprime a ordem', async () => {
  const { lines } = fresh();
  const code = await cutover.main(['plan'], { root: ROOT, env: {}, log: l => lines.push(l), fetch: () => { throw new Error('rede proibida'); } });
  const out = lines.join('\n');
  assert.equal(code, 0, out);
  const order = ['noria', 'genesis', 'nb', 'salon', 'engine', 'router'].map(k => out.indexOf(k.padEnd(8)));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(out, /PLANO OK/);
  assert.match(out, /Motor de Atendimento/);
});

test('plan: reprova roteador com motor embutido', () => {
  const arts = cutover.loadArtifacts(ROOT);
  arts.router.workflow.nodes.push({ name: 'CORE | Motor conversacional', type: 'n8n-nodes-base.code', parameters: {} });
  assert.ok(cutover.validateArtifacts(arts).some(e => e.startsWith('ROTEADOR_COM_MOTOR_EMBUTIDO')));
  const arts2 = cutover.loadArtifacts(ROOT);
  arts2.engine.workflow.nodes.push({ ...arts2.engine.workflow.nodes.find(n => n.name === 'CORE | Motor conversacional'), id: 'dup' });
  assert.ok(cutover.validateArtifacts(arts2).some(e => e.startsWith('MOTOR_COPIAS')));
  const arts3 = cutover.loadArtifacts(ROOT);
  arts3.router.workflow.nodes.find(n => n.name === 'CORE | Executar EXT NORIA').parameters.workflowId.value = IDS.engine;
  assert.ok(cutover.validateArtifacts(arts3).some(e => e.startsWith('EXT_NORIA_COM_ID_DO_MOTOR')));
});

test('check: relata deriva, so faz GET e nunca imprime a chave', async () => {
  const server = await startServer();
  const { lines, tmp } = fresh();
  try {
    const code = await run(server, tmp, lines, ['check']);
    const out = lines.join('\n');
    assert.equal(code, 0, out);
    assert.ok(server.state.calls.every(c => c.startsWith('GET ')), server.state.calls.join(','));
    assert.match(out, /nos adicionados|nos removidos/);
    assert.match(out, /credenciais .*vivo \[supabaseApi\]|credenciais .*vivo \[evolutionApi\]/);
    assert.match(out, /webhook Webhook WhatsApp Evolution: webhookId wh-vivo-/);
    assert.match(out, /staticData.global \(preservado\): gemini_circuit_open_until/);
    assert.ok(!out.includes(KEY));
  } finally { await server.close(); }
});

test('check: falha fechado se o artefato perderia credencial ou webhook do vivo', async () => {
  const server = await startServer();
  const { lines, tmp } = fresh();
  try {
    const live = server.state.workflows[IDS.router];
    live.nodes.push({ id: 'extra', name: 'No so do vivo', type: 'n8n-nodes-base.httpRequest', typeVersion: 4, position: [0, 0], parameters: {}, credentials: { httpHeaderAuth: { id: 'c', name: 'c' } } });
    live.nodes.find(n => n.webhookId && n.parameters.path === 'magia-whatsapp').parameters.path = 'outro-caminho';
    const code = await run(server, tmp, lines, ['check']);
    const out = lines.join('\n');
    assert.equal(code, 1, out);
    assert.match(out, /BLOQUEIO: NO_REMOVIDO_COM_CREDENCIAL: No so do vivo/);
    assert.match(out, /BLOQUEIO: CAMINHO_DO_WEBHOOK_MUDOU/);
  } finally { await server.close(); }
});

test('check: falha se a EXT NORIA ja existir (evita duplicata)', async () => {
  const server = await startServer();
  const { lines, tmp } = fresh();
  try {
    server.state.workflows.JaExiste = { id: 'JaExiste', name: 'NORIA EXT | NORIA | Política', nodes: [], connections: {}, settings: {} };
    assert.equal(await run(server, tmp, lines, ['check']), 1);
    assert.match(lines.join('\n'), /EXT_NORIA_JA_EXISTE/);
  } finally { await server.close(); }
});

test('backup: grava fora do repositorio com manifesto e sha256 e so le', async () => {
  const server = await startServer();
  const { lines, tmp } = fresh();
  try {
    assert.equal(await run(server, tmp, lines, ['backup']), 0, lines.join('\n'));
    assert.ok(server.state.calls.every(c => c.startsWith('GET ')));
    const dir = path.join(tmp, fs.readdirSync(tmp)[0]);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.workflows.length, 5);
    for (const e of manifest.workflows) {
      const buf = fs.readFileSync(path.join(dir, e.file));
      assert.equal(require('node:crypto').createHash('sha256').update(buf).digest('hex'), e.sha256);
      assert.deepEqual(JSON.parse(buf.toString('utf8')), server.state.workflows[e.id]);
    }
    assert.ok(!JSON.stringify(manifest).includes(KEY));
    const inRepo = await run(server, tmp, [], ['backup'], { NORIA_CUTOVER_BACKUP_DIR: path.join(ROOT, '.local', 'bk') });
    assert.equal(inRepo, 1);
  } finally { await server.close(); }
});

async function backupOf(server, tmp) {
  const lines = [];
  assert.equal(await run(server, tmp, lines, ['backup']), 0, lines.join('\n'));
  const dirs = fs.readdirSync(tmp);
  return path.join(tmp, dirs[dirs.length - 1]);
}

test('apply feliz: ordem, preservacao do vivo e substituicao do marcador', async () => {
  const server = await startServer();
  const { lines, tmp } = fresh();
  try {
    const before = clone(server.state.workflows);
    const dir = await backupOf(server, tmp);
    server.state.calls.length = 0;
    const code = await run(server, tmp, lines, ['apply', '--backup=' + dir, '--confirm=CORTE'], AUTH);
    const out = lines.join('\n');
    assert.equal(code, 0, out);
    assert.ok(!out.includes(KEY));
    const writes = server.state.calls.filter(c => c.startsWith('PUT ') || c.startsWith('POST '));
    const idx = s => writes.findIndex(c => c.includes(s));
    assert.equal(writes[0], 'POST /workflows');
    assert.ok(idx('/workflows/NovoExtNoria01/activate') < idx(IDS.genesis));
    assert.ok(idx('PUT /workflows/' + IDS.genesis) < idx('PUT /workflows/' + IDS.nb));
    assert.ok(idx('PUT /workflows/' + IDS.nb) < idx('PUT /workflows/' + IDS.salon));
    assert.ok(idx('PUT /workflows/' + IDS.salon) < idx('PUT /workflows/' + IDS.engine));
    assert.ok(idx('PUT /workflows/' + IDS.engine) < idx('PUT /workflows/' + IDS.router));
    assert.ok(writes.indexOf('POST /workflows/' + IDS.router + '/activate') > idx('PUT /workflows/' + IDS.router), 'ativacao apos o PUT em workflow ativo');
    const ext = server.state.workflows.NovoExtNoria01;
    assert.equal(ext.active, true);
    const router = server.state.workflows[IDS.router];
    const noria = router.nodes.find(n => n.name === 'CORE | Executar EXT NORIA');
    assert.equal(noria.parameters.workflowId.value, 'NovoExtNoria01');
    assert.ok(!JSON.stringify(router).includes('PREENCHER_ID_EXT_NORIA'));
    for (const key of ['genesis', 'nb', 'salon', 'engine', 'router']) {
      const prev = before[IDS[key]], now = server.state.workflows[IDS[key]];
      assert.equal(now.name, key === 'salon' ? prev.name : cutover.NAMES[key] ?? now.name);
      assert.deepEqual(now.settings, prev.settings);
      assert.deepEqual(now.staticData, prev.staticData);
      assert.deepEqual(now.tags, prev.tags);
      assert.equal(now.active, true);
      assert.equal(now.activeVersionId, now.versionId);
      for (const node of now.nodes) {
        const old = prev.nodes.find(n => n.name === node.name);
        if (!old) continue;
        assert.equal(node.id, old.id);
        assert.equal(node.webhookId, old.webhookId);
        for (const [type, cred] of Object.entries(old.credentials || {})) assert.deepEqual(node.credentials[type], cred);
      }
    }
    assert.equal(server.state.workflows[IDS.engine].name, 'NORIA CORE | Motor de Atendimento');
    assert.equal(server.state.workflows[IDS.engine].staticData.global.gemini_active_calls, 2);
    assert.equal(server.state.workflows[IDS.router].staticData.global.lifecycle_checked_at, 222);
  } finally { await server.close(); }
});

test('apply: recusa sem autorizacao, sem confirmacao, sem backup e com versao divergente (sem escrever)', async () => {
  const server = await startServer();
  const { lines, tmp } = fresh();
  try {
    const dir = await backupOf(server, tmp);
    server.state.calls.length = 0;
    const base = ['apply', '--backup=' + dir, '--confirm=CORTE'];
    assert.equal(await run(server, tmp, lines, base), 1);
    assert.match(lines.join('\n'), /NAO_AUTORIZADO/);
    assert.equal(await run(server, tmp, lines, ['apply', '--backup=' + dir], AUTH), 1);
    assert.match(lines.join('\n'), /NAO_CONFIRMADO/);
    assert.equal(await run(server, tmp, lines, ['apply', '--confirm=CORTE'], AUTH), 1);
    assert.match(lines.join('\n'), /BACKUP_OBRIGATORIO/);
    server.state.workflows[IDS.engine].versionId = 'alterado-por-outro';
    assert.equal(await run(server, tmp, lines, base, AUTH), 1);
    assert.match(lines.join('\n'), /VERSAO_DIVERGENTE_DO_BACKUP: engine/);
    assert.ok(!server.state.calls.some(isWrite), server.state.calls.join(','));
    // backup adulterado
    server.state.workflows[IDS.engine].versionId = 'v1-engine';
    const manifestFile = path.join(dir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    fs.appendFileSync(path.join(dir, manifest.workflows[0].file), ' ');
    assert.equal(await run(server, tmp, lines, base, AUTH), 1);
    assert.match(lines.join('\n'), /BACKUP_ADULTERADO/);
    assert.ok(!server.state.calls.some(isWrite));
  } finally { await server.close(); }
});

test('apply: backup velho e recusado', async () => {
  const server = await startServer();
  const { lines, tmp } = fresh();
  try {
    const dir = await backupOf(server, tmp);
    const code = await cutover.main(['apply', '--backup=' + dir, '--confirm=CORTE'], {
      root: ROOT, log: l => lines.push(l), now: () => new Date(Date.now() + 3 * 3600e3),
      env: { N8N_BASE_URL: server.url, N8N_API_KEY: KEY, NORIA_CUTOVER_BACKUP_DIR: tmp, ...AUTH },
    });
    assert.equal(code, 1);
    assert.match(lines.join('\n'), /BACKUP_ANTIGO/);
  } finally { await server.close(); }
});

test('falha no meio do apply + rollback devolve o estado inicial byte a byte', async () => {
  // Falha no PUT do roteador (ultimo passo): motor, Salon e EXTs ja foram trocados.
  const server = await startServer({ failOn: (sig, n) => sig === 'PUT /workflows/' + IDS.router && n === 1 });
  const { lines, tmp } = fresh();
  try {
    const initial = snapshot(server.state);
    const dir = await backupOf(server, tmp);
    const code = await run(server, tmp, lines, ['apply', '--backup=' + dir, '--confirm=CORTE'], AUTH);
    const out = lines.join('\n');
    assert.equal(code, 1, out);
    assert.match(out, /FALHA em "router"/);
    assert.match(out, /rollback --backup=/);
    assert.notEqual(snapshot(server.state), initial);
    lines.length = 0;
    assert.equal(await run(server, tmp, lines, ['rollback', '--backup=' + dir], AUTH), 1, 'rollback exige --confirm');
    assert.equal(await run(server, tmp, lines, ['rollback', '--backup=' + dir, '--confirm=CORTE'], AUTH), 0, lines.join('\n'));
    assert.equal(snapshot(server.state), initial);
    const ext = server.state.workflows.NovoExtNoria01;
    assert.equal(ext.active, false);
    assert.equal(ext.isArchived, true);
    assert.ok(server.state.workflows.NovoExtNoria01, 'EXT NORIA nao e apagada');
    assert.ok(!lines.join('\n').includes(KEY));
  } finally { await server.close(); }
});

test('falha no meio (motor) com --pause-router: rollback reativa o roteador original', async () => {
  const server = await startServer({ failOn: (sig, n) => sig === 'PUT /workflows/' + IDS.engine && n === 1 });
  const { lines, tmp } = fresh();
  try {
    const initial = snapshot(server.state);
    const dir = await backupOf(server, tmp);
    const code = await run(server, tmp, lines, ['apply', '--backup=' + dir, '--confirm=CORTE', '--pause-router'], AUTH);
    assert.equal(code, 1);
    assert.equal(server.state.workflows[IDS.router].active, false, 'roteador pausado durante a troca');
    assert.equal(await run(server, tmp, lines, ['rollback', '--backup=' + dir, '--confirm=CORTE'], AUTH), 0, lines.join('\n'));
    assert.equal(snapshot(server.state), initial);
  } finally { await server.close(); }
});

test('chave errada nao vaza e nao escreve', async () => {
  const server = await startServer();
  const { lines, tmp } = fresh();
  try {
    const code = await run(server, tmp, lines, ['check'], { N8N_API_KEY: 'outra-chave-secreta' });
    assert.equal(code, 1);
    assert.ok(!lines.join('\n').includes('outra-chave-secreta'));
  } finally { await server.close(); }
});

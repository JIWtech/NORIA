// Publicação pontual autorizada: verifica HEAD/versão ativa, altera só jsCode e preserva configuração live.
// node scripts/publish_noria_scoped.cjs <check|apply> <spec.json>
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const [mode = 'check', specPath] = process.argv.slice(2);
const normalize = text => String(text || '').replace(/\r\n/g, '\n').trimEnd();
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
const equal = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
const digest = code => crypto.createHash('sha256').update(normalize(code)).digest('hex');
const env = Object.fromEntries(fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)
  .filter(line => /^[A-Z0-9_]+=/.test(line)).map(line => {
    const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1).replace(/^["']|["']$/g, '')];
  }));
async function api(method, endpoint, body) {
  const response = await fetch(env.N8N_BASE_URL.replace(/\/$/, '') + '/api/v1' + endpoint, {
    method, headers: { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error(method + ' ' + endpoint + ' HTTP ' + response.status + ': ' + (await response.text()).slice(0, 500));
  return response.json();
}
async function prepare(spec) {
  const local = JSON.parse(fs.readFileSync(path.resolve(root, spec.file), 'utf8'));
  const head = JSON.parse(execFileSync('git', ['show', 'HEAD:' + spec.file], { cwd: root, encoding: 'utf8', maxBuffer: 8e6 }));
  const before = await api('GET', '/workflows/' + spec.id);
  if (!before.active || before.versionId !== before.activeVersionId || before.versionId !== spec.expectedVersion) throw Error('VERSION_GUARD: ' + spec.id);
  if (!equal(before.connections, head.connections)) throw Error('LIVE_CONNECTION_DRIFT: ' + spec.id);
  const changes = [];
  for (const node of local.nodes) {
    const prior = head.nodes.find(item => item.id === node.id);
    const live = before.nodes.find(item => item.id === node.id);
    if (!prior || !live) throw Error('NODE_ID_DRIFT: ' + node.id);
    if (typeof prior.parameters?.jsCode === 'string' && normalize(live.parameters?.jsCode) !== normalize(prior.parameters.jsCode)) throw Error('LIVE_CODE_DRIFT: ' + node.name);
    const strip = item => ({ ...item, parameters: { ...item.parameters, jsCode: undefined } });
    if (!equal(strip(node), strip(prior))) throw Error('OUT_OF_SCOPE_LOCAL_CHANGE: ' + node.name);
    if (normalize(node.parameters?.jsCode) !== normalize(prior.parameters?.jsCode)) {
      changes.push({ id: node.id, name: node.name, code: node.parameters.jsCode,
        oldSha256: digest(live.parameters.jsCode), newSha256: digest(node.parameters.jsCode) });
    }
  }
  if (before.nodes.length !== head.nodes.length || local.nodes.length !== head.nodes.length || !changes.length) throw Error('NODE_COUNT_OR_EMPTY_PATCH: ' + spec.id);
  const nodes = before.nodes.map(node => {
    const change = changes.find(item => item.id === node.id);
    return change ? { ...node, parameters: { ...node.parameters, jsCode: change.code } } : node;
  });
  return { spec, before, changes, body: { name: before.name, nodes, connections: before.connections, settings: before.settings } };
}
(async () => {
  if (!['check', 'apply'].includes(mode) || !specPath) throw Error('Usage: <check|apply> <spec.json>');
  if (mode === 'apply') {
    // A publicação nem consulta o plano de escrita se a regressão obrigatória falhar.
    execFileSync(process.execPath, [path.join(__dirname, 'validate_noria_release.cjs')], { cwd: root, stdio: 'inherit', timeout: 65000 });
  }
  const specs = JSON.parse(fs.readFileSync(path.resolve(root, specPath), 'utf8'));
  const prepared = [];
  for (const spec of specs) prepared.push(await prepare(spec));
  console.log(JSON.stringify(prepared.map(({ spec, before, changes }) => ({ id: spec.id, version: before.versionId,
    active: before.activeVersionId, changedNodes: changes.map(({ code, ...rest }) => rest) })), null, 2));
  if (mode === 'check') return;
  const backupRoot = path.join(root, '.local', 'deploy_backups', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(backupRoot, { recursive: true });
  for (const item of prepared) fs.writeFileSync(path.join(backupRoot, item.spec.id + '.json'), JSON.stringify(item.before), { mode: 0o600 });
  console.log('BACKUPS: ' + backupRoot);
  const receipts = [];
  for (const { spec, before, body, changes } of prepared) {
    const fresh = await api('GET', '/workflows/' + spec.id);
    if (fresh.versionId !== before.versionId || fresh.activeVersionId !== before.activeVersionId) throw Error('CONCURRENT_EDIT: ' + spec.id);
    await api('PUT', '/workflows/' + spec.id, body);
    let after = await api('GET', '/workflows/' + spec.id);
    if (after.activeVersionId !== after.versionId) {
      await api('POST', '/workflows/' + spec.id + '/activate');
      after = await api('GET', '/workflows/' + spec.id);
    }
    if (!after.active || after.versionId !== after.activeVersionId) throw Error('ACTIVE_VERSION_MISMATCH: ' + spec.id);
    const active = after.activeVersion?.nodes || after.nodes;
    if (!equal(after.connections, before.connections) || !equal(after.settings, before.settings)) throw Error('CONFIGURATION_CHANGED: ' + spec.id);
    for (const node of body.nodes) {
      const current = active.find(item => item.id === node.id);
      if (!current || !equal({ ...current, parameters: { ...current.parameters, jsCode: normalize(current.parameters?.jsCode) } },
        { ...node, parameters: { ...node.parameters, jsCode: normalize(node.parameters?.jsCode) } })) throw Error('ACTIVE_NODE_MISMATCH: ' + node.name);
    }
    const receipt = { id: spec.id, name: after.name, previousVersion: before.versionId, version: after.versionId,
      activeVersion: after.activeVersionId, verifiedAt: new Date().toISOString(), backup: path.join(backupRoot, spec.id + '.json'),
      nodes: changes.map(({ code, ...rest }) => rest) };
    receipts.push(receipt);
    fs.writeFileSync(path.join(backupRoot, 'receipts.json'), JSON.stringify(receipts, null, 2));
    console.log('VERIFIED: ' + JSON.stringify(receipt));
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });

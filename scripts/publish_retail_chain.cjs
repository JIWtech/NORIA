'use strict';
// Publicação autorizada da cadeia retail_v1 (JOYERÍA) no Motor e no Roteador do n8n.
// Uso: node scripts/publish_retail_chain.cjs <check|apply>
// Diferente de publish_exports_by_id.cjs, aceita nós NOVOS — mas só os da cadeia retail ("CORE | Retail | ...") — e
// mudança de conexões só nesses nós e no ponto de entrada declarado. Travas:
// (1) workflow ativo e sem rascunho divergente; (2) todo nó vivo existe no export com o mesmo desenho (só jsCode muda);
// (3) nenhum nó some; (4) backup completo antes de escrever; (5) depois do PUT, ativa e confere nós e conexões.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const mode = process.argv[2] || 'check';
const TARGETS = ['mlKNPv862H2g3Gap', '3N5oN6sxtir9lFrA'];
const NEW_NODE_PREFIX = 'CORE | Retail | ';
const ENTRY_NODES = ['CORE | É tenant NORIA?'];

const env = Object.fromEntries(fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)
  .filter(line => /^[A-Z0-9_]+=/.test(line)).map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1).replace(/^["']|["']$/g, '')]; }));
async function api(method, endpoint, body) {
  const response = await fetch(env.N8N_BASE_URL.replace(/\/$/, '') + '/api/v1' + endpoint, {
    method, headers: { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw Error(method + ' ' + endpoint + ' HTTP ' + response.status + ': ' + (await response.text()).slice(0, 400));
  return response.json();
}
const normalize = text => String(text || '').replace(/\r\n/g, '\n').trimEnd();
const sha = text => crypto.createHash('sha256').update(normalize(text)).digest('hex').slice(0, 12);
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}
const equal = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
const shape = node => { const { webhookId, ...rest } = { ...node, parameters: { ...node.parameters, jsCode: undefined } }; return rest; };
const fileFor = id => path.join(root, 'n8n/workflows', fs.readdirSync(path.join(root, 'n8n/workflows')).find(name => name.endsWith('--' + id + '.json')));

async function prepare(id) {
  const local = JSON.parse(fs.readFileSync(fileFor(id), 'utf8'));
  const live = await api('GET', '/workflows/' + id);
  if (!live.active || live.versionId !== live.activeVersionId) throw Error('VERSION_GUARD: ' + id);
  const report = { id, name: live.name, codeChanges: [], newNodes: [], connectionChanges: [] };
  for (const node of live.nodes) {
    const mine = local.nodes.find(item => item.id === node.id);
    if (!mine) throw Error('NODE_MISSING_LOCALLY: ' + id + ' / ' + node.name);
    if (!equal(shape(node), shape(mine))) throw Error('NODE_SHAPE_DIFFERS: ' + id + ' / ' + node.name);
    if (normalize(node.parameters?.jsCode) !== normalize(mine.parameters?.jsCode)) {
      report.codeChanges.push({ name: node.name, from: sha(node.parameters?.jsCode), to: sha(mine.parameters?.jsCode) });
    }
  }
  for (const node of local.nodes) {
    if (live.nodes.some(item => item.id === node.id)) continue;
    if (!node.name.startsWith(NEW_NODE_PREFIX)) throw Error('UNEXPECTED_NEW_NODE: ' + id + ' / ' + node.name);
    report.newNodes.push(node.name);
  }
  const keys = new Set([...Object.keys(live.connections), ...Object.keys(local.connections)]);
  for (const key of keys) {
    if (equal(live.connections[key], local.connections[key])) continue;
    if (!key.startsWith(NEW_NODE_PREFIX) && !ENTRY_NODES.includes(key)) throw Error('UNEXPECTED_CONNECTION_CHANGE: ' + id + ' / ' + key);
    report.connectionChanges.push(key);
  }
  // Ponto de entrada: cada destino antigo continua ligado direto ou passa a ser o "não" de um nó retail inserido no meio
  // (inserção do desvio retail; quem não é retail segue exatamente para onde ia).
  for (const key of ENTRY_NODES) {
    const beforeOut = (live.connections[key]?.main || []).map(group => (group || []).map(link => link.node));
    const afterOut = (local.connections[key]?.main || []).map(group => (group || []).map(link => link.node));
    beforeOut.forEach((targets, output) => targets.forEach(target => {
      const now = afterOut[output] || [];
      if (now.includes(target)) return;
      const inserted = now.find(name => name.startsWith(NEW_NODE_PREFIX)
        && (local.connections[name]?.main?.[1] || []).some(link => link.node === target));
      if (!inserted) throw Error('ENTRY_LOST_TARGET: ' + id + ' / ' + key + ' / ' + target);
      report.connectionChanges.push(key + ' [saída ' + output + ']: ' + target + ' agora via ' + inserted);
    }));
  }
  const nodes = local.nodes.map(node => {
    const prior = live.nodes.find(item => item.id === node.id);
    return prior ? { ...prior, parameters: { ...prior.parameters, jsCode: node.parameters?.jsCode ?? prior.parameters?.jsCode } } : node;
  });
  return { report, live, body: { name: live.name, nodes, connections: local.connections, settings: live.settings } };
}

(async () => {
  const prepared = [];
  for (const id of TARGETS) prepared.push(await prepare(id));
  console.log(JSON.stringify(prepared.map(p => p.report), null, 1));
  if (mode !== 'apply') return;
  const dir = path.join(root, '.local/deploy_backups', 'retail-joyeria-' + new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  for (const p of prepared) fs.writeFileSync(path.join(dir, p.report.id + '.json'), JSON.stringify(p.live, null, 2));
  const receipts = [];
  for (const p of prepared) {
    await api('PUT', '/workflows/' + p.report.id, p.body);
    await api('POST', '/workflows/' + p.report.id + '/activate');
    const after = await api('GET', '/workflows/' + p.report.id);
    if (!after.active || after.versionId !== after.activeVersionId) throw Error('POST_ACTIVATE_GUARD: ' + p.report.id);
    if (!equal(after.connections, p.body.connections)) throw Error('POST_CONNECTIONS_DIFFER: ' + p.report.id);
    for (const node of p.body.nodes) {
      const got = after.nodes.find(item => item.id === node.id);
      if (!got || normalize(got.parameters?.jsCode) !== normalize(node.parameters?.jsCode)) throw Error('POST_CODE_DIFFERS: ' + p.report.id + ' / ' + node.name);
    }
    receipts.push({ id: p.report.id, version: after.versionId, verifiedAt: new Date().toISOString(),
      nodes: p.body.nodes.filter(n => typeof n.parameters?.jsCode === 'string').map(n => ({ nodeId: n.id, to: crypto.createHash('sha256').update(normalize(n.parameters.jsCode)).digest('hex') })) });
  }
  fs.writeFileSync(path.join(dir, 'receipts.json'), JSON.stringify(receipts, null, 2));
  console.log('PUBLICADO; backup e recibos em', path.relative(root, dir));
})().catch(error => { console.error('ERRO:', error.message); process.exit(1); });

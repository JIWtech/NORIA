'use strict';
// Publicação autorizada dos exports locais (n8n/workflows/*.json, nomes por ID) no n8n.
// Uso: node scripts/publish_exports_by_id.cjs <check|apply>
// Travas: (1) backup completo de cada workflow publicado antes de qualquer escrita; (2) a versão ativa precisa ser igual ao
// export de referência anterior às correções (nada mudou no n8n desde então); (3) só jsCode muda — nós, conexões e settings
// do n8n são preservados e precisam coincidir com o export local; (4) depois do PUT, ativa e confere byte a byte.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const mode = process.argv[2] || 'check';
const WORKFLOWS_DIR = path.join(root, 'n8n/workflows');
const REFERENCE_DIR = path.join(WORKFLOWS_DIR, 'backup_pre_correcao_2026-11-12');
// A publicação de 05:51 UTC já avançou quatro workflows além do backup acima.
// Seus recibos são a referência imutável para esta publicação seguinte.
// Recibos de cada publicação anterior, do mais antigo ao mais recente: o último recibo de cada workflow é a versão esperada.
const PRIOR_RECEIPTS = fs.readdirSync(path.join(root, '.local/deploy_backups')).sort()
  .map(dir => path.join(root, '.local/deploy_backups', dir, 'receipts.json')).filter(file => fs.existsSync(file))
  .flatMap(file => JSON.parse(fs.readFileSync(file, 'utf8')))
  .reduce((latest, receipt) => ({ ...latest, [receipt.id]: receipt }), {});
// Ordem: sub-workflows antes do roteador que os chama.
const ALL = ['6jSiEH2ugboYSack', 'vCDXJLqIBCZJRTVv', 'fXGorIlPbyf9Qtsp', 'sLxNG9o2falquchd', 'mlKNPv862H2g3Gap', 'yxdKP0PeskDMUFSo', '3N5oN6sxtir9lFrA'];
// --only=id1,id2 restringe a publicação (os demais não são lidos nem tocados).
const only = (process.argv.find(arg => arg.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const ORDER = only.length ? ALL.filter(id => only.includes(id)) : ALL;

const normalize = text => String(text || '').replace(/\r\n/g, '\n').trimEnd();
const sha = text => crypto.createHash('sha256').update(normalize(text)).digest('hex');
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}
const equal = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
const withoutCode = node => ({ ...node, parameters: { ...node.parameters, jsCode: undefined } });
// Campos que o n8n acrescenta ou reordena e que não fazem parte do desenho do nó.
const shape = node => { const { webhookId, ...rest } = withoutCode(node); return rest; };

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
const fileFor = (dir, id) => { const f = fs.readdirSync(dir).find(name => name.endsWith('--' + id + '.json')); return f ? path.join(dir, f) : null; };

async function prepare(id) {
  const local = JSON.parse(fs.readFileSync(fileFor(WORKFLOWS_DIR, id), 'utf8'));
  const referencePath = fileFor(REFERENCE_DIR, id) || fileFor(WORKFLOWS_DIR, id);
  const reference = JSON.parse(fs.readFileSync(referencePath, 'utf8'));
  const live = await api('GET', '/workflows/' + id);
  const previousReceipt = PRIOR_RECEIPTS[id];
  if (!live.active || live.versionId !== live.activeVersionId) throw Error('VERSION_GUARD (inativo ou rascunho diferente do ativo): ' + id);
  if (previousReceipt && live.versionId !== previousReceipt.version) throw Error('PREVIOUS_PUBLICATION_VERSION_DRIFT: ' + id);
  if (!equal(live.connections, local.connections)) throw Error('CONNECTIONS_DIFFER (export local x n8n): ' + id);
  if (live.nodes.length !== local.nodes.length) throw Error('NODE_COUNT_DIFFERS: ' + id);
  const changes = [];
  for (const node of live.nodes) {
    const mine = local.nodes.find(item => item.id === node.id);
    const ref = reference.nodes.find(item => item.id === node.id);
    if (!mine || !ref) throw Error('NODE_ID_DRIFT: ' + id + ' / ' + node.name);
    if (!equal(shape(node), shape(mine))) throw Error('NODE_SHAPE_DIFFERS (só jsCode pode mudar): ' + id + ' / ' + node.name);
    if (typeof node.parameters?.jsCode !== 'string') continue;
    const previousHash = previousReceipt?.nodes?.find(item => item.nodeId === node.id)?.to || sha(ref.parameters.jsCode);
    if (sha(node.parameters.jsCode) !== previousHash) throw Error('LIVE_CODE_DRIFT (n8n mudou desde o export): ' + id + ' / ' + node.name);
    if (sha(node.parameters.jsCode) !== sha(mine.parameters.jsCode)) {
      changes.push({ nodeId: node.id, name: node.name, code: mine.parameters.jsCode, from: sha(node.parameters.jsCode), to: sha(mine.parameters.jsCode) });
    }
  }
  const nodes = live.nodes.map(node => { const c = changes.find(item => item.nodeId === node.id); return c ? { ...node, parameters: { ...node.parameters, jsCode: c.code } } : node; });
  return { id, live, changes, body: { name: live.name, nodes, connections: live.connections, settings: live.settings } };
}

(async () => {
  if (!['check', 'apply'].includes(mode)) throw Error('Uso: <check|apply>');
  const backupRoot = path.join(root, '.local', 'deploy_backups', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(backupRoot, { recursive: true });
  const prepared = [];
  for (const id of ORDER) {
    const item = await prepare(id);
    fs.writeFileSync(path.join(backupRoot, id + '.json'), JSON.stringify(item.live, null, 2), { mode: 0o600 });
    prepared.push(item);
  }
  console.log('BACKUPS: ' + backupRoot);
  for (const { id, live, changes } of prepared) {
    console.log(id, live.name, 'versão', live.versionId, changes.length ? 'muda: ' + changes.map(c => c.name).join(', ') : 'sem mudança');
  }
  if (mode === 'check') return;
  const receipts = [];
  for (const { id, live, changes, body } of prepared) {
    if (!changes.length) continue;
    const fresh = await api('GET', '/workflows/' + id);
    if (fresh.versionId !== live.versionId || fresh.activeVersionId !== live.activeVersionId) throw Error('CONCURRENT_EDIT: ' + id);
    await api('PUT', '/workflows/' + id, body);
    let after = await api('GET', '/workflows/' + id);
    if (after.activeVersionId !== after.versionId) { await api('POST', '/workflows/' + id + '/activate'); after = await api('GET', '/workflows/' + id); }
    if (!after.active || after.versionId !== after.activeVersionId) throw Error('ACTIVE_VERSION_MISMATCH: ' + id);
    if (!equal(after.connections, live.connections)) throw Error('CONNECTIONS_CHANGED: ' + id);
    const active = after.activeVersion?.nodes || after.nodes;
    for (const c of changes) {
      const node = active.find(item => item.id === c.nodeId);
      if (!node || sha(node.parameters?.jsCode) !== c.to) throw Error('ACTIVE_CODE_MISMATCH: ' + id + ' / ' + c.name);
    }
    const receipt = { id, name: after.name, previousVersion: live.versionId, version: after.versionId, verifiedAt: new Date().toISOString(),
      backup: path.join(backupRoot, id + '.json'), nodes: changes.map(({ code, ...rest }) => rest) };
    receipts.push(receipt);
    fs.writeFileSync(path.join(backupRoot, 'receipts.json'), JSON.stringify(receipts, null, 2));
    console.log('PUBLICADO E CONFERIDO: ' + id + ' ' + after.name + ' ' + live.versionId + ' -> ' + after.versionId);
  }
})().catch(error => { console.error('ERRO: ' + error.message); process.exitCode = 1; });

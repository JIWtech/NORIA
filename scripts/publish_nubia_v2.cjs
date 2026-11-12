#!/usr/bin/env node
// Preflight e publicação da cadeia Núbia v2 no n8n.
// O ID da EXT v2 NUNCA vem do repositório: é resolvido pelo NOME do workflow na instância de destino, no momento da publicação.
// Padrão = simulação (não altera nada no n8n): lê a instância, confere o CORE vivo contra o repositório, grava backups verificáveis
// e o artefato do CORE com a cadeia habilitada e o ID resolvido. `--apply` só roda com NORIA_PUBLISH_AUTHORIZED=1 e sem divergência.
//   N8N_API_URL=<.../api/v1> N8N_API_KEY=... node scripts/publish_nubia_v2.cjs [--out=dir]
//   NORIA_PUBLISH_AUTHORIZED=1 ... node scripts/publish_nubia_v2.cjs --apply
// Esta etapa NÃO ativa a Núbia v2: a seleção do contrato 2.0 é tenant_settings.noria_turn_pipeline (docs/operations/nubia_v2_cutover.md).
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const args = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const CORE_FILE = 'NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json';
const EXT_FILE = 'NORIA EXT _ NB Bronze _ Serviços v2.json';
const LIVE_EXT_FILES = ['NORIA EXT _ Gênesis _ Política comercial v2 (1).json', 'NORIA EXT _ NB Bronze _ Política de negócio v2.json'];
const PLACEHOLDER = 'PREENCHER_ID_EXT_NUBIA_V2';
const EXT_NODES = ['CORE | Serviços | Executar EXT bootstrap', 'CORE | Serviços | Executar EXT decisão', 'CORE | Serviços | Executar EXT reavaliação'];
const CHAIN_PREFIX = 'CORE | Serviços | ';
const GATE = 'CORE | Serviços | Núbia v2?';
const ROUTER_NODE = 'CORE - Resolver extensão do tenant';
const read = file => JSON.parse(fs.readFileSync(path.join(root, 'n8n/workflows', file), 'utf8'));
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
// JSON com chaves ordenadas: o n8n devolve os mesmos campos em outra ordem, e isso não é diferença.
const stable = value => Array.isArray(value) ? value.map(stable)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const canonical = value => JSON.stringify(stable(value));

async function api(method, endpoint, body) {
  const base = String(process.env.N8N_API_URL || '').replace(/\/$/, '');
  if (!base || !process.env.N8N_API_KEY) throw new Error('N8N_API_URL e N8N_API_KEY são obrigatórios');
  const response = await fetch(base + endpoint, { method, headers: { 'X-N8N-API-KEY': process.env.N8N_API_KEY, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!response.ok) throw new Error(method + ' ' + endpoint + ' -> HTTP ' + response.status);
  return response.json();
}
const byName = async name => ((await api('GET', '/workflows?name=' + encodeURIComponent(name))).data || []).filter(item => item.name === name);
const stripped = workflow => ({ name: workflow.name, nodes: workflow.nodes, connections: workflow.connections, settings: workflow.settings || {} });

// Pure: builds the publishable CORE from the repository one. Throws on any broken invariant.
function assertLegacyArchitecture(core) {
  if (core.nodes.some(node => node.name === 'CORE | Executar EXT NORIA')) throw new Error('NORIA_PARENT_ARCHITECTURE_REVIEW_REQUIRED');
}

function buildArtifact(core, extId) {
  assertLegacyArchitecture(core);
  const artifact = JSON.parse(JSON.stringify(core));
  const chain = artifact.nodes.filter(node => node.name.startsWith(CHAIN_PREFIX));
  if (chain.length !== 13) throw new Error('CHAIN_INCOMPLETE: ' + chain.length);
  for (const node of chain) delete node.disabled;
  for (const name of EXT_NODES) {
    const node = artifact.nodes.find(item => item.name === name);
    // O repositório traz o marcador ou o mesmo ID resolvido pelo nome; qualquer outro ID é recusado.
    const current = node?.parameters?.workflowId?.value;
    if (!node || (current !== PLACEHOLDER && current !== String(extId))) throw new Error('UNEXPECTED_EXT_NODE: ' + name);
    node.parameters.workflowId = { __rl: true, value: String(extId), mode: 'id' };
  }
  if (JSON.stringify(artifact).includes(PLACEHOLDER)) throw new Error('PLACEHOLDER_LEFT');
  if (artifact.nodes.find(node => node.name === GATE)?.disabled === true) throw new Error('GATE_DISABLED');
  return artifact;
}

// Pure: what the instance has that the repository does not know. Anything unexpected would be overwritten by --apply.
// Expected differences are only the generated code of the CORE nodes and the router connection (repository = target state).
function diffWorkflows(live, repo) {
  const own = node => node.name.startsWith(CHAIN_PREFIX);
  const L = new Map(live.nodes.map(node => [node.name, node])), R = new Map(repo.nodes.filter(node => !own(node)).map(node => [node.name, node]));
  const strip = node => canonical({ ...node, parameters: { ...node.parameters, jsCode: undefined }, position: undefined, id: undefined, webhookId: undefined });
  const onlyLive = [...L.keys()].filter(name => !R.has(name) && !own(L.get(name)));
  const onlyRepo = [...R.keys()].filter(name => !L.has(name));
  const common = [...R.keys()].filter(name => L.has(name));
  const paramDiff = common.filter(name => strip(L.get(name)) !== strip(R.get(name)));
  const codeChanged = common.filter(name => L.get(name).parameters?.jsCode !== R.get(name).parameters?.jsCode);
  const connectionKeys = [...new Set([...Object.keys(live.connections), ...Object.keys(repo.connections)])].filter(key => !key.startsWith(CHAIN_PREFIX));
  const connectionDiff = connectionKeys.filter(key => canonical(live.connections[key] || null) !== canonical(repo.connections[key] || null));
  const expectedConnection = connectionDiff.filter(key => key === ROUTER_NODE);
  const unexpected = [...onlyLive.map(name => 'node_only_in_instance:' + name), ...onlyRepo.map(name => 'node_only_in_repository:' + name),
    ...paramDiff.map(name => 'node_parameters_differ:' + name), ...connectionDiff.filter(key => !expectedConnection.includes(key)).map(key => 'connection_differs:' + key)];
  return { unexpected, code_changed: codeChanged, expected_connection_changes: expectedConnection };
}

// Verifiable backups: file + sha256 + node count, re-read and re-hashed after writing.
function writeBackups(out, items) {
  const dir = path.join(out, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const manifest = {};
  for (const [label, workflow] of items) {
    const text = JSON.stringify(workflow, null, 2) + '\n';
    const file = path.join(dir, label.replace(/[^A-Za-z0-9._-]+/g, '_') + '.json');
    fs.writeFileSync(file, text);
    manifest[path.basename(file)] = { sha256: sha(text), bytes: Buffer.byteLength(text), nodes: workflow.nodes.length, id: workflow.id || null, name: workflow.name };
  }
  fs.writeFileSync(path.join(dir, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
  for (const [name, entry] of Object.entries(manifest)) {
    const back = fs.readFileSync(path.join(dir, name), 'utf8');
    if (sha(back) !== entry.sha256 || JSON.parse(back).nodes.length !== entry.nodes) throw new Error('BACKUP_VERIFICATION_FAILED: ' + name);
  }
  return { dir, manifest };
}

async function main() {
  const core = read(CORE_FILE), ext = read(EXT_FILE);
  if (args.apply) assertLegacyArchitecture(core);
  const out = path.resolve(String(args.out || path.join(root, 'dist/nubia_v2_publication')));
  const authorized = process.env.NORIA_PUBLISH_AUTHORIZED === '1';
  if (args.apply && !authorized) throw new Error('NORIA_PUBLISH_AUTHORIZED=1 é obrigatório para --apply');
  const found = await byName(ext.name);
  if (found.length > 1) throw new Error('AMBIGUOUS_EXT_V2: ' + found.length + ' workflows com o nome ' + ext.name);
  const liveCoreList = await byName(core.name);
  if (liveCoreList.length !== 1) throw new Error('CORE_NOT_RESOLVED: ' + liveCoreList.length + ' workflows com o nome ' + core.name);
  const liveCore = await api('GET', '/workflows/' + liveCoreList[0].id);
  const report = diffWorkflows(liveCore, core);
  // Backups of what exists today: CORE, the router node and the EXTs that stay live (Gênesis, Núbia v1).
  const items = [['CORE_' + liveCoreList[0].id, liveCore], ['ROUTER_NODE', { name: ROUTER_NODE, nodes: [liveCore.nodes.find(node => node.name === ROUTER_NODE) || {}] }]];
  const liveExts = [];
  for (const file of LIVE_EXT_FILES) {
    const repoExt = read(file), list = await byName(repoExt.name);
    if (list.length === 1) { const full = await api('GET', '/workflows/' + list[0].id); items.push(['EXT_' + list[0].id, full]); liveExts.push({ name: repoExt.name, id: list[0].id }); }
    else report.unexpected.push('live_ext_not_resolved:' + repoExt.name + ':' + list.length);
  }
  const backups = writeBackups(out, items);
  const plan = ['EXTs vivas: ' + liveExts.map(item => item.name + '=' + item.id).join('; '), 'CORE vivo: ' + liveCoreList[0].id + '; nós de código gerados que mudam: ' + report.code_changed.length,
    'Backups verificados (sha256): ' + backups.dir];
  if (report.unexpected.length) {
    plan.push('DIVERGÊNCIA entre a instância e o repositório (--apply seria recusado): ' + report.unexpected.join(' | '));
    for (const line of plan) console.log(line);
    process.exitCode = 3;
    return;
  }
  let extId = found[0]?.id;
  if (!extId) {
    if (!args.apply) { for (const line of plan) console.log(line); console.log('EXT v2 ausente: seria criada com --apply. Artefato NÃO gerado (sem ID real).'); process.exitCode = 2; return; }
    extId = (await api('POST', '/workflows', stripped(ext))).id;
    await api('POST', '/workflows/' + extId + '/activate');
    plan.push('EXT v2 criada e ativada: ' + extId);
  } else plan.push('EXT v2 existente resolvida por nome: ' + extId);
  const artifact = buildArtifact(core, extId);
  fs.writeFileSync(path.join(out, CORE_FILE), JSON.stringify(artifact, null, 2) + '\n');
  plan.push('Artefato: ' + path.join(out, CORE_FILE));
  if (args.apply) {
    await api('PUT', '/workflows/' + liveCoreList[0].id, stripped(artifact));
    plan.push('CORE atualizado (' + liveCoreList[0].id + '). Reversão: PUT do backup ' + path.join(backups.dir, 'CORE_' + liveCoreList[0].id + '.json'));
  } else plan.push('Simulação: nada foi alterado no n8n.');
  for (const line of plan) console.log(line);
}

module.exports = { buildArtifact, diffWorkflows, writeBackups, PLACEHOLDER, EXT_NODES };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });

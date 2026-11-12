// Publicador do corte da divisão do CORE (roteador leve + motor único + EXT NORIA própria).
// node scripts/publish_noria_cutover.cjs <plan|check|backup|apply|rollback> [--backup=<pasta>] [--confirm=CORTE] [--pause-router]
// plan: offline. check/backup: somente GET. apply/rollback: escrevem e exigem NORIA_PUBLISH_AUTHORIZED=1 e --confirm=CORTE.
// Configuração: N8N_BASE_URL (ou --base-url=) e N8N_API_KEY (só por ambiente). Este arquivo nunca lê .env.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const CONFIRM = 'CORTE';
const MAX_BACKUP_AGE_MIN = 120;
const IDS = { engine: 'mlKNPv862H2g3Gap', router: '3N5oN6sxtir9lFrA', salon: 'yxdKP0PeskDMUFSo', genesis: 'fXGorIlPbyf9Qtsp', nb: '6jSiEH2ugboYSack' };
const FILES = {
  noria: 'NORIA EXT _ NORIA _ Política.json',
  genesis: 'NORIA EXT _ Gênesis _ Política comercial v2 (1).json',
  nb: 'NORIA EXT _ NB Bronze.json',
  engine: 'NORIA CORE _ Motor conversacional.json',
  router: 'NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json',
};
const NAMES = {
  noria: 'NORIA EXT | NORIA | Política',
  genesis: 'NORIA EXT | Gênesis | Política comercial v2',
  nb: 'NORIA EXT | NB Bronze',
  engine: 'NORIA CORE | Motor de Atendimento',
  router: 'NORIA CORE | Roteador WhatsApp, Comandos e Follow-ups',
};
// Ordem de aplicação. A do rollback é a inversa (o roteador volta primeiro).
const ORDER = ['noria', 'genesis', 'nb', 'salon', 'engine', 'router'];
const NORIA_NODE = 'CORE | Executar EXT NORIA';
const ENGINE_COPY_NODE = 'CORE | Motor conversacional';
const PHASE_NODES = ['CORE | Preparar resposta', 'CORE | Finalizar resposta', 'CORE | Serviços | Preparar resposta',
  'CORE | Serviços | Verificar disponibilidade', 'CORE | Serviços | Finalizar resposta'];
const MARKER = 'PREENCHER_ID_EXT_NORIA';
const WRITE_KEYS = ['name', 'nodes', 'connections', 'settings'];

const stable = v => Array.isArray(v) ? v.map(stable)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
const canonical = v => JSON.stringify(stable(v === undefined ? null : v));
const sha = v => crypto.createHash('sha256').update(typeof v === 'string' || Buffer.isBuffer(v) ? v : canonical(v)).digest('hex');
const clone = v => JSON.parse(JSON.stringify(v));
// Todo campo esperado precisa existir igual no vivo; o vivo pode ter campos extras (padrões do n8n).
function subset(expected, actual) {
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.length === actual.length && expected.every((x, i) => subset(x, actual[i]));
  if (expected && typeof expected === 'object') return !!actual && typeof actual === 'object' && Object.keys(expected).every(k => subset(expected[k], actual[k]));
  return expected === actual;
}
const body = w => Object.fromEntries(WRITE_KEYS.map(k => [k, w[k]]));
const credTypes = node => Object.keys(node.credentials || {}).sort();

// ---------- Artefatos ----------
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); }

function loadArtifacts(root) {
  const dir = path.join(root, 'n8n', 'workflows');
  const arts = {};
  for (const key of Object.keys(FILES)) {
    const file = path.join(dir, FILES[key]);
    let wf;
    try { wf = readJson(file); } catch (e) { throw new Error('ARTEFATO_INVALIDO: ' + FILES[key] + ' (' + e.message.slice(0, 80) + ')'); }
    arts[key] = { key, file: FILES[key], workflow: wf, sha256: sha(body(wf)) };
  }
  const { buildSalonEngine } = require(path.join(root, 'clients', 'ic_saloon', 'build_conversation_adapter.cjs'));
  const salon = buildSalonEngine(clone(arts.engine.workflow));
  arts.salon = { key: 'salon', file: '(gerado de ' + FILES.engine + ')', workflow: salon, sha256: sha(body(salon)) };
  return arts;
}

function validateArtifacts(arts) {
  const errors = [];
  const bad = msg => errors.push(msg);
  for (const key of Object.keys(NAMES)) if (arts[key].workflow.name !== NAMES[key]) bad('NOME_INESPERADO: ' + key + ' = ' + arts[key].workflow.name);
  const engine = arts.engine.workflow, router = arts.router.workflow;
  const copies = engine.nodes.filter(n => n.name === ENGINE_COPY_NODE);
  if (copies.length !== 1 || copies[0].type !== 'n8n-nodes-base.code') bad('MOTOR_COPIAS: esperado exatamente 1 cópia de "' + ENGINE_COPY_NODE + '", achei ' + copies.length);
  if (router.nodes.some(n => n.name === ENGINE_COPY_NODE)) bad('ROTEADOR_COM_MOTOR_EMBUTIDO');
  if (router.nodes.some(n => (n.parameters?.jsCode || '').length > 100 * 1024)) bad('ROTEADOR_COM_CODIGO_GRANDE: possível motor embutido');
  const idOf = name => { const n = router.nodes.find(x => x.name === name); return n?.type === 'n8n-nodes-base.executeWorkflow' ? n.parameters?.workflowId?.value : null; };
  const phaseIds = new Set(PHASE_NODES.map(idOf));
  if (phaseIds.size !== 1 || ![...phaseIds][0] || [...phaseIds][0] !== IDS.engine) bad('FASES_SEM_MOTOR_UNICO: as fases devem chamar ' + IDS.engine);
  const single = idOf('CORE | Motor conversacional único');
  if (typeof single !== 'string' || !single.includes(IDS.engine) || !single.includes(IDS.salon)) bad('MOTOR_UNICO_SEM_ROTA_SALON');
  const noria = router.nodes.find(n => n.name === NORIA_NODE);
  if (!noria) bad('ROTEADOR_SEM_NO_EXT_NORIA');
  else if (idOf(NORIA_NODE) === IDS.engine) bad('EXT_NORIA_COM_ID_DO_MOTOR');
  if (arts.noria.workflow.id) bad('EXT_NORIA_JA_TEM_ID_NO_ARTEFATO: ' + arts.noria.workflow.id);
  if (arts.noria.workflow.nodes.length < 2) bad('EXT_NORIA_INCOMPLETA');
  const names = new Set(), dup = [];
  for (const n of router.nodes) { if (names.has(n.name)) dup.push(n.name); names.add(n.name); }
  if (dup.length) bad('ROTEADOR_NOS_DUPLICADOS: ' + dup.join(', '));
  return errors;
}

// ---------- Mesclagem com o vivo ----------
function mergeNodes(artNodes, liveNodes) {
  const byName = new Map(liveNodes.map(n => [n.name, n]));
  return artNodes.map(node => {
    const live = byName.get(node.name);
    if (!live) return node;
    const out = { ...node, id: live.id };
    if (live.webhookId) out.webhookId = live.webhookId;
    if (live.credentials) out.credentials = { ...(node.credentials || {}), ...live.credentials };
    return out;
  });
}

function buildBody(key, art, live, extNoriaId) {
  const wf = clone(art.workflow);
  if (key === 'router') {
    const node = wf.nodes.find(n => n.name === NORIA_NODE);
    if (!extNoriaId || !node) throw new Error('ID_EXT_NORIA_AUSENTE');
    node.parameters.workflowId = { ...node.parameters.workflowId, value: extNoriaId, cachedResultUrl: '/workflow/' + extNoriaId };
    if (JSON.stringify(wf).includes(MARKER)) throw new Error('MARCADOR_EXT_NORIA_RESTANTE');
  }
  if (!live) return body(wf);
  return {
    name: key === 'salon' ? live.name : wf.name,
    nodes: mergeNodes(wf.nodes, live.nodes),
    connections: wf.connections,
    settings: live.settings || {},
  };
}

function drift(key, art, live) {
  const r = { key, id: live.id, blockers: [], warnings: [], info: [] };
  const a = art.workflow;
  const liveByName = new Map(live.nodes.map(n => [n.name, n]));
  const artByName = new Map(a.nodes.map(n => [n.name, n]));
  r.name = { live: live.name, artifact: key === 'salon' ? live.name : a.name };
  r.nodesAdded = a.nodes.filter(n => !liveByName.has(n.name)).map(n => n.name);
  r.nodesRemoved = live.nodes.filter(n => !artByName.has(n.name)).map(n => n.name);
  for (const n of live.nodes) {
    if (artByName.has(n.name)) continue;
    if (n.credentials) r.blockers.push('NO_REMOVIDO_COM_CREDENCIAL: ' + n.name + ' [' + credTypes(n).join(',') + ']');
    if (n.webhookId) r.blockers.push('NO_REMOVIDO_COM_WEBHOOK: ' + n.name);
  }
  r.credentials = [];
  r.webhooks = [];
  for (const n of a.nodes) {
    const l = liveByName.get(n.name);
    if (!l) continue;
    if (l.type !== n.type) r.blockers.push('TIPO_DO_NO_MUDOU: ' + n.name + ' ' + l.type + ' -> ' + n.type);
    const lc = credTypes(l), ac = credTypes(n);
    if (lc.length || ac.length) {
      r.credentials.push({ node: n.name, live: lc, artifact: ac });
      const onlyArt = ac.filter(t => !lc.includes(t));
      if (onlyArt.length) r.warnings.push('CREDENCIAL_SO_NO_ARTEFATO: ' + n.name + ' [' + onlyArt.join(',') + '] (ID do artefato pode nao existir)');
      if (lc.filter(t => !ac.includes(t)).length) r.info.push('credencial preservada do vivo: ' + n.name);
    }
    if (l.webhookId || n.webhookId) {
      r.webhooks.push({ node: n.name, webhookId: { live: l.webhookId || null, artifact: n.webhookId || null }, path: { live: l.parameters?.path ?? null, artifact: n.parameters?.path ?? null } });
      if (l.webhookId && n.parameters?.path !== l.parameters?.path) r.blockers.push('CAMINHO_DO_WEBHOOK_MUDOU: ' + n.name + ' ' + l.parameters?.path + ' -> ' + n.parameters?.path);
      if (l.webhookId && n.webhookId && n.webhookId !== l.webhookId) r.info.push('webhookId do vivo preservado: ' + n.name);
    }
  }
  const ls = Object.keys(live.settings || {}).sort(), as = Object.keys(a.settings || {}).sort();
  r.settings = { onlyLive: ls.filter(k => !as.includes(k)), onlyArtifact: as.filter(k => !ls.includes(k)),
    different: ls.filter(k => as.includes(k) && canonical(live.settings[k]) !== canonical(a.settings[k])) };
  r.settingsNote = 'settings do vivo serao preservados integralmente';
  r.state = { active: !!live.active, versionId: live.versionId, activeVersionId: live.activeVersionId, archived: !!live.isArchived };
  if (live.isArchived) r.blockers.push('WORKFLOW_VIVO_ARQUIVADO');
  r.staticDataKeys = Object.keys(live.staticData?.global || {});
  return r;
}

// ---------- API ----------
function makeApi(ctx) {
  const base = String(ctx.baseUrl || '').replace(/\/$/, '');
  const key = ctx.apiKey;
  if (!base || !key) throw new Error('CONFIG: defina N8N_BASE_URL e N8N_API_KEY no ambiente');
  const scrub = text => String(text).split(key).join('***');
  return async function api(method, endpoint, payload) {
    const f = ctx.fetch || fetch;
    const res = await f(base + '/api/v1' + endpoint, {
      method, headers: { 'X-N8N-API-KEY': key, 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload), signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(scrub(method + ' ' + endpoint + ' HTTP ' + res.status + ': ' + text.slice(0, 300)));
    return text ? JSON.parse(text) : {};
  };
}
const byName = async (api, name) => ((await api('GET', '/workflows?name=' + encodeURIComponent(name))).data || []).filter(w => w.name === name);

// ---------- Argumentos e contexto ----------
function parseArgs(argv) {
  const out = { mode: argv[0], flags: {} };
  for (const a of argv.slice(1)) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (!m) throw new Error('ARGUMENTO_INVALIDO: ' + a);
    out.flags[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}
function backupRoot(ctx) {
  const dir = ctx.env.NORIA_CUTOVER_BACKUP_DIR
    || path.join(ctx.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'NoriaHomologacao', 'cutover-backups');
  return path.resolve(dir);
}
const isInside = (child, parent) => { const r = path.relative(parent, child); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
function requireAuthorization(ctx, flags) {
  if (ctx.env.NORIA_PUBLISH_AUTHORIZED !== '1') throw new Error('NAO_AUTORIZADO: defina NORIA_PUBLISH_AUTHORIZED=1');
  if (flags.confirm !== CONFIRM) throw new Error('NAO_CONFIRMADO: passe --confirm=' + CONFIRM);
  if (typeof flags.backup !== 'string' || !flags.backup) throw new Error('BACKUP_OBRIGATORIO: passe --backup=<pasta>');
}
function loadBackup(dir) {
  const manifest = readJson(path.join(dir, 'manifest.json'));
  const items = {};
  for (const e of manifest.workflows) {
    const buf = fs.readFileSync(path.join(dir, e.file));
    if (sha(buf) !== e.sha256) throw new Error('BACKUP_ADULTERADO: ' + e.file);
    items[e.key] = { entry: e, workflow: JSON.parse(buf.toString('utf8')) };
  }
  return { manifest, items };
}

// ---------- Modos ----------
async function modePlan(ctx) {
  const arts = loadArtifacts(ctx.root);
  const errors = validateArtifacts(arts);
  const log = ctx.log;
  log('PLANO DO CORTE (offline)');
  const router = arts.router.workflow.nodes.find(n => n.name === NORIA_NODE);
  const cur = router?.parameters?.workflowId?.value;
  const rows = {
    noria: ['CRIAR e ATIVAR', '(novo; ID capturado na criacao)'],
    genesis: ['ATUALIZAR', IDS.genesis], nb: ['ATUALIZAR + renomear', IDS.nb],
    salon: ['ATUALIZAR (gerado do motor)', IDS.salon], engine: ['ATUALIZAR (nome + conteudo)', IDS.engine],
    router: ['ATUALIZAR por ultimo, com o ID real da EXT NORIA', IDS.router],
  };
  ORDER.forEach((k, i) => log((i + 1) + '. ' + k.padEnd(8) + ' ' + rows[k][0] + ' | id ' + rows[k][1] + ' | "' + arts[k].workflow.name
    + '" | ' + arts[k].workflow.nodes.length + ' nos | sha256 ' + arts[k].sha256.slice(0, 16) + ' | ' + arts[k].file));
  log('Roteador: no "' + NORIA_NODE + '" hoje aponta para ' + cur + (cur === MARKER ? ' (marcador)' : ' (ID do artefato, sera substituido pelo ID criado)'));
  log('Preservado do vivo no apply: credenciais por no, webhookId, id dos nos de mesmo nome, settings, staticData, tags.');
  log('Janela: entre o motor (5) e o roteador (6) coexistem motor novo e roteador antigo (ver docs). Opcao --pause-router desativa o roteador antes do motor do Salon e o reativa apos a troca.');
  if (errors.length) { errors.forEach(e => log('ERRO: ' + e)); log('PLANO REPROVADO (' + errors.length + ' erro(s))'); return 1; }
  log('PLANO OK');
  return 0;
}

async function fetchLive(api, arts) {
  const live = {};
  for (const k of ORDER) if (k !== 'noria') live[k] = await api('GET', '/workflows/' + IDS[k]);
  const noria = await byName(api, NAMES.noria);
  return { live, noria };
}

async function runCheck(ctx, api, arts) {
  const { live, noria } = await fetchLive(api, arts);
  const reports = [];
  let blocked = false;
  for (const k of ORDER) {
    if (k === 'noria') {
      const r = { key: k, blockers: noria.length ? ['EXT_NORIA_JA_EXISTE: ' + noria.map(w => w.id).join(',')] : [], warnings: [], info: [noria.length ? '' : 'nao existe (sera criada)'] };
      reports.push(r); continue;
    }
    reports.push(drift(k, arts[k], live[k]));
  }
  for (const r of reports) {
    ctx.log('== ' + r.key + (r.id ? ' (' + r.id + ')' : ''));
    if (r.name) ctx.log('  nome: "' + r.name.live + '" -> "' + r.name.artifact + '"');
    if (r.state) ctx.log('  estado: ativo=' + r.state.active + ' versao=' + r.state.versionId + ' versaoAtiva=' + r.state.activeVersionId);
    if (r.nodesAdded) ctx.log('  nos adicionados (' + r.nodesAdded.length + '): ' + r.nodesAdded.join(' | '));
    if (r.nodesRemoved) ctx.log('  nos removidos (' + r.nodesRemoved.length + '): ' + r.nodesRemoved.join(' | '));
    for (const c of r.credentials || []) ctx.log('  credenciais ' + c.node + ': vivo [' + c.live.join(',') + '] artefato [' + c.artifact.join(',') + ']');
    for (const w of r.webhooks || []) ctx.log('  webhook ' + w.node + ': webhookId ' + w.webhookId.live + ' -> ' + w.webhookId.artifact + '; path ' + w.path.live + ' -> ' + w.path.artifact);
    if (r.settings) ctx.log('  settings: so no vivo [' + r.settings.onlyLive + '] so no artefato [' + r.settings.onlyArtifact + '] diferentes [' + r.settings.different + '] (vivo preservado)');
    if (r.staticDataKeys) ctx.log('  staticData.global (preservado): ' + r.staticDataKeys.join(','));
    r.warnings.forEach(w => ctx.log('  AVISO: ' + w));
    r.info.filter(Boolean).forEach(w => ctx.log('  info: ' + w));
    r.blockers.forEach(b => { ctx.log('  BLOQUEIO: ' + b); blocked = true; });
  }
  return { live, noria, reports, blocked };
}

async function modeCheck(ctx) {
  const arts = loadArtifacts(ctx.root);
  const errors = validateArtifacts(arts);
  if (errors.length) { errors.forEach(e => ctx.log('ERRO: ' + e)); return 1; }
  const res = await runCheck(ctx, makeApi(ctx), arts);
  ctx.log(res.blocked ? 'CHECK REPROVADO (falha fechada)' : 'CHECK OK');
  return res.blocked ? 1 : 0;
}

async function modeBackup(ctx) {
  const api = makeApi(ctx);
  const root = backupRoot(ctx);
  if (isInside(root, ctx.root)) throw new Error('BACKUP_DENTRO_DO_REPOSITORIO: ' + root);
  const stamp = ctx.now().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(root, stamp);
  fs.mkdirSync(dir, { recursive: true });
  const entries = [];
  for (const k of ORDER) {
    if (k === 'noria') continue;
    const wf = await api('GET', '/workflows/' + IDS[k]);
    const text = JSON.stringify(wf, null, 2);
    const file = k + '_' + IDS[k] + '.json';
    fs.writeFileSync(path.join(dir, file), text, { mode: 0o600 });
    entries.push({ key: k, id: IDS[k], name: wf.name, active: !!wf.active, versionId: wf.versionId, activeVersionId: wf.activeVersionId,
      file, sha256: sha(Buffer.from(text, 'utf8')) });
  }
  const existing = await byName(api, NAMES.noria);
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ createdAt: ctx.now().toISOString(), baseUrl: new URL(ctx.baseUrl).origin,
    extNoriaExistingIds: existing.map(w => w.id), workflows: entries }, null, 2), { mode: 0o600 });
  ctx.log('BACKUP: ' + dir);
  entries.forEach(e => ctx.log('  ' + e.key + ' ' + e.id + ' versao ' + e.versionId + ' sha256 ' + e.sha256));
  return 0;
}

const statePath = dir => path.join(dir, 'apply-state.json');
function saveState(dir, state) { fs.writeFileSync(statePath(dir), JSON.stringify(state, null, 2), { mode: 0o600 }); }

async function settle(api, id, expected, wantActive) {
  let after = await api('GET', '/workflows/' + id);
  if (wantActive && (!after.active || after.activeVersionId !== after.versionId)) {
    await api('POST', '/workflows/' + id + '/activate');
    after = await api('GET', '/workflows/' + id);
  } else if (!wantActive && after.active) {
    await api('POST', '/workflows/' + id + '/deactivate');
    after = await api('GET', '/workflows/' + id);
  }
  if (!!after.active !== wantActive) throw new Error('ESTADO_ATIVO_DIVERGENTE: ' + id);
  if (wantActive && after.activeVersionId !== after.versionId) throw new Error('VERSAO_ATIVA_DIVERGENTE: ' + id);
  if (!subset(expected.nodes, after.nodes) || canonical(expected.connections) !== canonical(after.connections)
    || !subset(expected.settings, after.settings) || expected.name !== after.name) throw new Error('CONTEUDO_DIVERGENTE: ' + id);
  if (wantActive && after.activeVersion?.nodes && !subset(expected.nodes, after.activeVersion.nodes)) throw new Error('CONTEUDO_ATIVO_DIVERGENTE: ' + id);
  return after;
}

async function modeApply(ctx, flags) {
  requireAuthorization(ctx, flags);
  const arts = loadArtifacts(ctx.root);
  const errors = validateArtifacts(arts);
  if (errors.length) { errors.forEach(e => ctx.log('ERRO: ' + e)); return 1; }
  const dir = path.resolve(flags.backup);
  if (isInside(dir, ctx.root)) throw new Error('BACKUP_DENTRO_DO_REPOSITORIO');
  const { manifest, items } = loadBackup(dir);
  const ageMin = (ctx.now() - new Date(manifest.createdAt)) / 60000;
  if (!(ageMin >= -1 && ageMin <= MAX_BACKUP_AGE_MIN)) throw new Error('BACKUP_ANTIGO: ' + Math.round(ageMin) + ' min (max ' + MAX_BACKUP_AGE_MIN + ')');
  for (const k of ORDER) if (k !== 'noria' && !items[k]) throw new Error('BACKUP_INCOMPLETO: ' + k);
  const api = makeApi(ctx);
  const rollbackCmd = 'NORIA_PUBLISH_AUTHORIZED=1 node scripts/publish_noria_cutover.cjs rollback --backup="' + dir + '" --confirm=' + CONFIRM;
  const res = await runCheck(ctx, api, arts);
  for (const k of ORDER) {
    if (k === 'noria') continue;
    const e = items[k].entry, l = res.live[k];
    if (l.versionId !== e.versionId || l.activeVersionId !== e.activeVersionId) throw new Error('VERSAO_DIVERGENTE_DO_BACKUP: ' + k + ' (vivo ' + l.versionId + ', backup ' + e.versionId + ')');
  }
  if (res.blocked) { ctx.log('APPLY RECUSADO: o check tem bloqueios'); return 1; }

  const state = { startedAt: ctx.now().toISOString(), pauseRouter: !!flags['pause-router'], extNoriaId: null, extNoriaCreating: false, steps: {} };
  saveState(dir, state);
  const versions = Object.fromEntries(Object.entries(res.live).map(([k, w]) => [k, w.versionId]));
  const wasActive = Object.fromEntries(Object.entries(res.live).map(([k, w]) => [k, !!w.active]));
  let step = null;
  try {
    for (const k of ORDER) {
      step = k;
      if (k === 'salon' && state.pauseRouter && wasActive.router) {
        await api('POST', '/workflows/' + IDS.router + '/deactivate');
        state.routerPaused = true; saveState(dir, state);
        ctx.log('roteador desativado (janela de troca)');
      }
      if (k === 'noria') {
        state.extNoriaCreating = true; saveState(dir, state);
        const created = await api('POST', '/workflows', body(arts.noria.workflow));
        if (!created.id || Object.values(IDS).includes(created.id)) throw new Error('ID_EXT_NORIA_INVALIDO');
        state.extNoriaId = created.id; state.steps.noria = 'created'; saveState(dir, state);
        await api('POST', '/workflows/' + created.id + '/activate');
        await settle(api, created.id, body(arts.noria.workflow), true);
        state.steps.noria = 'done'; saveState(dir, state);
        ctx.log('OK noria criada e ativa: ' + created.id);
        continue;
      }
      const live = await api('GET', '/workflows/' + IDS[k]);
      if (live.versionId !== versions[k]) throw new Error('EDICAO_CONCORRENTE: ' + k);
      const payload = buildBody(k, arts[k], live, state.extNoriaId);
      state.steps[k] = 'started'; saveState(dir, state);
      await api('PUT', '/workflows/' + IDS[k], payload);
      const wantActive = k === 'router' ? wasActive.router : wasActive[k];
      const after = await settle(api, IDS[k], payload, wantActive);
      if (canonical(after.staticData ?? null) !== canonical(live.staticData ?? null)) throw new Error('STATICDATA_ALTERADO: ' + k);
      if (canonical(after.tags ?? null) !== canonical(live.tags ?? null)) throw new Error('TAGS_ALTERADAS: ' + k);
      state.steps[k] = 'done'; saveState(dir, state);
      ctx.log('OK ' + k + ' ' + IDS[k] + ' versao ' + live.versionId + ' -> ' + after.versionId + ' sha256 ' + sha(body(after)).slice(0, 16));
    }
  } catch (error) {
    ctx.log('FALHA em "' + step + '": ' + error.message);
    ctx.log('APPLY INTERROMPIDO. Para reverter:');
    ctx.log('  ' + rollbackCmd);
    return 1;
  }
  ctx.log('APPLY CONCLUIDO. EXT NORIA = ' + state.extNoriaId + '. Verifique conforme docs/operations/noria_core_parent_migration.md.');
  ctx.log('Reverter, se necessario: ' + rollbackCmd);
  return 0;
}

async function modeRollback(ctx, flags) {
  requireAuthorization(ctx, flags);
  const dir = path.resolve(flags.backup);
  if (isInside(dir, ctx.root)) throw new Error('BACKUP_DENTRO_DO_REPOSITORIO');
  const { items } = loadBackup(dir);
  const api = makeApi(ctx);
  const state = fs.existsSync(statePath(dir)) ? readJson(statePath(dir)) : null;
  let failed = 0;
  const attempt = async (label, fn) => {
    try { await fn(); ctx.log('OK ' + label); } catch (e) { failed++; ctx.log('FALHA ' + label + ': ' + e.message); }
  };
  for (const k of [...ORDER].reverse()) {
    if (k === 'noria') continue;
    if (state && !state.steps[k] && !(k === 'router' && state.routerPaused)) { ctx.log('pulado ' + k + ' (nao iniciado)'); continue; }
    await attempt('rollback ' + k + ' ' + IDS[k], async () => {
      const { entry, workflow } = items[k];
      const payload = body(workflow);
      await api('PUT', '/workflows/' + IDS[k], payload);
      const after = await settle(api, IDS[k], payload, entry.active);
      if (canonical(after.staticData ?? null) !== canonical(workflow.staticData ?? null)) throw new Error('STATICDATA_DIVERGENTE');
    });
  }
  let extIds = state?.extNoriaId ? [state.extNoriaId] : [];
  if (!extIds.length && (!state || state.extNoriaCreating)) {
    const manifest = readJson(path.join(dir, 'manifest.json'));
    try { extIds = (await byName(api, NAMES.noria)).map(w => w.id).filter(id => !(manifest.extNoriaExistingIds || []).includes(id)); } catch (e) { failed++; ctx.log('FALHA busca da EXT NORIA: ' + e.message); }
  }
  for (const id of extIds) {
    await attempt('desativar EXT NORIA ' + id, async () => {
      await api('POST', '/workflows/' + id + '/deactivate');
      const w = await api('GET', '/workflows/' + id);
      if (w.active) throw new Error('AINDA_ATIVA');
    });
    await attempt('arquivar EXT NORIA ' + id + ' (nao apaga)', () => api('POST', '/workflows/' + id + '/archive'));
  }
  ctx.log(failed ? 'ROLLBACK COM ' + failed + ' FALHA(S): intervenha manualmente com o backup ' + dir : 'ROLLBACK CONCLUIDO');
  return failed ? 1 : 0;
}

async function main(argv, partial = {}) {
  const env = partial.env || process.env;
  const args = parseArgs(argv);
  const ctx = {
    root: partial.root || ROOT, env,
    baseUrl: args.flags['base-url'] || env.N8N_BASE_URL, apiKey: env.N8N_API_KEY,
    fetch: partial.fetch, now: partial.now || (() => new Date()), log: partial.log || (line => console.log(line)),
  };
  const modes = { plan: modePlan, check: modeCheck, backup: modeBackup, apply: modeApply, rollback: modeRollback };
  if (!modes[args.mode]) { ctx.log('Uso: <plan|check|backup|apply|rollback> [--backup=<pasta>] [--confirm=CORTE] [--pause-router]'); return 2; }
  const log = ctx.log;
  ctx.log = line => log(ctx.apiKey ? String(line).split(ctx.apiKey).join('***') : line);
  try { return await modes[args.mode](ctx, args.flags); } catch (e) { ctx.log('ERRO: ' + e.message); return 1; }
}

module.exports = { main, loadArtifacts, validateArtifacts, buildBody, drift, IDS, NAMES, ORDER };
if (require.main === module) main(process.argv.slice(2)).then(code => { process.exitCode = code; });

'use strict';
// Compara cada workflow ativo no n8n com o export local (n8n/workflows/*--<id>.json), só leitura.
// Ignora o carimbo de build (coreBuildMetadata/core_revision) e campos que o n8n acrescenta (webhookId, versionId etc.).
// Uso: node scripts/compare_live_workflows.cjs [--save=<pasta>]  (salva o JSON ativo de cada workflow)
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const WORKFLOWS_DIR = path.join(root, 'n8n/workflows');
const save = (process.argv.find(arg => arg.startsWith('--save=')) || '').slice(7);
const env = Object.fromEntries(fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)
  .filter(line => /^[A-Z0-9_]+=/.test(line)).map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1).replace(/^["']|["']$/g, '')]; }));
const api = async endpoint => {
  const response = await fetch(env.N8N_BASE_URL.replace(/\/$/, '') + '/api/v1' + endpoint, { headers: { 'X-N8N-API-KEY': env.N8N_API_KEY }, signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw Error(endpoint + ' HTTP ' + response.status);
  return response.json();
};
const stamp = code => String(code || '').replace(/\r\n/g, '\n').trimEnd()
  .replace(/const coreBuildMetadata = \{[\s\S]*?\};/g, 'const coreBuildMetadata = {};')
  .replace(/core_revision: '[^']*'/g, "core_revision: ''");
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}
const same = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
const shape = node => { const { webhookId, parameters, ...rest } = node; return { ...rest, parameters: { ...parameters, jsCode: undefined } }; };

(async () => {
  const files = fs.readdirSync(WORKFLOWS_DIR).filter(name => /--[A-Za-z0-9]{16}\.json$/.test(name));
  let differences = 0;
  if (save) fs.mkdirSync(save, { recursive: true });
  for (const file of files) {
    const id = file.match(/--([A-Za-z0-9]{16})\.json$/)[1];
    const local = JSON.parse(fs.readFileSync(path.join(WORKFLOWS_DIR, file), 'utf8'));
    const live = await api('/workflows/' + id);
    if (save) fs.writeFileSync(path.join(save, file), JSON.stringify(live, null, 2));
    const notes = [];
    if (live.name !== local.name) notes.push('nome: n8n="' + live.name + '" local="' + local.name + '"');
    if (live.active !== local.active) notes.push('active: n8n=' + live.active + ' local=' + local.active);
    if (live.versionId !== live.activeVersionId) notes.push('rascunho no n8n diferente da versão ativa');
    if (!same(live.connections, local.connections)) notes.push('conexões diferentes');
    if (!same(live.settings, local.settings)) notes.push('settings diferentes');
    const ids = new Set([...live.nodes, ...local.nodes].map(node => node.id));
    for (const nodeId of ids) {
      const a = live.nodes.find(node => node.id === nodeId), b = local.nodes.find(node => node.id === nodeId);
      if (!a || !b) { notes.push('nó só no ' + (a ? 'n8n' : 'local') + ': ' + (a || b).name); continue; }
      if (!same(shape(a), shape(b))) notes.push('nó com configuração diferente: ' + a.name);
      if (stamp(a.parameters?.jsCode) !== stamp(b.parameters?.jsCode)) notes.push('código diferente: ' + a.name);
    }
    differences += notes.length;
    console.log((notes.length ? 'DIFERENTE ' : 'igual     ') + id + '  ' + live.name + '  (n8n atualizado ' + live.updatedAt + ')');
    for (const note of notes) console.log('    - ' + note);
  }
  console.log(differences ? '\n' + differences + ' diferença(s).' : '\nNenhuma diferença fora do carimbo de build.');
  process.exitCode = differences ? 1 : 0;
})().catch(error => { console.error('ERRO: ' + error.message); process.exitCode = 2; });

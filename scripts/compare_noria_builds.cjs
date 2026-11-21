// Uso: node scripts/compare_noria_builds.cjs <baseline> <candidato> [--list-changes]
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const [baseline, candidate] = process.argv.slice(2);
const listChanges = process.argv.includes('--list-changes');
if (!baseline || !candidate) throw new Error('Informe os diretórios baseline e candidato');
const normalize = value => value.replace(/const coreBuildMetadata = \{[\s\S]*?\};/g, '<METADATA>');
const clean = value => {
  if (typeof value === 'string') return normalize(value);
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)]));
  return value;
};
const read = (root, file) => fs.readFileSync(path.join(root, file), 'utf8');
const hash = text => crypto.createHash('sha256').update(normalize(text)).digest('hex');
const workflowDir = 'n8n/workflows';
const workflowFiles = root => fs.readdirSync(path.join(root, workflowDir)).filter(file => file.endsWith('.json')).sort();
assert.deepEqual(workflowFiles(baseline), workflowFiles(candidate), 'Conjuntos de workflows diferentes');
let nodeCount = 0;
let changedCount = 0;
const withoutCode = workflow => {
  const copy = structuredClone(workflow);
  for (const node of copy.nodes) {
    if (typeof node.parameters?.jsCode === 'string') node.parameters.jsCode = '<JSCODE>';
  }
  return copy;
};
for (const file of workflowFiles(baseline)) {
  const relative = path.join(workflowDir, file);
  const original = JSON.parse(read(baseline, relative));
  const next = JSON.parse(read(candidate, relative));
  if (listChanges) {
    // O modo de inventário permite refatorar código, mas preserva a estrutura inteira.
    assert.deepEqual(withoutCode(original), withoutCode(next), `${relative}: alteração fora de jsCode`);
    const changed = [];
    for (let index = 0; index < original.nodes.length; index++) {
      const before = original.nodes[index];
      const after = next.nodes[index];
      if (typeof before.parameters?.jsCode !== 'string') continue;
      if (normalize(before.parameters.jsCode) !== normalize(after.parameters.jsCode)) {
        changed.push({ id: before.id, name: before.name,
          baseline_sha256: hash(before.parameters.jsCode), candidate_sha256: hash(after.parameters.jsCode) });
      }
    }
    changedCount += changed.length;
    console.log(JSON.stringify({ workflow: file, changed_jsCode: changed }));
  } else {
    assert.deepEqual(clean(original), clean(next), relative);
  }
  nodeCount += original.nodes.filter(node => typeof node.parameters?.jsCode === 'string').length;
}
for (const file of ['n8n/code/whatsapp_conversation_core.generated.js', 'n8n/code/whatsapp_sales.js']) {
  const original = read(baseline, file);
  const next = read(candidate, file);
  if (!listChanges) assert.equal(normalize(original), normalize(next), file);
  console.log(`${file}: baseline=${hash(original)} candidato=${hash(next)} versionado=${hash(read(path.resolve(__dirname, '..'), file))}`);
}
console.log(listChanges
  ? `${workflowFiles(baseline).length} workflows, ${nodeCount} jsCode, ${changedCount} alterados; estrutura preservada após normalizar metadados`
  : `${workflowFiles(baseline).length} workflows e ${nodeCount} jsCode iguais após normalizar metadados`);

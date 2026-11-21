// Uso: node scripts/compare_noria_builds.cjs <baseline> <candidato>
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const [baseline, candidate] = process.argv.slice(2);
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
for (const file of workflowFiles(baseline)) {
  const relative = path.join(workflowDir, file);
  const original = JSON.parse(read(baseline, relative));
  assert.deepEqual(clean(original), clean(JSON.parse(read(candidate, relative))), relative);
  nodeCount += original.nodes.filter(node => typeof node.parameters?.jsCode === 'string').length;
}
for (const file of ['n8n/code/whatsapp_conversation_core.generated.js', 'n8n/code/whatsapp_sales.js']) {
  const original = read(baseline, file);
  assert.equal(normalize(original), normalize(read(candidate, file)), file);
  console.log(`${file}: baseline=${hash(original)} versionado=${hash(read(path.resolve(__dirname, '..'), file))}`);
}
console.log(`${workflowFiles(baseline).length} workflows e ${nodeCount} jsCode iguais após normalizar metadados`);

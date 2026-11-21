'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../../app/node_modules/typescript');
const root = path.resolve(__dirname, '../..');
const parsed = new Map();
function readSource(file = 'n8n/sources/noria_core.js') {
  return fs.readFileSync(path.resolve(root, file), 'utf8');
}
function declarations(source, names) {
  let ast = parsed.get(source);
  if (!ast) {
    ast = ts.createSourceFile('source.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    parsed.set(source, ast);
  }
  const functions = ast.statements.filter(ts.isFunctionDeclaration);
  if (!names) return functions.map(node => node.getText(ast)).join('\n');
  return names.map(name => {
    const node = functions.find(item => item.name?.text === name);
    if (!node) throw new Error(`Função ${name} ausente na fonte`);
    return node.getText(ast);
  }).join('\n');
}
function loadFunctions(source, names, globals = {}) {
  const context = vm.createContext({ ...globals });
  vm.runInContext(declarations(source, names), context);
  return context;
}
async function loadCoreEngine(names) {
  const { syncRetailRegion } = require('./retail_region.cjs');
  const code = "const NORIA_NODE_PHASE = 'single';\n" + syncRetailRegion(readSource(), readSource('n8n/sources/noria_retail.js'));
  const hook = /try \{\r?\n\s*const turnResult = await runTurn\(\);/.exec(code);
  if (!hook) throw new Error('Ponto de entrada do CORE gerado ausente');
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const injected = code.replace(hook[0], 'turn = inputJson.noria_preclaimed_turn; return { ' + names.join(',') + ' };\n' + hook[0]);
  return new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', injected).call(
    { helpers: { httpRequest: async () => ({}) } },
    { tenant_slug: 'wesley_automoveis', tenant_id: 't', remoteJid: '5511@s.whatsapp.net', instance: 'i', noria_preclaimed_turn: { boundary_id: 'b', messages: [], claimed: true, token: 'x' } }, {}, {}, () => ({}));
}
module.exports = { readSource, declarations, loadFunctions, loadCoreEngine };

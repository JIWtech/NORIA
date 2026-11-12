const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');

// Uso: node scripts/homolog/n8n_parent_routes.cjs <caminho-do-bin-n8n>
// Executa cópias dos nós de roteamento do artefato local em um grafo descartável.
// Os serviços externos são substituídos por HTTP local e terminais de observação.
const root = path.resolve(__dirname, '../..');
const cli = process.argv[2];
if (!cli || !fs.existsSync(cli)) throw new Error('Informe o caminho existente do binário JavaScript do n8n.');
const parent = JSON.parse(fs.readFileSync(path.join(root, 'n8n/workflows/NORIA-CORE-Roteador-WhatsApp-Comandos-e-Follow-ups--3N5oN6sxtir9lFrA.json'), 'utf8'));
const extension = JSON.parse(fs.readFileSync(path.join(root, 'n8n/workflows/NORIA-CORE-Motor-Conversacional-Compartilhado--mlKNPv862H2g3Gap.json'), 'utf8'));
const byName = (w, name) => { const node = w.nodes.find(n => n.name === name); assert.ok(node, `Nó ausente: ${name}`); return structuredClone(node); };
for (const name of ['Aguardar Janela de Mensagens', 'Ler Fila WhatsApp']) {
  assert.equal(parent.connections[name].main[0][0].node, 'CORE - Resolver extensão do tenant', `${name} deve convergir para o resolver`);
}
const names = ['CORE - Resolver extensão do tenant', 'CORE | É tenant NORIA?', 'CORE | Serviços | Núbia v2?', 'CORE - É Núbia?', 'CORE - É Gênesis?', 'CORE - Roteador Dinâmico SaaS', 'CORE | É I&C Salon?'];
const nodes = names.map(name => byName(parent, name));
const ext = byName(extension, 'EXT NORIA - Política');
nodes.push(ext);
const terminal = (name, route) => ({ id: `stub-${route}`, name, type: 'n8n-nodes-base.code', typeVersion: 2, position: [0, 0], parameters: { mode: 'runOnceForEachItem', jsCode: `return { json: { ...$json, __rota_observada: ${JSON.stringify(route)} }, ...(typeof $binary !== 'undefined' && $binary ? {binary:$binary} : {}) };` } });
for (const [name, route] of [['STUB Genesis','genesis'], ['STUB Nubia v1','nubia_v1'], ['STUB Nubia v2','nubia_v2'], ['STUB Salon','salon'], ['STUB Core','core']]) nodes.push(terminal(name, route));
const link = node => ({ node, type: 'main', index: 0 });
const connections = {};
const edge = (from, ...branches) => { connections[from] = { main: branches.map(x => [link(x)]) }; };
edge('CORE - Resolver extensão do tenant', 'CORE | É tenant NORIA?');
edge('CORE | É tenant NORIA?', 'EXT NORIA - Política', 'CORE | Serviços | Núbia v2?');
edge('EXT NORIA - Política', 'CORE | É I&C Salon?');
edge('CORE | Serviços | Núbia v2?', 'STUB Nubia v2', 'CORE - É Núbia?');
edge('CORE - É Núbia?', 'STUB Nubia v1', 'CORE - É Gênesis?');
edge('CORE - É Gênesis?', 'STUB Genesis', 'CORE - Roteador Dinâmico SaaS');
edge('CORE - Roteador Dinâmico SaaS', 'CORE | É I&C Salon?');
edge('CORE | É I&C Salon?', 'STUB Salon', 'STUB Core');
// Compara os arcos reais; somente destinos externos são substituídos por stubs.
const originals = { 'EXT NORIA - Política': 'CORE | Executar EXT NORIA', 'STUB Genesis': 'CORE | Executar EXT Gênesis', 'STUB Nubia v1': 'CORE | Executar EXT Núbia', 'STUB Nubia v2': 'CORE | Serviços | Executar EXT bootstrap', 'STUB Salon': 'CORE | Preparar fase I&C Salon', 'STUB Core': 'CORE | Motor conversacional único' };
for (const name of names) {
  const actual = parent.connections[name]?.main || [];
  const expected = connections[name].main;
  assert.deepEqual(actual.map(branch => branch.map(item => item.node)), expected.map(branch => branch.map(item => originals[item.node] || item.node)), 'Topologia divergente: ' + name);
}
const id = '11111111-1111-4111-8111-111111111111';
const salonId = '76aff8a0-0466-42b9-a80d-db186ff3d8bd';
const base = { tenant_id: id, tenant_slug: 'noria', instance: 'teste', remoteJid: '5511999999999@s.whatsapp.net', messageText: 'mensagem sintética' };
const policy = { profile: 'fixture', modules: {} };
const pipeline = { enabled: true, contract: 'noria_turn_pipeline_v1', capability: 'services_v1', contract_version: '2.0', rollout: 'all' };
const scenarios = [
  { name: 'NORIA e EXT', input: base, route: 'core', policy: true },
  { name: 'Gênesis', input: { ...base, tenant_slug: 'wesley_automoveis' }, route: 'genesis' },
  { name: 'Núbia v1', input: { ...base, tenant_slug: 'clinica_nubia_oficial' }, route: 'nubia_v1' },
  { name: 'Núbia v2', input: { ...base, tenant_slug: 'clinica_nubia_oficial' }, route: 'nubia_v2', pipeline },
  { name: 'SaaS', input: { ...base, tenant_slug: 'cliente_sintetico' }, route: 'core', policy: true },
  { name: 'Salon', input: { ...base, tenant_id: salonId, tenant_slug: 'ic_salon', instance: 'ic_saloon' }, route: 'salon', policy: true },
  { name: 'Salon com slug divergente', input: { ...base, tenant_id: salonId, tenant_slug: 'outro_salon', instance: 'ic_saloon' }, route: 'core', policy: true },
  { name: 'Salon com instância divergente', input: { ...base, tenant_id: salonId, tenant_slug: 'ic_salon', instance: 'outra' }, route: 'core', policy: true },
  { name: 'NORIA sem canal', input: base, error: 'NORIA_INSTANCIA_NAO_PERTENCE_AO_TENANT', noChannel: true },
  { name: 'SaaS sem política', input: { ...base, tenant_slug: 'cliente_sintetico' }, error: 'NORIA_SEM_EXTENSAO_CONFIGURADA', noPolicy: true },
];
async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'noria-n8n-homolog-'));
  let current;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (req.method !== 'GET' || !u.pathname.startsWith('/rest/v1/') || u.searchParams.get(u.pathname.endsWith('/tenants') ? 'id' : 'tenant_id') !== 'eq.' + current.input.tenant_id) { res.writeHead(400); res.end('[]'); return; }
    let data;
    if (u.pathname.endsWith('/tenants')) data = [{ id: current.input.tenant_id, slug: 'noria', status: 'active' }];
    else if (u.pathname.endsWith('/channels')) data = current.noChannel ? [] : [{ external_id: current.input.instance, status: 'active', config: {} }];
    else if (u.pathname.endsWith('/tenant_settings')) data = [{ settings: { ...(!current.noPolicy ? { noria_client_policy: policy } : {}), ...(current.pipeline ? { noria_turn_pipeline: current.pipeline } : {}) } }];
    else if (u.pathname.endsWith('/conversation_turn_queue')) data = [];
    else { res.writeHead(404); res.end('[]'); return; }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(data));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const scenario of scenarios) {
      current = scenario;
      const start = { id: 'test-start', name: 'Início sintético', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} };
      const fixture = { id: 'test-fixture', name: 'Fixture', type: 'n8n-nodes-base.code', typeVersion: 2, position: [0, 0], parameters: { jsCode: `return [{json:${JSON.stringify(scenario.input)}}];` } };
      edge(start.name, fixture.name); edge(fixture.name, 'CORE - Resolver extensão do tenant');
      const workflow = { id: 'homolog-' + scenarios.indexOf(scenario), name: 'NORIA homologação isolada', nodes: [start, fixture, ...nodes], connections, settings: { executionOrder: 'v1' }, active: false };
      const file = path.join(temp, 'workflow.json'); fs.writeFileSync(file, JSON.stringify(workflow));
      const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: temp, TMP: temp, USERPROFILE: temp, N8N_USER_FOLDER: temp, N8N_DIAGNOSTICS_ENABLED: 'false', N8N_VERSION_NOTIFICATIONS_ENABLED: 'false', N8N_PERSONALIZATION_ENABLED: 'false', N8N_BLOCK_ENV_ACCESS_IN_NODE: 'false', N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS: 'false', SUPABASE_URL: `http://127.0.0.1:${server.address().port}`, SUPABASE_SERVICE_ROLE_KEY: 'fixture', NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' };
      const run = args => new Promise((resolve, reject) => { const p = spawn(process.execPath, [path.resolve(cli), ...args], { cwd: temp, env, windowsHide: true }); let out = '', err = ''; p.stdout.on('data', x => out += x); p.stderr.on('data', x => err += x); p.on('error', reject); p.on('close', code => resolve({ code, out, err })); });
      const imported = await run(['import:workflow', '--input', file]);
      assert.equal(imported.code, 0, scenario.name + ': importação local falhou\n' + imported.out + imported.err);
      const result = await run(['execute', '--id', workflow.id, '--rawOutput']);
      const combined = result.out + '\n' + result.err;
      if (scenario.error) { assert.match(combined, new RegExp(scenario.error), `${scenario.name}: erro esperado não observado\n${combined.slice(-3000)}`); }
      else { assert.equal(result.code, 0, `${scenario.name}: n8n falhou\n${combined.slice(-3000)}`); assert.ok(combined.includes(`"__rota_observada":"${scenario.route}"`) || combined.includes(`"__rota_observada": "${scenario.route}"`), `${scenario.name}: rota ausente\n${combined.slice(-3000)}`); if (scenario.policy) assert.ok(combined.includes('"fixture"'), `${scenario.name}: política ausente`); }
      console.log(`OK ${scenario.name}: ${scenario.error || scenario.route}`);
    }
    console.log('Nós reais: resolver, gates, roteador SaaS e código EXT NORIA. Stubs: destinos e transporte HTTP. Entrada e recuperação: apenas conexões verificadas estaticamente.');
  } finally {
    server.close();
    const resolved = path.resolve(temp);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()), 'Diretório temporário fora do local esperado');
    assert.ok(path.basename(resolved).startsWith('noria-n8n-homolog-'), 'Prefixo temporário inesperado');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });

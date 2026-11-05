const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// 1. Read sources
const coreSourcePath = path.join(root, 'n8n/sources/noria_core.js');
const extSourcePath = path.join(root, 'n8n/sources/genesis_extension.js');
const genesisIdentitySourcePath = path.join(root, 'n8n/sources/genesis_tenant_identity.js');
let coreCode = fs.readFileSync(coreSourcePath, 'utf8');
const extCode = fs.readFileSync(extSourcePath, 'utf8');
const genesisIdentityCode = fs.readFileSync(genesisIdentitySourcePath, 'utf8');
const intakeNormalizerCode = fs.readFileSync(path.join(root, 'n8n/sources/whatsapp_normalize_entry.js'), 'utf8').trimEnd();
// The Núbia v2 EXT remains an isolated, inactive workflow for future work; it is no longer embedded in the CORE.
const nubiaExtCode = fs.readFileSync(path.join(root, 'n8n/sources/nubia_extension.js'), 'utf8');
// Router of the live CORE: legacy tenants route without any database read. The services-pipeline router
// (n8n/sources/noria_router.js) returns to the CORE only together with the Núbia v2 chain.
const coreRouterSourcePath = path.join(root, 'n8n/sources/noria_router_core.js');
const routerSourceCode = fs.readFileSync(coreRouterSourcePath, 'utf8').replace(/\r\n/g, '\n');
// Fallback recovery of the WhatsApp queue. The webhook path processes messages on arrival; this trigger only picks up
// leftovers (expired leases, retries), so a longer interval cuts idle executions without changing the happy path.
const RECOVERY_TRIGGER_SECONDS = 30;
const recoveryCode = fs.readFileSync(path.join(root, 'n8n/code/whatsapp_recover_core.js'), 'utf8').replace(/\r\n/g, '\n');
// The follow-up dispatcher ("Processar Follow-ups") is projected from its source, so the CORE never drifts from it.
const followUpDispatchCode = fs.readFileSync(path.join(root, 'n8n/code/whatsapp_follow_up_dispatch.js'), 'utf8').replace(/\r\n/g, '\n').trimEnd();
const routerCode = fs.readFileSync(path.join(root, 'n8n/code/command_router.js'), 'utf8').replace(/\r\n/g, '\n');
const routerInsertStart = routerCode.indexOf('  async function insertEvent(event) {');
const routerInsertEnd = routerCode.indexOf('  async function loadTenantSettings(', routerInsertStart);
if (routerInsertStart < 0 || routerInsertEnd < 0) throw new Error('CONTROL_ORIGIN_SOURCE_MISSING');
const routerInsertCode = routerCode.slice(routerInsertStart, routerInsertEnd).trimEnd();

// 2. Compute SHA-256 hashes and build metadata
const extSha256 = crypto.createHash('sha256').update(extCode).digest('hex');
const now = new Date();

// To avoid circular hash dependency, compute coreSha256 over canonical code with fixed placeholder
const normalizedForHash = coreCode.replace(/const coreBuildMetadata = \{[\s\S]*?\};/, 'const coreBuildMetadata = { revision: "", built_at: "", core_sha256: "", ext_sha256: "" };');
const coreSha256 = crypto.createHash('sha256').update(normalizedForHash).digest('hex');
// Rebuilding unchanged engine sources must not change bytes just because the
// clock moved. Keep the original timestamp/revision only for the same CORE+EXT.
// Other artifacts keep their own source hashes in the manifest below.
const previousMetadata = /const coreBuildMetadata = \{[\s\S]*?\};/.exec(coreCode)?.[0] || '';
const previousFields = Object.fromEntries([...previousMetadata.matchAll(/(revision|built_at|core_sha256|ext_sha256):\s*['"]([^'"]*)['"]/g)]
  .map(match => [match[1], match[2]]));
const revisionPrefix = 'conversation_core_v2_1_34_core_ext_decision_identity_';
const previousDate = Number.isFinite(Date.parse(previousFields.built_at)) ? new Date(previousFields.built_at).toISOString() : null;
const reuseMetadata = previousFields.core_sha256 === coreSha256 && previousFields.ext_sha256 === extSha256
  && previousDate && previousFields.revision === revisionPrefix + previousDate.slice(0, 10).replace(/-/g, '_');
const builtAt = reuseMetadata ? previousFields.built_at : now.toISOString();
const coreRevision = reuseMetadata ? previousFields.revision : revisionPrefix + builtAt.slice(0, 10).replace(/-/g, '_');

const updatedMetadataBlock = `const coreBuildMetadata = {
  revision: '${coreRevision}',
  built_at: '${builtAt}',
  core_sha256: '${coreSha256}',
  ext_sha256: '${extSha256}',
};`;

coreCode = coreCode.replace(/const coreBuildMetadata = \{[\s\S]*?\};/, updatedMetadataBlock);
fs.writeFileSync(coreSourcePath, coreCode);

// 3. Validate syntax of both sources
new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', coreCode);
new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', extCode);
new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', genesisIdentityCode);
new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', nubiaExtCode);
new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', routerSourceCode);
new AsyncFunction('$env', '$getWorkflowStaticData', recoveryCode);
new AsyncFunction('$env', followUpDispatchCode);
new AsyncFunction('$json', '$env', '$vars', routerCode);

// 4. Update workflow JSON files
// The conversational engine (~0.9 MB) lives once, in its own sub-workflow. The CORE only calls it for real turns,
// so webhook events, queue recovery and follow-up ticks no longer carry the engine in every execution.
const CORE_WORKFLOW_FILE = 'NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json';
const targets = [
  ['noria_core.js', CORE_WORKFLOW_FILE, null, null],
  ['genesis_extension.js', 'NORIA EXT _ Gênesis _ Política comercial v2 (1).json', 'EXT | Política Gênesis', extCode],
];

function ensureGenesisTerminalBypass(workflow) {
  const dispatchPrepareName = 'CORE | Preparar dispatch Genesis';
  const dispatchExtensionName = 'CORE | Executar EXT Genesis por turno';
  const prepareName = 'CORE | Preparar resposta';
  const extensionName = 'CORE | Executar EXT Genesis comercial';
  const finalizeName = 'CORE | Finalizar resposta';
  const preDispatchGateName = 'CORE | Turno terminal Genesis?';
  const postPrepareGateName = 'CORE | Turno terminal Genesis após prepare?';
  if (![dispatchPrepareName, dispatchExtensionName, prepareName, extensionName, finalizeName]
    .every(name => workflow.nodes.some(node => node.name === name))) {
    throw new Error('MISSING_GENESIS_TERMINAL_ROUTE_NODE');
  }
  const dispatchPrepareNode = workflow.nodes.find(node => node.name === dispatchPrepareName);
  const claimCall = "const claimResult=await post('rpc/magia_claim_turn',{p_tenant:input.tenant_id,p_chat:input.remoteJid});";
  const deploymentPreflight = `// lifecycle-deployment-preflight: read-only and before any claim.
let readiness;
if (!String($env['NORIA_INGRESS_FORWARD_TOKEN_'+String(input.tenant_slug||'').toUpperCase().replace(/[^A-Z0-9]/g,'_')]||'')) throw new Error('TURN_INGRESS_CONFIG_REQUIRED');
try { readiness=await get('rpc/magia_turn_lifecycle_status'); }
catch (error) { throw new Error('TURN_LIFECYCLE_DEPLOYMENT_REQUIRED:'+String(error?.message||error).slice(0,160)); }
if (readiness?.ready!==true || readiness.contract!=='noria_turn_lifecycle_v1') throw new Error('TURN_LIFECYCLE_DEPLOYMENT_REQUIRED');
`;
  if (!dispatchPrepareNode.parameters.jsCode.includes('// lifecycle-deployment-preflight:')) {
    if (!dispatchPrepareNode.parameters.jsCode.includes(claimCall)) throw new Error('MISSING_DISPATCH_CLAIM_ANCHOR');
    dispatchPrepareNode.parameters.jsCode = dispatchPrepareNode.parameters.jsCode.replace(claimCall, deploymentPreflight + claimCall);
  }
  if (!dispatchPrepareNode.parameters.jsCode.includes('TURN_INGRESS_CONFIG_REQUIRED')) {
    dispatchPrepareNode.parameters.jsCode = dispatchPrepareNode.parameters.jsCode.replace(
      'let readiness;\ntry {',
      "let readiness;\nif (!String($env['NORIA_INGRESS_FORWARD_TOKEN_'+String(input.tenant_slug||'').toUpperCase().replace(/[^A-Z0-9]/g,'_')]||'')) throw new Error('TURN_INGRESS_CONFIG_REQUIRED');\ntry {"
    );
  }
  const skippedClaim = "if (!claim?.claimed) return {json:{...input,noria_preclaimed_turn:claim,noria_dispatch_phase:'turn',noria_dispatch_skip:'queue_empty'}};";
  const terminalClaim = "if (!claim?.claimed) return {json:{...input,ok:true,skipped:true,noria_terminal:true,reason:String(claim?.reason || 'queue_empty'),noria_preclaimed_turn:claim,noria_dispatch_phase:'turn',noria_dispatch_skip:'queue_empty'}};";
  if (dispatchPrepareNode?.parameters?.jsCode?.includes(skippedClaim)) {
    dispatchPrepareNode.parameters.jsCode = dispatchPrepareNode.parameters.jsCode.replace(skippedClaim, terminalClaim);
  } else if (!dispatchPrepareNode?.parameters?.jsCode?.includes(terminalClaim)) {
    throw new Error('MISSING_GENESIS_PRE_DISPATCH_TERMINALIZATION');
  }
  const lifecycleGuard = "if (claim.contract !== 'noria_turn_lifecycle_v1') throw new Error('TURN_LIFECYCLE_RPC_MISMATCH');";
  if (!dispatchPrepareNode.parameters.jsCode.includes(lifecycleGuard)) {
    const sessionAnchor = "const sessionId=String(claim.boundary_id||'');";
    if (!dispatchPrepareNode.parameters.jsCode.includes(sessionAnchor)) throw new Error('MISSING_DISPATCH_SESSION_ANCHOR');
    dispatchPrepareNode.parameters.jsCode = dispatchPrepareNode.parameters.jsCode.replace(sessionAnchor, lifecycleGuard + '\n' + sessionAnchor);
  }
  const oldDispatchCatch = `} catch (error) {
  // Return the claim through the existing queue contract. This makes a failed
  // pre-dispatch retryable instead of leaving a processing lease behind.
  if (claim?.claimed && String(claim.token||'')) {
    try { await post('rpc/magia_finish_turn',{p_tenant:input.tenant_id,p_chat:input.remoteJid,p_token:claim.token,p_outcome:'retry'}); } catch (_) {}
  }
  return {json:{...input,noria_preclaimed_turn:{claimed:false,reason:'dispatch_preparation_failed'},noria_dispatch_phase:'turn',noria_dispatch_skip:'preparation_failed',noria_dispatch_error:{code:'TURN_DISPATCH_PREPARATION_FAILED',retryable:true}}};
}`;
  const safeDispatchCatch = `} catch (error) {
  // turn-dispatch-lifecycle-v1: no blind retry or swallowed persistence error.
  const status=Number(error?.statusCode||error?.response?.status||error?.response?.statusCode||0);
  const retryable=status===429 || (status>=500 && status<=599)
    || ['ETIMEDOUT','ESOCKETTIMEDOUT','ECONNRESET','ECONNREFUSED','ENOTFOUND','EAI_AGAIN'].includes(String(error?.code||''));
  let finish={retry_queued:false,finish_persisted:false};
  if (claim?.claimed && String(claim.token||'')) {
    try {
      const result=await post('rpc/magia_fail_turn',{p_tenant:input.tenant_id,p_chat:input.remoteJid,p_token:claim.token,p_error:String(error?.message||'dispatch_preparation_failed').slice(0,300),p_retryable:retryable});
      if (result?.finished!==true || result.contract!=='noria_turn_lifecycle_v1') throw new Error('TURN_FAILURE_NOT_PERSISTED');
      finish={...result,finish_persisted:true};
    } catch (finishError) { finish.finish_error=String(finishError?.message||finishError).slice(0,300); }
  }
  return {json:{...input,ok:false,skipped:true,noria_terminal:true,noria_preclaimed_turn:claim||{claimed:false,reason:'dispatch_preparation_failed'},noria_dispatch_phase:'turn',noria_dispatch_skip:'preparation_failed',requires_technical_intervention:finish.retry_queued!==true,noria_dispatch_error:{code:'TURN_DISPATCH_PREPARATION_FAILED',retryable,...finish}}};
}`;
  const diagnosedDispatchCatch = safeDispatchCatch.replace(
    "code:'TURN_DISPATCH_PREPARATION_FAILED',retryable,...finish",
    "code:'TURN_DISPATCH_PREPARATION_FAILED',retryable,message:String(error?.message||error).slice(0,300),...finish"
  );
  if (dispatchPrepareNode.parameters.jsCode.includes(oldDispatchCatch)) {
    dispatchPrepareNode.parameters.jsCode = dispatchPrepareNode.parameters.jsCode.replace(oldDispatchCatch, safeDispatchCatch);
  } else if (!dispatchPrepareNode.parameters.jsCode.includes(safeDispatchCatch)
    && !dispatchPrepareNode.parameters.jsCode.includes(diagnosedDispatchCatch)) {
    throw new Error('MISSING_DISPATCH_FAILURE_LIFECYCLE');
  }
  // Preserve the infrastructure diagnosis instead of reporting queue_empty.
  dispatchPrepareNode.parameters.jsCode = dispatchPrepareNode.parameters.jsCode.replace(safeDispatchCatch, diagnosedDispatchCatch);
  const configureTerminalGate = (name, position) => {
    let gate = workflow.nodes.find(node => node.name === name);
    if (!gate) {
      gate = { name, type: 'n8n-nodes-base.if', typeVersion: 2.2, position, parameters: {} };
      workflow.nodes.push(gate);
    }
    gate.parameters = {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{
          leftValue: "={{ ($json.noria_terminal === true || $json.skipped === true) && $json.tenant_slug === 'wesley_automoveis' && $json.noria_extension === 'genesis' }}",
          rightValue: true,
          operator: { type: 'boolean', operation: 'equals' },
        }],
        combinator: 'and',
      },
      options: {},
    };
  };
  configureTerminalGate(preDispatchGateName, [158032, -10624]);
  configureTerminalGate(postPrepareGateName, [158816, -10624]);

  // Separate pre-dispatch and post-prepare gates prevent skipped/debounced
  // turns from reaching either EXT phase without reconnecting the phases.
  workflow.connections[dispatchPrepareName] = { main: [[{ node: preDispatchGateName, type: 'main', index: 0 }]] };
  workflow.connections[preDispatchGateName] = { main: [
    [{ node: finalizeName, type: 'main', index: 0 }],
    [{ node: dispatchExtensionName, type: 'main', index: 0 }],
  ] };
  workflow.connections[dispatchExtensionName] = { main: [[{ node: prepareName, type: 'main', index: 0 }]] };
  workflow.connections[prepareName] = { main: [[{ node: postPrepareGateName, type: 'main', index: 0 }]] };
  workflow.connections[postPrepareGateName] = { main: [
    [{ node: finalizeName, type: 'main', index: 0 }],
    [{ node: extensionName, type: 'main', index: 0 }],
  ] };
  workflow.connections[extensionName] = { main: [[{ node: finalizeName, type: 'main', index: 0 }]] };

  const hasConnection = (from, to, branch) => (workflow.connections[from]?.main?.[branch] || [])
    .some(connection => connection.node === to);
  if (!hasConnection(dispatchPrepareName, preDispatchGateName, 0)
    || !hasConnection(preDispatchGateName, finalizeName, 0)
    || !hasConnection(preDispatchGateName, dispatchExtensionName, 1)
    || !hasConnection(dispatchExtensionName, prepareName, 0)
    || !hasConnection(prepareName, postPrepareGateName, 0)
    || !hasConnection(postPrepareGateName, finalizeName, 0)
    || !hasConnection(postPrepareGateName, extensionName, 1)
    || !hasConnection(extensionName, finalizeName, 0)) {
    throw new Error('INVALID_GENESIS_TERMINAL_ROUTE');
  }
}

const NUBIA_EXT_WORKFLOW_FILE = 'NORIA EXT _ NB Bronze _ Serviços v2.json';
const nubiaV2NodeNames = new Set([
  'CORE | Serviços | Executar EXT bootstrap',
  'CORE | Serviços | Preparar dispatch',
  'CORE | Serviços | Turno terminal?',
  'CORE | Serviços | Preparar resposta',
  'CORE | Serviços | Turno terminal após prepare?',
  'CORE | Serviços | Executar EXT decisão',
  'CORE | Serviços | Verificar disponibilidade',
  'CORE | Serviços | Executar EXT reavaliação',
  'CORE | Serviços | Finalizar resposta',
  'CORE | Serviços | Núbia v2?',
]);

function removeNubiaV2CoreNodes(workflow) {
  const resolver = 'CORE - Resolver extensão do tenant';
  const legacyNext = 'CORE - É Núbia?';
  const resolverNode = workflow.nodes.find(node => node.name === resolver);
  if (!resolverNode) throw new Error('MISSING_ROUTER_NODE');

  workflow.nodes = workflow.nodes.filter(node => !nubiaV2NodeNames.has(node.name));
  for (const nodeName of nubiaV2NodeNames) delete workflow.connections[nodeName];
  for (const entry of Object.values(workflow.connections)) {
    for (const branch of entry?.main || []) {
      for (let index = branch.length - 1; index >= 0; index -= 1) {
        if (nubiaV2NodeNames.has(branch[index].node)) branch.splice(index, 1);
      }
    }
  }
  // Restore the original Núbia v1 route and router; no tenant can reach v2 from the shared CORE.
  workflow.connections[resolver] = { main: [[{ node: legacyNext, type: 'main', index: 0 }]] };
  resolverNode.parameters.jsCode = routerSourceCode;
  if (!workflow.nodes.some(node => node.name === legacyNext)) throw new Error('MISSING_LEGACY_NUBIA_ROUTE');
  if (workflow.nodes.some(node => nubiaV2NodeNames.has(node.name))) throw new Error('NUBIA_V2_CORE_NODES_REMAIN');
}

// Successful executions are not stored (the recovery and follow-up ticks alone would write thousands of rows a day); failures keep full data.
function applyLeanExecutionSettings(workflow) {
  workflow.settings = { ...(workflow.settings || {}), saveDataSuccessExecution: 'none', saveDataErrorExecution: 'all', saveExecutionProgress: false, saveManualExecutions: false };
}

// Royal 4x4 is not in use. Default: its events are acknowledged without running its EXT, and the EXT node is not in the CORE at all.
// To enable it later: build with NORIA_ROYAL_ENABLED=1 (the EXT node and its route come back), publish the Royal EXT workflow and activate it.
const ROYAL_ENABLED = process.env.NORIA_ROYAL_ENABLED === '1';
function configureRoyalRoute(workflow, enabled = ROYAL_ENABLED) {
  const route = 'CORE | Rota Royal 4x4?';
  const execute = 'CORE | Executar EXT Royal 4x4 (CONFIGURAR ID)';
  const acknowledge = 'CORE | Responder ACK Royal';
  const routeNode = workflow.nodes.find(node => node.name === route);
  const acknowledgeNode = workflow.nodes.find(node => node.name === acknowledge);
  if (!routeNode || !acknowledgeNode) throw new Error('MISSING_ROYAL_ROUTE_OR_ACK');
  if (enabled) {
    if (!workflow.nodes.some(node => node.name === execute)) {
      workflow.nodes.push({ parameters: { workflowId: { __rl: true, value: 'QlKuGOCnI5eKwlSF', mode: 'id', cachedResultUrl: '/workflow/QlKuGOCnI5eKwlSF' }, mode: 'each', options: { waitForSubWorkflow: true } },
        id: '53671593-fb62-41f2-8e4b-1dcd02100163', name: execute, type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, position: [154304, -10960] });
    }
    workflow.connections[execute] = { main: [[{ node: acknowledge, type: 'main', index: 0 }]] };
    workflow.connections[route] = { main: [[{ node: execute, type: 'main', index: 0 }], [{ node: 'Mensagem valida?', type: 'main', index: 0 }]] };
    return;
  }
  workflow.nodes = workflow.nodes.filter(node => node.name !== execute);
  delete workflow.connections[execute];
  workflow.connections[route] = { main: [[{ node: acknowledge, type: 'main', index: 0 }], [{ node: 'Mensagem valida?', type: 'main', index: 0 }]] };
  if (workflow.nodes.some(node => node.name === execute)) throw new Error('ROYAL_EXT_REFERENCE_REMAINS');
}

// Núbia v1 is served by its own EXT (NORIA EXT | NB Bronze | Política de negócio v2), as in production since 16/10,
// and then by the engine in single phase. Routing her turns to "Responder Evento Ignorado" consumed queued customer
// messages without any reply, so a Núbia turn always goes through her EXT.
const NUBIA_EXT_WORKFLOW_ID = process.env.NORIA_NUBIA_EXT_WORKFLOW_ID || 'vCDXJLqIBCZJRTVv';
function configureNubiaExtRoute(workflow) {
  const gate = 'CORE - É Núbia?';
  const execute = 'CORE | Executar EXT Núbia';
  const legacyExecute = 'Executar EXT Nubia (PREENCHER ID)';
  const single = 'CORE | Motor conversacional único';
  const gateNode = workflow.nodes.find(node => node.name === gate);
  if (!gateNode) throw new Error('MISSING_NUBIA_GATE');

  workflow.nodes = workflow.nodes.filter(node => node.name !== legacyExecute);
  delete workflow.connections[legacyExecute];
  let node = workflow.nodes.find(n => n.name === execute);
  if (!node) {
    node = { name: execute, id: deterministicNodeId('noria-nubia-ext', execute),
      position: [gateNode.position[0] + 224, gateNode.position[1] - 160] };
    workflow.nodes.push(node);
  }
  Object.assign(node, { type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, parameters: {
    workflowId: { __rl: true, value: NUBIA_EXT_WORKFLOW_ID, mode: 'id', cachedResultUrl: '/workflow/' + NUBIA_EXT_WORKFLOW_ID },
    mode: 'each', options: { waitForSubWorkflow: true } } });
  workflow.connections[gate] = { main: [
    [{ node: execute, type: 'main', index: 0 }],
    [{ node: 'CORE - É Gênesis?', type: 'main', index: 0 }],
  ] };
  workflow.connections[execute] = { main: [[{ node: single, type: 'main', index: 0 }]] };
}

function deterministicNubiaExtId(name) {
  const h = crypto.createHash('sha1').update('noria-services-pipeline:' + name).digest('hex');
  return [h.slice(0, 8), h.slice(8, 12), '4' + h.slice(13, 16), '8' + h.slice(17, 20), h.slice(20, 32)].join('-');
}

function writeNubiaV2ExtWorkflow() {
  const target = path.join(root, 'n8n/workflows', NUBIA_EXT_WORKFLOW_FILE);
  const trigger = 'Entrada do NORIA CORE | Núbia serviços v2';
  const policy = 'EXT | Serviços Núbia v2';
  const previous = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : null;
  const workflow = {
    name: 'NORIA EXT | NB Bronze | Serviços v2', pinData: {}, active: false,
    nodes: [
      { parameters: { inputSource: 'passthrough' }, id: previous?.nodes?.find(node => node.name === trigger)?.id || deterministicNubiaExtId(trigger), name: trigger, type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.1, position: [416, -64] },
      { parameters: { jsCode: nubiaExtCode }, id: previous?.nodes?.find(node => node.name === policy)?.id || deterministicNubiaExtId(policy), name: policy, type: 'n8n-nodes-base.code', typeVersion: 2, position: [704, -64] },
    ],
    connections: { [trigger]: { main: [[{ node: policy, type: 'main', index: 0 }]] } },
    settings: { executionOrder: 'v1', timezone: 'America/Sao_Paulo', callerPolicy: 'workflowsFromSameOwner' },
  };
  applyLeanExecutionSettings(workflow);
  fs.writeFileSync(target, JSON.stringify(workflow, null, 2) + '\n');
}

const ENGINE_WORKFLOW_FILE = 'NORIA CORE _ Motor conversacional.json';
const ENGINE_WORKFLOW_NAME = 'NORIA CORE | Motor conversacional';
const ENGINE_TRIGGER_NAME = 'Entrada do NORIA CORE | Motor';
const ENGINE_NODE_NAME = 'CORE | Motor conversacional';
const ENGINE_ID_PLACEHOLDER = 'PREENCHER_ID_MOTOR';
const ENGINE_PHASES = {
  'CORE | Motor conversacional único': 'single',
  'CORE | Preparar resposta': 'prepare',
  'CORE | Finalizar resposta': 'finalize',
};
// The calling CORE node marks the phase on the item; the engine takes it and removes it before reading its input.
const enginePrelude = `const NORIA_NODE_PHASE = String($json.noria_engine_phase || '');
if (!['single', 'prepare', 'finalize'].includes(NORIA_NODE_PHASE)) throw new Error('NORIA_ENGINE_PHASE_REQUIRED');
delete $json.noria_engine_phase;
`;
const engineCode = enginePrelude + coreCode;
new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', engineCode);

function deterministicNodeId(namespace, name) {
  const h = crypto.createHash('sha1').update(namespace + ':' + name).digest('hex');
  return [h.slice(0, 8), h.slice(8, 12), '4' + h.slice(13, 16), '8' + h.slice(17, 20), h.slice(20, 32)].join('-');
}

function writeEngineWorkflow() {
  const target = path.join(root, 'n8n/workflows', ENGINE_WORKFLOW_FILE);
  const previous = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : null;
  const idFor = name => previous?.nodes?.find(node => node.name === name)?.id || deterministicNodeId('noria-engine', name);
  const workflow = {
    name: ENGINE_WORKFLOW_NAME, pinData: {}, active: false,
    nodes: [
      { parameters: { inputSource: 'passthrough' }, id: idFor(ENGINE_TRIGGER_NAME), name: ENGINE_TRIGGER_NAME,
        type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.1, position: [0, 0] },
      { parameters: { mode: 'runOnceForEachItem', jsCode: engineCode }, id: idFor(ENGINE_NODE_NAME), name: ENGINE_NODE_NAME,
        type: 'n8n-nodes-base.code', typeVersion: 2, position: [320, 0] },
    ],
    connections: { [ENGINE_TRIGGER_NAME]: { main: [[{ node: ENGINE_NODE_NAME, type: 'main', index: 0 }]] } },
    settings: { executionOrder: 'v1', timezone: 'America/Sao_Paulo', callerPolicy: 'workflowsFromSameOwner' },
  };
  applyLeanExecutionSettings(workflow);
  fs.writeFileSync(target, JSON.stringify(workflow, null, 2) + '\n');
}

// The engine workflow ID only exists after it is imported into n8n: NORIA_ENGINE_WORKFLOW_ID wins, otherwise the ID
// already configured in the CORE is kept, otherwise a placeholder that must be filled before publishing.
function resolveEngineWorkflowId(workflow) {
  if (process.env.NORIA_ENGINE_WORKFLOW_ID) return process.env.NORIA_ENGINE_WORKFLOW_ID;
  const configured = Object.keys(ENGINE_PHASES)
    .map(name => workflow.nodes.find(node => node.name === name))
    .map(node => node?.type === 'n8n-nodes-base.executeWorkflow' ? node.parameters?.workflowId?.value : null)
    .find(id => id && id !== ENGINE_ID_PLACEHOLDER);
  return configured || ENGINE_ID_PLACEHOLDER;
}

// Idempotent: each engine node becomes a sub-workflow call with the same name, position and outgoing connections;
// every incoming connection is moved to a small marker node that sets the phase (and keeps binary, e.g. audio).
function routeEngineThroughSubworkflow(workflow) {
  const engineId = resolveEngineWorkflowId(workflow);
  for (const [name, phase] of Object.entries(ENGINE_PHASES)) {
    const node = workflow.nodes.find(n => n.name === name);
    if (!node) throw new Error('MISSING_ENGINE_NODE: ' + name);
    node.type = 'n8n-nodes-base.executeWorkflow';
    node.typeVersion = 1.2;
    node.parameters = { workflowId: { __rl: true, value: engineId, mode: 'id', cachedResultUrl: '/workflow/' + engineId },
      mode: 'each', options: { waitForSubWorkflow: true } };

    const markerName = name + ' | Fase';
    let marker = workflow.nodes.find(n => n.name === markerName);
    if (!marker) {
      marker = { name: markerName, id: deterministicNodeId('noria-engine-phase', markerName),
        position: [node.position[0] - 224, node.position[1] + 160] };
      workflow.nodes.push(marker);
    }
    Object.assign(marker, { type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { mode: 'runOnceForEachItem',
      jsCode: `return { json: { ...$json, noria_engine_phase: '${phase}' }, binary: $input.item.binary };` } });

    for (const [from, entry] of Object.entries(workflow.connections)) {
      if (from === markerName) continue;
      for (const branch of entry?.main || []) {
        for (const connection of branch || []) if (connection.node === name) connection.node = markerName;
      }
    }
    workflow.connections[markerName] = { main: [[{ node: name, type: 'main', index: 0 }]] };
  }
  if (engineId === ENGINE_ID_PLACEHOLDER) {
    console.warn('AVISO: CORE gerado com ' + ENGINE_ID_PLACEHOLDER + '. Importe o workflow do motor e rode o build com NORIA_ENGINE_WORKFLOW_ID=<id>.');
  }
}

for (const [source, file, prefix, code] of targets) {
  const target = path.join(root, 'n8n/workflows', file);
  const workflow = JSON.parse(fs.readFileSync(target, 'utf8'));
  if (prefix !== null) {
    // Prefer the exact node name: phase-specific nodes may share the logical
    // prefix (for example "... | Fase") and must not make the target ambiguous.
    const exactNodes = workflow.nodes.filter(n => n.name === prefix);
    const nodes = exactNodes.length ? exactNodes : workflow.nodes.filter(n => n.name.startsWith(prefix));
    if (nodes.length !== 1) throw new Error('AMBIGUOUS_WORKFLOW_NODE: ' + prefix);
    nodes[0].parameters.jsCode = code;
  }

  if (source === 'genesis_extension.js') {
    const identityNode = workflow.nodes.find(n => n.name === 'Validar identidade e capacidade do tenant');
    if (!identityNode || !identityNode.parameters?.jsCode) throw new Error('MISSING_GENESIS_IDENTITY_NODE');
    identityNode.parameters.jsCode = genesisIdentityCode;
  }

  // If shared core workflow, also update the intake node 'Registrar Mensagem na Fila'
  if (source === 'noria_core.js') {
    const normalizerNode = workflow.nodes.find(n => n.name === 'Normalizar Entrada WhatsApp');
    if (!normalizerNode) throw new Error('MISSING_INTAKE_NORMALIZER_NODE');
    new AsyncFunction('$json', '$env', intakeNormalizerCode);
    normalizerNode.parameters.jsCode = intakeNormalizerCode;
    // Project only this helper: the existing embedded router has independent
    // local changes and must not be replaced wholesale with another version.
    const commandNode = workflow.nodes.find(n => n.name === 'Executar Comando1');
    const embeddedRouter = commandNode?.parameters?.jsCode?.replace(/\r\n/g, '\n');
    const insertStart = embeddedRouter?.indexOf('  async function insertEvent(event) {') ?? -1;
    const insertEnd = embeddedRouter?.indexOf('  async function loadTenantSettings(', insertStart) ?? -1;
    if (insertStart < 0 || insertEnd < 0) throw new Error('CONTROL_ORIGIN_ROUTER_MISSING');
    commandNode.parameters.jsCode = embeddedRouter.slice(0, insertStart) + routerInsertCode + '\n\n' + embeddedRouter.slice(insertEnd);
    new AsyncFunction('$json', '$env', '$vars', commandNode.parameters.jsCode);
    const recoveryNode = workflow.nodes.find(n => n.name === 'Ler Fila WhatsApp');
    if (!recoveryNode || recoveryNode.type !== 'n8n-nodes-base.code') throw new Error('MISSING_TURN_RECOVERY_NODE');
    recoveryNode.parameters.jsCode = recoveryCode;
    const followUpNode = workflow.nodes.find(n => n.name === 'Processar Follow-ups');
    if (!followUpNode || followUpNode.type !== 'n8n-nodes-base.code') throw new Error('MISSING_FOLLOW_UP_DISPATCH_NODE');
    followUpNode.parameters.jsCode = followUpDispatchCode;
    const recoveryTrigger = workflow.nodes.find(n => n.name === 'Recuperar Fila WhatsApp');
    if (!recoveryTrigger || recoveryTrigger.type !== 'n8n-nodes-base.scheduleTrigger') throw new Error('MISSING_TURN_RECOVERY_TRIGGER');
    recoveryTrigger.parameters.rule = { interval: [{ field: 'seconds', secondsInterval: RECOVERY_TRIGGER_SECONDS }] };
    const enqueueNode = workflow.nodes.find(n => n.name === 'Registrar Mensagem na Fila');
    if (enqueueNode && enqueueNode.parameters?.jsCode) {
      enqueueNode.parameters.jsCode = enqueueNode.parameters.jsCode.replace(
        /core_revision:\s*'[^']+'/,
        `core_revision: '${coreRevision}'`
      );
    }
    ensureGenesisTerminalBypass(workflow);
    removeNubiaV2CoreNodes(workflow);
    configureRoyalRoute(workflow);
    configureNubiaExtRoute(workflow);
    routeEngineThroughSubworkflow(workflow);
  }

  applyLeanExecutionSettings(workflow);
  fs.writeFileSync(target, JSON.stringify(workflow, null, 2) + '\n');
  if (source === 'noria_core.js') {
    fs.writeFileSync(path.join(root, 'n8n/code/whatsapp_conversation_core.generated.js'), "const NORIA_NODE_PHASE = 'single';\n" + coreCode);
  }
}

writeEngineWorkflow();
writeNubiaV2ExtWorkflow();

// 5. Generate whatsapp_sales.js projection
const ts = require('../app/node_modules/typescript');
const ast = ts.createSourceFile('core.js', coreCode, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const sales = ast.statements
  .filter(ts.isFunctionDeclaration)
  .filter(n => /^(sales|runSales|executeCommercial|commercialResult)/.test(n.name.text) || n.name.text === 'modelOutputDiagnostic')
  .map(n => n.getText(ast))
  .join('\n\n');
fs.writeFileSync(path.join(root, 'n8n/code/whatsapp_sales.js'), '// NORIA sales source projection; canonical source: n8n/sources/noria_core.js\n' + sales + '\n');

const rawDiskSha256 = crypto.createHash('sha256').update(fs.readFileSync(coreSourcePath, 'utf8')).digest('hex');
const manifest = {
  deployment: {
    contract: 'noria_turn_lifecycle_v1',
    preflight_rpc: 'magia_turn_lifecycle_status',
    migration: 'supabase/migrations_pending_review/turn_queue_lifecycle_v1.sql',
    requires_coordinated_deployment: true,
    production_approved: false,
  },
  core_revision: coreRevision,
  built_at: builtAt,
  core_sha256: coreSha256,
  raw_disk_sha256: rawDiskSha256,
  hash_explanation: 'core_sha256 is the deterministic normalized hash embedded into the runtime code block; raw_disk_sha256 is the direct sha256 of the generated source file on disk after metadata embedding.',
  ext_sha256: extSha256,
  // The EXT identity node filters runtime flags before the policy executes.
  // Its changes must be distinguishable from an unchanged commercial policy.
  ext_identity_sha256: crypto.createHash('sha256').update(genesisIdentityCode).digest('hex'),
  intake_normalizer_sha256: crypto.createHash('sha256').update(intakeNormalizerCode).digest('hex'),
  ext_bundle_sha256: crypto.createHash('sha256').update(JSON.stringify({
    identity: genesisIdentityCode, policy: extCode,
  })).digest('hex'),
  router_sha256: crypto.createHash('sha256').update(routerSourceCode).digest('hex'),
  recovery_sha256: crypto.createHash('sha256').update(recoveryCode).digest('hex'),
  recovery_trigger_seconds: RECOVERY_TRIGGER_SECONDS,
  control_origin_adapter_sha256: crypto.createHash('sha256').update(routerInsertCode).digest('hex'),
  operations_bridge_sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'scripts/turn_queue_operational_bridge.cjs'))).digest('hex'),
  artifacts: [
    'n8n/sources/noria_core.js',
    'n8n/sources/genesis_extension.js',
    'n8n/sources/genesis_tenant_identity.js',
    'n8n/sources/whatsapp_normalize_entry.js',
    'n8n/sources/nubia_extension.js',
    'n8n/sources/noria_router_core.js',
    'n8n/workflows/' + NUBIA_EXT_WORKFLOW_FILE,
    'n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json',
    'n8n/workflows/' + ENGINE_WORKFLOW_FILE,
    'n8n/workflows/NORIA EXT _ Gênesis _ Política comercial v2 (1).json',
    'n8n/code/whatsapp_conversation_core.generated.js',
    'n8n/code/whatsapp_sales.js',
    'n8n/code/whatsapp_recover_core.js',
    'n8n/code/whatsapp_follow_up_dispatch.js',
    'n8n/code/command_router.js',
    'scripts/turn_queue_operational_bridge.cjs',
  ],
};
fs.writeFileSync(path.join(root, 'n8n/build_manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

console.log('Built current NORIA CORE and Genesis EXT from canonical sources.');
console.log('Build manifest:', JSON.stringify(manifest, null, 2));

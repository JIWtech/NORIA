const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// Diretório de saída opcional (NORIA_BUILD_OUT_DIR): tudo o que o build escreve (workflows, metadados do CORE, n8n/code,
// manifesto) vai para lá, espelhando a estrutura do repositório. Os exports já presentes no diretório de saída são lidos
// de lá (cópia de trabalho); os demais vêm de n8n/workflows do repositório. Sem a variável, escreve no próprio repositório.
const outRoot = process.env.NORIA_BUILD_OUT_DIR ? path.resolve(process.env.NORIA_BUILD_OUT_DIR) : root;
const outPath = relative => path.join(outRoot, relative);
const writeOut = (relative, content) => {
  const target = outPath(relative);
  if (outRoot !== root) fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
};
const readWorkflowFile = relative => {
  const copy = outPath(relative);
  return fs.readFileSync(outRoot !== root && fs.existsSync(copy) ? copy : path.join(root, relative), 'utf8');
};

// Exports atuais, identificados pelo ID do workflow no n8n (gitignored; o nome do arquivo é NORIA-...--<id>.json).
const WORKFLOWS_DIR = 'n8n/workflows/';
const WORKFLOW_FILES = {
  engine: 'NORIA-CORE-Motor-Conversacional-Compartilhado--mlKNPv862H2g3Gap.json',
  router: 'NORIA-CORE-Roteador-WhatsApp-Comandos-e-Follow-ups--3N5oN6sxtir9lFrA.json',
  salon: 'NORIA-EXT-IC-Salon-Atendimento-e-Agendamentos--yxdKP0PeskDMUFSo.json',
  nubiaServices: 'NORIA-EXT-Nubia-NB-Bronze-Catalogo-de-Servicos--6jSiEH2ugboYSack.json',
  nubiaPolicy: 'NORIA-EXT-Nubia-NB-Bronze-Politica-de-Atendimento--vCDXJLqIBCZJRTVv.json',
  genesis: 'NORIA-EXT-Genesis-Automoveis-Politica-Comercial--fXGorIlPbyf9Qtsp.json',
  noriaExt: 'NORIA-EXT-NORIA-Politica--sLxNG9o2falquchd.json',
};
const WORKFLOW_IDS = { engine: 'mlKNPv862H2g3Gap', router: '3N5oN6sxtir9lFrA', salon: 'yxdKP0PeskDMUFSo',
  nubiaServices: '6jSiEH2ugboYSack', nubiaPolicy: 'vCDXJLqIBCZJRTVv', genesis: 'fXGorIlPbyf9Qtsp', noriaExt: 'sLxNG9o2falquchd' };
const { wrapSalonEngine } = require('../clients/ic_saloon/conversation_adapter.cjs');
const { configuredSalonId, isWorkflowId, applySalonRoute } = require('../clients/ic_saloon/conversation_route.cjs');

// 1. Read sources
const coreSourcePath = path.join(root, 'n8n/sources/noria_core.js');
const extSourcePath = path.join(root, 'n8n/sources/genesis_extension.js');
const genesisIdentitySourcePath = path.join(root, 'n8n/sources/genesis_tenant_identity.js');
let coreCode = fs.readFileSync(coreSourcePath, 'utf8');
// O I&C Salon tem motor próprio (decisão de 2026-11-12): evolui separado do compartilhado.
const salonEngineSourcePath = path.join(root, 'clients/ic_saloon/salon_engine.js');
const salonEngineSource = fs.readFileSync(salonEngineSourcePath, 'utf8');
const extCode = fs.readFileSync(extSourcePath, 'utf8');
const genesisIdentityCode = fs.readFileSync(genesisIdentitySourcePath, 'utf8');
const intakeNormalizerCode = fs.readFileSync(path.join(root, 'n8n/sources/whatsapp_normalize_entry.js'), 'utf8').trimEnd();
// The Núbia v2 EXT remains an isolated, inactive workflow for future work; it is no longer embedded in the CORE.
const nubiaExtCode = fs.readFileSync(path.join(root, 'n8n/sources/nubia_extension.js'), 'utf8');
const noriaExtCode = fs.readFileSync(path.join(root, 'n8n/sources/noria_extension.js'), 'utf8');
// Router of the CORE: selects the services pipeline (Núbia v2) only from a validated, enabled declaration in
// tenant_settings.noria_turn_pipeline; without it every tenant routes exactly as before. Gênesis and the SaaS tenants never
// read the declaration. The services chain below is reachable only through this selection.
const coreRouterSourcePath = path.join(root, 'n8n/sources/noria_router.js');
const routerSourceCode = fs.readFileSync(coreRouterSourcePath, 'utf8').replace(/\r\n/g, '\n');
const servicesDispatchCode = fs.readFileSync(path.join(root, 'n8n/sources/noria_turn_dispatch.js'), 'utf8').replace(/\r\n/g, '\n');
// Fallback recovery of the WhatsApp queue. The webhook path processes messages on arrival; this trigger only picks up
// leftovers (expired leases, retries), so a longer interval cuts idle executions without changing the happy path.
const RECOVERY_TRIGGER_SECONDS = 30;
const recoveryCode = fs.readFileSync(path.join(root, 'n8n/code/whatsapp_recover_core.js'), 'utf8').replace(/\r\n/g, '\n');
// The follow-up dispatcher ("Processar Follow-ups") is projected from its source, so the CORE never drifts from it.
const followUpDispatchCode = fs.readFileSync(path.join(root, 'n8n/code/whatsapp_follow_up_dispatch.js'), 'utf8').replace(/\r\n/g, '\n').trimEnd();
const routerCode = fs.readFileSync(path.join(root, 'n8n/code/command_router.js'), 'utf8').replace(/\r\n/g, '\n');
// Sincronização de contato WhatsApp: a mesma fonte testada é projetada no nó do Roteador.
const syncContactCode = fs.readFileSync(path.join(root, 'n8n/code/whatsapp_sync_contact.js'), 'utf8').replace(/\r\n/g, '\n').trimEnd();
// Disparos: fluxo por lease do servidor (broadcast_claim_*), versionado em n8n/code e projetado no nó "Processar Disparos".
const broadcastWorkerCode = fs.readFileSync(path.join(root, 'n8n/code/broadcast_campaign_worker.js'), 'utf8').replace(/\r\n/g, '\n').trimEnd();
const manualReplyCaptureCode = fs.readFileSync(path.join(root, 'n8n/code/whatsapp_capture_manual_reply.js'), 'utf8').replace(/\r\n/g, '\n').trimEnd();
const routerInsertStart = routerCode.indexOf('  async function insertEvent(event) {');
const routerInsertEnd = routerCode.indexOf('  async function loadTenantSettings(', routerInsertStart);
if (routerInsertStart < 0 || routerInsertEnd < 0) throw new Error('CONTROL_ORIGIN_SOURCE_MISSING');
const routerInsertCode = routerCode.slice(routerInsertStart, routerInsertEnd).trimEnd();
// Pedido de agendamento (migração 031): o painel chama o roteador embutido na Entrada, então os comandos novos
// são projetados nele a partir do arquivo, entre marcadores, sem substituir o resto do roteador.
const APPOINTMENT_REQUEST_BEGIN = '  // >>> appointment_request: projetado de n8n/code/command_router.js pelo build';
const APPOINTMENT_REQUEST_END = '  // <<< appointment_request';
const routerSlice = (from, to) => {
  const start = routerCode.indexOf(from); const end = routerCode.indexOf(to, start);
  if (start < 0 || end < 0) throw new Error('APPOINTMENT_REQUEST_ROUTER_SOURCE_MISSING');
  return routerCode.slice(start, end).trimEnd();
};
const appointmentRequestHelpers = routerSlice('  function renderAppointmentRequest(', '  async function confirmAppointment(');
const appointmentRequestCommands = routerSlice("  if (command === 'notify_appointment_cancellation') {", "  if (command === 'confirm_payment_signal') {");
const assignConversationStart = "  if (command === 'assign_conversation') {";
const assignConversationEnd = "  const sent = normalizedChannel === 'telegram'";
const assignConversationCommand = routerSlice(assignConversationStart, assignConversationEnd);
function projectAppointmentRequestCommands(code) {
  const marked = new RegExp(APPOINTMENT_REQUEST_BEGIN.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '[\\s\\S]*?' + APPOINTMENT_REQUEST_END + '\n\n', 'g');
  let out = code.replace(marked, '');
  const block = text => APPOINTMENT_REQUEST_BEGIN + '\n' + text + '\n' + APPOINTMENT_REQUEST_END + '\n\n';
  const put = (anchor, text) => {
    if (out.split(anchor).length !== 2) throw new Error('APPOINTMENT_REQUEST_ANCHOR_MISSING: ' + anchor.trim().slice(0, 40));
    out = out.replace(anchor, block(text) + anchor);
  };
  put('  async function confirmAppointment(', appointmentRequestHelpers);
  put("  if (command === 'confirm_payment_signal') {", appointmentRequestCommands);
  const list = "'confirm_payment_signal'].includes(command)";
  if (!out.includes("'confirm_appointment_request', 'reject_appointment_slot'")) {
    if (out.split(list).length !== 2) throw new Error('APPOINTMENT_REQUEST_COMMAND_LIST_MISSING');
    out = out.replace(list, "'confirm_payment_signal', 'confirm_appointment_request', 'reject_appointment_slot'].includes(command)");
  }
  const text = "      : command === 'confirm_payment_signal'\n        ? String(payload.message_text || '').trim()";
  if (out.includes(text)) out = out.replace(text, "      : ['confirm_payment_signal', 'confirm_appointment_request', 'reject_appointment_slot'].includes(command)\n        ? String(payload.message_text || '').trim()");
  else if (!out.includes("['confirm_payment_signal', 'confirm_appointment_request', 'reject_appointment_slot'].includes(command)\n        ? String(payload.message_text")
    && !/\['confirm_payment_signal', 'confirm_appointment_request', 'reject_appointment_slot', 'notify_appointment_cancellation'(?:, 'invite_appointment_reschedule')?\]\.includes\(command\)\s+\? String\(payload\.message_text/.test(out)) {
    throw new Error('APPOINTMENT_REQUEST_MESSAGE_TEXT_MISSING');
  }
  out = out.replace(/'confirm_appointment_request', 'reject_appointment_slot'(?!, 'notify_appointment_cancellation')/g,
    "'confirm_appointment_request', 'reject_appointment_slot', 'notify_appointment_cancellation'");
  out = out.replace(/, 'notify_appointment_cancellation'(?!, 'invite_appointment_reschedule')/g,
    ", 'notify_appointment_cancellation', 'invite_appointment_reschedule'");
  return out;
}

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
writeOut('n8n/sources/noria_core.js', coreCode);

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

function ensureGenesisTerminalBypass(workflow) {
  const dispatchPrepareName = 'CORE | Preparar dispatch Genesis';
  const dispatchExtensionName = 'CORE | Executar EXT Genesis por turno';
  const prepareName = 'CORE | Preparar resposta';
  const extensionName = 'CORE | Executar EXT Genesis comercial';
  const finalizeName = 'CORE | Finalizar resposta';
  // As fases do motor são entradas pelos marcadores "| Fase", que definem a fase e o contrato no item.
  const prepareEntry = prepareName + ' | Fase';
  const finalizeEntry = finalizeName + ' | Fase';
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
    [{ node: finalizeEntry, type: 'main', index: 0 }],
    [{ node: dispatchExtensionName, type: 'main', index: 0 }],
  ] };
  workflow.connections[dispatchExtensionName] = { main: [[{ node: prepareEntry, type: 'main', index: 0 }]] };
  workflow.connections[prepareName] = { main: [[{ node: postPrepareGateName, type: 'main', index: 0 }]] };
  workflow.connections[postPrepareGateName] = { main: [
    [{ node: finalizeEntry, type: 'main', index: 0 }],
    [{ node: extensionName, type: 'main', index: 0 }],
  ] };
  workflow.connections[extensionName] = { main: [[{ node: finalizeEntry, type: 'main', index: 0 }]] };

  const hasConnection = (from, to, branch) => (workflow.connections[from]?.main?.[branch] || [])
    .some(connection => connection.node === to);
  if (!hasConnection(dispatchPrepareName, preDispatchGateName, 0)
    || !hasConnection(preDispatchGateName, finalizeEntry, 0)
    || !hasConnection(preDispatchGateName, dispatchExtensionName, 1)
    || !hasConnection(dispatchExtensionName, prepareEntry, 0)
    || !hasConnection(prepareName, postPrepareGateName, 0)
    || !hasConnection(postPrepareGateName, finalizeEntry, 0)
    || !hasConnection(postPrepareGateName, extensionName, 1)
    || !hasConnection(extensionName, finalizeEntry, 0)) {
    throw new Error('INVALID_GENESIS_TERMINAL_ROUTE');
  }
}

const SERVICES_EXT_PLACEHOLDER = 'PREENCHER_ID_EXT_NUBIA_V2';
const SERVICES_PREFIX = 'CORE | Serviços | ';

// The services pipeline (EXT v2): bootstrap -> dispatch -> prepare -> decision -> availability -> re-evaluation -> finalize,
// with local engine phases shared conceptually with the Gênesis chain. Reachable only when the router marks the
// turn (noria_pipeline = 'services_v1'); every other turn takes the legacy branch unchanged. Idempotent.
// EXT v2 workflow ID: NORIA_NUBIA_V2_EXT_WORKFLOW_ID, else the ID already configured, else a placeholder that the
// publisher (scripts/publish_nubia_v2.cjs) resolves by workflow name.
function configureServicesChain(workflow) {
  const resolver = 'CORE - Resolver extensão do tenant';
  const legacyNext = 'CORE - É Núbia?';
  const find = name => workflow.nodes.find(node => node.name === name);
  const resolverNode = find(resolver);
  if (!resolverNode) throw new Error('MISSING_ROUTER_NODE');
  if (!find(legacyNext)) throw new Error('MISSING_LEGACY_NUBIA_ROUTE');
  resolverNode.parameters.jsCode = routerSourceCode;

  const extSteps = ['Executar EXT bootstrap', 'Executar EXT decisão', 'Executar EXT reavaliação'];
  const configured = extSteps.map(step => find(SERVICES_PREFIX + step)?.parameters?.workflowId?.value)
    .find(id => id && id !== SERVICES_EXT_PLACEHOLDER);
  const extId = process.env.NORIA_NUBIA_V2_EXT_WORKFLOW_ID || configured || SERVICES_EXT_PLACEHOLDER;
  const terminal = "={{ $json.noria_terminal === true || $json.skipped === true }}";
  const ifNode = (expression, notes) => ({ type: 'n8n-nodes-base.if', typeVersion: 2.2, notes, parameters: {
    conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [{ leftValue: expression, rightValue: true, operator: { type: 'boolean', operation: 'equals' } }], combinator: 'and' },
    options: {} } });
  const extCall = () => ({ type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, notes: 'EXT de serviços v2.',
    parameters: { workflowId: { __rl: true, value: extId, mode: 'id' }, mode: 'each', options: { waitForSubWorkflow: true } } });
  // Os nós de fase recebem a fonte canônica em configureParentEngine.
  const engineCall = () => ({ type: 'n8n-nodes-base.code', typeVersion: 2, notes: 'Fase do Motor conversacional.',
    parameters: { mode: 'runOnceForEachItem', jsCode: 'return $input.item;' } });
  const spec = [
    ['Núbia v2?', ifNode("={{ $json.noria_pipeline === 'services_v1' }}",
      'Seletor de versão: ramo falso = fluxo atual. O verdadeiro só recebe turnos que o roteador marcou por configuração validada.')],
    ['Executar EXT bootstrap', extCall()],
    ['Preparar dispatch', { type: 'n8n-nodes-base.code', typeVersion: 2, notes: 'Despachante genérico de turno.',
      parameters: { mode: 'runOnceForEachItem', jsCode: servicesDispatchCode } }],
    ['Turno terminal?', ifNode(terminal, 'Turno já encerrado: vai direto para a finalização.')],
    ['Preparar resposta', engineCall()],
    ['Turno terminal após prepare?', ifNode(terminal, 'Turno encerrado na preparação: vai direto para a finalização.')],
    ['Executar EXT decisão', extCall()],
    ['Verificar disponibilidade', engineCall()],
    ['Executar EXT reavaliação', extCall()],
    ['Finalizar resposta', engineCall()],
  ];
  const [x0, y0] = [resolverNode.position[0] + 272, resolverNode.position[1] + 896];
  spec.forEach(([step, definition], index) => {
    const name = SERVICES_PREFIX + step;
    let node = find(name);
    if (!node) {
      node = { name, id: deterministicNodeId('noria-services-chain', name), position: [x0 + index * 256, y0] };
      workflow.nodes.push(node);
    }
    const alreadyEngine = definition.notes === 'Fase do Motor conversacional.' && node.type === 'n8n-nodes-base.executeWorkflow';
    if (!alreadyEngine) Object.assign(node, definition);
    delete node.disabled;
  });

  // Fases do motor entram pelo marcador "| Fase". O resolvedor liga ao seletor da EXT NORIA, conferido em verifyParentEngine.
  const entry = to => {
    const name = to.startsWith('CORE') ? to : SERVICES_PREFIX + to;
    return name in ENGINE_PHASES ? name + ' | Fase' : name;
  };
  const link = (from, ...branches) => {
    workflow.connections[SERVICES_PREFIX + from] = { main: branches.map(to => [{ node: entry(to), type: 'main', index: 0 }]) };
  };
  link('Núbia v2?', 'Executar EXT bootstrap', legacyNext);
  link('Executar EXT bootstrap', 'Preparar dispatch');
  link('Preparar dispatch', 'Turno terminal?');
  link('Turno terminal?', 'Finalizar resposta', 'Preparar resposta');
  link('Preparar resposta', 'Turno terminal após prepare?');
  link('Turno terminal após prepare?', 'Finalizar resposta', 'Executar EXT decisão');
  link('Executar EXT decisão', 'Verificar disponibilidade');
  link('Verificar disponibilidade', 'Executar EXT reavaliação');
  link('Executar EXT reavaliação', 'Finalizar resposta');
  delete workflow.connections[SERVICES_PREFIX + 'Finalizar resposta'];
  if (extId === SERVICES_EXT_PLACEHOLDER) {
    console.warn('AVISO: cadeia de serviços com ' + SERVICES_EXT_PLACEHOLDER + '. O publicador resolve o ID pelo nome da EXT v2.');
  }
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
  // Mantém os demais parâmetros do export (por exemplo workflowInputs).
  Object.assign(node, { type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, parameters: { ...node.parameters,
    workflowId: { __rl: true, value: NUBIA_EXT_WORKFLOW_ID, mode: 'id', cachedResultUrl: '/workflow/' + NUBIA_EXT_WORKFLOW_ID },
    mode: 'each', options: { waitForSubWorkflow: true } } });
  workflow.connections[gate] = { main: [
    [{ node: execute, type: 'main', index: 0 }],
    [{ node: 'CORE - É Gênesis?', type: 'main', index: 0 }],
  ] };
  workflow.connections[execute] = { main: [[{ node: single + ' | Fase', type: 'main', index: 0 }]] };
}

// O motor conversacional vive uma vez, no sub-workflow compartilhado (mlKNPv862H2g3Gap); o roteador só chama o motor em
// turnos reais, escolhendo o fluxo por fase. O Salon (yxdKP0PeskDMUFSo) executa o mesmo motor com o adaptador do tenant.
// O motor recebe a fase e o contrato no item (marcadores "| Fase" do roteador) e os consome antes de executar a fonte.
const ENGINE_WORKFLOW_ID = WORKFLOW_IDS.engine;
const NORIA_EXT_WORKFLOW_ID = WORKFLOW_IDS.noriaExt;
const ENGINE_PHASE_HEADER = [
  "const NORIA_NODE_PHASE = String($json.noria_engine_phase || '');",
  "if (!['single', 'prepare', 'availability', 'finalize'].includes(NORIA_NODE_PHASE)) throw new Error('NORIA_ENGINE_PHASE_REQUIRED');",
  "if (String($json.noria_engine_contract || '') !== 'noria_engine_phase_v1') throw new Error('NORIA_ENGINE_CONTRACT_MISMATCH');",
  'delete $json.noria_engine_phase;',
  'delete $json.noria_engine_contract;',
  '',
].join('\n');
const ENGINE_NODE_NAME = 'CORE | Motor conversacional';
const ENGINE_PHASES = {
  'CORE | Motor conversacional único': 'single', 'CORE | Preparar resposta': 'prepare',
  'CORE | Finalizar resposta': 'finalize', 'CORE | Serviços | Preparar resposta': 'prepare',
  'CORE | Serviços | Verificar disponibilidade': 'availability', 'CORE | Serviços | Finalizar resposta': 'finalize',
};
function deterministicNodeId(namespace, name) {
  const h = crypto.createHash('sha1').update(namespace + ':' + name).digest('hex');
  return [h.slice(0, 8), h.slice(8, 12), '4' + h.slice(13, 16), '8' + h.slice(17, 20), h.slice(20, 32)].join('-');
}

// Código gerado do motor: o do sub-workflow compartilhado e o do Salon (motor + diferenças do tenant + adaptador).
const engineNodeCode = ENGINE_PHASE_HEADER + coreCode;
// O adaptador é exportado com LF; price_guard.cjs entra como está no disco. Function.toString preserva o fim de linha do
// arquivo, então o trecho do adaptador é normalizado para LF para que o build não dependa do checkout.
function salonEngineNodeCode() {
  // O comentário de cabeçalho do arquivo não vai ao workflow; o carimbo de build é o mesmo do motor compartilhado.
  const marker = '// Generated by scripts/build_noria_workflows.cjs';
  const start0 = salonEngineSource.indexOf(marker);
  const metadata = /const coreBuildMetadata = \{[\s\S]*?\};/;
  if (start0 < 0 || !metadata.test(salonEngineSource)) throw new Error('IC_SALON_ENGINE_SOURCE_INVALID');
  const salonCore = salonEngineSource.slice(start0).replace(metadata, () => metadata.exec(coreCode)[0]);
  const wrapped = wrapSalonEngine(ENGINE_PHASE_HEADER + salonCore);
  const start = wrapped.indexOf('function createSalonHelpers(');
  const end = wrapped.indexOf('\nconst salonHelpers = createSalonHelpers(', start);
  if (start < 0 || end < 0) throw new Error('IC_SALON_ADAPTER_SOURCE_MISSING');
  return wrapped.slice(0, start) + wrapped.slice(start, end).replace(/\r\n/g, '\n') + wrapped.slice(end);
}

function setNodeCode(workflow, name, code) {
  const nodes = workflow.nodes.filter(node => node.name === name);
  if (nodes.length !== 1 || nodes[0].type !== 'n8n-nodes-base.code') throw new Error('AMBIGUOUS_WORKFLOW_NODE: ' + name);
  nodes[0].parameters.jsCode = code;
}

// O roteador não embute mais o motor: confere o contrato das chamadas por fase e da rota do I&C Salon / EXT NORIA.
function verifyParentEngine(workflow) {
  if (workflow.name !== 'NORIA CORE | Roteador WhatsApp, Comandos e Follow-ups') throw new Error('PARENT_WORKFLOW_NAME_MISMATCH');
  const find = name => workflow.nodes.find(node => node.name === name);
  const links = name => (workflow.connections[name]?.main || []).map(branch => branch.map(connection => connection.node));
  for (const [name, phase] of Object.entries(ENGINE_PHASES)) {
    const node = find(name); const marker = find(name + ' | Fase');
    if (node?.type !== 'n8n-nodes-base.executeWorkflow' || node.parameters?.options?.waitForSubWorkflow !== true) throw new Error('ENGINE_PHASE_NODE_DRIFT: ' + name);
    if (name !== 'CORE | Motor conversacional único' && node.parameters.workflowId?.value !== ENGINE_WORKFLOW_ID) throw new Error('ENGINE_PHASE_ID_DRIFT: ' + name);
    if (marker?.type !== 'n8n-nodes-base.code' || !marker.parameters?.jsCode?.includes("noria_engine_phase: '" + phase + "', noria_engine_contract: 'noria_engine_phase_v1'")
        || JSON.stringify(links(marker.name)) !== JSON.stringify([[name]])) throw new Error('ENGINE_PHASE_MARKER_DRIFT: ' + name);
  }
  const salonId = configuredSalonId(workflow);
  if (!isWorkflowId(salonId) || salonId === ENGINE_WORKFLOW_ID || salonId !== WORKFLOW_IDS.salon) throw new Error('IC_SALON_ROUTE_INVALID_WORKFLOW_ID');
  applySalonRoute(workflow, ENGINE_WORKFLOW_ID, salonId);
  const ext = find('CORE | Executar EXT NORIA');
  if (ext?.parameters?.workflowId?.value !== NORIA_EXT_WORKFLOW_ID) throw new Error('NORIA_EXT_ROUTE_DRIFT');
  if (JSON.stringify(links('CORE | É tenant NORIA?')) !== JSON.stringify([['CORE | Executar EXT NORIA'], ['CORE | Serviços | Núbia v2?']])
      || JSON.stringify(links('CORE | Executar EXT NORIA')) !== JSON.stringify([['CORE | Motor conversacional único | Fase']])) throw new Error('NORIA_EXT_ROUTE_DRIFT');
}

function loadWorkflow(key) { return JSON.parse(readWorkflowFile(WORKFLOWS_DIR + WORKFLOW_FILES[key])); }
function saveWorkflow(key, workflow) { writeOut(WORKFLOWS_DIR + WORKFLOW_FILES[key], JSON.stringify(workflow, null, 2) + '\n'); }

// Motor compartilhado, Salon e EXTs: só o código dos nós vem das fontes; o restante do export (IDs, versões, configuração) é mantido.
const engineWorkflow = loadWorkflow('engine');
setNodeCode(engineWorkflow, ENGINE_NODE_NAME, engineNodeCode);
saveWorkflow('engine', engineWorkflow);

const salonWorkflow = loadWorkflow('salon');
setNodeCode(salonWorkflow, ENGINE_NODE_NAME, salonEngineNodeCode());
saveWorkflow('salon', salonWorkflow);

const genesisWorkflow = loadWorkflow('genesis');
setNodeCode(genesisWorkflow, 'EXT | Política Gênesis', extCode);
setNodeCode(genesisWorkflow, 'Validar identidade e capacidade do tenant', genesisIdentityCode);
saveWorkflow('genesis', genesisWorkflow);

const nubiaServicesWorkflow = loadWorkflow('nubiaServices');
setNodeCode(nubiaServicesWorkflow, 'EXT | Serviços Núbia v2', nubiaExtCode);
saveWorkflow('nubiaServices', nubiaServicesWorkflow);

new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData', noriaExtCode);
const noriaExtWorkflow = loadWorkflow('noriaExt');
setNodeCode(noriaExtWorkflow, 'EXT NORIA - Política', noriaExtCode);
saveWorkflow('noriaExt', noriaExtWorkflow);

// Roteador: projeta as fontes nos nós de código e mantém a topologia do export (conferida abaixo).
{
  const workflow = loadWorkflow('router');
  const set = (name, code) => setNodeCode(workflow, name, code);
  const normalizerNode = workflow.nodes.find(n => n.name === 'Normalizar Entrada WhatsApp');
  if (!normalizerNode) throw new Error('MISSING_INTAKE_NORMALIZER_NODE');
  new AsyncFunction('$json', '$env', intakeNormalizerCode);
  normalizerNode.parameters.jsCode = intakeNormalizerCode;
  // Preserve the embedded router's independent changes outside the projected blocks.
  const commandNode = workflow.nodes.find(n => n.name === 'Executar Comando1');
  const embeddedRouter = commandNode?.parameters?.jsCode?.replace(/\r\n/g, '\n');
  const insertStart = embeddedRouter?.indexOf('  async function insertEvent(event) {') ?? -1;
  const insertEnd = embeddedRouter?.indexOf('  async function loadTenantSettings(', insertStart) ?? -1;
  if (insertStart < 0 || insertEnd < 0) throw new Error('CONTROL_ORIGIN_ROUTER_MISSING');
  const assignStart = embeddedRouter.indexOf(assignConversationStart, insertEnd);
  const assignEnd = embeddedRouter.indexOf(assignConversationEnd, assignStart);
  if (assignStart < 0 || assignEnd < 0) throw new Error('ASSIGN_CONVERSATION_ROUTER_MISSING');
  commandNode.parameters.jsCode = projectAppointmentRequestCommands(embeddedRouter.slice(0, insertStart) + routerInsertCode
    + '\n\n' + embeddedRouter.slice(insertEnd, assignStart) + assignConversationCommand + '\n\n' + embeddedRouter.slice(assignEnd));
  new AsyncFunction('$json', '$env', '$vars', commandNode.parameters.jsCode);
  new AsyncFunction('$json', '$env', manualReplyCaptureCode);
  set('Capturar Resposta Manual WhatsApp', manualReplyCaptureCode);
  const recoveryNode = workflow.nodes.find(n => n.name === 'Ler Fila WhatsApp');
  if (!recoveryNode || recoveryNode.type !== 'n8n-nodes-base.code') throw new Error('MISSING_TURN_RECOVERY_NODE');
  recoveryNode.parameters.jsCode = recoveryCode;
  const followUpNode = workflow.nodes.find(n => n.name === 'Processar Follow-ups');
  if (!followUpNode || followUpNode.type !== 'n8n-nodes-base.code') throw new Error('MISSING_FOLLOW_UP_DISPATCH_NODE');
  followUpNode.parameters.jsCode = followUpDispatchCode;
  const syncContactNode = workflow.nodes.find(n => n.name === 'Sincronizar Contato WhatsApp');
  if (!syncContactNode || syncContactNode.type !== 'n8n-nodes-base.code') throw new Error('MISSING_SYNC_CONTACT_NODE');
  new AsyncFunction('$json', '$env', syncContactCode);
  syncContactNode.parameters.jsCode = syncContactCode;
  const broadcastNode = workflow.nodes.find(n => n.name === 'Processar Disparos');
  if (!broadcastNode || broadcastNode.type !== 'n8n-nodes-base.code') throw new Error('MISSING_BROADCAST_DISPATCH_NODE');
  new AsyncFunction('$json', '$env', broadcastWorkerCode);
  broadcastNode.parameters.jsCode = broadcastWorkerCode;
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
  configureServicesChain(workflow);
  configureRoyalRoute(workflow);
  configureNubiaExtRoute(workflow);
  verifyParentEngine(workflow);
  applyLeanExecutionSettings(workflow);
  saveWorkflow('router', workflow);
  // Projeção do motor de fase única, usada pelos testes locais (o nó do sub-workflow usa o cabeçalho de fase acima).
  writeOut('n8n/code/whatsapp_conversation_core.generated.js', "const NORIA_NODE_PHASE = 'single';\n" + coreCode);
}

// 5. Generate whatsapp_sales.js projection
const ts = require('../app/node_modules/typescript');
const ast = ts.createSourceFile('core.js', coreCode, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const sales = ast.statements
  .filter(ts.isFunctionDeclaration)
  .filter(n => /^(sales|runSales|executeCommercial|commercialResult)/.test(n.name.text) || n.name.text === 'modelOutputDiagnostic')
  .map(n => n.getText(ast))
  .join('\n\n');
writeOut('n8n/code/whatsapp_sales.js', '// NORIA sales source projection; canonical source: n8n/sources/noria_core.js\n' + sales + '\n');

const rawDiskSha256 = crypto.createHash('sha256').update(coreCode).digest('hex');
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
  noria_ext_sha256: crypto.createHash('sha256').update(noriaExtCode).digest('hex'),
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
    'n8n/sources/noria_extension.js',
    'n8n/sources/noria_router_core.js',
    ...Object.keys(WORKFLOW_FILES).map(key => WORKFLOWS_DIR + WORKFLOW_FILES[key]),
    'clients/ic_saloon/salon_engine.js',
    'n8n/code/whatsapp_conversation_core.generated.js',
    'n8n/code/whatsapp_sales.js',
    'n8n/code/whatsapp_recover_core.js',
    'n8n/code/whatsapp_follow_up_dispatch.js',
    'n8n/code/broadcast_campaign_worker.js',
    'n8n/code/whatsapp_sync_contact.js',
    'n8n/code/command_router.js',
    'scripts/turn_queue_operational_bridge.cjs',
  ],
};
writeOut('n8n/build_manifest.json', JSON.stringify(manifest, null, 2) + '\n');

console.log('Built current NORIA CORE and Genesis EXT from canonical sources.');
console.log('Build manifest:', JSON.stringify(manifest, null, 2));

// One destination selector shared by webhook turns and recovered turns.
const singleEngine = 'CORE | Motor conversacional único';
const salonIdentity = "$json.tenant_id === '76aff8a0-0466-42b9-a80d-db186ff3d8bd'"
  + " && $json.tenant_slug === 'ic_salon' && $json.instance === 'ic_saloon'";
const isWorkflowId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]+$/.test(value);

function salonEngineExpression(sharedId, salonId) {
  if (!isWorkflowId(sharedId) || !isWorkflowId(salonId) || sharedId === salonId) {
    throw Error('IC_SALON_ROUTE_INVALID_WORKFLOW_IDS');
  }
  return '={{ ' + salonIdentity + ' ? ' + JSON.stringify(salonId) + ' : ' + JSON.stringify(sharedId) + ' }}';
}

function configuredSalonId(workflow) {
  const value = workflow.nodes.find(node => node.name === singleEngine)?.parameters?.workflowId?.value;
  const start = '={{ ' + salonIdentity + ' ? ';
  if (typeof value !== 'string' || !value.startsWith(start)) return null;
  const [salonId, sharedId] = value.slice(start.length).match(/"([a-zA-Z0-9_-]+)" : "([a-zA-Z0-9_-]+)" \}\}$/)?.slice(1) || [];
  if (!salonId || !sharedId || salonEngineExpression(sharedId, salonId) !== value) throw Error('IC_SALON_ROUTE_EXPRESSION_DRIFT');
  return salonId;
}

function applySalonRoute(workflow, sharedId, salonId) {
  const node = workflow.nodes.find(item => item.name === singleEngine);
  if (node?.type !== 'n8n-nodes-base.executeWorkflow' || node.parameters?.workflowId?.mode !== 'id'
      || node.parameters?.mode !== 'each' || node.parameters?.options?.waitForSubWorkflow !== true) {
    throw Error('IC_SALON_ROUTE_NODE_DRIFT');
  }
  const locator = node.parameters.workflowId;
  const expression = salonEngineExpression(sharedId, salonId);
  if (locator.value !== sharedId && locator.value !== expression) throw Error('IC_SALON_ROUTE_DESTINATION_DRIFT');
  locator.value = expression;
  delete locator.cachedResultUrl;
}

module.exports = { applySalonRoute, configuredSalonId, isWorkflowId, salonEngineExpression, singleEngine };

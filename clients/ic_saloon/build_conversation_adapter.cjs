// Generates an importable, inactive sub-workflow from an explicitly supplied engine export.
const fs = require('node:fs');
const { wrapSalonEngine } = require('./conversation_adapter.cjs');

function buildSalonEngine(source) {
  const node = source.nodes?.find(item => item.name === 'CORE | Motor conversacional');
  const entry = source.nodes?.find(item => item.type === 'n8n-nodes-base.executeWorkflowTrigger');
  if (!entry || !node || source.nodes.length !== 2 || node.type !== 'n8n-nodes-base.code') {
    throw Error('IC_SALON_ENGINE_EXPORT_INCOMPATIBLE');
  }
  return {
    name: 'NORIA EXT | I&C Salon | Motor isolado',
    nodes: [
      entry,
      { ...node, parameters: { ...node.parameters, jsCode: wrapSalonEngine(node.parameters.jsCode) } },
    ],
    connections: source.connections,
    settings: {
      executionOrder: 'v1', timezone: 'America/Sao_Paulo', callerPolicy: 'workflowsFromSameOwner',
      saveDataErrorExecution: 'none', saveDataSuccessExecution: 'none',
      saveManualExecutions: false, saveExecutionProgress: false,
    },
    active: false,
  };
}

if (require.main === module) {
  if (process.argv.length !== 3) throw Error('Uso: node build_conversation_adapter.cjs <export-do-motor>');
  const source = JSON.parse(fs.readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
  process.stdout.write(JSON.stringify(buildSalonEngine(source), null, 2) + '\n');
}

module.exports = { buildSalonEngine };

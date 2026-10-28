const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const workflowPath = path.join(root, 'n8n/workflows/NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json');
const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

// 1. Update "Normalizar Entrada WhatsApp"
const normalizerNode = workflow.nodes.find(n => n.name === 'Normalizar Entrada WhatsApp');
if (!normalizerNode) throw new Error('Normalizar Entrada WhatsApp not found');

normalizerNode.parameters.jsCode = fs.readFileSync(path.join(root, 'n8n/sources/whatsapp_normalize_entry.js'), 'utf8').trimEnd();
// 2. Update "Registrar Mensagem na Fila"
const enqueueNode = workflow.nodes.find(n => n.name === 'Registrar Mensagem na Fila');
if (!enqueueNode) throw new Error('Registrar Mensagem na Fila not found');

if (!enqueueNode.parameters.jsCode.includes('contact_category:')) {
  enqueueNode.parameters.jsCode = enqueueNode.parameters.jsCode.replace(
    '...(catalogReferral ? { catalog_referral: catalogReferral } : {})',
    '...(catalogReferral ? { catalog_referral: catalogReferral } : {}),\n        ...(input.contact_category ? { contact_category: input.contact_category, contact_category_label: input.contact_category_label } : {})'
  );
}

// Validate JS syntax in both nodes
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
new AsyncFunction('$json', '$env', '$vars', normalizerNode.parameters.jsCode);
new AsyncFunction('$json', '$env', '$vars', enqueueNode.parameters.jsCode);

fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2) + '\n');
console.log('Successfully updated Normalizar Entrada WhatsApp and Registrar Mensagem na Fila in core workflow.');

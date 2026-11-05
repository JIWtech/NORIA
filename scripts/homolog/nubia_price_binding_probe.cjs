// Reprodução local de uma lacuna conhecida. Não chama rede, Gemini, Evolution ou Supabase.
// Verifica a camada determinística. A associação semântica e o envio final são
// cobertos em test_service_price_evidence.cjs com transporte integral simulado.
const fs = require('node:fs');
const path = require('node:path');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const root = path.resolve(__dirname, '../..');

async function main() {
  const code = fs.readFileSync(path.join(root, 'n8n/sources/noria_core.js'), 'utf8');
  const hook = /try \{\r?\n\s*const turnResult = await runTurn\(\);/.exec(code);
  const core = await new AsyncFunction('$json', '$env', '$vars', '$getWorkflowStaticData',
    code.replace(hook[0], 'return { groundingValidateResponse };\n' + hook[0])).call(
    { helpers: { httpRequest: async () => { throw new Error('PROBE_NETWORK_FORBIDDEN'); } } },
    { tenant_id: 'fixture', tenant_slug: 'clinica_nubia_oficial', instance: 'fixture', remoteJid: 'fixture@s.whatsapp.net',
      noria_client_policy: { profile: 'nb_bronze_v1' } }, {}, {}, () => ({}));
  const catalog = { matches: [
    { external_id: 'bronze_classico', name: 'Bronze Clássico', price: 99.99, active: true },
    { external_id: 'bronze_comfort', name: 'Bronze Comfort', price: 179.99, active: true },
  ] };
  const result = { action: 'reply', reply: 'O Bronze Comfort custa R$ 99,99.', message_keys: [],
    price_claims: [{source_type:'service_price',source_id:'bronze_comfort',amount_cents:9999,excerpt:'O Bronze Comfort custa R$ 99,99.'}],
    state: { customer_name: '', service_id: 'bronze_comfort', date: '', time: '', unit_id: '', unit_evidence: '',
      name_evidence: '', service_evidence: 'in-now', date_evidence: '', time_evidence: '' } };
  try {
    const validated = core.groundingValidateResponse(result, { tenant: {id:'fixture'}, settings: { settings: { payment: { deposit_percentage: 50 } } } },
      [{ id: 'in-now', text: 'Qual o preço do Bronze Comfort?', received_at: '2026-10-23T22:00:00-03:00' }], catalog, { rows: [] });
    console.log(JSON.stringify({ gap_reproduced: true, actual_service: validated.state.service_id,
      official_price: 179.99, accepted_reply: validated.text }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({ gap_reproduced: false, rejected_by: error.message }, null, 2));
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });

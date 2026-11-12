const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const code = fs.readFileSync('n8n/code/command_router.js','utf8');
const run = new AsyncFunction('$json','$env','$vars', code);
const workflow = JSON.parse(fs.readFileSync((process.env.NORIA_WORKFLOWS_DIR||'n8n/workflows')+'/NORIA-CORE-Roteador-WhatsApp-Comandos-e-Follow-ups--3N5oN6sxtir9lFrA.json','utf8'));
const generated = new AsyncFunction('$json','$env','$vars', workflow.nodes.find(n => n.name === 'Executar Comando1').parameters.jsCode);
async function execute(options = {}) {
 const row={id:'a',status:'cancelled',channel_type:'whatsapp',external_conversation_id:'chat',updated_at:'2026-01-01',contact_name:'Ana',metadata:{cancel_reason:'Profissional adoeceu', ...options.metadata},...options.row};
 const events=[]; let sent=0; const prompts=[];
 const req=async({method,url,body})=>{const u=new URL(url), t=u.pathname.split('/').at(-1); if(t==='user')return{id:'u'}; if(t==='tenants')return[{id:'tenant',slug:'salon'}]; if(t==='tenant_members')return options.noMember ? [] : [{role:'owner'}]; if(t==='tenant_settings')return[{settings:{tone:'TOM_DO_SALAO_TESTE'}}]; if(t==='appointments'){assert.equal(u.searchParams.get('tenant_id'),'eq.tenant'); if(method==='GET')return [{...row}]; if(options.race && u.searchParams.has('updated_at')) return []; Object.assign(row,body);return [{...row}]} if(u.hostname==='generativelanguage.googleapis.com'){prompts.push(JSON.stringify(body));} if(u.hostname==='generativelanguage.googleapis.com')return options.emptyGeneration ? {} : {candidates:[{content:{parts:[{text:'Olá Ana, houve um imprevisto com a profissional.'}]}}]}; if(u.hostname==='evo.test'){sent++; if(options.failSend) throw Error('timeout'); return {key:{id:'msg'}}} if(t==='channel_events'){if(options.failEvent)throw Error('db down');events.push(body);return[{id:'e'}]} throw Error(url)};
 const env={SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'x',GEMINI_API_KEY:'x',EVOLUTION_API_URL_SALON:'https://evo.test',EVOLUTION_API_KEY_SALON:'x',EVOLUTION_INSTANCE_SALON:'s'};
 const result=(await (options.generated ? generated : run).call({helpers:{httpRequest:req}},{headers:{authorization:'Bearer x'},body:{command:'notify_appointment_cancellation',tenant_slug:'salon',payload:{appointment_id:'a',channel_type:'whatsapp',external_conversation_id:'chat',cancellation_reason:'Profissional adoeceu',...options.payload}}},env,{})).json;
 return { result, sent, events, row, prompts };
}
test('cancelamento gera mensagem contextual e registra sem handoff', async () => {
 for (const generated of [false,true]) { const {result,sent,events} = await execute({generated});
 assert.equal(result.ok,true,JSON.stringify(result)); assert.equal(sent,1); assert.equal(events[0].handoff,false); assert.equal(events[0].message_text,'Olá Ana, houve um imprevisto com a profissional.'); }
});
test('valida escopo, estado, motivo e concorrência antes de enviar', async () => {
 for (const options of [{noMember:true},{row:{external_conversation_id:'outro'}},{row:{status:'confirmed'}}, {metadata:{cancel_reason:'outro'}},{race:true},{emptyGeneration:true}]) {
  const {result,sent} = await execute(options); assert.equal(result.ok,false,JSON.stringify(options)); assert.equal(sent,0);
 }
});
test('repetição e entrega incerta não reenviam', async () => {
 const first = await execute({failSend:true}); assert.equal(first.result.ok,false); assert.equal(first.row.metadata.cancellation_notice_state,'uncertain');
 for (const state of ['uncertain','sending','sent']) { const retry=await execute({metadata:{cancellation_notice_state:state}}); assert.equal(retry.sent,0); assert.equal(retry.result.ok,state==='sent'); }
});
test('cancelamento: o Gemini recebe o motivo, o tom do tenant e a regra de tratamento neutro', async () => {
 const {result,prompts} = await execute(); assert.equal(result.ok,true);
 assert.equal(prompts.length,1); assert.match(prompts[0],/TOM_DO_SALAO_TESTE/); assert.match(prompts[0],/Profissional adoeceu/); assert.match(prompts[0],/forma neutra/);
});
test('conferência do aviso incerto ou preso: registra o resultado sem reenviar e libera nova tentativa', async () => {
 const old = new Date(Date.now() - 5 * 60000).toISOString();
 for (const generated of [false, true]) {
  const delivered = await execute({ generated, metadata: { cancellation_notice_state: 'uncertain', cancellation_notice_command: 'cmd-1', cancellation_notice_echo_text: 'Aviso' }, payload: { notice_resolution: 'delivered' } });
  assert.equal(delivered.result.ok, true, JSON.stringify(delivered.result)); assert.equal(delivered.sent, 0);
  assert.equal(delivered.row.metadata.cancellation_notice_state, 'sent'); assert.equal(delivered.row.metadata.cancellation_notice_reconciled.message_id_unknown, true);
  assert.equal(delivered.row.metadata.cancellation_notice_reconciled.actor, 'u'); assert.equal('cancellation_notice_echo_text' in delivered.row.metadata, false);
  const known = await execute({ generated, metadata: { cancellation_notice_state: 'uncertain', cancellation_notice_message_id: 'provider-9' }, payload: { notice_resolution: 'delivered' } });
  assert.equal(known.row.metadata.cancellation_notice_message_id, 'provider-9'); assert.equal(known.row.metadata.cancellation_notice_reconciled.message_id_unknown, false);
  const notDelivered = await execute({ generated, metadata: { cancellation_notice_state: 'sending', cancellation_notice_at: old, cancellation_notice_command: 'cmd-1' }, payload: { notice_resolution: 'not_delivered' } });
  assert.equal(notDelivered.result.ok, true, JSON.stringify(notDelivered.result)); assert.equal(notDelivered.sent, 0);
  assert.equal(notDelivered.row.metadata.cancellation_notice_state, undefined); assert.equal(notDelivered.row.metadata.cancellation_notice_command, undefined);
  for (const metadata of [{ cancellation_notice_state: 'sending', cancellation_notice_at: new Date().toISOString() }, { cancellation_notice_state: 'sent' }, {}]) {
   const refused = await execute({ generated, metadata, payload: { notice_resolution: 'delivered' } });
   assert.equal(refused.result.ok, false, JSON.stringify(metadata)); assert.equal(refused.sent, 0);
  }
  assert.equal((await execute({ generated, metadata: { cancellation_notice_state: 'uncertain' }, payload: { notice_resolution: 'talvez' } })).result.ok, false);
  assert.equal((await execute({ generated, noMember: true, metadata: { cancellation_notice_state: 'uncertain' }, payload: { notice_resolution: 'delivered' } })).result.ok, false);
 }
});
test('já enviado informa already_sent sem novo envio; falha ao registrar a entrega incerta é dita ao operador', async () => {
 const again = await execute({ metadata: { cancellation_notice_state: 'sent' } });
 assert.equal(again.result.already_sent, true); assert.equal(again.sent, 0);
});

test('aviso entregue com falha ao gravar o evento ainda é sucesso, com aviso de histórico (IA-08)',async()=>{
 for(const generated of [false,true]){const {result,sent,row}=await execute({generated,failEvent:true});
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(sent,1);assert.equal(result.event_warning,'EVENT_NOT_RECORDED');assert.equal(row.metadata.cancellation_notice_state,'sent');}
});

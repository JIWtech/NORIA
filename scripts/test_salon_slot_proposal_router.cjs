const test=require('node:test'), assert=require('node:assert/strict'),fs=require('node:fs');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const fn=new AsyncFunction('$json','$env','$vars',fs.readFileSync('n8n/code/command_router.js','utf8'));
const workflow=JSON.parse(fs.readFileSync((process.env.NORIA_WORKFLOWS_DIR||'n8n/workflows')+'/NORIA-CORE-Roteador-WhatsApp-Comandos-e-Follow-ups--3N5oN6sxtir9lFrA.json','utf8'));
const generated=new AsyncFunction('$json','$env','$vars',workflow.nodes.find(n=>n.name==='Executar Comando1').parameters.jsCode);
const structured=(value)=>({candidates:[{content:{parts:[{text:JSON.stringify(value)}]}}]});
async function execute(options={}) {
 const calls=[]; const row={id:'a',status:'pending_confirmation',starts_at:'2099-09-28T13:00:00Z',channel_type:'whatsapp',external_conversation_id:'chat',updated_at:'2026-01-01',contact_name:'Ana',metadata:{request_version:2,services:['Corte']}};
 Object.assign(row,options.row||{});
 const resolutionEnabled=options.resolutionEnabled!==false;
 const req=async({method,url,body})=>{const u=new URL(url), t=u.hostname==='evo.test'?'sendText':u.pathname.split('/').at(-1);calls.push({t,method,body}); if(t==='user')return{id:'u'};if(t==='tenants')return[{id:'tenant',slug:'salon'}];if(t==='tenant_members')return options.noMember?[]:[{role:'owner'}];if(t==='tenant_settings')return[{timezone:'America/Sao_Paulo',settings:{tone:'TOM_DO_SALAO_TESTE',appointment_request:{mode:'operator_confirmation',slot_proposal_enabled:options.enabled!==false,slot_proposal_resolution_enabled:resolutionEnabled,reply_mode:'contextual',confirmation_template:'{nome}, confirmado: {servicos}, {data}, às {hora}. Menores só acompanhados.',slot_rejected_template:'Texto legado',...options.config}}}];if(t==='appointments'){assert.equal(u.searchParams.get('tenant_id'),'eq.tenant');if(method==='PATCH')return[{...row,...body}];return[row]};if(u.hostname==='generativelanguage.googleapis.com'){if(options.geminiFail)throw Error('gemini fora');return structured(options.gemini??{text:options.text??'Ana, podemos oferecer 29/09/2099 às 10:00?',date:'29/09/2099',time:'10:00'})};if(t==='magia_slot_proposal_prepare'){if(options.prepareFail)throw Error('concorrência');return{proposal:{status:'sending'},already:false}};if(t==='sendText'){if(options.sendFail)throw Error('timeout');return{key:{id:'msg'}}};if(t==='magia_slot_proposal_finalize'){if(options.finalizeFail)throw Error('timeout');return{proposal:{status:'sent'},appointment:row}};if(t==='magia_slot_proposal_mark_uncertain'){if(options.markFail)throw Error('banco fora');return{proposal:{status:'uncertain'},appointment:row}};if(t==='magia_slot_proposal_reconcile')return{proposal:{status:body.p_resolution==='delivered'?'sent':'not_delivered'},appointment:row};if(t==='channel_events')return[{id:'e'}];throw Error(url)};
 const env={SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'x',GEMINI_API_KEY:'x',EVOLUTION_API_URL_SALON:'https://evo.test',EVOLUTION_API_KEY_SALON:'x',EVOLUTION_INSTANCE_SALON:'s'};
 const payload={appointment_id:'a',channel_type:'whatsapp',external_conversation_id:'chat',request_version:2,...(options.noProposal?{}:{suggested_date:'2099-09-29',suggested_time:'10:00'}),...options.payload};
 const result=(await (options.generated?generated:fn).call({helpers:{httpRequest:req}},{headers:{authorization:'Bearer x'},body:{tenant_slug:'salon',command:options.command||'reject_appointment_slot',payload}},env,{})).json;
 return {result,calls};
}
test('proposta de horário usa Gemini e somente ativa após envio comprovado',async()=>{
 for (const generated of [false,true]) { const {result,calls}=await execute({generated});
 assert.equal(result.ok,true,JSON.stringify(result)); const order=calls.map(c=>c.t); assert.ok(order.includes('magia_slot_proposal_prepare'));assert.ok(order.includes('magia_slot_proposal_finalize')); assert.ok(order.indexOf('magia_slot_proposal_prepare')<order.indexOf('sendText'));assert.ok(order.indexOf('sendText')<order.indexOf('magia_slot_proposal_finalize')); }
});
test('valida escopo, configuração, versão, data e conteúdo antes de enviar',async()=>{
 for(const options of [{noMember:true},{enabled:false},{resolutionEnabled:false},{row:{external_conversation_id:'other'}},{row:{status:'cancelled'}},{payload:{request_version:1}},{payload:{suggested_date:'2099-02-30'}},{payload:{suggested_time:'25:00'}},{text:'Posso oferecer outro horário?',gemini:{text:'Posso oferecer outro horário?',date:'30/09/2099',time:'10:00'}},{gemini:{text:'x',date:'29/09/2099',time:'11:00'}},{prepareFail:true}]){
   const {result,calls}=await execute(options);assert.equal(result.ok,false,JSON.stringify(options));assert.equal(calls.some(c=>c.t==='sendText'),false,JSON.stringify(options));
 }
});
test('as duas chaves são exigidas e a recusa acontece antes de qualquer chamada ao Gemini',async()=>{
 for(const options of [{enabled:false},{resolutionEnabled:false}]){
   const {result,calls}=await execute(options);assert.equal(result.ok,false);assert.match(result.error,/nao esta ativa/);
   assert.equal(calls.some(c=>/generateContent/.test(c.t)),false);assert.equal(calls.some(c=>c.t==='magia_slot_proposal_prepare'),false);
 }
});
test('data e hora passadas no fuso do tenant são recusadas antes do Gemini, com texto próprio',async()=>{
 const past=await execute({payload:{suggested_date:'2000-01-01',suggested_time:'10:00'}});
 assert.equal(past.result.ok,false);assert.match(past.result.error,/horario proposto ja passou/);
 assert.equal(past.calls.some(c=>/generateContent/.test(c.t)),false);assert.equal(past.calls.some(c=>c.t==='sendText'),false);
 const invalid=await execute({payload:{suggested_time:'25:00'}});assert.match(invalid.result.error,/invalido/);assert.equal(invalid.calls.some(c=>/generateContent/.test(c.t)),false);
});
test('a conferência de data e hora aceita variações estruturadas (14h, 14:00, 14h00; dd/mm e dd/mm/aaaa)',async()=>{
 for(const [date,time] of [['29/09/2099','10h'],['29/09','10:00'],['29/09/2099','10h00'],['2099-09-29','10']]){
   const {result}=await execute({gemini:{text:'Ana, que tal 29/09/2099 às 10h?',date,time}});assert.equal(result.ok,true,date+' '+time+' '+JSON.stringify(result));
 }
 for(const [date,time] of [['30/09/2099','10:00'],['29/10','10:00'],['29/09/2098','10:00'],['29/09/2099','10:30'],['', '10:00']]){
   const {result}=await execute({gemini:{text:'Ana, que tal esse dia?',date,time}});assert.equal(result.ok,false,date+' '+time);
 }
});
test('texto vago ou com outra data/hora é recusado mesmo com os campos estruturados corretos (IA-03)',async()=>{
 for(const text of ['Ana, que tal esse dia?','Ana, que tal 30/09 às 10h?','Ana, que tal 29/09 às 15h?','Ana, que tal 29/09?']){
   const {result,calls}=await execute({gemini:{text,date:'29/09/2099',time:'10:00'}});assert.equal(result.ok,false,text);assert.equal(calls.some(c=>c.t==='sendText'),false,text);
 }
 for(const text of ['Ana, que tal dia 29 às 10:00?','Ana, 29 de setembro às 10h00, pode ser?']){
   const {result}=await execute({gemini:{text,date:'29/09/2099',time:'10:00'}});assert.equal(result.ok,true,text+JSON.stringify(result));
 }
});
test('entrega incerta ou falha da ativação não relatam sucesso',async()=>{
 const uncertain=await execute({sendFail:true});assert.equal(uncertain.result.ok,false);assert.match(uncertain.result.error,/Entrega nao comprovada/);assert.equal(uncertain.calls.some(c=>c.t==='magia_slot_proposal_finalize'),false);assert.equal(uncertain.calls.some(c=>c.t==='magia_slot_proposal_mark_uncertain'),true);
 const finalization=await execute({finalizeFail:true});assert.equal(finalization.result.ok,false);assert.match(finalization.result.error,/Mensagem enviada/);
});
test('a falha do mark_uncertain não é engolida e o id do provedor é gravado quando o envio funcionou',async()=>{
 const sendAndMarkFail=await execute({sendFail:true,markFail:true});assert.equal(sendAndMarkFail.result.ok,false);assert.match(sendAndMarkFail.result.error,/Nao foi possivel marcar a proposta como incerta/);assert.match(sendAndMarkFail.result.error,/banco fora/);
 const finalizeAndMarkFail=await execute({finalizeFail:true,markFail:true});assert.match(finalizeAndMarkFail.result.error,/Mensagem enviada/);assert.match(finalizeAndMarkFail.result.error,/Nao foi possivel marcar/);
 const stored=await execute({finalizeFail:true});const mark=stored.calls.find(c=>c.t==='magia_slot_proposal_mark_uncertain').body;
 assert.equal(mark.p_message_id,'msg');
 const noId=await execute({sendFail:true});assert.equal('p_message_id' in noId.calls.find(c=>c.t==='magia_slot_proposal_mark_uncertain').body,false);
});
test('resolução da proposta incerta ou presa em envio: membro, id opcional e estados válidos',async()=>{
 const row={metadata:{request_version:2,confirmation_state:'uncertain',slot_proposal:{id:'proposal-1',status:'uncertain'}}};
 const noProposal={suggested_date:undefined,suggested_time:undefined};
 const notDelivered=await execute({row,payload:{proposal_resolution:'not_delivered',...noProposal}});
 assert.equal(notDelivered.result.ok,true,JSON.stringify(notDelivered.result));assert.equal(notDelivered.calls.some(c=>c.t==='magia_slot_proposal_reconcile'),true);assert.equal(notDelivered.calls.some(c=>c.t==='sendText'),false);
 // sem id digitado: o banco usa o id gravado no envio ou registra a conferência manual; o router não exige id
 const delivered=await execute({row,payload:{proposal_resolution:'delivered',...noProposal}});assert.equal(delivered.result.ok,true,JSON.stringify(delivered.result));
 assert.equal(delivered.calls.find(c=>c.t==='magia_slot_proposal_reconcile').body.p_message_id,null);
 const resolved=await execute({row,payload:{proposal_resolution:'delivered',proposal_message_id:'real-id',...noProposal}});assert.equal(resolved.result.ok,true);const rpc=resolved.calls.find(c=>c.t==='magia_slot_proposal_reconcile').body;assert.equal(rpc.p_message_id,'real-id');assert.equal(rpc.p_actor,'u');assert.equal(rpc.p_proposal_id,'proposal-1');
 const unauthorized=await execute({row,noMember:true,payload:{proposal_resolution:'not_delivered',...noProposal}});assert.equal(unauthorized.result.ok,false);assert.equal(unauthorized.calls.some(c=>c.t==='magia_slot_proposal_reconcile'),false);
 const recent=await execute({row:{metadata:{request_version:2,confirmation_state:'sending',slot_proposal:{id:'p',status:'sending',prepared_at:new Date().toISOString()}}},payload:{proposal_resolution:'not_delivered',...noProposal}});assert.equal(recent.result.ok,false);assert.equal(recent.calls.some(c=>c.t==='magia_slot_proposal_reconcile'),false);
 const stuck=await execute({row:{metadata:{request_version:2,confirmation_state:'sending',slot_proposal:{id:'p',status:'sending',prepared_at:new Date(Date.now()-5*60000).toISOString()}}},payload:{proposal_resolution:'not_delivered',...noProposal}});assert.equal(stuck.result.ok,true,JSON.stringify(stuck.result));assert.equal(stuck.calls.some(c=>c.t==='magia_slot_proposal_reconcile'),true);
});
test('proposta: o Gemini recebe o tom do tenant e a regra de tratamento neutro',async()=>{
 const {result,calls}=await execute();assert.equal(result.ok,true);
 const gemini=calls.find(c=>/generateContent/.test(c.t));assert.ok(gemini,'chamada ao Gemini');
 const prompt=JSON.stringify(gemini.body);assert.match(prompt,/TOM_DO_SALAO_TESTE/);assert.match(prompt,/forma neutra/);assert.match(prompt,/feminino/);
});
test('confirmar e pedir outro horário: o Gemini escreve com dados conferidos; o modelo do tenant só entra se ele falhar',async()=>{
 const confirm={text:'Ana, tudo certo! Corte dia 28/09 às 10h. Menores só acompanhados.',date:'28/09/2099',time:'10h00',services:['corte'],avisos_do_modelo_mantidos:true};
 const ok=await execute({command:'confirm_appointment_request',noProposal:true,gemini:confirm,payload:{conflicts_acknowledged:true}});
 assert.equal(ok.result.ok,true,JSON.stringify(ok.result));assert.equal(ok.calls.find(c=>c.t==='sendText').body.text,confirm.text);
 const prompt=JSON.stringify(ok.calls.find(c=>/generateContent/.test(c.t)).body);assert.match(prompt,/TOM_DO_SALAO_TESTE/);assert.match(prompt,/Menores só acompanhados/);assert.match(prompt,/forma neutra/);
 assert.equal(ok.calls.find(c=>c.t==='channel_events').body.raw_payload.message_source,'gemini');
 // dado errado (hora, serviço) ou aviso omitido: não envia a prosa; cai no modelo técnico do tenant
 for(const bad of [{...confirm,time:'11:00'},{...confirm,services:['barba']},{...confirm,avisos_do_modelo_mantidos:false},{...confirm,date:'29/09/2099'}]){
   const r=await execute({command:'confirm_appointment_request',noProposal:true,gemini:bad,payload:{conflicts_acknowledged:true}});
   assert.equal(r.result.ok,true);const sent=r.calls.find(c=>c.t==='sendText').body.text;assert.match(sent,/^Ana, confirmado: Corte,/);assert.match(sent,/Menores só acompanhados/);
   assert.equal(r.calls.find(c=>c.t==='channel_events').body.raw_payload.message_source,'template_fallback');
 }
 const down=await execute({command:'confirm_appointment_request',noProposal:true,geminiFail:true,payload:{conflicts_acknowledged:true}});
 assert.equal(down.result.ok,true);assert.match(down.calls.find(c=>c.t==='sendText').body.text,/^Ana, confirmado: Corte,/);
 const reject=await execute({noProposal:true,gemini:{text:'Ana, 28/09 às 10h não está livre. Qual outro fica bom?',date:'28/09/2099',time:'10:00',avisos_do_modelo_mantidos:true}});
 assert.equal(reject.result.ok,true,JSON.stringify(reject.result));assert.equal(reject.calls.find(c=>c.t==='sendText').body.text,'Ana, 28/09 às 10h não está livre. Qual outro fica bom?');
 const rejectDown=await execute({noProposal:true,geminiFail:true});assert.equal(rejectDown.calls.find(c=>c.t==='sendText').body.text,'Texto legado');
});
test('proposta: conversa em andamento (sem cumprimento), horário pedido citado e data por extenso no texto',async()=>{
 const {result,calls}=await execute();assert.equal(result.ok,true);
 const prompt=JSON.stringify(calls.find(c=>/generateContent/.test(c.t)).body);
 assert.match(prompt,/já está em andamento/);
 assert.match(prompt,/não cumprimente/);
 assert.match(prompt,/horario_pedido/);
 assert.match(prompt,/29 de setembro/);
 assert.doesNotMatch(prompt,/"data":"29\/09\/2099"/);
});

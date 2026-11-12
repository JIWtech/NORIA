const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../n8n/code/whatsapp_follow_up_dispatch.js'),'utf8');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
// Relógio fixo para o código do despachante (que usa new Date()); padrão: 15:00 em Brasília.
function withClock(iso,fn){
  const Real=Date,fixed=new Real(iso).getTime();
  class Fixed extends Real{constructor(...a){super(...(a.length?a:[fixed]));}static now(){return fixed;}}
  globalThis.Date=Fixed;
  return fn().finally(()=>{globalThis.Date=Real;});
}
async function run({sales=true,blocked=false,race=false,guardError=false,sendError=false,saveError=false,changed=false,now='2026-10-24T18:00:00Z',extra={},deferRows=1,anchor=null,history=null,modelText='{"reply":"Podemos continuar?"}'}={}){
  const calls=[],finishes=[],patches=[];let checks=0,sends=0,models=0,prompt=null;
  const job={id:'job',lease_token:'lease',tenant_id:'tenant',tenant_slug:'client',channel_type:'whatsapp',
    external_conversation_id:'5521988887777@s.whatsapp.net',anchor_created_at:'2026-10-01T12:00:00Z',anchor_event_id:'anchor',step_key:'3h'};
  const settings={...(sales?{conversation_capability:'sales_v1',contact_exclusion_enabled:true}:{}),
    ai_model:'gemini-2.5-flash',system_prompt:'Prompt',sales_follow_up:{enabled:true,messages:{'3h':'Podemos continuar seu atendimento?'}},...extra};
  const request=async({url,method,body})=>{
    calls.push({url,method,body});const u=new URL(url),table=u.pathname.split('/').at(-1);
    if(table==='magia_claim_followup_jobs')return [job];
    if(table==='tenant_settings')return [{settings}];
    if(table==='magia_validate_sales_followup'){
      checks++;assert.equal(body.p_job,job.id);assert.equal(body.p_lease,job.lease_token);
      if(guardError)throw Error('Guard unavailable');return {allowed:!blocked&&!(race&&checks>1)};
    }
    if(table==='magia_finish_followup_job'){finishes.push(body);return true;}
    if(table==='magia_gemini_reserve')return {allowed:true};
    if(table==='magia_gemini_release')return true;
    if(table==='follow_up_jobs'&&method==='PATCH'){patches.push({query:u.search,body});return Array.from({length:deferRows},()=>({id:job.id}));}
    if(table==='appointments'){assert.equal(sales,false);return [];}
    if(table==='channel_events'){
      if(method==='POST'){if(saveError)throw Error('Database timeout');return [{id:'sent'}];}
      if(anchor&&u.search.includes('id=eq.anchor')){assert.match(u.search,/tenant_id=eq\.tenant/);return [{raw_payload:anchor}];}
      if(history&&u.search.includes('limit=16')){assert.match(u.search,/tenant_id=eq\.tenant/);return [...history];}
      return changed?[{direction:'inbound',sender_type:'contact'}]:[];
    }
    if(table==='channels')return [{external_id:'client'}];
    if(u.hostname==='evo.test'){sends++;if(sendError)throw Error('ETIMEDOUT');return {key:{id:'msg'}};}
    if(u.hostname==='generativelanguage.googleapis.com'){models++;prompt=body;return {candidates:[{finishReason:'STOP',content:{parts:[{text:modelText}]}}]};}
    throw Error('Unexpected '+url);
  };
  const result=await withClock(now,()=>new AsyncFunction('$env',code).call({helpers:{httpRequest:request}},
    {SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'fake',GEMINI_API_KEY:'fake',
      EVOLUTION_API_URL_CLIENT:'https://evo.test',EVOLUTION_API_KEY_CLIENT:'fake',EVOLUTION_INSTANCE_CLIENT:'client'}));
  return {result,calls,finishes,patches,checks,sends,models,prompt};
}
test('sales sends configured message with two live guards, without model, documents or appointments',async()=>{
  const r=await run();assert.equal(r.sends,1);assert.equal(r.checks,2);assert.equal(r.models,0);
  assert.equal(r.finishes[0].p_status,'sent');
  const event=r.calls.find(c=>c.method==='POST'&&c.url.endsWith('/channel_events')).body;
  assert.equal(event.ai_provider,'configured_follow_up');
});
test('excluded/human/paused lead or changed conversation cancels before any send',async()=>{
  for(const flags of [{blocked:true},{race:true},{changed:true}]){
    const r=await run(flags);assert.equal(r.sends,0);assert.equal(r.finishes[0].p_status,'cancelled');
  }
});
test('failed eligibility never permits sending',async()=>{
  const r=await run({guardError:true});assert.equal(r.sends,0);assert.equal(r.finishes[0].p_status,'failed');
});
test('any failure after send begins is uncertain, including persistence failure',async()=>{
  for(const flags of [{sendError:true},{saveError:true}]){
    const r=await run(flags);assert.equal(r.sends,1);assert.equal(r.finishes[0].p_status,'uncertain');
  }
});
test('non-sales existing follow-up keeps its model and appointment checks',async()=>{
  const r=await run({sales:false});assert.equal(r.sends,1);assert.equal(r.models,1);assert.equal(r.checks,0);
  assert.equal(r.calls.filter(c=>c.url.includes('/appointments?')).length,2);
});

// Janela de silêncio (pedido do usuário em 24/10): nenhum follow-up entre 21:00 e 06:00 no fuso do tenant.
// O job reivindicado nessa janela volta para pending com vencimento no fim dela; nada é gerado nem enviado.
const deferredTo=r=>{assert.equal(r.patches.length,1,JSON.stringify(r.result));const p=r.patches[0];
  assert.match(p.query,/id=eq\.job/);assert.match(p.query,/lease_token=eq\.lease/);assert.match(p.query,/status=eq\.processing/);
  assert.equal(p.body.status,'pending');assert.equal(p.body.lease_token,null);assert.equal(p.body.locked_until,null);return p.body.due_at;};
for(const sales of [true,false]){
  test('quiet hours ('+(sales?'vendas':'IA')+'): às 22:30 não envia e adia para 06:00 do dia seguinte',async()=>{
    const r=await run({sales,now:'2026-10-25T01:30:00Z'});
    assert.equal(r.sends,0);assert.equal(r.models,0);assert.equal(r.finishes.length,0);
    assert.equal(deferredTo(r),'2026-10-25T09:00:00.000Z');
    assert.equal(r.result[0].json.status,'deferred');
  });
}
test('quiet hours: às 05:59 adia para 06:00 do mesmo dia',async()=>{
  const r=await run({now:'2026-10-24T08:59:30Z'});assert.equal(r.sends,0);assert.equal(deferredTo(r),'2026-10-24T09:00:00.000Z');
});
test('quiet hours: às 21:00 em ponto já não envia',async()=>{
  const r=await run({now:'2026-10-25T00:00:00Z'});assert.equal(r.sends,0);assert.equal(deferredTo(r),'2026-10-25T09:00:00.000Z');
});
test('fora da janela (06:00 e 20:59) envia normalmente',async()=>{
  for(const now of ['2026-10-24T09:00:00Z','2026-10-24T23:59:00Z']){
    const r=await run({now});assert.equal(r.sends,1,now);assert.equal(r.patches.length,0,now);assert.equal(r.finishes[0].p_status,'sent');
  }
});
test('tenant pode configurar a janela (follow_up_quiet_hours) e o fuso (timezone)',async()=>{
  const extra={follow_up_quiet_hours:{start:'22:00',end:'08:00'}};
  assert.equal((await run({now:'2026-10-25T00:30:00Z',extra})).sends,1);
  assert.equal(deferredTo(await run({now:'2026-10-24T10:00:00Z',extra})),'2026-10-24T11:00:00.000Z');
  const manaus={timezone:'America/Manaus'};
  assert.equal((await run({now:'2026-10-25T00:30:00Z',extra:manaus})).sends,1);
  assert.equal(deferredTo(await run({now:'2026-10-25T01:30:00Z',extra:manaus})),'2026-10-25T10:00:00.000Z');
});
test('configuração inválida usa a janela padrão 21:00-06:00',async()=>{
  const r=await run({now:'2026-10-25T01:30:00Z',extra:{follow_up_quiet_hours:{start:'25:00',end:'x'},timezone:'Fuso/Inexistente'}});
  assert.equal(r.sends,0);assert.equal(deferredTo(r),'2026-10-25T09:00:00.000Z');
});
test('se o adiamento não for gravado, falha fechado: não envia',async()=>{
  const r=await run({now:'2026-10-25T01:30:00Z',deferRows:0});
  assert.equal(r.sends,0);assert.equal(r.finishes[0].p_status,'failed');
});

// Retomada por IA depois do adiamento (vendas). A decisao e do tenant: settings.sales_follow_up.disposition_actions.deferred_by_customer='resume'.
// Sem essa configuracao nada muda; o silencio do cliente (awaiting_customer) segue com o texto fixo.
const FIXED='Podemos continuar seu atendimento?';
const withActions=disposition_actions=>({sales_follow_up:{enabled:true,messages:{'3h':FIXED},disposition_actions}});
const RESUME=withActions({deferred_by_customer:'resume'});
const DEFERRED={follow_up_disposition:'deferred_by_customer'};
const HISTORY=[{direction:'outbound',message_text:'Fico no aguardo, sem pressa.',created_at:'2026-10-24T12:01:00Z'},
  {direction:'inbound',message_text:'vou pensar e depois eu vejo',created_at:'2026-10-24T12:00:00Z'}];
const sentEvent=r=>r.calls.find(c=>c.method==='POST'&&c.url.endsWith('/channel_events')).body;
const siblingCancels=r=>r.patches.filter(p=>/anchor_event_id=eq\.anchor/.test(p.query)&&p.body.status==='cancelled');

test('vendas sem a acao resume: adiamento segue com o texto fixo, sem modelo (comportamento atual)',async()=>{
  for(const extra of [{},withActions({deferred_by_customer:'keep'}),withActions({declined:'resume'})]){
    const r=await run({extra,anchor:DEFERRED,history:HISTORY});
    assert.equal(r.models,0);assert.equal(r.sends,1);
    assert.equal(sentEvent(r).message_text,FIXED);assert.equal(sentEvent(r).ai_provider,'configured_follow_up');
    assert.equal(siblingCancels(r).length,0);
  }
});
test('vendas com resume e adiamento: a IA escreve a retomada com historico, prompt do tenant e regras de retomada',async()=>{
  const r=await run({extra:RESUME,anchor:DEFERRED,history:HISTORY,modelText:'{"action":"send","reply":"Oi! Conseguiu pensar com calma?"}'});
  assert.equal(r.models,1);assert.equal(r.sends,1);assert.equal(r.checks,2);assert.equal(r.finishes[0].p_status,'sent');
  const event=sentEvent(r);
  assert.equal(event.message_text,'Oi! Conseguiu pensar com calma?');
  // Fora de configured_follow_up de proposito: a elegibilidade do banco bloqueia qualquer nova etapa depois desta retomada.
  assert.equal(event.ai_provider,'gemini_follow_up');
  assert.equal(r.prompt.system_instruction.parts[0].text,'Prompt');
  const input=JSON.parse(r.prompt.contents[0].parts[0].text);
  assert.deepEqual(input.conversation.map(m=>m.text),['vou pensar e depois eu vejo','Fico no aguardo, sem pressa.']);
  assert.match(input.rules.join(' '),/adiou a decisao/);
  assert.ok(!JSON.stringify(r.prompt).includes(FIXED),'o texto fixo nao vai ao modelo nem ao cliente');
  assert.ok(r.calls.filter(c=>c.url.includes('/channel_events?')&&c.method==='GET').every(c=>/tenant_id=eq\.tenant/.test(c.url)),'consultas com escopo de tenant');
});
test('vendas com resume: so uma retomada; as demais etapas pendentes da mesma ancora sao canceladas',async()=>{
  const r=await run({extra:RESUME,anchor:DEFERRED,history:HISTORY});
  const cancels=siblingCancels(r);
  assert.equal(cancels.length,1);
  assert.match(cancels[0].query,/tenant_id=eq\.tenant/);assert.match(cancels[0].query,/status=eq\.pending/);
  const skipped=await run({extra:RESUME,anchor:DEFERRED,history:HISTORY,modelText:'{"action":"skip","reply":""}'});
  assert.equal(skipped.sends,0);assert.equal(skipped.finishes[0].p_error,'follow_up_not_applicable');
  assert.equal(siblingCancels(skipped).length,1,'skip tambem encerra as etapas seguintes');
  const uncertain=await run({extra:RESUME,anchor:DEFERRED,history:HISTORY,sendError:true});
  assert.equal(uncertain.finishes[0].p_status,'uncertain');assert.equal(siblingCancels(uncertain).length,1);
});
test('vendas com resume: silencio (awaiting_customer) continua com texto fixo, sem modelo e sem cancelar etapas',async()=>{
  const r=await run({extra:RESUME,anchor:{follow_up_disposition:'awaiting_customer'},history:HISTORY});
  assert.equal(r.models,0);assert.equal(r.sends,1);
  assert.equal(sentEvent(r).message_text,FIXED);assert.equal(sentEvent(r).ai_provider,'configured_follow_up');
  assert.equal(siblingCancels(r).length,0);
});
test('vendas com resume: recusa, encerramento e atendimento resolvido continuam sem retomada',async()=>{
  for(const value of ['declined','closed']){
    const r=await run({extra:RESUME,anchor:{...DEFERRED,grounding:{customer_disposition:{value}}},history:HISTORY});
    assert.equal(r.models,0);assert.equal(r.sends,0);assert.equal(r.finishes[0].p_status,'cancelled');
  }
  for(const flags of [{blocked:true},{changed:true}]){
    const r=await run({extra:RESUME,anchor:DEFERRED,history:HISTORY,...flags});
    assert.equal(r.sends,0);assert.equal(r.models,0);assert.equal(r.finishes[0].p_status,'cancelled');
  }
  // A acao resume so vale para o adiamento: nao autoriza IA para outras disposicoes.
  for(const disposition of ['declined','closed_by_customer','resolved']){
    const r=await run({extra:withActions({[disposition]:'resume',deferred_by_customer:'resume'}),anchor:{follow_up_disposition:disposition},history:HISTORY});
    assert.equal(r.models,0,disposition);
  }
});
test('vendas com resume: horario de silencio adia sem gerar nem enviar',async()=>{
  const r=await run({extra:RESUME,anchor:DEFERRED,history:HISTORY,now:'2026-10-25T01:30:00Z'});
  assert.equal(r.models,0);assert.equal(r.sends,0);assert.equal(r.result[0].json.status,'deferred');
});

// EXT da Genesis: 'resume' so e reconhecida para o adiamento; sem configuracao nada tem acao embutida.
const ext=fs.readFileSync(path.join(__dirname,'../n8n/sources/genesis_extension.js'),'utf8').replace(/\r\n/g,'\n');
const extPolicy=(()=>{const start=ext.indexOf('function followUpDispositionPolicy(');assert.ok(start>=0);
  return new Function(ext.slice(start,ext.indexOf('\n}\n',start)+3)+'; return followUpDispositionPolicy;')();})();
test('EXT Genesis reconhece resume somente para deferred_by_customer, sem acao padrao',()=>{
  assert.deepEqual(extPolicy({}).actions,{declined:'undecided',closed_by_customer:'undecided',deferred_by_customer:'undecided'});
  const policy=extPolicy({sales_follow_up:{disposition_actions:{deferred_by_customer:'resume',declined:'resume',closed_by_customer:'cancel'}}});
  assert.deepEqual(policy.actions,{declined:'undecided',closed_by_customer:'cancel',deferred_by_customer:'resume'});
  assert.equal(policy.sources.deferred_by_customer,'tenant_policy');assert.equal(policy.sources.declined,'no_policy_defined');
  assert.equal(extPolicy({sales_follow_up:{disposition_actions:{deferred_by_customer:'keep'}}}).actions.deferred_by_customer,'keep');
  assert.equal(extPolicy({sales_follow_up:{disposition_actions:{deferred_by_customer:'qualquer'}}}).actions.deferred_by_customer,'undecided');
});

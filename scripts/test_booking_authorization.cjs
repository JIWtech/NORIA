const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const code=fs.readFileSync(require('node:path').join(__dirname,'../n8n/code/whatsapp_conversation_core.generated.js'),'utf8');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const state={customer_name:'Cliente Fixture',service_id:'comfort',date:'2026-11-02',time:'10:00',unit_id:'unit',unit_evidence:'',
  name_evidence:'prior',service_evidence:'prior',date_evidence:'prior',time_evidence:'prior'};
const context={tenant:{id:'tenant',slug:'fixture'},settings:{settings:{system_prompt:'Fixture',prompt_revision:'fixture',ai_model:'gemini-3.5-flash-lite'}}};
const catalog={matches:[{external_id:'comfort',name:'Comfort',price:179.99,active:true}]};
const body=value=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(value)}]}}]});
async function run({authorized=false,evidence=['now'],badScope=false,auditFailure=false}={}) {
  let calls=0;
  const hook=/try \{\r?\n\s*const turnResult = await runTurn\(\);/.exec(code);
  const core=await new AsyncFunction('$json','$env','$vars','$getWorkflowStaticData',code.replace(hook[0],
    "geminiTenantBudget={tenant_id:'tenant',daily_limit:100};turn={token:'token',boundary_id:'session',messages:[{event_id:'now',text:'Como funciona o Comfort?'}]};return {callGroundedGemini,groundingValidateResponse};\n"+hook[0])).call({helpers:{httpRequest:async options=>{
      if(options.url.endsWith('/rpc/magia_gemini_reserve'))return {allowed:true};
      if(options.url.endsWith('/rpc/magia_gemini_release'))return {};
      assert.ok(options.url.includes('generativelanguage.googleapis.com'));
      calls++;
      if(calls===1)return body({action:'create_appointment',reply:'',message_keys:[],price_claims:[],state});
      if(auditFailure)throw new Error('auditor unavailable');
      const input=JSON.parse(options.body.contents[0].parts[0].text);
      return body({scope_key:badScope?'another-turn':input.scope_key,authorized,
        evidence_ids:evidence,service_id:'comfort',unit_id:'unit',date:'2026-11-02',time:'10:00',customer_name:'Cliente Fixture'});
    }}},{tenant_slug:'fixture',tenant_id:'tenant',text:'Como funciona o Comfort?'},
    {GEMINI_API_KEY:'fixture',GEMINI_ENABLED:'true',SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture'}, {},()=>({}));
  const history=[{id:'prior',direction:'inbound',message_text:'Meu nome é Cliente Fixture, quero Comfort para 02/11 às 10h.',created_at:'2026-10-23T22:00:00-03:00'},
    {id:'now',direction:'inbound',message_text:'Como funciona o Comfort?',created_at:'2026-10-23T22:01:00-03:00'}];
  const result=await core.callGroundedGemini(context,history,catalog,{rows:[]});
  return {result,calls,core};
}
test('dados antigos completos não autorizam reserva numa pergunta informativa atual',async()=>{
  const {result,calls}=await run();
  assert.equal(calls,2);
  assert.equal(result.text.includes('[ACAO: CRIAR_AGENDAMENTO'),false);
  assert.match(result.audit.blocked_reason,/BOOKING_AUTHORIZATION_REJECTED/);
});
test('autorização positiva exige evidência atual e o mesmo escopo',async()=>{
  for(const options of [{authorized:true,evidence:['prior']},{authorized:true,badScope:true}]){
    const {result}=await run(options);
    assert.equal(result.text.includes('[ACAO: CRIAR_AGENDAMENTO'),false);
    assert.match(result.audit.blocked_reason,/BOOKING_AUTHORIZATION_REJECTED/);
  }
});
test('prova positiva atual habilita apenas a candidata de reserva, sem fingir execução',async()=>{
  const {result,calls}=await run({authorized:true});
  assert.equal(calls,2);
  assert.match(result.text,/\[ACAO: CRIAR_AGENDAMENTO/);
  assert.equal(result.audit.booking_authorization.status,'accepted');
});
test('falha do auditor impede entregar instrução de reserva',async()=>{
  await assert.rejects(run({authorized:true,auditFailure:true}));
});
test('texto livre não executa variantes do protocolo de reserva',async()=>{
  const {core}=await run({authorized:true});
  for(const directive of ['[ACAO: CRIAR_AGENDAMENTO|nome=Fixture]','[AÇÃO: AGENDAMENTO_CONFIRMADO|nome=Fixture]','[acao: criar_agendamento|nome=Fixture]']) {
    assert.throws(()=>core.groundingValidateResponse({action:'reply',reply:directive,state,message_keys:[],price_claims:[]},context,[],catalog,{rows:[]}),/UNAUTHORIZED_BOOKING_DIRECTIVE/);
  }
});

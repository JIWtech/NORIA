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
async function run({authorized=false,realNameValid=true,audienceEligible=true,evidence=['now'],badScope=false,auditFailure=false,
  customerName='Cliente Fixture',audience=null,action='create_appointment',reply='',turnText='Como funciona o Comfort?',
  schedulingEnabled=false,onCheckAvailability=null,availableStarts=['10:00'],onComposeReply=null,
  stateOverrides=null,historyOverride=null}={}) {
  let calls=0;
  let composeCalls=0;
  let capturedAuditorInput=null;
  let capturedComposeInput=null;
  const localState={...state,customer_name:customerName,...(stateOverrides||{})};
  const localContext={
    ...context,
    settings:{
      ...context.settings,
      settings:{
        ...context.settings.settings,
        ...(audience?{business_facts:{audience}}:{}),
        ...(schedulingEnabled?{appointment_scheduling:{enabled:true,units:{unit:{name:'Matriz',aliases:['matriz']}},service_resources:{comfort:{duration_minutes:60}}}}:{})
      }
    }
  };
  const hook=/try \{\r?\n\s*const turnResult = await runTurn\(\);/.exec(code);
  const core=await new AsyncFunction('$json','$env','$vars','$getWorkflowStaticData',code.replace(hook[0],
    `geminiTenantBudget={tenant_id:'tenant',daily_limit:100};turn={token:'token',boundary_id:'session',messages:[{event_id:'now',text:${JSON.stringify(turnText)},received_at:'2026-10-23T22:01:00-03:00'}]};return {callGroundedGemini,groundingValidateResponse,groundingMergeState,schedulingValidateAction,groundingDirectReply,enforceEmojiPolicy,groundingApprovedView,removeMidConversationGreeting,composeSchedulingOutcomeReply,normalizeText};\n`+hook[0])).call({helpers:{httpRequest:async options=>{
      if(options.url.endsWith('/rpc/magia_gemini_reserve'))return {allowed:true};
      if(options.url.endsWith('/rpc/magia_gemini_release'))return {};
      if(options.url.endsWith('/rpc/magia_appointment_availability')){
        if(onCheckAvailability)return onCheckAvailability(options);
        return {available_starts:availableStarts};
      }
      assert.ok(options.url.includes('generativelanguage.googleapis.com'));
      const sysParts=(options.body.system_instruction?.parts||[]).map(p=>p.text||'');
      const sysJoined=sysParts.join('\n');
      const parsedInput=JSON.parse(options.body.contents[0].parts[0].text);
      if(sysParts.some(t=>t.startsWith('COMPOSICAO_DE_AGENDA'))){
        composeCalls++;
        capturedComposeInput=parsedInput;
        if(onComposeReply)return body(await onComposeReply(parsedInput,composeCalls));
        return body({reply:`Oi! Tenho horários disponíveis: ${(parsedInput.scheduling_facts?.available_starts||[]).join(', ')}. Qual prefere?`,price_claims:[]});
      }
      calls++;
      if(calls===1)return body({action,reply,message_keys:[],price_claims:[],state:localState});
      if(auditFailure)throw new Error('auditor unavailable');
      if(sysJoined.includes('NORIA_SERVICE_PRICE_AUDIT')){
        return body({scope_key:parsedInput.scope_key,complete:true,segments:[{text:parsedInput.reply,kind:'non_factual',evidence:[]}]});
      }
      capturedAuditorInput=parsedInput;
      return body({scope_key:badScope?'another-turn':capturedAuditorInput.scope_key,authorized,
        real_name_valid:realNameValid,audience_eligible:audienceEligible,
        evidence_ids:evidence,service_id:localState.service_id,unit_id:'unit',date:localState.date,time:localState.time,customer_name:customerName});
    }}},{tenant_slug:'fixture',tenant_id:'tenant',text:turnText},
    {GEMINI_API_KEY:'fixture',GEMINI_ENABLED:'true',SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture'}, {},()=>({}));
  const history=historyOverride||[{id:'prior',direction:'inbound',message_text:`Meu nome é ${customerName}, quero Comfort para 02/11 às 10h.`,created_at:'2026-10-23T22:00:00-03:00'},
    {id:'now',direction:'inbound',message_text:turnText,created_at:'2026-10-23T22:01:00-03:00'}];
  const result=await core.callGroundedGemini(localContext,history,catalog,{rows:[]});
  return {result,calls,composeCalls,core,capturedAuditorInput,capturedComposeInput};
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
test('nome não real bloqueia criação de agendamento e limpa customer_name',async()=>{
  const {result,capturedAuditorInput}=await run({
    authorized:true,realNameValid:false,customerName:'Abacaxi Azul',
    audience:{exclusive_to:'female',invalid_name_message:'Informe seu nome e sobrenome reais.'}
  });
  assert.equal(capturedAuditorInput.proposed_booking.customer_name,'Abacaxi Azul');
  assert.equal(result.text,'Informe seu nome e sobrenome reais.');
  assert.equal(result.text.includes('[ACAO: CRIAR_AGENDAMENTO'),false);
  assert.equal(result.state.customer_name,'');
  assert.equal(result.audit.blocked_reason,'BOOKING_INVALID_REAL_NAME');
});
test('política exclusiva feminina bloqueia nome masculino não elegível e limpa customer_name',async()=>{
  const {result,capturedAuditorInput}=await run({
    authorized:true,realNameValid:true,audienceEligible:false,customerName:'João Victor Santos',
    audience:{exclusive_to:'female',allow_proxy_booking_for_female:true,ineligible_booking_message:'Atendimento exclusivo para o público feminino.'}
  });
  assert.equal(capturedAuditorInput.audience_policy.exclusive_to,'female');
  assert.equal(capturedAuditorInput.audience_policy.allow_proxy_booking_for_female,true);
  assert.equal(result.text,'Atendimento exclusivo para o público feminino.');
  assert.equal(result.text.includes('[ACAO: CRIAR_AGENDAMENTO'),false);
  assert.equal(result.state.customer_name,'');
  assert.equal(result.audit.blocked_reason,'BOOKING_AUDIENCE_INELIGIBLE');
});
test('política exclusiva feminina libera reserva quando auditor confirma elegibilidade (ex.: para uma mulher)',async()=>{
  const {result}=await run({
    authorized:true,realNameValid:true,audienceEligible:true,customerName:'Maria Silva',
    audience:{exclusive_to:'female',allow_proxy_booking_for_female:true}
  });
  assert.match(result.text,/\[ACAO: CRIAR_AGENDAMENTO/);
  assert.equal(result.audit.booking_authorization.status,'accepted');
});
test('schedulingValidateAction preserva esclarecimento de público/nome mesmo sob forcedAvailability',async()=>{
  let checked=false;
  const {result}=await run({
    action:'reply',
    reply:'Nossos atendimentos são exclusivos para mulheres. O horário seria para uma mulher?',
    turnText:'Quero agendar amanhã às 10h para João Victor Santos',
    customerName:'João Victor Santos',
    schedulingEnabled:true,
    audience:{exclusive_to:'female'},
    onCheckAvailability:()=>{checked=true;return {available_starts:['10:00']};}
  });
  assert.equal(checked,false);
  assert.equal(result.text,'Nossos atendimentos são exclusivos para mulheres. O horário seria para uma mulher?');
});
test('check_availability consulta agenda real e compõe resposta via Gemini sem frases fixas hardcoded',async()=>{
  let availabilityCalls=0;
  const divaReply='Oi, minha linda! Para Comfort no dia 02/11 eu tenho 14:00 e 16:30 disponíveis. Qual desses fica melhor pra você?';
  const {result,composeCalls,capturedComposeInput}=await run({
    action:'check_availability',
    reply:'Verificando horários...',
    turnText:'Quais horários têm para Comfort em 02/11?',
    schedulingEnabled:true,
    availableStarts:['14:00','16:30'],
    stateOverrides:{name_evidence:'prior',service_evidence:'now',date_evidence:'now',time:'',time_evidence:''},
    historyOverride:[
      {id:'prior',direction:'inbound',message_text:'Meu nome é Cliente Fixture',created_at:'2026-10-23T22:00:00-03:00'},
      {id:'now',direction:'inbound',message_text:'Quais horários têm para Comfort em 02/11?',created_at:'2026-10-23T22:01:00-03:00'}
    ],
    onCheckAvailability:()=>{availabilityCalls++;return {available_starts:['14:00','16:30']};},
    onComposeReply:()=>({reply:divaReply,price_claims:[]})
  });
  assert.equal(availabilityCalls,1);
  assert.equal(composeCalls,1);
  assert.equal(result.text,divaReply);
  assert.deepEqual(capturedComposeInput.scheduling_facts.available_starts,['14:00','16:30']);
  assert.equal(result.text.includes('posso oferecer'),false);
});
test('schedulingComposeReply rejeita horário inventado na tentativa 1 e corrige com validation_correction na tentativa 2',async()=>{
  const feedbackSeen=[];
  const {result,composeCalls}=await run({
    action:'check_availability',
    reply:'Verificando horários...',
    turnText:'Tem vaga para Comfort em 02/11?',
    schedulingEnabled:true,
    availableStarts:['14:00','16:30'],
    stateOverrides:{name_evidence:'prior',service_evidence:'now',date_evidence:'now',time:'',time_evidence:''},
    historyOverride:[
      {id:'prior',direction:'inbound',message_text:'Meu nome é Cliente Fixture',created_at:'2026-10-23T22:00:00-03:00'},
      {id:'now',direction:'inbound',message_text:'Tem vaga para Comfort em 02/11?',created_at:'2026-10-23T22:01:00-03:00'}
    ],
    onComposeReply:(input,attempt)=>{
      feedbackSeen.push(input.validation_correction||'');
      if(attempt===1)return {reply:'Oi! Temos às 18:00 disponíveis pra você.',price_claims:[]};
      return {reply:'Oi, lindeza! Para amanhã temos 14:00 e 16:30 disponíveis. Qual você quer?',price_claims:[]};
    }
  });
  assert.equal(composeCalls,2);
  assert.equal(feedbackSeen[0],'');
  assert.match(feedbackSeen[1],/18:00/);
  assert.equal(result.text,'Oi, lindeza! Para amanhã temos 14:00 e 16:30 disponíveis. Qual você quer?');
});
test('groundingMergeState descarta horário herdado quando cliente troca de service_id',async()=>{
  const {core}=await run();
  const merged=core.groundingMergeState(
    {customer_name:'Maria Silva',service_id:'classico',service_evidence:'m2',date:'2026-11-02',date_evidence:'m2',time:'',time_evidence:''},
    {customer_name:'Maria Silva',service_id:'comfort',service_evidence:'m1',date:'2026-11-02',date_evidence:'m1',time:'16:30',time_evidence:'m1'}
  );
  assert.equal(merged.service_id,'classico');
  assert.equal(merged.date,'2026-11-02');
  assert.equal(merged.time,'');
  assert.equal(merged.time_evidence,'');
});
test('bloqueio de público sem mensagem fixa compõe resposta dinâmica via Gemini e limpa customer_name',async()=>{
  const dynamicAudienceReply='Aqui na nossa clínica atendemos apenas mulheres, tá bom? Se o horário for para uma mulher, me diz o nome dela que eu agendo!';
  const {result,composeCalls,capturedComposeInput}=await run({
    authorized:true,
    realNameValid:true,
    audienceEligible:false,
    customerName:'João Victor Santos',
    audience:{exclusive_to:'female',allow_proxy_booking_for_female:true},
    onComposeReply:()=>({reply:dynamicAudienceReply,price_claims:[]})
  });
  assert.equal(composeCalls,1);
  assert.equal(capturedComposeInput.scheduling_facts.outcome,'booking_blocked_audience');
  assert.equal(result.text,dynamicAudienceReply);
  assert.equal(result.state.customer_name,'');
  assert.equal(result.audit.blocked_reason,'BOOKING_AUDIENCE_INELIGIBLE');
});
test('schedulingValidateAction preserva reply com preserveLiteral mesmo com estado de agenda e palavra hoje no histórico',async()=>{
  let checked=false;
  const {core}=await run({
    schedulingEnabled:true,
    onCheckAvailability:()=>{checked=true;return {available_starts:['10:00']};}
  });
  const localContext={
    ...context,
    settings:{...context.settings,settings:{...context.settings.settings,appointment_scheduling:{enabled:true,units:{unit:{name:'Matriz',aliases:['matriz']}},service_resources:{comfort:{duration_minutes:60}}}}}
  };
  const preserved=await core.schedulingValidateAction(
    localContext,
    {text:'Catálogo completo: Bronze Comfort, Premium e Clássico!',state:{...state,service_id:'comfort',date:'2026-11-02',time:''},preserveLiteral:true},
    'approved_reply',
    [{id:'now',direction:'inbound',message_text:'Quais são os serviços que tem pra hoje?',received_at:'2026-11-02T09:00:00-03:00'}],
    catalog,
    [{id:'now',text:'Quais são os serviços que tem pra hoje?',received_at:'2026-11-02T09:00:00-03:00'}]
  );
  assert.equal(checked,false);
  assert.equal(preserved.text,'Catálogo completo: Bronze Comfort, Premium e Clássico!');
});
test('action=handoff pode enviar bloco aprovado regras_agendamento mantendo handoff=true e auditando apenas a prosa',async()=>{
  const rulesBlock='✨ REGRAS DE AGENDAMENTO ✨\n\n🔸 Acréscimo após 17h: R$ 10,00.\n\n💳 PIX PARA AGENDAMENTO\nChave: 21966353026\nNome: Silvana Marques Ribeiro\nBanco: Infinitipay';
  let capturedAuditReply='';
  const localContext={
    ...context,
    settings:{
      ...context.settings,
      settings:{
        ...context.settings.settings,
        payment:{enabled:true,pix_key:'21966353026',pix_holder:'Silvana Marques Ribeiro',pix_institution:'Infinitipay',deposit_percentage:50},
        approved_messages:{enabled:true,revision:'nb-texts-v1',catalog_prices:{comfort:179.99},blocks:{regras_agendamento:{use:'Regras e Pix',text:rulesBlock,service_ids:[]}}}
      }
    }
  };
  const hook=/try \{\r?\n\s*const turnResult = await runTurn\(\);/.exec(code);
  const divaHandoff='Com certeza, linda! Vou chamar uma das meninas da equipe para concluir seu agendamento com todo carinho!';
  const core=await new AsyncFunction('$json','$env','$vars','$getWorkflowStaticData',code.replace(hook[0],
    `geminiTenantBudget={tenant_id:'tenant',daily_limit:100};turn={token:'token',boundary_id:'session',messages:[{event_id:'now',text:'Quero marcar Jato no Bojo',received_at:'2026-10-23T22:01:00-03:00'}]};return {callGroundedGemini};\n`+hook[0])).call({helpers:{httpRequest:async options=>{
      if(options.url.endsWith('/rpc/magia_gemini_reserve'))return {allowed:true};
      const sysParts=(options.body.system_instruction?.parts||[]).map(p=>p.text||'');
      const parsedInput=JSON.parse(options.body.contents[0].parts[0].text);
      if(sysParts.join('\n').includes('NORIA_SERVICE_PRICE_AUDIT')){
        capturedAuditReply=parsedInput.reply;
        return body({scope_key:parsedInput.scope_key,complete:true,segments:[{text:parsedInput.reply,kind:'non_factual',evidence:[]}]});
      }
      return body({action:'handoff',reply:divaHandoff,message_keys:['regras_agendamento'],price_claims:[],state:{...state,customer_name:'',name_evidence:'',service_id:'',service_evidence:'',date:'',date_evidence:'',time:'',time_evidence:''}});
    }}},{tenant_slug:'fixture',tenant_id:'tenant',text:'Quero marcar Jato no Bojo'},
    {GEMINI_API_KEY:'fixture',GEMINI_ENABLED:'true',SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture'},{},()=>({}));
  const res=await core.callGroundedGemini(localContext,[{id:'now',direction:'inbound',message_text:'Quero marcar Jato no Bojo',created_at:'2026-10-23T22:01:00-03:00'}],catalog,{rows:[]});
  assert.equal(capturedAuditReply,divaHandoff);
  assert.equal(res.handoff,true);
  assert.equal(res.literalSuffix,rulesBlock);
  assert.ok(res.text.includes(divaHandoff));
  assert.ok(res.text.includes('Silvana Marques Ribeiro'));
  assert.ok(res.text.includes('Infinitipay'));
  assert.match(res.text,/\[HUMANO_SOLICITADO\]$/);
});
test('menção a Pix ou Chave Pix não é interceptada por regex nem sobrescrita por resposta fixa',async()=>{
  const divaPixHandoff='Vou te passar para a nossa equipe fechar o horário e já te deixo nosso Pix: Chave 21966353026, Silvana Marques Ribeiro, Banco Infinitipay.';
  const {result}=await run({
    action:'handoff',
    reply:divaPixHandoff,
    turnText:'Qual a chave Pix para o agendamento?',
    historyOverride:[{id:'now',direction:'inbound',message_text:'Qual a chave Pix para o agendamento?',created_at:'2026-10-23T22:01:00-03:00'}],
    stateOverrides:{customer_name:'',name_evidence:'',service_id:'',service_evidence:'',date:'',date_evidence:'',time:'',time_evidence:''}
  });
  assert.equal(result.handoff,true);
  assert.equal(result.text,divaPixHandoff+' [HUMANO_SOLICITADO]');
  assert.equal(result.text.includes('Pode fazer pelo Pix:'),false);
});
test('action=payment e consulta de Pix não são interceptados por regex no directReply e compõem dinamicamente via Gemini',async()=>{
  const {core,result,composeCalls,capturedComposeInput}=await run({
    action:'payment',
    reply:'',
    turnText:'Qual o Pix pra pagar o sinal?',
    historyOverride:[{id:'now',direction:'inbound',message_text:'Qual o Pix pra pagar o sinal?',created_at:'2026-10-23T22:01:00-03:00'}],
    stateOverrides:{customer_name:'',name_evidence:'',service_id:'',service_evidence:'',date:'',date_evidence:'',time:'',time_evidence:''},
    onComposeReply:()=>({reply:'Vou chamar uma pessoa da nossa equipe para te passar os dados certinhos de pagamento 💖',price_claims:[]})
  });
  assert.equal(core.groundingDirectReply(context,'Qual a chave Pix pra pagar?',[]),null);
  assert.equal(composeCalls,1);
  assert.equal(capturedComposeInput.scheduling_facts.outcome,'payment_details_missing');
  assert.equal(result.handoff,true);
  assert.equal(result.text,'Vou chamar uma pessoa da nossa equipe para te passar os dados certinhos de pagamento 💖 [HUMANO_SOLICITADO]');
  assert.equal(result.text.includes('Pode fazer pelo Pix:'),false);
});
test('enforceEmojiPolicy preserva tom feminino com no máximo 1 emoji por mensagem e remove apenas em reclamação',async()=>{
  const {core}=await run();
  const prevHistory=[{direction:'outbound',message_text:'Olá, maravilhosa! ✨ Seja muito bem-vinda!'}];
  const nextReply=core.enforceEmojiPolicy('Claro, linda! 💖 Temos horários às 14:00 e 16:30 ✨ 🌸',prevHistory,{handoff:false,service:'agendamento'});
  assert.equal(nextReply,'Claro, linda! 💖 Temos horários às 14:00 e 16:30');
  const friendlyHandoff=core.enforceEmojiPolicy('Com certeza, meu bem! ✨ Vou chamar a equipe para finalizar com carinho 💖',prevHistory,{handoff:true,stage:'Atendimento humano',service:'atendimento_humano'});
  assert.equal(friendlyHandoff,'Com certeza, meu bem! ✨ Vou chamar a equipe para finalizar com carinho');
  const complaintHandoff=core.enforceEmojiPolicy('Sinto muito pelo ocorrido! 💖 Vou chamar a equipe agora mesmo ✨',prevHistory,{handoff:true,stage:'Atendimento humano',service:'reclamacao'});
  assert.equal(complaintHandoff,'Sinto muito pelo ocorrido! Vou chamar a equipe agora mesmo');
});
test('groundingApprovedView valida catálogo e explicações femininas da NB Bronze com regras_agendamento',async()=>{
  const sqlText=fs.readFileSync(require('node:path').join(__dirname,'../supabase/migrations_pending_review/nubia_diva_v10.sql'),'utf8');
  const m=/\$blocks_v10\$([\s\S]*?)\$blocks_v10\$::jsonb/.exec(sqlText);
  assert.ok(m,'blocks_v10 encontrado na migração v10');
  const blocks=JSON.parse(m[1]);
  const liveCatalog={isComplete:true,matches:[
    {external_id:'banho_lua_classico',name:'Banho de Lua Clássico',price:19.99,active:true},
    {external_id:'banho_lua_comfort',name:'Banho de Lua Comfort',price:69.99,active:true},
    {external_id:'banho_lua_premium',name:'Banho de Lua Premium',price:34.99,active:true},
    {external_id:'bronze_classico',name:'Bronze Clássico',price:99.99,active:true},
    {external_id:'bronze_comfort',name:'Bronze Comfort',price:179.99,active:true},
    {external_id:'bronze_jato_bojo',name:'Jato no Bojo',price:49.99,active:true},
    {external_id:'bronze_jato_corpo_todo',name:'Bronze a Jato',price:149.99,active:true},
    {external_id:'bronze_no_sol',name:'Bronze de Sol',price:99.99,active:true},
    {external_id:'bronze_premium',name:'Bronze Premium',price:149.99,active:true},
    {external_id:'detox_corporal_mousse_clareador',name:'Detox Corporal / Mousse Clareador',price:49.99,active:true},
    {external_id:'potencia_classico_ou_sol_jato',name:'Potência Bronze: Clássico ou Sol + Jato',price:179.99,active:true},
    {external_id:'potencia_comfort_jato',name:'Potência Bronze: Comfort + Jato',price:259.99,active:true},
    {external_id:'potencia_premium_jato',name:'Potência Bronze: Premium + Jato',price:229.99,active:true},
    {external_id:'tatuagem_solar_temporaria',name:'Tatuagem Solar Temporaria',price:5,active:true}
  ]};
  const hook=/try \{\r?\n\s*const turnResult = await runTurn\(\);/.exec(code);
  const viewRunner=await new AsyncFunction('$json','$env','$vars','$getWorkflowStaticData',code.replace(hook[0],
    `return {groundingApprovedView};\n`+hook[0])).call(
      {helpers:{httpRequest:async()=>({})}},
      {tenant_slug:'clinica_nubia_oficial',tenant_id:'tenant',noria_client_policy:{profile:'nb_bronze_v1',modules:{approved_service_texts:true}}},
      {GEMINI_API_KEY:'fixture',GEMINI_ENABLED:'true',SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture'},{},()=>({})
    );
  const catalogPrices=Object.fromEntries(liveCatalog.matches.map(r=>[r.external_id,r.price]));
  const cfgContext={...context,settings:{settings:{...context.settings.settings,approved_messages:{enabled:true,revision:'nb-texts-v1',catalog_prices:catalogPrices,blocks}}}};
  const view=viewRunner.groundingApprovedView(cfgContext,liveCatalog);
  assert.ok(view,'groundingApprovedView ativo para nb_bronze_v1');
  assert.deepEqual(view.invalid_service_ids,[]);
  assert.deepEqual(Object.keys(view.blocks).sort(),Object.keys(blocks).sort());
  assert.ok(view.blocks.catalogo.text.includes('Potência Bronze: Comfort + Jato — R$ 259,99'));
  assert.ok(view.blocks.regras_agendamento.text.includes('Silvana Marques Ribeiro'));
  assert.ok(view.blocks.regras_agendamento.text.includes('Infinitipay'));
});
test('removeMidConversationGreeting limpa saudações Diva no meio da conversa sem deixar vírgula órfã',async()=>{
  const {core}=await run();
  assert.equal(core.removeMidConversationGreeting('Oie, maravilhosa! ✨ Já conferi os horários pra você 💖',true),'Já conferi os horários pra você 💖');
  assert.equal(core.removeMidConversationGreeting('Oi, meu bem! 🌸 Claro, pode deixar!',true),'Claro, pode deixar!');
  assert.equal(core.removeMidConversationGreeting('Oie, maravilhosa! ✨ Como posso te ajudar hoje?',false),'Oie, maravilhosa! ✨ Como posso te ajudar hoje?');
});
test('domicílio em bairro não é interceptado como endereço e action=location compõe no tom da marca preservando endereço oficial',async()=>{
  const locContext={
    tenant:{id:'tenant',slug:'clinica_nubia_oficial'},
    settings:{settings:{grounding_mode:'canonical_v2',system_prompt:'Fixture Diva',prompt_revision:'fixture',ai_model:'gemini-3.5-flash-lite',
      business_facts:{locations:[{id:'angra',name:'Nova Angra',address:'Av. Itaguaí, 200 - Nova Angra, Angra dos Reis - RJ, 23933-115, Brasil',verified:true}]}}}
  };
  const hook=/try \{\r?\n\s*const turnResult = await runTurn\(\);/.exec(code);
  let composeCalls=0;
  const divaLocation='Ficamos aqui em Nova Angra: Av. Itaguaí, 200 - Nova Angra, Angra dos Reis - RJ, 23933-115, Brasil ✨ Vai ser um prazer te receber, maravilhosa! 💖';
  const core=await new AsyncFunction('$json','$env','$vars','$getWorkflowStaticData',code.replace(hook[0],
    `geminiTenantBudget={tenant_id:'tenant',daily_limit:100};turn={token:'token',boundary_id:'session',messages:[{event_id:'now',text:'Onde vocês ficam?',received_at:'2026-10-23T22:01:00-03:00'}]};return {callGroundedGemini,groundingDirectReply,composeSchedulingOutcomeReply};\n`+hook[0])).call({helpers:{httpRequest:async options=>{
      if(options.url.endsWith('/rpc/magia_gemini_reserve'))return {allowed:true};
      if(options.url.endsWith('/rpc/magia_gemini_release'))return {};
      const sysParts=(options.body.system_instruction?.parts||[]).map(p=>p.text||'');
      const parsedInput=JSON.parse(options.body.contents[0].parts[0].text);
      if(sysParts.join('\n').includes('NORIA_SERVICE_PRICE_AUDIT')){
        return body({scope_key:parsedInput.scope_key,complete:true,segments:[{text:parsedInput.reply,kind:'non_factual',evidence:[]}]});
      }
      if(sysParts.some(t=>t.startsWith('COMPOSICAO_DE_AGENDA'))){
        composeCalls++;
        if(parsedInput.scheduling_facts?.outcome==='official_location') return body({reply:divaLocation,price_claims:[]});
        return body({reply:'Seu pré-agendamento para Bronze Clássico ficou registrado aguardando o sinal 💖✨',price_claims:[]});
      }
      return body({action:'location',reply:'',message_keys:[],price_claims:[],state:{customer_name:'',name_evidence:'',service_id:'',service_evidence:'',date:'',date_evidence:'',time:'',time_evidence:'',unit_id:'',unit_evidence:''},contact_context:{kind:'customer',other_business:'',evidence_ids:['now'],quoted_or_forwarded:false,contains_customer_request:true},customer_disposition:{value:'active',evidence_ids:[]}});
    }}},{tenant_slug:'clinica_nubia_oficial',tenant_id:'tenant'},{GEMINI_API_KEY:'fixture',GEMINI_ENABLED:'true',SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture'},{},()=>({}));
  assert.equal(core.groundingDirectReply(locContext,'Vocês fazem a domicílio no bairro Frade?',[]),null);
  assert.notEqual(core.groundingDirectReply(locContext,'Qual o endereço de vocês?',[]),null);
  const res=await core.callGroundedGemini(locContext,[{id:'now',direction:'inbound',message_text:'Onde vocês ficam?',created_at:'2026-10-23T22:01:00-03:00'}],catalog,{rows:[]});
  assert.equal(composeCalls,1);
  assert.equal(res.text,divaLocation);
  const reserved=await core.composeSchedulingOutcomeReply(locContext,[],catalog,{},{outcome:'appointment_reserved'},'fallback',t=>/sinal|pendente/i.test(t));
  assert.match(reserved,/aguardando o sinal/);
});
test('system_prompt_diva_v11 e migração v11 permanecem abaixo de 10k chars e alinhados com política comercial e agenda',()=>{
  const path=require('node:path');
  const crypto=require('node:crypto');
  const promptV11=fs.readFileSync(path.join(__dirname,'../clients/clinica_nubia_oficial/prompts/system_prompt_diva_v11.txt'),'utf8');
  const sqlV11=fs.readFileSync(path.join(__dirname,'../supabase/migrations_pending_review/nubia_diva_v11.sql'),'utf8');
  assert.ok(promptV11.length<10000,'prompt v11 deve ter menos de 10 mil caracteres, atual='+promptV11.length);
  assert.match(promptV11,/NUNCA diga que é "atendente virtual"/);
  assert.match(promptV11,/CURTA e leve, em 1 ou 2 frases/);
  assert.match(promptV11,/Potência Bronze/);
  assert.match(promptV11,/Tatuagem Solar/);
  assert.match(promptV11,/sem repetir valores de 50% ou R\$ 10,00/);
  assert.ok(sqlV11.includes(promptV11),'nubia_diva_v11.sql deve conter exatamente system_prompt_diva_v11.txt');
  assert.equal(crypto.createHash('md5').update(promptV11).digest('hex').length,32);
});

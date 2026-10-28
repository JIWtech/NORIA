const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const sales=JSON.parse(fs.readFileSync(path.join(root,'clients/wesley_automoveis/sales.json')));
const inventory=JSON.parse(fs.readFileSync(path.join(root,'clients/wesley_automoveis/estoque_referencia.json'))).vehicles;
const stock='/*O_o*/\ngoogle.visualization.Query.setResponse('+JSON.stringify({status:'ok',table:{
  cols:['MODELO','MARCA','PRECO','COR','KM','ANO','COMBUSTIVEL'].map(label=>({label})),
  rows:inventory.map(v=>({c:[v.model,v.brand,v.price_cents/100,v.color,v.km,v.year,v.fuel].map(v=>({v}))}))}})+');';
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const code=fs.readFileSync(path.join(root,'n8n/code/whatsapp_conversation_core.generated.js'),'utf8');
const blank={intent:'unknown',customer_name:'',name_evidence:'',product_id:'',product_evidence:'',product_variant_evidence:'',deposit_cents:null,deposit_evidence:'',
  sell_brand:'',sell_model:'',sell_year:null,sell_brand_evidence:'',sell_model_evidence:'',sell_year_evidence:''};
const selected={...blank,intent:'buy',customer_name:'Maria Souza',name_evidence:'e1',product_id:'renault|sandero gt line|2016|branco',
  product_evidence:'e0',deposit_cents:1289400,deposit_evidence:'e2'};
async function run({texts=['Quero Sandero GT Line','Maria Souza','Entrada de R$ 12.894,00'],
  response={action:'register_interest',reason:'none',reply:'',state:selected},
  lead=null,history=[],stale=false,stockError=false,priceChanged=false,humanRace=false,disabled=false,
  collect=false,media=false,ocr=null,documents=[],sendError=false,exclusion=false,exclusionResult=false,followUp=false,financing=false,
  closeAt=null}={}) {
  const calls=[],sent=[],saved=[];let generated=0,reads=0,currentLead=lead,exclusionChecks=0;
  const settings={conversation_capability:'sales_v1',whatsapp_processing_mode:'conversation_core_v1',grounding_mode:'canonical_v2',
    system_prompt:'Sales test',ai_model:'gemini-3.5-flash-lite',ai_enabled:!disabled,gemini_daily_limit:80,whatsapp_audio_enabled:false,
    business_facts:{locations:[{verified:true,address:'Endereco oficial'}]},
    sdr_rules:{hot_lead_percent:30,minimum_purchase_year:1995,rejected_purchase_brands:['Peugeot','Citroen']},
    contact_exclusion_enabled:exclusion,follow_up_enabled:followUp,sales_follow_up:{enabled:followUp},
    sales:{...sales,collect_documents:collect,...(financing?{hot_lead_rule:'deposit_30_and_financing_documents_v1'}:{})}};
  const request=async({url,method,body})=>{
    calls.push({url,method,body});const u=new URL(url),table=u.pathname.split('/').at(-1);
    assert.ok(!/appointments|appointment_/.test(u.pathname),'Sales cannot access appointments');
    if(!followUp)assert.ok(!/followup/.test(u.pathname),'Sales follow-up must be opt-in');
    if(table==='magia_contact_exclusion_status'){
      exclusionChecks++;
      if(exclusionResult==='error')throw Error('RPC missing');
      return {blocked:exclusionResult==='race'?exclusionChecks>1:exclusionResult,reason:'contact_excluded'};
    }
    if(table==='magia_schedule_followups')return 3;
    if(u.hostname==='docs.google.com'){reads++;if(stockError)throw Error('PRIVATE_ERROR');return priceChanged&&reads>1?stock.replace('42980','42981'):stock;}
    if(u.hostname==='evo.test') {
      if(u.pathname.includes('getBase64'))return {mimetype:'image/jpeg',base64:Buffer.from('fake-jpeg').toString('base64')};
      if(sendError)throw Error('timeout');sent.push(body.text);return {key:{id:'out'}};
    }
    if(u.hostname==='generativelanguage.googleapis.com'){
      if(body.contents[0].parts[0].inlineData)return {candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(ocr||{kind:'document',name:'Maria',cpf:'',cnh:'12345678901',birth_date:''})}]}}]};
      generated++;return {candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(response)}]}}]};
    }
    if(table==='tenants')return [{id:'tenant-sales',slug:'sales',status:'active',name:'Sales'}];
    if(table==='tenant_settings')return [{settings}];
    if(table==='channels')return [{external_id:'sales-instance'}];
    if(table==='magia_claim_turn')return {claimed:true,token:'token',boundary_id:closeAt?'closed-boundary':'initial',messages:texts.map((text,i)=>({id:'m'+i,event_id:'e'+i,text,received_at:new Date().toISOString()}))};
    if(table==='magia_commit_turn')return {committed:!stale,reason:stale?'new_messages':undefined};
    if(table==='magia_finish_turn')return {};
    if(table==='magia_begin_turn_delivery')return {id:'delivery-attempt'};
    if(table==='magia_confirm_turn_delivery')return {confirmed:true};
    if(table==='sales_leads')return currentLead?[humanRace?{...currentLead,revision:99}:currentLead]:[];
    if(table==='sales_documents')return documents;
    if(table==='magia_sales_save'){
      if(humanRace)throw Error('SALES_CONTROL_CHANGED');
      const received=[...documents,...body.p_documents].map(d=>d.extracted);
      const complete=['cpf','cnh','birth_date'].every(k=>received.some(d=>!!d?.[k]));
      const hot=body.p_state.deposit_cents*100>=body.p_product?.price_cents*30 && (!financing || complete);
      let stage=body.p_register?(body.p_state.intent==='sell'?sales.stage_keys.appraisal:hot?sales.stage_keys.hot:sales.stage_keys.human):body.p_stage;
      if(financing&&hot&&body.p_state.intent==='buy'&&['sales_qualifying','sales_human'].includes(stage))stage=sales.stage_keys.hot;
      currentLead={id:'lead-1',revision:1,stage_key:stage,state:body.p_state,hot,ai_locked:!sales.stages[stage].allow_ai,interest_registered:body.p_register};
      saved.push(body);return currentLead;
    }
    if(table==='channel_events'){
      if(method!=='GET')return [{id:'event'}];
      if(u.searchParams.get('id'))return [{external_message_id:u.searchParams.get('id').slice(3).replace('e','m')}];
      if(u.searchParams.get('or')?.includes('conversation_closed'))return closeAt?[{id:'closed-boundary',created_at:closeAt}]:[];
      if(u.searchParams.get('or')?.includes('sender_type.eq.human'))return [];
      return [...history].reverse();
    }
    throw Error('Unexpected '+table);
  };
  const result=await new AsyncFunction('$json','$env','$vars','$getWorkflowStaticData',code).call({helpers:{httpRequest:request}},
    {tenant_slug:'sales',tenant_id:'tenant-sales',remoteJid:'5511999999999@s.whatsapp.net',instance:'sales-instance',
      noria_client_policy:{profile:'vehicle_sales_v1',capability:'sales_v1',contract:'noria_policy_v2',tenant_slug:'sales',tenant_id:'tenant-sales',audio_enabled:false,scheduling_enabled:false}},
    {SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'fake',GEMINI_ENABLED:'true',GEMINI_API_KEY:'fake',
      EVOLUTION_API_URL_SALES:'https://evo.test',EVOLUTION_API_KEY_SALES:'fake',EVOLUTION_INSTANCE_SALES:'sales-instance'}, {},()=>({}));
  return {result:result.json,calls,sent,saved,generated};
}

test('financing opt-in recognizes CNH as image, combines prior CPF/date, and hands hot lead to team',async()=>{
  const r=await run({financing:true,collect:true,texts:['[image]'],
    lead:{id:'lead',revision:2,state:selected,stage_key:'sales_qualifying',ai_locked:false},
    documents:[{extracted:{cpf:'52998224725',birth_date:'1990-01-02'}}],
    ocr:{kind:'document',name:'Maria',cpf:'',cnh:'12345678901',birth_date:''},
    response:{action:'reply',reason:'none',reply:'Pode mandar os documentos?',state:blank}});
  assert.equal(r.result.ok,true);assert.equal(r.result.handoff,true);
  assert.equal(r.saved[0].p_documents[0].extracted.cnh,'12345678901');
  assert.equal(r.saved[0].p_register,false,'qualification must not depend on register_interest');
  assert.match(r.sent[0],/encaminhar/);assert.doesNotMatch(r.sent[0],/12345678901|52998224725|1990/);
});
test('financing opt-in captures birth date text and does not treat vehicle photo as documentation',async()=>{
  const r=await run({financing:true,collect:true,texts:['Nasci em 02/01/1990'],
    lead:{id:'lead',revision:2,state:selected,stage_key:'sales_qualifying',ai_locked:false},
    documents:[{extracted:{cpf:'52998224725',cnh:'12345678901'}}],
    response:{action:'reply',reason:'none',reply:'Obrigado.',state:blank}});
  assert.equal(r.saved[0].p_documents[0].extracted.birth_date,'1990-01-02');
  assert.equal(r.result.handoff,true);
  const photo=await run({financing:true,collect:true,texts:['[image]'],
    lead:{id:'lead',revision:2,state:selected,stage_key:'sales_qualifying',ai_locked:false},
    ocr:{kind:'other',name:'',cpf:'',cnh:'',birth_date:''},
    response:{action:'reply',reason:'none',reply:'Pode enviar sua CNH?',state:blank}});
  assert.equal(photo.saved[0].p_documents.length,0);assert.equal(photo.result.handoff,false);
});
test('financing zero entry overwrites previous entry; missing birth date prevents registration',async()=>{
  const r=await run({financing:true,texts:['Nao tenho entrada'],
    lead:{id:'lead',revision:2,state:selected,stage_key:'sales_qualifying',ai_locked:false},
    response:{action:'reply',reason:'none',reply:'Entendi.',state:blank}});
  assert.equal(r.saved[0].p_state.deposit_cents,0);assert.equal(r.result.handoff,false);
  const missing=await run({financing:true,collect:true,lead:{id:'lead',revision:2,state:selected,ai_locked:false},
    documents:[{extracted:{cpf:'52998224725',cnh:'12345678901'}}]});
  assert.equal(missing.saved[0].p_register,false);assert.match(missing.sent[0],/nascimento/);
});
test('financing opt-in preserves excluded contacts, human silence and stale generation guards',async()=>{
  for(const flags of [{exclusion:true,exclusionResult:true},{lead:{id:'lead',ai_locked:true,stage_key:'sales_human'}}]) {
    const r=await run({financing:true,...flags,texts:['[image]']});
    assert.equal(r.sent.length,0);assert.equal(r.generated,0);assert.equal(r.saved.length,0);
    assert.ok(!r.calls.some(c=>c.url.includes('getBase64')));
  }
  const stale=await run({financing:true,stale:true});assert.equal(stale.saved.length,0);assert.equal(stale.sent.length,0);
});
test('financing incomplete entry remains qualifying; changed inventory cannot create a hot lead',async()=>{
  const documents=[{extracted:{cpf:'52998224725',cnh:'12345678901',birth_date:'1990-01-02'}}];
  const low=await run({financing:true,collect:true,documents,lead:{id:'lead',revision:2,ai_locked:false},
    texts:['Quero Sandero GT Line','Maria Souza','Entrada de R$ 1.000,00'],
    response:{action:'register_interest',reason:'none',reply:'',state:{...selected,deposit_cents:100000}}});
  assert.equal(low.saved[0].p_register,false);assert.equal(low.result.handoff,false);
  assert.equal(low.saved[0].p_state.deposit_cents,100000);assert.match(low.sent[0],/30%/);
  for(const flags of [{priceChanged:true},{stockError:true}]) {
    const r=await run({financing:true,collect:true,documents,lead:{id:'lead',revision:2,state:selected,ai_locked:false},...flags});
    assert.equal(r.saved[0].p_product,null);assert.equal(r.saved[0].p_register,false);assert.equal(r.result.handoff,true);
    assert.doesNotMatch(r.sent[0],/Recebi os dados/);
  }
});
test('sales registers an interest with exact 30% score, no appointments',async()=>{
  const r=await run();assert.equal(r.result.ok,true);assert.equal(r.saved.length,1);assert.equal(r.saved[0].p_register,true);
  assert.equal(r.result.handoff,true);assert.match(r.sent[0],/interesse foi registrado/);
});
test('selected vehicle and entry retain evidence across separate messages',async()=>{
  const r=await run({response:{action:'reply',reason:'none',reply:'Qual e o seu nome?',state:{...selected,customer_name:'',name_evidence:''}}});
  assert.equal(r.generated,1);assert.equal(r.saved[0].p_register,false);assert.match(r.sent[0],/nome/);
});
test('vehicle model shorthand and split variant evidence do not cause a handoff',async()=>{
  const r=await run({texts:['Quero PCX','A de 2018'],response:{action:'reply',reason:'none',reply:'Qual e seu nome?',
    state:{...blank,intent:'buy',product_id:'honda|pcx|2018|prata',product_evidence:'e0',product_variant_evidence:'e1'}}});
  assert.equal(r.result.handoff,false);assert.equal(r.saved[0].p_product.year,2018);
  const short=await run({texts:['Quero Sandero','Maria Souza','Entrada de R$ 12.894,00']});
  assert.equal(short.saved[0].p_register,true);
});
test('verified price at the end of a sentence is not treated as an invented value',async()=>{
  const r=await run({response:{action:'reply',reason:'none',reply:'O Sandero esta listado por R$ 42.980,00.',state:blank}});
  assert.equal(r.result.handoff,false);assert.match(r.sent[0],/42.980,00/);
});
test('Genesis greeting completes the generated CORE without an unavailable dialogue guard variable',async()=>{
  assert.doesNotMatch(code,/\bdialogueNeedsReview\b/);
  const r=await run({texts:['Oi'],response:{action:'reply',reason:'none',reply:'Ol\u00e1! Como posso ajudar?',state:blank}});
  assert.equal(r.result.ok,true,JSON.stringify(r.result));
  assert.equal(r.sent.length,1,JSON.stringify(r.result));
  assert.doesNotMatch(String(r.result.error||''),/dialogueNeedsReview/);
});
test('a new Genesis message after operator closure is processed and delivered',async()=>{
  const r=await run({closeAt:new Date(Date.now()-3000).toISOString(),texts:['Oi'],
    response:{action:'reply',reason:'none',reply:'Ol\u00e1! Como posso ajudar?',state:blank}});
  assert.equal(r.result.ok,true,JSON.stringify(r.result));
  assert.equal(r.sent.length,1,JSON.stringify(r.result));
  assert.equal(r.result.delivery_ok,true,JSON.stringify(r.result));
});
test('new messages or human transition discard all commercial side effects',async()=>{
  for(const flags of [{stale:true},{humanRace:true}]) {const r=await run(flags);assert.equal(r.sent.length,0);assert.equal(r.saved.length,0);}
});
test('locked or disabled sales does not generate, download stock or respond to reset',async()=>{
  for(const flags of [{lead:{id:'l',ai_locked:true,stage_key:'sales_human'}},{disabled:true}]){
    const r=await run({...flags,texts:['/reset']});assert.equal(r.sent.length,0);assert.equal(r.generated,0);
    assert.ok(!r.calls.some(c=>c.url.includes('docs.google.com')));
  }
});
test('after-sales is persisted and silent',async()=>{
  const r=await run({texts:['O carro que comprei quebrou'],response:{action:'handoff',reason:'after_sales',reply:'',state:{...blank,intent:'after_sales'}}});
  assert.equal(r.sent.length,0);assert.equal(r.saved[0].p_stage,'sales_after_sales');assert.equal(r.result.handoff,true);
});
test('stock failure, invalid prices and unsupported booking actions fail to human',async()=>{
  const variants=[{stockError:true},{response:{action:'create_appointment',reason:'none',reply:'',state:blank}},
    {response:{action:'reply',reason:'none',reply:'Custa R$ 1,00',state:blank}}];
  for(const flags of variants){const r=await run(flags);assert.equal(r.saved[0].p_register,false);assert.equal(r.result.handoff,true);}
});
test('price changed during registration does not confirm an interest at stale price',async()=>{
  const r=await run({priceChanged:true});assert.equal(r.saved[0].p_register,false);assert.doesNotMatch(r.sent[0],/foi registrado/);
});
test('CPF/CNH required by tenant do not disappear behind a register action',async()=>{
  const r=await run({collect:true});assert.equal(r.saved[0].p_register,false);assert.match(r.sent[0],/CNH/);
});
test('document extraction is saved privately, not in commercial model context',async()=>{
  const r=await run({texts:['[document]'],response:{action:'reply',reason:'none',reply:'Qual veiculo te interessa?',state:blank}});
  assert.equal(r.saved[0].p_documents[0].extracted.cnh,'12345678901');
  const commercial=r.calls.find(c=>c.url.includes('generateContent')&&!c.body.contents[0].parts[0].inlineData);
  assert.ok(!JSON.stringify(commercial.body).includes('12345678901'));
  assert.ok(!JSON.stringify(r.calls.filter(c=>c.url.includes('/channel_events')&&c.method!=='GET')).includes('12345678901'));
});
test('captions do not bypass document extraction and prior photos remain available for appraisal',async()=>{
  const image=await run({texts:['[document]\nMinha CNH'],response:{action:'reply',reason:'none',reply:'Qual veiculo te interessa?',state:blank}});
  assert.equal(image.saved[0].p_documents.length,1);
  const state={...blank,intent:'sell',customer_name:'Maria Souza',name_evidence:'e3',sell_brand:'Fiat',sell_brand_evidence:'e0',
    sell_model:'Uno',sell_model_evidence:'e1',sell_year:2010,sell_year_evidence:'e2'};
  const photo=await run({texts:['Fiat','Uno','2010','Maria Souza'],
    history:[{id:'old',direction:'inbound',message_text:'[image]',created_at:new Date().toISOString(),
      raw_payload:{sales_media:[{event_id:'old',kind:'vehicle_photo',readable:false}]}}],
    response:{action:'register_interest',reason:'none',reply:'',state}});
  // Published semantic flow requires three photos plus a description, not just one photo.
  assert.equal(photo.saved[0].p_register,false);assert.equal(photo.result.handoff,false);
  assert.match(photo.sent[0],/fotos/);
});
test('unreadable documents never invent identity fields',async()=>{
  const r=await run({texts:['[document]'],ocr:{kind:'document',name:'',cpf:'',cnh:'',birth_date:''}});
  assert.equal(r.generated,0);assert.equal(r.result.handoff,true);assert.equal(r.saved[0].p_documents.length,0);
});

test('ambiguous PCX requests a variant without selecting an arbitrary vehicle',async()=>{
  const r=await run({texts:['Quero PCX'],response:{action:'reply',reason:'none',reply:'Qual ano?',
    state:{...blank,product_id:'honda|pcx|2023|branca',product_evidence:'e0'}}});
  assert.equal(r.saved[0].p_register,false);assert.equal(r.saved[0].p_product,null);
  assert.equal(r.result.handoff,false);
});

test('excluded contacts and unavailable guard never reach sales model, media or inventory',async()=>{
  for(const exclusionResult of [true,'error'])for(const text of ['Oi','/reset','[audio]','[document]']){
    const r=await run({texts:[text],exclusion:true,exclusionResult});
    assert.equal(r.sent.length,0);assert.equal(r.generated,0);assert.equal(r.saved.length,0);
    assert.equal(r.result.reason,exclusionResult==='error'?'contact_exclusion_unavailable':'contact_excluded');
    assert.ok(!r.calls.some(c=>/docs.google.com|getBase64/.test(c.url)));
  }
});
test('non-excluded contact can respond; a late exclusion blocks the actual send',async()=>{
  const allowed=await run({exclusion:true});assert.equal(allowed.sent.length,1);
  const blocked=await run({exclusion:true,exclusionResult:'race'});assert.equal(blocked.sent.length,0);
  assert.equal(blocked.result.cancelled,true);
});
test('only opted-in ongoing sales qualification schedules follow-ups, never interest/handoff',async()=>{
  const response={action:'reply',reason:'none',reply:'Qual e o seu nome?',state:{...selected,customer_name:'',name_evidence:''}};
  const pending=await run({followUp:true,response});assert.equal(pending.result.follow_ups_scheduled,3);
  const registered=await run({followUp:true});assert.ok(!registered.calls.some(c=>c.url.includes('magia_schedule_followups')));
});
test('split seller details are accepted and excluded brands are not registered',async()=>{
  const state={...blank,intent:'sell',sell_brand:'Peugeot',sell_brand_evidence:'e0',sell_model:'208',sell_model_evidence:'e1',sell_year:2020,sell_year_evidence:'e2'};
  const r=await run({texts:['Peugeot','208','2020'],response:{action:'register_interest',reason:'none',reply:'',state}});
  assert.equal(r.saved[0].p_register,false);assert.match(r.sent[0],/nao se enquadra/);
});
test('inventory typed numbers are preserved, duplicate identities fail closed',()=>{
  const context=vm.createContext({tenantSlug:'sales',tenantBusinessRules:{modules:{}},normalizeText:v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase()});
  vm.runInContext(fs.readFileSync(path.join(root,'n8n/code/whatsapp_sales.js'),'utf8'),context);
  const rows=context.salesParseInventory(stock);assert.equal(rows.length,6);assert.equal(rows[4].price_cents,4298000);
  assert.equal(context.salesAmount('Entrada de R$ 12.894,00'),1289400);
  assert.equal(context.salesAmount('Tenho 15 mil'),1500000);
  assert.equal(context.salesAmount('Nao tenho 15 mil'),null);
  assert.equal(context.salesAmount('entrada 30%'),null);
  const data=JSON.parse(stock.slice(stock.indexOf('(')+1,-2));
  data.table.rows.push(data.table.rows[0]);
  assert.throws(()=>context.salesParseInventory('google.visualization.Query.setResponse('+JSON.stringify(data)+');'),/AMBIGUOUS_INVENTORY_ID/);
});
test('pending onboarded channel cannot enter legacy fallback; existing legacy tenant still can',async()=>{
  const selector=new AsyncFunction('$json','$env',fs.readFileSync(path.join(root,'n8n/code/whatsapp_select_core.js'),'utf8'));
  const input={tenant_slug:'legacy',instance:'new-instance',tenant_resolution:{source:'env_fallback'}};
  const env={SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'fake'};
  const helpers={httpRequest:async({url})=>url.includes('/channels?')?[{status:'pending',config:{onboarding_package:'wesley'}}]:[]};
  await assert.rejects(selector.call({helpers},input,env),/do not use fallback/);
  // The selector reads tenant and routing settings in one request (tenant_settings embedded, routing fields only).
  helpers.httpRequest=async({url})=>url.includes('/channels?')?[]:[{id:'legacy',status:'active',tenant_settings:[{}]}];
  const legacy=await selector.call({helpers},input,env);assert.equal(legacy.json.use_conversation_core,false);
  helpers.httpRequest=async()=>[{id:'sales',status:'active',tenant_settings:[{exclusion:true}]}];
  await assert.rejects(selector.call({helpers},{...input,tenant_resolution:{source:'channels.external_id'}},env),/legacy fallback blocked/);
  helpers.httpRequest=async()=>[{id:'sales',status:'active',tenant_settings:[{capability:'sales_v1',mode:'conversation_core_v1'}]}];
  const commercial=await selector.call({helpers},{...input,tenant_slug:'sales',tenant_resolution:{source:'channels.external_id'}},env);
  assert.equal(commercial.json.core_sales,true);
});

test('queue preserves transport-provided phone for LID without using contact name as identity',async()=>{
  const enqueue=new AsyncFunction('$json','$env',fs.readFileSync(path.join(root,'n8n/code/whatsapp_enqueue_core.js'),'utf8'));
  let queued;
  await enqueue.call({helpers:{httpRequest:async r=>{queued=r.body;return {};}}},
    {core_sales:true,core_quiet_ms:8000,core_fragment_ms:12000,messageText:'Oi',remoteJid:'123456789012345@lid',
      contactName:'5521999998888',raw_payload:{data:{key:{remoteJid:'123456789012345@lid',remoteJidAlt:'5521988887777@s.whatsapp.net'}}}},
    {SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'fake'});
  assert.equal(queued.p_message.raw.exclusion_phone,'5521988887777@s.whatsapp.net');
});
test('media queue markers change only for sales capability',async()=>{
  const enqueue=new AsyncFunction('$json','$env',fs.readFileSync(path.join(root,'n8n/code/whatsapp_enqueue_core.js'),'utf8'));
  for(const sales of [false,true]) {
    let queued;
    await enqueue.call({helpers:{httpRequest:async request=>{queued=request.body;return {};}}},
      {core_sales:sales,core_quiet_ms:8000,core_fragment_ms:12000,messageText:'Minha CNH',
        raw_payload:{data:{message:{imageMessage:{}}}}},
      {SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'fake'});
    assert.equal(queued.p_message.text,sales?'[image]\nMinha CNH':'Minha CNH');
  }
});

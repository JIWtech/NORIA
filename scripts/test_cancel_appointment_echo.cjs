const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const capture=new AsyncFunction('$json','$env','setTimeout',fs.readFileSync('n8n/code/whatsapp_capture_manual_reply.js','utf8'));
async function run(metadata,text='Aviso gerado') {const events=[];let reads=0;const result=await capture.call({helpers:{httpRequest:async({method,url,body})=>{const u=new URL(url),t=u.pathname.split('/').at(-1);if(t==='tenants')return[{id:'tenant'}];if(t==='channel_events'&&method==='GET')return [];if(t==='appointments'){assert.equal(u.searchParams.get('tenant_id'),'eq.tenant');reads++;return[{status:'cancelled',metadata}]};if(t==='contacts'||t==='follow_up_jobs')return [];if(t==='channel_events'){events.push(body);return[{id:'e'}]};if(t==='magia_merge_channel_event_raw')return{applied:true};throw Error(url)}}},{tenant_slug:'salon',instance:'salon',remoteJid:'5511999990000@s.whatsapp.net',messageId:'msg',messageText:text},{SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'fake'},f=>f());return {result,events,reads}}
test('eco do aviso é ignorado antes e depois do identificador',async()=>{for(const metadata of [{cancellation_notice_state:'sending',cancellation_notice_echo_text:'Aviso gerado'},{cancellation_notice_state:'uncertain',cancellation_notice_echo_text:'Aviso gerado'},{cancellation_notice_state:'sent',cancellation_notice_message_id:'msg'}]){const r=await run(metadata);assert.equal(r.events.length,0);assert.equal(r.result.json.queued.duplicate,true)}});
test('mensagem manual diferente continua sendo registrada',async()=>{const r=await run({cancellation_notice_state:'sending',cancellation_notice_echo_text:'Aviso gerado'},'Mensagem manual');assert.equal(r.events[0].service,'manual_reply')});
test('convite de remarcação não vira resposta manual antes nem depois do ID', async () => {
  for (const reschedule_invite of [
    { state: 'sending', text: 'Convite editado' },
    { state: 'sent', message_id: 'msg' },
  ]) {
    const result = await run({ reschedule_invite }, 'Convite editado');
    assert.equal(result.events.length, 0);
    assert.equal(result.result.json.queued.duplicate, true);
  }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const code = fs.readFileSync(require('node:path').join(__dirname,'../n8n/code/whatsapp_conversation_core.generated.js'),'utf8');
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const token='123456789:fixture-private-telegram-token';
async function engine(mode) {
  let calls=0;
  const hook=/try \{\r?\n\s*const turnResult = await runTurn\(\);/.exec(code);
  const core=await new AsyncFunction('$json','$env','$vars','$getWorkflowStaticData',code.replace(hook[0],
    'return {downloadTelegramMedia};\n'+hook[0])).call({helpers:{httpRequest:async()=>{
      calls++;
      if(mode==='lookup')throw new Error('GET https://api.telegram.org/bot'+token+'/getFile?file_id=customer-private-id failed');
      if(mode==='description')return {ok:false,description:'Bearer '+token+' customer-private-data'};
      if(calls===1)return {ok:true,result:{file_path:'documents/file.pdf'}};
      throw new Error('GET https://api.telegram.org/file/bot'+token+'/documents/file.pdf failed');
    }}},{tenant_slug:'fixture',channel_type:'telegram'}, {TELEGRAM_BOT_TOKEN_FIXTURE:token},{},()=>({}));
  return core;
}
for(const [mode,expected] of [['lookup','telegram_get_file_failed'],['download','telegram_media_download_failed'],['description','telegram_file_path_missing']]) {
  test('erro Telegram '+mode+' não expõe token, URL nem conteúdo externo',async()=>{
    const core=await engine(mode);
    await assert.rejects(core.downloadTelegramMedia({}, {fileId:'fixture',category:'document'}),error=>{
      assert.equal(error.code,expected);
      assert.equal(error.message.includes(token),false);
      assert.equal(/customer-private|https?:\/\/|Bearer/.test(error.message),false);
      return true;
    });
  });
}

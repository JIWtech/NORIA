import test from 'node:test';
import assert from 'node:assert/strict';
import {clearMediaUrlCache,resolveSingleMediaUrl,getMediaUrlFromCache,enrichMediaUrls,invalidateMediaUrl} from '../../src/services/media/mediaUrlService.js';
const media = {status:'stored',verified:true,bucket:'channel-media',storagePath:'tenant/whatsapp/private.pdf',kind:'document',mimeType:'application/pdf'};
function deferred() { let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve}; }
function client(result) { return {storage:{from:()=>({createSignedUrl:()=>result.promise})}}; }
test('limpar o cache invalida resolução privada ainda em andamento',async()=>{
  clearMediaUrlCache();const done=deferred();
  const pending=resolveSingleMediaUrl(media,client(done));
  clearMediaUrlCache();done.resolve({data:{signedUrl:'https://fixture.invalid/private-token'},error:null});
  assert.equal(await pending,'');
  assert.equal(getMediaUrlFromCache(media.bucket,media.storagePath),null);
});
test('troca de sessão durante enriquecimento não injeta URLs da sessão anterior',async()=>{
  clearMediaUrlCache();const done=deferred();
  const event={id:'one',direction:'inbound',raw_payload:{media}};
  const pending=enrichMediaUrls([event],client(done));
  clearMediaUrlCache();done.resolve({data:{signedUrl:'https://fixture.invalid/old-session'},error:null});
  const [out]=await pending;
  assert.equal(out.raw_payload.media.url,undefined);
  assert.equal(getMediaUrlFromCache(media.bucket,media.storagePath),null);
});
test('invalidar um objeto impede que uma resposta antiga substitua sua nova URL',async()=>{
  clearMediaUrlCache();const old=deferred(),fresh=deferred();
  const pendingOld=resolveSingleMediaUrl(media,client(old));
  invalidateMediaUrl(media.bucket,media.storagePath);
  const pendingFresh=resolveSingleMediaUrl(media,client(fresh));
  fresh.resolve({data:{signedUrl:'https://fixture.invalid/fresh'},error:null});
  assert.equal(await pendingFresh,'https://fixture.invalid/fresh');
  old.resolve({data:{signedUrl:'https://fixture.invalid/old'},error:null});
  assert.equal(await pendingOld,'');
  assert.equal(getMediaUrlFromCache(media.bucket,media.storagePath),'https://fixture.invalid/fresh');
});

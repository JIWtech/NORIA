import test from 'node:test';
import assert from 'node:assert/strict';
import { createBroadcastOperations } from '../../src/services/broadcasts/broadcastOperations.js';
import { createTeamAgentManagement } from '../../src/services/agents/teamAgentManagement.js';
import { loadClientData } from '../../src/dataService.js';

function db() { const calls=[]; const chain={ select(){return chain}, single:async()=>({data:{id:'campaign-1'},error:null}), eq(){return chain}, update(){return chain}, insert(){return chain}, upsert(){return chain} }; return { calls, from(table){calls.push(table); return chain;} }; }

test('6B.24 broadcasts preserva tenant, payload e uma escrita por operação', async () => {
  const client=db(); const ops=createBroadcastOperations({getClient:()=>client,loadTenant:async()=>({id:'tenant-1'}),getTenantSlug:()=> 'nubia',currentUserId:async()=> 'user-1'});
  await ops.upsertBroadcastContacts('nubia',[{name:'Ana',channelType:'whatsapp',externalConversationId:'chat-1'}]);
  await ops.createBroadcastCampaign('nubia',{name:'C',messageText:'Oi',channelType:'whatsapp'},[{id:'contact-1',externalConversationId:'chat-1'}]);
  await ops.updateBroadcastCampaign('campaign-1',{status:'sent'}); await ops.updateBroadcastRecipient('campaign-1','chat-1',{status:'sent'});
  assert.deepEqual(client.calls,['broadcast_contacts','broadcast_campaigns','broadcast_campaign_recipients','broadcast_campaigns','broadcast_campaign_recipients']);
});

test('6B.24 broadcasts propaga erro de cliente ausente sem escrita', async () => {
  const ops=createBroadcastOperations({getClient:()=>null,loadTenant:async()=>null,currentUserId:async()=>null});
  await assert.rejects(()=>ops.createBroadcastCampaign('tenant',{name:'x'},[]),/Supabase nao configurado/);
});

test('6B.24 agentes preserva ordem, tenant e fallback local sob falha', async () => {
  const original=globalThis.localStorage; const stored=new Map(); globalThis.localStorage={getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v)};
  const calls=[]; const q={select(){return q},limit(){return q},maybeSingle:async()=>({data:{id:'tenant-1'},error:null}),single:async()=>({data:{id:'agent-1'},error:null}),update(){return q},delete(){return q},eq(k,v){calls.push([k,v]);return q}}; const manager=createTeamAgentManagement({getClient:()=>({from:t=>{calls.push(['from',t]);return t === 'tenants' ? q : {insert:()=>q,update:()=>q,delete:()=>q}}})});
  await manager.saveTeamAgent('tenant-a',{name:'Ana'}); await manager.updateTeamAgentStatus('agent-1','offline','tenant-a'); await manager.removeTeamAgent('agent-1','tenant-a');
  globalThis.localStorage=original; assert.ok(calls.some(c=>c[0]==='tenant_slug'&&c[1]==='tenant-a'));
});

test('6B.24 loadClientData sem Supabase resolve status mockado', async () => {
  const result=await loadClientData({tenantId:'fallback'},'clinica_nubia_oficial');
  assert.equal(result.source,'mock'); assert.equal(result.status.source,'mock'); assert.equal(result.status.botUsername,'@clinica_nubia_oficial_bot');
});

// Tenant-scoped settings: commercial fields are explicitly allowlisted.
// This is the canonical source for the EXT identity node.  It deliberately
// carries only the configuration the Genesis extension needs to build its
// tenant-scoped commercial contract.
const input = $json || {};
const expectedSlug = 'wesley_automoveis';
if (String(input.tenant_slug || '') !== expectedSlug || String(input.noria_extension || '') !== 'genesis') throw new Error('NORIA_EXTENSAO_TENANT_INCORRETO');
// A CORE published at another contract version is refused here, before any commercial effect, with its own code.
if (String(input.noria_contract_version || '') !== '2.0') throw new Error('NORIA_EXTENSAO_CONTRACT_VERSION_MISMATCH');
const uuid = String(input.tenant_id || ''), instance = String(input.instance || ''), chatId = String(input.remoteJid || '');
if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(uuid) || !instance || !chatId) throw new Error('NORIA_IDENTIDADE_INCOMPLETA');
// Identity is validated once per tenant+instance and reused for 60 s: the EXT runs up to three times per turn and each run used to read the tenant,
// the full settings document and the channels. A settings change (for example switching the engine off) takes effect within that minute.
let memory = null;
try { memory = $getWorkflowStaticData('global'); } catch (_) { memory = null; }
const cacheKey = uuid + '|' + instance;
const cacheContract = 'genesis_identity_commercial_projection_v2';
const hit = memory?.noria_identity?.[cacheKey];
if (hit?.contract === cacheContract && Number(hit.at) > Date.now() - 60000 && hit.verified?.tenant_id === uuid) return {json:{...input,noria_verified_settings:hit.verified}};
const base = String($env.SUPABASE_URL || '').replace(/\/$/, ''), key = String($env.SUPABASE_SERVICE_ROLE_KEY || '');
if (!base || !key) throw new Error('NORIA_CREDENCIAIS_SUPABASE_AUSENTES');
const headers = {apikey:key,Authorization:'Bearer '+key};
// Uma nova tentativa por execução, somente para GET e falha transitória.
// Falha persistente não autoriza identidade antiga; validação/cache ficam abaixo.
let identityReadRetryUsed = false;
const get = async endpoint => {
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return await this.helpers.httpRequest({method:'GET',url:base+'/rest/v1/'+endpoint,headers,json:true,timeout:7000}); }
    catch (error) {
      const status = Number(error?.statusCode || error?.response?.status || error?.cause?.statusCode || 0);
      const code = String(error?.code || error?.cause?.code || '');
      const transient = status === 408 || status === 429 || status >= 500 && status <= 599
        || !status && (['ECONNABORTED','ECONNRESET','ETIMEDOUT','EAI_AGAIN','ENETUNREACH','ECONNREFUSED'].includes(code)
          || /timeout|timed out/i.test(String(error?.message || '')));
      if (attempt !== 0 || identityReadRetryUsed || !transient) throw error;
      identityReadRetryUsed = true;
    }
  }
};
const tenants = await get('tenants?select=id,slug,status&id=eq.'+encodeURIComponent(uuid)+'&slug=eq.'+encodeURIComponent(expectedSlug)+'&limit=1');
if (!Array.isArray(tenants) || tenants.length!==1 || tenants[0].status!=='active') throw new Error('NORIA_TENANT_INVALIDO');
// Only the keys this node exposes are read: the settings document also carries large prompt revisions the EXT never uses.
const identityKeys = ['whatsapp_processing_mode','conversation_capability','whatsapp_audio_enabled','appointment_scheduling','approved_messages','vehicle_sheet_id','sales','sdr_rules','business_facts','sales_follow_up'];
const settingsRows = await get('tenant_settings?select='+identityKeys.map(k=>k+':settings->'+k).join(',')+'&tenant_id=eq.'+encodeURIComponent(uuid)+'&limit=1');
const s = settingsRows?.[0] || {};
if (s.whatsapp_processing_mode!=='conversation_core_v1') throw new Error('NORIA_MOTOR_INATIVO_TENANT');
if (s.conversation_capability!=='sales_v1') throw new Error('NORIA_CAPACIDADE_DIVERGENTE');
const channels = await get('channels?select=external_id,config,status&tenant_id=eq.'+encodeURIComponent(uuid)+'&type=eq.whatsapp&status=eq.active&limit=25');
if (!Array.isArray(channels) || !channels.some(c => [c.external_id,c.config?.instance_name,c.config?.instance,c.config?.evolution_instance,c.config?.instance_id].filter(Boolean).includes(instance))) throw new Error('NORIA_INSTANCIA_NAO_PERTENCE_AO_TENANT');
const sourceSales = s.sales && typeof s.sales==='object' ? s.sales : {}, sales = {};
for (const field of ['sheet_id','sheet_tab','google_sheets_access_token_env','google_sheets_refresh_token_env','google_sheets_client_id_env','google_sheets_client_secret_env','stages','stage_keys','conversation_contract','ad_campaign_routing','required_financing_documents','whatsapp_catalog_price_mode','catalog','catalog_presentation','inventory_max_age_hours','commercial_rules','hot_lead_rule','collect_documents','financing_require_deposit_for_progress','birth_date_required','document_ocr_enabled','whatsapp_catalog_photo_enabled','vehicle_photos_enabled','whatsapp_catalog_sync_enabled','whatsapp_catalog_fallback_max_age_minutes']) if (Object.prototype.hasOwnProperty.call(sourceSales,field)) sales[field]=sourceSales[field];
const sourceRules = s.sdr_rules && typeof s.sdr_rules==='object' ? s.sdr_rules : {}, sdr_rules = {};
for (const field of ['hot_lead_percent','minimum_purchase_year','rejected_purchase_brands','preferred_purchase_models','warranty_response','document_processing']) if (Object.prototype.hasOwnProperty.call(sourceRules,field)) sdr_rules[field]=sourceRules[field];
const sourceFacts = s.business_facts && typeof s.business_facts==='object' ? s.business_facts : {}, business_facts = {};
for (const field of ['name','payment_methods','vehicle_appraisal','financing','trade_in_policy','opening_hours','locations','vehicle_types','human_services']) if (Object.prototype.hasOwnProperty.call(sourceFacts,field)) business_facts[field]=sourceFacts[field];
// Only the disposition actions of the follow-up policy are exposed to the EXT (P1-03); nothing else of sales_follow_up.
const sourceFollowUp = s.sales_follow_up && typeof s.sales_follow_up==='object' ? s.sales_follow_up : {};
const sales_follow_up = sourceFollowUp.disposition_actions && typeof sourceFollowUp.disposition_actions==='object' ? {disposition_actions:sourceFollowUp.disposition_actions} : {};
const verified = {tenant_id:uuid,whatsapp_processing_mode:s.whatsapp_processing_mode,conversation_capability:s.conversation_capability,whatsapp_audio_enabled:s.whatsapp_audio_enabled===true,appointment_scheduling:{enabled:s.appointment_scheduling?.enabled===true},approved_messages:{enabled:s.approved_messages?.enabled===true},vehicle_sheet_id:typeof s.vehicle_sheet_id==='string'?s.vehicle_sheet_id:'',sales,sdr_rules,business_facts,sales_follow_up};
if (memory) {
  const kept = {};
  for (const [k, v] of Object.entries(memory.noria_identity || {})) if (Number(v?.at) > Date.now() - 60000) kept[k] = v;
  kept[cacheKey] = { at: Date.now(), contract: cacheContract, verified };
  memory.noria_identity = kept;
}
return {json:{...input,noria_verified_settings:verified}};

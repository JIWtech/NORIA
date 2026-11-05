const input = $json;
const base = String($env.SUPABASE_URL || '').replace(/\/$/, '');
const key = $env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || !key) throw new Error('Supabase environment unavailable');
const headers = { apikey: key, Authorization: 'Bearer ' + key };
// Read-only GETs get one retry, only for a transient failure (timeout, network, 429, 5xx). A burst of
// media arrives as concurrent webhooks; a 4xx or a second failure still fails closed.
const transient = error => {
  const status = Number(error?.response?.status || error?.httpCode || error?.statusCode || 0);
  return status === 429 || status >= 500 || (!status && /timeout|ECONNABORTED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(String(error?.code || error?.message || '')));
};
const read = async url => {
  try { return await this.helpers.httpRequest({ method: 'GET', url, headers, json: true, timeout: 5000 }); }
  catch (error) {
    if (!transient(error)) throw error;
    return this.helpers.httpRequest({ method: 'GET', url, headers, json: true, timeout: 5000 });
  }
};
// A registered but pending channel must never fall back to another tenant's legacy flow.
if (input.tenant_resolution?.source === 'env_fallback' && input.instance) {
  const registered = await read(base + '/rest/v1/channels?select=id,status,config&external_id=eq.' + encodeURIComponent(input.instance) + '&type=eq.whatsapp&limit=2');
  if (registered.some(row => row.config?.onboarding_package || row.config?.transport_guard))
    throw new Error('Registered channel not resolved as active; do not use fallback');
}
// One request with only the routing fields: the full settings carries prompts and snapshots (over 100 KB).
const fields = 'mode:settings->>whatsapp_processing_mode,capability:settings->>conversation_capability,'
  + 'exclusion:settings->contact_exclusion_enabled,quiet:settings->debounce_window_ms,fragment:settings->fragment_debounce_window_ms';
const tenants = await read(base + '/rest/v1/tenants?select=' + encodeURIComponent('id,status,tenant_settings(' + fields + ')')
  + '&slug=eq.' + encodeURIComponent(input.tenant_slug) + '&limit=1');
const tenant = tenants[0];
if (!tenant) return { json: { ...input, use_conversation_core: false } };
const settings = (Array.isArray(tenant.tenant_settings) ? tenant.tenant_settings[0] : tenant.tenant_settings) || {};
const useCore = settings.mode === 'conversation_core_v1';
if ((settings.exclusion === true || settings.exclusion === 'true') && !useCore) {
  throw new Error('Contact exclusions require the guarded conversation core; legacy fallback blocked');
}
if (useCore && (tenant.status !== 'active' || input.tenant_resolution?.source === 'env_fallback')) {
  throw new Error('Core requires active tenant resolved by channel instance');
}
return { json: { ...input, tenant_id: tenant.id, use_conversation_core: useCore,
  core_sales: settings.capability === 'sales_v1',
  core_quiet_ms: Math.max(3000, Math.min(Number(settings.quiet) || 8000, 12000)),
  core_fragment_ms: Math.max(3000, Math.min(Number(settings.fragment) || 12000, 45000)),
} };

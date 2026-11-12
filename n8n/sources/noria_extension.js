// EXT NORIA: valida identidade e entrega a política canônica configurada no tenant.
// Somente leitura; a interpretação e a execução permanecem no motor compartilhado.
const input = $json || {};
const slug = 'noria';
const id = String(input.tenant_id || '');
const instance = String(input.instance || '');
if (input.tenant_slug !== slug || input.noria_extension !== slug) throw new Error('NORIA_EXTENSAO_TENANT_INCORRETO');
if (input.noria_contract_version !== '1.0') throw new Error('NORIA_EXTENSAO_CONTRACT_VERSION_MISMATCH');
if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id) || !instance.trim() || !String(input.remoteJid || '').trim()) throw new Error('NORIA_IDENTIDADE_INCOMPLETA');
const base = String($env.SUPABASE_URL || '').replace(/\/$/, '');
const key = String($env.SUPABASE_SERVICE_ROLE_KEY || '');
if (!base || !key) throw new Error('NORIA_CREDENCIAIS_SUPABASE_AUSENTES');
const get = endpoint => this.helpers.httpRequest({ method: 'GET', url: base + '/rest/v1/' + endpoint,
  headers: { apikey: key, Authorization: 'Bearer ' + key }, json: true, timeout: 7000 });
const enc = encodeURIComponent;
const tenants = await get('tenants?select=id,slug,status&id=eq.' + enc(id) + '&slug=eq.noria&limit=1');
if (!Array.isArray(tenants) || tenants.length !== 1 || tenants[0].id !== id || tenants[0].slug !== slug || tenants[0].status !== 'active') throw new Error('NORIA_TENANT_INVALIDO');
const channels = await get('channels?select=external_id,config,status&tenant_id=eq.' + enc(id) + '&type=eq.whatsapp&status=eq.active&limit=25');
if (!Array.isArray(channels) || !channels.some(c => c.status === 'active' && [c.external_id, c.config?.instance_name, c.config?.instance, c.config?.evolution_instance, c.config?.instance_id].filter(Boolean).map(value => String(value).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')).includes(String(instance).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')))) throw new Error('NORIA_INSTANCIA_NAO_PERTENCE_AO_TENANT');
const rows = await get('tenant_settings?select=settings&tenant_id=eq.' + enc(id) + '&limit=1');
const policy = Array.isArray(rows) && rows.length === 1 ? rows[0]?.settings?.noria_client_policy : null;
if (!policy) throw new Error('NORIA_SEM_EXTENSAO_CONFIGURADA: ' + slug);
return { json: { ...input, noria_client_policy: policy },
  ...(typeof $binary !== 'undefined' && $binary ? { binary: $binary } : {}) };

import { asObject } from '../../utils/asObject.js';

import { catalogProductCache, catalogRefreshRequestedAt, tenantCacheEpoch } from '../tenants/tenantScopedCaches.js';
const CATALOG_PRODUCT_CACHE_TTL_MS = 2 * 60 * 1000;
const CATALOG_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

function catalogProductKey(tenantId, instanceName, productId) {
  return [tenantId, instanceName, productId].map((value) => String(value || '').trim()).join('::');
}

function catalogReferralFromEvent(event = {}) {
  const payload = asObject(event.raw_payload);
  const referral = asObject(payload.catalog_referral);
  const productId = String(referral.product_id || '').trim();
  if (referral.source !== 'whatsapp_catalog_product' || !productId) return null;
  const instanceName = String(payload.provider_event?.instance || payload.provider_instance || payload.instance || payload.instanceName || payload.data?.instance || '').trim();
  // Historical Evolution payloads did not always persist the instance. Keep
  // the referral untouched and let the tenant-scoped resolver decide only
  // when there is one unambiguous active WhatsApp channel.
  return { productId, instanceName: instanceName || null };
}

export async function enrichCatalogReferrals(events = [], tenantId, supabase, tenantSlug = '') {
  if (!tenantId || !supabase || !Array.isArray(events)) return events;
  const epoch = tenantCacheEpoch();
  const pending = new Map();
  const unresolved = [];
  for (const event of events) {
    const reference = catalogReferralFromEvent(event);
    if (!reference) continue;
    if (reference.instanceName) pending.set(catalogProductKey(tenantId, reference.instanceName, reference.productId), reference);
    else unresolved.push(reference);
  }
  if (unresolved.length) {
    try {
      const { data, error } = await supabase.from('channels')
        .select('external_id,config').eq('tenant_id', tenantId).eq('type', 'whatsapp').eq('status', 'active').limit(2);
      if (error) throw error;
      const instances = [...new Set((data || []).map((channel) => String(channel.external_id || channel.config?.instance_name || '').trim()).filter(Boolean))];
      // Ambiguity is deliberately fail-closed: no cache lookup or Evolution
      // request can cross an unknown instance boundary.
      if (instances.length === 1) for (const reference of unresolved) {
        const resolvedReference = { ...reference, instanceName: instances[0] };
        pending.set(catalogProductKey(tenantId, instances[0], reference.productId), resolvedReference);
      }
    } catch (_) { /* historical card remains title-only */ }
  }
  if (epoch !== tenantCacheEpoch()) return events;
  const resolved = new Map(); const now = Date.now(); const byInstance = new Map();
  for (const [key, reference] of pending) {
    const cached = catalogProductCache.get(key);
    if (cached && now - cached.checkedAt < CATALOG_PRODUCT_CACHE_TTL_MS) { resolved.set(key, cached.value); continue; }
    byInstance.set(reference.instanceName, [...(byInstance.get(reference.instanceName) || []), reference.productId]);
  }
  await Promise.all([...byInstance.entries()].map(async ([instanceName, ids]) => {
    const productIds = [...new Set(ids)].slice(0, 100);
    try {
      const { data, error } = await supabase.from('whatsapp_catalog_products')
        .select('product_id,title,currency,regular_price_cents,sale_price_cents,effective_price_cents,price_source,price_evidence_source,price_observed_at,image_url,image_urls,synced_at,active')
        .eq('tenant_id', tenantId).eq('instance_name', instanceName).eq('active', true).in('product_id', productIds);
      if (error) throw error;
      if (epoch !== tenantCacheEpoch()) return;
      const rows = new Map((data || []).map((row) => [String(row.product_id), row]));
      for (const productId of productIds) {
        const key = catalogProductKey(tenantId, instanceName, productId); const value = rows.get(productId) || null;
        catalogProductCache.set(key, { checkedAt: now, value }); resolved.set(key, value);
      }
    } catch (_) {
      if (epoch !== tenantCacheEpoch()) return;
      for (const productId of productIds) catalogProductCache.set(catalogProductKey(tenantId, instanceName, productId), { checkedAt: now, value: null });
    }
    const missing = productIds.filter((productId) => !resolved.get(catalogProductKey(tenantId, instanceName, productId)));
    const refreshKey = `${tenantId}::${instanceName}`;
    if (missing.length && now - (catalogRefreshRequestedAt.get(refreshKey) || 0) >= CATALOG_REFRESH_COOLDOWN_MS) {
      catalogRefreshRequestedAt.set(refreshKey, now);
      // The authenticated command router owns Evolution credentials. This is a
      // best-effort cache refresh, deliberately detached from rendering.
      void import('../integration.js')
        .then(({ requestCatalogProductRefresh }) => epoch === tenantCacheEpoch()
          ? requestCatalogProductRefresh({ instance_name: instanceName, product_ids: missing.slice(0, 20) }, tenantSlug) : null)
        .then((result) => {
          if (!result?.found || epoch !== tenantCacheEpoch()) return;
          for (const productId of missing) catalogProductCache.delete(catalogProductKey(tenantId, instanceName, productId));
          // main.jsx already owns data reloads; this is one bounded signal after
          // a confirmed backend write, never a render-time polling loop.
          window.dispatchEvent(new CustomEvent('noria:catalog-cache-updated', { detail: { tenantId, instanceName } }));
        })
        .catch(() => {});
    }
  }));
  if (epoch !== tenantCacheEpoch()) return events;
  return events.map((event) => {
    const reference = catalogReferralFromEvent(event);
    const resolvedReference = reference?.instanceName
      ? reference
      : [...pending.values()].find((value) => value.productId === reference?.productId);
    const product = resolvedReference && resolved.get(catalogProductKey(tenantId, resolvedReference.instanceName, resolvedReference.productId));
    return product ? { ...event, _catalogProduct: product } : event;
  });
}

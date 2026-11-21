import { tenantCacheEpoch } from '../tenants/tenantScopedCaches.js';

export async function loadTeamAgents(tenantSlug, { getClient, isAuthRequired, storage = () => localStorage } = {}) {
  if (!tenantSlug) return [];
  const epoch = tenantCacheEpoch();
  const storageKey = `magia:team-agents:${tenantSlug}`;
  const getStorage = () => (typeof storage === 'function' ? storage() : storage);
  try {
    const supabase = getClient?.();
    if (supabase) {
      const { data, error } = await supabase
        .from('team_agents')
        .select('*')
        .eq('tenant_slug', tenantSlug)
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      if (epoch !== tenantCacheEpoch()) return [];
      if (!error && Array.isArray(data)) {
        try { getStorage().setItem(storageKey, JSON.stringify(data)); } catch (e) { }
        return data;
      }
      if (isAuthRequired?.()) return [];
    }
  } catch (e) {
    console.warn('Falha ao carregar team_agents do Supabase:', e);
  }
  if (epoch !== tenantCacheEpoch()) return [];
  if (isAuthRequired?.()) return [];
  try {
    const cached = getStorage().getItem(storageKey);
    return cached ? JSON.parse(cached) : [];
  } catch (e) {
    return [];
  }
}

import { clearMediaUrlCache } from '../media/mediaUrlService.js';

// Um único ciclo de vida para dados que não podem sobreviver à sessão do usuário.
export const fullHistoryCache = new Map();
export const schedulingCacheByTenant = new Map();
export const depositCacheByTenant = new Map();
export const catalogProductCache = new Map();
export const catalogRefreshRequestedAt = new Map();
export const locationDetailsCache = new Map();
export const tenantLookupCache = new Map();
let epoch = 0;
export const tenantCacheEpoch = () => epoch;

export function clearTenantScopedCaches() {
  epoch += 1;
  for (const cache of [fullHistoryCache, schedulingCacheByTenant, depositCacheByTenant,
    catalogProductCache, catalogRefreshRequestedAt, locationDetailsCache, tenantLookupCache]) cache.clear();
  clearMediaUrlCache();
  try {
    const storage = globalThis.localStorage;
    if (!storage) return;
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (key?.startsWith('magia:team-agents:')) storage.removeItem(key);
    }
  } catch { /* Armazenamento indisponível não impede a limpeza em memória. */ }
}

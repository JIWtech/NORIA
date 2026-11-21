import { useEffect, useState } from 'react';
import { loadDepositRequired } from '../../../services/appointments/outcomeActions.js';
import { depositCacheByTenant, tenantCacheEpoch } from '../../../services/tenants/tenantScopedCaches.js';

const EMPTY_INDEX = new Map();
const DEPOSIT_CACHE_TTL_MS = 30_000;

// Contatos que faltaram a um agendamento e, por isso, exigem sinal em novos agendamentos.
// Mantém cache curto por tenant para evitar nova consulta e re-render extra ao alternar entre abas.
export function useDepositRequired(tenantSlug, refreshKey) {
  const [result, setResult] = useState(() => {
    if (!tenantSlug) return null;
    const cached = depositCacheByTenant.get(tenantSlug);
    return cached ? { tenantSlug, index: cached.index } : null;
  });

  useEffect(() => {
    let cancelled = false;
    const epoch = tenantCacheEpoch();
    if (!tenantSlug) {
      setResult(null);
      return undefined;
    }
    const cached = depositCacheByTenant.get(tenantSlug);
    const isFresh = cached
      && cached.refreshKey === refreshKey
      && (Date.now() - cached.fetchedAt) < DEPOSIT_CACHE_TTL_MS;
    if (isFresh) {
      setResult((prev) => (prev?.tenantSlug === tenantSlug && prev.index === cached.index
        ? prev
        : { tenantSlug, index: cached.index }));
      return undefined;
    }
    loadDepositRequired(tenantSlug).then((next) => {
      if (cancelled || epoch !== tenantCacheEpoch()) return;
      depositCacheByTenant.set(tenantSlug, { index: next, refreshKey, fetchedAt: Date.now() });
      if (!cancelled) setResult({ tenantSlug, index: next });
    });
    return () => { cancelled = true; };
  }, [tenantSlug, refreshKey]);

  return result && result.tenantSlug === tenantSlug ? result.index : EMPTY_INDEX;
}

import { useEffect, useState } from 'react';
import { loadDepositRequired } from '../../../services/appointments/outcomeActions.js';

const EMPTY_INDEX = new Map();

// Contatos que faltaram a um agendamento e, por isso, exigem sinal em novos agendamentos.
// Só consulta quando há tenant (a tela passa '' quando o recurso está desligado) e se refaz
// sempre que os dados da tela são atualizados (refreshKey).
export function useDepositRequired(tenantSlug, refreshKey) {
  const [result, setResult] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (!tenantSlug) {
      setResult(null);
      return undefined;
    }
    loadDepositRequired(tenantSlug).then((next) => {
      if (!cancelled) setResult({ tenantSlug, index: next });
    });
    return () => { cancelled = true; };
  }, [tenantSlug, refreshKey]);
  return result && result.tenantSlug === tenantSlug ? result.index : EMPTY_INDEX;
}

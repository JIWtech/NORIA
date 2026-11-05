import { useEffect, useState } from 'react';
import { loadDepositRequired } from '../../../services/appointments/outcomeActions.js';

// Contatos que faltaram a um agendamento e, por isso, exigem sinal em novos agendamentos.
// Só consulta quando há tenant (a tela passa '' quando o recurso está desligado) e se refaz
// sempre que os dados da tela são atualizados (refreshKey).
export function useDepositRequired(tenantSlug, refreshKey) {
  const [index, setIndex] = useState(() => new Map());
  useEffect(() => {
    let cancelled = false;
    if (!tenantSlug) {
      setIndex((current) => (current.size ? new Map() : current));
      return undefined;
    }
    loadDepositRequired(tenantSlug).then((next) => {
      if (!cancelled) setIndex(next);
    });
    return () => { cancelled = true; };
  }, [tenantSlug, refreshKey]);
  return index;
}

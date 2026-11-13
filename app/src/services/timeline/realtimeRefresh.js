import { isInternalOperationalEvent } from './eventClassification.js';

export const VISIBILITY_REFRESH_STALE_AFTER_MS = 15 * 60 * 1000;

export function createRefreshCoordinator({
  now = () => Date.now(),
  staleAfterMs = VISIBILITY_REFRESH_STALE_AFTER_MS,
} = {}) {
  const freshAtByScope = new Map();
  const inFlightByScope = new Map();
  const queuedByScope = new Map();

  return {
    shouldRefreshOnVisibility(scope) {
      if (!scope || inFlightByScope.has(scope)) return false;
      const freshAt = freshAtByScope.get(scope);
      return !freshAt || now() - freshAt >= staleAfterMs;
    },
    markFresh(scope) {
      if (scope) freshAtByScope.set(scope, now());
    },
    run(scope, load) {
      if (!scope) return Promise.resolve(false);
      const existing = inFlightByScope.get(scope);
      if (existing) {
        // A recarga em andamento leu o banco antes deste pedido (ex.: agendamento cancelado no meio dela).
        // Os pedidos feitos nesse intervalo viram uma única recarga extra, executada quando a atual termina.
        const queued = queuedByScope.get(scope);
        if (queued) return queued;
        const trailing = existing.catch(() => {}).then(() => {
          queuedByScope.delete(scope);
          return this.run(scope, load);
        });
        queuedByScope.set(scope, trailing);
        return trailing;
      }

      let task;
      try {
        task = Promise.resolve(load());
      } catch (error) {
        task = Promise.reject(error);
      }
      const tracked = task.then((result) => {
        if (result !== false) freshAtByScope.set(scope, now());
        return result;
      }).finally(() => {
        if (inFlightByScope.get(scope) === tracked) inFlightByScope.delete(scope);
      });
      inFlightByScope.set(scope, tracked);
      return tracked;
    },
  };
}

export function shouldRefreshConversationState(event = {}, { isNewConversation = false } = {}) {
  return isNewConversation || Boolean(event.handoff)
    || isInternalOperationalEvent(event)
    || ['resume_ai', 'handoff_requested', 'conversation_assigned', 'conversation_closed', 'pagamento_sinal', 'sales_stage_changed', 'sales_qualification', 'sales_interest'].includes(event.service)
    || event.ai_provider === 'payment_signal';
}

export function createDebouncedRealtimeRefresh(refresh, delay = 800) {
  let timer = null;
  const schedule = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      refresh();
    }, delay);
  };
  schedule.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return schedule;
}

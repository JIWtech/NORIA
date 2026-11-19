import { isInternalOperationalEvent } from './eventClassification.js';

export const VISIBILITY_REFRESH_STALE_AFTER_MS = 15 * 60 * 1000;

function mergeResources(first, second) {
  if (!first || !second) return undefined;
  return [...new Set([...first, ...second])];
}

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
    run(scope, load, resources) {
      if (!scope) return Promise.resolve(false);
      const existing = inFlightByScope.get(scope);
      if (existing) {
        // A recarga em andamento leu o banco antes deste pedido (ex.: agendamento cancelado no meio dela).
        // Os pedidos feitos nesse intervalo viram uma única recarga extra, executada quando a atual termina.
        const queued = queuedByScope.get(scope);
        if (queued) {
          queued.resources = mergeResources(queued.resources, resources);
          return queued.promise;
        }
        const request = { resources };
        const trailing = existing.catch(() => {}).then(() => {
          queuedByScope.delete(scope);
          return this.run(scope, load, request.resources);
        });
        request.promise = trailing;
        queuedByScope.set(scope, request);
        return trailing;
      }

      let task;
      try {
        task = Promise.resolve(load(resources));
      } catch (error) {
        task = Promise.reject(error);
      }
      const tracked = task.then((result) => {
        if (result !== false && !resources) freshAtByScope.set(scope, now());
        return result;
      }).finally(() => {
        if (inFlightByScope.get(scope) === tracked) inFlightByScope.delete(scope);
      });
      inFlightByScope.set(scope, tracked);
      return tracked;
    },
  };
}

const CONTROL_SERVICES = ['resume_ai', 'handoff_requested', 'conversation_assigned', 'conversation_closed', 'pagamento_sinal',
  'sales_stage_changed', 'sales_qualification', 'sales_interest'];

// Recarga completa só quando o evento muda estado que a aplicação incremental não reconstrói. O marcador técnico do
// pipeline v2 (noria_pipeline_pin) e mensagens marcadas com handoff numa conversa que já está com a equipe não mudam nada:
// com volume alto (NB Bronze, 19/11) eles causavam uma recarga completa por minuto.
export function shouldRefreshConversationState(event = {}, { isNewConversation = false, alreadyHumanControlled = false } = {}) {
  if (isNewConversation) return true;
  if (event.service === 'noria_pipeline_pin') return false;
  const isControl = CONTROL_SERVICES.includes(event.service) || event.ai_provider === 'payment_signal';
  const repeatedHandoff = Boolean(event.handoff) && alreadyHumanControlled && !isControl;
  return (Boolean(event.handoff) && !repeatedHandoff)
    || isInternalOperationalEvent(event)
    || isControl;
}

export function createDebouncedRealtimeRefresh(refresh, delay = 800) {
  let timer = null;
  let pendingResources;
  const flush = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    const requestedResources = pendingResources;
    pendingResources = undefined;
    refresh(requestedResources);
  };
  const schedule = (resources) => {
    pendingResources = timer === null ? resources : mergeResources(pendingResources, resources);
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, delay);
  };
  schedule.flush = flush;
  schedule.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pendingResources = undefined;
  };
  return schedule;
}

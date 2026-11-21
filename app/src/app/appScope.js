const PAGE_RESOURCE_MAP = {
  agendamentos: ['agendamentos'],
  disparos: ['contatos de disparos', 'campanhas', 'contatos'],
  conversas: ['leituras', 'contatos'],
  kanban: ['agendamentos', 'contatos'],
  dashboard: ['contatos'],
};

export function buildScopeKey(userId, tenantSlug) {
  return JSON.stringify([userId || 'local', tenantSlug || null]);
}

export function withScopeKey(data, scopeKey) {
  if (!data || typeof data !== 'object') return data;
  return { ...data, scopeKey };
}

export function isSameScope(activeScope, requestedScope) {
  return Boolean(activeScope && requestedScope && activeScope === requestedScope);
}

export function selectScopedAppData(appData, appDataReady, scopeKey, fallbackData) {
  const matchesScope = Boolean(scopeKey && appData && appData.scopeKey === scopeKey);
  return {
    data: matchesScope ? appData : fallbackData,
    ready: Boolean(appDataReady && matchesScope),
  };
}

export function resourceErrorsForPage(resourceErrors, activePage) {
  if (!Array.isArray(resourceErrors) || !resourceErrors.length) return [];
  const relevant = PAGE_RESOURCE_MAP[activePage];
  if (!relevant) return [];
  return resourceErrors.filter((resource) => relevant.includes(resource));
}

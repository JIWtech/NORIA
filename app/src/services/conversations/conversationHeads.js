// IA-16: a carga inicial traz só os eventos mais recentes do tenant. Para que nenhuma conversa desapareça do
// painel, completamos a janela com o último evento de cada conversa (função conversation_latest_events).
export const CONVERSATION_HEADS_LIMIT = 500;

export async function loadConversationHeads(supabase, tenantSlug, limit = CONVERSATION_HEADS_LIMIT) {
  if (!supabase || typeof supabase.rpc !== 'function' || !tenantSlug) return [];
  try {
    const { data, error } = await supabase.rpc('conversation_latest_events', { p_tenant_slug: tenantSlug, p_limit: limit });
    if (error || !Array.isArray(data)) return [];
    return data.filter((row) => row && row.tenant_slug === tenantSlug);
  } catch {
    // Função ainda não instalada ou indisponível: o painel segue com a janela recente.
    return [];
  }
}

export function mergeConversationHeads(events = [], heads = []) {
  if (!heads.length) return events;
  const seen = new Set(events.map((event) => event.id));
  const extra = heads.filter((event) => !seen.has(event.id));
  return extra.length ? [...events, ...extra] : events;
}

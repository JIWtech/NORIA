// IA-16: a carga inicial traz só os eventos mais recentes do tenant. Para que nenhuma conversa desapareça do
// painel, completamos a janela com o último evento de cada conversa (função conversation_latest_events).
// O histórico completo de uma conversa é carregado quando ela é aberta (loadConversationFullHistory).
export const CONVERSATION_HEADS_LIMIT = 2000;
// O PostgREST limita cada resposta (padrão de 1.000 linhas): a lista é lida em páginas.
const PAGE_SIZE = 1000;

export async function loadConversationHeads(supabase, tenantSlug, limit = CONVERSATION_HEADS_LIMIT) {
  if (!supabase || typeof supabase.rpc !== 'function' || !tenantSlug) return [];
  const rows = [];
  try {
    for (let from = 0; from < limit; from += PAGE_SIZE) {
      const call = supabase.rpc('conversation_latest_events', { p_tenant_slug: tenantSlug, p_limit: limit });
      const { data, error } = typeof call.range === 'function' ? await call.range(from, Math.min(from + PAGE_SIZE, limit) - 1) : await call;
      if (error || !Array.isArray(data)) return from === 0 ? [] : rows;
      rows.push(...data.filter((row) => row && row.tenant_slug === tenantSlug));
      if (data.length < PAGE_SIZE || typeof call.range !== 'function') break;
    }
  } catch {
    // Função ainda não instalada ou indisponível: o painel segue com a janela recente.
    return rows;
  }
  return rows;
}

export function mergeConversationHeads(events = [], heads = []) {
  if (!heads.length) return events;
  const seen = new Set(events.map((event) => event.id));
  const extra = heads.filter((event) => !seen.has(event.id));
  return extra.length ? [...events, ...extra] : events;
}

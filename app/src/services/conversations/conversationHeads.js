// IA-16: a carga inicial traz só os eventos mais recentes do tenant. Para que nenhuma conversa desapareça do
// painel, completamos a janela com o último evento de cada conversa.
// Desempenho (19/11): a função leve conversation_latest_events_light devolve só a janela de atividade pedida
// (since/before) e sem campos de diagnóstico; conversas antigas são lidas sob demanda. Sem ela no banco,
// volta à função original e aplica a janela no cliente.
// O histórico completo de uma conversa é carregado quando ela é aberta (loadConversationFullHistory).
export const CONVERSATION_HEADS_LIMIT = 2000;
// Conversas sem atividade há mais que isso ficam fora da carga padrão (abertas por "conversas antigas").
export const RECENT_CONVERSATION_DAYS = 30;
// O PostgREST limita cada resposta (padrão de 1.000 linhas): a lista é lida em páginas.
const PAGE_SIZE = 1000;

export function recentConversationsSince(now = Date.now(), days = RECENT_CONVERSATION_DAYS) {
  return new Date(now - days * 86_400_000).toISOString();
}

async function readPages(supabase, name, args, limit, tenantSlug) {
  const rows = [];
  for (let from = 0; from < limit; from += PAGE_SIZE) {
    const call = supabase.rpc(name, args);
    const { data, error } = typeof call?.range === 'function' ? await call.range(from, Math.min(from + PAGE_SIZE, limit) - 1) : await call;
    if (error || !Array.isArray(data)) return from === 0 ? null : rows;
    rows.push(...data.filter((row) => row && row.tenant_slug === tenantSlug));
    if (data.length < PAGE_SIZE || typeof call?.range !== 'function') break;
  }
  return rows;
}

export async function loadConversationHeads(supabase, tenantSlug, options = {}) {
  if (!supabase || typeof supabase.rpc !== 'function' || !tenantSlug) return [];
  const { limit = CONVERSATION_HEADS_LIMIT, since = null, before = null } = typeof options === 'number' ? { limit: options } : options;
  const inWindow = (row) => {
    const at = Date.parse(row.created_at);
    return (!since || at >= Date.parse(since)) && (!before || at < Date.parse(before));
  };
  try {
    const light = await readPages(supabase, 'conversation_latest_events_light',
      { p_tenant_slug: tenantSlug, p_limit: limit, p_since: since, p_before: before }, limit, tenantSlug);
    if (light) return light;
    // Função leve ainda não instalada: a original devolve todas as conversas; a janela é aplicada aqui.
    const full = await readPages(supabase, 'conversation_latest_events', { p_tenant_slug: tenantSlug, p_limit: limit }, limit, tenantSlug);
    return (full || []).filter(inWindow);
  } catch {
    // Função indisponível: o painel segue com a janela recente.
    return [];
  }
}

export function mergeConversationHeads(events = [], heads = []) {
  if (!heads.length) return events;
  const seen = new Set(events.map((event) => event.id));
  const extra = heads.filter((event) => !seen.has(event.id));
  return extra.length ? [...events, ...extra] : events;
}

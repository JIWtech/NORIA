// Janela de renderização para listas longas (Kanban e lista de conversas): desenha só uma página de itens e
// informa quantos ficaram de fora. O item em foco (notificação aberta, conversa selecionada) sempre aparece.
export const KANBAN_CARDS_PAGE = 40;
export const CONVERSATIONS_PAGE = 60;

export function windowItems(items, limit, focusedId = null) {
  const list = Array.isArray(items) ? items : [];
  if (!Number.isFinite(limit) || limit <= 0 || list.length <= limit) return { visible: list, hidden: 0 };
  const visible = list.slice(0, limit);
  if (focusedId != null && !visible.some((item) => item?.id === focusedId)) {
    const focused = list.find((item) => item?.id === focusedId);
    if (focused) visible.push(focused);
  }
  return { visible, hidden: list.length - visible.length };
}

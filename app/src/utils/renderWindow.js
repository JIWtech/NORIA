// Janela de renderização para listas longas (Kanban e lista de conversas): desenha só uma página de itens e
// informa quantos ficaram de fora. O item em foco (notificação aberta, conversa selecionada) sempre aparece.
// Cards por coluna do Kanban: os 50 mais recentes; mais 50 a cada vez que o fim da coluna aparece.
export const KANBAN_CARDS_PAGE = 50;
export const CONVERSATIONS_PAGE = 60;
export const BROADCAST_CONTACTS_PAGE = 60;
export const APPOINTMENTS_SECTION_PAGE = 40;

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

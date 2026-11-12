export const TOAST_VISIBLE_MS = 10_000;
export const MAX_VISIBLE_TOASTS = 3;

// Agrupa as mensagens novas por conversa: uma conversa que manda várias mensagens vira um só pop-up com o contador.
export function groupToasts(toasts) {
  const groups = new Map();
  for (const item of toasts) {
    const key = `${item.channel || 'whatsapp'}:${item.chatId || item.id}`;
    const group = groups.get(key) || { key, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()].map(group => ({ ...group, latest: group.items[group.items.length - 1] }))
    .sort((a, b) => Date.parse(b.latest.createdAt) - Date.parse(a.latest.createdAt));
}

import { findNotificationConversation } from './operatorEvents.js';
import { isUsefulContactName } from '../../services/contacts/contactNames.js';

const dateFormat = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' });

function dayLabel(date, today, yesterday) {
  if (date.toDateString() === today.toDateString()) return 'Hoje';
  if (date.toDateString() === yesterday.toDateString()) return 'Ontem';
  return dateFormat.format(date);
}

// Organiza a central em duas camadas: o que precisa de alguém da equipe agora (pendências)
// e a atividade informativa, com uma linha por contato e dia para não repetir cards quase iguais.
export function buildNotificationDigest(items, conversations = []) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const needsAction = [];
  const days = new Map();

  const entries = items.flatMap(item => {
    const date = new Date(item.createdAt);
    if (!Number.isFinite(date.getTime())) return [];
    const conversation = findNotificationConversation(item, conversations);
    const contact = conversation?.contact || (isUsefulContactName(item.contact) ? item.contact : '');
    return [{ item, date, conversation, contact }];
  }).sort((a, b) => b.date - a.date);

  for (const entry of entries) {
    if (entry.item.pending) { needsAction.push(entry); continue; }
    const dayKey = entry.date.toDateString();
    if (!days.has(dayKey)) days.set(dayKey, { key: dayKey, label: dayLabel(entry.date, today, yesterday), threads: new Map(), count: 0 });
    const day = days.get(dayKey);
    const { item, conversation, contact } = entry;
    const thread = conversation?.id || (item.chatId && `${item.channel || 'whatsapp'}:${item.chatId}`) || (contact && `contact:${contact}`);
    const key = thread || `item:${item.id}`;
    if (!day.threads.has(key)) day.threads.set(key, { key, latest: entry, entries: [], unread: 0 });
    const group = day.threads.get(key);
    group.entries.push(entry);
    if (item.unread) group.unread += 1;
    day.count += 1;
  }

  needsAction.sort((a, b) => Number(Boolean(b.item.overdue)) - Number(Boolean(a.item.overdue)) || a.date - b.date);
  return {
    needsAction,
    activity: [...days.values()].map(day => ({ ...day, threads: [...day.threads.values()] })),
  };
}

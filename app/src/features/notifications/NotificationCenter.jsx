import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNotifications } from './useNotifications.js';
import { humanReplyStatus } from './notificationService.js';
import { findNotificationConversation, notificationMakesSound, notificationScope } from './operatorEvents.js';
import { canOperateNotifications, inboxNotification, pendingNotifications, waitingConversationNotifications } from './notificationPending.js';
import { useOperatorNotifications } from './useOperatorNotifications.js';
import { useNotificationSound } from './useNotificationSound.js';
import { NotificationPanel } from './NotificationPanel.jsx';

const EMPTY = [];
const pages = { leads: 'kanban', appointments: 'agendamentos', campaigns: 'disparos', conversations: 'conversas', attention: 'conversas' };

export function NotificationCenter({ tenantId, tenantSlug, userId, tenantName, role, settings,
  conversationViewRef, conversations = EMPTY, appointments = EMPTY, kanbanColumns = EMPTY, onOpenConversation, onOpenPage, onOpenCard }) {
  const inbox = useNotifications(tenantId, userId);
  const activity = useOperatorNotifications({ tenantId, tenantSlug, userId, conversationViewRef, appointments, kanbanColumns });
  const sound = useNotificationSound(notificationScope(tenantId, userId));
  const previousSoundSequence = useRef(0);
  const remoteSeen = useRef(null);
  const mountedAt = useRef(Date.now());
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (activity.soundSequence !== previousSoundSequence.current) {
      previousSoundSequence.current = activity.soundSequence;
      sound.play();
    }
  }, [activity.soundSequence, sound.play]);

  useEffect(() => {
    if (inbox.loading || inbox.error || inbox.isOlderPage) return;
    const next = new Map(inbox.items.map(item => [item.id, item.revision]));
    // Só avisos que pedem ação tocam som; encerramentos e respostas já dadas aparecem sem som.
    if (remoteSeen.current && inbox.items.some(item => item.unread && (remoteSeen.current.get(item.id) || 0) < item.revision
      && Date.parse(item.updated_at || item.created_at) >= mountedAt.current
      && notificationMakesSound(inboxNotification(item, humanReplyStatus(item, inbox.replies, tenantId, inbox.checkedAt))))) sound.play();
    remoteSeen.current = next;
  }, [inbox.items, inbox.loading, inbox.error, inbox.isOlderPage, inbox.replies, inbox.checkedAt, tenantId, sound.play]);

  const items = useMemo(() => {
    const scope = { tenantId, userId, role, settings, kanbanColumns, appointments, now };
    const remote = inbox.items.map(item => inboxNotification(item, humanReplyStatus(item, inbox.replies, tenantId, inbox.checkedAt)));
    const tracked = [...pendingNotifications(scope), ...waitingConversationNotifications(scope)];
    const activeRemote = remote.filter(item => !item.remote.resolved_at);
    const handoffs = [...tracked.filter(item => item.kind === 'handoff'), ...activeRemote];
    const currentAppointments = new Map(tracked.filter(item => item.appointmentId)
      .map(item => [item.appointmentId, item.kind === 'deposit-review' ? 'payment_reported' : 'pending_confirmation']));
    const sameConversation = (a, b) => a.chatId && b.chatId && (a.channel || 'whatsapp') === (b.channel || 'whatsapp')
      && (a.chatId === b.chatId || (findNotificationConversation(a, conversations)?.id
        && findNotificationConversation(a, conversations)?.id === findNotificationConversation(b, conversations)?.id));
    return [...remote, ...tracked.filter(item => item.kind !== 'handoff' || !activeRemote.some(other => sameConversation(item, other)))
      .map(item => ({ ...item, unread: !activity.pendingReads.has(item.id) })),
    ...activity.items.filter(item => !item.tracked
      && !(item.kind === 'handoff' && handoffs.some(other => sameConversation(item, other)))
      && !(item.kind === 'team-review' && tracked.some(other => other.kind === 'team-review' && sameConversation(item, other)))
      && !(item.appointmentId && currentAppointments.get(item.appointmentId) === item.appointmentStatus))];
  }, [tenantId, userId, role, settings, kanbanColumns, appointments, now, inbox.items, inbox.replies, inbox.checkedAt, activity.items, activity.pendingReads, conversations]);

  const unread = items.filter(item => !item.remote && item.unread).length + (inbox.unread || 0);
  const markRead = item => item.remote ? inbox.markRead(item.remote)
    : activity.markRead(item.id, item.tracked ? [item] : []);
  const markAll = () => {
    activity.markAllRead(items.filter(item => item.tracked && item.unread));
    if (!inbox.error && !inbox.syncing && inbox.unread > 0) void inbox.markAllRead();
  };
  const actionFor = (item, conversation) => {
    if (item.cardId && onOpenCard) return { label: item.kind === 'deposit-review' ? 'Verificar sinal' : 'Ver pedido',
      run: () => onOpenCard(item.cardId) };
    if (item.pending && item.category === 'appointments' && onOpenPage) {
      return { label: 'Abrir Kanban', run: () => onOpenPage('kanban') };
    }
    if (conversation && onOpenConversation) return { label: 'Abrir conversa', run: () => onOpenConversation(conversation.id) };
    const page = pages[item.category];
    return onOpenPage && page ? { label: { kanban: 'Abrir Kanban', agendamentos: 'Abrir agenda', disparos: 'Ver campanhas', conversas: 'Ver conversas' }[page],
      run: () => onOpenPage(page) } : null;
  };

  return <NotificationPanel tenantName={tenantName} items={items} conversations={conversations} unread={unread}
    inbox={inbox} sound={sound} onMarkRead={markRead} onMarkAll={markAll} actionFor={actionFor}
    showPending={canOperateNotifications(role) || items.some(item => item.pending)}
    onSettings={onOpenPage ? () => onOpenPage('configuracoes') : undefined} />;
}

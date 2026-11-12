import { useCallback, useEffect, useRef, useState } from 'react';
import { appointmentReminders, belongsToTenant, followUpReminders, MAX_NOTIFICATIONS, mergeOperatorNotifications, notificationScope, OPERATOR_EVENT, operatorEvents, dismissKey, shouldPlayOperatorNotification } from './operatorEvents.js';

export function readOperatorNotifications(storage, key, tenantId) {
  if (!key) return [];
  try {
    const parsed = JSON.parse(storage.getItem(key) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(item => item?.tenantId === tenantId && typeof item.id === 'string' && typeof item.title === 'string'
      && typeof item.description === 'string' && typeof item.unread === 'boolean' && Number.isFinite(Date.parse(item.createdAt))).slice(0, MAX_NOTIFICATIONS);
  } catch { return []; }
}

function readPendingReceipts(key) {
  if (!key) return [];
  try {
    const ids = JSON.parse(window.localStorage.getItem(key) || '[]');
    return Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : [];
  } catch { return []; }
}

export function useOperatorNotifications({ tenantId, tenantSlug, userId, conversationViewRef, appointments = [], kanbanColumns = [] }) {
  const key = notificationScope(tenantId, userId);
  const pendingKey = key ? `${key}:pending-reads` : null;
  const [pendingReads, setPendingReads] = useState(() => new Set(readPendingReceipts(pendingKey)));
  const [items, setItems] = useState(() => {
    try { return readOperatorNotifications(window.localStorage, key, tenantId); } catch { return []; }
  });
  const [soundSequence, setSoundSequence] = useState(0);
  const [toasts, setToasts] = useState([]);
  const clearedKey = key ? `${key}:cleared-at` : null;
  const dismissedStorageKey = key ? `${key}:dismissed` : null;
  const [dismissedKeys, setDismissedKeys] = useState(() => {
    try { const stored = JSON.parse(window.localStorage.getItem(dismissedStorageKey) || '[]'); return new Set(Array.isArray(stored) ? stored : []); } catch { return new Set(); }
  });
  const [clearedAt, setClearedAt] = useState(() => {
    try { return clearedKey ? Number(window.localStorage.getItem(clearedKey)) || 0 : 0; } catch { return 0; }
  });
  const itemsRef = useRef(items);
  const rows = useRef(new Map());
  const add = useCallback((incoming) => {
    const previous = itemsRef.current;
    const newItems = incoming.filter(item => !previous.some(old => old.id === item.id));
    if (!newItems.length) return;
    const next = mergeOperatorNotifications(previous, newItems);
    itemsRef.current = next;
    setItems(next);
    const view = conversationViewRef?.current;
    const visibleKey = document.visibilityState === 'visible' && view?.visible ? view.canonicalKey : '';
    if (newItems.some(item => shouldPlayOperatorNotification(item, tenantSlug, visibleKey))) {
      setSoundSequence(value => value + 1);
    }
    // Mensagem nova de cliente vira pop-up, exceto na conversa que o atendente já está vendo.
    const popups = newItems.filter(item => item.kind === 'message' && shouldPlayOperatorNotification(item, tenantSlug, visibleKey)
      && Date.now() - Date.parse(item.createdAt) < 60_000);
    if (popups.length) setToasts(current => [...current, ...popups].slice(-20));
  }, [conversationViewRef, tenantSlug]);

  useEffect(() => {
    if (!key) return;
    try { window.localStorage.setItem(key, JSON.stringify(items)); } catch { /* The inbox remains usable when storage is unavailable. */ }
  }, [key, items]);

  useEffect(() => {
    if (!key) return undefined;
    const receive = event => {
      const detail = event.detail;
      if (detail?.tenantId !== tenantId || detail?.userId !== userId) return;
      const payload = detail.payload;
      if (!belongsToTenant(payload?.new, tenantId, tenantSlug)) return;
      const rowKey = `${payload.table}:${payload.new.id}`;
      const old = rows.current.get(rowKey) || payload.old || {};
      rows.current.set(rowKey, payload.new);
      if (rows.current.size > 500) rows.current.delete(rows.current.keys().next().value);
      add(operatorEvents({ ...payload, old }, { tenantId, tenantSlug, userId }));
    };
    const storage = event => {
      if (event.key === pendingKey) setPendingReads(new Set(readPendingReceipts(pendingKey)));
      if (event.key !== key) return;
      try {
        const next = readOperatorNotifications(window.localStorage, key, tenantId);
        itemsRef.current = next;
        setItems(next);
      } catch { /* Ignore unavailable storage. */ }
    };
    window.addEventListener(OPERATOR_EVENT, receive);
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener(OPERATOR_EVENT, receive);
      window.removeEventListener('storage', storage);
    };
  }, [key, pendingKey, tenantId, tenantSlug, userId, add]);

  useEffect(() => {
    if (!key) return undefined;
    const check = () => add([...appointmentReminders(appointments, tenantId), ...followUpReminders(kanbanColumns, tenantId)]);
    check();
    const timer = setInterval(check, 60_000);
    return () => clearInterval(timer);
  }, [key, appointments, kanbanColumns, tenantId, add]);

  useEffect(() => {
    if (!key) return undefined;
    const connection = event => add([{ id: `connection:${event.type}:${Date.now()}`, tenantId, kind: 'connection',
      title: event.type === 'offline' ? 'Você está sem conexão' : 'Conexão restabelecida',
      description: event.type === 'offline' ? 'Os novos avisos voltarão a chegar quando a conexão for restabelecida.' : 'Atualize a tela para conferir as últimas mensagens da equipe.',
      category: 'attention', attention: event.type === 'offline', unread: true, createdAt: new Date().toISOString() }]);
    window.addEventListener('online', connection);
    window.addEventListener('offline', connection);
    return () => { window.removeEventListener('online', connection); window.removeEventListener('offline', connection); };
  }, [key, tenantId, add]);

  const markRead = useCallback((id, trackedItems = []) => {
    if (pendingKey && trackedItems.length) {
      // Guardamos apenas os recibos. As pendências vêm dos registros atuais da operação.
      const ids = [...new Set([...readPendingReceipts(pendingKey), ...pendingReads,
        ...trackedItems.filter(item => item.tenantId === tenantId).map(item => item.id)])].slice(-2000);
      setPendingReads(new Set(ids));
      try { window.localStorage.setItem(pendingKey, JSON.stringify(ids)); } catch { /* Armazenamento opcional. */ }
    }
    const next = itemsRef.current.map(item => !id || item.id === id ? { ...item, unread: false } : item);
    itemsRef.current = next;
    setItems(next);
  }, [pendingKey, pendingReads, tenantId]);

  const clearAll = useCallback(() => {
    const at = Date.now();
    setClearedAt(at);
    setToasts([]);
    try { if (clearedKey) window.localStorage.setItem(clearedKey, String(at)); } catch { /* Sem armazenamento, a limpeza vale só nesta sessão. */ }
  }, [clearedKey]);

  const dismissItems = useCallback((targets) => {
    setDismissedKeys(current => {
      const next = new Set([...current, ...targets.map(dismissKey)]);
      const kept = [...next].slice(-1000);
      try { if (dismissedStorageKey) window.localStorage.setItem(dismissedStorageKey, JSON.stringify(kept)); } catch { /* Vale só nesta sessão. */ }
      return new Set(kept);
    });
    setToasts(current => current.filter(toast => !targets.some(target => target.id === toast.id)));
  }, [dismissedStorageKey]);

  const dismissToasts = useCallback((ids) => {
    const drop = new Set(ids);
    setToasts(current => current.filter(item => !drop.has(item.id)));
  }, []);

  return { items, pendingReads, soundSequence, toasts, dismissToasts, dismissedKeys, dismissItems, clearedAt, clearAll, markRead, markAllRead: (trackedItems) => markRead(null, trackedItems) };
}

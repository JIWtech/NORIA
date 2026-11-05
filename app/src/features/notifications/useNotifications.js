import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchHumanReplies, inboxRpc, notificationError, validateInboxPage, validateInboxRead } from './notificationService.js';

const PAGE_SIZE = 30;
const POLL_MS = 30000;

// This state is owned by the bell, not App: polling cannot remount conversation
// media or replace the conversation data. The keyed parent fences tenant/user.
export function useNotifications(tenantId, userId) {
  const [state, setState] = useState({ items: [], replies: null, checkedAt: 0, unread: null, loading: true, error: '', hasMore: false, isOlderPage: false });
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const active = useRef(false);
  const request = useRef(null);
  const cursor = useRef({});
  const busy = useRef(false);

  const load = useCallback(async (pageCursor) => {
    const page = validateInboxPage(await inboxRpc('magia_list_turn_notifications', {
      p_tenant: tenantId, p_limit: PAGE_SIZE, ...pageCursor,
    }, request.current.signal), tenantId, PAGE_SIZE);
    if (page.has_more && !page.items.length) throw new Error('INBOX_INVALID_CURSOR');
    if (!active.current) return;
    // Read-only and fail-soft: null keeps the original notices when replies cannot be confirmed.
    const replies = await fetchHumanReplies(tenantId, page.items, request.current.signal);
    if (!active.current) return;
    cursor.current = pageCursor;
    // Only the current bounded page is retained/refreshed, never the full history.
    setState({ items: page.items, replies, checkedAt: Date.now(), unread: page.unread_count, hasMore: page.has_more,
      isOlderPage: Boolean(pageCursor.p_before_id), loading: false, error: '' });
  }, [tenantId]);

  const run = useCallback(async ({ readItem, readAll = false, pageCursor = cursor.current } = {}) => {
    if (busy.current || !active.current) return;
    if (!tenantId || !userId) {
      setState({ items: [], unread: null, loading: false, hasMore: false,
        error: 'Entre na sua conta para consultar as notificações.' });
      return;
    }
    busy.current = true;
    setSyncing(true);
    request.current = new AbortController();
    const timeout = setTimeout(() => request.current?.abort(), 20000);
    try {
      if (readItem || readAll) {
        setSaving(true);
        const receipt = validateInboxRead(await inboxRpc(
          readAll ? 'magia_read_all_turn_notifications' : 'magia_read_turn_notifications',
          readAll ? { p_tenant: tenantId }
            : { p_tenant: tenantId, p_items: [{ id: readItem.id, revision: readItem.revision }] },
          request.current.signal,
        ), tenantId);
        // Calls are serialized: these displayed revisions predate the server's
        // bulk snapshot. New revisions are fetched below and can remain unread.
        if (active.current) setState((previous) => ({ ...previous, unread: receipt.unread_count,
          items: previous.items.map((item) => (readAll || (item.id === readItem.id && item.revision <= readItem.revision))
            ? { ...item, unread: false } : item) }));
      }
      await load(pageCursor);
    } catch (error) {
      if (active.current) setState((previous) => {
        const forbidden = error?.message?.includes('TURN_REVIEW_FORBIDDEN') || error?.code === '42501';
        return { ...previous, ...(forbidden ? { items: [], unread: null, hasMore: false } : {}),
          loading: false, error: notificationError(error) };
      });
    } finally {
      clearTimeout(timeout);
      busy.current = false;
      if (active.current) { setSaving(false); setSyncing(false); }
    }
  }, [tenantId, userId, load]);

  useEffect(() => {
    active.current = true;
    let disposed = false;
    queueMicrotask(() => { if (!disposed) run(); });
    const wake = () => { if (document.visibilityState !== 'hidden') run(); };
    const timer = setInterval(wake, POLL_MS);
    window.addEventListener('online', wake);
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', wake);
    return () => {
      active.current = false;
      disposed = true;
      clearInterval(timer);
      request.current?.abort();
      window.removeEventListener('online', wake);
      window.removeEventListener('focus', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [run]);

  return {
    ...state, saving, syncing,
    refresh: () => run(),
    loadMore: () => {
      const last = state.items.at(-1);
      if (state.hasMore && last) run({ pageCursor: { p_before_created_at: last.created_at, p_before_id: last.id } });
    },
    showLatest: () => run({ pageCursor: {} }),
    markRead: (item) => run({ readItem: item }),
    markAllRead: () => run({ readAll: true }),
  };
}

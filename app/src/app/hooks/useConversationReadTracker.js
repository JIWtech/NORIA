import { useCallback, useEffect, useRef } from 'react';
import {
  applyConversationReadState,
  conversationReadKey,
  getLatestReadableEvent,
  markConversationRead,
  shouldAdvanceConversationRead,
  upsertConversationReadMarker,
} from '../../dataService.js';
import { isSameScope } from '../appScope.js';

export function useConversationReadTracker({
  activeTenantSlug,
  sessionUserId,
  currentScope,
  appDataRef,
  setAppData,
  refreshData,
}) {
  const conversationViewRef = useRef({ canonicalKey: '', visible: false });
  const conversationReadTimersRef = useRef(new Map());
  const refreshDataRef = useRef(refreshData);
  refreshDataRef.current = refreshData;

  const resetConversationReadTracker = useCallback(({ clearTimers = true } = {}) => {
    conversationViewRef.current = { canonicalKey: '', visible: false };
    if (clearTimers) {
      for (const timer of conversationReadTimersRef.current.values()) window.clearTimeout(timer);
      conversationReadTimersRef.current.clear();
    }
  }, []);

  const scheduleConversationRead = useCallback((conversation) => {
    const userId = sessionUserId || null;
    const requestedScope = currentScope.current;
    const currentAppData = appDataRef.current;
    const tenantId = currentAppData?.scopeKey === requestedScope ? currentAppData?.tenantId : null;
    const latestEvent = getLatestReadableEvent(conversation);
    if (!requestedScope || !tenantId || !userId || !conversation || !latestEvent?.eventId || !latestEvent?.createdAt) return;

    const channelType = conversation.channelType || conversation.channel;
    const externalConversationId = conversation.externalConversationId || conversation.normalizedExternalId;
    const key = conversationReadKey(tenantId, userId, channelType, externalConversationId);
    const knownMarker = (currentAppData?.conversationReads || []).find((marker) => conversationReadKey(
      marker.tenant_id,
      marker.user_id,
      marker.channel_type,
      marker.external_conversation_id,
    ) === key);
    if (!shouldAdvanceConversationRead(knownMarker, latestEvent)) return;

    const optimisticMarker = {
      tenant_id: tenantId,
      user_id: userId,
      channel_type: channelType,
      external_conversation_id: externalConversationId,
      last_read_event_id: latestEvent.eventId,
      last_read_at: latestEvent.createdAt,
    };
    setAppData((previous) => {
      if (!previous || previous.scopeKey !== requestedScope || previous.tenantId !== tenantId) return previous;
      const previousMarker = (previous.conversationReads || []).find((marker) => conversationReadKey(
        marker.tenant_id,
        marker.user_id,
        marker.channel_type,
        marker.external_conversation_id,
      ) === key);
      if (!shouldAdvanceConversationRead(previousMarker, latestEvent)) return previous;
      const conversationReads = upsertConversationReadMarker(previous.conversationReads || [], optimisticMarker);
      return {
        ...previous,
        conversationReads,
        conversations: applyConversationReadState(previous.conversations, conversationReads, tenantId, userId),
      };
    });

    const existingTimer = conversationReadTimersRef.current.get(key);
    if (existingTimer) window.clearTimeout(existingTimer);
    const timer = window.setTimeout(async () => {
      conversationReadTimersRef.current.delete(key);
      if (!isSameScope(currentScope.current, requestedScope)) return;
      try {
        const persistedMarker = await markConversationRead({
          tenantId,
          channelType,
          externalConversationId,
          lastReadEventId: latestEvent.eventId,
        });
        if (!persistedMarker || !isSameScope(currentScope.current, requestedScope)) return;
        setAppData((previous) => {
          if (!previous || previous.scopeKey !== requestedScope || previous.tenantId !== tenantId) return previous;
          const conversationReads = upsertConversationReadMarker(previous.conversationReads || [], persistedMarker);
          return {
            ...previous,
            conversationReads,
            conversations: applyConversationReadState(previous.conversations, conversationReads, tenantId, userId),
          };
        });
      } catch (error) {
        console.warn('Não foi possível salvar a leitura da conversa:', error.message || error);
        if (isSameScope(currentScope.current, requestedScope)) {
          refreshDataRef.current?.({ showLoading: false });
        }
      }
    }, 180);
    conversationReadTimersRef.current.set(key, timer);
  }, [sessionUserId]);

  const handleConversationViewStateChange = useCallback(({ conversation, visible } = {}) => {
    conversationViewRef.current = {
      canonicalKey: conversation?.canonicalKey || '',
      visible: Boolean(visible && conversation?.canonicalKey),
    };
    if (conversationViewRef.current.visible) scheduleConversationRead(conversation);
  }, [scheduleConversationRead]);

  useEffect(() => () => {
    for (const timer of conversationReadTimersRef.current.values()) window.clearTimeout(timer);
    conversationReadTimersRef.current.clear();
  }, [activeTenantSlug, sessionUserId]);

  return {
    conversationViewRef,
    scheduleConversationRead,
    handleConversationViewStateChange,
    resetConversationReadTracker,
  };
}

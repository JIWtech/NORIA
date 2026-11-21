import { useCallback, useRef } from 'react';
import {
  getStageLabel,
  isGenesisSalesTenant,
  moveKanbanCard,
  sortKanbanCardsByConversationActivity,
} from '../../dataService.js';
import { placeKanbanCard } from '../../services/kanban/pendingKanbanMoves.js';
import { normalizeChannel } from '../../services/identity/conversationIdentity.js';
import { isSameScope } from '../appScope.js';

export function matchesCardConversation(conv, card) {
  if (!conv || !card) return false;
  if (conv.tenantSlug && card.tenantSlug && conv.tenantSlug !== card.tenantSlug) return false;
  const convChannel = conv.channelType || conv.channel;
  const cardChannel = card.channelType || card.channel;
  if (convChannel && cardChannel && normalizeChannel(convChannel).type !== normalizeChannel(cardChannel).type) return false;
  if (
    (conv.id && conv.id === card.id)
    || (conv.id && conv.id === card.conversationId)
    || (card.canonicalKey && conv.id === `conv-${card.canonicalKey}`)
    || (conv.canonicalKey && card.canonicalKey && conv.canonicalKey === card.canonicalKey)
  ) {
    return true;
  }
  if (!convChannel || !cardChannel) return false;
  return Boolean(
    (conv.normalizedExternalId && card.normalizedExternalId && conv.normalizedExternalId === card.normalizedExternalId)
    || (conv.externalConversationId && card.externalConversationId && conv.externalConversationId === card.externalConversationId)
  );
}

export function useKanbanMutations({
  activeTenantSlug,
  currentScope,
  appDataRef,
  scopedKanbanColumns,
  scopedTenantSettings,
  setAppData,
  refreshData,
}) {
  const kanbanMoveInFlightRef = useRef(new Set());

  const clearKanbanMovesInFlight = useCallback(() => {
    const ref = kanbanMoveInFlightRef.current;
    if (!ref) return;
    ref.clear();
    ref.pendingMoves?.clear();
    ref.confirmedMoves?.clear();
  }, []);

  const handleMoveKanbanCard = async (card, targetColumnKey, targetColObj = null) => {
    const requestedScope = currentScope.current;
    if (!requestedScope) return;
    const currentColumn = String(card.targetColumnId || card.stage || '');
    if (currentColumn === targetColumnKey || (targetColObj && currentColumn === targetColObj.id)) return;

    const moveKey = [
      activeTenantSlug,
      card.channelType || card.channel || 'unknown',
      card.externalConversationId || card.conversationId || card.id,
    ].join(':');
    if (kanbanMoveInFlightRef.current.has(moveKey)) return;
    kanbanMoveInFlightRef.current.add(moveKey);
    const targetStageLabel = targetColObj?.title || getStageLabel(targetColumnKey, {
      kanbanColumns: (appDataRef.current?.scopeKey === requestedScope ? appDataRef.current?.kanbanColumns : null) || scopedKanbanColumns,
      tenantSettings: scopedTenantSettings,
      tenantSlug: activeTenantSlug,
    });
    if (!kanbanMoveInFlightRef.current.pendingMoves) {
      kanbanMoveInFlightRef.current.pendingMoves = new Map();
    }
    const moveSeq = (kanbanMoveInFlightRef.current.moveSeq = (kanbanMoveInFlightRef.current.moveSeq || 0) + 1);
    kanbanMoveInFlightRef.current.pendingMoves.set(card.id, {
      targetColumnKey,
      targetColObj,
      targetStageLabel,
      card,
      moveSeq,
      inFlight: true,
      timestamp: Date.now(),
    });

    // Atualização otimista no estado local
    setAppData((prev) => {
      if (!prev?.kanbanColumns || prev.scopeKey !== requestedScope) return prev;
      const optimisticTargetStageLabel = targetColObj?.title || getStageLabel(targetColumnKey, {
        kanbanColumns: prev.kanbanColumns,
        tenantSettings: scopedTenantSettings,
        tenantSlug: activeTenantSlug,
      });
      const isClosedTarget = targetColumnKey === 'finalizadas'
        || targetColumnKey === 'conversation_closed'
        || targetColObj?.automationKey === 'finalizadas'
        || targetColObj?.automationKey === 'conversation_closed'
        || optimisticTargetStageLabel === 'Finalizada'
        || optimisticTargetStageLabel === 'Finalizado';
      const isHumanTarget = targetColumnKey === 'sales_human'
        || targetColumnKey === 'com_humano'
        || targetColumnKey === 'conversas_humanos'
        || targetColumnKey === 'aguardando_humano'
        || optimisticTargetStageLabel.toLowerCase().includes('humano');

      const nextColumns = prev.kanbanColumns.map((col) => {
        const filteredCards = (col.cards || []).filter((c) => c.id !== card.id);
        const colKey = col.automationKey || col.id;
        const matchesTarget =
          colKey === targetColumnKey ||
          col.id === targetColumnKey ||
          (targetColObj && (
            col.id === targetColObj.id ||
            col.automationKey === targetColObj.automationKey ||
            col.title === targetColObj.title
          ));
        if (matchesTarget) {
          return {
            ...col,
            cards: sortKanbanCardsByConversationActivity([
              placeKanbanCard(card, col.automationKey || targetColumnKey, optimisticTargetStageLabel), ...filteredCards,
            ]),
          };
        }
        return { ...col, cards: filteredCards };
      });

      const nextConversations = (prev.conversations || []).map((conv) => {
        if (!matchesCardConversation(conv, card)) return conv;

        if (isClosedTarget) {
          return {
            ...conv,
            status: 'finalizado',
            stage: 'Finalizado',
            owner: null,
            ownerId: null,
            ownerKind: null,
            handoff: false,
          };
        }

        return {
          ...conv,
          stage: optimisticTargetStageLabel,
          salesStageKey: targetColumnKey.startsWith('sales_') ? targetColumnKey : conv.salesStageKey,
          status: isHumanTarget ? 'atendimento_humano' : conv.status === 'finalizado' ? 'ia_ativa' : conv.status,
        };
      });

      return {
        ...prev,
        kanbanColumns: nextColumns,
        conversations: nextConversations,
      };
    });

    try {
      const [persistedMove] = await moveKanbanCard(activeTenantSlug, card, targetColumnKey, null, targetColObj);
      if (!isSameScope(currentScope.current, requestedScope)) return;
      const currentPending = kanbanMoveInFlightRef.current.pendingMoves?.get(card.id);
      if (currentPending && currentPending.moveSeq === moveSeq) {
        currentPending.inFlight = false;
        currentPending.completedAt = Date.now();
      }
      if (!kanbanMoveInFlightRef.current.confirmedMoves) {
        kanbanMoveInFlightRef.current.confirmedMoves = new Map();
      }
      kanbanMoveInFlightRef.current.confirmedMoves.set(card.id, {
        targetColumnKey,
        targetColObj,
        targetStageLabel,
        card,
        salesRevision: persistedMove?.salesRevision,
        confirmedAt: Date.now(),
      });
      if (persistedMove?.salesLeadId) {
        setAppData((prev) => {
          if (!prev || prev.scopeKey !== requestedScope) return prev;
          return {
            ...prev,
            kanbanColumns: (prev?.kanbanColumns || []).map((column) => ({
              ...column,
              cards: (column.cards || []).map((currentCard) => currentCard.id === card.id
                ? {
                  ...currentCard,
                  salesLeadId: persistedMove.salesLeadId,
                  salesStageKey: persistedMove.salesStageKey,
                  salesRevision: persistedMove.salesRevision,
                  salesAiLocked: persistedMove.salesAiLocked,
                }
                : currentCard),
            })),
            conversations: (prev?.conversations || []).map((conv) => {
              if (!matchesCardConversation(conv, card)) return conv;
              return {
                ...conv,
                salesStageKey: persistedMove.salesStageKey || conv.salesStageKey,
                salesAiLocked: typeof persistedMove.salesAiLocked === 'boolean' ? persistedMove.salesAiLocked : conv.salesAiLocked,
              };
            }),
          };
        });
      }
    } catch (err) {
      console.warn('Falha ao salvar movimentação de card no banco:', err);
      if (!isSameScope(currentScope.current, requestedScope)) return;
      const current = kanbanMoveInFlightRef.current.pendingMoves?.get(card.id);
      if (current && current.moveSeq === moveSeq) {
        kanbanMoveInFlightRef.current.pendingMoves.delete(card.id);
      }
      if (kanbanMoveInFlightRef.current.confirmedMoves?.has(card.id)) {
        kanbanMoveInFlightRef.current.confirmedMoves.delete(card.id);
      }
      refreshData({ showLoading: false });
    } finally {
      kanbanMoveInFlightRef.current.delete(moveKey);
      window.setTimeout(() => {
        if (!isSameScope(currentScope.current, requestedScope)) return;
        const current = kanbanMoveInFlightRef.current.pendingMoves?.get(card.id);
        if (current && current.moveSeq === moveSeq) {
          kanbanMoveInFlightRef.current.pendingMoves.delete(card.id);
        }
      }, 2000);
    }
  };

  const handleKanbanOrderApplied = (orderedAutomationKeys) => {
    const requestedScope = currentScope.current;
    const positions = new Map(orderedAutomationKeys.map((key, index) => [key, index]));
    setAppData((prev) => {
      if (!prev || prev.scopeKey !== requestedScope) return prev;
      return {
        ...prev,
        kanbanColumns: [...(prev?.kanbanColumns || [])]
          .map((column) => ({ ...column, position: positions.get(column.automationKey || column.id) }))
          .sort((left, right) => left.position - right.position),
      };
    });
  };

  const handleFinishConversationFromKanban = async (card) => {
    const requestedScope = currentScope.current;
    if (!requestedScope) return;
    if (isGenesisSalesTenant(activeTenantSlug)) {
      try {
        await moveKanbanCard(activeTenantSlug, card, 'conversation_closed');
        if (!isSameScope(currentScope.current, requestedScope)) return;
        refreshData({ showLoading: false });
      } catch (err) {
        console.warn('Falha ao encerrar conversa do Kanban:', err);
      }
      return;
    }
    handleMoveKanbanCard(card, 'finalizadas');
  };

  return {
    kanbanMoveInFlightRef,
    clearKanbanMovesInFlight,
    handleMoveKanbanCard,
    handleKanbanOrderApplied,
    handleFinishConversationFromKanban,
  };
}

// Reaplica movimentos manuais do Kanban ainda não refletidos pelo servidor (extraído de App.jsx).
//
// O id do card da conversa muda a cada evento (card-<id do último evento>), e o próprio arrasto grava
// um evento. Por isso o movimento é reconhecido pela identidade da conversa (canal + contato), além do
// id: assim o card atualizado do servidor substitui a cópia guardada no arrasto, em vez de somar a ela.
import { canonicalConversationKey } from '../identity/conversationIdentity.js';

// Cards de follow-up dividem o contato com a conversa, mas são outro item do quadro: não entram na identidade.
function conversationIdentity(card) {
  if (String(card?.id || '').startsWith('follow-up-')) return '';
  const externalId = card?.externalConversationId || card?.normalizedExternalId;
  if (!externalId) return '';
  return canonicalConversationKey(card.channelType || card.channel || '', externalId);
}

function columnKeyOf(column) {
  return column.automationKey || column.id;
}

function targetsColumn(move, column) {
  const colKey = columnKeyOf(column);
  return move.targetColumnKey === colKey
    || Boolean(move.targetColObj && (move.targetColObj.id === column.id || move.targetColObj.automationKey === colKey));
}

function placedCard(card, move, column) {
  return {
    ...card,
    stage: move.targetStageLabel,
    targetColumnId: column.automationKey || move.targetColumnKey,
    ...(move.kind === 'confirmed' ? { salesRevision: move.salesRevision || card.salesRevision || move.card?.salesRevision } : {}),
  };
}

export function reconcilePendingKanbanMoves(serverData, pendingMovesMap, confirmedMovesMap) {
  if (!serverData?.kanbanColumns) {
    return serverData;
  }
  const now = Date.now();
  const moves = [];

  if (pendingMovesMap && pendingMovesMap.size > 0) {
    for (const [cardId, move] of pendingMovesMap.entries()) {
      const isExpired = !move.inFlight && (now - (move.completedAt || move.timestamp) >= 4000);
      if (isExpired) {
        pendingMovesMap.delete(cardId);
        continue;
      }
      moves.push({ ...move, kind: 'pending', cardId, identity: conversationIdentity(move.card) });
    }
  }

  if (confirmedMovesMap && confirmedMovesMap.size > 0) {
    for (const [cardId, confirmed] of confirmedMovesMap.entries()) {
      if (now - confirmed.confirmedAt >= 5000) {
        confirmedMovesMap.delete(cardId);
        continue;
      }
      if (moves.some((move) => move.cardId === cardId)) continue;
      moves.push({ ...confirmed, kind: 'confirmed', cardId, identity: conversationIdentity(confirmed.card) });
    }
  }

  if (!moves.length) return serverData;

  const moveFor = (card) => moves.find((move) => move.cardId === card.id
    || (move.identity && move.identity === conversationIdentity(card)));
  // Um movimento confirmado só vale enquanto o servidor ainda mostra uma revisão anterior ou a janela curta.
  const moveStillApplies = (move, card) => move.kind === 'pending'
    || !card.salesRevision
    || (move.salesRevision && card.salesRevision < move.salesRevision)
    || (now - move.confirmedAt < 4000);

  // Card mais recente do servidor para cada movimento, encontrado em qualquer coluna.
  const freshByMove = new Map();
  const nextColumns = serverData.kanbanColumns.map((column) => {
    const cards = (column.cards || []).filter((card) => {
      const move = moveFor(card);
      if (!move || !moveStillApplies(move, card)) return true;
      if (!freshByMove.has(move)) freshByMove.set(move, card);
      return targetsColumn(move, column);
    });
    return { ...column, cards };
  });

  for (const column of nextColumns) {
    for (const move of moves) {
      if (!targetsColumn(move, column)) continue;
      const alreadyThere = column.cards.some((card) => card.id === move.cardId
        || (move.identity && move.identity === conversationIdentity(card)));
      if (alreadyThere) continue;
      column.cards.unshift(placedCard(freshByMove.get(move) || move.card, move, column));
    }
  }

  return { ...serverData, kanbanColumns: nextColumns };
}

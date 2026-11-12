import { kanbanColumnPresentation } from '../../../services/kanban/kanbanColumnPresentation.js';
import { canonicalKanbanKey } from '../../../services/kanban/kanbanHelpers.js';

// Cada card do Kanban, indexado pelas chaves da conversa, carrega a coluna em que está no quadro do tenant,
// com o nome, o símbolo, a cor e o papel que vêm do banco.
export function indexKanbanCards(kanbanColumns) {
  const map = new Map();
  if (!Array.isArray(kanbanColumns)) return map;
  for (const column of kanbanColumns) {
    const { cards, ...kanbanColumn } = column;
    for (const card of (cards || [])) {
      const entry = { ...card, kanbanColumn };
      for (const key of [card.canonicalKey, card.normalizedExternalId, card.externalConversationId, card.id]) {
        if (key && !map.has(key)) map.set(key, entry);
      }
    }
  }
  return map;
}

// Selos da conversa: a etapa é a coluna do Kanban do tenant (a do card ou, sem card, a do estágio);
// o dono só aparece quando acrescenta informação ao papel da coluna (owner_role, no banco).
export function conversationListTags(presentation, matchingCard, stageColumn = null) {
  if (presentation?.isClosed) return { owner: { kind: 'closed', label: 'Encerrada' }, column: null };
  const source = matchingCard?.kanbanColumn || stageColumn || null;
  const column = source || (presentation?.stageLabel ? { title: presentation.stageLabel } : null);

  const isAbandoned = canonicalKanbanKey(
    matchingCard?.targetColumnId
    || source?.automationKey
    || source?.automation_key
    || source?.id
    || source?.title
    || presentation?.stageLabel
  ) === 'conversas_abandonadas';
  const hasNoOwner = isAbandoned
    || presentation?.ownerMode === 'none'
    || presentation?.lifecycle === 'none'
    || presentation?.lifecycle === 'commercial';
  if (hasNoOwner) return { owner: null, column };

  const isHuman = Boolean(presentation?.isHuman);
  const owner = isHuman
    ? { kind: 'human', label: presentation?.assignee || 'Humano' }
    : { kind: 'ai', label: 'IA' };
  const role = source ? kanbanColumnPresentation(source).ownerRole : 'neutral';
  const columnSaysOwner = isHuman ? role === 'human' : role === 'ai';
  const namedAttendant = isHuman && Boolean(presentation?.assignee);
  return { owner: columnSaysOwner && !namedAttendant ? null : owner, column };
}

// Selo da etapa, igual na lista e no cabeçalho: nome, cor e símbolo da coluna.
export function conversationStageChip(column) {
  if (!column?.title) return null;
  const { tone, Icon } = kanbanColumnPresentation(column);
  return { label: column.title, tone, Icon };
}

// Selo único exibido para conversas sob controle da IA fora da coluna "Conversas IA".
export const CONVERSATION_AI_STAGE_CHIP = Object.freeze(
  conversationStageChip({ title: 'Conversas IA', icon: 'bot', tone: 'cyan' }),
);

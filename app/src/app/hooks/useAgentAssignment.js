import { sendN8nCommand } from '../../services/integration.js';
import { isGenesisSalesTenant, moveKanbanCard } from '../../dataService.js';
import { requirePersistedAssignment } from '../../services/conversations/conversationLifecycle.js';
import { normalizeChannel } from '../../services/identity/conversationIdentity.js';
import { isSameScope } from '../appScope.js';

export function matchesConversationCard(card, selectedConversation) {
  if (!card || !selectedConversation) return false;
  if (card.tenantSlug && selectedConversation.tenantSlug && card.tenantSlug !== selectedConversation.tenantSlug) return false;
  const cardChannel = card.channelType || card.channel;
  const convChannel = selectedConversation.channelType || selectedConversation.channel;
  if (cardChannel && convChannel && normalizeChannel(cardChannel).type !== normalizeChannel(convChannel).type) return false;
  if (
    (selectedConversation.canonicalKey && card.canonicalKey === selectedConversation.canonicalKey)
    || (selectedConversation.id && card.id === selectedConversation.id)
  ) {
    return true;
  }
  if (!cardChannel || !convChannel) return false;
  return Boolean(
    (selectedConversation.normalizedExternalId && card.normalizedExternalId === selectedConversation.normalizedExternalId)
    || (selectedConversation.externalConversationId && card.externalConversationId === selectedConversation.externalConversationId)
  );
}

export function useAgentAssignment({
  activeTenantSlug,
  currentScope,
  appDataRef,
  scopedTenantSettings,
  setAppData,
  setAgentsList,
  refreshData,
}) {
  async function handleAssignAgent(conversationOrId, agent) {
    const requestedScope = currentScope.current;
    if (!requestedScope) return;
    const scopedRefData = appDataRef.current?.scopeKey === requestedScope ? appDataRef.current : null;
    const selectedConversation = typeof conversationOrId === 'object'
      ? conversationOrId
      : (scopedRefData?.conversations || []).find((conv) => conv.id === conversationOrId);
    const conversationId = selectedConversation?.id || conversationOrId;
    const request = scopedTenantSettings?.tenantId === scopedRefData?.tenantId ? scopedTenantSettings?.settings?.appointment_request : null;
    const reviewOnly = (selectedConversation?.channelType || selectedConversation?.channel?.toLowerCase()) === 'whatsapp'
      && request?.mode === 'operator_confirmation' && request.team_review_control === 'manual_reply';

    if (!selectedConversation) throw new Error('Conversa não encontrada para atribuição.');
    if (isGenesisSalesTenant(activeTenantSlug)) {
      try {
        await moveKanbanCard(activeTenantSlug, selectedConversation, 'sales_human', agent.name);
      } catch (e) {
        console.warn('Falha ao sincronizar etapa Genesis com sales_human:', e.message || e);
      }
      if (!isSameScope(currentScope.current, requestedScope)) return;
    }
    // A tela só mostra o responsável depois que o roteador confirma o evento que pausa a IA.
    // Sem confirmação, o erro sobe para quem clicou: "assumido" na tela com a IA ativa é o pior caso.
    const result = await sendN8nCommand('assign_conversation', {
      channel_type: selectedConversation.channelType || selectedConversation.channel?.toLowerCase(),
      external_conversation_id: selectedConversation.externalConversationId || selectedConversation.id.replace(/^conv-/, ''),
      contact_name: selectedConversation.contact,
      message_text: `Conversa atribuída a ${agent.name}`,
      sent_by_user: agent.name,
      assignee: {
        id: agent.id,
        name: agent.name,
        role: agent.role,
      },
    }, activeTenantSlug);
    requirePersistedAssignment(result, { reviewOnly });
    if (!isSameScope(currentScope.current, requestedScope)) return;

    setAppData((prev) => {
      if (reviewOnly || !prev || prev.scopeKey !== requestedScope) return prev;
      const nextConversations = prev.conversations.map((conv) => {
        if (conv.id === conversationId) {
          const newMessages = [
            ...(conv.messages || []),
            {
              from: 'system',
              text: `Conversa atribuída a ${agent.name}`,
              at: 'Agora',
            },
          ];
          return {
            ...conv,
            owner: agent.name,
            ownerId: agent.id,
            ownerKind: 'agent',
            status: 'atendimento_humano',
            messages: newMessages,
          };
        }
        return conv;
      });
      const nextKanbanColumns = (prev.kanbanColumns || []).map((col) => ({
        ...col,
        cards: (col.cards || []).map((card) => {
          if (matchesConversationCard(card, selectedConversation)) {
            return {
              ...card,
              owner: agent.name,
              ownerId: agent.id,
              ownerKind: 'agent',
            };
          }
          return card;
        }),
      }));
      return {
        ...prev,
        conversations: nextConversations,
        kanbanColumns: nextKanbanColumns,
      };
    });

    if (!reviewOnly && isSameScope(currentScope.current, requestedScope)) {
      setAgentsList((prev) => prev.map((ag) => ag.id === agent.id ? { ...ag, load: (ag.load || 0) + 1 } : ag));
    }

    // A atribuição já está gravada; falha só no recarregamento não desfaz nem esconde a confirmação.
    try {
      if (isSameScope(currentScope.current, requestedScope)) {
        await refreshData();
      }
    } catch (error) {
      console.warn('Atribuição confirmada, mas o recarregamento falhou:', error.message || error);
    }
  }

  return { handleAssignAgent };
}

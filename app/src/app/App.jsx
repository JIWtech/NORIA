import { userFacingError } from '../utils/userFacingError.js';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  CalendarDays,
  KanbanSquare,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MessageCircle,
  RefreshCcw,
  Settings,
} from 'lucide-react';
import {
  conversations,
  funnelStages,
  kanbanColumns,
  tenants as mockTenants,
} from '../services/clientData/mockData';
import {
  getCurrentSession,
  isAuthRequired,
  signOut,
  subscribeToAuthState,
} from '../services/auth/authService.js';
import { getIntegrationStatus, sendN8nCommand } from '../services/integration.js';
import {
  applyContactUpdateToConversations,
  applyConversationReadState,
  applyIncomingEventToConversations,
  applyIncomingEventToKanban,
  canonicalConversationKey,
  conversationReadKey,
  createDebouncedRealtimeRefresh,
  enrichSingleMediaEvent,
  getInitialTenantSlug,
  getLatestReadableEvent,
  getStageLabel,
  hasStoredMediaNeedingUrl,
  hasSupabaseConfig,
  isGenesisSalesTenant,
  loadAvailableTenants,
  loadClientData,
  loadTeamAgents,
  loadTenantSettings,
  markConversationRead,
  moveKanbanCard,
  persistTenantSlug,
  removeTeamAgent,
  saveTeamAgent,
  shouldAdvanceConversationRead,
  shouldRefreshConversationState,
  sortKanbanCardsByConversationActivity,
  subscribeToClientEvents,
  subscribeToContacts,
  subscribeToConversationReads,
  updateTeamAgentStatus,
  upsertConversationReadMarker,
} from '../dataService';
import { clearTenantSlug } from '../services/tenants/tenantStorage.js';
import { isTenantAuthorized } from '../services/tenants/tenantAccess.js';
import { mergeMediaDescriptors } from '../services/media/mediaNormalization.js';
import {
  createRefreshCoordinator,
  VISIBILITY_REFRESH_STALE_AFTER_MS,
} from '../services/timeline/realtimeRefresh.js';
import { Dashboard } from '../features/dashboard/components/Dashboard';
import { Funnel } from '../features/kanban/components/Funnel';
import { Conversations } from '../features/conversations/components/Conversations';
import { Kanban } from '../features/kanban/components/Kanban';
import { Broadcasts } from '../features/broadcasts/components/Broadcasts';
import { Appointments } from '../features/appointments/components/Appointments';
import { SettingsPage } from '../features/settings/components/SettingsPage';
import { AuthShell } from '../features/auth/components/AuthShell';
import { LoginPage } from '../features/auth/components/LoginPage';
import { HomePage } from '../LandingPage';
import { NoriaSelect } from '../components/NoriaSelect';
import {
  activePageStorageKey,
  appDataCachePrefix,
  appDataSignature,
  cacheAppData,
  clearSessionBootstrapped,
  getInitialActivePage,
  getInitialAppData,
  isSessionBootstrapped,
  loadCachedAppData,
  setSessionBootstrapped,
} from './appStorage';
import { AppNavigation } from './AppNavigation';
import { AppTopbar } from './AppTopbar';

const menu = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'conversas', label: 'Conversas', icon: MessageCircle },
  { id: 'kanban', label: 'Kanban', icon: KanbanSquare },
  { id: 'disparos', label: 'Disparos', icon: Megaphone },
  { id: 'agendamentos', label: 'Agendamentos', icon: CalendarDays },
  { id: 'configuracoes', label: 'Configurações', icon: Settings },
];
const mediaRetryDelays = [0, 800, 2200];

function withLocalMediaLoadState(event, loadState = '') {
  const payload = event?.raw_payload;
  const media = payload?.media;
  if (!event || !payload || !media || typeof media !== 'object') return event;
  return {
    ...event,
    raw_payload: {
      ...payload,
      media: { ...media, loadState },
    },
  };
}

function hasResolvedMediaUrl(event) {
  return Boolean(event?.raw_payload?.media?.url);
}

function preserveLocalMediaStates(previousData, nextData) {
  if (!previousData?.conversations?.length || !nextData?.conversations?.length) return nextData;
  const previousMediaByEventId = new Map();
  for (const conversation of previousData.conversations) {
    for (const message of conversation.messages || []) {
      if (message.eventId && message.media?.loadState === 'retryable_error') {
        previousMediaByEventId.set(message.eventId, message.media);
      }
    }
  }
  if (!previousMediaByEventId.size) return nextData;

  let changed = false;
  const conversations = nextData.conversations.map((conversation) => {
    const messages = (conversation.messages || []).map((message) => {
      const previousMedia = previousMediaByEventId.get(message.eventId);
      if (!previousMedia) return message;
      const media = mergeMediaDescriptors(previousMedia, message.media);
      if (media === message.media) return message;
      changed = true;
      return { ...message, media };
    });
    return messages === conversation.messages ? conversation : { ...conversation, messages };
  });
  return changed ? { ...nextData, conversations } : nextData;
}

function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(value);
}

function reconcilePendingKanbanMoves(serverData, pendingMovesMap, confirmedMovesMap) {
  if (!serverData?.kanbanColumns) {
    return serverData;
  }
  const now = Date.now();
  const activePending = new Map();

  if (pendingMovesMap && pendingMovesMap.size > 0) {
    for (const [cardId, move] of pendingMovesMap.entries()) {
      const isExpired = !move.inFlight && (now - (move.completedAt || move.timestamp) >= 4000);
      if (!isExpired) {
        activePending.set(cardId, move);
      } else {
        pendingMovesMap.delete(cardId);
      }
    }
  }

  const activeConfirmed = new Map();
  if (confirmedMovesMap && confirmedMovesMap.size > 0) {
    for (const [cardId, confirmed] of confirmedMovesMap.entries()) {
      if (now - confirmed.confirmedAt < 5000) {
        activeConfirmed.set(cardId, confirmed);
      } else {
        confirmedMovesMap.delete(cardId);
      }
    }
  }

  if (activePending.size === 0 && activeConfirmed.size === 0) return serverData;

  const nextColumns = serverData.kanbanColumns.map((col) => {
    const colKey = col.automationKey || col.id;
    const filteredCards = (col.cards || []).filter((c) => {
      const pending = activePending.get(c.id);
      if (pending) {
        const targetMatches = pending.targetColumnKey === colKey
          || (pending.targetColObj && (pending.targetColObj.id === col.id || pending.targetColObj.automationKey === colKey));
        return targetMatches;
      }
      const confirmed = activeConfirmed.get(c.id);
      if (confirmed) {
        if (!c.salesRevision || (confirmed.salesRevision && c.salesRevision < confirmed.salesRevision) || (now - confirmed.confirmedAt < 4000)) {
          const targetMatches = confirmed.targetColumnKey === colKey
            || (confirmed.targetColObj && (confirmed.targetColObj.id === col.id || confirmed.targetColObj.automationKey === colKey));
          return targetMatches;
        }
      }
      return true;
    });

    for (const [cardId, pending] of activePending.entries()) {
      const targetMatches = pending.targetColumnKey === colKey
        || (pending.targetColObj && (pending.targetColObj.id === col.id || pending.targetColObj.automationKey === colKey));
      if (targetMatches && !filteredCards.some((c) => c.id === cardId)) {
        filteredCards.unshift({
          ...pending.card,
          stage: pending.targetStageLabel,
          targetColumnId: col.automationKey || pending.targetColumnKey,
        });
      }
    }

    for (const [cardId, confirmed] of activeConfirmed.entries()) {
      if (activePending.has(cardId)) continue;
      const targetMatches = confirmed.targetColumnKey === colKey
        || (confirmed.targetColObj && (confirmed.targetColObj.id === col.id || confirmed.targetColObj.automationKey === colKey));
      if (targetMatches && !filteredCards.some((c) => c.id === cardId)) {
        filteredCards.unshift({
          ...confirmed.card,
          stage: confirmed.targetStageLabel,
          targetColumnId: col.automationKey || confirmed.targetColumnKey,
          salesRevision: confirmed.salesRevision || confirmed.card?.salesRevision,
        });
      }
    }

    return { ...col, cards: filteredCards };
  });

  return { ...serverData, kanbanColumns: nextColumns };
}

function App() {
  const [active, setActive] = useState(getInitialActivePage);
  const [tenantSlug, setTenantSlug] = useState(getInitialTenantSlug);
  const [availableTenants, setAvailableTenants] = useState(() => {
    if (hasSupabaseConfig() || isAuthRequired()) return [];
    return mockTenants;
  });
  const [session, setSession] = useState(null);
  const [tenantAccess, setTenantAccess] = useState({ userId: null, loaded: false, error: '' });
  const [dataScope, setDataScope] = useState('');
  const [loadError, setLoadError] = useState('');
  const [checkingAuth, setCheckingAuth] = useState(isAuthRequired());
  const [loading, setLoading] = useState(false);
  const initialSetup = useMemo(() => getInitialAppData(getInitialTenantSlug()), []);
  const [appData, setAppData] = useState(initialSetup.data);
  const [appDataReady, setAppDataReady] = useState(initialSetup.ready);
  const [agentsReady, setAgentsReady] = useState(false);
  const appDataRef = useRef(appData);
  appDataRef.current = appData;

  const activeTenantSlug = tenantSlug || null;
  const selectedTenant = availableTenants.find((tenant) => tenant.slug === activeTenantSlug)
    || null;
  const integration = getIntegrationStatus(activeTenantSlug);
  const requiresTenantAuthorization = hasSupabaseConfig() || isAuthRequired();
  const hasTenantAccess = requiresTenantAuthorization
    ? isTenantAuthorized(session?.user?.id, tenantAccess, availableTenants, activeTenantSlug)
    : Boolean(activeTenantSlug && availableTenants.some((tenant) => tenant.slug === activeTenantSlug));
  const tenantSelectionError = !activeTenantSlug
    ? 'Selecione uma empresa autorizada para continuar.'
    : (tenantAccess.loaded && !availableTenants.some((tenant) => tenant.slug === activeTenantSlug)
      ? 'A empresa selecionada não está disponível para esta conta.'
      : '');
  const scopeKey = JSON.stringify([session?.user?.id || 'local', activeTenantSlug]);
  const currentScope = useRef(scopeKey);
  const kanbanMoveInFlightRef = useRef(new Set());
  const conversationViewRef = useRef({ canonicalKey: '', visible: false });
  const conversationReadTimersRef = useRef(new Map());
  currentScope.current = hasTenantAccess ? scopeKey : '';
  const allowedChannels = appData.enabledChannels || [];

  const [agentsList, setAgentsList] = useState([]);
  const [tenantSettings, setTenantSettings] = useState(null);
  const [initialConversationId, setInitialConversationId] = useState(null);
  const [prefilledAppointment, setPrefilledAppointment] = useState(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const refreshCoordinator = useMemo(() => createRefreshCoordinator(), []);

  const scheduleConversationRead = useCallback((conversation) => {
    const userId = session?.user?.id || null;
    const currentAppData = appDataRef.current;
    const tenantId = currentAppData?.tenantId;
    const latestEvent = getLatestReadableEvent(conversation);
    if (!tenantId || !userId || !conversation || !latestEvent?.eventId || !latestEvent?.createdAt) return;

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
      if (!previous || previous.tenantId !== tenantId) return previous;
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
      try {
        const persistedMarker = await markConversationRead({
          tenantId,
          channelType,
          externalConversationId,
          lastReadEventId: latestEvent.eventId,
        });
        if (!persistedMarker) return;
        setAppData((previous) => {
          if (!previous || previous.tenantId !== tenantId) return previous;
          const conversationReads = upsertConversationReadMarker(previous.conversationReads || [], persistedMarker);
          return {
            ...previous,
            conversationReads,
            conversations: applyConversationReadState(previous.conversations, conversationReads, tenantId, userId),
          };
        });
      } catch (error) {
        console.warn('Nao foi possivel salvar a leitura da conversa:', error.message || error);
        refreshData({ showLoading: false });
      }
    }, 180);
    conversationReadTimersRef.current.set(key, timer);
  }, [session?.user?.id]);

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
  }, [activeTenantSlug, session?.user?.id]);

  useEffect(() => {
    function handleGlobalKeyDown(e) {
      if (e.key === 'Escape' && mobileNavOpen) {
        setMobileNavOpen(false);
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [mobileNavOpen]);

  const handleSignOut = async () => {
    clearSessionBootstrapped();
    setAvailableTenants([]);
    setTenantAccess({ userId: null, loaded: false, error: '' });
    setDataScope('');
    setAppData(getInitialAppData('').data);
    setSession(null);
    clearTenantSlug();
    setTenantSlug(null);
    await signOut();
  };

  const handleOpenChatFromKanban = (conversationId) => {
    setInitialConversationId(conversationId);
    setActive('conversas');
  };

  const handleOpenAppointmentFromKanban = (card) => {
    setPrefilledAppointment({
      contactName: card.title || '',
      title: card.service || card.subtitle || 'Bronzeamento',
      notes: `Agendamento via Kanban (${card.stage || 'Qualificação'})`,
      selectedConversationId: card.externalConversationId || '',
    });
    setActive('agendamentos');
  };

  const handleMoveKanbanCard = async (card, targetColumnKey, targetColObj = null) => {
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
      kanbanColumns: appDataRef.current?.kanbanColumns || appData.kanbanColumns,
      tenantSettings,
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
      if (!prev?.kanbanColumns) return prev;
      const targetStageLabel = targetColObj?.title || getStageLabel(targetColumnKey, {
        kanbanColumns: prev.kanbanColumns,
        tenantSettings,
        tenantSlug: activeTenantSlug,
      });
      const isClosedTarget = targetColumnKey === 'finalizadas'
        || targetColumnKey === 'conversation_closed'
        || targetColObj?.automationKey === 'finalizadas'
        || targetColObj?.automationKey === 'conversation_closed'
        || targetStageLabel === 'Finalizada'
        || targetStageLabel === 'Finalizado';
      const isHumanTarget = targetColumnKey === 'sales_human'
        || targetColumnKey === 'com_humano'
        || targetColumnKey === 'conversas_humanos'
        || targetColumnKey === 'aguardando_humano'
        || targetStageLabel.toLowerCase().includes('humano');

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
            cards: sortKanbanCardsByConversationActivity([{
              ...card,
              stage: targetStageLabel,
              targetColumnId: col.automationKey || targetColumnKey,
            }, ...filteredCards]),
          };
        }
        return { ...col, cards: filteredCards };
      });

      const nextConversations = (prev.conversations || []).map((conv) => {
        const matches = conv.id === card.id
          || conv.id === card.conversationId
          || conv.id === `conv-${card.canonicalKey}`
          || (conv.canonicalKey && card.canonicalKey && conv.canonicalKey === card.canonicalKey)
          || (conv.normalizedExternalId && card.normalizedExternalId && conv.normalizedExternalId === card.normalizedExternalId)
          || (conv.externalConversationId && card.externalConversationId && conv.externalConversationId === card.externalConversationId);

        if (!matches) return conv;

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
          stage: targetStageLabel,
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
        setAppData((prev) => ({
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
            const matches = conv.id === card.id
              || conv.id === card.conversationId
              || conv.id === `conv-${card.canonicalKey}`
              || (conv.canonicalKey && card.canonicalKey && conv.canonicalKey === card.canonicalKey)
              || (conv.normalizedExternalId && card.normalizedExternalId && conv.normalizedExternalId === card.normalizedExternalId)
              || (conv.externalConversationId && card.externalConversationId && conv.externalConversationId === card.externalConversationId);
            if (!matches) return conv;
            return {
              ...conv,
              salesStageKey: persistedMove.salesStageKey || conv.salesStageKey,
              salesAiLocked: typeof persistedMove.salesAiLocked === 'boolean' ? persistedMove.salesAiLocked : conv.salesAiLocked,
            };
          }),
        }));
      }
    } catch (err) {
      console.warn('Falha ao salvar movimentação de card no banco:', err);
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
        const current = kanbanMoveInFlightRef.current.pendingMoves?.get(card.id);
        if (current && current.moveSeq === moveSeq) {
          kanbanMoveInFlightRef.current.pendingMoves.delete(card.id);
        }
      }, 2000);
    }
  };

  const handleKanbanOrderApplied = (orderedAutomationKeys) => {
    const positions = new Map(orderedAutomationKeys.map((key, index) => [key, index]));
    setAppData((prev) => ({
      ...prev,
      kanbanColumns: [...(prev?.kanbanColumns || [])]
        .map((column) => ({ ...column, position: positions.get(column.automationKey || column.id) }))
        .sort((left, right) => left.position - right.position),
    }));
  };

  const handleFinishConversationFromKanban = async (card) => {
    if (isGenesisSalesTenant(activeTenantSlug)) {
      try {
        await moveKanbanCard(activeTenantSlug, card, 'conversation_closed');
        refreshData({ showLoading: false });
      } catch (err) {
        console.warn('Falha ao encerrar conversa do Kanban:', err);
      }
      return;
    }
    handleMoveKanbanCard(card, 'finalizadas');
  };

  useEffect(() => {
    document.title = 'NORIA';
    try {
      localStorage.removeItem('magia:team-agents');
    } catch (e) { }
  }, []);

  useEffect(() => {
    let active = true;
    if (!hasTenantAccess) return undefined;
    setAgentsReady(false);
    setAgentsList([]);
    setTenantSettings(null);
    loadTeamAgents(activeTenantSlug)
      .then((list) => {
        if (active) {
          setAgentsList(list);
          setAgentsReady(true);
        }
      })
      .catch(() => {
        if (active) setAgentsReady(true);
      });
    loadTenantSettings(activeTenantSlug)
      .then((settings) => {
        if (active) setTenantSettings(settings);
      })
      .catch((err) => {
        console.warn('Falha ao carregar configuracoes do tenant:', err);
        if (active) setTenantSettings(null);
      });
    return () => {
      active = false;
    };
  }, [activeTenantSlug, session?.user?.id, hasTenantAccess]);

  async function handleAddAgent(newAgent) {
    const saved = await saveTeamAgent(activeTenantSlug, newAgent);
    setAgentsList((prev) => [saved, ...prev.filter((a) => a.id !== saved.id)]);
  }

  async function handleToggleAgentStatus(agentId) {
    const agent = agentsList.find((ag) => ag.id === agentId);
    const newStatus = agent?.status === 'online' ? 'standby' : 'online';
    setAgentsList((prev) => prev.map((ag) => ag.id === agentId ? { ...ag, status: newStatus } : ag));
    await updateTeamAgentStatus(agentId, newStatus, activeTenantSlug);
  }

  async function handleDeleteAgent(agentId) {
    setAgentsList((prev) => prev.filter((ag) => ag.id !== agentId));
    await removeTeamAgent(agentId, activeTenantSlug);
  }

  async function handleAssignAgent(conversationOrId, agent) {
    const selectedConversation = typeof conversationOrId === 'object'
      ? conversationOrId
      : (appDataRef.current?.conversations || []).find((conv) => conv.id === conversationOrId);
    const conversationId = selectedConversation?.id || conversationOrId;

    setAppData((prev) => {
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
          if (
            card.canonicalKey === selectedConversation?.canonicalKey
            || (selectedConversation?.normalizedExternalId && card.normalizedExternalId === selectedConversation.normalizedExternalId)
            || (selectedConversation?.externalConversationId && card.externalConversationId === selectedConversation.externalConversationId)
            || card.id === selectedConversation?.id
          ) {
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

    setAgentsList((prev) => prev.map((ag) => ag.id === agent.id ? { ...ag, load: (ag.load || 0) + 1 } : ag));

    if (!selectedConversation) return;
    try {
      if (isGenesisSalesTenant(activeTenantSlug)) {
        try {
          await moveKanbanCard(activeTenantSlug, selectedConversation, 'sales_human', agent.name);
        } catch (e) {
          console.warn('Falha ao sincronizar etapa Genesis com sales_human:', e.message || e);
        }
      }
      await sendN8nCommand('assign_conversation', {
        channel_type: selectedConversation.channelType || selectedConversation.channel?.toLowerCase(),
        external_conversation_id: selectedConversation.externalConversationId || selectedConversation.id.replace(/^conv-/, ''),
        contact_name: selectedConversation.contact,
        message_text: `Conversa atribuida a ${agent.name}`,
        sent_by_user: agent.name,
        assignee: {
          id: agent.id,
          name: agent.name,
          role: agent.role,
        },
      }, activeTenantSlug);
      await refreshData();
    } catch (error) {
      console.warn('Falha ao persistir atribuicao de conversa:', error.message || error);
    }
  }

  useEffect(() => {
    if (!isAuthRequired()) return undefined;
    let mounted = true;
    let authSeq = 0;
    const initialSeq = ++authSeq;
    getCurrentSession().then((currentSession) => {
      if (!mounted || authSeq !== initialSeq) return;
      setSession(currentSession);
      setCheckingAuth(false);
      if (currentSession) {
        setSessionBootstrapped();
      } else {
        clearSessionBootstrapped();
      }
    });
    const unsubscribe = subscribeToAuthState((nextSession, event) => {
      if (!mounted) return;
      authSeq += 1;
      if (event === 'SIGNED_OUT') {
        setSession(null);
        setCheckingAuth(false);
        clearSessionBootstrapped();
        return;
      }
      if (!nextSession) {
        setCheckingAuth(false);
        return;
      }
      setSession((prevSession) => {
        if (prevSession?.user?.id && nextSession?.user?.id && prevSession.user.id !== nextSession.user.id) {
          setTenantAccess({ userId: nextSession.user.id, loaded: false, error: '' });
          setAppDataReady(false);
        }
        if (
          prevSession?.access_token === nextSession?.access_token &&
          prevSession?.user?.id === nextSession?.user?.id
        ) {
          return prevSession;
        }
        return nextSession;
      });
      setCheckingAuth(false);
      setSessionBootstrapped();
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  async function refreshData({ showLoading = true } = {}) {
    if (!hasTenantAccess) return false;
    const requestedScope = scopeKey;
    return refreshCoordinator.run(requestedScope, async () => {
      if (showLoading) setLoading(true);
      try {
        const currentData = appDataRef.current;
        const data = await loadClientData({
          conversations: currentData?.conversations || [],
          kanbanColumns: currentData?.kanbanColumns || [],
          funnelStages: currentData?.funnelStages || [],
          appointments: currentData?.appointments || [],
          broadcastContacts: currentData?.broadcastContacts || [],
          broadcastCampaigns: currentData?.broadcastCampaigns || [],
          conversationReads: currentData?.conversationReads || [],
          tenantId: currentData?.tenantId || null,
        }, activeTenantSlug, session?.user?.id || null);
        if (currentScope.current !== requestedScope) return false;
        setLoadError('');
        const reconciled = preserveLocalMediaStates(
          appDataRef.current,
          reconcilePendingKanbanMoves(
            data,
            kanbanMoveInFlightRef.current.pendingMoves,
            kanbanMoveInFlightRef.current.confirmedMoves
          ),
        );
        cacheAppData(activeTenantSlug, reconciled, session?.user?.id || null);
        setAppData((previous) => (
          appDataSignature(previous) === appDataSignature(reconciled) ? previous : reconciled
        ));
        return true;
      } catch (error) {
        if (currentScope.current === requestedScope) setLoadError(userFacingError(error, 'Falha ao carregar os dados.'));
        return false;
      } finally {
        if (currentScope.current === requestedScope) {
          setAppDataReady(true);
          if (showLoading) setLoading(false);
        }
      }
    });
  }

  const updateConversationMessageMedia = useCallback((eventId, nextMedia) => {
    if (!eventId || !nextMedia) return;
    setAppData((previous) => {
      if (!previous?.conversations) return previous;
      let changed = false;
      const conversationsWithMedia = previous.conversations.map((conversation) => {
        if (!(conversation.messages || []).some((message) => message.eventId === eventId)) return conversation;
        changed = true;
        const messages = (conversation.messages || []).map((message) => {
          if (message.eventId !== eventId) return message;
          return { ...message, media: { ...(message.media || {}), ...nextMedia } };
        });
        return { ...conversation, messages };
      });
      return changed ? { ...previous, conversations: conversationsWithMedia } : previous;
    });
  }, []);

  const retryConversationMedia = useCallback(async (message) => {
    const media = message?.media;
    if (!message?.eventId || !media?.bucket || !media?.storagePath || media.status !== 'stored') return false;

    updateConversationMessageMedia(message.eventId, { loadState: 'resolving' });
    const retryEvent = {
      id: message.eventId,
      raw_payload: { media: { ...media, url: '' } },
    };
    const enriched = await enrichSingleMediaEvent(retryEvent, undefined, { force: true });
    if (hasResolvedMediaUrl(enriched)) {
      updateConversationMessageMedia(message.eventId, {
        ...enriched.raw_payload.media,
        loadState: '',
      });
      return true;
    }

    updateConversationMessageMedia(message.eventId, { loadState: 'retryable_error' });
    return false;
  }, [updateConversationMessageMedia]);

  const reloadTenants = useCallback(async () => {
    if (isAuthRequired() && !session) return;
    const userId = session?.user?.id || null;
    setTenantAccess({ userId, loaded: false, error: '' });
    try {
      const tenantsFromDb = await loadAvailableTenants(mockTenants);
      const validTenants = Array.isArray(tenantsFromDb) ? tenantsFromDb : [];
      setAvailableTenants(validTenants);
      setTenantAccess({ userId, loaded: true, error: '' });

      setTenantSlug((prevSlug) => {
        if (prevSlug && validTenants.some((t) => t.slug === prevSlug)) {
          persistTenantSlug(prevSlug);
          return prevSlug;
        }
        const storedSlug = getInitialTenantSlug();
        if (storedSlug && validTenants.some((t) => t.slug === storedSlug)) {
          persistTenantSlug(storedSlug);
          return storedSlug;
        }
        if (validTenants.length > 0) {
          const envSlug = typeof import.meta !== 'undefined' && import.meta.env?.VITE_TENANT_SLUG;
          const preferred = (envSlug && validTenants.find((t) => t.slug === envSlug)) || validTenants[0];
          persistTenantSlug(preferred.slug);
          return preferred.slug;
        }
        clearTenantSlug();
        return null;
      });
    } catch (error) {
      setAvailableTenants([]);
      setTenantAccess({ userId, loaded: true, error: userFacingError(error, 'Erro ao carregar empresas') });
    }
  }, [session?.user?.id]);

  useEffect(() => {
    reloadTenants();
  }, [reloadTenants]);

  useEffect(() => {
    localStorage.setItem(activePageStorageKey, active);
  }, [active]);

  useEffect(() => {
    if (!hasTenantAccess) return undefined;
    const userId = session?.user?.id || null;
    setDataScope(scopeKey);
    setLoadError('');
    persistTenantSlug(activeTenantSlug);
    const cached = loadCachedAppData(activeTenantSlug, userId);
    if (cached) {
      setAppData(cached);
      setAppDataReady(true);
    } else {
      setAppData(getInitialAppData(activeTenantSlug).data);
      setAppDataReady(false);
    }
    refreshData({ showLoading: false });

    const refreshFromRealtime = createDebouncedRealtimeRefresh(() => {
      refreshData({ showLoading: false });
    });

    let cancelled = false;

    const applyRealtimeEvent = (incomingEvent) => {
      const incomingConversationKey = canonicalConversationKey(
        incomingEvent.channel_type,
        incomingEvent.external_conversation_id,
        incomingEvent.contact_handle || incomingEvent.id,
        activeTenantSlug,
      );
      const markIncomingAsRead = conversationViewRef.current.visible
        && conversationViewRef.current.canonicalKey === incomingConversationKey;
      setAppData((prev) => {
        if (!prev) return prev;
        const nextConversations = applyIncomingEventToConversations(
          prev.conversations,
          incomingEvent,
          activeTenantSlug,
          {
            markIncomingAsRead,
            kanbanColumns: prev.kanbanColumns,
            tenantSettings,
            teamAgents: prev.teamAgents,
          },
        );
        const nextKanbanColumns = applyIncomingEventToKanban(
          prev.kanbanColumns,
          incomingEvent,
          activeTenantSlug,
        );
        return {
          ...prev,
          conversations: nextConversations,
          kanbanColumns: nextKanbanColumns,
        };
      });
    };

    const recoverRealtimeMedia = async (event) => {
      for (let attempt = 0; attempt < mediaRetryDelays.length; attempt += 1) {
        const delay = mediaRetryDelays[attempt];
        if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay));
        if (cancelled) return;

        const enriched = await enrichSingleMediaEvent(event);
        if (cancelled) return;
        if (hasResolvedMediaUrl(enriched)) {
          applyRealtimeEvent(withLocalMediaLoadState(enriched));
          return;
        }
      }
      if (!cancelled) applyRealtimeEvent(withLocalMediaLoadState(event, 'retryable_error'));
    };

    const unsubscribe = subscribeToClientEvents(async (payload) => {
      window.dispatchEvent(new CustomEvent('noria:operator-event', { detail: {
        tenantId: appDataRef.current?.tenantId, userId, payload,
      } }));
      if (payload?.table === 'channel_events' && payload?.new) {
        const incomingEvent = payload.new;
        const isStoredMediaWaitingForUrl = hasStoredMediaNeedingUrl(incomingEvent);
        applyRealtimeEvent(isStoredMediaWaitingForUrl
          ? withLocalMediaLoadState(incomingEvent, 'resolving')
          : incomingEvent);

        if (isStoredMediaWaitingForUrl) {
          void recoverRealtimeMedia(incomingEvent);
        }

        if (shouldRefreshConversationState(incomingEvent)) {
          refreshFromRealtime();
        }
      } else {
        refreshFromRealtime();
      }
    }, activeTenantSlug, appDataRef.current?.tenantId);

    const unsubscribeConversationReads = subscribeToConversationReads((payload) => {
      const marker = payload?.new;
      if (!marker?.tenant_id || !marker?.user_id) {
        refreshFromRealtime();
        return;
      }
      setAppData((prev) => {
        if (!prev || marker.tenant_id !== prev.tenantId || marker.user_id !== userId) return prev;
        const conversationReads = upsertConversationReadMarker(prev.conversationReads || [], marker);
        return {
          ...prev,
          conversationReads,
          conversations: applyConversationReadState(prev.conversations, conversationReads, prev.tenantId, userId),
        };
      });
    }, userId);

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible'
        && refreshCoordinator.shouldRefreshOnVisibility(scopeKey)) {
        refreshData({ showLoading: false });
      }
    };
    const refreshCatalogAfterWrite = (event) => {
      refreshFromRealtime();
    };
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('noria:catalog-cache-updated', refreshCatalogAfterWrite);
    // O Realtime é o mecanismo primário. Mantemos um fallback pouco frequente
    // para tabelas ainda não cobertas pela subscription. Enquanto a aba estiver
    // oculta, não acumulamos uma carga completa para executar ao retornar.
    const fallbackPolling = window.setInterval(() => {
      if (document.visibilityState === 'visible') refreshData({ showLoading: false });
    }, VISIBILITY_REFRESH_STALE_AFTER_MS);

    return () => {
      cancelled = true;
      unsubscribe();
      unsubscribeConversationReads();
      refreshFromRealtime.cancel();
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('noria:catalog-cache-updated', refreshCatalogAfterWrite);
      window.clearInterval(fallbackPolling);
    };
  }, [activeTenantSlug, session?.user?.id, hasTenantAccess]);

  const activeSubscriptionTenantId = appData?.tenantId;
  useEffect(() => {
    if (!activeSubscriptionTenantId) return undefined;

    return subscribeToContacts((payload) => {
      const contact = payload?.new;
      if (!contact || contact.tenant_id !== activeSubscriptionTenantId) return;
      setAppData((prev) => {
        if (!prev || prev.tenantId !== activeSubscriptionTenantId) return prev;
        return {
          ...prev,
          conversations: applyContactUpdateToConversations(prev.conversations, contact, activeSubscriptionTenantId),
        };
      });
    }, activeSubscriptionTenantId);
  }, [activeSubscriptionTenantId]);

  const hasBootstrapped = isSessionBootstrapped();
  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const authPreviewMode = urlParams?.get('auth');
  const showHome = !urlParams?.get('app') && !authPreviewMode;

  if (showHome) {
    return <HomePage />;
  }

  if (authPreviewMode === 'loading' || checkingAuth) {
    return <AuthShell title="Carregando NORIA..." />;
  }

  if (authPreviewMode === 'login' || authPreviewMode === '1' || (isAuthRequired() && !checkingAuth && !session)) {
    return <LoginPage />;
  }

  if (isAuthRequired() && (!tenantAccess.loaded || tenantAccess.userId !== session?.user?.id)) {
    return <AuthShell title="Verificando acesso..." />;
  }
  if (!hasTenantAccess) {
    if (tenantAccess.error) {
      return (
        <AuthShell
          title="Erro ao verificar acesso"
          description={tenantAccess.error}
        >
          <div className="auth-loading-actions">
            <button className="primary-button" type="button" onClick={reloadTenants}>
              <RefreshCcw size={15} /> Tentar novamente
            </button>
            <button className="secondary-button" type="button" onClick={handleSignOut}>
              <LogOut size={15} /> Sair
            </button>
          </div>
        </AuthShell>
      );
    }

    if (tenantAccess.loaded && availableTenants.length === 0) {
      return (
        <AuthShell
          title="Nenhuma empresa vinculada a esta conta"
          description={`A conta ${session?.user?.email ? `(${session.user.email}) ` : ''}está autenticada, mas não possui nenhuma empresa ativa associada no banco de dados.`}
        >
          <div className="auth-loading-actions">
            <button className="secondary-button" type="button" onClick={reloadTenants}>
              <RefreshCcw size={15} /> Verificar novamente
            </button>
            <button className="secondary-button" type="button" onClick={handleSignOut}>
              <LogOut size={15} /> Sair
            </button>
          </div>
        </AuthShell>
      );
    }

    return (
      <AuthShell
        title="Selecione uma empresa autorizada para continuar"
        description="Escolha a empresa vinculada à sua conta para acessar o sistema:"
      >
        <div className="auth-tenant-selector">
          <NoriaSelect
            value={activeTenantSlug || availableTenants[0]?.slug}
            onValueChange={(val) => {
              setTenantSlug(val);
              persistTenantSlug(val);
            }}
            options={availableTenants.map((t) => ({
              value: t.slug,
              label: t.name,
            }))}
            icon={Building2}
            placeholder="Selecione uma empresa"
            ariaLabel="Selecione uma empresa"
          />
          <div className="auth-loading-actions">
            <button
              className="primary-button"
              type="button"
              onClick={() => {
                const targetSlug = activeTenantSlug || availableTenants[0]?.slug;
                if (targetSlug) {
                  setTenantSlug(targetSlug);
                  persistTenantSlug(targetSlug);
                }
              }}
            >
              Acessar empresa
            </button>
            <button className="secondary-button" type="button" onClick={handleSignOut}>
              <LogOut size={15} /> Sair
            </button>
          </div>
        </div>
      </AuthShell>
    );
  }
  if (dataScope !== scopeKey) return <AuthShell title="Carregando empresa..." />;

  return (
    <div className="app-shell">
      <AppNavigation
        active={active}
        menu={menu}
        mobileNavOpen={mobileNavOpen}
        onCloseMobileNav={() => setMobileNavOpen(false)}
        onSelectPage={setActive}
        selectedTenant={selectedTenant}
      />

      <main className="main" data-page={active} style={{ position: 'relative' }}>
        <div className={`refresh-progress-bar ${loading ? 'active' : ''}`} />
        {loadError && <div className="inline-error" role="alert">{loadError}</div>}
        <AppTopbar
          active={active}
          activeTenantSlug={activeTenantSlug}
          availableTenants={availableTenants}
          handleSignOut={handleSignOut}
          isAuthRequired={isAuthRequired}
          loading={loading}
          menu={menu}
          mobileNavOpen={mobileNavOpen}
          onOpenMobileNav={() => setMobileNavOpen(true)}
          refreshData={refreshData}
          selectedTenant={selectedTenant}
          setTenantSlug={setTenantSlug}
          notificationTenantId={hasTenantAccess ? appData.tenantId : null}
          notificationUserId={session?.user?.id || null}
          notificationConversations={appData.conversations}
          notificationAppointments={appData.appointments}
          notificationKanbanColumns={appData.kanbanColumns}
          onOpenNotificationPage={setActive}
          onOpenNotificationConversation={handleOpenChatFromKanban}
        />

        {active === 'dashboard' && (
          <Dashboard
            conversations={appData.conversations}
            dataSource={appData.source}
            status={appData.status}
            ready={appDataReady}
            onOpenConversation={handleOpenChatFromKanban}
            kanbanColumns={appData.kanbanColumns}
            tenantSettings={tenantSettings}
            tenantSlug={activeTenantSlug}
          />
        )}
        {active === 'conversas' && (
          <Conversations
            allowedChannels={allowedChannels}
            conversations={appData.conversations}
            tenantSlug={activeTenantSlug}
            onSent={refreshData}
            agentsList={agentsList}
            agentsReady={agentsReady}
            onAssignAgent={handleAssignAgent}
            initialConversationId={initialConversationId}
            onInitialConversationOpened={() => setInitialConversationId(null)}
            onNavigateSettings={() => setActive('configuracoes')}
            onConversationViewStateChange={handleConversationViewStateChange}
            onRetryAudioMedia={retryConversationMedia}
            ready={appDataReady}
            kanbanColumns={appData.kanbanColumns}
            tenantSettings={tenantSettings}
          />
        )}
        {active === 'kanban' && (
          <Kanban
            allowedChannels={allowedChannels}
            kanbanColumns={appData.kanbanColumns}
            tenantName={selectedTenant?.name || ''}
            agentsList={agentsList}
            tenantSlug={activeTenantSlug}
            tenantSettings={tenantSettings}
            onChanged={refreshData}
            onOpenChat={handleOpenChatFromKanban}
            onOpenAppointment={handleOpenAppointmentFromKanban}
            onMoveCard={handleMoveKanbanCard}
            onOrderApplied={handleKanbanOrderApplied}
            onFinishConversation={handleFinishConversationFromKanban}
            ready={appDataReady}
          />
        )}
        {active === 'funil' && <Funnel funnelStages={appData.funnelStages} tenantName={selectedTenant?.name || ''} ready={appDataReady} />}
        {active === 'disparos' && (
          <Broadcasts
            allowedChannels={allowedChannels}
            conversations={appData.conversations}
            contacts={appData.broadcastContacts || []}
            campaigns={appData.broadcastCampaigns || []}
            tenantSlug={activeTenantSlug}
            onChanged={refreshData}
            ready={appDataReady}
          />
        )}
        {active === 'agendamentos' && (
          <Appointments
            appointments={appData.appointments || []}
            conversations={appData.conversations}
            tenantSlug={activeTenantSlug}
            onChanged={refreshData}
            initialData={prefilledAppointment}
            ready={appDataReady}
          />
        )}
        {active === 'configuracoes' && (
          <SettingsPage
            allowedChannels={allowedChannels}
            agents={agentsList}
            agentsReady={agentsReady}
            onAddAgent={handleAddAgent}
            onToggleAgentStatus={handleToggleAgentStatus}
            onDeleteAgent={handleDeleteAgent}
            tenant={selectedTenant}
            tenantName={selectedTenant?.name || ''}
            tenantSettings={tenantSettings}
            tenantSlug={activeTenantSlug}
            integration={integration}
          />
        )}
      </main>
    </div>
  );
}

export { App, menu };
export default App;

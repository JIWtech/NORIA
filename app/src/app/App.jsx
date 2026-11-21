import { userFacingError } from '../utils/userFacingError.js';
import React, { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
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
import { getIntegrationStatus } from '../services/integration.js';
import {
  applyContactUpdateToConversations,
  applyConversationReadState,
  applyIncomingEventToConversations,
  applyIncomingEventToKanban,
  canonicalConversationKey,
  createDebouncedRealtimeRefresh,
  enrichSingleMediaEvent,
  getInitialTenantSlug,
  hasStoredMediaNeedingUrl,
  hasSupabaseConfig,
  loadAvailableTenants,
  loadClientData,
  loadTeamAgents,
  loadTenantSettings,
  persistTenantSlug,
  removeTeamAgent,
  saveTeamAgent,
  shouldRefreshConversationState,
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
import { realtimeRefreshTargets, selectPartialRefresh, mergeCampaignPatch } from '../services/timeline/realtimeRefreshTargets.js';
import { Dashboard } from '../features/dashboard/components/Dashboard';
import { Funnel } from '../features/kanban/components/Funnel';
import { Conversations } from '../features/conversations/components/Conversations';
import { Kanban } from '../features/kanban/components/Kanban';
import { Broadcasts } from '../features/broadcasts/components/Broadcasts';
import { Appointments } from '../features/appointments/components/Appointments';
import { isOutcomeTrackingEnabled } from '../services/appointments/appointmentOutcome.js';
import { clearTenantScopedCaches, tenantCacheEpoch } from '../services/tenants/tenantScopedCaches.js';
import { reconcilePendingKanbanMoves } from '../services/kanban/pendingKanbanMoves.js';
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
  clearAppDataCache,
  clearSessionBootstrapped,
  createEmptyAppData,
  getInitialActivePage,
  getInitialAppData,
  isSessionBootstrapped,
  loadCachedAppData,
  setSessionBootstrapped,
} from './appStorage';
import {
  buildScopeKey,
  isSameScope,
  resourceErrorsForPage,
  selectScopedAppData,
  withScopeKey,
} from './appScope';
import { AppNavigation } from './AppNavigation';
import { AppTopbar } from './AppTopbar';
import { useKanbanMutations } from './hooks/useKanbanMutations';
import { useAgentAssignment } from './hooks/useAgentAssignment';
import { useConversationReadTracker } from './hooks/useConversationReadTracker';

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
  const [showOlderConversations, setShowOlderConversations] = useState(false);
  const includeOlderConversationsRef = useRef(false);

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
  const scopeKey = buildScopeKey(session?.user?.id, activeTenantSlug);
  const currentScope = useRef(scopeKey);
  const fullyLoadedScope = useRef('');
  currentScope.current = hasTenantAccess ? scopeKey : '';
  const emptyScopedData = useMemo(() => createEmptyAppData(), []);
  const { data: scopedData, ready: scopedReady } = selectScopedAppData(appData, appDataReady, scopeKey, emptyScopedData);
  const allowedChannels = scopedData.enabledChannels || [];

  const [agentsList, setAgentsList] = useState([]);
  const [tenantSettings, setTenantSettings] = useState(null);
  const [initialConversationId, setInitialConversationId] = useState(null);
  const [notificationCard, setNotificationCard] = useState(null);
  const [prefilledAppointment, setPrefilledAppointment] = useState(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const refreshCoordinator = useMemo(() => createRefreshCoordinator(), []);
  const scopedTenantSettings = tenantSettings?.scopeKey === scopeKey ? tenantSettings : null;
  const isCacheSnapshot = scopedReady && scopedData.source === 'cache';
  const pageResourceErrors = resourceErrorsForPage(scopedData.resourceErrors, active);

  const {
    kanbanMoveInFlightRef,
    clearKanbanMovesInFlight,
    handleMoveKanbanCard,
    handleKanbanOrderApplied,
    handleFinishConversationFromKanban,
  } = useKanbanMutations({
    activeTenantSlug,
    currentScope,
    appDataRef,
    scopedKanbanColumns: scopedData.kanbanColumns,
    scopedTenantSettings,
    setAppData,
    refreshData,
  });

  const {
    conversationViewRef,
    handleConversationViewStateChange,
    resetConversationReadTracker,
  } = useConversationReadTracker({
    activeTenantSlug,
    sessionUserId: session?.user?.id || null,
    currentScope,
    appDataRef,
    setAppData,
    refreshData,
  });

  const { handleAssignAgent } = useAgentAssignment({
    activeTenantSlug,
    currentScope,
    appDataRef,
    scopedTenantSettings,
    setAppData,
    setAgentsList,
    refreshData,
  });

  const handleTenantChange = useCallback((nextSlug) => {
    if (!nextSlug || nextSlug === activeTenantSlug) return;
    persistTenantSlug(nextSlug);
    fullyLoadedScope.current = '';
    clearKanbanMovesInFlight();
    resetConversationReadTracker();
    setAppDataReady(false);
    setInitialConversationId(null);
    setNotificationCard(null);
    setPrefilledAppointment(null);
    setLoadError('');
    setAgentsReady(false);
    setAgentsList([]);
    setTenantSettings(null);
    setTenantSlug(nextSlug);
  }, [activeTenantSlug, clearKanbanMovesInFlight, resetConversationReadTracker]);

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
    clearAppDataCache();
    clearTenantScopedCaches();
    clearKanbanMovesInFlight();
    fullyLoadedScope.current = '';
    resetConversationReadTracker();
    setAvailableTenants([]);
    setTenantAccess({ userId: null, loaded: false, error: '' });
    setDataScope('');
    setAppData(createEmptyAppData());
    setAppDataReady(false);
    setAgentsReady(false);
    setAgentsList([]);
    setTenantSettings(null);
    setInitialConversationId(null);
    setNotificationCard(null);
    setPrefilledAppointment(null);
    setSession(null);
    clearTenantSlug();
    setTenantSlug(null);
    await signOut();
  };

  const handleSelectPage = useCallback((nextPage) => {
    startTransition(() => {
      setActive((current) => (current === nextPage ? current : nextPage));
    });
  }, []);

  const handleCloseMobileNav = useCallback(() => setMobileNavOpen(false), []);
  const handleOpenMobileNav = useCallback(() => setMobileNavOpen(true), []);

  const handleOpenChatFromKanban = useCallback((conversationId) => {
    setInitialConversationId(conversationId);
    startTransition(() => setActive('conversas'));
  }, []);

  const handleOpenAppointmentFromKanban = useCallback((card) => {
    const channelType = card.channelType || '';
    const externalConversationId = card.externalConversationId || '';
    setPrefilledAppointment({
      contactName: card.title || '',
      title: card.service || card.subtitle || 'Atendimento inicial',
      notes: `Agendamento via Kanban (${card.stage || 'Qualificação'})`,
      selectedConversationId: card.canonicalKey || externalConversationId,
      channelType,
      externalConversationId,
    });
    startTransition(() => setActive('agendamentos'));
  }, []);

  const handleOpenNotificationCard = useCallback((cardId) => {
    setNotificationCard({ scopeKey, cardId });
    startTransition(() => setActive('kanban'));
  }, [scopeKey]);

  useEffect(() => {
    document.title = 'NORIA';
    try {
      localStorage.removeItem('magia:team-agents');
    } catch (e) { }
  }, []);

  useEffect(() => {
    let active = true;
    if (!hasTenantAccess) return undefined;
    const requestedScope = scopeKey;
    setAgentsReady(false);
    setAgentsList([]);
    setTenantSettings(null);
    loadTeamAgents(activeTenantSlug)
      .then((list) => {
        if (active && isSameScope(currentScope.current, requestedScope)) {
          setAgentsList(list);
          setAppData((prev) => (prev && prev.scopeKey === requestedScope ? { ...prev, teamAgents: list } : prev));
          setAgentsReady(true);
        }
      })
      .catch(() => {
        if (active && isSameScope(currentScope.current, requestedScope)) setAgentsReady(true);
      });
    loadTenantSettings(activeTenantSlug)
      .then((settings) => {
        if (active && isSameScope(currentScope.current, requestedScope)) {
          setTenantSettings(settings ? { ...settings, scopeKey: requestedScope } : null);
        }
      })
      .catch((err) => {
        console.warn('Falha ao carregar configurações do tenant:', err);
        if (active && isSameScope(currentScope.current, requestedScope)) setTenantSettings(null);
      });
    return () => {
      active = false;
    };
  }, [activeTenantSlug, session?.user?.id, hasTenantAccess]);

  async function handleAddAgent(newAgent) {
    const requestedScope = currentScope.current;
    const saved = await saveTeamAgent(activeTenantSlug, newAgent);
    if (!isSameScope(currentScope.current, requestedScope)) return;
    setAgentsList((prev) => [saved, ...prev.filter((a) => a.id !== saved.id)]);
    setAppData((prev) => (prev && prev.scopeKey === requestedScope
      ? { ...prev, teamAgents: [saved, ...(prev.teamAgents || []).filter((a) => a.id !== saved.id)] }
      : prev));
  }

  async function handleToggleAgentStatus(agentId) {
    const requestedScope = currentScope.current;
    const agent = agentsList.find((ag) => ag.id === agentId);
    const newStatus = agent?.status === 'online' ? 'standby' : 'online';
    setAgentsList((prev) => prev.map((ag) => ag.id === agentId ? { ...ag, status: newStatus } : ag));
    setAppData((prev) => (prev && prev.scopeKey === requestedScope
      ? { ...prev, teamAgents: (prev.teamAgents || []).map((ag) => ag.id === agentId ? { ...ag, status: newStatus } : ag) }
      : prev));
    await updateTeamAgentStatus(agentId, newStatus, activeTenantSlug);
    if (!isSameScope(currentScope.current, requestedScope)) return;
  }

  async function handleDeleteAgent(agentId) {
    const requestedScope = currentScope.current;
    setAgentsList((prev) => prev.filter((ag) => ag.id !== agentId));
    setAppData((prev) => (prev && prev.scopeKey === requestedScope
      ? { ...prev, teamAgents: (prev.teamAgents || []).filter((ag) => ag.id !== agentId) }
      : prev));
    await removeTeamAgent(agentId, activeTenantSlug);
    if (!isSameScope(currentScope.current, requestedScope)) return;
  }

  useEffect(() => {
    if (!isAuthRequired()) return undefined;
    let mounted = true;
    let authSeq = 0;
    let currentUserId = null;
    const initialSeq = ++authSeq;
    getCurrentSession().then((currentSession) => {
      if (!mounted || authSeq !== initialSeq) return;
      currentUserId = currentSession?.user?.id || null;
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
        currentUserId = null;
        clearAppDataCache();
        clearTenantScopedCaches();
        clearKanbanMovesInFlight();
        fullyLoadedScope.current = '';
        resetConversationReadTracker();
        setAvailableTenants([]);
        setTenantAccess({ userId: null, loaded: false, error: '' });
        setDataScope('');
        setAppData(createEmptyAppData());
        setAppDataReady(false);
        setAgentsReady(false);
        setAgentsList([]);
        setTenantSettings(null);
        setInitialConversationId(null);
        setNotificationCard(null);
        setPrefilledAppointment(null);
        setSession(null);
        setCheckingAuth(false);
        clearSessionBootstrapped();
        return;
      }
      if (!nextSession) {
        setCheckingAuth(false);
        return;
      }
      const nextUserId = nextSession?.user?.id || null;
      if (currentUserId && nextUserId && currentUserId !== nextUserId) {
        clearAppDataCache();
        clearTenantScopedCaches();
        clearKanbanMovesInFlight();
        fullyLoadedScope.current = '';
        resetConversationReadTracker();
        setDataScope('');
        setTenantAccess({ userId: nextUserId, loaded: false, error: '' });
        setAppData(createEmptyAppData());
        setAppDataReady(false);
        setAgentsReady(false);
        setAgentsList([]);
        setTenantSettings(null);
        setInitialConversationId(null);
        setNotificationCard(null);
        setPrefilledAppointment(null);
      }
      currentUserId = nextUserId;
      setSession((prevSession) => {
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

  function toggleOlderConversations() {
    const next = !includeOlderConversationsRef.current;
    includeOlderConversationsRef.current = next;
    setShowOlderConversations(next);
    void refreshData({ showLoading: false });
  }

  async function refreshData({ showLoading = true, resources } = {}) {
    if (!hasTenantAccess) return false;
    const requestedScope = scopeKey;
    const requestedEpoch = tenantCacheEpoch();
    const isCurrentRequest = () => tenantCacheEpoch() === requestedEpoch && isSameScope(currentScope.current, requestedScope);
    return refreshCoordinator.run(requestedScope, async (requestedResources) => {
      if (!isCurrentRequest()) return false;
      if (showLoading) setLoading(true);
      try {
        const currentData = appDataRef.current?.scopeKey === requestedScope ? appDataRef.current : null;
        const partialResources = selectPartialRefresh(requestedResources, currentData, fullyLoadedScope.current, requestedScope);
        const expectedTenantId = currentData?.tenantId;
        const currentTeamAgents = Array.isArray(currentData?.teamAgents) && currentData.teamAgents.length
          ? currentData.teamAgents
          : agentsList;
        const data = await loadClientData({
          conversations: currentData?.conversations || [],
          kanbanColumns: currentData?.kanbanColumns || [],
          funnelStages: currentData?.funnelStages || [],
          appointments: currentData?.appointments || [],
          broadcastContacts: currentData?.broadcastContacts || [],
          broadcastCampaigns: currentData?.broadcastCampaigns || [],
          conversationReads: currentData?.conversationReads || [],
          teamAgents: currentTeamAgents,
          tenantId: currentData?.tenantId || null,
        }, activeTenantSlug, session?.user?.id || null, {
          ...(partialResources ? { resources: partialResources } : {}),
          teamAgents: currentTeamAgents,
          // Conversas sem atividade há mais de 30 dias só entram quando a pessoa pede (desempenho em tenants grandes).
          includeOlderConversations: includeOlderConversationsRef.current,
        });
        if (!isCurrentRequest()) return false;
        if (partialResources) {
          if (!mergeCampaignPatch(appDataRef.current, data, expectedTenantId)) return false;
          setLoadError('');
          setAppData((previous) => {
            if (!isCurrentRequest() || previous?.scopeKey !== requestedScope || previous?.tenantId !== expectedTenantId) return previous;
            const merged = withScopeKey(mergeCampaignPatch(previous, data, expectedTenantId), requestedScope);
            if (!merged) return previous;
            cacheAppData(activeTenantSlug, merged, session?.user?.id || null);
            return appDataSignature(previous) === appDataSignature(merged) ? previous : merged;
          });
          return true;
        }
        setLoadError('');
        const previousForScope = appDataRef.current?.scopeKey === requestedScope ? appDataRef.current : null;
        const reconciled = withScopeKey(
          preserveLocalMediaStates(
            previousForScope,
            reconcilePendingKanbanMoves(
              data,
              kanbanMoveInFlightRef.current.pendingMoves,
              kanbanMoveInFlightRef.current.confirmedMoves
            ),
          ),
          requestedScope,
        );
        if (!reconciled.resourceErrors?.length) {
          cacheAppData(activeTenantSlug, reconciled, session?.user?.id || null);
        } else if (previousForScope?.source === 'cache') {
          reconciled.source = 'cache';
        }
        // A fila pode continuar antes do próximo render; publique o mesmo snapshot
        // usado pelo estado antes de permitir uma recarga parcial desse escopo.
        appDataRef.current = reconciled;
        fullyLoadedScope.current = reconciled.resourceErrors?.length ? '' : requestedScope;
        if (!reconciled.resourceErrors?.length) refreshCoordinator.markFresh(requestedScope);
        setAppData((previous) => (
          previous?.scopeKey === requestedScope && appDataSignature(previous) === appDataSignature(reconciled)
            ? previous
            : reconciled
        ));
        return true;
      } catch (error) {
        if (isCurrentRequest()) setLoadError(userFacingError(error, 'Falha ao carregar os dados.'));
        return false;
      } finally {
        if (isCurrentRequest()) {
          setAppDataReady(true);
          if (showLoading) setLoading(false);
        }
      }
    }, resources);
  }

  const updateConversationMessageMedia = useCallback((eventId, nextMedia, expectedScope = null) => {
    if (!eventId || !nextMedia) return;
    setAppData((previous) => {
      if (!previous?.conversations) return previous;
      if (expectedScope && previous.scopeKey !== expectedScope) return previous;
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
    const requestedScope = currentScope.current;
    const media = message?.media;
    if (!requestedScope || !message?.eventId || !media?.bucket || !media?.storagePath || media.status !== 'stored') return false;

    updateConversationMessageMedia(message.eventId, { loadState: 'resolving' }, requestedScope);
    const retryEvent = {
      id: message.eventId,
      raw_payload: { media: { ...media, url: '' } },
    };
    const enriched = await enrichSingleMediaEvent(retryEvent, undefined, { force: true });
    if (!isSameScope(currentScope.current, requestedScope)) return false;
    if (hasResolvedMediaUrl(enriched)) {
      updateConversationMessageMedia(message.eventId, {
        ...enriched.raw_payload.media,
        loadState: '',
      }, requestedScope);
      return true;
    }

    updateConversationMessageMedia(message.eventId, { loadState: 'retryable_error' }, requestedScope);
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
    fullyLoadedScope.current = '';
    setDataScope(scopeKey);
    setLoadError('');
    persistTenantSlug(activeTenantSlug);
    const cached = loadCachedAppData(activeTenantSlug, userId);
    if (cached) {
      const scopedCached = withScopeKey(cached, scopeKey);
      appDataRef.current = scopedCached;
      setAppData(scopedCached);
      setAppDataReady(true);
    } else if (!hasSupabaseConfig()) {
      const mockInitial = withScopeKey(getInitialAppData(activeTenantSlug).data, scopeKey);
      appDataRef.current = mockInitial;
      setAppData(mockInitial);
      setAppDataReady(true);
    } else {
      const empty = createEmptyAppData();
      appDataRef.current = empty;
      setAppData(empty);
      setAppDataReady(false);
    }
    refreshData({ showLoading: false });
  }, [activeTenantSlug, session?.user?.id, hasTenantAccess]);

  useEffect(() => {
    if (!hasTenantAccess || dataScope !== scopeKey || !scopedData?.tenantId) return undefined;
    const userId = session?.user?.id || null;
    const requestedScope = scopeKey;
    const subscribedTenantId = scopedData?.tenantId;

    const refreshFromRealtime = createDebouncedRealtimeRefresh((resources) => {
      if (!isSameScope(currentScope.current, requestedScope)) return;
      refreshData({ showLoading: false, resources });
    });

    let cancelled = false;

    const applyRealtimeEvent = (incomingEvent) => {
      if (cancelled || !isSameScope(currentScope.current, requestedScope)) return;
      const incomingConversationKey = canonicalConversationKey(
        incomingEvent.channel_type,
        incomingEvent.external_conversation_id,
        incomingEvent.contact_handle || incomingEvent.id,
        activeTenantSlug,
      );
      const markIncomingAsRead = conversationViewRef.current.visible
        && conversationViewRef.current.canonicalKey === incomingConversationKey;
      setAppData((prev) => {
        if (!prev || prev.scopeKey !== requestedScope) return prev;
        const resolvedTeamAgents = Array.isArray(prev.teamAgents) ? prev.teamAgents : [];
        const nextConversations = applyIncomingEventToConversations(
          prev.conversations,
          incomingEvent,
          activeTenantSlug,
          {
            markIncomingAsRead,
            kanbanColumns: prev.kanbanColumns,
            tenantSettings: scopedTenantSettings,
            teamAgents: resolvedTeamAgents,
          },
        );
        const nextKanbanColumns = applyIncomingEventToKanban(
          prev.kanbanColumns,
          incomingEvent,
          activeTenantSlug,
          resolvedTeamAgents,
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
        if (cancelled || !isSameScope(currentScope.current, requestedScope)) return;

        const enriched = await enrichSingleMediaEvent(event);
        if (cancelled || !isSameScope(currentScope.current, requestedScope)) return;
        if (hasResolvedMediaUrl(enriched)) {
          applyRealtimeEvent(withLocalMediaLoadState(enriched));
          return;
        }
      }
      if (!cancelled && isSameScope(currentScope.current, requestedScope)) {
        applyRealtimeEvent(withLocalMediaLoadState(event, 'retryable_error'));
      }
    };

    const unsubscribe = subscribeToClientEvents(async (payload) => {
      if (cancelled || !isSameScope(currentScope.current, requestedScope)) return;
      const scopedRefData = appDataRef.current?.scopeKey === requestedScope ? appDataRef.current : null;
      window.dispatchEvent(new CustomEvent('noria:operator-event', { detail: {
        tenantId: scopedRefData?.tenantId, userId, payload,
      } }));
      if (payload?.table === 'channel_events' && payload?.new) {
        const incomingEvent = payload.new;
        const conversationKey = canonicalConversationKey(incomingEvent.channel_type, incomingEvent.external_conversation_id,
          incomingEvent.contact_handle || incomingEvent.id, activeTenantSlug);
        const knownConversation = scopedRefData?.conversations?.find((conversation) => conversation.canonicalKey === conversationKey);
        const isNewConversation = Boolean(incomingEvent.external_conversation_id) && !knownConversation;
        // Estado antes deste evento: conversa já com a equipe não precisa de recarga completa a cada mensagem.
        const alreadyHumanControlled = knownConversation?.status === 'atendimento_humano';
        const isStoredMediaWaitingForUrl = hasStoredMediaNeedingUrl(incomingEvent);
        applyRealtimeEvent(isStoredMediaWaitingForUrl
          ? withLocalMediaLoadState(incomingEvent, 'resolving')
          : incomingEvent);

        if (isStoredMediaWaitingForUrl) {
          void recoverRealtimeMedia(incomingEvent);
        }

        if (shouldRefreshConversationState(incomingEvent, { isNewConversation, alreadyHumanControlled })) {
          refreshFromRealtime();
        }
      } else {
        const resources = realtimeRefreshTargets(payload, scopedRefData?.tenantId);
        if (!resources || resources.length) refreshFromRealtime(resources);
      }
    }, activeTenantSlug, subscribedTenantId);

    const unsubscribeConversationReads = subscribeToConversationReads((payload) => {
      if (cancelled || !isSameScope(currentScope.current, requestedScope)) return;
      const marker = payload?.new;
      if (!marker?.tenant_id || !marker?.user_id) {
        refreshFromRealtime();
        return;
      }
      setAppData((prev) => {
        if (!prev || prev.scopeKey !== requestedScope || marker.tenant_id !== prev.tenantId || marker.user_id !== userId) return prev;
        const conversationReads = upsertConversationReadMarker(prev.conversationReads || [], marker);
        return {
          ...prev,
          conversationReads,
          conversations: applyConversationReadState(prev.conversations, conversationReads, prev.tenantId, userId),
        };
      });
    }, userId);

    const refreshWhenVisible = () => {
      if (!cancelled
        && isSameScope(currentScope.current, requestedScope)
        && document.visibilityState === 'visible'
        && refreshCoordinator.shouldRefreshOnVisibility(requestedScope)) {
        refreshData({ showLoading: false });
      }
    };
    const refreshCatalogAfterWrite = () => {
      if (cancelled || !isSameScope(currentScope.current, requestedScope)) return;
      refreshFromRealtime();
    };
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('noria:catalog-cache-updated', refreshCatalogAfterWrite);
    // O Realtime é o mecanismo primário. Mantemos um fallback pouco frequente
    // para tabelas ainda não cobertas pela subscription. Enquanto a aba estiver
    // oculta, não acumulamos uma carga completa para executar ao retornar.
    const fallbackPolling = window.setInterval(() => {
      if (!cancelled && isSameScope(currentScope.current, requestedScope) && document.visibilityState === 'visible') {
        refreshData({ showLoading: false });
      }
    }, VISIBILITY_REFRESH_STALE_AFTER_MS);

    return () => {
      cancelled = true;
      unsubscribe();
      unsubscribeConversationReads();
      if (isSameScope(currentScope.current, requestedScope) && appDataRef.current?.tenantId !== subscribedTenantId) {
        refreshFromRealtime.flush();
      } else {
        refreshFromRealtime.cancel();
      }
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('noria:catalog-cache-updated', refreshCatalogAfterWrite);
      window.clearInterval(fallbackPolling);
    };
  }, [activeTenantSlug, session?.user?.id, hasTenantAccess, dataScope, scopedData?.tenantId]);

  const activeSubscriptionTenantId = scopedData?.tenantId;
  useEffect(() => {
    if (!activeSubscriptionTenantId) return undefined;
    const requestedScope = scopeKey;
    let cancelled = false;

    const unsubscribe = subscribeToContacts((payload) => {
      if (cancelled || !isSameScope(currentScope.current, requestedScope)) return;
      const contact = payload?.new;
      if (!contact || contact.tenant_id !== activeSubscriptionTenantId) return;
      setAppData((prev) => {
        if (!prev || prev.scopeKey !== requestedScope || prev.tenantId !== activeSubscriptionTenantId) return prev;
        return {
          ...prev,
          conversations: applyContactUpdateToConversations(prev.conversations, contact, activeSubscriptionTenantId),
        };
      });
    }, activeSubscriptionTenantId);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [activeSubscriptionTenantId, scopeKey]);

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
            onValueChange={handleTenantChange}
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
                const targetSlug = (activeTenantSlug && availableTenants.some((t) => t.slug === activeTenantSlug))
                  ? activeTenantSlug
                  : availableTenants[0]?.slug;
                if (targetSlug) {
                  handleTenantChange(targetSlug);
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
        onCloseMobileNav={handleCloseMobileNav}
        onSelectPage={handleSelectPage}
        selectedTenant={selectedTenant}
      />

      <main className="main" data-page={active} style={{ position: 'relative' }}>
        <div className={`refresh-progress-bar ${loading || isCacheSnapshot ? 'active' : ''}`} />
        {loadError && <div className="inline-error" role="alert">{loadError} <button type="button" onClick={() => refreshData()}>Tentar de novo</button></div>}
        <AppTopbar
          active={active}
          activeTenantSlug={activeTenantSlug}
          availableTenants={availableTenants}
          handleSignOut={handleSignOut}
          isAuthRequired={isAuthRequired}
          isRefreshingCache={isCacheSnapshot}
          loading={loading}
          menu={menu}
          mobileNavOpen={mobileNavOpen}
          onOpenMobileNav={handleOpenMobileNav}
          refreshData={refreshData}
          selectedTenant={selectedTenant}
          setTenantSlug={handleTenantChange}
          notificationTenantId={hasTenantAccess && scopedReady && !isCacheSnapshot ? scopedData.tenantId : null}
          notificationUserId={session?.user?.id || null}
          notificationSettings={scopedTenantSettings?.tenantId && scopedTenantSettings.tenantId === scopedData.tenantId ? scopedTenantSettings?.settings : null}
          notificationConversations={scopedData.conversations}
          notificationConversationViewRef={conversationViewRef}
          notificationAppointments={scopedData.appointments}
          notificationKanbanColumns={scopedData.kanbanColumns}
          onOpenNotificationPage={handleSelectPage}
          onOpenNotificationConversation={handleOpenChatFromKanban}
          onOpenNotificationCard={handleOpenNotificationCard}
        />

        {pageResourceErrors.length > 0 && (
          <div className="resource-error-banner" role="alert">
            <span className="resource-error-banner-copy">
              <AlertTriangle size={16} className="resource-error-banner-icon" aria-hidden="true" />
              <span>
                Não foi possível atualizar {pageResourceErrors.join(', ')}. Os dados anteriores foram mantidos.
              </span>
            </span>
            <button type="button" className="secondary-button resource-error-retry-btn" onClick={() => refreshData()}>
              Tentar de novo
            </button>
          </div>
        )}

        <div className="app-page-stage">
        {active === 'dashboard' && (
          <Dashboard
            key={scopeKey}
            conversations={scopedData.conversations}
            dataSource={scopedData.source}
            status={scopedData.status}
            ready={scopedReady}
            onOpenConversation={handleOpenChatFromKanban}
            kanbanColumns={scopedData.kanbanColumns}
            tenantSettings={scopedTenantSettings}
            tenantSlug={activeTenantSlug}
          />
        )}
        {active === 'conversas' && (
          <Conversations
            key={scopeKey}
            allowedChannels={allowedChannels}
            conversations={scopedData.conversations}
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
            ready={scopedReady}
            kanbanColumns={scopedData.kanbanColumns}
            tenantSettings={scopedTenantSettings}
            olderConversations={{ shown: showOlderConversations, toggle: toggleOlderConversations }}
          />
        )}
        {active === 'kanban' && (
          <Kanban
            key={scopeKey}
            allowedChannels={allowedChannels}
            kanbanColumns={scopedData.kanbanColumns}
            tenantName={selectedTenant?.name || ''}
            agentsList={agentsList}
            tenantSlug={activeTenantSlug}
            tenantSettings={scopedTenantSettings}
            onChanged={refreshData}
            onOpenChat={handleOpenChatFromKanban}
            onOpenAppointment={handleOpenAppointmentFromKanban}
            onMoveCard={handleMoveKanbanCard}
            onOrderApplied={handleKanbanOrderApplied}
            onFinishConversation={handleFinishConversationFromKanban}
            focusedCardId={notificationCard?.scopeKey === scopeKey ? notificationCard.cardId : undefined}
            onCardFocused={() => setNotificationCard(null)}
            ready={scopedReady}
            olderConversations={{ shown: showOlderConversations, toggle: toggleOlderConversations }}
          />
        )}
        {active === 'funil' && <Funnel key={scopeKey} funnelStages={scopedData.funnelStages} tenantName={selectedTenant?.name || ''} ready={scopedReady} />}
        {active === 'disparos' && (
          <Broadcasts
            key={scopeKey}
            allowedChannels={allowedChannels}
            conversations={scopedData.conversations}
            contacts={scopedData.broadcastContacts || []}
            campaigns={scopedData.broadcastCampaigns || []}
            tenantSlug={activeTenantSlug}
            onChanged={refreshData}
            ready={scopedReady}
          />
        )}
        {active === 'agendamentos' && (
          <Appointments
            key={scopeKey}
            appointments={scopedData.appointments || []}
            conversations={scopedData.conversations}
            tenantSlug={activeTenantSlug}
            onChanged={refreshData}
            initialData={prefilledAppointment}
            ready={scopedReady}
            outcomeTracking={isOutcomeTrackingEnabled(scopedTenantSettings)}
            tenantSettings={scopedTenantSettings}
          />
        )}
        {active === 'configuracoes' && (
          <SettingsPage
            key={scopeKey}
            allowedChannels={allowedChannels}
            agents={agentsList}
            agentsReady={agentsReady}
            ready={scopedReady}
            onAddAgent={handleAddAgent}
            onToggleAgentStatus={handleToggleAgentStatus}
            onDeleteAgent={handleDeleteAgent}
            tenant={selectedTenant}
            tenantName={selectedTenant?.name || ''}
            tenantSettings={scopedTenantSettings}
            tenantSlug={activeTenantSlug}
            integration={integration}
          />
        )}
        </div>
      </main>
    </div>
  );
}

export { App, menu };
export default App;

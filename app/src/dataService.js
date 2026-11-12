import { createClient } from '@supabase/supabase-js';
import { asObject } from './utils/asObject.js';
import { formatDate, compareDateLabel } from './utils/dateFormatting.js';
import { appointmentTimestamp, isMoreRecentRecord } from './utils/recordRecency.js';
import { getAuthClient, isAuthRequired } from './services/auth/authService.js';
import { loadUserTenants, enabledChannels } from './services/tenants/tenantAccess.js';
import { prepareConversationEvents } from './services/conversations/conversationEvents.js';
import { applyConversationLifecycle, isConversationClosed, requirePersistedClosure } from './services/conversations/conversationLifecycle.js';
export { isConversationClosed };
import { isEligibleForExternalOutbound, isInternalOperationalEvent } from './services/timeline/eventClassification.js';
import { emptyFunnel, formatCurrency } from './services/funnel/funnelHelpers.js';
export { emptyFunnel, formatCurrency };
import { TENANT_SCHEDULING_LINKS, getTenantSchedulingLink } from './services/appointments/schedulingLinks.js';
export { TENANT_SCHEDULING_LINKS, getTenantSchedulingLink };
import { canonicalConversationKey, normalizeChannel, normalizeExternalConversationId } from './services/identity/conversationIdentity.js';
export { canonicalConversationKey, normalizeExternalConversationId };
import { estimatedValue, sentimentFromEvent as sentimentFromEventWithStage } from './services/conversations/conversationDerived.js';
import { contactAvatarKey, normalizeAvatarUrl } from './services/contacts/contactIdentity.js';
export { contactAvatarKey, normalizeAvatarUrl };
import { buildContactAvatarIndex, buildContactDirectory } from './services/contacts/contactDirectory.js';
export { buildContactAvatarIndex, buildContactDirectory };
import {
  applyContactAvatars,
  applyContactAvatarsToBroadcastContacts,
  applyContactDirectory,
  resolveContactAvatarState,
} from './services/contacts/contactApplication.js';
export {
  applyContactAvatars,
  applyContactAvatarsToBroadcastContacts,
  applyContactDirectory,
  resolveContactAvatarState,
};
import { getTrustedContactName, getUsefulTrustedContactName, isUsefulContactName } from './services/contacts/contactNames.js';
export { getTrustedContactName, getUsefulTrustedContactName, isUsefulContactName };
import { conversationPhoneFallback, formatWhatsAppPhone } from './services/contacts/contactPhones.js';
export { conversationPhoneFallback, formatWhatsAppPhone };
import { applyContactUpdateToConversations } from './services/contacts/contactUpdates.js';
export { applyContactUpdateToConversations };
import { extractAvatarUrlFromEvent, extractPayloadAvatar } from './services/contacts/contactPayload.js';
export { extractAvatarUrlFromEvent, extractPayloadAvatar };
import { resolveConversationDisplayName } from './services/contacts/contactDisplayName.js';
export { resolveConversationDisplayName };
import { cleanAgentName } from './services/agents/agentNames.js';
export { cleanAgentName };
import { loadTeamAgents as loadTeamAgentsWithDependencies } from './services/agents/teamAgentReads.js';
import { mapAppointment } from './services/appointments/appointmentPresentation.js';
import { createSaveAppointment } from './services/appointments/saveAppointment.js';
import { loadConversationHeads, mergeConversationHeads } from './services/conversations/conversationHeads.js';
import { createAppointmentDataService } from './services/appointments/appointmentDataService.js';
import { createBroadcastOperations } from './services/broadcasts/broadcastOperations.js';
import { createTeamAgentManagement } from './services/agents/teamAgentManagement.js';
import {
  normalizeAudioTranscription,
  normalizeLocation,
  normalizeStage,
  resolveConversationHeaderOwner,
  resolveConversationOwner,
  resolveConversationOwnerDetails,
  resolveEventMessagePreview,
  resolveMessageSender,
} from './services/conversations/conversationPresentation.js';
export {
  normalizeAudioTranscription,
  normalizeLocation,
  normalizeStage,
  resolveConversationHeaderOwner,
  resolveConversationOwner,
  resolveConversationOwnerDetails,
  resolveEventMessagePreview,
  resolveMessageSender,
};
import {
  conversationReadKey,
  isUnreadInboundEvent,
  getLatestReadableEvent,
  shouldAdvanceConversationRead,
  upsertConversationReadMarker,
  applyConversationReadState,
} from './services/reads/readsService.js';
export {
  conversationReadKey,
  isUnreadInboundEvent,
  getLatestReadableEvent,
  shouldAdvanceConversationRead,
  upsertConversationReadMarker,
  applyConversationReadState,
};
import {
  isConversationWaitingForFollowUp,
  formatWaitingDuration,
  matchesResponsibleFilter,
  matchesConversationTab,
  sortConversationsForTab,
  getConversationTabCounts,
  formatConversationCardOrigin,
  formatMediaPreviewWithIcon,
} from './services/timeline/conversationFilters.js';
export {
  isConversationWaitingForFollowUp,
  formatWaitingDuration,
  matchesResponsibleFilter,
  matchesConversationTab,
  sortConversationsForTab,
  getConversationTabCounts,
  formatConversationCardOrigin,
  formatMediaPreviewWithIcon,
};
import { getConversationActivityEpoch, sortConversationsByRecentActivity } from './services/timeline/conversationOrdering.js';
export { getConversationActivityEpoch, sortConversationsByRecentActivity };
import {
  emptyKanban,
  getKanbanColumnKind,
} from './services/kanban/kanbanHelpers.js';
export { emptyKanban, getKanbanColumnKind };
import { validateKanbanOrderProposal } from './services/kanban/kanbanOrderValidation.js';
export { validateKanbanOrderProposal };
import { TECHNICAL_MEDIA_LABELS, REAL_MEDIA_KINDS, isMediaPlaceholderForKind } from './utils/audioUtils.js';
import { getStageTone } from './services/kanban/stageTone.js';
export { getStageTone };
import { isTransientStorageError } from './services/media/storageErrors.js';
export { isTransientStorageError };
import { mediaPreview, isGeneratedMediaLabel } from './services/media/mediaPresentation.js';
import { isExplicitOutboundMedia } from './services/media/mediaDirection.js';
import { safeProductImageUrl, safeProductThumbnail } from './services/media/productImages.js';
import { productSnapshotMedia } from './services/media/productSnapshot.js';
import { normalizeMedia, hasStoredMediaNeedingUrl } from './services/media/mediaNormalization.js';
export { normalizeMedia, hasStoredMediaNeedingUrl };
import {
  SIGNED_URL_EXPIRES_IN,
  clearMediaUrlCache,
  enrichMediaUrls,
  getMediaUrlFromCache,
} from './services/media/mediaUrlService.js';
export { SIGNED_URL_EXPIRES_IN, clearMediaUrlCache, enrichMediaUrls, getMediaUrlFromCache };
import { enrichSingleMediaEvent as enrichSingleMediaEventWithClient } from './services/media/singleMediaEvent.js';
import {
  loadContactAvatars as loadContactAvatarsWithClient,
  loadRelevantContacts as loadRelevantContactsWithClient,
} from './services/contacts/contactDataService.js';
import {
  findTenantBySlug,
  loadAppointments as loadAppointmentsWithClient,
  loadBroadcastCampaigns as loadBroadcastCampaignsWithClient,
  loadBroadcastContacts as loadBroadcastContactsWithClient,
  loadFollowUpJobs as loadFollowUpJobsWithClient,
  loadKanbanConfig as loadKanbanConfigWithClient,
} from './services/tenants/tenantDataReads.js';
import {
  loadConversationReads as loadConversationReadsWithClient,
  markConversationRead as markConversationReadWithClient,
} from './services/reads/conversationDataReads.js';
import {
  buildSalesLeadIndex as buildSalesLeadIndexWithHelpers,
  loadSalesLeads as loadSalesLeadsWithClient,
  resolveSalesControlMode,
} from './services/leads/leadDataReads.js';
export { resolveSalesControlMode };
import { GENESIS_SALES_STAGE_DEFAULT_NAMES, GENESIS_SALES_STAGE_BY_KEY, GENESIS_SALES_STAGE_KEYS, isGenesisSalesTenant } from './services/kanban/commercialStages.js';
export { GENESIS_SALES_STAGE_DEFAULT_NAMES, isGenesisSalesTenant };
import { getStageLabel, findKanbanColumn } from './services/kanban/stageResolution.js';
export { getStageLabel };
import { shouldHideGenericLeadInquiry, isCustomerInboundEvent, isFollowUpOutboundEvent, isSubstantiveInboundFollowUp, isGenericLeadInquiry, isShortlyAfter } from './services/conversations/conversationEventState.js';
export { shouldHideGenericLeadInquiry, isCustomerInboundEvent, isFollowUpOutboundEvent };
import { eventsToConversations } from './services/conversations/eventsToConversations.js';
export { eventsToConversations };
import { applyIncomingEventToConversations } from './services/conversations/applyIncomingEvent.js';
export { applyIncomingEventToConversations };
import { applyIncomingEventToKanban, sortKanbanCardsByConversationActivity } from './services/kanban/applyIncomingEvent.js';
export { applyIncomingEventToKanban, sortKanbanCardsByConversationActivity };
import { eventsToKanban, orderKanbanColumnsForTenant, ownerMetadataFromKanbanEvent, resolveTenantKanbanStage } from './services/kanban/eventsToKanban.js';
export { eventsToKanban, orderKanbanColumnsForTenant, ownerMetadataFromKanbanEvent, resolveTenantKanbanStage };
import { buildGenesisSalesMovePayload, createMoveKanbanCard } from './services/kanban/kanbanCardMovement.js';
export { buildGenesisSalesMovePayload };
import { enrichCatalogReferrals } from './services/catalog/catalogReferrals.js';
import { buildEmptyClientData, buildLoadedClientData, buildStatus } from './services/clientData/clientDataTransforms.js';

const runtimeEnv = (typeof import.meta !== 'undefined' && import.meta.env) || {};
const supabaseUrl = runtimeEnv.VITE_SUPABASE_URL || '';
const supabaseAnonKey = runtimeEnv.VITE_SUPABASE_ANON_KEY || '';
export function hasSupabaseConfig() {
  return checkSupabaseConfig(supabaseUrl, supabaseAnonKey);
}

function getClient() {
  if (!hasSupabaseConfig()) return null;
  return getAuthClient() || createClient(supabaseUrl, supabaseAnonKey);
}

import {
  hasSupabaseConfig as checkSupabaseConfig,
  getInitialTenantSlug,
  persistTenantSlug,
} from './services/tenants/tenantStorage.js';
export { getInitialTenantSlug, persistTenantSlug };

export async function loadAvailableTenants(fallbackTenants = []) {
  const supabase = getClient();
  if (!supabase) return isAuthRequired() ? [] : fallbackTenants;
  return loadUserTenants(supabase);
}

export function subscribeToClientEvents(onChange, activeTenantSlug, activeTenantId) {
  const supabase = getClient();
  if (!supabase || !activeTenantSlug) return () => { };

  const channel = supabase
    .channel(`tenant-events:${activeTenantSlug}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'channel_events',
        filter: `tenant_slug=eq.${activeTenantSlug}`,
      },
      (payload) => onChange?.({ table: 'channel_events', ...payload }),
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'appointments',
      },
      (payload) => onChange?.({ table: 'appointments', ...payload }),
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'broadcast_campaigns',
      },
      (payload) => onChange?.({ table: 'broadcast_campaigns', ...payload }),
    );

  channel.subscribe((status, err) => {
    if (status === 'CHANNEL_ERROR') {
      console.warn(`[Realtime] Erro no canal tenant-events:${activeTenantSlug}`, err);
    }
  });

  // Canal secundário opcional para sales_leads: isolado para não degradar channel_events
  // caso a tabela sales_leads ainda não esteja incluída na publicação supabase_realtime.
  let leadsChannel = null;
  if (activeTenantId) {
    leadsChannel = supabase
      .channel(`tenant-leads:${activeTenantSlug}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'sales_leads',
          filter: `tenant_id=eq.${activeTenantId}`,
        },
        (payload) => onChange?.({ table: 'sales_leads', ...payload }),
      );

    leadsChannel.subscribe((status) => {
      if (status === 'CHANNEL_ERROR') {
        // Falha tolerada e silenciosa se a tabela não estiver na publicação do banco
      }
    });
  }

  return () => {
    supabase.removeChannel(channel);
    if (leadsChannel) {
      supabase.removeChannel(leadsChannel);
    }
  };
}

import { shouldRefreshConversationState, createDebouncedRealtimeRefresh } from './services/timeline/realtimeRefresh.js';
export { shouldRefreshConversationState, createDebouncedRealtimeRefresh };

export function subscribeToConversationReads(onChange, userId) {
  const supabase = getClient();
  if (!supabase || !userId) return () => {};

  const channel = supabase
    .channel(`conversation-reads:${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'conversation_reads',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => onChange?.(payload),
    )
    .subscribe((status, err) => {
      if (status === 'CHANNEL_ERROR') {
        console.warn(`[Realtime] Erro no canal conversation-reads:${userId}`, err);
      }
    });

  return () => {
    supabase.removeChannel(channel);
  };
}

export async function loadClientData(fallback, activeTenantSlug, userId = null) {
  if (!activeTenantSlug) throw new Error('Selecione uma empresa autorizada para continuar.');
  const supabase = getClient();
  if (!supabase) {
    return {
      ...fallback,
      tenantId: fallback?.tenantId || null,
      conversationReads: fallback?.conversationReads || [],
      source: 'mock',
      status: buildStatus({ source: 'mock', events: [], tenantSlug: activeTenantSlug }),
      appointments: [],
      broadcastContacts: [],
      broadcastCampaigns: [],
    };
  }

  const tenant = await findTenantBySlug(supabase, activeTenantSlug);
  if (!tenant) throw new Error('Empresa indisponivel para esta conta.');
  const { data: uiSettings, error: settingsError } = await supabase.from('tenant_settings')
    .select('settings').eq('tenant_id', tenant.id).maybeSingle();
  if (settingsError) throw new Error('Nao foi possivel carregar as configuracoes da empresa.');
  const tenantChannels = enabledChannels(uiSettings?.settings);
  const [eventsResult, appointments, broadcastContacts, broadcastCampaigns, kanbanConfig, followUpJobs, salesLeads, conversationReads, teamAgents] = await Promise.all([
    supabase
      .from('channel_events')
      .select('*')
      .eq('tenant_slug', activeTenantSlug)
      .order('created_at', { ascending: false })
      .limit(1000),
    tenant ? loadAppointmentsWithClient(supabase, tenant.id, mapAppointment) : [],
    tenant ? loadBroadcastContactsWithClient(supabase, tenant.id) : [],
    tenant ? loadBroadcastCampaignsWithClient(supabase, tenant.id) : [],
    tenant ? loadKanbanConfigWithClient(supabase, tenant.id) : null,
    tenant ? loadFollowUpJobsWithClient(supabase, tenant.id, activeTenantSlug) : [],
    tenant && isGenesisSalesTenant(activeTenantSlug) ? loadSalesLeadsWithClient(supabase, tenant.id) : [],
    tenant && userId ? loadConversationReadsWithClient(supabase, tenant.id, userId) : [],
    tenant ? loadTeamAgents(activeTenantSlug) : [],
  ]);
  const { data: recentEvents, error } = eventsResult;

  if (error) {
    throw new Error('Nao foi possivel carregar os atendimentos.');
  }

  // Completa a janela recente com o último evento de cada conversa: nenhuma conversa some do painel (IA-16).
  const data = recentEvents?.length ? mergeConversationHeads(recentEvents, await loadConversationHeads(supabase, activeTenantSlug)) : recentEvents;

  if (!data?.length) {
    return buildEmptyClientData({ fallback, tenantId: tenant.id, enabledChannels: tenantChannels, activeTenantSlug, appointments, broadcastContacts, broadcastCampaigns, conversationReads, teamAgents, kanbanConfig, followUpJobs, salesLeads });
  }

  // Resolve only the contacts that can be displayed in the conversations already
  // loaded. A global .limit(1000) silently lost identities for larger tenants.
  const contactDirectory = await loadRelevantContacts(tenant.id, data, broadcastContacts);

  const catalogEnrichedEvents = await enrichCatalogReferrals(
    data.map((event) => ({ ...event, raw_payload: asObject(event.raw_payload) })), tenant.id, supabase, activeTenantSlug,
  );
  const eventsWithMediaUrls = await enrichMediaUrls(
    catalogEnrichedEvents,
    supabase,
    { cacheOnly: true },
  );
  const contactIndex = buildContactDirectory(contactDirectory, tenant.id);
  const eventsWithAvatars = applyContactDirectory(eventsWithMediaUrls, contactIndex, tenant.id);
  const broadcastContactsWithAvatars = applyContactAvatarsToBroadcastContacts(broadcastContacts, contactIndex, tenant.id);

  return buildLoadedClientData({ fallback, tenantId: tenant.id, enabledChannels: tenantChannels, activeTenantSlug, userId, events: eventsWithAvatars, appointments, broadcastContacts: broadcastContactsWithAvatars, broadcastCampaigns, conversationReads, teamAgents, kanbanConfig, followUpJobs, salesLeads, tenantSettings: uiSettings?.settings || null });
}

async function loadTenant(activeTenantSlug) {
  return findTenantBySlug(getClient(), activeTenantSlug);
}

async function currentUserId() {
  const supabase = getClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data?.user?.id || null;
}

export async function loadConversationReads(tenantId, userId) {
  return loadConversationReadsWithClient(getClient(), tenantId, userId);
}

export async function markConversationRead(params) {
  return markConversationReadWithClient(getClient(), params);
}

export const saveAppointment = createSaveAppointment({ getClient, loadTenant, currentUserId });

export async function enrichSingleMediaEvent(event, client, { force = false } = {}) {
  if (!event) return event;
  return enrichSingleMediaEventWithClient(event, client || getClient(), { force });
}

// A identidade do contato pertence ao remetente inbound. Eventos outbound podem
// carregar o nome salvo no momento do envio, mas esse valor descreve o contexto
// da mensagem e nunca deve substituir a identidade do cliente.
export function subscribeToContacts(onChange, tenantId) {
  const supabase = getClient();
  if (!supabase || !tenantId) return () => {};
  const channel = supabase
    .channel(`tenant-contacts:${tenantId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'contacts', filter: `tenant_id=eq.${tenantId}` },
      (payload) => onChange?.({ table: 'contacts', ...payload }),
    )
    .subscribe((status, err) => {
      if (status === 'CHANNEL_ERROR') console.warn(`[Realtime] Erro no canal tenant-contacts:${tenantId}`, err);
    });
  return () => { supabase.removeChannel(channel); };
}



export async function loadRelevantContacts(tenantId, events = [], broadcastContacts = []) {
  return loadRelevantContactsWithClient(getClient(), tenantId, events, broadcastContacts);
}

// Kept for narrow legacy callers. Conversation loading uses loadRelevantContacts.
export async function loadContactAvatars(tenantId) {
  return loadContactAvatarsWithClient(getClient(), tenantId);
}


export async function loadTeamAgents(tenantSlug) {
  return loadTeamAgentsWithDependencies(tenantSlug, { getClient, isAuthRequired });
}

const appointmentDataService = createAppointmentDataService({ getClient, loadTenant });
export const { loadAppointmentScheduling, loadAppointmentAvailability, loadTenantSettings } = appointmentDataService;
const broadcastOperations = createBroadcastOperations({ getClient, loadTenant, currentUserId });
export const { upsertBroadcastContacts, createBroadcastCampaign, updateBroadcastCampaign, updateBroadcastRecipient } = broadcastOperations;
const teamAgentManagement = createTeamAgentManagement({ getClient });
export const { saveTeamAgent, updateTeamAgentStatus, removeTeamAgent } = teamAgentManagement;

// Mesmo encerramento do botão Encerrar das Conversas: passa pelo roteador do n8n, que registra o
// controle do atendimento no banco e libera a IA. Import tardio: integration.js lê variáveis do Vite.
async function closeConversationFromKanban({ tenantSlug, channelType, externalConversationId, contactName, sentByUser }) {
  const { sendN8nCommand } = await import('./services/integration.js');
  const result = await sendN8nCommand('close_conversation', {
    channel_type: channelType,
    external_conversation_id: externalConversationId,
    contact_name: contactName,
    message_text: 'Atendimento encerrado pela interface',
    sent_by_user: sentByUser,
    reason: 'Atendimento finalizado pelo Kanban',
  }, tenantSlug);
  return { event: requirePersistedClosure(result) };
}

export const moveKanbanCard = createMoveKanbanCard({ getClient, loadTenant, closeConversation: closeConversationFromKanban });

export { isEligibleForExternalOutbound, isInternalOperationalEvent };

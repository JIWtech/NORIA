import { asObject } from '../../utils/asObject.js';
import { isAuthRequired } from '../auth/authService.js';
import { enabledChannels } from '../tenants/tenantAccess.js';
import { findTenantBySlug, loadAppointments as loadAppointmentsWithClient, loadBroadcastContacts as loadBroadcastContactsWithClient, loadBroadcastCampaigns as loadBroadcastCampaignsWithClient, loadKanbanConfig as loadKanbanConfigWithClient, loadFollowUpJobs as loadFollowUpJobsWithClient } from '../tenants/tenantDataReads.js';
import { mapAppointment } from '../appointments/appointmentPresentation.js';
import { loadConversationHeads, mergeConversationHeads, recentConversationsSince } from '../conversations/conversationHeads.js';
import { loadConversationReads as loadConversationReadsWithClient } from '../reads/conversationDataReads.js';
import { loadSalesLeads as loadSalesLeadsWithClient } from '../leads/leadDataReads.js';
import { isGenesisSalesTenant } from '../kanban/commercialStages.js';
import { loadTeamAgents as loadTeamAgentsWithDependencies } from '../agents/teamAgentReads.js';
import { loadRelevantContacts as loadRelevantContactsWithClient } from '../contacts/contactDataService.js';
import { buildContactDirectory } from '../contacts/contactDirectory.js';
import { applyContactDirectory, applyContactAvatarsToBroadcastContacts } from '../contacts/contactApplication.js';
import { enrichCatalogReferrals } from '../catalog/catalogReferrals.js';
import { enrichMediaUrls } from '../media/mediaUrlService.js';
import { buildEmptyClientData, buildLoadedClientData, buildStatus } from './clientDataTransforms.js';

export async function loadClientDataWithClient(supabase, fallback, activeTenantSlug, userId = null, options = {}) {
  if (!activeTenantSlug) throw new Error('Selecione uma empresa autorizada para continuar.');
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

  // Apenas campanhas não participam dos estados derivados de conversas e Kanban.
  if (Array.isArray(options.resources) && options.resources.length === 1 && options.resources[0] === 'broadcastCampaigns') {
    const { data, error } = await supabase.from('broadcast_campaigns').select('*')
      .eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(50);
    if (error) throw new Error('Nao foi possivel carregar as campanhas.');
    return { tenantId: tenant.id, broadcastCampaigns: data || [] };
  }

  // As cabeças dependem apenas da janela de eventos, não dos outros domínios.
  const eventsTask = Promise.resolve(supabase
      .from('channel_events')
      .select('*')
      .eq('tenant_slug', activeTenantSlug)
      .order('created_at', { ascending: false })
      .limit(1000)).then(async (result) => {
    if (result.error || !result.data?.length) return result;
    // Por padrão só conversas com atividade recente; as antigas entram quando a pessoa pede "conversas antigas".
    const heads = await loadConversationHeads(supabase, activeTenantSlug,
      { since: options.includeOlderConversations ? null : recentConversationsSince() });
    return { ...result, data: mergeConversationHeads(result.data, heads) };
  });
  const [settingsResult, eventsResult, appointments, broadcastContacts, broadcastCampaigns, kanbanConfig, followUpJobs, salesLeads, conversationReads, teamAgents] = await Promise.all([
    supabase.from('tenant_settings').select('settings').eq('tenant_id', tenant.id).maybeSingle(),
    eventsTask,
    tenant ? loadAppointmentsWithClient(supabase, tenant.id, mapAppointment) : [],
    tenant ? loadBroadcastContactsWithClient(supabase, tenant.id) : [],
    tenant ? loadBroadcastCampaignsWithClient(supabase, tenant.id) : [],
    tenant ? loadKanbanConfigWithClient(supabase, tenant.id) : null,
    tenant ? loadFollowUpJobsWithClient(supabase, tenant.id, activeTenantSlug) : [],
    tenant && isGenesisSalesTenant(activeTenantSlug) ? loadSalesLeadsWithClient(supabase, tenant.id) : [],
    tenant && userId ? loadConversationReadsWithClient(supabase, tenant.id, userId) : [],
    tenant ? loadTeamAgentsWithDependencies(activeTenantSlug, { getClient: () => supabase, isAuthRequired }) : [],
  ]);
  const { data: uiSettings, error: settingsError } = settingsResult;
  if (settingsError) throw new Error('Nao foi possivel carregar as configuracoes da empresa.');
  const tenantChannels = enabledChannels(uiSettings?.settings);
  const { data, error } = eventsResult;

  if (error) {
    throw new Error('Nao foi possivel carregar os atendimentos.');
  }

  if (!data?.length) {
    return buildEmptyClientData({ fallback, tenantId: tenant.id, enabledChannels: tenantChannels, activeTenantSlug, appointments, broadcastContacts, broadcastCampaigns, conversationReads, teamAgents, kanbanConfig, followUpJobs, salesLeads });
  }

  // Resolve only the contacts that can be displayed in the conversations already
  // loaded. A global .limit(1000) silently lost identities for larger tenants.
  const [contactDirectory, catalogEnrichedEvents] = await Promise.all([
    loadRelevantContactsWithClient(supabase, tenant.id, data, broadcastContacts),
    enrichCatalogReferrals(
      data.map((event) => ({ ...event, raw_payload: asObject(event.raw_payload) })), tenant.id, supabase, activeTenantSlug,
    ),
  ]);
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


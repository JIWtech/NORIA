export function realtimeRefreshTargets(payload, tenantId) {
  const eventTenantId = payload?.new?.tenant_id || payload?.old?.tenant_id;
  if (eventTenantId && tenantId && eventTenantId !== tenantId) return [];
  if (payload?.table !== 'broadcast_campaigns') return undefined;
  return ['broadcastCampaigns'];
}

export function selectPartialRefresh(resources, currentData, fullyLoadedScope, requestedScope) {
  if (!Array.isArray(resources) || resources.length !== 1 || resources[0] !== 'broadcastCampaigns') return undefined;
  if (!requestedScope || fullyLoadedScope !== requestedScope || !currentData?.tenantId) return undefined;
  if (!['supabase', 'supabase_empty'].includes(currentData.source)) return undefined;
  return resources;
}

export function mergeCampaignPatch(previous, patch, expectedTenantId) {
  if (!expectedTenantId || previous?.tenantId !== expectedTenantId || patch?.tenantId !== expectedTenantId
    || !Array.isArray(patch.broadcastCampaigns)) return null;
  return { ...previous, broadcastCampaigns: patch.broadcastCampaigns };
}

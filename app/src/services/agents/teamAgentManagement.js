import { findTenantBySlug } from '../tenants/tenantDataReads.js';
import { tenantCacheEpoch } from '../tenants/tenantScopedCaches.js';

export function createTeamAgentManagement({ getClient }) {
async function saveTeamAgent(tenantSlug, agent) {
  const cleanTenantSlug = String(tenantSlug || '').trim();
  if (!cleanTenantSlug) throw new Error('Tenant ativo não informado.');
  const epoch = tenantCacheEpoch();
  const storageKey = `magia:team-agents:${cleanTenantSlug}`;
  const newRecord = {
    tenant_slug: cleanTenantSlug,
    name: agent.name?.trim(),
    role: agent.role?.trim() || null,
    branch: agent.branch?.trim() ? agent.branch.trim() : null,
    shift: agent.shift?.trim() ? agent.shift.trim() : null,
    status: agent.status || 'online',
    is_active: true,
  };
  try {
    const supabase = getClient();
    const tenant = supabase ? await findTenantBySlug(supabase, cleanTenantSlug) : null;
    if (tenant?.id) {
      const { data, error } = await supabase
        .from('team_agents')
        .insert([{ ...newRecord, tenant_id: tenant.id }])
        .select()
        .single();
      if (!error && data) {
        return data;
      }
    }
  } catch (e) {
    console.warn('Falha ao salvar team_agent no Supabase:', e);
  }
  const localAgent = { id: `local-${Date.now()}`, ...newRecord, created_at: new Date().toISOString() };
  if (epoch !== tenantCacheEpoch()) return localAgent;
  try {
    const current = JSON.parse(localStorage.getItem(storageKey) || '[]');
    localStorage.setItem(storageKey, JSON.stringify([localAgent, ...current]));
  } catch (e) { }
  return localAgent;
}

async function updateTeamAgentStatus(agentId, newStatus, tenantSlug) {
  const cleanTenantSlug = String(tenantSlug || '').trim();
  if (!cleanTenantSlug) throw new Error('Tenant ativo não informado.');
  const epoch = tenantCacheEpoch();
  try {
    const supabase = getClient();
    const tenant = supabase ? await findTenantBySlug(supabase, cleanTenantSlug) : null;
    if (tenant?.id && agentId && !String(agentId).startsWith('local-')) {
      await supabase
        .from('team_agents')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', agentId)
        .eq('tenant_slug', cleanTenantSlug)
        .eq('tenant_id', tenant.id);
    }
  } catch (e) {
    console.warn('Falha ao atualizar status do team_agent no Supabase:', e);
  }
  if (epoch === tenantCacheEpoch()) {
    const storageKey = `magia:team-agents:${cleanTenantSlug}`;
    try {
      const current = JSON.parse(localStorage.getItem(storageKey) || '[]');
      const updated = current.map((ag) => ag.id === agentId ? { ...ag, status: newStatus } : ag);
      localStorage.setItem(storageKey, JSON.stringify(updated));
    } catch (e) { }
  }
}

async function removeTeamAgent(agentId, tenantSlug) {
  const cleanTenantSlug = String(tenantSlug || '').trim();
  if (!cleanTenantSlug) throw new Error('Tenant ativo não informado.');
  const epoch = tenantCacheEpoch();
  try {
    const supabase = getClient();
    const tenant = supabase ? await findTenantBySlug(supabase, cleanTenantSlug) : null;
    if (tenant?.id && agentId && !String(agentId).startsWith('local-')) {
      await supabase
        .from('team_agents')
        .delete()
        .eq('id', agentId)
        .eq('tenant_slug', cleanTenantSlug)
        .eq('tenant_id', tenant.id);
    }
  } catch (e) {
    console.warn('Falha ao remover team_agent do Supabase:', e);
  }
  if (epoch === tenantCacheEpoch()) {
    const storageKey = `magia:team-agents:${cleanTenantSlug}`;
    try {
      const current = JSON.parse(localStorage.getItem(storageKey) || '[]');
      const updated = current.filter((ag) => ag.id !== agentId);
      localStorage.setItem(storageKey, JSON.stringify(updated));
    } catch (e) { }
  }
}
return { saveTeamAgent, updateTeamAgentStatus, removeTeamAgent };
}

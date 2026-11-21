import { findTenantBySlug } from '../tenants/tenantDataReads.js';

export function createTeamAgentManagement({ getClient }) {
  async function resolveTenant(tenantSlug) {
    const slug = String(tenantSlug || '').trim();
    if (!slug) throw new Error('Tenant ativo não informado.');
    const client = getClient();
    if (!client) throw new Error('Não foi possível conectar ao serviço de atendentes.');
    const tenant = await findTenantBySlug(client, slug);
    if (!tenant?.id) throw new Error('Não foi possível identificar o tenant ativo.');
    return { client, tenant, slug };
  }

  async function saveTeamAgent(tenantSlug, agent) {
    const { client, tenant, slug } = await resolveTenant(tenantSlug);
    const { data, error } = await client.from('team_agents').insert([{
      tenant_slug: slug, tenant_id: tenant.id, name: agent.name?.trim(),
      role: agent.role?.trim() || null, branch: agent.branch?.trim() || null,
      shift: agent.shift?.trim() || null, status: agent.status || 'online', is_active: true,
    }]).select().single();
    if (error) throw error;
    if (!data) throw new Error('Não foi possível salvar o atendente.');
    return data;
  }

  async function updateTeamAgentStatus(agentId, newStatus, tenantSlug) {
    const { client, tenant, slug } = await resolveTenant(tenantSlug);
    if (!agentId || String(agentId).startsWith('local-')) throw new Error('Atendente inválido.');
    const { error } = await client.from('team_agents')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', agentId).eq('tenant_slug', slug).eq('tenant_id', tenant.id);
    if (error) throw error;
  }

  async function removeTeamAgent(agentId, tenantSlug) {
    const { client, tenant, slug } = await resolveTenant(tenantSlug);
    if (!agentId || String(agentId).startsWith('local-')) throw new Error('Atendente inválido.');
    const { error } = await client.from('team_agents').delete()
      .eq('id', agentId).eq('tenant_slug', slug).eq('tenant_id', tenant.id);
    if (error) throw error;
  }
  return { saveTeamAgent, updateTeamAgentStatus, removeTeamAgent };
}

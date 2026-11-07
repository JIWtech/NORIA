export async function loadUserTenants(client) {
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError || !auth?.user?.id) throw new Error('Sessao expirada. Entre novamente.');
  const { data, error } = await client.from('tenant_members')
    .select('user_id, role, status, tenants(id, slug, name, industry, plan, status)')
    .eq('user_id', auth.user.id)
    .eq('status', 'active');
  if (error) throw new Error('Nao foi possivel verificar o acesso a empresa.');
  return [...new Map((data || [])
    .map(row => {
      const tenant = Array.isArray(row.tenants) ? row.tenants[0] : row.tenants;
      return { ...row, tenant };
    })
    .filter(row => row.user_id === auth.user.id && row.status === 'active'
      && row.tenant?.status === 'active' && row.tenant?.slug)
    .map(row => [row.tenant.slug, { ...row.tenant, id: row.tenant.slug, membershipRole: row.role }])).values()];
}

export const CHANNEL_OPTIONS = [
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'telegram', label: 'Telegram' },
  { id: 'instagram', label: 'Instagram' },
];

export function enabledChannels(settings) {
  if (!Array.isArray(settings?.enabled_channels)) return CHANNEL_OPTIONS.map(c => c.id);
  return CHANNEL_OPTIONS.map(c => c.id).filter(id => settings.enabled_channels.includes(id));
}

export function isTenantAuthorized(userId, access, tenants, slug) {
  return Boolean(userId && access.userId === userId && access.loaded && !access.error
    && slug && tenants.some(tenant => tenant.slug === slug));
}

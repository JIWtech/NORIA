export function createAppointmentDataService({ getClient, loadTenant }) {
async function loadAppointmentScheduling(activeTenantSlug) {
  const supabase = getClient();
  if (!supabase) throw new Error('Supabase nao configurado');
  if (!String(activeTenantSlug || '').trim()) throw new Error('Tenant ativo nao informado');
  const tenant = await loadTenant(activeTenantSlug);
  if (!tenant) throw new Error('Tenant nao encontrado');
  const { data, error } = await supabase.from('tenant_settings').select('settings').eq('tenant_id', tenant.id).maybeSingle();
  if (error) throw error;
  const config = data?.settings?.appointment_scheduling;
  if (!config?.enabled) return { enabled: false, tenantId: tenant.id };
  const { data: services, error: catalogError } = await supabase.from('tenant_service_catalog')
    .select('external_id,name,category').eq('tenant_id', tenant.id).eq('active', true);
  if (catalogError) throw catalogError;
  return { ...config, tenantId: tenant.id, services: services || [] };
}

async function loadAppointmentAvailability(tenantId, unitId, serviceId, date) {
  if (!tenantId) throw new Error('Tenant ativo nao informado');
  const { data, error } = await getClient().rpc('magia_appointment_availability', {
    p_tenant: tenantId, p_unit: unitId, p_service: serviceId, p_date: date,
  });
  if (error) throw error;
  return Array.isArray(data?.available_starts) ? data.available_starts : [];
}

async function loadTenantSettings(tenantSlug) {
  const supabase = getClient();
  if (!supabase || !tenantSlug) return null;
  const tenant = await loadTenant(tenantSlug);
  if (!tenant) return null;
  try {
    const { data, error } = await supabase
      .from('tenant_settings')
      .select('timezone, business_hours, settings')
      .eq('tenant_id', tenant.id)
      .maybeSingle();
    if (error) {
      console.warn('Falha ao carregar tenant_settings:', error.message);
      return null;
    }
    return {
      tenantId: tenant.id,
      timezone: data?.timezone || 'America/Sao_Paulo',
      businessHours: (data?.business_hours && Object.keys(data.business_hours).length > 0) ? data.business_hours : null,
      business_hours: (data?.business_hours && Object.keys(data.business_hours).length > 0) ? data.business_hours : null,
      settings: data?.settings || {},
    };
  } catch (e) {
    console.warn('Erro ao carregar tenant_settings:', e);
    return null;
  }
}
return { loadAppointmentScheduling, loadAppointmentAvailability, loadTenantSettings };
}

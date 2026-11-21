import { mapAppointment } from './appointmentPresentation.js';

export function createSaveAppointment({ getClient, loadTenant, currentUserId }) {
async function saveAppointment(activeTenantSlug, appointment) {
  const supabase = getClient();
  if (!supabase) throw new Error('Supabase nao configurado');
  const tenant = await loadTenant(activeTenantSlug);
  if (!tenant) throw new Error('Tenant nao encontrado');
  const userId = await currentUserId();
  if (appointment.unitId) {
    const { data, error } = await supabase.rpc('magia_reserve_appointment', {
      p_tenant: tenant.id, p_unit: appointment.unitId, p_service: appointment.serviceId,
      p_date: appointment.localDate, p_time: appointment.localTime, p_name: appointment.contactName,
      p_chat: appointment.externalConversationId || '', p_request: appointment.requestId,
      p_channel: appointment.channelType || 'manual', p_notes: appointment.notes || null,
    });
    if (error) throw error;
    return mapAppointment(data);
  }
  const { data, error } = await supabase
    .from('appointments')
    .insert({
      tenant_id: tenant.id,
      title: appointment.title,
      starts_at: appointment.startsAt,
      ends_at: appointment.endsAt || null,
      status: appointment.status || 'scheduled',
      contact_name: appointment.contactName || null,
      channel_type: appointment.channelType || 'manual',
      external_conversation_id: appointment.externalConversationId || null,
      notes: appointment.notes || null,
      created_by: userId,
      metadata: appointment.metadata || {},
    })
    .select('*')
    .single();
  if (error) throw error;
  return mapAppointment(data);
}

  return saveAppointment;
}

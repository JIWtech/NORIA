import { mergeOpenAppointmentRequests } from '../appointments/appointmentRequest.js';
import { isGenesisSalesTenant } from '../kanban/commercialStages.js';

export async function findTenantBySlug(supabase, activeTenantSlug) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('tenants')
    .select('id, slug, name')
    .eq('slug', activeTenantSlug)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn('Tenant lookup:', error.message);
    return null;
  }
  return data;
}

// Status que ainda pedem ação (pedido, sinal, agendado ou aguardando desfecho). Entram por consulta
// própria, sem o limite do histórico, para que nenhum agendamento ativo ou futuro suma da tela.
const ACTIVE_APPOINTMENT_STATUSES = ['pending_confirmation', 'payment_reported', 'aguardando_verificacao',
  'scheduled', 'confirmed', 'reserved', 'pending_payment'];
const ACTIVE_APPOINTMENTS_LIMIT = 1000;
const SLOT_PROPOSAL_STATUSES = ['sent', 'rejected', 'superseded'];
const SLOT_PROPOSAL_LIMIT = 100;

export async function loadAppointments(supabase, tenantId, mapAppointment) {
  const { data, error } = await supabase
    .from('appointments')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('starts_at', { ascending: false })
    .limit(200);
  if (error) {
    console.warn('Appointments fallback:', error.message);
    return [];
  }
  const { data: openAppointments, error: openError } = await supabase
    .from('appointments')
    .select('*')
    .eq('tenant_id', tenantId)
    .in('status', ACTIVE_APPOINTMENT_STATUSES)
    .order('starts_at', { ascending: true })
    .limit(ACTIVE_APPOINTMENTS_LIMIT);
  if (openError) console.warn('Active appointments fallback:', openError.message);
  // Pedidos cancelados que carregam uma proposta de horário (enviada, recusada ou substituída): o Kanban mostra o estado
  // no cartão da conversa. Consulta própria para não depender do limite do histórico.
  const { data: proposalAppointments, error: proposalError } = await supabase
    .from('appointments')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('status', 'cancelled')
    .in('metadata->slot_proposal->>status', SLOT_PROPOSAL_STATUSES)
    .order('updated_at', { ascending: false })
    .limit(SLOT_PROPOSAL_LIMIT);
  if (proposalError) console.warn('Slot proposal appointments fallback:', proposalError.message);
  return mergeOpenAppointmentRequests(mergeOpenAppointmentRequests(data || [], openAppointments || []), proposalAppointments || []).map(mapAppointment);
}

export async function loadBroadcastContacts(supabase, tenantId) {
  const { data, error } = await supabase
    .from('broadcast_contacts')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) {
    console.warn('Broadcast contacts fallback:', error.message);
    return [];
  }
  return data || [];
}

export async function loadBroadcastCampaigns(supabase, tenantId) {
  const { data, error } = await supabase
    .from('broadcast_campaigns')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    console.warn('Broadcast campaigns fallback:', error.message);
    return [];
  }
  return data || [];
}

export async function loadKanbanConfig(supabase, tenantId) {
  const { data: board, error: boardError } = await supabase
    .from('kanban_boards')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_default', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (boardError) {
    console.warn('Kanban board fallback:', boardError.message);
    return null;
  }

  if (!board) return null;

  const { data: columns, error: columnsError } = await supabase
    .from('kanban_columns')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('board_id', board.id)
    .order('position', { ascending: true });

  if (columnsError) {
    console.warn('Kanban columns fallback:', columnsError.message);
    return null;
  }

  return {
    board,
    columns: columns || [],
  };
}

export async function loadFollowUpJobs(supabase, tenantId, tenantSlug) {
  if (tenantSlug !== 'clinica_nubia_oficial' && !isGenesisSalesTenant(tenantSlug)) return [];

  const { data, error } = await supabase
    .from('follow_up_jobs')
    .select('id, channel_type, external_conversation_id, contact_name, step_key, objective, due_at, status, created_at')
    .eq('tenant_id', tenantId)
    .in('status', ['pending', 'processing'])
    .order('due_at', { ascending: true })
    .limit(200);

  if (error) {
    // The dashboard remains available until migration 019/020 is published.
    console.warn('Follow-up jobs unavailable:', error.message);
    return [];
  }
  return data || [];
}

import { mergeOpenAppointmentRequests } from '../appointments/appointmentRequest.js';
import { isGenesisSalesTenant } from '../kanban/commercialStages.js';
import { tenantLookupCache, tenantCacheEpoch } from './tenantScopedCaches.js';

export const TENANT_LOOKUP_TTL_MS = 60_000;

export async function findTenantBySlug(supabase, activeTenantSlug) {
  if (!supabase || !activeTenantSlug) return null;
  const epoch = tenantCacheEpoch();
  const cached = tenantLookupCache.get(supabase)?.get(activeTenantSlug);
  if (cached && Date.now() < cached.expiresAt) return cached.data;
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
  if (data && epoch === tenantCacheEpoch()) {
    if (!tenantLookupCache.has(supabase)) tenantLookupCache.set(supabase, new Map());
    tenantLookupCache.get(supabase).set(activeTenantSlug, { data, expiresAt: Date.now() + TENANT_LOOKUP_TTL_MS });
  }
  return epoch === tenantCacheEpoch() ? data : null;
}

// Status que ainda pedem ação (pedido, sinal, agendado ou aguardando desfecho). Entram por consulta
// própria, sem o limite do histórico, para que nenhum agendamento ativo ou futuro suma da tela.
const ACTIVE_APPOINTMENT_STATUSES = ['pending_confirmation', 'payment_reported', 'aguardando_verificacao',
  'scheduled', 'confirmed', 'reserved', 'pending_payment'];
const ACTIVE_APPOINTMENTS_LIMIT = 1000;
const SLOT_PROPOSAL_STATUSES = ['sent', 'rejected', 'superseded'];
const SLOT_PROPOSAL_LIMIT = 100;

export async function loadAppointments(supabase, tenantId, mapAppointment) {
  const [historyResult, openResult, proposalResult] = await Promise.all([
    supabase.from('appointments').select('*').eq('tenant_id', tenantId)
      .order('starts_at', { ascending: false }).limit(200),
    supabase.from('appointments').select('*').eq('tenant_id', tenantId)
      .in('status', ACTIVE_APPOINTMENT_STATUSES)
      .order('starts_at', { ascending: true }).limit(ACTIVE_APPOINTMENTS_LIMIT),
    supabase.from('appointments').select('*').eq('tenant_id', tenantId)
      .eq('status', 'cancelled').in('metadata->slot_proposal->>status', SLOT_PROPOSAL_STATUSES)
      .order('updated_at', { ascending: false }).limit(SLOT_PROPOSAL_LIMIT),
  ]);
  const { data, error } = historyResult;
  const { data: openAppointments, error: openError } = openResult;
  const { data: proposalAppointments, error: proposalError } = proposalResult;
  if (error || openError || proposalError) throw new Error('Não foi possível carregar os agendamentos.');
  return mergeOpenAppointmentRequests(mergeOpenAppointmentRequests(data || [], openAppointments || []), proposalAppointments || [])
    .filter((row) => !row.starts_at || Number.isFinite(new Date(row.starts_at).getTime()))
    .map(mapAppointment);
}

export async function loadBroadcastContacts(supabase, tenantId) {
  const { data, error } = await supabase
    .from('broadcast_contacts')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) {
    throw new Error('Não foi possível carregar os contatos de disparos.');
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
    throw new Error('Não foi possível carregar as campanhas.');
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

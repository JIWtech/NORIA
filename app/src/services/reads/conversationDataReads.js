import { normalizeChannel, normalizeExternalConversationId } from '../identity/conversationIdentity.js';

export async function loadConversationReads(supabase, tenantId, userId) {
  if (!supabase || !tenantId || !userId) return [];
  const { data, error } = await supabase
    .from('conversation_reads')
    .select('tenant_id, user_id, channel_type, external_conversation_id, last_read_event_id, last_read_at, created_at, updated_at')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .limit(500);
  if (error) {
    throw new Error('Não foi possível carregar as leituras.');
  }
  return data || [];
}

export async function markConversationRead(supabase, { tenantId, channelType, externalConversationId, lastReadEventId }) {
  if (!supabase) throw new Error('Supabase nao configurado');
  if (!tenantId) throw new Error('Tenant ativo nao informado');
  const { data, error } = await supabase.rpc('mark_conversation_read', {
    p_tenant_id: tenantId,
    p_channel_type: normalizeChannel(channelType).type,
    p_external_conversation_id: normalizeExternalConversationId(channelType, externalConversationId),
    p_last_read_event_id: lastReadEventId,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] || null : data || null;
}

import { normalizeChannel, normalizeExternalConversationId } from '../identity/conversationIdentity.js';

export async function loadRelevantContacts(supabase, tenantId, events = [], broadcastContacts = []) {
  if (!supabase || !tenantId) return [];
  const handles = new Set();
  for (const entry of [...(events || []), ...(broadcastContacts || [])]) {
    const channel = entry.channel_type || entry.channelType;
    const handle = entry.external_conversation_id || entry.externalConversationId || entry.contact_handle;
    if (normalizeChannel(channel).type !== 'whatsapp') continue;
    const normalized = normalizeExternalConversationId(channel, handle);
    if (normalized) handles.add(normalized);
  }
  if (!handles.size) return [];
  const columns = ['id', 'tenant_id', 'name', 'source_channel', 'external_handle', 'avatar_url'].join(', ');
  const requested = [...handles];
  const batches = [];
  for (let start = 0; start < requested.length; start += 200) batches.push(requested.slice(start, start + 200));
  const results = new Array(batches.length);
  let nextBatch = 0;
  async function loadBatch() {
    while (nextBatch < batches.length) {
      const index = nextBatch++;
      const { data, error } = await supabase
        .from('contacts')
        .select(columns)
        .eq('tenant_id', tenantId)
        .eq('source_channel', 'whatsapp')
        .is('deleted_at', null)
        .in('external_handle', batches[index])
        .order('created_at', { ascending: true })
        .order('id', { ascending: true });
      if (error) {
        console.warn('Contact directory fallback:', error.message);
        results[index] = [];
      } else {
        results[index] = data || [];
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, batches.length) }, () => loadBatch()));
  return results.flat();
}

// Kept for narrow legacy callers. Conversation loading uses loadRelevantContacts.
export async function loadContactAvatars(supabase, tenantId) {
  const contactAvatarColumns = [
    'tenant_id',
    'source_channel',
    'external_handle',
    'avatar_url',
  ].join(', ');
  const { data, error } = await supabase
    .from('contacts')
    .select(contactAvatarColumns)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .not('external_handle', 'is', null)
    .limit(1000);
  if (error) {
    // A interface continua disponível mesmo se a query falhar
    console.warn('Contact avatars fallback:', error.message);
    return [];
  }
  return data || [];
}

import { getAuthClient } from '../auth/authService.js';
import { eventsToConversations } from './eventsToConversations.js';
import { CHANNEL_EVENT_COLUMNS } from './channelEventColumns.js';

export function buildConversationIdVariants(rawId) {
  if (!rawId) return [];
  const str = String(rawId).trim();
  if (/@(?:g\.us|lid|broadcast)$/i.test(str)) return [str];
  const variants = new Set([str]);

  const clean = str.replace(/@(s\.whatsapp\.net|c\.us)$/i, '').split(':')[0].replace(/\D/g, '');
  if (clean) {
    variants.add(clean);
    variants.add(`${clean}@s.whatsapp.net`);
    variants.add(`${clean}:0@s.whatsapp.net`);

    // Variação do 9º dígito brasileiro
    if (clean.startsWith('55') && clean.length === 12 && ['6', '7', '8', '9'].includes(clean[4])) {
      const with9 = `55${clean.slice(2, 4)}9${clean.slice(4)}`;
      variants.add(with9);
      variants.add(`${with9}@s.whatsapp.net`);
      variants.add(`${with9}:0@s.whatsapp.net`);
    } else if (clean.startsWith('55') && clean.length === 13 && clean[4] === '9') {
      const without9 = `55${clean.slice(2, 4)}${clean.slice(5)}`;
      variants.add(without9);
      variants.add(`${without9}@s.whatsapp.net`);
      variants.add(`${without9}:0@s.whatsapp.net`);
    }
  }

  return Array.from(variants);
}

/**
 * Carrega até 1000 eventos recentes de uma conversa específica sob demanda.
 * Evita o truncamento pelo limite global da página e permite que o atendente
 * role o chat; os anexos são resolvidos sob demanda pelo componente de mídia.
 *
 * @param {string} tenantSlug
 * @param {string} externalConversationId
 * @returns {Promise<Array>} Lista cronológica de mensagens formatadas
 */
export async function loadConversationFullHistory(tenantSlug, externalConversationId, supabase = getAuthClient()) {
  if (!supabase || !tenantSlug || !externalConversationId) return [];

  const variants = buildConversationIdVariants(externalConversationId);

  const { data, error } = await supabase
    .from('channel_events')
    .select(CHANNEL_EVENT_COLUMNS)
    .eq('tenant_slug', tenantSlug)
    .in('external_conversation_id', variants)
    .order('created_at', { ascending: false })
    .limit(1000);

  if (error || !Array.isArray(data)) {
    console.warn('Erro ao carregar histórico completo da conversa:', error?.message);
    throw error || new Error('Histórico indisponível');
  }

  // MediaAttachment resolves only mounted attachments, without blocking the text history.
  const convs = eventsToConversations(data, tenantSlug);
  if (!convs.length) return [];

  // Se houver mais de um bucket gerado (por exemplo, transição de canal ou handle),
  // consolida todas as mensagens dos buckets correspondentes aos IDs da conversa
  const allMessages = [];
  const seenKeys = new Set();

  for (const conv of convs) {
    for (const msg of (conv.messages || [])) {
      const key = msg.eventId || `${msg.createdAt || msg.at}-${msg.from}-${msg.text}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        allMessages.push(msg);
      }
    }
  }

  // Ordena estritamente cronológico
  allMessages.sort((a, b) => {
    const tA = a.createdAt ? Date.parse(a.createdAt) : 0;
    const tB = b.createdAt ? Date.parse(b.createdAt) : 0;
    return (Number.isNaN(tA) ? 0 : tA) - (Number.isNaN(tB) ? 0 : tB);
  });

  return allMessages;
}

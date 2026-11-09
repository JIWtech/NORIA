// Lista de bloqueio de disparos no painel. A chave segue public.broadcast_contact_key:
// só remove o sufixo técnico de JID do WhatsApp e normaliza caixa/espaços (parsing de formato).
export function broadcastContactKey(external) {
  return String(external || '').trim().replace(/@(s\.whatsapp\.net|c\.us)$/i, '').toLowerCase();
}

function contactChannel(contact) {
  return String(contact?.channelType || contact?.channel_type || '').toLowerCase();
}

function contactExternal(contact) {
  return contact?.externalConversationId || contact?.external_conversation_id || '';
}

export function optOutIndex(rows = []) {
  return new Set((rows || []).map((row) => `${String(row.channel_type || '').toLowerCase()}|${row.contact_key}`));
}

export function isContactOptedOut(contact, index) {
  const key = broadcastContactKey(contactExternal(contact));
  return Boolean(key) && index.has(`${contactChannel(contact)}|${key}`);
}

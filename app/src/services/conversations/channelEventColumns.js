// Contrato usado pelos consumidores de conversas, Kanban e mídia. O JSON bruto
// permanece até que suas variantes legadas possam ser projetadas com segurança.
export const CHANNEL_EVENT_COLUMNS = [
  'id', 'tenant_id', 'tenant_slug', 'channel_type', 'external_conversation_id',
  'external_message_id', 'direction', 'contact_name', 'contact_handle', 'message_text',
  'service', 'stage', 'handoff', 'response_text', 'raw_payload', 'created_at',
  'ai_provider', 'sender_type', 'sent_by_user', 'delivery_status', 'request_id',
].join(',');

export function isExplicitOutboundMedia(media = {}, payload = {}, event = {}) {
  if (event.service === 'retail_product_photo' && event.sender_type === 'assistant') return true;
  const origins = [
    media.origin, media.source, media.direction, media.message_origin,
    payload.media_origin, payload.media_source, payload.outbound_origin,
    payload.magia_operator?.source, payload.magia_operator?.media?.source,
  ].map((value) => String(value || '').toLowerCase());
  if (origins.some((origin) => ['outbound', 'outbound_media', 'operator', 'manual_reply', 'assistant', 'whatsapp_fromme', 'from_me'].includes(origin))) {
    return true;
  }

  const mediaEventId = media.event_id || media.eventId || media.source_event_id || media.sourceEventId;
  if (event.id && mediaEventId && String(event.id) === String(mediaEventId)) return true;

  const mediaMessageId = media.external_message_id || media.externalMessageId || media.message_id || media.messageId;
  if (event.external_message_id && mediaMessageId && String(event.external_message_id) === String(mediaMessageId)) return true;

  return Boolean(payload.fromMe || payload.data?.key?.fromMe);
}

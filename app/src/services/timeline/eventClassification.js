function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/**
 * Eventos operacionais permanecem no log para auditoria, mas não representam
 * uma mensagem de conversa nem podem seguir para um provedor de canal.
 *
 * `ai_provider: kanban_action` e `service: kanban_move` cobrem os registros
 * legados criados antes da classificação explícita em raw_payload.
 */
export function isInternalOperationalEvent(event = {}) {
  const payload = asObject(event.raw_payload);
  const metadata = asObject(event.metadata);
  const eventType = String(
    event.event_type
    || payload.event_type
    || metadata.event_type
    || ''
  ).trim();
  const category = String(
    event.event_category
    || payload.event_category
    || metadata.event_category
    || ''
  ).trim();
  const isInternal = event.is_internal === true
    || payload.is_internal === true
    || metadata.is_internal === true;

  return eventType === 'kanban_stage_changed'
    || (event.service === 'noria_pipeline_pin' && event.delivery_status === 'internal')
    || event.ai_provider === 'kanban_action'
    || event.service === 'kanban_move'
    || (isInternal && category === 'kanban');
}

export function isEligibleForExternalOutbound(event = {}) {
  return !isInternalOperationalEvent(event);
}

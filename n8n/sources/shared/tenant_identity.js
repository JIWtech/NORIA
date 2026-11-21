// Funções puras projetadas nos nós n8n; manter autocontidas.
function normalizeInstanceKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

function channelMatchesInstance(channel, instance) {
  const expected = normalizeInstanceKey(instance);
  if (!expected) return false;
  const config = channel?.config && typeof channel.config === 'object' ? channel.config : {};
  return [channel?.external_id, config.instance_name, config.instance, config.evolution_instance, config.instance_id, config.instanceId]
    .filter(Boolean).map(normalizeInstanceKey).includes(expected);
}

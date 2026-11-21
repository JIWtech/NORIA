import { CHANNEL_OPTIONS } from '../../../services/tenants/tenantAccess.js';

export function getDefaultBroadcastChannel(allowedChannels = []) {
  const list = Array.isArray(allowedChannels) ? allowedChannels : [];
  if (list.includes('telegram')) return 'telegram';
  return list[0] || 'whatsapp';
}

export function resolveActiveBroadcastChannel(selectedChannel, allowedChannels = []) {
  const list = Array.isArray(allowedChannels) ? allowedChannels : [];
  if (selectedChannel && list.includes(selectedChannel)) return selectedChannel;
  return getDefaultBroadcastChannel(list);
}

export function getBroadcastChannelOptions(allowedChannels = []) {
  const list = Array.isArray(allowedChannels) ? allowedChannels : [];
  return CHANNEL_OPTIONS.filter((option) => list.includes(option.id));
}

export function filterContactsForChannel(contacts = [], allowedChannels = [], activeChannel = '') {
  const list = Array.isArray(contacts) ? contacts : [];
  const allowed = Array.isArray(allowedChannels) ? allowedChannels : [];
  const hasChannel = allowed.length > 0;
  return list.filter((contact) => {
    const channel = contact?.channelType || contact?.channel_type || activeChannel;
    if (!allowed.includes(channel)) return false;
    return !hasChannel || !activeChannel || channel === activeChannel;
  });
}

export function buildBroadcastCampaignPayload({
  campaignName = '',
  messageText = '',
  activeChannel,
  recipients = [],
  now = new Date(),
}) {
  const text = String(messageText || '').trim();
  const list = Array.isArray(recipients) ? recipients : [];
  return {
    name: String(campaignName || '').trim() || `Disparo ${now.toLocaleDateString('pt-BR')}`,
    message_template: text,
    messageText: text,
    channelType: activeChannel,
    total_recipients: list.length,
    status: 'draft',
  };
}

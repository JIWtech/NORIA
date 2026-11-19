import { normalizeChannel, normalizeExternalConversationId } from '../identity/conversationIdentity.js';

export function contactAvatarKey(channel, externalHandle, tenantId = '') {
  const normChannel = normalizeChannel(channel).type || 'unknown';
  const normHandle = normalizeExternalConversationId(normChannel, externalHandle) || String(externalHandle || '').trim().toLowerCase();
  const tenantPrefix = tenantId ? `${String(tenantId).trim().toLowerCase()}:` : '';
  return `${tenantPrefix}${normChannel}:${normHandle}`;
}

// Links de foto do WhatsApp (pps.whatsapp.net) trazem o vencimento em `oe` (timestamp Unix em hexadecimal).
// Depois disso o CDN responde erro e o painel cairia nas iniciais.
export function avatarUrlExpired(value, now = Date.now()) {
  if (!value || typeof value !== 'string') return false;
  const match = /[?&]oe=([0-9a-f]+)/i.exec(value);
  if (!match) return false;
  const expiresAt = parseInt(match[1], 16) * 1000;
  return Number.isFinite(expiresAt) && expiresAt <= now;
}

export function normalizeAvatarUrl(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || !/^https:\/\//i.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' || !parsed.hostname) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

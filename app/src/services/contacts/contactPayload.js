import { asObject } from '../../utils/asObject.js';
import { avatarUrlExpired, normalizeAvatarUrl } from './contactIdentity.js';

export function extractPayloadAvatar(event) {
  if (!event) return null;
  const payload = asObject(event.raw_payload);
  const contactAvatar = asObject(payload.contact_avatar);
  const candidate = (
    contactAvatar.avatarUrl
    || contactAvatar.avatar_url
    || payload.avatarUrl
    || payload.avatar_url
    || payload.profilePictureUrl
    || null
  );
  // Foto antiga gravada no payload da mensagem: se já venceu, não serve mais.
  return avatarUrlExpired(candidate) ? null : normalizeAvatarUrl(candidate);
}

export function extractAvatarUrlFromEvent(event) {
  if (!event) return null;
  const directoryAvatar = avatarUrlExpired(event.avatar_url) ? null : normalizeAvatarUrl(event.avatar_url);
  return directoryAvatar || extractPayloadAvatar(event) || null;
}

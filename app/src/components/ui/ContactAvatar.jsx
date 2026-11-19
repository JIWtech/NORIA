import React, { useState, useEffect } from 'react';
import { UserRound } from 'lucide-react';
import { normalizeAvatarUrl } from '../../dataService';
import { avatarUrlExpired } from '../../services/contacts/contactIdentity.js';
import { buildContactAvatarClasses } from '../../features/conversations/utils/chatTimelineHelpers';
import { getChannelClass } from './ChannelIcon';

export function getInitials(name) {
  if (!name || !/\p{L}/u.test(String(name))) return '';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export function ContactAvatar({ name, avatarUrl, className = '' }) {
  const [failed, setFailed] = useState(false);
  // Link do WhatsApp já vencido só geraria uma requisição com erro: mostra as iniciais direto.
  const validUrl = avatarUrlExpired(avatarUrl) ? null : normalizeAvatarUrl(avatarUrl);

  useEffect(() => {
    setFailed(false);
  }, [validUrl, name]);

  const hasImage = Boolean(validUrl && !failed);
  const containerClass = buildContactAvatarClasses(className, hasImage);

  if (hasImage) {
    return (
      <div className={containerClass}>
        <img
          src={validUrl}
          alt={name ? `Foto de perfil de ${name}` : ''}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      </div>
    );
  }
  const initials = getInitials(name);
  return (
    <div className={`${containerClass} avatar-tone-${Array.from(String(name || '')).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 6}`}>
      {initials || <UserRound size={18} aria-label="Contato sem foto" />}
    </div>
  );
}

export function ContactAvatarBadge({ channel, presence = null }) {
  const channelType = channel || 'whatsapp';
  const channelClass = getChannelClass(channelType);
  const channelLabel = String(channelType).toLowerCase().includes('telegram')
    ? 'Telegram'
    : String(channelType).toLowerCase().includes('insta')
      ? 'Instagram'
      : 'WhatsApp';

  // Nota de integridade de dados:
  // O Supabase e as APIs/webhooks de mensageria (ex: WhatsApp) não fornecem dados de presença
  // de contatos (online/offline). O indicador visual atua como um pip discreto (6–8px) indicando
  // o canal de atendimento de origem sem fingir que o contato está online.
  // Caso futuramente seja conectada uma fonte de presença real, os estados 'online' e 'offline'
  // já estão prontos estruturalmente.
  const title = presence === 'online'
    ? 'Contato online'
    : presence === 'offline'
      ? 'Contato offline'
      : `Canal: ${channelLabel}`;

  const presenceClass = presence === 'online'
    ? 'presence-online'
    : presence === 'offline'
      ? 'presence-offline'
      : 'presence-unknown';

  return (
    <span
      className={`channel-avatar-badge ${channelClass} ${presenceClass}`}
      title={title}
      aria-label={title}
      role="status"
    />
  );
}

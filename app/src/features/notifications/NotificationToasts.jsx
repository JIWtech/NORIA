import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { ContactAvatar } from '../../components/ui/ContactAvatar.jsx';
import { ChannelIcon } from '../../components/ui/ChannelIcon.jsx';
import { findNotificationConversation } from './operatorEvents.js';
import { isUsefulContactName } from '../../services/contacts/contactNames.js';
import { groupToasts, MAX_VISIBLE_TOASTS, TOAST_VISIBLE_MS } from './toastGroups.js';
import './notificationToasts.css';

// O canal vira um atributo próprio (data-channel): as classes .channel-* do app pintam fundo e texto de verde.
const channelKey = channel => { const type = String(channel || '').toLowerCase(); return type.includes('insta') ? 'instagram' : type.includes('telegram') ? 'telegram' : type.includes('whats') || type.includes('zap') ? 'whatsapp' : 'other'; };
const channelNames = { whatsapp: 'WhatsApp', instagram: 'Instagram', telegram: 'Telegram' };

const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function Toast({ group, conversation, onOpen, onDismiss }) {
  const { latest, items } = group;
  const channel = channelKey(latest.channel);
  const channelName = channelNames[channel] || 'Mensagem';
  const contact = conversation?.contact || (isUsefulContactName(latest.contact) ? latest.contact : '') || 'Cliente';
  const count = items.length;

  // A barra de tempo só anima com movimento permitido; sem ele, um temporizador fecha o aviso.
  useEffect(() => {
    if (!prefersReducedMotion()) return undefined;
    const timer = setTimeout(() => onDismiss(group), TOAST_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [count]);

  return <div className="notification-toast" data-channel={channel} role="group" aria-label={`Nova mensagem de ${contact} no ${channelName}`}>
    <button type="button" className="notification-toast-main" onClick={() => onOpen(group, conversation)}
      aria-label={`Abrir conversa com ${contact}`}>
      <span className="notification-toast-avatar">
        <ContactAvatar name={contact} avatarUrl={conversation?.avatarUrl} />
        <span className="notification-toast-badge" aria-hidden="true"><ChannelIcon channel={latest.channel} size={11} /></span>
      </span>
      <span className="notification-toast-body">
        <span className="notification-toast-head">
          <strong>{contact}</strong>
          <span className="notification-toast-meta">{count > 1 ? `${count} mensagens` : 'agora'}</span>
        </span>
        <span className="notification-toast-bubble">{latest.description}</span>
      </span>
    </button>
    <button type="button" className="notification-toast-close" onClick={() => onDismiss(group)} aria-label="Dispensar aviso"><X size={14} /></button>
    <span key={count} className="notification-toast-progress" aria-hidden="true"
      style={{ animationDuration: `${TOAST_VISIBLE_MS}ms` }} onAnimationEnd={() => onDismiss(group)} />
  </div>;
}

export function NotificationToasts({ toasts, conversations = [], onOpen, onDismiss }) {
  const groups = useMemo(() => groupToasts(toasts).slice(0, MAX_VISIBLE_TOASTS), [toasts]);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !groups.length || typeof document === 'undefined') return null;
  return createPortal(<div className="notification-toast-stack" role="status" aria-live="polite">
    {groups.map(group => <Toast key={group.key} group={group}
      conversation={findNotificationConversation(group.latest, conversations)} onOpen={onOpen} onDismiss={onDismiss} />)}
  </div>, document.body);
}

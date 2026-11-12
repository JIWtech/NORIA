import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageCircle, X } from 'lucide-react';
import { ContactAvatar } from '../../components/ui/ContactAvatar.jsx';
import { findNotificationConversation } from './operatorEvents.js';
import { isUsefulContactName } from '../../services/contacts/contactNames.js';
import { groupToasts, MAX_VISIBLE_TOASTS, TOAST_VISIBLE_MS } from './toastGroups.js';
import './notificationToasts.css';

function Toast({ group, conversation, onOpen, onDismiss }) {
  const { latest, items } = group;
  const paused = useRef(false);
  const timer = useRef(null);
  const contact = conversation?.contact || (isUsefulContactName(latest.contact) ? latest.contact : '') || 'Cliente';
  const start = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { if (!paused.current) onDismiss(group); else start(); }, TOAST_VISIBLE_MS);
  };
  // Cada mensagem nova da mesma conversa reinicia o tempo do pop-up.
  useEffect(() => { start(); return () => clearTimeout(timer.current); }, [items.length]);

  return <div className="notification-toast" role="group" aria-label={`Nova mensagem de ${contact}`}
    onMouseEnter={() => { paused.current = true; }} onMouseLeave={() => { paused.current = false; }}>
    <button type="button" className="notification-toast-main" onClick={() => onOpen(group, conversation)}
      aria-label={`Abrir conversa com ${contact}`}>
      <span className="notification-toast-avatar">
        <ContactAvatar name={contact} avatarUrl={conversation?.avatarUrl} />
        <span className="notification-toast-badge" aria-hidden="true"><MessageCircle size={10} strokeWidth={2.4} /></span>
      </span>
      <span className="notification-toast-text">
        <strong>{contact}{items.length > 1 && <em>{items.length} mensagens novas</em>}</strong>
        <span>{latest.description}</span>
      </span>
    </button>
    <button type="button" className="notification-toast-close" onClick={() => onDismiss(group)} aria-label="Dispensar aviso"><X size={14} /></button>
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

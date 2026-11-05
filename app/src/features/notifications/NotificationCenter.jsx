import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertCircle, Bell, CalendarDays, Check, CheckCheck, ChevronRight, CircleCheck, MessageSquare, RefreshCw, TrendingUp, UsersRound, Volume2, VolumeX, X } from 'lucide-react';
import { useNotifications } from './useNotifications.js';
import { humanReplyStatus, incidentPresentation } from './notificationService.js';
import { findNotificationConversation, notificationScope } from './operatorEvents.js';
import { useOperatorNotifications } from './useOperatorNotifications.js';
import { useNotificationSound } from './useNotificationSound.js';
import { isUsefulContactName } from '../../services/contacts/contactNames.js';
import { ContactAvatar } from '../../components/ui/ContactAvatar.jsx';
import './notifications.css';

const EMPTY = [];
const categoryIcons = { conversations: MessageSquare, leads: TrendingUp, appointments: CalendarDays, campaigns: UsersRound, attention: AlertCircle };
const categoryLabels = { conversations: 'Conversas', leads: 'Leads', appointments: 'Agenda', campaigns: 'Campanhas', attention: 'Atendimento' };
const pageForCategory = { leads: 'kanban', appointments: 'agendamentos', campaigns: 'disparos', conversations: 'conversas', attention: 'conversas' };

function relativeTime(value) {
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  if (Number.isNaN(diff)) return '';
  if (diff < 60_000) return 'agora';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min`;
  const today = new Date();
  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === today.toDateString()) return time;
  today.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return `Ontem ${time}`;
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export function NotificationCenter({ tenantId, tenantSlug, userId, tenantName, conversations = EMPTY, appointments = EMPTY, kanbanColumns = EMPTY, onOpenConversation, onOpenPage }) {
  const inbox = useNotifications(tenantId, userId);
  const activity = useOperatorNotifications({ tenantId, tenantSlug, userId, appointments, kanbanColumns });
  const sound = useNotificationSound(notificationScope(tenantId, userId));
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('all');
  const [category, setCategory] = useState('all');
  const [expanded, setExpanded] = useState(() => new Set());
  const root = useRef(null);
  const bell = useRef(null);
  const closeButton = useRef(null);
  const panelId = useId();
  const titleId = useId();
  const previousSoundSequence = useRef(0);
  const remoteSeen = useRef(null);
  const mountedAt = useRef(Date.now());

  useEffect(() => {
    if (activity.soundSequence !== previousSoundSequence.current) {
      previousSoundSequence.current = activity.soundSequence;
      sound.play();
    }
  }, [activity.soundSequence, sound.play]);

  useEffect(() => {
    if (inbox.loading || inbox.error || inbox.isOlderPage) return;
    const next = new Map(inbox.items.map(item => [item.id, item.revision]));
    if (remoteSeen.current && inbox.items.some(item => item.unread && (remoteSeen.current.get(item.id) || 0) < item.revision
      && Date.parse(item.updated_at || item.created_at) >= mountedAt.current)) sound.play();
    remoteSeen.current = next;
  }, [inbox.items, inbox.loading, inbox.error, inbox.isOlderPage, sound.play]);

  useEffect(() => {
    if (!open) return undefined;
    closeButton.current?.focus();
    const outside = event => { if (!root.current?.contains(event.target)) setOpen(false); };
    const escape = event => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); bell.current?.focus(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);

  const items = useMemo(() => [...activity.items, ...inbox.items.map(item => {
    const presentation = incidentPresentation(item, humanReplyStatus(item, inbox.replies, tenantId, inbox.checkedAt));
    return { id: `inbox:${item.id}`, remote: item, title: presentation.title, description: presentation.description,
      category: 'attention', attention: presentation.attention ?? !item.resolved_at, overdue: Boolean(presentation.overdue),
      unread: item.unread, chatId: item.chat_id, channel: item.channel_type,
      createdAt: item.updated_at || item.created_at, resolved: Boolean(item.resolved_at) };
  })].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), [activity.items, inbox.items, inbox.replies, inbox.checkedAt, tenantId]);
  const unread = activity.items.filter(item => item.unread).length + (inbox.unread || 0);
  const filtered = items.filter(item => (filter !== 'unread' || item.unread) && (filter !== 'attention' || item.attention)
    && (category === 'all' || item.category === category));
  const groups = useMemo(() => {
    const map = new Map();
    for (const item of filtered) {
      const conversation = findNotificationConversation(item, conversations);
      const contact = conversation?.contact || (isUsefulContactName(item.contact) ? item.contact : '');
      const key = conversation ? `conv:${conversation.id}` : item.chatId ? `chat:${item.channel || 'whatsapp'}:${item.chatId}` : `cat:${item.category}`;
      if (!map.has(key)) map.set(key, { key, conversation, contact, category: item.category, items: [], unread: 0, latest: item.createdAt });
      const group = map.get(key);
      group.items.push(item);
      if (item.unread) group.unread += 1;
    }
    return [...map.values()];
  }, [filtered, conversations]);
  const toggleGroup = key => setExpanded(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const markRead = item => item.remote ? inbox.markRead(item.remote) : activity.markRead(item.id);
  const markAll = () => { activity.markAllRead(); if (!inbox.error && !inbox.syncing && inbox.unread > 0) void inbox.markAllRead(); };
  const close = () => { setOpen(false); bell.current?.focus(); };

  return (
    <div className="notification-center" ref={root}>
      <button ref={bell} className={`icon-button notification-bell ${open ? 'is-active' : ''}`} type="button"
        aria-label={`Central de notificações, ${unread} não lidas`} aria-expanded={open} aria-controls={panelId} aria-haspopup="dialog"
        title="Central de notificações" onClick={() => setOpen(value => !value)}>
        <Bell size={18} aria-hidden="true" />
        {unread > 0 && <span className="notification-badge" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
      </button>
      <span className="notification-sr-only" role="status" aria-live="polite">{activity.soundSequence > 0 ? 'Novos avisos na central de notificações.' : ''}</span>
      {open && <section id={panelId} role="dialog" aria-labelledby={titleId} className="notification-popover">
        <header className="notification-heading">
          <div><p className="notification-eyebrow">{tenantName || 'Sua equipe'}</p><h2 id={titleId}>Central de notificações</h2></div>
          <button ref={closeButton} className="icon-button" type="button" aria-label="Fechar notificações" onClick={close}><X size={18} /></button>
        </header>
        <div className="notification-tools">
          <button type="button" className="notification-text-button" onClick={sound.toggle} aria-pressed={sound.enabled}
            title={sound.enabled ? 'Silenciar notificações' : 'Ativar som de notificação'}>
            {sound.enabled ? <Volume2 size={16} /> : <VolumeX size={16} />}<span>{sound.enabled ? 'Som ativado' : 'Som desativado'}</span>
          </button>
          <button type="button" className="notification-text-button" onClick={markAll} disabled={!unread}>
            <CheckCheck size={16} /><span>Marcar todas como lidas</span>
          </button>
        </div>
        {sound.enabled && !sound.ready && <p className="notification-sound-hint">O som será liberado ao interagir com a página.</p>}
        <div className="notification-filters" role="group" aria-label="Filtrar notificações">
          {[['all', 'Todas'], ['unread', 'Não lidas'], ['attention', 'Atenção']].map(([value, label]) =>
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}{value === 'unread' && unread > 0 ? ` (${unread})` : ''}</button>)}
          <select value={category} onChange={event => setCategory(event.target.value)} aria-label="Tipo de notificação">
            <option value="all">Todos os tipos</option>{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="notification-scroll" aria-busy={inbox.loading}>
          {inbox.error && <div className="notification-sync-note" role="status"><span>{inbox.error} Os novos avisos de atividade continuam disponíveis.</span>
            <button type="button" disabled={inbox.syncing} onClick={inbox.refresh} aria-label="Atualizar histórico de notificações"><RefreshCw size={15} /></button></div>}
          {inbox.loading && !items.length && <p className="notification-message" role="status">Buscando seus avisos…</p>}
          {!filtered.length && !inbox.loading && <div className="notification-empty"><Bell size={28} aria-hidden="true" /><p>{filter === 'unread' ? 'Nenhum aviso não lido nesta lista' : filter === 'attention' ? 'Nenhum aviso de atenção por aqui' : 'Nenhum aviso por aqui'}</p><span>Mensagens, leads e compromissos da equipe aparecem nesta central.</span></div>}
          <ul className="notification-list">
            {groups.map(group => {
              const GroupIcon = categoryIcons[group.category] || Bell;
              const isOpen = expanded.has(group.key);
              const visible = isOpen ? group.items : group.items.slice(0, 1);
              const hidden = group.items.length - visible.length;
              const canOpen = Boolean(group.conversation && onOpenConversation || onOpenPage);
              const groupName = group.contact || categoryLabels[group.category] || 'Avisos';
              const openGroup = () => {
                group.items.filter(entry => entry.unread).forEach(entry => { void markRead(entry); });
                if (group.conversation && onOpenConversation) onOpenConversation(group.conversation.id);
                else onOpenPage?.(pageForCategory[group.category] || 'conversas');
                close();
              };
              return <li key={group.key} className={`notification-group ${group.unread ? 'has-unread' : ''}`}>
                <div className="notification-group-head">
                  {group.conversation || group.contact
                    ? <ContactAvatar name={groupName} avatarUrl={group.conversation?.avatarUrl} className="notification-avatar" />
                    : <span className={`notification-type ${group.category}`}><GroupIcon size={18} aria-hidden="true" /></span>}
                  <div className="notification-group-id">
                    <strong>{groupName}</strong>
                    <span>{group.items.length} aviso{group.items.length > 1 ? 's' : ''}{group.unread ? ` · ${group.unread} novo${group.unread > 1 ? 's' : ''}` : ''}</span>
                  </div>
                  <time dateTime={group.latest}>{relativeTime(group.latest)}</time>
                  {canOpen && <button type="button" className="notification-open-btn" onClick={openGroup} aria-label={`Abrir ${groupName}`}><ChevronRight size={16} /></button>}
                </div>
                <ul className="notification-group-items">
                  {visible.map(item => {
                    const Icon = item.resolved ? CircleCheck : categoryIcons[item.category] || Bell;
                    return <li key={item.id} className={`notification-entry ${item.unread ? 'is-unread' : 'is-read'}${item.overdue ? ' is-overdue' : ''}`}>
                      <span className={`notification-entry-icon ${item.attention ? 'attention' : item.resolved ? 'resolved' : item.category}`}><Icon size={14} aria-hidden="true" /></span>
                      <div className="notification-entry-body">
                        <p className="notification-entry-title">{item.title}{item.unread && <span className="notification-unread-dot" aria-label="Não lida" />}</p>
                        {item.description && <p className="notification-desc">{item.description}</p>}
                        <div className="notification-meta"><span>{categoryLabels[item.category]}</span><time dateTime={item.createdAt}>{relativeTime(item.createdAt)}</time>
                          {item.unread && <button type="button" className="notification-action-btn secondary" disabled={Boolean(item.remote && (inbox.syncing || inbox.error))} onClick={() => void markRead(item)}><Check size={12} />Lida</button>}
                        </div>
                      </div>
                    </li>;
                  })}
                </ul>
                {(hidden > 0 || isOpen && group.items.length > 1) && <button type="button" className="notification-group-toggle" aria-expanded={isOpen} onClick={() => toggleGroup(group.key)}>
                  {isOpen ? 'Mostrar menos' : `Ver mais ${hidden} aviso${hidden > 1 ? 's' : ''}`}
                </button>}
              </li>;
            })}
          </ul>
          {inbox.hasMore && <button className="notification-more secondary-button" type="button" disabled={inbox.syncing} onClick={inbox.loadMore}>Ver avisos anteriores</button>}
          {inbox.isOlderPage && <button className="notification-more secondary-button" type="button" disabled={inbox.syncing} onClick={inbox.showLatest}>Voltar aos recentes</button>}
        </div>
        <footer className="notification-footer">{unread ? `${unread} aviso${unread > 1 ? 's' : ''} ainda não lido${unread > 1 ? 's' : ''}` : inbox.error ? 'Avisos de atividade da sua equipe.' : 'Você está em dia com os avisos recebidos.'}</footer>
      </section>}
    </div>
  );
}

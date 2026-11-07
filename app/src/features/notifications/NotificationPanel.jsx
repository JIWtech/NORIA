import React, { useEffect, useId, useRef, useState } from 'react';
import {
  AlertCircle, Bell, Bot, CalendarCheck, CalendarClock, CalendarDays, CalendarX, Check, CheckCheck,
  ChevronDown, ChevronRight, CircleCheck, Flame, Headset, MessageCircle, MessageSquareReply, Paperclip,
  Receipt, RefreshCw, RotateCcw, Send, Settings2, TrendingUp, UserRoundCheck, UserRoundPlus, UsersRound,
  Volume2, VolumeX, Wifi, X,
} from 'lucide-react';
import { findNotificationConversation } from './operatorEvents.js';
import { isUsefulContactName } from '../../services/contacts/contactNames.js';
import './notifications.css';

const categories = {
  conversations: { label: 'Conversas', icon: MessageCircle },
  leads: { label: 'Leads', icon: TrendingUp, tone: 'positive' },
  appointments: { label: 'Agenda', icon: CalendarDays, tone: 'agenda' },
  campaigns: { label: 'Campanhas', icon: UsersRound, tone: 'agenda' },
  attention: { label: 'Atendimento', icon: Headset, tone: 'attention' },
};
const eventIcons = {
  message: { icon: MessageCircle },
  assignment: { icon: UserRoundCheck },
  handoff: { icon: Headset, tone: 'attention' },
  waiting: { icon: Headset, tone: 'attention' },
  overdue: { icon: Headset, tone: 'attention' },
  review: { icon: Headset, tone: 'attention' },
  answered: { icon: MessageSquareReply, tone: 'positive' },
  resumed: { icon: Bot },
  closed: { icon: CircleCheck, tone: 'positive' },
  reopened: { icon: RotateCcw },
  delivery: { icon: Send, tone: 'attention' },
  uncertain: { icon: Send, tone: 'attention' },
  attachment: { icon: Paperclip, tone: 'attention' },
  interrupted: { icon: AlertCircle, tone: 'attention' },
  connection: { icon: Wifi },
  'appointment-request': { icon: CalendarClock, tone: 'agenda' },
  reminder: { icon: CalendarClock, tone: 'agenda' },
  'appointment-cancelled': { icon: CalendarX, tone: 'agenda' },
  payment: { icon: Receipt, tone: 'attention' },
  'deposit-review': { icon: Receipt, tone: 'attention' },
  'payment-confirmed': { icon: Receipt, tone: 'positive' },
  lead: { icon: UserRoundPlus, tone: 'positive' },
  'hot-lead': { icon: Flame, tone: 'attention' },
  followup: { icon: RotateCcw },
  'followup-due': { icon: CalendarClock },
};
const appointmentIcons = {
  pending_confirmation: eventIcons['appointment-request'],
  pending_payment: eventIcons.payment,
  payment_reported: eventIcons.payment,
  aguardando_verificacao: eventIcons.payment,
  confirmed: { icon: CalendarCheck, tone: 'positive' },
  cancelled: eventIcons['appointment-cancelled'],
  done: eventIcons.closed,
};
const timeFormat = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' });

function dayLabel(date, today, yesterday) {
  if (date.toDateString() === today.toDateString()) return 'Hoje';
  if (date.toDateString() === yesterday.toDateString()) return 'Ontem';
  return dateFormat.format(date);
}

function groupByDay(items, conversations) {
  const days = new Map();
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  for (const item of [...items].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))) {
    const date = new Date(item.createdAt);
    if (!Number.isFinite(date.getTime())) continue;
    const dayKey = date.toDateString();
    if (!days.has(dayKey)) days.set(dayKey, { key: dayKey, label: dayLabel(date, today, yesterday), groups: new Map(), count: 0 });
    const conversation = findNotificationConversation(item, conversations);
    const contact = conversation?.contact || (isUsefulContactName(item.contact) ? item.contact : '');
    const thread = conversation?.id || (item.chatId && `${item.channel || 'whatsapp'}:${item.chatId}`);
    const key = !item.pending && thread ? JSON.stringify([thread, item.kind || item.category, item.appointmentStatus]) : item.id;
    const day = days.get(dayKey);
    const { groups } = day;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ item, date, conversation, contact });
    day.count += 1;
  }
  return [...days.values()];
}

export function NotificationPanel({ tenantName, items, conversations = [], unread, inbox, sound, onMarkRead, onMarkAll,
  actionFor, onSettings, simulation = false, showPending = true }) {
  const [open, setOpen] = useState(simulation);
  const [filter, setFilter] = useState('all');
  const [category, setCategory] = useState('all');
  const [expanded, setExpanded] = useState(() => new Set());
  const root = useRef(null);
  const bell = useRef(null);
  const closeButton = useRef(null);
  const panelId = useId();
  const titleId = useId();

  const close = () => { setOpen(false); bell.current?.focus(); };
  useEffect(() => {
    if (!open) return undefined;
    closeButton.current?.focus();
    const outside = event => { if (!root.current?.contains(event.target)) setOpen(false); };
    const escape = event => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); bell.current?.focus(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const pendingCount = items.filter(item => item.pending).length;
  const activeFilter = filter === 'pending' && !showPending ? 'all' : filter;
  const tabItems = items.filter(item => (activeFilter !== 'unread' || item.unread) && (activeFilter !== 'pending' || item.pending));
  const visibleCategories = new Set(tabItems.map(item => item.category));
  const showTypes = visibleCategories.size > 1;
  const selectedCategory = showTypes && visibleCategories.has(category) ? category : 'all';
  const filtered = tabItems.filter(item => selectedCategory === 'all' || item.category === selectedCategory);
  const days = open ? groupByDay(filtered, conversations) : [];
  const syncError = inbox.error && !inbox.accessLimited;
  const emptyTitle = selectedCategory !== 'all' ? 'Nenhum aviso deste tipo'
    : activeFilter === 'unread' ? 'Nenhum aviso não lido'
      : activeFilter === 'pending' ? 'Nenhuma pendência por aqui'
        : inbox.accessLimited ? 'Nenhum aviso disponível' : 'Tudo em dia por aqui';

  const toggle = key => setExpanded(previous => {
    const next = new Set(previous);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  return (
    <div className="notification-center" ref={root}>
      <button ref={bell} className={`icon-button notification-bell ${open ? 'is-active' : ''}`} type="button"
        aria-label={`Central de notificações, ${unread} não lidas`} aria-expanded={open} aria-controls={open ? panelId : undefined}
        aria-haspopup="dialog" title="Notificações" onClick={() => setOpen(value => !value)}>
        <Bell size={18} aria-hidden="true" />
        {unread > 0 && <span className="notification-badge" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
      </button>
      <span className="notification-sr-only" role="status" aria-live="polite">{unread > 0 ? `${unread} notificações não lidas` : ''}</span>
      {open && <section id={panelId} role="dialog" aria-labelledby={titleId} className="notification-popover">
        <header className="notification-heading">
          <div className="notification-heading-text">
            <h2 id={titleId}>Notificações</h2>
            <p>{tenantName || 'Sua equipe'}{simulation && <span> · Simulação local</span>}</p>
          </div>
          <div className="notification-tools">
            {unread > 0 && <button type="button" className="icon-button" onClick={onMarkAll}
              aria-label="Marcar todas como lidas" title="Marcar todas como lidas" disabled={Boolean(inbox.syncing && inbox.unread)}>
              <CheckCheck size={17} aria-hidden="true" />
            </button>}
            {sound && <button type="button" className="icon-button" onClick={sound.toggle} aria-pressed={sound.enabled}
              aria-label="Som de notificações" title={sound.enabled ? 'Silenciar notificações' : 'Ativar som de notificações'}>
              {sound.enabled ? <Volume2 size={17} /> : <VolumeX size={17} />}
            </button>}
            {onSettings && <button type="button" className="icon-button" aria-label="Configurações" title="Configurações"
              onClick={() => { onSettings(); close(); }}><Settings2 size={16} /></button>}
            <button ref={closeButton} className="icon-button" type="button" aria-label="Fechar notificações" onClick={close}>
              <X size={18} />
            </button>
          </div>
        </header>
        <div className="notification-filters" role="group" aria-label="Filtrar notificações">
          {[['all', 'Todas', 0], ['unread', 'Não lidas', unread], ...(showPending ? [['pending', 'Pendentes', pendingCount]] : [])].map(([value, label, count]) =>
            <button key={value} type="button" aria-pressed={activeFilter === value}
              onClick={() => { setFilter(value); setCategory('all'); }}>
              {label}{count > 0 && <span>{count > 99 ? '99+' : count}</span>}
            </button>)}
          {showTypes && <select value={selectedCategory} onChange={event => setCategory(event.target.value)} aria-label="Tipo de notificação">
            <option value="all">Tipo</option>
            {Object.entries(categories).filter(([value]) => visibleCategories.has(value))
              .map(([value, { label }]) => <option key={value} value={value}>{label}</option>)}
          </select>}
        </div>
        <div className="notification-scroll" key={activeFilter} role="region" aria-label="Lista de notificações"
          tabIndex={days.length ? 0 : undefined} aria-busy={Boolean(inbox.loading)}>
          {syncError && <div className="notification-sync-note" role="status">
            <AlertCircle size={16} aria-hidden="true" /><span>{inbox.error}</span>
            <button className="icon-button" type="button" disabled={inbox.syncing} onClick={inbox.refresh}
              aria-label="Atualizar histórico de notificações"><RefreshCw size={15} /></button>
          </div>}
          {inbox.loading && !items.length && <p className="notification-message" role="status">Buscando seus avisos…</p>}
          {!days.length && !inbox.loading && !syncError && <div className="notification-empty">
            <span className="notification-empty-icon"><Bell size={19} aria-hidden="true" /></span>
            <strong>{emptyTitle}</strong>
            {activeFilter === 'all' && selectedCategory === 'all' && !inbox.accessLimited && <p>Novas atividades aparecem aqui.</p>}
          </div>}
          {days.map(day => <section key={day.key} aria-label={day.label}>
            <h3 className="notification-date-group">{day.label}
              <span>{day.count} {day.count === 1 ? 'aviso' : 'avisos'}</span>
            </h3>
            <ul className="notification-list">
              {[...day.groups].map(([key, group]) => {
                const groupKey = `${day.key}:${key}`;
                const isExpanded = expanded.has(groupKey);
                return <li key={key} className="notification-group">
                  <ul className="notification-list">
                    {(isExpanded ? group : group.slice(0, 1)).map(({ item, date, conversation, contact }) => {
                      const categoryStyle = categories[item.category];
                      const visual = appointmentIcons[item.appointmentStatus] || eventIcons[item.kind] || categoryStyle;
                      const Icon = visual?.icon || Bell;
                      const tone = item.overdue ? 'urgent' : visual?.tone || 'default';
                      const action = actionFor?.(item, conversation);
                      const readDisabled = Boolean(item.remote && (inbox.syncing || inbox.error));
                      return <li key={item.id} className={`notification-entry ${item.unread ? 'is-unread' : ''}`}>
                        <span className="notification-entry-icon" data-tone={tone}>
                          <Icon size={20} strokeWidth={2.1} aria-hidden="true" />
                        </span>
                        <div className="notification-entry-body">
                          <div className="notification-entry-line">
                            <h4>{item.title}</h4>
                            {item.unread && <span className="notification-unread-dot" aria-label="Não lida" />}
                            <time dateTime={item.createdAt}>{timeFormat.format(date)}</time>
                          </div>
                          <p className="notification-desc" title={[contact, item.description].filter(Boolean).join(' · ')}>
                            {contact && <strong>{contact}{item.description ? ' · ' : ''}</strong>}{item.description}
                          </p>
                          <div className="notification-meta">
                            <span>{categoryStyle?.label}</span>
                            {item.pending && <span className={`notification-state ${item.overdue ? 'overdue' : ''}`}>{item.overdue ? 'Atrasada' : 'Pendente'}</span>}
                            {item.resolved && <span className="notification-state resolved">{item.resolutionLabel || 'Resolvida'}</span>}
                            <div className="notification-entry-actions">
                              {item.unread && <button type="button" className="notification-action-btn" disabled={readDisabled}
                                aria-label={`Marcar como lida: ${item.title}`} title="Marcar como lida" onClick={() => onMarkRead(item)}>
                                <Check size={15} aria-hidden="true" />
                              </button>}
                              {action && <button type="button" className="notification-action-btn primary" onClick={() => {
                                if (item.unread && !readDisabled) onMarkRead(item);
                                action.run();
                                if (!simulation) close();
                              }}>{action.label}<ChevronRight size={13} aria-hidden="true" /></button>}
                            </div>
                          </div>
                        </div>
                      </li>;
                    })}
                  </ul>
                  {group.length > 1 && <button type="button" className="notification-group-toggle" aria-expanded={isExpanded}
                    onClick={() => toggle(groupKey)}>
                    <ChevronDown size={14} aria-hidden="true" />
                    {isExpanded ? 'Mostrar menos' : `Ver mais ${group.length - 1} ${group.length === 2 ? 'aviso semelhante' : 'avisos semelhantes'}`}
                  </button>}
                </li>;
              })}
            </ul>
          </section>)}
          {inbox.hasMore && <button className="notification-more secondary-button" type="button"
            disabled={inbox.syncing} onClick={inbox.loadMore}>Ver avisos anteriores</button>}
          {inbox.isOlderPage && <button className="notification-more secondary-button" type="button"
            disabled={inbox.syncing} onClick={inbox.showLatest}>Voltar aos recentes</button>}
        </div>
      </section>}
    </div>
  );
}

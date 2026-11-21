import React, { useEffect, useId, useRef, useState } from 'react';
import {
  AlertCircle, Bell, BellOff, Bot, CalendarCheck, CalendarClock, CalendarDays, CalendarX, Check, CheckCheck,
  ChevronDown, ChevronRight, CircleCheck, Flame, Headset, MessageCircle, MessageSquareReply, Paperclip,
  Receipt, RefreshCw, RotateCcw, Send, Settings2, TrendingUp, UserRoundCheck, UserRoundPlus, UsersRound,
  Trash2, Volume2, VolumeX, Wifi, X,
} from 'lucide-react';
import { ContactAvatar } from '../../components/ui/ContactAvatar.jsx';
import { ChannelIcon } from '../../components/ui/ChannelIcon.jsx';
import { dismissKey } from './operatorEvents.js';
import { buildNotificationDigest } from './notificationDigest.js';
import { situationOf } from './notificationSituations.js';
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
  'team-review': { icon: Headset, tone: 'attention' },
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
const channelOf = channel => {
  const type = String(channel || '').toLowerCase();
  return type.includes('insta') ? 'instagram' : type.includes('telegram') ? 'telegram' : 'whatsapp';
};
const visualOf = item => {
  const visual = appointmentIcons[item.appointmentStatus] || eventIcons[item.kind] || categories[item.category];
  return { Icon: visual?.icon || Bell, tone: item.overdue ? 'urgent' : visual?.tone || 'default' };
};

// Há quanto tempo a pendência espera: "agora", "12 min", "3 h", "2 d".
export function waitingLabel(createdAt, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(createdAt)) / 60_000));
  if (!Number.isFinite(minutes) || minutes < 1) return 'agora';
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} h`;
  return `${Math.floor(minutes / 1440)} d`;
}

const situationIcons = {
  headset: Headset, receipt: Receipt, calendar: CalendarDays, message: MessageCircle, bot: Bot, user: UserRoundCheck,
  check: CircleCheck, kanban: TrendingUp, alert: AlertCircle, bell: Bell,
};

// Foto do cliente com anel e selo na cor da situação; sem cliente, um quadrado com o ícone da situação.
function Avatar({ item, conversation, contact, situation }) {
  const { Icon } = visualOf(item);
  if (!conversation && !contact) {
    return <span className="notification-entry-icon" data-tone={situation.key}><Icon size={16} strokeWidth={2.1} aria-hidden="true" /></span>;
  }
  return <span className="notification-entry-avatar" data-tone={situation.key} data-channel={item.kind === 'message' ? channelOf(item.channel) : undefined}>
    <ContactAvatar name={contact || conversation?.contact} avatarUrl={conversation?.avatarUrl || item.avatarUrl} />
    <span className="notification-entry-badge" aria-hidden="true">
      {item.kind === 'message' ? <ChannelIcon channel={item.channel} size={11} /> : <Icon size={11} strokeWidth={2.4} />}
    </span>
  </span>;
}

function SituationTag({ situation }) {
  const Icon = situationIcons[situation.icon] || Bell;
  return <span className="notification-tag"><Icon size={11} strokeWidth={2.5} aria-hidden="true" />{situation.label}</span>;
}

export function NotificationPanel({ tenantName, items, conversations = [], unread, inbox, sound, onMarkRead, onMarkAll, onClearAll, onClearSelected,
  actionFor, onSettings, simulation = false, showPending = true }) {
  const [open, setOpen] = useState(simulation);
  const [filter, setFilter] = useState('all');
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
  const filtered = items.filter(item => (activeFilter !== 'unread' || item.unread) && (activeFilter !== 'pending' || item.pending));
  const digest = open ? buildNotificationDigest(filtered, conversations) : { needsAction: [], activity: [] };
  const isEmpty = !digest.needsAction.length && !digest.activity.length;
  const syncError = inbox.error && !inbox.accessLimited;
  const emptyState = activeFilter === 'unread' ? ['Nada novo por aqui', 'Você já viu todos os avisos.']
    : activeFilter === 'pending' ? ['Nenhuma pendência', 'Nenhum cliente esperando a equipe e nada para confirmar.']
      : inbox.accessLimited ? ['Nenhum aviso disponível', ''] : ['Tudo em dia', 'Transferências, pedidos e pagamentos aparecem aqui.'];

  const toggle = key => setExpanded(previous => {
    const next = new Set(previous);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  // Limpar fica no cabeçalho de cada dia e esconde só a atividade informativa dele; pendências nunca somem por limpeza.
  const clearDay = day => onClearSelected?.(day.threads.flatMap(thread => thread.entries.map(entry => entry.item)));

  // A linha inteira abre o destino (conversa, card ou página) e marca o que estava não lido.
  const openRow = (targets, item, conversation) => {
    onMarkRead(targets.filter(target => target.unread));
    const action = actionFor?.(item, conversation);
    if (!action) return;
    action.run();
    if (!simulation) close();
  };
  const rowProps = (targets, item, conversation, label) => ({
    role: 'button', tabIndex: 0, 'aria-label': label,
    onClick: () => openRow(targets, item, conversation),
    onKeyDown: event => {
      if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      openRow(targets, item, conversation);
    },
  });

  const renderPending = ({ item, date, conversation, contact }) => {
    const situation = situationOf(item);
    const action = actionFor?.(item, conversation);
    return <li key={item.id} data-situation={situation.key} className={`notification-entry notification-task ${item.overdue ? 'is-overdue' : ''} ${item.unread ? 'is-unread' : ''}`}>
      <div className="notification-row" {...rowProps([item], item, conversation, `${situation.label}: ${contact || item.title}. ${action?.label || ''}`)}>
        <Avatar item={item} conversation={conversation} contact={contact} situation={situation} />
        <div className="notification-entry-body">
          <div className="notification-entry-line">
            <h4>{contact || item.title}</h4>
            <span className={`notification-wait ${item.overdue ? 'overdue' : ''}`} title={`Desde ${timeFormat.format(date)}`}>
              {(() => {
                const wait = waitingLabel(item.createdAt);
                const since = wait === 'agora' ? 'agora' : `há ${wait}`;
                return item.overdue ? `Atrasada · ${since}` : since;
              })()}
            </span>
          </div>
          <p className="notification-desc"><SituationTag situation={situation} /><span className="notification-event">{contact ? item.title : item.description}</span></p>
        </div>
      </div>
    </li>;
  };

  const renderThread = (day, thread) => {
    const { item, date, conversation, contact } = thread.latest;
    const situation = situationOf(item);
    const key = `${day.key}:${thread.key}`;
    const isExpanded = expanded.has(key);
    const more = thread.entries.length - 1;
    const targets = thread.entries.map(entry => entry.item);
    return <li key={thread.key} data-situation={situation.key} className={`notification-entry notification-thread ${thread.unread ? 'is-unread' : ''}`}>
      <div className="notification-row" {...rowProps(targets, item, conversation, `${situation.label}: ${contact || item.title}, ${item.title}`)}>
        <Avatar item={item} conversation={conversation} contact={contact} situation={situation} />
        <div className="notification-entry-body">
          <div className="notification-entry-line">
            <h4>{contact || item.title}</h4>
            {thread.unread > 0 && <span className="notification-unread-dot" aria-label="Não lida" />}
            <time dateTime={item.createdAt}>{timeFormat.format(date)}</time>
          </div>
          <p className="notification-desc" title={item.description}>
            <SituationTag situation={situation} />
            <span className="notification-event">{contact ? item.title : item.description}</span>
            {more > 0 && <button type="button" className="notification-group-toggle" aria-expanded={isExpanded}
              onClick={event => { event.stopPropagation(); toggle(key); }}>
              {isExpanded ? 'ocultar' : `+${more}`}<ChevronDown size={12} aria-hidden="true" />
            </button>}
          </p>
        </div>
      </div>
      {isExpanded && <ol className="notification-timeline">
        {thread.entries.map(entry => {
          const entrySituation = situationOf(entry.item);
          return <li key={entry.item.id} data-situation={entrySituation.key} className={entry.item.unread ? 'is-unread' : ''}>
            <span className="notification-timeline-dot" aria-hidden="true" />
            <span className="notification-timeline-title">{entry.item.title}</span>
            <time dateTime={entry.item.createdAt}>{timeFormat.format(entry.date)}</time>
          </li>;
        })}
      </ol>}
    </li>;
  };

  return (
    <div className="notification-center" ref={root}>
      <button ref={bell} className={`icon-button notification-bell ${open ? 'is-active' : ''}`} type="button"
        aria-label={`Central de notificações, ${unread} não lidas`} aria-expanded={open} aria-controls={open ? panelId : undefined}
        aria-haspopup="dialog" title="Notificações" onClick={() => setOpen(value => !value)}>
        <Bell size={18} aria-hidden="true" />
        {unread > 0 && <span className={`notification-badge ${pendingCount ? 'has-pending' : ''}`} aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
      </button>
      <span className="notification-sr-only" role="status" aria-live="polite">{unread > 0 ? `${unread} notificações não lidas` : ''}</span>
      {open && <section id={panelId} role="dialog" aria-labelledby={titleId} className="notification-popover">
        <header className="notification-heading">
          <div className="notification-heading-text">
            <h2 id={titleId}>Notificações</h2>
            {simulation && <p><span>Simulação local</span></p>}
          </div>
          <div className="notification-tools">
            {unread > 0 && <button type="button" className="icon-button" onClick={onMarkAll}
              aria-label="Marcar todas como lidas" title="Marcar todas como lidas" disabled={Boolean(inbox.saving)}>
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
          {[['all', 'Tudo', 0], ...(showPending ? [['pending', 'Para agir', pendingCount]] : []), ['unread', 'Não lidas', unread]].map(([value, label, count]) =>
            <button key={value} type="button" aria-pressed={activeFilter === value} data-kind={value}
              onClick={() => setFilter(value)}>
              {label}{count > 0 && <span>{count > 99 ? '99+' : count}</span>}
            </button>)}
        </div>
        <div className="notification-scroll" key={activeFilter} role="region" aria-label="Lista de notificações"
          tabIndex={isEmpty ? undefined : 0} aria-busy={Boolean(inbox.loading)}>
          {syncError && <div className="notification-sync-note" role="status">
            <AlertCircle size={16} aria-hidden="true" /><span>{inbox.error}</span>
            <button className="icon-button" type="button" disabled={inbox.syncing} onClick={inbox.refresh}
              aria-label="Atualizar histórico de notificações"><RefreshCw size={15} /></button>
          </div>}
          {inbox.loading && !items.length && <p className="notification-message" role="status">Buscando seus avisos…</p>}
          {isEmpty && !inbox.loading && !syncError && <div className="notification-empty">
            <span className="notification-empty-icon">{activeFilter === 'all' ? <CircleCheck size={19} aria-hidden="true" /> : <BellOff size={19} aria-hidden="true" />}</span>
            <strong>{emptyState[0]}</strong>
            {emptyState[1] && <p>{emptyState[1]}</p>}
          </div>}
          {digest.needsAction.length > 0 && <section className="notification-section is-action" aria-label="Precisa de você">
            <h3 className="notification-date-group">Precisa de você
              <span className="notification-day-count">{digest.needsAction.length}</span>
              {onClearSelected && <button type="button" className="notification-day-clear"
                onClick={() => onClearSelected(digest.needsAction.map(entry => entry.item))}
                aria-label="Limpar avisos de Precisa de você">Limpar</button>}
            </h3>
            <ul className="notification-list">{digest.needsAction.map(renderPending)}</ul>
          </section>}
          {digest.activity.map(day => <section key={day.key} className="notification-section" aria-label={day.label}>
            <h3 className="notification-date-group">{day.label}
              <span className="notification-day-count">{day.count} {day.count === 1 ? 'evento' : 'eventos'}</span>
              {onClearSelected && <button type="button" className="notification-day-clear" onClick={() => clearDay(day)}
                aria-label={`Limpar atividade de ${day.label.toLowerCase()}`}>Limpar</button>}
            </h3>
            <ul className="notification-list">{day.threads.map(thread => renderThread(day, thread))}</ul>
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

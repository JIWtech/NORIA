import { userFacingError } from '../../../utils/userFacingError.js';
import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  AlertCircle,
  Bot,
  CalendarCheck,
  Check,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Copy,
  ExternalLink,
  GripVertical,
  MessageCircle,
  RefreshCcw,
  Search,
  Sparkles,
  UserRound,
  UserX,
} from 'lucide-react';
import { SiInstagram, SiTelegram, SiWhatsapp } from 'react-icons/si';

import {
  useHorizontalMouseDragScroll,
  useKanbanDragAutoScroll,
  useKanbanWheelScroll,
} from '../hooks/useKanbanScroll';

import { NoriaSelect } from '../../../components/NoriaSelect';
import { ChannelIcon } from '../../../components/ui/ChannelIcon';
import { SkeletonLine } from '../../../components/ui/Skeletons';

import {
  getKanbanColumnKind,
  getStageLabel,
  getTenantSchedulingLink,
  orderKanbanColumnsForTenant,
  validateKanbanOrderProposal,
} from '../../../dataService';
import { markAppointmentOutcome } from '../../../services/appointments/outcomeActions.js';
import { useDepositRequired } from '../../appointments/utils/useDepositRequired';
import { AppointmentRequestActions } from './AppointmentRequestActions.jsx';
import { kanbanColumnPresentation } from '../../../services/kanban/kanbanColumnPresentation.js';
import {
  availableOutcomes,
  isDepositRequired,
  isOutcomeTrackingEnabled,
} from '../../../services/appointments/appointmentOutcome.js';

import {
  applyKanbanFlowOrder,
  requestKanbanFlowSuggestion,
  sendN8nCommand,
} from '../../../services/integration.js';

import { CHANNEL_OPTIONS } from '../../../services/tenants/tenantAccess.js';
import {
  KANBAN_OWNER_FILTERS,
  kanbanAgentFilterValue,
  matchesKanbanOwnerFilter,
} from '../../../services/kanban/kanbanFilters';
import { formatConversationPreview } from '../../../utils/audioUtils';

export function Kanban({
  allowedChannels = CHANNEL_OPTIONS.map(c => c.id),
  kanbanColumns = [],
  tenantName = '',
  agentsList = [],
  tenantSlug,
  tenantSettings = null,
  onChanged,
  onOpenChat,
  onOpenAppointment,
  onMoveCard,
  onOrderApplied,
  onFinishConversation,
  focusedCardId,
  onCardFocused,
  ready = true,
}) {
  const [agentFilter, setAgentFilter] = useState(KANBAN_OWNER_FILTERS.ALL);
  const [channelFilter, setChannelFilter] = useState('todos');
  const [kanbanCardTransition, setKanbanCardTransition] = useState('idle');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedCardId, setCopiedCardId] = useState(null);
  const [confirmingCardId, setConfirmingCardId] = useState('');
  const [outcomeCardId, setOutcomeCardId] = useState('');
  const [kanbanActionStatus, setKanbanActionStatus] = useState('');
  // Recurso por tenant (settings.appointment_outcome_tracking): os demais clientes não veem nada novo.
  const outcomeTracking = isOutcomeTrackingEnabled(tenantSettings);
  const depositIndex = useDepositRequired(outcomeTracking ? tenantSlug : '', kanbanColumns);
  const [draggingCardId, setDraggingCardId] = useState(null);
  const [dragOverColumnId, setDragOverColumnId] = useState(null);
  const [activeColumnId, setActiveColumnId] = useState('');
  const [flowProposal, setFlowProposal] = useState(null);
  const [flowToast, setFlowToast] = useState('');
  const [flowStatus, setFlowStatus] = useState('idle');
  const boardRef = useRef(null);
  const columnRefs = useRef(new Map());
  const draggedCardRef = useRef(null);
  const channelTransitionTimersRef = useRef({ exit: null, enter: null });
  const pendingChannelFilterRef = useRef(null);

  useHorizontalMouseDragScroll(boardRef, { blockInteractiveTargets: true });
  useKanbanDragAutoScroll(boardRef, Boolean(draggingCardId), setDragOverColumnId);
  useKanbanWheelScroll(boardRef);

  useEffect(() => () => {
    const timers = channelTransitionTimersRef.current;
    if (timers.exit) window.clearTimeout(timers.exit);
    if (timers.enter) window.clearTimeout(timers.enter);
  }, []);

  useEffect(() => {
    if (!flowToast) return undefined;
    const timeout = window.setTimeout(() => setFlowToast(''), 4000);
    return () => window.clearTimeout(timeout);
  }, [flowToast]);

  const handleKanbanChannelChange = (nextChannel) => {
    if (pendingChannelFilterRef.current === nextChannel) return;

    const timers = channelTransitionTimersRef.current;
    if (timers.exit) window.clearTimeout(timers.exit);
    if (timers.enter) window.clearTimeout(timers.enter);
    timers.exit = null;
    timers.enter = null;

    if (nextChannel === channelFilter) {
      pendingChannelFilterRef.current = null;
      setKanbanCardTransition('idle');
      return;
    }

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      pendingChannelFilterRef.current = null;
      setChannelFilter(nextChannel);
      setKanbanCardTransition('idle');
      return;
    }

    pendingChannelFilterRef.current = nextChannel;
    setKanbanCardTransition('exiting');
    timers.exit = window.setTimeout(() => {
      setChannelFilter(nextChannel);
      pendingChannelFilterRef.current = null;
      setKanbanCardTransition('entering');
      timers.enter = window.setTimeout(() => {
        setKanbanCardTransition('idle');
        timers.enter = null;
      }, 180);
      timers.exit = null;
    }, 110);
  };

  const schedulingUrl = getTenantSchedulingLink(tenantSlug);

  const orderedColumns = useMemo(
    () => orderKanbanColumnsForTenant(kanbanColumns || [], tenantSlug),
    [kanbanColumns, tenantSlug],
  );

  async function handleSuggestKanbanFlow() {
    const boardId = orderedColumns[0]?.boardId;
    if (!boardId || !orderedColumns.length) {
      setFlowToast('Não foi possível organizar o fluxo deste tenant agora.');
      return;
    }
    setFlowStatus('loading');
    setFlowToast('');
    try {
      const result = await requestKanbanFlowSuggestion({
        boardId,
        tenantName,
        columns: orderedColumns.map((column) => ({
          name: column.title,
          automationKey: column.automationKey || column.id,
          kind: getKanbanColumnKind(column),
          description: getColumnPresentation(column).description,
        })),
      }, tenantSlug);
      const proposal = validateKanbanOrderProposal(orderedColumns, result?.proposal || result);
      if (!proposal.valid) throw new Error('A sugestão da IA não contém exatamente as colunas deste Kanban.');
      setFlowProposal(proposal);
      setFlowStatus('review');
    } catch (error) {
      console.error('Falha ao sugerir organização do Kanban:', error);
      setFlowToast('Não foi possível organizar o fluxo agora. Tente novamente.');
      setFlowStatus('idle');
    }
  }

  async function handleApplyKanbanFlow() {
    if (!flowProposal?.valid) return;
    const boardId = orderedColumns[0]?.boardId;
    setFlowStatus('applying');
    setFlowToast('');
    try {
      await applyKanbanFlowOrder({ boardId, orderedAutomationKeys: flowProposal.orderedAutomationKeys }, tenantSlug);
      onOrderApplied?.(flowProposal.orderedAutomationKeys);
      setFlowProposal(null);
      setFlowStatus('idle');
      setKanbanActionStatus('Organização do fluxo salva para este tenant.');
      onChanged?.();
    } catch (error) {
      console.error('Falha ao aplicar organização do Kanban:', error);
      setFlowToast('Não foi possível salvar a organização do fluxo. Tente novamente.');
      setFlowStatus('review');
    }
  }

  function copySchedulingLink(cardId, link) {
    const targetLink = link || schedulingUrl;
    if (!targetLink) return;
    navigator.clipboard.writeText(targetLink);
    setCopiedCardId(cardId);
    setTimeout(() => setCopiedCardId(null), 2500);
  }

  function formatSchedulingLink(link) {
    if (!link) return '';
    try {
      return new URL(link).host;
    } catch (e) {
      return link;
    }
  }

  async function handleConfirmSignal(card) {
    if (!card?.appointmentId || confirmingCardId) return;
    const confirmed = window.confirm('Confirmar pagamento do sinal e concluir esta etapa?');
    if (!confirmed) return;
    setConfirmingCardId(card.id);
    setKanbanActionStatus('');
    try {
      await sendN8nCommand('confirm_payment_signal', {
        appointment_id: card.appointmentId,
        channel_type: card.channelType || card.channel?.toLowerCase() || 'telegram',
        external_conversation_id: card.externalConversationId,
        contact_name: card.title,
        sent_by_user: (agentsList?.length === 1 ? agentsList[0]?.name : null) || 'Operador NORIA',
      }, tenantSlug);
      setKanbanActionStatus('Sinal confirmado e mensagem enviada ao cliente.');
      await onChanged?.();
    } catch (error) {
      setKanbanActionStatus(userFacingError(error, 'Nao foi possivel confirmar o sinal.'));
    } finally {
      setConfirmingCardId('');
    }
  }
  const cardOutcomes = (card) => (outcomeTracking && card?.appointmentId
    ? availableOutcomes({ startsAt: card.appointmentStartsAt, status: card.appointmentStatus })
    : []);

  async function handleMarkOutcome(card, outcome) {
    if (!card?.appointmentId || outcomeCardId) return;
    const message = outcome === 'no_show'
      ? 'Registrar que o cliente não veio? A conversa será encerrada e novos agendamentos dele passarão a exigir sinal.'
      : 'Registrar que o cliente compareceu? Se ele estava na lista de sinal obrigatório, volta ao normal.';
    if (!window.confirm(message)) return;
    setOutcomeCardId(card.id);
    setKanbanActionStatus('');
    try {
      await markAppointmentOutcome(card.appointmentId, outcome);
      setKanbanActionStatus(outcome === 'no_show' ? 'Falta registrada e conversa encerrada.' : 'Comparecimento registrado.');
      await onChanged?.();
    } catch (error) {
      setKanbanActionStatus(error.message || 'Não foi possível registrar o desfecho.');
    } finally {
      setOutcomeCardId('');
    }
  }
  const getChannelClass = (type = 'telegram') => {
    const norm = String(type).toLowerCase();
    if (norm.includes('whats')) return 'channel-whatsapp';
    if (norm.includes('insta')) return 'channel-instagram';
    return 'channel-telegram';
  };
  // Símbolo, cor, rótulo curto e descrição vêm da coluna no banco (kanban_columns, migração 032).
  const getColumnPresentation = (column = {}) => kanbanColumnPresentation(column);

  const filteredColumns = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return orderedColumns.map((col) => {
      const cards = (col?.cards || []).filter((card) => {
        const ownerStr = String(card?.owner || '');
        const channelStr = String(card?.channelType || card?.channel || '').toLowerCase();
        const matchesQuery =
          !query ||
          [card?.title, card?.subtitle, ownerStr, card?.channel, card?.aiReason]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(query);
        const matchesAgent = matchesKanbanOwnerFilter(card, agentFilter);
        const matchesChannel =
          channelFilter === 'todos' || channelStr.includes(channelFilter);
        return card.id === focusedCardId || (matchesQuery && matchesAgent && matchesChannel);
      });
      return { ...col, cards };
    });
  }, [orderedColumns, agentFilter, channelFilter, searchQuery, focusedCardId]);

  useEffect(() => {
    if (!focusedCardId || !ready) return;
    const card = boardRef.current?.querySelector('[data-notification-focus]');
    if (card) {
      setAgentFilter(KANBAN_OWNER_FILTERS.ALL);
      setChannelFilter('todos');
      setSearchQuery('');
      card.scrollIntoView({ block: 'nearest', inline: 'center' });
      card.focus({ preventScroll: true });
    }
    onCardFocused?.();
  }, [focusedCardId, onCardFocused, ready]);

  useEffect(() => {
    if (activeColumnId && !filteredColumns.some((column) => column.id === activeColumnId)) {
      setActiveColumnId('');
    }
  }, [activeColumnId, filteredColumns]);

  function scrollToColumn(columnId) {
    const board = boardRef.current;
    const column = columnRefs.current.get(columnId);
    if (!board || !column) return;

    const boardBounds = board.getBoundingClientRect();
    const columnBounds = column.getBoundingClientRect();
    const maxScrollLeft = Math.max(0, board.scrollWidth - board.clientWidth);
    const targetLeft = Math.min(
      maxScrollLeft,
      Math.max(0, board.scrollLeft + columnBounds.left - boardBounds.left - 10),
    );

    board.scrollTo({
      left: targetLeft,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
    setActiveColumnId(columnId);
  }

  const handleDragStart = (e, card, column) => {
    draggedCardRef.current = { card, sourceColumnId: column.id };
    setDraggingCardId(card.id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.id);
    const article = e.currentTarget.closest('.kanban-card');
    if (article) {
      const { left, top } = article.getBoundingClientRect();
      e.dataTransfer.setDragImage(article, e.clientX - left, e.clientY - top);
    }
  };

  const handleDragEnd = () => {
    draggedCardRef.current = null;
    setDraggingCardId(null);
    setDragOverColumnId(null);
  };

  const handleDragOver = (e) => {
    if (!draggedCardRef.current) return;
    e.preventDefault();
    const columnId = e.target.closest?.('[data-column-id]')?.dataset.columnId || null;
    e.dataTransfer.dropEffect = columnId ? 'move' : 'none';
    setDragOverColumnId(columnId);
  };

  const handleDragLeave = (e) => {
    if (draggedCardRef.current && !e.currentTarget.contains(e.relatedTarget)) setDragOverColumnId(null);
  };

  const handleDrop = (e) => {
    const move = draggedCardRef.current;
    if (!move) return;
    e.preventDefault();
    const columnId = e.target.closest?.('[data-column-id]')?.dataset.columnId;
    const targetColumn = filteredColumns.find(column => String(column.id) === columnId);
    handleDragEnd();
    if (targetColumn && move.sourceColumnId !== targetColumn.id) {
      onMoveCard?.(move.card, targetColumn.automationKey || targetColumn.id, targetColumn);
    }
  };

  return (
    <section className="kanban-page">
      <div className="kanban-toolbar-wrap">
        <div className="kanban-toolbar">
          <div className="kanban-toolbar-search-group">
            <div className="search-box">
              <Search size={16} />
              <input
                placeholder="Buscar por contato, serviço ou mensagem..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="kanban-toolbar-filter-group kanban-toolbar-channel-group">
            <span className="filter-label">Canais</span>
            <div className="chips">
              <button
                type="button"
                className={`chip kanban-filter-control channel-all ${channelFilter === 'todos' ? 'active' : ''}`}
                onClick={() => handleKanbanChannelChange('todos')}
              >
                Todos os canais
              </button>
              {allowedChannels.includes('whatsapp') && <button
                type="button"
                className={`chip kanban-filter-control channel-whatsapp ${channelFilter === 'whatsapp' ? 'active' : ''}`}
                onClick={() => handleKanbanChannelChange(channelFilter === 'whatsapp' ? 'todos' : 'whatsapp')}
              >
                <SiWhatsapp className="kanban-brand-icon kanban-brand-icon--whatsapp" size={14} aria-hidden="true" /> WhatsApp
              </button>}
              {allowedChannels.includes('telegram') && <button
                type="button"
                className={`chip kanban-filter-control channel-telegram ${channelFilter === 'telegram' ? 'active' : ''}`}
                onClick={() => handleKanbanChannelChange(channelFilter === 'telegram' ? 'todos' : 'telegram')}
              >
                <SiTelegram className="kanban-brand-icon kanban-brand-icon--telegram" size={14} aria-hidden="true" /> Telegram
              </button>}
              {allowedChannels.includes('instagram') && <button
                type="button"
                className={`chip kanban-filter-control channel-instagram ${channelFilter === 'instagram' ? 'active' : ''}`}
                onClick={() => handleKanbanChannelChange(channelFilter === 'instagram' ? 'todos' : 'instagram')}
              >
                <SiInstagram className="kanban-brand-icon kanban-brand-icon--instagram" size={14} aria-hidden="true" /> Instagram
              </button>}
            </div>
          </div>

          <div className="kanban-toolbar-filter-group kanban-toolbar-agents-row">
            <span className="filter-label">Responsável</span>
            <NoriaSelect
              value={agentFilter}
              onValueChange={setAgentFilter}
              options={[
                { value: KANBAN_OWNER_FILTERS.ALL, label: 'Todos' },
                { value: KANBAN_OWNER_FILTERS.AI, label: 'Assistente IA' },
                ...agentsList
                  .filter((agent) => agent?.id && agent?.name)
                  .map((agent) => ({ value: kanbanAgentFilterValue(agent.id), label: agent.name })),
              ]}
              ariaLabel="Filtrar por responsável"
              icon={UserRound}
              className="kanban-owner-select"
              contentClassName="kanban-owner-select-content"
            />
          </div>
          <button
            type="button"
            className="secondary-button kanban-ai-flow-button"
            onClick={handleSuggestKanbanFlow}
            disabled={flowStatus === 'loading' || flowStatus === 'applying' || !orderedColumns[0]?.boardId}
          >
            {flowStatus === 'loading' ? <><RefreshCcw className="kanban-ai-flow-icon spin" size={16} /> Analisando fluxo...</> : <><Sparkles className="kanban-ai-flow-icon" size={16} /> Organizar fluxo com IA</>}
          </button>
          {kanbanActionStatus && <small className="kanban-action-status">{kanbanActionStatus}</small>}
        </div>
      </div>

      {flowProposal && (
        <section className="card" aria-live="polite">
          <h3>Proposta de organização do fluxo</h3>
          <div className="split-grid">
            <div><strong>Ordem atual</strong><ol>{orderedColumns.map((column) => <li key={column.id}>{column.title}</li>)}</ol></div>
            <div><strong>Sugestão da IA</strong><ol>{flowProposal.orderedAutomationKeys.map((key) => <li key={key}>{orderedColumns.find((column) => (column.automationKey || column.id) === key)?.title || getStageLabel(key, { kanbanColumns: orderedColumns, tenantSettings, tenantSlug })}</li>)}</ol></div>
          </div>
          {flowProposal.reasoning && <p>{flowProposal.reasoning}</p>}
          <div className="row-actions">
            <button type="button" className="secondary-button" onClick={() => { setFlowProposal(null); setFlowStatus('idle'); }}>Cancelar</button>
            <button type="button" className="primary-button" onClick={handleApplyKanbanFlow} disabled={flowStatus === 'applying'}>{flowStatus === 'applying' ? <><RefreshCcw className="spin" size={16} /> Aplicando...</> : 'Aplicar organização'}</button>
          </div>
        </section>
      )}
      {flowToast && (
        <div className="toast-notification" role="status">
          <AlertCircle size={18} color="#fca5a5" />
          <span>{flowToast}</span>
        </div>
      )}

      <div className="stage-navigation-wrapper">
        <div className="kanban-stage-navigation" aria-label="Navegação rápida entre etapas">
          <div className="kanban-stage-shortcuts">
            {filteredColumns.map((column) => {
              const presentation = getColumnPresentation(column);
              const ShortcutIcon = presentation.Icon;
              return (
                <button
                  key={column.id}
                  type="button"
                  className={`kanban-stage-shortcut kanban-stage-shortcut--${presentation.tone} has-tone tone-${presentation.tone} ${activeColumnId === column.id ? 'active' : ''}`}
                  onClick={() => scrollToColumn(column.id)}
                  title={`Ir para ${column.title}`}
                  aria-label={`Ir para etapa ${column.title}`}
                  aria-current={activeColumnId === column.id ? 'location' : undefined}
                >
                  <ShortcutIcon className="kanban-stage-shortcut-icon" size={17} aria-hidden="true" />
                  <span>{presentation.shortLabel}</span>
                  <strong>{ready ? column.cards.length : '—'}</strong>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div
        className="kanban-board kanban-scroll-drag-surface"
        ref={boardRef}
        onPointerDown={() => setActiveColumnId('')}
        onWheel={() => setActiveColumnId('')}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {filteredColumns.map((column) => {
          const isWaitingColumn = column.automationKey === 'aguardando_humano' || column.id === 'aguardando_humano';
          const isFinishedColumn = column.automationKey === 'finalizadas' || column.id === 'finalizadas';
          const isDragOver = dragOverColumnId === column.id;
          const presentation = getColumnPresentation(column);
          const StageIcon = presentation.Icon;

          return (
            <div
              className={`kanban-column kanban-column--${presentation.tone} has-tone tone-${presentation.tone} ${isDragOver ? 'is-dragover' : ''}`}
              key={column.id}
              data-column-id={column.id}
              ref={(node) => {
                if (node) columnRefs.current.set(column.id, node);
                else columnRefs.current.delete(column.id);
              }}
            >
              <div className="column-header">
                <span className="column-stage-icon" aria-hidden="true"><StageIcon size={19} /></span>
                <div className="column-heading-copy">
                  <strong className="column-title">{column.title}</strong>
                  <small className="column-description">{presentation.description}</small>
                </div>
                <span className="column-count-badge">{ready ? column.cards.length : '—'}</span>
              </div>

              <div className="column-cards-container">
                {!ready ? (
                  [1, 2].map((i) => (
                    <article className="kanban-card kanban-card-skeleton" key={i}>
                      <div className="kanban-card-header">
                        <SkeletonLine width="90px" height="14px" />
                        <SkeletonLine width="35px" height="11px" />
                      </div>
                      <SkeletonLine width="130px" height="12px" style={{ marginTop: '8px' }} />
                      <div className="kanban-card-footer" style={{ marginTop: '12px' }}>
                        <SkeletonLine width="60px" height="11px" />
                      </div>
                    </article>
                  ))
                ) : (
                  <>
                    {column.cards.map((card) => {
                      const channelClass = getChannelClass(card.channelType || card.channel);
                      const isDragging = draggingCardId === card.id;

                      return (
                        <article
                          className={`kanban-card ${channelClass} ${isDragging ? 'is-dragging' : ''} ${kanbanCardTransition === 'exiting' ? 'is-channel-exiting' : ''} ${kanbanCardTransition === 'entering' ? 'is-channel-entering' : ''}`}
                          key={card.id}
                          tabIndex={-1}
                          // O card inteiro arrasta para outra etapa; a rolagem do quadro fica no espaço fora dos cards.
                          draggable={Boolean(onMoveCard)}
                          onDragStart={onMoveCard ? (e) => handleDragStart(e, card, column) : undefined}
                          onDragEnd={onMoveCard ? handleDragEnd : undefined}
                          data-notification-focus={card.id === focusedCardId ? '' : undefined}
                        >
                          <div className="kanban-card-header">
                            <div className="contact-title-line">
                              <span className={`channel-indicator-icon ${channelClass}`}>
                                <ChannelIcon channel={card.channelType || card.channel} size={12} />
                              </span>
                              <strong className="contact-name">{card.title}</strong>
                              {card.contactCategoryLabel && (
                                <span className={`contact-category-pill contact-category-pill--${card.contactCategory || 'customer'}`}>
                                  {card.contactCategoryLabel}
                                </span>
                              )}
                            </div>
                            <small className="card-time">{card.lastAt}</small>
                            {onMoveCard && <span className="kanban-card-drag-handle"
                              title="Arraste o card para mover para outra etapa">
                              <GripVertical size={16} aria-hidden="true" />
                            </span>}
                          </div>

                          <p className="card-subtitle" title={formatConversationPreview(card.subtitle)}>{formatConversationPreview(card.subtitle)}</p>

                          {isWaitingColumn && (
                            <div className="waiting-sla-badge">
                              <Clock3 size={11} />
                              <span>Aguardando resposta humana</span>
                            </div>
                          )}

                          {card.aiReason && (
                            <div className="ai-verification-badge">
                              <Sparkles size={12} className="ai-sparkle-icon" />
                              <span>{card.aiReason}</span>
                            </div>
                          )}

                          {card.hasSchedulingLink && (card.schedulingLink || schedulingUrl) && (
                            <div className="scheduling-link-box">
                              <div className="link-info">
                                <CalendarCheck size={14} className="calendar-icon" />
                                <span className="link-text" title={card.schedulingLink || schedulingUrl}>
                                  {formatSchedulingLink(card.schedulingLink || schedulingUrl)}
                                </span>
                              </div>
                              <div className="link-actions">
                                <button
                                  type="button"
                                  className="link-copy-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    copySchedulingLink(card.id, card.schedulingLink);
                                  }}
                                  title="Copiar link de agendamento"
                                >
                                  {copiedCardId === card.id ? (
                                    <>
                                      <Check size={12} color="#10b981" /> Copiado!
                                    </>
                                  ) : (
                                    <>
                                      <Copy size={12} /> Copiar
                                    </>
                                  )}
                                </button>
                                <a
                                  href={card.schedulingLink || schedulingUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="link-external-btn"
                                  onClick={(e) => e.stopPropagation()}
                                  title="Abrir página de agendamento"
                                >
                                  <ExternalLink size={12} />
                                </a>
                              </div>
                            </div>
                          )}

                          {outcomeTracking && isDepositRequired(depositIndex, card.channelType, card.externalConversationId) && (
                            <span
                              className="deposit-required-badge"
                              title="Este cliente faltou a um agendamento. Novos agendamentos exigem sinal de 50% via Pix."
                            >
                              <CircleDollarSign size={12} /> Sinal obrigatório
                            </span>
                          )}

                          {cardOutcomes(card).length > 0 && (
                            <div className="appointment-outcome-actions">
                              {cardOutcomes(card).includes('attended') && (
                                <button
                                  type="button"
                                  className="outcome-button attended"
                                  disabled={Boolean(outcomeCardId)}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleMarkOutcome(card, 'attended');
                                  }}
                                  title="Registrar que o cliente compareceu"
                                >
                                  <Check size={13} />
                                  {outcomeCardId === card.id ? 'Salvando...' : 'Compareceu'}
                                </button>
                              )}
                              {cardOutcomes(card).includes('no_show') && (
                                <button
                                  type="button"
                                  className="outcome-button no-show"
                                  disabled={Boolean(outcomeCardId)}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleMarkOutcome(card, 'no_show');
                                  }}
                                  title="Registrar que o cliente não veio e encerrar a conversa"
                                >
                                  <UserX size={13} />
                                  {outcomeCardId === card.id ? 'Salvando...' : 'Cliente não veio'}
                                </button>
                              )}
                            </div>
                          )}

                          {card.actionType === 'confirm_request' && (
                            <AppointmentRequestActions
                              card={card}
                              tenantSlug={tenantSlug}
                              staleHours={tenantSettings?.settings?.appointment_request?.stale_alert_hours}
                              onChanged={onChanged}
                              onStatus={setKanbanActionStatus}
                            />
                          )}

                          {card.actionType === 'confirm_signal' && (
                            <button
                              type="button"
                              className="confirm-signal-button"
                              disabled={Boolean(confirmingCardId)}
                              onClick={(event) => {
                                event.stopPropagation();
                                handleConfirmSignal(card);
                              }}
                              title="Confirmar pagamento do sinal"
                            >
                              <CheckCircle2 size={14} />
                              {confirmingCardId === card.id ? 'Confirmando...' : 'Confirmar'}
                            </button>
                          )}

                          <div className="kanban-card-owner">
                            <div className="card-owner-info">
                              {card.ownerKind === 'ai' || card.owner === 'Assistente IA' ? (
                                <Bot size={12} />
                              ) : (
                                <UserRound size={12} />
                              )}
                              <span>{card.owner || 'Sem responsável'}</span>
                            </div>
                          </div>

                          {/* AÇÕES RÁPIDAS NO CARD (ITEM B) */}
                          <div className="kanban-card-quick-actions">
                            {onOpenChat && (
                              <button
                                type="button"
                                className="card-quick-btn chat"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenChat(card.externalConversationId || card.id);
                                }}
                                title="Abrir e responder no chat"
                              >
                                <MessageCircle size={12} />
                                <span>Responder</span>
                              </button>
                            )}

                            {onOpenAppointment && kanbanColumns.some((col) => (col.automationKey || col.id) === 'agendamentos') && (
                              <button
                                type="button"
                                className="card-quick-btn schedule"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenAppointment(card);
                                }}
                                title="Criar agendamento rápido"
                              >
                                <CalendarCheck size={12} />
                                <span>Agendar</span>
                              </button>
                            )}

                            {onFinishConversation && !isFinishedColumn && (
                              <button
                                type="button"
                                className="card-quick-btn finish"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onFinishConversation(card);
                                }}
                                title="Concluir e mover para Finalizadas"
                              >
                                <CheckCircle2 size={12} />
                                <span>Finalizar</span>
                              </button>
                            )}
                          </div>
                        </article>
                      );
                    })}
                    {!column.cards.length && <div className="column-empty">Sem conversas nesta etapa</div>}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

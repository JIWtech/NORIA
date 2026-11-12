import { userFacingError } from '../../../utils/userFacingError.js';
import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  AlertCircle,
  CalendarCheck,
  CalendarClock,
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
} from 'lucide-react';
import { SiInstagram, SiTelegram, SiWhatsapp } from 'react-icons/si';

import {
  useHorizontalMouseDragScroll,
  useKanbanDragAutoScroll,
  useKanbanWheelScroll,
} from '../hooks/useKanbanScroll';

import { NoriaSelect } from '../../../components/NoriaSelect';
import { ChannelIcon, getChannelClass } from '../../../components/ui/ChannelIcon';
import { ContactAvatar } from '../../../components/ui/ContactAvatar';
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
import { APPOINTMENT_OUTCOME_ACTIONS, AppointmentOutcomeActions } from '../../appointments/components/AppointmentOutcomeActions.jsx';
import { AppointmentRequestActions } from './AppointmentRequestActions.jsx';
import { slotProposalSuggestionEnabled } from '../../../services/appointments/appointmentRequest.js';
import { slotProposalBadge } from '../../../services/appointments/slotProposalStatus.js';
import { NoShowMessageDialog } from '../../appointments/components/NoShowMessageDialog.jsx';
import { AppointmentConfirmDialog } from '../../appointments/components/AppointmentConfirmDialog.jsx';
import { appointmentFromKanbanCard, noShowMessageConfig } from '../../../services/appointments/noShowMessage.js';
import { AppointmentDetails } from './AppointmentDetails.jsx';
import { KanbanCardMenu } from './KanbanCardMenu.jsx';
import { kanbanColumnPresentation } from '../../../services/kanban/kanbanColumnPresentation.js';
import { kanbanCardActionMode, kanbanCardLabels } from '../../../services/kanban/kanbanCardReason.js';
import { kanbanMoveBlockReason } from '../../../services/kanban/cardRouting.js';
import { shouldOfferScheduleAction } from '../../../services/kanban/kanbanScheduleAction.js';
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
  const [confirmingCardId, setConfirmingCardId] = useState('');
  const [outcomeCardId, setOutcomeCardId] = useState('');
  const [noShowTarget, setNoShowTarget] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
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

  async function copySchedulingLink(link) {
    try {
      await navigator.clipboard.writeText(link);
      setKanbanActionStatus('Link de agendamento copiado.');
    } catch {
      setKanbanActionStatus('Não foi possível copiar o link de agendamento.');
    }
  }

  function handleConfirmSignal(card) {
    if (!card?.appointmentId || confirmingCardId) return;
    setConfirmation({
      title: 'Confirmar sinal',
      message: 'Confirmar pagamento do sinal e concluir esta etapa?',
      confirmLabel: 'Confirmar sinal',
      onConfirm: () => confirmSignal(card),
    });
  }
  async function confirmSignal(card) {
    if (!card?.appointmentId || confirmingCardId) return;
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

  function handleMarkOutcome(card, outcome) {
    if (!card?.appointmentId || outcomeCardId) return;
    const noShowAppointment = outcome === 'no_show' ? appointmentFromKanbanCard(card) : null;
    if (noShowAppointment && noShowMessageConfig(tenantSettings, noShowAppointment).enabled) {
      setNoShowTarget(noShowAppointment);
      return;
    }
    const message = outcome === 'no_show'
      ? 'Registrar que o cliente não veio? A conversa será encerrada e novos agendamentos dele passarão a exigir sinal.'
      : 'Registrar que o cliente compareceu? Se ele estava na lista de sinal obrigatório, volta ao normal.';
    setConfirmation({
      title: outcome === 'no_show' ? 'Registrar falta' : 'Registrar comparecimento',
      message,
      confirmLabel: outcome === 'no_show' ? 'Registrar falta' : 'Registrar comparecimento',
      onConfirm: () => markOutcome(card, outcome),
    });
  }
  async function markOutcome(card, outcome) {
    if (!card?.appointmentId || outcomeCardId) return;
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
  const hasAgendamentosColumn = kanbanColumns.some((column) => (column.automationKey || column.id) === 'agendamentos');
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
          [
            card?.title,
            card?.subtitle,
            ownerStr,
            card?.ownerKind === 'ai' ? 'Assistente IA Atendimento por IA' : '',
            card?.channel,
            card?.aiReason,
            card?.isFollowUp ? (card?.followUpLabel ? `Follow-up ${card.followUpLabel}` : 'Follow-up enviado') : '',
          ]
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
      const target = targetColumn.automationKey || targetColumn.id;
      const blockReason = kanbanMoveBlockReason(move.card, target);
      if (blockReason) {
        setKanbanActionStatus(blockReason);
        return;
      }
      onMoveCard?.(move.card, target, targetColumn);
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
          const isDragOver = dragOverColumnId === column.id;
          const presentation = getColumnPresentation(column);
          const isSignalColumn = (column.automationKey || column.id) === 'verificar_sinal';
          const description = isSignalColumn && ['Aguardando confirmação.', 'Conversas nesta etapa.'].includes(presentation.description)
            ? 'Pagamentos informados para conferência.'
            : presentation.description;
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
                  <small className="column-description">{description}</small>
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
                      const channel = card.channelType || card.channel;
                      const isDragging = draggingCardId === card.id;
                      const labels = kanbanCardLabels(card, column);
                      const outcomes = cardOutcomes(card);
                      const canDrag = Boolean(onMoveCard) && !card.isFollowUp;
                      const aiOwner = card.ownerKind === 'ai' || card.owner === 'Assistente IA';
                      const depositRequired = outcomeTracking && !labels.closed
                        && isDepositRequired(depositIndex, card.channelType, card.externalConversationId);
                      const hasConversation = Boolean(card.externalConversationId || !card.appointmentId);
                      const hasChat = Boolean(onOpenChat && hasConversation);
                      const columnKey = column.automationKey || column.id;
                      const actionMode = kanbanCardActionMode(card, columnKey, outcomes.length > 0, hasChat);
                      const chatLabel = columnKey === 'conversas_abandonadas' ? 'Retomar conversa' : 'Abrir conversa';
                      const openChat = () => onOpenChat(card.externalConversationId || card.id);
                      const link = card.hasSchedulingLink && (card.schedulingLink || schedulingUrl);
                      const preview = formatConversationPreview(card.subtitle);
                      // Card nascido de agendamento: status primeiro, depois cliente e horário em destaque.
                      const isBookingCard = String(card.id || '').startsWith('appointment-') && Boolean(card.appointmentContactName || card.appointmentWhen);
                      const menu = [];

                      if (hasChat && actionMode !== 'chat') {
                        menu.push({ key: 'chat', Icon: MessageCircle, label: 'Abrir conversa', run: openChat });
                      }
                      if (shouldOfferScheduleAction(card, columnKey, { onOpenAppointment, hasAgendamentosColumn })) {
                        menu.push({ key: 'schedule', Icon: CalendarCheck, label: 'Agendar', run: () => onOpenAppointment(card) });
                      }
                      if (actionMode !== 'outcomes') {
                        for (const outcome of outcomes) {
                          menu.push({
                            ...APPOINTMENT_OUTCOME_ACTIONS[outcome],
                            key: outcome,
                            disabled: Boolean(outcomeCardId),
                            run: () => handleMarkOutcome(card, outcome),
                          });
                        }
                      }
                      if (link) {
                        menu.push(
                          { key: 'copy-link', Icon: Copy, label: 'Copiar link de agendamento', run: () => copySchedulingLink(link) },
                          { key: 'open-link', Icon: ExternalLink, label: 'Abrir página de agendamento', href: link },
                        );
                      }
                      if (hasConversation && onFinishConversation && !labels.closed) {
                        menu.push({ key: 'finish', Icon: CheckCircle2, label: 'Finalizar atendimento', run: () => onFinishConversation(card) });
                      }

                      return (
                        <article
                          className={`kanban-card ${isDragging ? 'is-dragging' : ''} ${kanbanCardTransition === 'exiting' ? 'is-channel-exiting' : ''} ${kanbanCardTransition === 'entering' ? 'is-channel-entering' : ''}`}
                          key={card.id}
                          tabIndex={-1}
                          // O card inteiro arrasta para outra etapa; a rolagem do quadro fica no espaço fora dos cards.
                          draggable={canDrag}
                          onDragStart={canDrag ? (event) => handleDragStart(event, card, column) : undefined}
                          onDragEnd={canDrag ? handleDragEnd : undefined}
                          data-notification-focus={card.id === focusedCardId ? '' : undefined}
                        >
                          <header className="kanban-card-header">
                            <div className="kanban-card-avatar" aria-hidden="true">
                              {!hasConversation
                                ? <span className="kanban-appointment-avatar"><CalendarCheck size={17} /></span>
                                : <ContactAvatar name={card.title} avatarUrl={card.avatarUrl} className="kanban-contact-avatar" />}
                            </div>
                            <div className="kanban-card-heading">
                              <div className="contact-title-line">
                                <strong className="contact-name" title={card.title}>{card.title}</strong>
                                {card.lastAt && <small className="card-time">{card.lastAt}</small>}
                              </div>
                              <div className="kanban-card-meta">
                                {channel && (
                                  <span className={`channel-indicator-icon ${getChannelClass(channel)}`} title={card.channel || channel}>
                                    <ChannelIcon channel={channel} size={12} />
                                  </span>
                                )}
                                {labels.owner && (
                                  <span className={aiOwner ? 'kanban-ai-owner' : 'kanban-card-assignee'}>
                                    {aiOwner && <Sparkles size={11} aria-hidden="true" />}
                                    {aiOwner ? 'Atendimento por IA' : labels.owner}
                                  </span>
                                )}
                                {card.contactCategoryLabel && <span>{card.contactCategoryLabel}</span>}
                              </div>
                            </div>
                            {canDrag && (
                              <span className="kanban-card-drag-handle" title="Arraste para mover o card">
                                <GripVertical size={16} aria-hidden="true" />
                              </span>
                            )}
                          </header>

                          {card.isFollowUp && (
                            <span className="follow-up-step-badge">
                              <Clock3 size={11} aria-hidden="true" />
                              {card.followUpLabel ? `Follow-up ${card.followUpLabel}` : 'Follow-up enviado'}
                            </span>
                          )}

                          {labels.appointmentStatus && (
                            <div className={`kanban-card-appointment-summary status-${card.appointmentStatus || 'unknown'}`}>
                              <CalendarCheck size={14} aria-hidden="true" />
                              <span>
                                {labels.appointmentDate && !isBookingCard && <time dateTime={card.appointmentStartsAt}>{labels.appointmentDate}</time>}
                                <strong>{labels.appointmentStatus}</strong>
                              </span>
                            </div>
                          )}

                          {isBookingCard ? (
                            <div className="kanban-card-booking">
                              {card.appointmentContactName && (
                                <span className="booking-client"><UserRound size={14} aria-hidden="true" /><strong>{card.appointmentContactName}</strong></span>
                              )}
                              {card.appointmentWhen && (
                                <span className="booking-when"><CalendarClock size={14} aria-hidden="true" /><time dateTime={card.appointmentStartsAt}>{card.appointmentWhen}</time></span>
                              )}
                            </div>
                          ) : preview && <p className="card-subtitle" title={preview}>{preview}</p>}

                          {labels.reason && (
                            <div className="kanban-card-note">
                              <AlertCircle size={13} aria-hidden="true" />
                              <span>{labels.reason}</span>
                            </div>
                          )}


                          {actionMode !== 'request' && (
                            <AppointmentDetails card={card} timeZone={tenantSettings?.timezone} />
                          )}

                          {(() => {
                            const badge = slotProposalBadge(card.slotProposal, { ttl: tenantSettings?.settings?.appointment_request?.slot_proposal_ttl_hours });
                            return badge && <span className={`slot-proposal-badge slot-proposal-${badge.key}`} title="Proposta de horário enviada pela equipe">{badge.label}</span>;
                          })()}

                          {depositRequired && (
                            <span className="kanban-card-deposit" title="Exige sinal ao marcar um novo horário">
                              <CircleDollarSign size={13} aria-hidden="true" /> Exige sinal ao agendar
                            </span>
                          )}

                          {(actionMode || menu.length > 0) && (
                            <footer className="kanban-card-footer">
                              {actionMode === 'chat' && (
                                <button type="button" className="kanban-card-primary" onClick={openChat}>
                                  <MessageCircle size={14} aria-hidden="true" /> {chatLabel}
                                </button>
                              )}
                              {actionMode === 'outcomes' && (
                                <AppointmentOutcomeActions
                                  outcomes={outcomes}
                                  disabled={Boolean(outcomeCardId)}
                                  busy={outcomeCardId === card.id}
                                  onOutcome={(outcome) => handleMarkOutcome(card, outcome)}
                                />
                              )}
                              {actionMode === 'request' && (
                                <AppointmentRequestActions
                                  card={card}
                                  tenantSlug={tenantSlug}
                                  staleHours={tenantSettings?.settings?.appointment_request?.stale_alert_hours}
                                  suggestionEnabled={slotProposalSuggestionEnabled(tenantSlug, tenantSettings?.settings?.appointment_request)}
                                  timeZone={tenantSettings?.timezone}
                                  onChanged={onChanged}
                                  onStatus={setKanbanActionStatus}
                                />
                              )}
                              {actionMode === 'signal' && (
                                <button
                                  type="button"
                                  className="kanban-card-primary"
                                  disabled={Boolean(confirmingCardId)}
                                  onClick={() => handleConfirmSignal(card)}
                                >
                                  <CheckCircle2 size={14} aria-hidden="true" />
                                  {confirmingCardId === card.id ? 'Confirmando…' : 'Confirmar sinal'}
                                </button>
                              )}
                              <KanbanCardMenu actions={menu} title={card.title} />
                            </footer>
                          )}
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
      {noShowTarget && (
        <NoShowMessageDialog
          appointment={noShowTarget}
          tenantSlug={tenantSlug}
          tenantSettings={tenantSettings}
          onClose={() => setNoShowTarget(null)}
          onDone={async (message) => {
            setNoShowTarget(null);
            setKanbanActionStatus(message);
            await onChanged?.();
          }}
        />
      )}
      {confirmation && (
        <AppointmentConfirmDialog
          {...confirmation}
          onClose={() => setConfirmation(null)}
          onConfirm={() => {
            const action = confirmation.onConfirm;
            setConfirmation(null);
            action();
          }}
        />
      )}
    </section>
  );
}

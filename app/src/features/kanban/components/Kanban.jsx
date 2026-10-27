import { userFacingError } from '../../../utils/userFacingError.js';
import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  AlertCircle,
  Bot,
  CalendarCheck,
  CalendarDays,
  CarFront,
  Check,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Copy,
  ExternalLink,
  Flame,
  Inbox,
  MessageCircle,
  RefreshCcw,
  Search,
  Sparkles,
  UserRound,
  Wrench,
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
  getStageTone,
  getTenantSchedulingLink,
  orderKanbanColumnsForTenant,
  validateKanbanOrderProposal,
} from '../../../dataService';

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
  ready = true,
}) {
  const [agentFilter, setAgentFilter] = useState(KANBAN_OWNER_FILTERS.ALL);
  const [channelFilter, setChannelFilter] = useState('todos');
  const [kanbanCardTransition, setKanbanCardTransition] = useState('idle');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedCardId, setCopiedCardId] = useState(null);
  const [confirmingCardId, setConfirmingCardId] = useState('');
  const [kanbanActionStatus, setKanbanActionStatus] = useState('');
  const [draggingCardId, setDraggingCardId] = useState(null);
  const [dragOverColumnId, setDragOverColumnId] = useState(null);
  const [activeColumnId, setActiveColumnId] = useState('');
  const [flowProposal, setFlowProposal] = useState(null);
  const [flowToast, setFlowToast] = useState('');
  const [flowStatus, setFlowStatus] = useState('idle');
  const boardRef = useRef(null);
  const columnRefs = useRef(new Map());
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
  const getChannelClass = (type = 'telegram') => {
    const norm = String(type).toLowerCase();
    if (norm.includes('whats')) return 'channel-whatsapp';
    if (norm.includes('insta')) return 'channel-instagram';
    return 'channel-telegram';
  };
  const getBaseColumnPresentation = (column = {}) => {
    const key = [column.automationKey, column.id, column.title]
      .filter(Boolean)
      .join(' ')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    const navigationLabel = column.navigationLabel || '';
    if (/sales_closed/.test(key)) return { tone: getStageTone('sales_closed'), shortLabel: navigationLabel || 'Negócio fechado', description: 'Venda efetivamente concluída.', Icon: CheckCircle2 };
    if (/sales_after_sales/.test(key)) return { tone: getStageTone('sales_after_sales'), shortLabel: navigationLabel || 'Pós-venda', description: 'Atendimentos de manutenção e pós-venda.', Icon: Wrench };
    if (/sales_appraisal/.test(key)) return { tone: getStageTone('sales_appraisal'), shortLabel: navigationLabel || 'Avaliação de retoma', description: 'Avaliação de veículo para retoma.', Icon: CarFront };
    if (/sales_financing/.test(key)) return { tone: getStageTone('sales_financing'), shortLabel: navigationLabel || 'Financiamento', description: 'Fila operacional de financiamento.', Icon: CircleDollarSign };
    if (/sales_hot/.test(key)) return { tone: getStageTone('sales_hot'), shortLabel: navigationLabel || 'Leads quentes', description: 'Leads de compra com prioridade comercial.', Icon: Flame };
    if (/sales_human/.test(key)) return { tone: getStageTone('sales_human'), shortLabel: navigationLabel || 'Atendimento humano', description: 'Atendimento assumido pela equipe.', Icon: UserRound };
    if (/sales_qualifying/.test(key)) return { tone: getStageTone('sales_qualifying'), shortLabel: navigationLabel || 'Qualificação IA', description: 'IA coletando informações comerciais.', Icon: Bot };
    if (/sales_new/.test(key)) return { tone: getStageTone('sales_new'), shortLabel: navigationLabel || 'Novos contatos', description: 'Novos contatos aguardando qualificação.', Icon: MessageCircle };

    if (/finalizada/.test(key)) {
      return { tone: 'green', shortLabel: 'Finalizadas', description: 'Atendimentos concluídos.', Icon: CheckCircle2 };
    }
    if (/aguardando[_\s-]?humano/.test(key)) {
      return { tone: 'violet', shortLabel: 'Aguardando', displayTitle: 'Aguardando humano', description: 'Aguardando atendimento da equipe.', Icon: UserRound };
    }
    if (/com[_\s-]?humano|conversas[_\s-]?humanos/.test(key)) {
      return { tone: 'violet', shortLabel: 'Em atendimento', displayTitle: 'Em atendimento humano', description: 'Com atendentes da equipe.', Icon: UserRound };
    }
    if (/verificar[_\s-]?sinal/.test(key)) {
      return { tone: 'amber', shortLabel: 'Sinal', description: 'Aguardando confirmação.', Icon: CircleDollarSign };
    }
    if (/andamento/.test(key)) {
      return { tone: 'amber', shortLabel: 'Andamento', description: 'Em negociação.', Icon: Clock3 };
    }
    if (/agendamento/.test(key)) {
      return { tone: 'blue', shortLabel: 'Agenda', description: 'Conversas com horário marcado.', Icon: CalendarDays };
    }
    if (/produto/.test(key)) {
      return { tone: 'violet', shortLabel: 'Produtos', description: 'Produtos e serviços enviados.', Icon: Sparkles };
    }
    if (/nova/.test(key)) {
      return { tone: 'blue', shortLabel: 'Novas', description: 'Aguardando primeiro contato.', Icon: MessageCircle };
    }
    if (/conversas[_\s-]?ia|\bia\b/.test(key)) {
      return { tone: 'cyan', shortLabel: 'Conversas IA', description: 'Em atendimento com a IA.', Icon: Bot };
    }
    return { tone: 'cyan', shortLabel: column.title || 'Etapa', description: 'Conversas nesta etapa.', Icon: Inbox };
  };

  // A cor vem sempre da paleta canônica (stageTone.js): a mesma etapa tem a mesma cor
  // no Kanban e nas Conversas, e etapas diferentes nunca repetem cor.
  const getColumnPresentation = (column = {}) => ({
    ...getBaseColumnPresentation(column),
    tone: getStageTone(column.automationKey || column.id || column.title),
  });

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
        return matchesQuery && matchesAgent && matchesChannel;
      });
      return { ...col, cards };
    });
  }, [orderedColumns, agentFilter, channelFilter, searchQuery]);

  useEffect(() => {
    if (!filteredColumns.some((column) => column.id === activeColumnId)) {
      setActiveColumnId(filteredColumns[0]?.id || '');
    }
  }, [activeColumnId, filteredColumns]);

  useEffect(() => {
    const board = boardRef.current;
    if (!board || !filteredColumns.length) return undefined;

    const updateActiveColumn = () => {
      const boardBounds = board.getBoundingClientRect();
      let mostVisibleColumnId = filteredColumns[0]?.id || '';
      let largestVisibleWidth = -1;
      for (const column of filteredColumns) {
        const element = columnRefs.current.get(column.id);
        if (!element) continue;
        const bounds = element.getBoundingClientRect();
        const visibleWidth = Math.max(0, Math.min(bounds.right, boardBounds.right) - Math.max(bounds.left, boardBounds.left));
        if (visibleWidth > largestVisibleWidth) {
          largestVisibleWidth = visibleWidth;
          mostVisibleColumnId = column.id;
        }
      }
      setActiveColumnId((current) => current === mostVisibleColumnId ? current : mostVisibleColumnId);
    };

    updateActiveColumn();
    board.addEventListener('scroll', updateActiveColumn, { passive: true });
    window.addEventListener('resize', updateActiveColumn);
    return () => {
      board.removeEventListener('scroll', updateActiveColumn);
      window.removeEventListener('resize', updateActiveColumn);
    };
  }, [filteredColumns]);

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
      behavior: 'smooth',
    });
    setActiveColumnId(columnId);
  }

  // Drag & Drop Handlers
  const handleDragStart = (e, card, column) => {
    setDraggingCardId(card.id);
    e.dataTransfer.effectAllowed = 'move';
    // Usamos text/plain para compatibilidade maxima em todos os browsers
    e.dataTransfer.setData('text/plain', JSON.stringify({
      cardId: card.id,
      sourceColumnId: column.id,
      card,
    }));
  };

  const handleDragEnd = () => {
    setDraggingCardId(null);
    setDragOverColumnId(null);
  };

  const handleDragOver = (e, column) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverColumnId !== column.id) {
      setDragOverColumnId(column.id);
    }
  };

  const handleDragLeave = (e, column) => {
    if (dragOverColumnId === column.id) {
      setDragOverColumnId(null);
    }
  };

  const handleDrop = (e, targetColumn) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverColumnId(null);
    setDraggingCardId(null);
    try {
      const raw = e.dataTransfer.getData('text/plain');
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data?.card) return;
      if (data.sourceColumnId === targetColumn.id) return;
      if (onMoveCard) {
        onMoveCard(data.card, targetColumn.automationKey || targetColumn.id, targetColumn);
      }
    } catch (err) {
      console.warn('Erro ao processar drop no Kanban:', err);
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
                  title={`Ir para ${presentation.displayTitle || column.title}`}
                  aria-label={`Ir para etapa ${presentation.displayTitle || column.title}`}
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
        onDragOver={(e) => {
          if (draggingCardId) {
            e.preventDefault();
          }
        }}
        onDrop={(e) => {
          if (!draggingCardId) return;
          e.preventDefault();
          const el = document.elementFromPoint(e.clientX, e.clientY);
          const colEl = el?.closest?.('.kanban-column');
          const colId = colEl?.getAttribute('data-column-id');
          const targetCol = filteredColumns.find((c) => String(c.id) === String(colId));
          if (targetCol) {
            handleDrop(e, targetCol);
          } else {
            handleDragEnd();
          }
        }}
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
              onDragOver={(e) => handleDragOver(e, column)}
              onDragLeave={(e) => handleDragLeave(e, column)}
              onDrop={(e) => handleDrop(e, column)}
            >
              <div className="column-header">
                <span className="column-stage-icon" aria-hidden="true"><StageIcon size={19} /></span>
                <div className="column-heading-copy">
                  <strong className="column-title">{presentation.displayTitle || column.title}</strong>
                  <small className="column-description">{presentation.description}</small>
                </div>
                <span className="column-count-badge">{ready ? column.cards.length : '—'}</span>
              </div>

              <div
                className="column-cards-container"
                onDragOver={(e) => handleDragOver(e, column)}
                onDrop={(e) => handleDrop(e, column)}
              >
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
                          draggable={true}
                          onDragStart={(e) => handleDragStart(e, card, column)}
                          onDragEnd={handleDragEnd}
                          onDragOver={(e) => handleDragOver(e, column)}
                          onDrop={(e) => handleDrop(e, column)}
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

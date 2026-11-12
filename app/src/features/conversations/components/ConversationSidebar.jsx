import React from 'react';
import { Bot, Check, CheckCircle2, Clock3, Filter, Search, Sparkles, UserRound, X } from 'lucide-react';
import { formatConversationCardOrigin, formatMediaPreviewWithIcon, formatWaitingDuration, getStageLabel } from '../../../dataService.js';
import { ContactAvatar, ContactAvatarBadge } from '../../../components/ui/ContactAvatar.jsx';
import { EmptyState } from '../../../components/ui/EmptyState.jsx';
import { SkeletonLine } from '../../../components/ui/Skeletons.jsx';
import { ChannelIcon, getChannelClass } from '../../../components/ui/ChannelIcon.jsx';
import { deriveConversationPresentationState } from '../utils/chatTimelineHelpers.js';
import { conversationListTags, conversationStageChip } from '../utils/conversationListTags.js';
import { findKanbanColumn } from '../../../services/kanban/stageResolution.js';
import { formatConversationPreview } from '../../../utils/audioUtils.js';
export function ConversationSidebar({
  activeCount = 0, activeTab, agentsList, allowedChannels, availableStages, channelCounts, channelFilter,
  closedCount, filteredConversations, followUpCount, isSecondaryFilterActive, kanbanColumns,
  kanbanCardsByConversationKey,
  onCloseSearch, onOpenSearch, onSearchKeyDown, onSelectConversation, query, ready, responsibleFilter, searchInputRef,
  searchOpen, selected, setActiveTab, setChannelFilter, setQuery, setResponsibleFilter,
  setShowFilterMenu, setStageFilter, showFilterMenu, stageFilter, tenantSettings, tenantSlug,
  unreadCount,
}) {
  return (
    <aside className="conversation-list panel">
      <div className="toolbar" style={{ position: 'relative' }}>
        <div className="conversations-search-wrapper">
          <button
            type="button"
            className="icon-button search-expand-btn"
              onClick={onOpenSearch}
            title="Buscar conversa"
            aria-label="Buscar conversa"
          >
            <Search size={16} />
          </button>
          <div className="search-box">
            <Search size={16} className="search-icon-inside" />
            <input
              ref={searchInputRef}
              placeholder="Buscar conversa..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onSearchKeyDown}
              aria-label="Buscar conversa"
            />
            {Boolean(query && query.trim() !== '') && (
              <button
                type="button"
                className="search-clear-btn"
                  onClick={onCloseSearch}
                title="Limpar busca"
                aria-label="Limpar busca"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
        <div className="filter-dropdown-wrapper">
          <button
            className={`icon-button ${isSecondaryFilterActive ? 'active-filter' : ''}`}
            title="Filtros"
            aria-label="Abrir filtros de conversas"
            type="button"
            onClick={() => setShowFilterMenu((prev) => !prev)}
          >
            <Filter size={17} />
            {isSecondaryFilterActive && (
              <span className="filter-indicator-dot filter-dot-active" />
            )}
          </button>

          {showFilterMenu && (

            <>
              <div className="dropdown-overlay" onClick={() => setShowFilterMenu(false)} />
              <div className="filter-popover-menu" role="menu" aria-label="Menu de filtros">
                <div className="filter-primary-section">
                  <div className="filter-popover-header">
                    <span>Responsável</span>
                  </div>
                  <button
                    type="button"
                    className={`filter-menu-item ${responsibleFilter === 'todos' ? 'selected' : ''}`}
                    onClick={() => { setResponsibleFilter('todos'); setShowFilterMenu(false); }}
                  >
                    <div className="filter-item-left">
                      {responsibleFilter === 'todos' ? <Check size={14} className="filter-check-icon" /> : <span className="filter-check-placeholder" />}
                      <span>Todos</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    className={`filter-menu-item ${responsibleFilter === 'ia' ? 'selected' : ''}`}
                    onClick={() => { setResponsibleFilter('ia'); setShowFilterMenu(false); }}
                  >
                    <div className="filter-item-left">
                      {responsibleFilter === 'ia' ? <Check size={14} className="filter-check-icon" /> : <span className="filter-check-placeholder" />}
                      <span className="filter-item-icon-wrap"><Bot size={13} /></span>
                      <span>IA</span>
                    </div>
                  </button>
                  {(!Array.isArray(agentsList) || agentsList.length === 0) ? (
                    <button
                      type="button"
                      className={`filter-menu-item ${responsibleFilter === 'humano' ? 'selected' : ''}`}
                      onClick={() => { setResponsibleFilter('humano'); setShowFilterMenu(false); }}
                    >
                      <div className="filter-item-left">
                        {responsibleFilter === 'humano' ? <Check size={14} className="filter-check-icon" /> : <span className="filter-check-placeholder" />}
                        <span className="filter-item-icon-wrap"><UserRound size={13} /></span>
                        <span>Humano</span>
                      </div>
                    </button>
                  ) : agentsList.length === 1 ? (
                    <button
                      type="button"
                      className={`filter-menu-item ${
                        (responsibleFilter === 'humano' || responsibleFilter === agentsList[0].id || responsibleFilter === agentsList[0].name)
                          ? 'selected'
                          : ''
                      }`}
                      onClick={() => {
                        setResponsibleFilter(agentsList[0]?.name || agentsList[0]?.id || 'humano');
                        setShowFilterMenu(false);
                      }}
                    >
                      <div className="filter-item-left">
                        {(responsibleFilter === 'humano' || responsibleFilter === agentsList[0].id || responsibleFilter === agentsList[0].name) ? (
                          <Check size={14} className="filter-check-icon" />
                        ) : (
                          <span className="filter-check-placeholder" />
                        )}
                        <span className="filter-item-icon-wrap"><UserRound size={13} /></span>
                        <span>Humano ({agentsList[0].name})</span>
                      </div>
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className={`filter-menu-item ${responsibleFilter === 'humano' ? 'selected' : ''}`}
                        onClick={() => { setResponsibleFilter('humano'); setShowFilterMenu(false); }}
                      >
                        <div className="filter-item-left">
                          {responsibleFilter === 'humano' ? <Check size={14} className="filter-check-icon" /> : <span className="filter-check-placeholder" />}
                          <span className="filter-item-icon-wrap"><UserRound size={13} /></span>
                          <span>Todos os humanos</span>
                        </div>
                      </button>
                      <div className="filter-sub-agents-list">
                        {agentsList.map((agent) => (
                          <button
                            key={agent.id}
                            type="button"
                            className={`filter-menu-item filter-sub-item ${responsibleFilter === agent.id || responsibleFilter === agent.name ? 'selected' : ''}`}
                            onClick={() => { setResponsibleFilter(agent.name || agent.id); setShowFilterMenu(false); }}
                          >
                            <div className="filter-item-left">
                              {(responsibleFilter === agent.id || responsibleFilter === agent.name) ? <Check size={14} className="filter-check-icon" /> : <span className="filter-check-placeholder" />}
                              <span className="filter-item-icon-wrap"><UserRound size={12} /></span>
                              <span className="filter-agent-name">{agent.name}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  <div className="filter-popover-divider" />
                </div>

                {availableStages.length > 0 && (
                  <div className="filter-stage-section">
                    <div className="filter-popover-header">
                      <span>Etapa</span>
                    </div>
                    <button
                      type="button"
                      className={`filter-menu-item ${stageFilter === 'todas' ? 'selected' : ''}`}
                      onClick={() => { setStageFilter('todas'); setShowFilterMenu(false); }}
                    >
                      <div className="filter-item-left">
                        {stageFilter === 'todas' ? <Check size={14} className="filter-check-icon" /> : <span className="filter-check-placeholder" />}
                        <span>Todas as etapas</span>
                      </div>
                    </button>
                    <div className="filter-stages-scroll">
                      {availableStages.map((stageName) => (
                        <button
                          key={stageName}
                          type="button"
                          className={`filter-menu-item ${stageFilter === stageName ? 'selected' : ''}`}
                          onClick={() => { setStageFilter(stageName); setShowFilterMenu(false); }}
                        >
                          <div className="filter-item-left">
                            {stageFilter === stageName ? <Check size={14} className="filter-check-icon" /> : <span className="filter-check-placeholder" />}
                            <span>{stageName}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                    <div className="filter-popover-divider" />
                  </div>
                )}

                <div className="filter-channel-section">
                  <div className="filter-popover-header">
                    <span>Canais</span>
                  </div>
                  <button
                    type="button"
                    className={`filter-menu-item ${channelFilter === 'todos' ? 'selected' : ''}`}

                    onClick={() => { setChannelFilter('todos'); setShowFilterMenu(false); }}
                  >
                    <div className="filter-item-left">
                      {channelFilter === 'todos' ? <Check size={14} className="filter-check-icon" /> : <span className="filter-check-placeholder" />}
                      <span className="channel-indicator-icon channel-webchat"><Sparkles size={12} /></span>
                      <span>Todos os canais</span>
                    </div>
                    <span className="count-badge">{channelCounts.todos}</span>
                  </button>
                  {allowedChannels.includes('telegram') && (
                    <button
                      type="button"
                      className={`filter-menu-item ${channelFilter === 'telegram' ? 'selected' : ''}`}
                      onClick={() => { setChannelFilter('telegram'); setShowFilterMenu(false); }}
                    >
                      <div className="filter-item-left">
                        {channelFilter === 'telegram' ? <Check size={14} className="filter-check-icon" /> : <span className="filter-check-placeholder" />}
                        <span className="channel-indicator-icon channel-telegram"><ChannelIcon channel="telegram" size={12} /></span>
                        <span>Telegram</span>
                      </div>
                      <span className="count-badge telegram">{channelCounts.telegram}</span>
                    </button>
                  )}
                  {allowedChannels.includes('whatsapp') && (
                    <button
                      type="button"
                      className={`filter-menu-item ${channelFilter === 'whatsapp' ? 'selected' : ''}`}
                      onClick={() => { setChannelFilter('whatsapp'); setShowFilterMenu(false); }}
                    >
                      <div className="filter-item-left">
                        {channelFilter === 'whatsapp' ? <Check size={14} className="filter-check-icon" /> : <span className="filter-check-placeholder" />}
                        <span className="channel-indicator-icon channel-whatsapp"><ChannelIcon channel="whatsapp" size={12} /></span>
                        <span>WhatsApp</span>
                      </div>
                      <span className="count-badge whatsapp">{channelCounts.whatsapp}</span>
                    </button>
                  )}
                  {allowedChannels.includes('instagram') && (
                    <button
                      type="button"
                      className={`filter-menu-item ${channelFilter === 'instagram' ? 'selected' : ''}`}
                      onClick={() => { setChannelFilter('instagram'); setShowFilterMenu(false); }}
                    >
                      <div className="filter-item-left">
                        {channelFilter === 'instagram' ? <Check size={14} className="filter-check-icon" /> : <span className="filter-check-placeholder" />}
                        <span className="channel-indicator-icon channel-instagram"><ChannelIcon channel="instagram" size={12} /></span>
                        <span>Instagram</span>
                      </div>
                      <span className="count-badge instagram">{channelCounts.instagram}</span>
                    </button>

                  )}
                </div>

                {isSecondaryFilterActive && (
                  <div className="filter-clear-section">
                    <div className="filter-popover-divider" />
                    <button
                      type="button"
                      className="filter-clear-all-btn"
                      onClick={() => {
                        setResponsibleFilter('todos');
                        setStageFilter('todas');
                        setChannelFilter('todos');
                        setShowFilterMenu(false);
                      }}
                    >
                      Limpar filtros
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="chips" role="tablist" aria-label="Abas de conversas">
        <button
          role="tab"
          aria-selected={activeTab === 'ativas'}
          aria-label="Conversas ativas"
          className={`chip ${activeTab === 'ativas' ? 'active' : ''}`}
          type="button"
          onClick={() => setActiveTab('ativas')}
        >
          <span>Ativas</span>
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'nao_lidas'}
          aria-label={`Conversas não lidas, ${unreadCount}`}
          className={`chip ${activeTab === 'nao_lidas' ? 'active' : ''}`}
          type="button"
          onClick={() => setActiveTab('nao_lidas')}
        >
          <span>Não lidas</span>
          {unreadCount > 0 && <span className="tab-badge unread">{unreadCount}</span>}
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'encerradas'}
          aria-label={`Conversas encerradas, ${closedCount}`}
          className={`chip ${activeTab === 'encerradas' ? 'active' : ''}`}
          type="button"
          onClick={() => setActiveTab('encerradas')}
        >
          <span>Encerradas</span>
          {closedCount > 0 && <span className="tab-badge closed">{closedCount}</span>}
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'follow_up'}
          aria-label={`Conversas em follow-up, ${followUpCount}`}
          className={`chip ${activeTab === 'follow_up' ? 'active' : ''}`}
          type="button"
          onClick={() => setActiveTab('follow_up')}
        >
          <span>Follow-up</span>
          <span className="tab-badge follow-up">{followUpCount}</span>
        </button>
      </div>

      {isSecondaryFilterActive && (
        <div className="active-filter-chips">
          {responsibleFilter !== 'todos' && (
            <button
              type="button"
              className="filter-tag-chip"
              onClick={() => setResponsibleFilter('todos')}
              title="Remover filtro de responsável"
            >
              <span>{responsibleFilter === 'ia' ? 'IA' : responsibleFilter === 'humano' ? 'Humano' : responsibleFilter}</span>
              <X size={12} />
            </button>
          )}
          {stageFilter !== 'todas' && (
            <button
              type="button"
              className="filter-tag-chip"
              onClick={() => setStageFilter('todas')}
              title="Remover filtro de etapa"
            >
              <span>{stageFilter}</span>
              <X size={12} />
            </button>
          )}
          {channelFilter !== 'todos' && (
            <button
              type="button"
              className={`filter-tag-chip channel-filter-active-chip ${getChannelClass(channelFilter)}`}

              onClick={() => setChannelFilter('todos')}
              title="Remover filtro de canal"
            >
              <ChannelIcon channel={channelFilter} size={11} />
              <span>{channelFilter === 'telegram' ? 'Telegram' : channelFilter === 'whatsapp' ? 'WhatsApp' : 'Instagram'}</span>
              <X size={12} />
            </button>
          )}
        </div>
      )}

      <div className="conversation-items-scroll" key={`${activeTab}-${responsibleFilter}-${stageFilter}-${channelFilter}`}>
        {!ready ? (
          [1, 2, 3, 4, 5].map((i) => (
            <div className="conversation-item conversation-item-skeleton" key={i}>
              <div className="conversation-avatar-wrapper">
                <div className="conversation-avatar skeleton-block" />
              </div>
              <div className="conversation-item-main">
                <div className="conversation-item-top">
                  <SkeletonLine width="90px" />
                  <SkeletonLine width="40px" />
                </div>
                <div className="conversation-item-bottom">
                  <SkeletonLine width="140px" />
                </div>
              </div>
            </div>
          ))
        ) : (
          <>
            {filteredConversations.map((conversation) => {
              const matchingCard = kanbanCardsByConversationKey?.get(conversation.canonicalKey)
                || (conversation.normalizedExternalId && kanbanCardsByConversationKey?.get(conversation.normalizedExternalId))
                || (conversation.externalConversationId && kanbanCardsByConversationKey?.get(conversation.externalConversationId))
                || kanbanCardsByConversationKey?.get(conversation.id)
                || null;
              const conversationStageLabel = getStageLabel(conversation.stage || conversation.salesStageKey, { kanbanColumns, tenantSettings, tenantSlug });
              const presentation = deriveConversationPresentationState(conversation, {
                matchingCard,
                activeAgents: agentsList,
                stageLabel: conversationStageLabel,
                kanbanColumns,
                tenantSlug,
                tenantSettings,
              });
              const stageColumn = Array.isArray(kanbanColumns)
                ? findKanbanColumn(kanbanColumns, conversation.stage || conversation.salesStageKey) || null
                : null;
              const listTags = conversationListTags(presentation, matchingCard, stageColumn);
              const stageChip = conversationStageChip(listTags.column);
              const origin = formatConversationCardOrigin(conversation);
              const formattedPreview = formatMediaPreviewWithIcon(formatConversationPreview(conversation.lastMessage));
              const isSelected = selected?.id === conversation.id;
              const isUnread = (conversation.unread || 0) > 0;
              const isWaitingFollowUp = Boolean(conversation.waitingForFollowUp);

              return (
                <button
                  key={conversation.id}
                  type="button"
                  className={`conversation-item ${getChannelClass(conversation.channelType || conversation.channel)} ${isSelected ? 'active' : ''} ${isUnread ? 'is-unread' : ''}`}
                  onClick={() => onSelectConversation(conversation.id)}
                >
                  <div className="conversation-avatar-wrapper">
                    <ContactAvatar name={conversation.contact} avatarUrl={conversation.avatarUrl} />
                    <ContactAvatarBadge
                      channel={conversation.channelType || conversation.channel}
                      presence={conversation.presence}
                    />
                  </div>

                  <div className="conversation-item-main">
                    <div className="conversation-item-top">
                      <div className="contact-name-group">
                        <strong className="contact-name" title={conversation.contact}>{conversation.contact}</strong>
                        {conversation.contactCategory && (
                          <span
                            className={`contact-category-pill pill-${conversation.contactCategory}`}
                            title={conversation.contactCategoryLabel || 'Cliente'}
                          >
                            {conversation.contactCategory === 'commercial' ? 'Comercial' : conversation.contactCategory === 'saved' ? 'Salvo' : 'Cliente'}
                          </span>
                        )}
                      </div>
                      <small className="timestamp">{conversation.lastAt}</small>
                    </div>

                    <div className="conversation-item-bottom">
                      <span
                        className="last-message"
                        title={conversation.lastMessageSender
                          ? `${origin}: ${formatConversationPreview(conversation.lastMessage)}`
                          : formatConversationPreview(conversation.lastMessage)}
                      >
                        {isWaitingFollowUp && activeTab === 'follow_up' ? (
                          <>
                            <span className="follow-up-wait-tag">
                              <Clock3 size={11} className="follow-up-clock-icon" />
                              <span>{formatWaitingDuration(conversation.waitingSince || conversation.latestFollowUpAt)}</span>
                            </span>
                            <span className="origin-separator">·</span>
                            <span className="last-message-text">
                              {formattedPreview.icon && <span className="media-preview-icon">{formattedPreview.icon} </span>}
                              {formattedPreview.text}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="last-message-origin">{origin}</span>
                            <span className="origin-separator">·</span>
                            <span className="last-message-text">
                              {formattedPreview.icon && <span className="media-preview-icon">{formattedPreview.icon} </span>}
                              {formattedPreview.text}
                            </span>
                          </>
                        )}
                      </span>


                      {isUnread ? (
                        <span className="item-unread-badge" aria-label={`${conversation.unread} mensagens não lidas`}>
                          {conversation.unread}
                        </span>
                      ) : isWaitingFollowUp ? (
                        <span
                          className="item-follow-up-indicator"
                          title={formatWaitingDuration(conversation.waitingSince || conversation.latestFollowUpAt)}
                        >
                          <Clock3 size={13} />
                        </span>
                      ) : null}
                    </div>

                    <div className="conversation-item-tags">
                      {listTags.owner?.kind === 'closed' && (
                        <span className="attendant-pill closed" title="Atendimento encerrado">
                          <CheckCircle2 size={11} />
                          <span>Encerrada</span>
                        </span>
                      )}
                      {listTags.owner?.kind === 'human' && (
                        <span className="attendant-pill humano" title={`Atendimento humano: ${listTags.owner.label}`}>
                          <UserRound size={11} />
                          <span>{listTags.owner.label}</span>
                        </span>
                      )}
                      {listTags.owner?.kind === 'ai' && (
                        <span className="attendant-pill ia" title="Assistente IA">
                          <Bot size={11} />
                          <span>IA</span>
                        </span>
                      )}
                      {stageChip && (
                        <span
                          className={`conversation-stage-tag stage-tag has-icon tone-${stageChip.tone}`}
                          title={`Coluna do Kanban: ${stageChip.label}`}
                        >
                          <stageChip.Icon size={11} aria-hidden="true" />
                          <span>{stageChip.label}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
            {!filteredConversations.length && <EmptyState title="Nenhum resultado" text="Ajuste a busca ou os filtros para ver outras conversas." compact />}
          </>
        )}
      </div>
    </aside>

  );
}

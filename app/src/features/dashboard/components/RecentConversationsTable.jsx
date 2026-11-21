import React, { useState, useMemo } from 'react';
import {
  MessageSquare,
  ExternalLink,
  Search,
} from 'lucide-react';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ContactAvatar } from '../../../components/ui/ContactAvatar';
import { SkeletonLine, SkeletonBlock } from '../../../components/ui/Skeletons';
import { sortConversationsByRecentActivity, getStageLabel } from '../../../dataService';
import { formatConversationPreview } from '../../../utils/audioUtils';

export function RecentConversationsTable({
  conversations = [],
  ready = true,
  onOpenConversation,
  kanbanColumns = [],
  tenantSettings = null,
  tenantSlug = '',
}) {
  const [filterQuery, setFilterQuery] = useState('');

  const sortedConversations = useMemo(() => {
    return sortConversationsByRecentActivity(conversations);
  }, [conversations]);

  const filteredConversations = useMemo(() => {
    if (!filterQuery.trim()) return sortedConversations;
    const q = filterQuery.toLowerCase();
    return sortedConversations.filter((item) => {
      const contact = String(item.contact || '').toLowerCase();
      const company = String(item.company || '').toLowerCase();
      const lastMsg = String(item.lastMessage || '').toLowerCase();
      return contact.includes(q) || company.includes(q) || lastMsg.includes(q);
    });
  }, [sortedConversations, filterQuery]);

  const displayedConversations = useMemo(() => {
    return filteredConversations.slice(0, 10);
  }, [filteredConversations]);

  const totalCount = filteredConversations.length;
  const currentCount = displayedConversations.length;

  return (
    <section className="dashboard-recent-card" aria-label="Atendimentos Recentes">
      <div className="recent-card-header">
        <div className="recent-header-left">
          <div className="recent-icon-box" aria-hidden="true">
            <MessageSquare size={16} className="recent-header-icon" />
          </div>
          <div className="recent-header-titles">
            <div className="recent-title-row">
              <h3 className="recent-title">Atendimentos Recentes</h3>
              <span className="recent-count-pill">
                {ready ? `${currentCount} de ${totalCount}` : '—'}
              </span>
            </div>
            <p className="recent-subtitle">
              Últimas interações em tempo real por canal e responsável
            </p>
          </div>
        </div>

        <div className="recent-search-wrap">
          <Search size={14} className="recent-search-icon" aria-hidden="true" />
          <input
            type="text"
            placeholder="Buscar contato ou mensagem..."
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            className="recent-search-input"
            aria-label="Buscar contato ou mensagem"
          />
        </div>
      </div>

      <div className="recent-table-wrap">
        <div className="recent-table">
          <div className="recent-thead" role="row">
            <span className="recent-th th-contact">CONTATO</span>
            <span className="recent-th th-status">STATUS</span>
            <span className="recent-th th-owner">RESPONSÁVEL</span>
            <span className="recent-th th-message">ÚLTIMA MENSAGEM</span>
            <span className="recent-th th-time">HORÁRIO</span>
          </div>

          <div className="recent-tbody">
            {!ready ? (
              [1, 2, 3, 4, 5, 6].map((i) => (
                <div className="recent-row recent-row-skeleton" key={i}>
                  <div className="recent-cell td-contact">
                    <SkeletonBlock width="32px" height="32px" style={{ borderRadius: '50%' }} />
                    <SkeletonLine width="110px" />
                  </div>
                  <div className="recent-cell td-status">
                    <SkeletonLine width="80px" />
                  </div>
                  <div className="recent-cell td-owner">
                    <SkeletonLine width="70px" />
                  </div>
                  <div className="recent-cell td-message">
                    <SkeletonLine width="160px" />
                  </div>
                  <div className="recent-cell td-time">
                    <SkeletonLine width="60px" />
                  </div>
                </div>
              ))
            ) : displayedConversations.length > 0 ? (
              displayedConversations.map((item) => {
                const stageLabel = getStageLabel(item.stage || item.salesStageKey, { kanbanColumns, tenantSettings, tenantSlug });
                const isHuman = item.status === 'atendimento_humano'
                  || String(stageLabel || '').toLowerCase().includes('humano')
                  || (item.owner && item.owner !== 'Assistente IA' && item.ownerKind === 'agent');

                const ownerIsPerson = Boolean(item.owner && item.owner !== 'Assistente IA' && !item.owner.toLowerCase().includes('sem responsável'));
                const ownerName = ownerIsPerson ? item.owner : 'Assistente';

                // Determinar remetente da última mensagem
                const senderType = String(item.lastMessageSenderType || '').toLowerCase();
                const senderName = String(item.lastMessageSender || '').toLowerCase();
                const isClient = senderType === 'contact' || senderName.includes('cliente') || senderName.includes('contato');
                const isAgent = senderType === 'agent' || senderName.includes('atendente') || (!isClient && senderType !== 'ai' && !senderName.includes('ia'));

                let originLabel = 'IA';
                let originTone = 'ia';
                if (isClient) {
                  originLabel = 'Cliente';
                  originTone = 'cliente';
                } else if (isAgent) {
                  originLabel = 'Equipe';
                  originTone = 'atendente';
                }

                const formattedPreview = formatConversationPreview(item.lastMessage);
                const messageText = formattedPreview || (item.lastMessage && typeof item.lastMessage === 'string' ? item.lastMessage : 'Mensagem');

                return (
                  <div
                    className="recent-row"
                    key={item.id}
                    onClick={() => onOpenConversation?.(item.id || item.externalConversationId)}
                    role="button"
                    tabIndex={0}
                    aria-label={`Conversa com ${item.contact}, ${isHuman ? 'Humano' : 'IA ativa'}`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        if (e.key === ' ') e.preventDefault();
                        onOpenConversation?.(item.id || item.externalConversationId);
                      }
                    }}
                  >
                    {/* 1. CONTATO */}
                    <div className="recent-cell td-contact">
                      <div className="recent-avatar-wrap">
                        <ContactAvatar name={item.contact} avatarUrl={item.avatarUrl} />
                        <span className="recent-avatar-dot" aria-hidden="true" />
                      </div>
                      <span className="recent-contact-name" title={item.contact}>
                        {item.contact}
                      </span>
                    </div>

                    {/* 2. STATUS */}
                    <div className="recent-cell td-status">
                      <span className={`recent-status-text tone-${isHuman ? 'human' : 'ia'}`} title={stageLabel || (isHuman ? 'Atendimento humano' : 'Atendimento por IA')}>
                        {isHuman ? 'Humano' : 'IA ativa'}
                      </span>
                    </div>

                    {/* 3. RESPONSÁVEL */}
                    <div className="recent-cell td-owner">
                      <span className="recent-owner-text" title={ownerName}>{ownerName}</span>
                    </div>

                    {/* 4. ÚLTIMA MENSAGEM */}
                    <div className="recent-cell td-message">
                      <span className={`recent-message-origin origin-${originTone}`}>{originLabel}</span>
                      <span className="recent-message-separator" aria-hidden="true">·</span>
                      <span className="recent-message-snippet" title={messageText}>
                        {messageText}
                      </span>
                    </div>

                    {/* 5. HORÁRIO + AÇÃO */}
                    <div className="recent-cell td-time">
                      <span className="recent-timestamp">{item.lastAt || '—'}</span>
                      <button
                        type="button"
                        className="recent-open-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenConversation?.(item.id || item.externalConversationId);
                        }}
                        title={`Abrir conversa com ${item.contact}`}
                        aria-label={`Abrir conversa com ${item.contact}`}
                      >
                        <ExternalLink size={13} />
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <EmptyState
                title={filterQuery ? 'Nenhum contato encontrado' : 'Nenhuma conversa registrada'}
                text={filterQuery ? 'Tente buscar com outro nome de contato ou termo.' : 'Aguardando novas mensagens no canal.'}
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export default RecentConversationsTable;

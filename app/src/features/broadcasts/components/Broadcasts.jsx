import { userFacingError } from '../../../utils/userFacingError.js';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Clock3,
  Search,
  UsersRound,
  X,
  Play,
  AlertTriangle,
  RotateCcw,
  CheckCircle2,
  Upload,
  Download,
  MessagesSquare,
  ClipboardPaste,
  Info,
  Loader2,
  Send,
} from 'lucide-react';
import { ContactAvatar } from '../../../components/ui/ContactAvatar';
import { ChannelIcon, getChannelClass } from '../../../components/ui/ChannelIcon';
import { SkeletonBlock, SkeletonLine } from '../../../components/ui/Skeletons';
import {
  createBroadcastCampaign,
  updateBroadcastCampaign,
  updateBroadcastRecipient,
  upsertBroadcastContacts,
} from '../../../dataService';
import { createBroadcastOperations } from '../../../services/broadcasts/broadcastOperations.js';
import { executeBroadcastCampaign } from '../../../services/broadcasts/broadcastWorker.js';
import {
  RECIPIENT_STATUS,
  CAMPAIGN_STATUS,
  calculateCampaignCounters,
} from '../../../services/broadcasts/broadcastStateMachine.js';
import { getAuthClient, getCurrentSession } from '../../../services/auth/authService.js';
import { sendN8nCommand } from '../../../services/integration.js';
import { CHANNEL_OPTIONS } from '../../../services/tenants/tenantAccess.js';
import {
  parseContactFile,
  SUPPORTED_CONTACT_FORMATS,
  normalizeImportedContact,
  conversationToBroadcastContact,
  contactKey,
  mergeBroadcastContacts,
  displayContactName,
  displayContactPhone,
} from '../utils/broadcastImport';

export function Broadcasts({ conversations = [], contacts = [], campaigns = [], tenantSlug, onChanged, ready = true, allowedChannels = CHANNEL_OPTIONS.map(c => c.id) }) {
  const defaultChannel = allowedChannels.includes('telegram') ? 'telegram' : allowedChannels[0] || 'whatsapp';
  const [draftContacts, setDraftContacts] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [messageText, setMessageText] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [contactSearch, setContactSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatusState] = useState({ message: '', tone: 'info' });
  // tone: 'info' | 'progress' | 'success' | 'error'
  const setStatus = (message, tone = 'info') => setStatusState({ message: message || '', tone });
  const abortControllerRef = useRef(null);
  const fileInputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [importSummary, setImportSummary] = useState(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');

  const broadcastOps = useMemo(() => {
    return createBroadcastOperations({
      getClient: getAuthClient,
      loadTenant: async (slug) => {
        const supabase = getAuthClient();
        if (!supabase) return null;
        const { data } = await supabase.from('tenants').select('id, slug, status').eq('slug', slug).single();
        return data || null;
      },
      currentUserId: async () => {
        const session = await getCurrentSession();
        return session?.user?.id || null;
      },
    });
  }, []);

  const allContacts = useMemo(() => {
    const conversationContacts = conversations
      .map(conversationToBroadcastContact)
      .filter((contact) => contact.externalConversationId && allowedChannels.includes(contact.channelType));
    return mergeBroadcastContacts(contacts, conversationContacts, draftContacts)
      .filter((contact) => allowedChannels.includes(contact.channelType || contact.channel_type || defaultChannel));
  }, [allowedChannels, contacts, conversations, defaultChannel, draftContacts]);
  const stages = useMemo(() => Array.from(new Set(conversations.map((item) => item.stage).filter(Boolean))), [conversations]);
  const selectedContacts = allContacts.filter((contact) => selected.has(contact.key));
  const visibleContacts = useMemo(() => {
    const query = contactSearch.trim().toLocaleLowerCase('pt-BR');
    if (!query) return allContacts;
    return allContacts.filter((contact) => {
      const name = contact.name || contact.contact_name || '';
      const phone = contact.phone || contact.external_conversation_id || contact.externalConversationId || '';
      return `${name} ${phone}`.toLocaleLowerCase('pt-BR').includes(query);
    });
  }, [allContacts, contactSearch]);
  const allVisibleSelected = visibleContacts.length > 0 && visibleContacts.every((contact) => selected.has(contact.key || contactKey(contact)));

  async function importFile(file) {
    if (!file) return;
    const existing = new Set(allContacts.map((contact) => contact.key || contactKey(contact)));
    try {
      const parsed = await parseContactFile(file);
      const normalized = parsed.map((row) => normalizeImportedContact(row, defaultChannel));
      const valid = normalized.filter((row) => row.externalConversationId && allowedChannels.includes(row.channelType));
      const unique = new Map();
      valid.forEach((row) => unique.set(row.key, row));
      const fresh = Array.from(unique.values()).filter((row) => !existing.has(row.key));
      setDraftContacts((prev) => mergeBroadcastContacts(prev, Array.from(unique.values())));
      setSelected((prev) => {
        const next = new Set(prev);
        unique.forEach((contact, key) => next.add(key));
        return next;
      });
      setImportSummary({
        fileName: file.name,
        total: normalized.length,
        imported: unique.size,
        added: fresh.length,
        duplicates: valid.length - unique.size,
        ignored: normalized.length - valid.length,
      });
      if (!allowedChannels.length) {
        setStatus('Nenhum canal de envio está habilitado para esta empresa. Ative um canal em Configurações para importar contatos.', 'error');
      } else if (!unique.size) {
        setStatus(`Nenhum contato válido em ${file.name}. Confira se há uma coluna de telefone.`, 'error');
      } else {
        setStatus(`${unique.size} contatos importados de ${file.name}.`, 'success');
      }
    } catch (error) {
      setImportSummary(null);
      setStatus(userFacingError(error, 'Nao foi possivel importar a planilha.'), 'error');
    }
  }

  async function handleFile(event) {
    const file = event.target.files?.[0];
    await importFile(file);
    event.target.value = '';
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragging(false);
    void importFile(event.dataTransfer?.files?.[0]);
  }

  async function importPastedText() {
    await importFile(new File([pasteText], 'lista-colada.txt', { type: 'text/plain' }));
    setPasteText('');
    setPasteOpen(false);
  }

  function downloadTemplate() {
    const csv = '\uFEFFnome;telefone;canal\nMaria Silva;5521999990000;whatsapp\nJoão Souza;(21) 98888-0000;whatsapp\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'modelo-contatos-disparo.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  function addRecentContacts() {
    const recent = conversations.map(conversationToBroadcastContact).filter((item) => item.externalConversationId);
    setDraftContacts((prev) => mergeBroadcastContacts(prev, recent));
    setSelected((prev) => {
      const next = new Set(prev);
      recent.forEach((contact) => next.add(contactKey(contact)));
      return next;
    });
    if (!recent.length) setStatus('Nenhuma conversa recente tem telefone para adicionar.', 'info');
    else setStatus(`${recent.length} contatos recentes adicionados.`, 'success');
  }

  function addStageContacts() {
    if (!stageFilter) return;
    const stageContacts = conversations
      .filter((conversation) => conversation.stage === stageFilter)
      .map(conversationToBroadcastContact)
      .filter((item) => item.externalConversationId);
    setDraftContacts((prev) => mergeBroadcastContacts(prev, stageContacts));
    setSelected((prev) => {
      const next = new Set(prev);
      stageContacts.forEach((contact) => next.add(contactKey(contact)));
      return next;
    });
    if (!stageContacts.length) setStatus('Nenhum contato com telefone nesta etapa do quadro.', 'info');
    else setStatus(`${stageContacts.length} contatos do quadro adicionados.`, 'success');
  }

  function toggleContact(key) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAllVisibleContacts() {
    setSelected((prev) => {
      const next = new Set(prev);
      visibleContacts.forEach((contact) => {
        const key = contact.key || contactKey(contact);
        if (allVisibleSelected) next.delete(key);
        else next.add(key);
      });
      return next;
    });
  }

  function clearSelectedContacts() {
    setSelected(new Set());
  }

  // Detecta qualquer campanha em andamento, pausada ou com envios incertos a reconciliar
  const recoverableCampaign = useMemo(() => {
    return (campaigns || []).find((c) =>
      c.status === CAMPAIGN_STATUS.SENDING ||
      c.status === CAMPAIGN_STATUS.PAUSED ||
      c.status === CAMPAIGN_STATUS.QUEUED ||
      (c.status === CAMPAIGN_STATUS.PARTIAL_ERROR && (c.unknown_count > 0 || (c.sent_count || 0) < (c.total_recipients || 0)))
    );
  }, [campaigns]);

  useEffect(() => {
    if (!busy) return undefined;
    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = 'Um disparo de mensagens está em processamento persistido. Fechar a aba pausará o envio local sem risco de duplicatas, e a campanha poderá ser retomada.';
      return event.returnValue;
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [busy]);

  async function resumeCampaign(campaignToResume) {
    if (busy || !campaignToResume) return;
    setBusy(true);
    setStatus(`Retomando campanha "${campaignToResume.name}" de forma segura...`, 'progress');

    const abortController = typeof window !== 'undefined' && window.AbortController ? new window.AbortController() : null;
    abortControllerRef.current = abortController;

    try {
      // 1. Recupera leases órfãs ('claimed' -> 'queued'; 'sending' -> 'unknown')
      await broadcastOps.recoverStaleLeases(campaignToResume.id);

      // 2. Dispara sinalização ao backend/n8n se disponível
      sendN8nCommand('broadcast_resume', {
        campaign_id: campaignToResume.id,
        tenant_slug: tenantSlug,
      }, tenantSlug).catch(() => {});

      // 3. Executa o worker via leases atômicas estritas
      const message = campaignToResume.message_text || campaignToResume.message_template || messageText;
      await executeBroadcastCampaign({
        campaignId: campaignToResume.id,
        tenantSlug,
        messageText: message,
        defaultChannel: campaignToResume.channel_type || defaultChannel,
        sendCommand: sendN8nCommand,
        operations: broadcastOps,
        abortSignal: abortController?.signal,
        delayMs: 1200,
        onProgress: ({ message: stepMessage }) => {
          setStatus(stepMessage || 'Aguardando próximo envio...', 'progress');
        },
      });

      const finalRecipients = await broadcastOps.getBroadcastCampaignRecipients(campaignToResume.id);
      const counters = calculateCampaignCounters(finalRecipients);

      setStatus(`Retomada concluída: ${counters.sent} enviados, ${counters.failed} falhas${counters.unknown ? `, ${counters.unknown} incertos` : ''}.`, 'success');
      await onChanged?.();
    } catch (error) {
      setStatus(userFacingError(error, 'Falha ao retomar campanha.'), 'error');
    } finally {
      setBusy(false);
      abortControllerRef.current = null;
    }
  }

  async function cancelCampaign(campaignToCancel) {
    if (!campaignToCancel || busy) return;
    setBusy(true);
    try {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const res = await broadcastOps.cancelBroadcastCampaign(campaignToCancel.id);

      sendN8nCommand('broadcast_cancel', {
        campaign_id: campaignToCancel.id,
        tenant_slug: tenantSlug,
      }, tenantSlug).catch(() => {});

      setStatus(`Campanha "${campaignToCancel.name}" cancelada (${res.cancelled_recipients || 0} pendentes cancelados).`, 'success');
      await onChanged?.();
    } catch (error) {
      setStatus(userFacingError(error, 'Erro ao cancelar campanha.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function reconcileUnknownRecipients(campaignToReconcile, targetStatus = RECIPIENT_STATUS.FAILED) {
    if (!campaignToReconcile || busy) return;
    setBusy(true);
    try {
      const recipients = await broadcastOps.getBroadcastCampaignRecipients(campaignToReconcile.id);
      const unknownList = recipients.filter((r) => r.status === RECIPIENT_STATUS.UNKNOWN);
      for (const rec of unknownList) {
        await broadcastOps.reconcileUnknownRecipient(
          campaignToReconcile.id,
          rec.id,
          targetStatus,
          'Reconciliado manualmente pelo operador no painel'
        );
      }
      setStatus(`${unknownList.length} envio(s) incertos reconciliados como ${targetStatus === RECIPIENT_STATUS.SENT ? 'enviados' : 'falha'}.`, 'success');
      await onChanged?.();
    } catch (error) {
      setStatus(userFacingError(error, 'Falha ao reconciliar envios incertos.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function sendCampaign() {
    const text = messageText.trim();
    if (!text || !selectedContacts.length || busy) return;
    setBusy(true);
    setStatus('Salvando campanha e destinatários...', 'progress');

    let campaign = null;
    const abortController = typeof window !== 'undefined' && window.AbortController ? new window.AbortController() : null;
    abortControllerRef.current = abortController;

    try {
      const savedContacts = await upsertBroadcastContacts(tenantSlug, selectedContacts);
      const recipients = mergeBroadcastContacts(savedContacts, selectedContacts);

      campaign = await createBroadcastCampaign(tenantSlug, {
        name: campaignName.trim() || `Disparo ${new Date().toLocaleDateString('pt-BR')}`,
        message_template: text,
        messageText: text,
        channelType: defaultChannel,
        total_recipients: recipients.length,
        status: CAMPAIGN_STATUS.SENDING,
      }, recipients);

      setStatus('Campanha salva. Iniciando os envios...', 'progress');

      // Dispara sinalização ao backend/n8n se disponível
      sendN8nCommand('broadcast_start', {
        campaign_id: campaign.id,
        tenant_slug: tenantSlug,
      }, tenantSlug).catch(() => {});

      // Executa o processador durável via leases atômicas
      await executeBroadcastCampaign({
        campaignId: campaign.id,
        tenantSlug,
        messageText: text,
        defaultChannel,
        sendCommand: sendN8nCommand,
        operations: broadcastOps,
        abortSignal: abortController.signal,
        delayMs: 1200,
        onProgress: ({ phase, message: stepMessage }) => {
          if (phase === 'pacing' || phase === 'sending') {
            setStatus(stepMessage || 'Aguardando próximo envio...', 'progress');
          } else if (phase === 'item_completed') {
            setStatus('Processando destinatários...', 'progress');
          }
        },
      });

      const finalRecipients = await broadcastOps.getBroadcastCampaignRecipients(campaign.id);
      const finalCounters = calculateCampaignCounters(finalRecipients);

      setStatus(`Disparo concluído: ${finalCounters.sent} enviados, ${finalCounters.failed} falhas${finalCounters.unknown ? `, ${finalCounters.unknown} incertos` : ''}.`, 'success');
      setMessageText('');
      setCampaignName('');
      setSelected(new Set());
      await onChanged?.();
    } catch (error) {
      if (campaign?.id) {
        await broadcastOps.updateBroadcastCampaign(campaign.id, {
          status: CAMPAIGN_STATUS.PARTIAL_ERROR,
        }).catch(() => {});
      }
      setStatus(userFacingError(error, 'Falha ao executar disparo.'), 'error');
    } finally {
      setBusy(false);
      abortControllerRef.current = null;
    }
  }

  const channelLabel = CHANNEL_OPTIONS.find((option) => option.id === defaultChannel)?.label || defaultChannel;
  const messageLimit = MESSAGE_LIMIT_BY_CHANNEL[defaultChannel] || 4096;
  const messageTooLong = messageText.length > messageLimit;
  const hasChannel = allowedChannels.length > 0;
  const canSend = hasChannel && !busy && Boolean(messageText.trim()) && selectedContacts.length > 0 && !messageTooLong;
  const recoverableHasUnknown = (recoverableCampaign?.unknown_count || 0) > 0;

  return (
    <section className="bc-page">
      {recoverableCampaign && (
        <div className={`bc-recover ${recoverableHasUnknown ? 'is-warning' : ''}`} role="status">
          <span className="bc-recover-icon" aria-hidden="true">
            {recoverableHasUnknown ? <AlertTriangle size={18} /> : <Clock3 size={18} />}
          </span>
          <div className="bc-recover-body">
            <strong>
              {recoverableHasUnknown ? 'Campanha com envios incertos' : 'Campanha em andamento'}
              <span>{recoverableCampaign.name}</span>
            </strong>
            <CampaignProgress campaign={recoverableCampaign} />
            <p>
              {recoverableHasUnknown
                ? 'Envios incertos não são reenviados, para evitar mensagem duplicada.'
                : 'Quem já recebeu não recebe de novo.'}
            </p>
          </div>
          <div className="bc-recover-actions">
            {(recoverableCampaign.sent_count || 0) < (recoverableCampaign.total_recipients || 0) && (
              <button type="button" className="primary-button bc-btn" onClick={() => resumeCampaign(recoverableCampaign)} disabled={busy}>
                <Play size={14} /> Retomar envio
              </button>
            )}
            {recoverableHasUnknown && (
              <button
                type="button"
                className="secondary-button bc-btn"
                onClick={() => reconcileUnknownRecipients(recoverableCampaign, RECIPIENT_STATUS.FAILED)}
                disabled={busy}
                title="Conclui os envios incertos marcando-os como falha, sem reenviar"
              >
                <RotateCcw size={14} /> Concluir incertos
              </button>
            )}
            <button type="button" className="bc-text-btn is-danger" onClick={() => cancelCampaign(recoverableCampaign)} disabled={busy}>
              Cancelar campanha
            </button>
          </div>
        </div>
      )}

      <div className="bc-layout">
        <section className="bc-card bc-audience" aria-labelledby="bc-audience-title">
          <header className="bc-head">
            <h2 id="bc-audience-title">Público</h2>
            <span className="bc-count"><strong>{selectedContacts.length}</strong> de {allContacts.length} selecionado{selectedContacts.length === 1 ? '' : 's'}</span>
          </header>

          <div
            className={`bc-drop ${dragging ? 'is-dragging' : ''}`}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <input ref={fileInputRef} type="file" accept={SUPPORTED_CONTACT_FORMATS + ',.vcard,.htm,.xlsx'} hidden onChange={handleFile} />
            <span className="bc-drop-icon" aria-hidden="true"><Upload size={18} /></span>
            <div className="bc-drop-text">
              <p>Importe uma planilha de contatos</p>
              <span>Arraste o arquivo aqui · CSV, XLSX, TXT, VCF e outros · <button type="button" className="bc-link" onClick={downloadTemplate}><Download size={12} />Baixar modelo</button></span>
            </div>
            <button type="button" className="secondary-button bc-drop-btn" onClick={() => fileInputRef.current?.click()} disabled={busy}>Escolher arquivo</button>
          </div>

          <div className="bc-tools">
            <button type="button" className="bc-chip" onClick={() => setPasteOpen((value) => !value)} aria-expanded={pasteOpen}><ClipboardPaste size={14} />Colar lista</button>
            {conversations.length > 0 && <button type="button" className="bc-chip" onClick={addRecentContacts} disabled={busy}><MessagesSquare size={14} />Conversas recentes</button>}
            {stages.length > 0 && (
              <div className="bc-stage-pick">
                <select className="bc-select" value={stageFilter} onChange={(event) => { setStageFilter(event.target.value); }} aria-label="Adicionar contatos de uma etapa do quadro">
                  <option value="">Etapa do quadro</option>
                  {stages.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
                </select>
                {stageFilter && <button type="button" className="bc-chip is-accent" onClick={addStageContacts} disabled={busy}>Adicionar</button>}
              </div>
            )}
          </div>

          {pasteOpen && <div className="bc-paste">
            <textarea value={pasteText} onChange={(event) => setPasteText(event.target.value)} rows={4} aria-label="Lista de contatos colada"
              placeholder={'Um contato por linha:\n5521999990000\nMaria Silva;(21) 98888-0000'} />
            <div className="bc-paste-actions">
              <button type="button" className="bc-text-btn is-muted" onClick={() => { setPasteOpen(false); setPasteText(''); }}>Cancelar</button>
              <button type="button" className="bc-chip is-accent" onClick={importPastedText} disabled={!pasteText.trim()}>Adicionar à lista</button>
            </div>
          </div>}

          {importSummary && <div className="bc-summary" role="status">
            <CheckCircle2 size={15} aria-hidden="true" />
            <span><strong>{importSummary.imported}</strong> importado{importSummary.imported === 1 ? '' : 's'} de {importSummary.fileName}
              {importSummary.added !== importSummary.imported ? ` (${importSummary.added} novos)` : ''}
              {importSummary.duplicates ? `, ${importSummary.duplicates} repetido${importSummary.duplicates > 1 ? 's' : ''}` : ''}
              {importSummary.ignored ? `, ${importSummary.ignored} sem telefone ou de canal não habilitado` : ''}.</span>
            <button type="button" aria-label="Dispensar resumo" onClick={() => setImportSummary(null)}><X size={13} /></button>
          </div>}

          <div className="bc-list-bar">
            <label className="bc-search"><Search size={15} aria-hidden="true" /><input value={contactSearch} onChange={(event) => setContactSearch(event.target.value)} placeholder="Buscar por nome ou telefone" aria-label="Buscar contatos" /></label>
            <button type="button" className="bc-text-btn" onClick={toggleAllVisibleContacts} disabled={!visibleContacts.length}>{allVisibleSelected ? 'Desmarcar todos' : 'Selecionar todos'}</button>
            {selectedContacts.length > 0 && <button type="button" className="bc-text-btn is-muted" onClick={clearSelectedContacts}>Limpar</button>}
          </div>

          <ul className="bc-list">
            {!ready ? [1, 2, 3, 4].map((i) => <li className="bc-row" key={i}><SkeletonBlock width="16px" height="16px" style={{ borderRadius: '4px' }} /><SkeletonBlock width="30px" height="30px" style={{ borderRadius: '50%' }} /><div style={{ flex: 1 }}><SkeletonLine width="120px" /><SkeletonLine width="90px" style={{ marginTop: '4px' }} /></div></li>) : <>
              {visibleContacts.map((contact) => {
                const key = contact.key || contactKey(contact);
                const name = displayContactName(contact);
                const phone = displayContactPhone(contact);
                const channel = contact.channel_type || contact.channelType || defaultChannel;
                const isOn = selected.has(key);
                return <li key={key}><label className={`bc-row ${isOn ? 'is-selected' : ''}`}>
                  <input type="checkbox" checked={isOn} onChange={() => toggleContact(key)} />
                  <ContactAvatar name={name} avatarUrl={contact.avatarUrl} className="bc-avatar" />
                  <span className="bc-row-text"><strong>{name}</strong><small>{phone}</small></span>
                  <span className={`bc-channel-badge bc-tone-${channelTone(channel)}`} title={channel}><ChannelIcon channel={channel} size={15} /></span>
                </label></li>;
              })}
              {!visibleContacts.length && <li className="bc-empty">
                <span className="bc-empty-icon" aria-hidden="true"><UsersRound size={20} /></span>
                <strong>{allContacts.length ? 'Nenhum contato encontrado' : 'Nenhum contato ainda'}</strong>
                <span>{allContacts.length ? 'Ajuste a busca para ver outros contatos.' : 'Importe um arquivo, cole uma lista ou traga as conversas recentes.'}</span>
              </li>}
            </>}
          </ul>
        </section>

        <section className="bc-card bc-compose" aria-labelledby="bc-compose-title">
          <header className="bc-head">
            <h2 id="bc-compose-title">Mensagem</h2>
            {hasChannel && <span className={`bc-channel-tag bc-tone-${channelTone(defaultChannel)}`}><ChannelIcon channel={defaultChannel} size={14} />{channelLabel}</span>}
          </header>

          <div className={`bc-message-box ${messageTooLong ? 'is-invalid' : ''}`}>
            <textarea className="bc-message" value={messageText} onChange={(event) => setMessageText(event.target.value)} rows={6} aria-label="Mensagem do disparo" placeholder="Escreva a mensagem que todos vão receber…" />
            <div className="bc-message-foot">
              <span className={`bc-counter ${messageTooLong ? 'is-over' : ''}`}>{messageText.length.toLocaleString('pt-BR')} / {messageLimit.toLocaleString('pt-BR')}</span>
            </div>
          </div>
          {!hasChannel && <p className="bc-hint is-error">Nenhum canal de envio está habilitado para esta empresa. Ative um canal em Configurações.</p>}
          {messageTooLong && <p className="bc-hint is-error">O {channelLabel} aceita até {messageLimit.toLocaleString('pt-BR')} caracteres por mensagem.</p>}

          {messageText.trim() && (
            <figure className="bc-preview" aria-label="Prévia da mensagem">
              <figcaption>Prévia</figcaption>
              <p className="bc-bubble">{messageText}</p>
            </figure>
          )}

          <label className="bc-field">
            <span>Nome da campanha <em>opcional</em></span>
            <input value={campaignName} onChange={(event) => setCampaignName(event.target.value)} placeholder={`Disparo ${new Date().toLocaleDateString('pt-BR')}`} />
          </label>

          <button className="primary-button bc-send-btn" type="button" onClick={sendCampaign} disabled={!canSend}>
            {busy
              ? <><Loader2 size={16} className="bc-spin" /> Enviando…</>
              : <><Send size={16} /> {selectedContacts.length ? `Enviar para ${selectedContacts.length} contato${selectedContacts.length === 1 ? '' : 's'}` : 'Selecione os contatos'}</>}
          </button>
          {status.message && (
            <p className={`bc-status is-${busy && status.tone !== 'error' ? 'progress' : status.tone}`} role="status" aria-live="polite">
              {status.tone === 'error' ? <AlertTriangle size={14} aria-hidden="true" />
                : status.tone === 'success' ? <CheckCircle2 size={14} aria-hidden="true" />
                  : busy || status.tone === 'progress' ? <Loader2 size={14} className="bc-spin" aria-hidden="true" />
                    : <Info size={14} aria-hidden="true" />}
              <span>{status.message}</span>
            </p>
          )}
        </section>
      </div>

      <section className="bc-card bc-history" aria-labelledby="bc-history-title">
        <header className="bc-head">
          <h2 id="bc-history-title">Histórico</h2>
          {campaigns.length > 0 && <span className="bc-count">{campaigns.length} campanha{campaigns.length === 1 ? '' : 's'}</span>}
        </header>
        <div className="bc-campaigns">
          {campaigns.length > 0 && (
            <div className="bc-campaign bc-campaign-head" aria-hidden="true">
              <span>Campanha</span><span>Status</span><span>Data</span><span>Resultado</span>
            </div>
          )}
          {!ready ? [1, 2].map((i) => <article className="bc-campaign" key={i} style={{ pointerEvents: 'none' }}><SkeletonLine width="140px" /><SkeletonLine width="100%" style={{ marginTop: '10px' }} /></article>) : <>
            {campaigns.map((campaign) => {
              const date = campaign.sent_at || campaign.created_at;
              const metadata = date ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(date)) : 'Sem data';
              const presentation = CAMPAIGN_STATUS_PRESENTATION[campaign.status] || CAMPAIGN_STATUS_PRESENTATION.sending;
              return (
                <article className="bc-campaign" key={campaign.id}>
                  <strong className="bc-campaign-name" title={campaign.name}>{campaign.name}</strong>
                  <span className={`bc-pill is-${presentation.tone}`}>{presentation.label}</span>
                  <span className="bc-campaign-date">{metadata}</span>
                  <CampaignProgress campaign={campaign} />
                </article>
              );
            })}
            {!campaigns.length && <div className="bc-empty is-wide">
              <span className="bc-empty-icon" aria-hidden="true"><Send size={18} /></span>
              <strong>Nenhum disparo ainda</strong>
              <span>As campanhas enviadas ficam registradas aqui com o resultado de cada envio.</span>
            </div>}
          </>}
        </div>
      </section>
    </section>
  );
}

// Tom do canal para Disparos. Evita as classes globais channel-* (settings.css), que desenham badges quadrados.
function channelTone(channel) {
  return getChannelClass(channel).replace('channel-', '') || 'webchat';
}

// Limites de texto por mensagem documentados pelas APIs de cada canal.
const MESSAGE_LIMIT_BY_CHANNEL = { whatsapp: 4096, telegram: 4096, instagram: 1000 };

const CAMPAIGN_STATUS_PRESENTATION = {
  sent: { label: 'Concluída', tone: 'success' },
  partial_error: { label: 'Parcial', tone: 'warning' },
  failed: { label: 'Falhou', tone: 'danger' },
  cancelled: { label: 'Cancelada', tone: 'muted' },
  paused: { label: 'Pausada', tone: 'warning' },
  queued: { label: 'Na fila', tone: 'info' },
  sending: { label: 'Enviando', tone: 'info' },
};

function CampaignProgress({ campaign }) {
  const total = Math.max(0, Number(campaign?.total_recipients) || 0);
  const sent = Math.max(0, Number(campaign?.sent_count) || 0);
  const failed = Math.max(0, Number(campaign?.failed_count) || 0);
  const unknown = Math.max(0, Number(campaign?.unknown_count) || 0);
  const pct = (value) => (total > 0 ? `${Math.min(100, (value / total) * 100)}%` : '0%');
  return (
    <div className="bc-progress">
      <div
        className="bc-progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={sent}
        aria-label={`${sent} de ${total} enviados`}
      >
        <span className="is-sent" style={{ width: pct(sent) }} />
        <span className="is-failed" style={{ width: pct(failed) }} />
        <span className="is-unknown" style={{ width: pct(unknown) }} />
      </div>
      <div className="bc-progress-legend">
        <span><i className="is-sent" />{sent} de {total} enviados</span>
        {failed > 0 && <span><i className="is-failed" />{failed} falha{failed === 1 ? '' : 's'}</span>}
        {unknown > 0 && <span><i className="is-unknown" />{unknown} incerto{unknown === 1 ? '' : 's'}</span>}
      </div>
    </div>
  );
}

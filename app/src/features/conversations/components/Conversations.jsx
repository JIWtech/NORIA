import { userFacingError } from '../../../utils/userFacingError.js';
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  BookmarkCheck,
  Bot,
  Building2,
  Check,
  CheckCircle2,
  Clock3,
  FileText,
  Filter,
  Image as ImageIcon,
  MessageCircle,
  Mic,
  Music2,
  Paperclip,
  RefreshCcw,
  Search,
  Send,
  Smile,
  Sparkles,
  Trash2,
  User,
  UserRound,
  Video,
  X,
} from 'lucide-react';
import { CHANNEL_OPTIONS } from '../../../services/tenants/tenantAccess.js';
import { canCloseConversation, requirePersistedClosure } from '../../../services/conversations/conversationLifecycle.js';
import { sendN8nCommand } from '../../../services/integration.js';
import {
  getStageLabel,
  getStageTone,
  resolveConversationHeaderOwner,
  formatWaitingDuration,
  matchesResponsibleFilter,
  sortConversationsForTab,
  getConversationTabCounts,
  formatConversationCardOrigin,
  formatMediaPreviewWithIcon,
  isConversationClosed,
  matchesConversationTab,
} from '../../../dataService.js';
import { loadConversationFullHistory } from '../../../services/conversations/conversationHistoryReads.js';
import { mergeMediaDescriptors } from '../../../services/media/mediaNormalization.js';
import {
  ContactAvatar,
  ContactAvatarBadge,
  getInitials,
} from '../../../components/ui/ContactAvatar.jsx';
import { EmptyState } from '../../../components/ui/EmptyState.jsx';
import { SkeletonBlock, SkeletonLine } from '../../../components/ui/Skeletons.jsx';
import { ChannelIcon, getChannelClass } from '../../../components/ui/ChannelIcon.jsx';
import {
  groupTimelineMessages,
  deriveConversationPresentationState,
  formatRecordingTimer,
  EMOJI_CATEGORIES,
  applyEmojiToDraft,
  resolveMicrophoneRecordingError,
  resolveAttachmentPickerConfig,
} from '../utils/chatTimelineHelpers.js';
import {
  formatConversationPreview,
  formatFileSize,
  isMediaPlaceholderForKind,
  isTechnicalMediaPlaceholder,
  normalizeTechnicalMediaPlaceholder,
} from '../../../utils/audioUtils.js';
import {
  resolveVisualMediaCaption,
  consecutiveImageGallery,
} from '../utils/mediaPresentation.js';
import { AudioRecoveryNotice } from './AudioRecoveryNotice.jsx';
import { LocationAttachment } from './LocationAttachment.jsx';
import { MediaAttachment } from './MediaAttachment.jsx';
import { MediaMeta } from './MediaMeta.jsx';
import { TranscribedAudioCard } from './TranscribedAudioCard.jsx';
import { ConversationSidebar } from './ConversationSidebar.jsx';
import { ConversationTimeline } from './ConversationTimeline.jsx';
import { ConversationComposer } from './ConversationComposer.jsx';


export function Conversations({
  allowedChannels = CHANNEL_OPTIONS.map(c => c.id),
  conversations = [],
  tenantSlug,
  onSent,
  agentsList = [],
  agentsReady = true,
  onAssignAgent,
  initialConversationId = null,
  onInitialConversationOpened,
  onNavigateSettings = null,
  onConversationViewStateChange = null,
  onRetryAudioMedia = null,
  ready = true,
  kanbanColumns = [],
  tenantSettings = null,
}) {
  const [selectedId, setSelectedId] = useState(null);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [isDesktopViewport, setIsDesktopViewport] = useState(() => (
    typeof window === 'undefined' || window.matchMedia('(min-width: 769px)').matches
  ));
  const [isDocumentVisible, setIsDocumentVisible] = useState(() => (
    typeof document === 'undefined' || document.visibilityState === 'visible'
  ));
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef(null);

  const kanbanCardsByConversationKey = useMemo(() => {
    const map = new Map();
    if (!Array.isArray(kanbanColumns)) return map;
    for (const column of kanbanColumns) {
      for (const card of (column.cards || [])) {
        if (card.canonicalKey && !map.has(card.canonicalKey)) map.set(card.canonicalKey, card);
        if (card.normalizedExternalId && !map.has(card.normalizedExternalId)) map.set(card.normalizedExternalId, card);
        if (card.externalConversationId && !map.has(card.externalConversationId)) map.set(card.externalConversationId, card);
        if (card.id && !map.has(card.id)) map.set(card.id, card);
      }
    }
    return map;
  }, [kanbanColumns]);

  const isSearchExpanded = searchOpen || Boolean(query && query.trim() !== '');

  const handleOpenSearch = () => {
    setSearchOpen(true);
    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 50);
  };

  const handleCloseSearch = () => {
    if (query) {
      setQuery('');
    } else {
      setSearchOpen(false);
    }
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Escape') {
      if (query) {
        setQuery('');
      } else {
        setSearchOpen(false);
      }
    }
  };

  const [activeTab, setActiveTab] = useState('ativas');
  const [responsibleFilter, setResponsibleFilter] = useState('todos');
  const [stageFilter, setStageFilter] = useState('todas');
  const [channelFilter, setChannelFilter] = useState('todos');
  const [showFilterMenu, setShowFilterMenu] = useState(false);

  const [showCloseModal, setShowCloseModal] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignToast, setAssignToast] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [ending, setEnding] = useState(false);
  const [closedLocally, setClosedLocally] = useState({});
  const closeInFlight = useRef(false);
  const [sendError, setSendError] = useState('');

  const cancelCloseBtnRef = useRef(null);
  const closeActionBtnRef = useRef(null);
  const assignActionBtnRef = useRef(null);
  const assignModalCloseBtnRef = useRef(null);
  const messagesEndRef = React.useRef(null);
  const messageStreamRef = React.useRef(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 769px)');
    const syncViewport = () => setIsDesktopViewport(mediaQuery.matches);
    const syncVisibility = () => setIsDocumentVisible(document.visibilityState === 'visible');
    syncViewport();
    syncVisibility();
    mediaQuery.addEventListener?.('change', syncViewport);
    document.addEventListener('visibilitychange', syncVisibility);
    return () => {
      mediaQuery.removeEventListener?.('change', syncViewport);
      document.removeEventListener('visibilitychange', syncVisibility);
    };
  }, []);

  useEffect(() => {
    if (showCloseModal) {
      setTimeout(() => {
        cancelCloseBtnRef.current?.focus();
      }, 50);
    }
  }, [showCloseModal]);

  useEffect(() => {
    if (showAssignModal) {
      setTimeout(() => {
        assignModalCloseBtnRef.current?.focus();
      }, 50);
    }
  }, [showAssignModal]);

  function handleOpenCloseModal() {
    if (!canEndSelected || closeInFlight.current) return;
    setSendError('');
    setShowCloseModal(true);
  }

  function handleCancelCloseModal() {
    if (ending) return;
    setShowCloseModal(false);
    setSendError('');
    setTimeout(() => {
      closeActionBtnRef.current?.focus();
    }, 40);
  }

  function handleCloseAssignModal() {
    setShowAssignModal(false);
    setTimeout(() => {
      assignActionBtnRef.current?.focus();
    }, 40);
  }

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        if (showCloseModal) {
          e.stopPropagation();
          if (!ending) {

            handleCancelCloseModal();
          }
          return;
        }
        if (showAssignModal) {
          e.stopPropagation();
          handleCloseAssignModal();
          return;
        }
        if (showFilterMenu) {
          e.stopPropagation();
          setShowFilterMenu(false);
          return;
        }
        if (isSearchExpanded) {
          e.stopPropagation();
          handleCloseSearch();
          return;
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [showCloseModal, showAssignModal, showFilterMenu, isSearchExpanded, ending]);

  const lastSelectedIdRef = useRef(null);
  const initialHistoryScrolledRef = useRef(new Set());
  const [isScrolledUp, setIsScrolledUp] = useState(false);

  const scrollToLatest = useCallback((force = false) => {
    const stream = messageStreamRef.current;
    if (!stream) return;
    const isNearBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 120;
    if (force || isNearBottom) {
      stream.scrollTop = stream.scrollHeight;
      setIsScrolledUp(false);
    }
  }, []);


  const channelCounts = useMemo(() => {
    const counts = { todos: conversations.length, telegram: 0, whatsapp: 0, instagram: 0 };
    for (const c of conversations) {
      const type = String(c.channelType || c.channel || '').toLowerCase();
      if (type.includes('telegram')) counts.telegram++;
      else if (type.includes('whats') || type.includes('zap')) counts.whatsapp++;
      else if (type.includes('insta')) counts.instagram++;
    }
    return counts;
  }, [conversations]);

  const { activeCount, unreadCount, closedCount, followUpCount } = useMemo(() => {
    return getConversationTabCounts(conversations);
  }, [conversations]);

  const availableStages = useMemo(() => {
    const stageSet = new Set();
    if (Array.isArray(kanbanColumns)) {
      for (const col of kanbanColumns) {
        const title = col.title || col.label;
        if (title && title !== 'Finalizado') stageSet.add(title);
      }
    }
    for (const c of conversations) {
      if (c.stage && c.stage !== 'Finalizado') stageSet.add(c.stage);
    }
    return Array.from(stageSet);
  }, [kanbanColumns, conversations]);

  const isSecondaryFilterActive = responsibleFilter !== 'todos' || stageFilter !== 'todas' || channelFilter !== 'todos';

  const filteredConversations = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const matched = conversations.filter((conversation) => {
      // 1. Filtro da Aba Principal (Ativas / Não lidas / Encerradas / Follow-up)
      if (!matchesConversationTab(conversation, activeTab)) {
        return false;
      }

      // 2. Busca textual dentro da aba selecionada

      const matchesQuery = !normalizedQuery || [
        conversation.contact,
        conversation.company,
        conversation.lastMessage,
        conversation.lastMessageSender,
        conversation.stage,
        ...(conversation.tags || []),
      ].filter(Boolean).join(' ').toLowerCase().includes(normalizedQuery);

      if (!matchesQuery) return false;

      // 3. Canal
      const channelType = String(conversation.channelType || conversation.channel || '').toLowerCase();
      const matchesChannel =
        channelFilter === 'todos' ||
        (channelFilter === 'telegram' && channelType.includes('telegram')) ||
        (channelFilter === 'whatsapp' && (channelType.includes('whats') || channelType.includes('zap'))) ||
        (channelFilter === 'instagram' && channelType.includes('insta'));

      if (!matchesChannel) return false;

      // 4. Responsável (IA / Humano / Agente específico)
      if (!matchesResponsibleFilter(conversation, responsibleFilter)) {
        return false;
      }

      // 5. Etapa
      if (stageFilter && stageFilter !== 'todas') {
        const stageLabel = getStageLabel(conversation.stage || conversation.salesStageKey, { kanbanColumns, tenantSettings, tenantSlug });
        if (conversation.stage !== stageFilter && stageLabel !== stageFilter && conversation.salesStageKey !== stageFilter) {
          return false;
        }
      }

      return true;
    });

    return sortConversationsForTab(matched, activeTab);
  }, [conversations, activeTab, responsibleFilter, stageFilter, channelFilter, query, kanbanColumns, tenantSettings, tenantSlug]);

  const selected = useMemo(() => {
    return conversations.find((conversation) => conversation.id === selectedId) || null;
  }, [conversations, selectedId]);

  useEffect(() => {
    if (!ready || !conversations.length) {
      if (selectedId && !conversations.length) setSelectedId(null);
      return;
    }
    if (!conversations.some((conversation) => conversation.id === selectedId)) {
      setSelectedId(conversations[0].id);
    }
  }, [conversations, ready, selectedId]);

  const selectedConversationIsVisible = Boolean(
    selected
    && ready
    && isDocumentVisible
    && (isDesktopViewport || mobileChatOpen),
  );

  useEffect(() => {
    onConversationViewStateChange?.({
      conversation: selected,
      visible: selectedConversationIsVisible,
    });
    return () => onConversationViewStateChange?.({ conversation: null, visible: false });
  }, [
    onConversationViewStateChange,
    selected?.id,
    selected?.messages?.length,
    selectedConversationIsVisible,
  ]);

  const matchingKanbanCard = useMemo(() => {

    if (!selected) return null;
    return kanbanCardsByConversationKey.get(selected.canonicalKey)
      || (selected.normalizedExternalId && kanbanCardsByConversationKey.get(selected.normalizedExternalId))
      || (selected.externalConversationId && kanbanCardsByConversationKey.get(selected.externalConversationId))
      || kanbanCardsByConversationKey.get(selected.id)
      || null;
  }, [selected, kanbanCardsByConversationKey]);

  const headerOwner = useMemo(
    () => resolveConversationHeaderOwner(selected, matchingKanbanCard, agentsList),
    [selected, matchingKanbanCard, agentsList],
  );
  const validOwnerAgent = headerOwner.kind === 'agent' ? headerOwner : null;
  const isAiOwner = headerOwner.kind === 'ai';

  const selectedCloseKey = JSON.stringify([tenantSlug, selected?.id]);
  const canEndSelected = canCloseConversation(selected, closedLocally[selectedCloseKey]);

  const currentStageLabel = getStageLabel(selected?.stage || selected?.salesStageKey, { kanbanColumns, tenantSettings, tenantSlug });
  const currentStageTone = getStageTone(selected?.salesStageKey || selected?.stage);
  const headerSubtitleInfo = useMemo(() => {
    return deriveConversationPresentationState(selected, {
      matchingCard: matchingKanbanCard,
      activeAgents: agentsList,
      stageLabel: currentStageLabel,
      kanbanColumns,
      tenantSlug,
      tenantSettings,
    });
  }, [selected, matchingKanbanCard, agentsList, currentStageLabel, kanbanColumns, tenantSlug, tenantSettings]);

  const [fullHistoryByChat, setFullHistoryByChat] = useState({});
  const loadedChatHistoryRef = useRef(new Set());

  useEffect(() => {
    const extId = selected?.externalConversationId;
    const historyKey = JSON.stringify([tenantSlug, extId]);
    if (!extId || !tenantSlug || loadedChatHistoryRef.current.has(historyKey)) return;

    let cancelled = false;
    async function fetchFullHistory() {
      try {
        const fullMessages = await loadConversationFullHistory(tenantSlug, extId);
        if (!cancelled && Array.isArray(fullMessages) && fullMessages.length > 0) {
          setFullHistoryByChat((prev) => ({
            ...prev,
            [historyKey]: fullMessages,
          }));
        }
        if (!cancelled) loadedChatHistoryRef.current.add(historyKey);
      } catch (err) {
        console.warn('Falha ao carregar histórico completo:', err);
      }
    }

    fetchFullHistory();
    return () => { cancelled = true; };
  }, [selected?.externalConversationId, tenantSlug]);

  const activeMessages = useMemo(() => {
    const full = selected?.externalConversationId ? fullHistoryByChat[JSON.stringify([tenantSlug, selected.externalConversationId])] : null;
    if (!full || !full.length) return selected?.messages || [];

    const selectedByKey = new Map();
    for (const m of (selected?.messages || [])) {
      const key = m.eventId || `${m.createdAt || m.at}-${m.from}-${m.text}`;
      selectedByKey.set(key, m);
    }

    const mergedFull = full.map((m) => {
      const key = m.eventId || `${m.createdAt || m.at}-${m.from}-${m.text}`;
      const fresh = selectedByKey.get(key);
      if (!fresh) return m;
      const mergedMedia = mergeMediaDescriptors(m.media, fresh.media);
      return {
        ...m,
        ...fresh,
        media: mergedMedia,
      };
    });

    const existingKeys = new Set(full.map((m) => m.eventId || `${m.createdAt || m.at}-${m.from}-${m.text}`));
    const newRealtime = (selected?.messages || []).filter(
      (m) => !existingKeys.has(m.eventId || `${m.createdAt || m.at}-${m.from}-${m.text}`)
    );
    return newRealtime.length ? [...mergedFull, ...newRealtime] : mergedFull;
  }, [tenantSlug, selected?.externalConversationId, selected?.messages, fullHistoryByChat]);

  const groupedMessages = useMemo(() => {
    return groupTimelineMessages(activeMessages, {
      selectedContact: selected?.contact || 'Cliente',
      selectedOwner: validOwnerAgent?.name || selected?.owner || 'Operador',
    });
  }, [activeMessages, selected?.contact, validOwnerAgent?.name, selected?.owner]);

  const storeLocation = useMemo(() => {
    const locations = tenantSettings?.settings?.business_facts?.locations;
    if (Array.isArray(locations) && locations.length > 0) {
      return locations[0];
    }
    return null;
  }, [tenantSettings]);

  const composerInputRef = useRef(null);

  // Composer: Estados para Anexos, Emojis e Gravação de Áudio
  const [attachment, setAttachment] = useState(null);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [activeEmojiTab, setActiveEmojiTab] = useState('frequentes');
  const [fileInputAccept, setFileInputAccept] = useState('*/*');
  const [pendingCategory, setPendingCategory] = useState('document');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);

  const fileInputRef = useRef(null);
  const attachBtnRef = useRef(null);
  const attachMenuRef = useRef(null);
  const emojiBtnRef = useRef(null);
  const emojiPickerRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioStreamRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);

  // Fecha menus flutuantes ao clicar fora
  useEffect(() => {
    if (!showEmojiPicker && !showAttachMenu) return;
    function handleClickOutside(e) {
      if (
        showEmojiPicker &&
        emojiPickerRef.current &&
        !emojiPickerRef.current.contains(e.target) &&
        !emojiBtnRef.current?.contains(e.target)
      ) {
        setShowEmojiPicker(false);
      }
      if (
        showAttachMenu &&
        attachMenuRef.current &&

        !attachMenuRef.current.contains(e.target) &&
        !attachBtnRef.current?.contains(e.target)
      ) {
        setShowAttachMenu(false);
      }
    }
    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        if (showEmojiPicker) setShowEmojiPicker(false);
        if (showAttachMenu) setShowAttachMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [showEmojiPicker, showAttachMenu]);

  // Limpa gravação ao desmontar ou trocar de conversa
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try { mediaRecorderRef.current.stop(); } catch (e) {}
      }
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  useEffect(() => {
    setShowAttachMenu(false);
    setShowEmojiPicker(false);
    if (attachment?.previewUrl) {
      URL.revokeObjectURL(attachment.previewUrl);
    }
    setAttachment(null);
    if (isRecording) {
      cancelAudioRecording();
    }
  }, [selected?.id]);

  function triggerFileInput(accept, category) {
    const config = resolveAttachmentPickerConfig(category);
    setFileInputAccept(config.accept);
    setPendingCategory(config.category);
    setShowAttachMenu(false);
    setTimeout(() => {
      fileInputRef.current?.click();
    }, 40);
  }

  function handleFileSelected(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const fileType = file.type || '';
    const category = pendingCategory || (
      fileType.startsWith('image/') ? 'image' :
      fileType.startsWith('video/') ? 'video' :
      fileType.startsWith('audio/') ? 'audio' : 'document'
    );

    const previewUrl = ['image', 'audio', 'video'].includes(category) || fileType.startsWith('image/')
      ? URL.createObjectURL(file)
      : null;

    setAttachment({
      file,
      name: file.name,
      size: file.size,
      type: fileType,

      previewUrl,
      category,
    });
    event.target.value = '';
  }

  function handleRemoveAttachment() {
    if (attachment?.previewUrl) {
      URL.revokeObjectURL(attachment.previewUrl);
    }
    setAttachment(null);
  }

  async function startAudioRecording() {
    setSendError('');
    if (!navigator?.mediaDevices?.getUserMedia) {
      setSendError('Seu navegador não possui suporte para gravação de áudio.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      const mimeType = (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.('audio/webm;codecs=opus'))
        ? 'audio/webm;codecs=opus'
        : (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.('audio/webm'))
          ? 'audio/webm'
          : '';
      const options = mimeType ? { mimeType } : undefined;
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.start(200);
      setIsRecording(true);
      setRecordingDuration(0);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration((sec) => sec + 1);
      }, 1000);
    } catch (err) {
      console.warn('Microphone access denied or error:', err);
      setSendError(resolveMicrophoneRecordingError(err));
    }
  }

  function cancelAudioRecording() {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch (e) {}
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((track) => track.stop());
    }
    setIsRecording(false);
    setRecordingDuration(0);
    audioChunksRef.current = [];
  }

  async function stopAndSaveAudioRecording() {
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    const rec = mediaRecorderRef.current;
    if (!rec || rec.state === 'inactive') {
      setIsRecording(false);
      return;
    }

    const durationSec = recordingDuration;
    rec.onstop = () => {
      if (audioStreamRef.current) {

        audioStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      const type = rec.mimeType || 'audio/webm';
      const audioBlob = new Blob(audioChunksRef.current, { type });
      const audioUrl = URL.createObjectURL(audioBlob);
      const audioFile = new File([audioBlob], `audio_${Date.now()}.${type.includes('mp4') ? 'mp4' : 'webm'}`, { type });

      setAttachment({
        file: audioFile,
        name: `Áudio gravado (${formatRecordingTimer(durationSec)})`,
        size: audioBlob.size,
        type,
        previewUrl: audioUrl,
        category: 'audio',
      });
      setIsRecording(false);
      setRecordingDuration(0);
      audioChunksRef.current = [];
    };

    try {
      rec.stop();
    } catch (e) {
      setIsRecording(false);
    }
  }

  function insertEmoji(emoji) {
    const textarea = composerInputRef.current;
    const start = textarea?.selectionStart ?? draft.length;
    const end = textarea?.selectionEnd ?? draft.length;
    const { nextDraft, nextCursor } = applyEmojiToDraft(draft, emoji, start, end);
    setDraft(nextDraft);
    setTimeout(() => {
      if (textarea) {
        textarea.focus();
        textarea.selectionStart = textarea.selectionEnd = nextCursor;
      }
    }, 10);
  }

  useEffect(() => {
    setShowCloseModal(false);
  }, [selectedCloseKey]);

  useEffect(() => {
    if (!initialConversationId) return;
    const conversation = conversations.find((item) => (
      item.id === initialConversationId
      || item.externalConversationId === initialConversationId
      || item.canonicalKey === initialConversationId
      || item.normalizedExternalId === initialConversationId
    ));
    if (!conversation) return;
    setQuery('');
    setResponsibleFilter('todos');
    setStageFilter('todas');
    setChannelFilter('todos');
    if (isConversationClosed(conversation)) {
      setActiveTab('encerradas');
    } else if (conversation.waitingForFollowUp) {
      setActiveTab('follow_up');
    } else {
      setActiveTab('ativas');
    }
    setSelectedId(conversation.id);
    setMobileChatOpen(true);
    onInitialConversationOpened?.();
  }, [conversations, initialConversationId, onInitialConversationOpened]);

  useEffect(() => {
    if (!selected?.id) return;
    const extId = selected.externalConversationId || selected.id;
    const isNewConversation = lastSelectedIdRef.current !== selected.id;
    const hasHistory = Boolean(fullHistoryByChat[extId]?.length);
    const hasScrolledHistory = initialHistoryScrolledRef.current.has(extId);

    // Deve forçar rolagem na abertura de nova conversa OU quando o histórico completo chegar
    const shouldForce = isNewConversation || (hasHistory && !hasScrolledHistory);

    lastSelectedIdRef.current = selected.id;
    if (hasHistory) {
      initialHistoryScrolledRef.current.add(extId);
    }

    scrollToLatest(shouldForce);
    const rafId = requestAnimationFrame(() => scrollToLatest(shouldForce));
    const timer = window.setTimeout(() => scrollToLatest(shouldForce), 50);

    return () => {
      cancelAnimationFrame(rafId);
      window.clearTimeout(timer);
    };
  }, [selected?.id, selected?.externalConversationId, activeMessages.length, fullHistoryByChat, scrollToLatest]);

  useEffect(() => {
    const stream = messageStreamRef.current;
    if (!stream) return undefined;
    const handleScroll = () => {
      const distanceFromBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight;
      setIsScrolledUp(distanceFromBottom > 240);
    };
    stream.addEventListener('scroll', handleScroll, { passive: true });
    return () => stream.removeEventListener('scroll', handleScroll);
  }, [selected?.id]);


  async function sendManualReply() {
    const text = draft.trim();
    if (!selected || (!text && !attachment) || sending) return;

    if (attachment) {
      setSendError('O envio de anexos ainda não está disponível por aqui. Envie o arquivo pelo WhatsApp da empresa.');
      return;
    }

    setSending(true);
    setSendError('');
    const activeOperator = validOwnerAgent?.name || (agentsList?.length === 1 ? agentsList[0]?.name : null) || 'Operador NORIA';
    try {
      const payload = {
        channel_type: selected.channelType || selected.channel.toLowerCase(),
        external_conversation_id: selected.externalConversationId || selected.id.replace(/^conv-/, ''),
        contact_name: selected.contact,
        message_text: text,
        sent_by_user: activeOperator,
      };

      await sendN8nCommand('manual_reply', payload, tenantSlug);
      setDraft('');
      handleRemoveAttachment();
      if (composerInputRef.current) {
        composerInputRef.current.style.height = 'auto';
      }
      await onSent?.({ showLoading: false });
    } catch (error) {
      setSendError(userFacingError(error, 'Não foi possível enviar a resposta.'));
    } finally {
      setSending(false);
    }
  }

  async function executeCloseConversation() {
    if (!canEndSelected || closeInFlight.current) return;

    closeInFlight.current = true;
    setEnding(true);
    setSendError('');
    const activeOperator = validOwnerAgent?.name || (agentsList?.length === 1 ? agentsList[0]?.name : null) || 'Operador NORIA';
    try {
      const result = await sendN8nCommand('close_conversation', {
        channel_type: selected.channelType || selected.channel.toLowerCase(),
        external_conversation_id: selected.externalConversationId || selected.id.replace(/^conv-/, ''),
        contact_name: selected.contact,
        message_text: 'Atendimento encerrado pela interface',
        sent_by_user: activeOperator,
        reason: 'Atendimento finalizado pelo operador',
      }, tenantSlug);
      requirePersistedClosure(result);
      setClosedLocally((current) => ({
        ...current,
        [selectedCloseKey]: {
          closedEventId: selected.closedEventId,
          lastInboundId: selected.lastInboundId,
        },
      }));
      setShowCloseModal(false);
      await onSent?.({ showLoading: false });
      setTimeout(() => {
        closeActionBtnRef.current?.focus();
      }, 0);
    } catch (error) {
      setSendError(userFacingError(error, 'Não foi possível encerrar o atendimento.'));
    } finally {
      closeInFlight.current = false;
      setEnding(false);
    }
  }

  return (
    <section className={`conversation-layout ${mobileChatOpen ? 'mobile-chat-open' : 'mobile-list-open'}`}>
      <ConversationSidebar
        activeCount={activeCount}
        activeTab={activeTab}
        agentsList={agentsList}
        allowedChannels={allowedChannels}
        availableStages={availableStages}
        channelCounts={channelCounts}
        channelFilter={channelFilter}
        closedCount={closedCount}
        filteredConversations={filteredConversations}
        followUpCount={followUpCount}
        isSecondaryFilterActive={isSecondaryFilterActive}
        kanbanColumns={kanbanColumns}
        kanbanCardsByConversationKey={kanbanCardsByConversationKey}
        onCloseSearch={handleCloseSearch}
        onOpenSearch={handleOpenSearch}
        onSearchKeyDown={handleSearchKeyDown}
        onSelectConversation={(conversationId) => {
          setSelectedId(conversationId);
          setMobileChatOpen(true);
        }}
        query={query}
        ready={ready}
        responsibleFilter={responsibleFilter}
        searchInputRef={searchInputRef}
        searchOpen={searchOpen}
        selected={selected}
        setActiveTab={setActiveTab}
        setChannelFilter={setChannelFilter}
        setQuery={setQuery}
        setResponsibleFilter={setResponsibleFilter}
        setShowFilterMenu={setShowFilterMenu}
        setStageFilter={setStageFilter}
        showFilterMenu={showFilterMenu}
        stageFilter={stageFilter}
        tenantSettings={tenantSettings}
        tenantSlug={tenantSlug}
        unreadCount={unreadCount}
      />

      <section className="chat-panel panel">
        {!ready ? (
          <div className="chat-empty-panel">
            <SkeletonBlock width="180px" height="20px" style={{ margin: '0 auto 12px', borderRadius: '4px' }} />
            <SkeletonLine width="140px" style={{ margin: '0 auto' }} />
          </div>

        ) : selected ? <>
          <div className="chat-header">
            <div className="chat-header-left">
              <button
                type="button"
                className="mobile-back-button"
                onClick={() => setMobileChatOpen(false)}
                aria-label="Voltar para conversas"
                title="Voltar"
              >
                <ArrowLeft size={18} />
              </button>
              <div className="chat-header-avatar-wrap">
                <ContactAvatar name={selected.contact} avatarUrl={selected.avatarUrl} className="chat-header-avatar" />
                <ContactAvatarBadge
                  channel={selected.channelType || selected.channel}
                  presence={selected.presence}
                />
              </div>
              <div className="chat-header-main-info">
                <div className="chat-header-name-row">
                  <strong className="chat-header-name">{selected.contact}</strong>
                  <span
                    className={`chat-header-category-chip category-${selected.contactCategory || 'customer'}`}
                    title={`Tipo de contato: ${selected.contactCategoryLabel || 'Cliente'}`}
                  >
                    {selected.contactCategory === 'commercial' && <Building2 size={12} aria-hidden="true" />}
                    {selected.contactCategory === 'saved' && <BookmarkCheck size={12} aria-hidden="true" />}
                    {(!selected.contactCategory || selected.contactCategory === 'customer') && <User size={12} aria-hidden="true" />}
                    <span>{selected.contactCategoryLabel || 'Cliente'}</span>
                  </span>
                </div>
                <div className="chat-header-sub">
                  {selected.contactCategory !== 'commercial' && currentStageLabel && (
                    <span
                      className={`chat-header-stage-chip stage-tag tone-${currentStageTone}`}
                      title={`Etapa comercial: ${currentStageLabel}`}
                    >
                      <span>{currentStageLabel}</span>
                    </span>
                  )}
                  {headerSubtitleInfo.isHuman && headerSubtitleInfo.assignee ? (
                    <span className="chat-header-status is-human" title={`Responsável: ${headerSubtitleInfo.assignee}`}>
                      <UserRound size={13} aria-hidden="true" />
                      <span>Com {headerSubtitleInfo.assignee}</span>
                    </span>
                  ) : headerSubtitleInfo.isAiActive ? (
                    <span className="chat-header-status is-ai" title="A IA está respondendo esta conversa">
                      <span className="chat-header-status-dot" aria-hidden="true" />
                      <span>Atendido pela IA</span>
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="header-actions">
              <button
                ref={assignActionBtnRef}
                className="secondary-button chat-action-btn chat-action-assign"
                type="button"
                onClick={() => setShowAssignModal(true)}
                title="Atribuir conversa a um atendente"
                aria-label="Atribuir conversa"
              >
                <UserRound size={14} />
                <span className="action-text">Atribuir</span>
              </button>
              <button
                ref={closeActionBtnRef}
                className="secondary-button text-danger chat-action-btn chat-action-close"
                type="button"
                onClick={handleOpenCloseModal}
                disabled={ending || !canEndSelected}
                title={canEndSelected ? 'Encerrar atendimento' : 'Atendimento já finalizado'}
                aria-label="Encerrar atendimento"
              >
                <CheckCircle2 size={14} />
                <span className="action-text">{ending ? 'Encerrando...' : 'Encerrar'}</span>
              </button>
            </div>
          </div>
          <ConversationTimeline
            key={JSON.stringify([tenantSlug, selected?.externalConversationId])}
            groupedMessages={groupedMessages}
            messageStreamRef={messageStreamRef}
            messagesEndRef={messagesEndRef}
            onRetryAudioMedia={onRetryAudioMedia}
            scrollToLatest={scrollToLatest}
            isScrolledUp={isScrolledUp}
            storeLocation={storeLocation}
          />
          <ConversationComposer
            activeEmojiTab={activeEmojiTab}
            attachBtnRef={attachBtnRef}
            attachMenuRef={attachMenuRef}
            attachment={attachment}
            cancelAudioRecording={cancelAudioRecording}
            composerInputRef={composerInputRef}
            draft={draft}
            emojiBtnRef={emojiBtnRef}
            emojiPickerRef={emojiPickerRef}
            fileInputAccept={fileInputAccept}
            fileInputRef={fileInputRef}
            handleFileSelected={handleFileSelected}
            handleRemoveAttachment={handleRemoveAttachment}
            headerSubtitleInfo={headerSubtitleInfo}
            insertEmoji={insertEmoji}
            isRecording={isRecording}
            recordingDuration={recordingDuration}
            sendError={sendError}
            sending={sending}
            sendManualReply={sendManualReply}
            setActiveEmojiTab={setActiveEmojiTab}
            setDraft={setDraft}
            setShowAttachMenu={setShowAttachMenu}
            setShowEmojiPicker={setShowEmojiPicker}
            showAttachMenu={showAttachMenu}
            showEmojiPicker={showEmojiPicker}
            startAudioRecording={startAudioRecording}
            stopAndSaveAudioRecording={stopAndSaveAudioRecording}
            triggerFileInput={triggerFileInput}
          />
        </> : <EmptyState title="Selecione uma conversa" text="Escolha um atendimento na lista lateral para visualizar as mensagens." />}
      </section>

      {showCloseModal && selected && (
        <div
          className="modal-backdrop"
          onClick={() => { if (!ending) handleCancelCloseModal(); }}
          role="presentation"
        >
          <div
            className="modal-panel confirm-modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="close-modal-title"
            aria-describedby="close-modal-desc"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="confirm-modal-header">
              <div className="confirm-modal-title-row">
                <div className="confirm-danger-icon" aria-hidden="true">
                  <AlertCircle size={20} />
                </div>
                <h3 id="close-modal-title" className="modal-title">Encerrar atendimento?</h3>
              </div>
              <button
                className="icon-button modal-close-btn"
                type="button"
                onClick={handleCancelCloseModal}
                disabled={ending}
                aria-label="Fechar"
                title="Fechar"
              >
                <X size={18} />
              </button>
            </div>

            <div className="confirm-modal-body">
              <p id="close-modal-desc" className="confirm-modal-desc">
                Esta conversa sairá do atendimento humano. A próxima mensagem do contato voltará a ser atendida pela IA.
              </p>

              <div className="modal-target-contact compact">
                <MessageCircle size={14} />
                <span>Atendimento: <strong>{selected.contact || 'Cliente'}</strong></span>
                {selected.channel && <span className="modal-target-channel">· {selected.channel}</span>}
              </div>

              {sendError && <div className="inline-error confirm-error">{sendError}</div>}
            </div>

            <div className="confirm-modal-footer">
              <button
                ref={cancelCloseBtnRef}
                type="button"
                className="secondary-button confirm-cancel-btn"
                onClick={handleCancelCloseModal}
                disabled={ending}

              >
                Cancelar
              </button>
              <button
                type="button"
                className="danger-button confirm-close-btn"
                onClick={executeCloseConversation}
                disabled={ending || !canEndSelected}
                aria-label="Encerrar atendimento"
                title="Encerrar atendimento"
              >
                {ending ? (
                  <>
                    <RefreshCcw size={15} className="spin" />
                    <span>Encerrando...</span>
                  </>
                ) : (
                  <span>Encerrar</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAssignModal && selected && (
        <div className="modal-backdrop" onClick={handleCloseAssignModal} role="presentation">
          <div
            className="modal-panel assign-modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="assign-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="assign-modal-header">
              <ContactAvatar name={selected.contact} avatarUrl={selected.avatarUrl} className="assign-modal-avatar" />
              <div className="assign-modal-header-main">
                <h3 id="assign-modal-title" className="assign-modal-title">Atribuir atendimento</h3>
                <span className="assign-modal-contact">{selected.contact || 'Cliente'}</span>
                <span className="assign-modal-hint">Escolha quem assume esta conversa</span>
              </div>
              <button
                ref={assignModalCloseBtnRef}
                className="icon-button assign-modal-close-btn"
                type="button"
                onClick={handleCloseAssignModal}
                aria-label="Fechar"
                title="Fechar"
              >
                <X size={16} />
              </button>
            </div>

            <div className="assign-modal-body">
              {!agentsReady ? (
                <div className="assign-skeleton-list">
                  {[1, 2].map((i) => (
                    <div className="assign-skeleton-row" key={i}>
                      <SkeletonBlock width="32px" height="32px" style={{ borderRadius: '50%' }} />
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <SkeletonLine width="110px" height="12px" />
                        <SkeletonLine width="70px" height="10px" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : agentsList.length > 0 ? (
                <div className="assign-agent-list">
                  {agentsList.map((agent) => {
                    const isCurrent = (validOwnerAgent && String(validOwnerAgent.id) === String(agent.id))
                      || (validOwnerAgent && validOwnerAgent.name === agent.name)
                      || selected.owner === agent.name;
                    return (
                      <div
                        key={agent.id}
                        className={`assign-agent-row ${isCurrent ? 'is-current' : ''}`}
                        onClick={() => {

                          if (!isCurrent) {
                            onAssignAgent?.(selected, agent);
                            handleCloseAssignModal();
                            setAssignToast(`Conversa atribuída a ${agent.name}`);
                            setTimeout(() => setAssignToast(''), 3000);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            if (!isCurrent) {
                              onAssignAgent?.(selected, agent);
                              handleCloseAssignModal();
                              setAssignToast(`Conversa atribuída a ${agent.name}`);
                              setTimeout(() => setAssignToast(''), 3000);
                            }
                          }
                        }}
                      >
                        <div className="assign-agent-avatar">
                          {getInitials(agent.name)}
                        </div>
                        <div className="assign-agent-meta">
                          <span className="assign-agent-name">{agent.name}</span>
                          {agent.role && <span className="assign-agent-role">{agent.role}</span>}
                        </div>
                        {isCurrent ? (
                          <span className="assign-current-badge">Atual</span>
                        ) : (
                          <span className="assign-agent-action">Atribuir</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="assign-empty-state">
                  <UserRound size={22} className="assign-empty-icon" />
                  <div className="assign-empty-texts">
                    <p className="assign-empty-title">Nenhum atendente cadastrado</p>
                    <p className="assign-empty-desc">Cadastre um atendente em Configurações para poder atribuir esta conversa.</p>
                  </div>
                  {onNavigateSettings && (
                    <button
                      type="button"
                      className="assign-empty-cta-btn"
                      onClick={() => {
                        handleCloseAssignModal();
                        onNavigateSettings();
                      }}
                    >
                      Ir para Configurações
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {assignToast && (
        <div className="toast-notification">
          <CheckCircle2 size={18} color="#10b981" />
          <span>{assignToast}</span>
        </div>
      )}
    </section>
  );
}

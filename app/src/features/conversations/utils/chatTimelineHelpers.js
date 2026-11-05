/**
 * chatTimelineHelpers.js
 * Utilitários e helpers para o painel principal de conversa da NORIA (Fase 2 do Redesign)
 *
 * Responsabilidades:
 * 1. Resolução e sanitização de avatares com fallback gracioso para iniciais.
 * 2. Agrupamento visual inteligente de mensagens (timeline grouping).
 * 3. Identificação e formatação elegante de eventos de sistema (central pills).
 * 4. Separadores de data dinâmicos (Hoje, Ontem, dd/mm/aaaa).
 * 5. Formatação concisa de horários de mensagens (ex: 13:51).
 * 6. Distinção de remetentes (Cliente, Assistente IA, Atendente Humano).
 * 7. Formatação semântica do subtítulo do cabeçalho da conversa (status / etapa / responsável).
 */

import {
  cleanAgentName,
  getStageLabel,
  resolveConversationHeaderOwner,
  isConversationClosed,
} from '../../../dataService.js';

/**
 * Extrai iniciais de um nome (até 2 caracteres maiúsculos).
 * @param {string} name
 * @returns {string}
 */
export function getInitials(name) {
  if (!name || typeof name !== 'string') return '';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return parts[0].slice(0, 2).toUpperCase();
}

/**
 * Valida e normaliza uma URL de avatar.
 * NUNCA aceita external_handles técnicos (ex: @lid, números de telefone puros)
 * como URLs de imagem.
 * @param {string} url
 * @returns {string|null}
 */
export function normalizeAvatarUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return null;
  if (!/^https:\/\//i.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' || !parsed.hostname) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

/**
 * Resolve o estado visual do avatar para componente ou teste.
 * @param {object} params
 * @param {string} params.name
 * @param {string} [params.avatarUrl]
 * @param {boolean} [params.failed]
 * @returns {{ hasImage: boolean, src: string|null, initials: string }}
 */
export function resolveAvatarState({ name, avatarUrl, failed = false }) {
  const validUrl = !failed ? normalizeAvatarUrl(avatarUrl) : null;
  return {
    hasImage: Boolean(validUrl),
    src: validUrl,
    initials: getInitials(name),
  };
}

/**
 * Constrói a lista combinada de classes CSS para o container do ContactAvatar,
 * garantindo que a classe estrutural 'conversation-avatar' NUNCA seja substituída,
 * e sim mesclada com classes adicionais (ex: 'chat-header-avatar', 'broadcast-contact-avatar').
 *
 * @param {string} [customClassName]
 * @param {boolean} [hasImage]
 * @returns {string}
 */
export function buildContactAvatarClasses(customClassName = '', hasImage = false) {
  const extraClasses = customClassName
    ? String(customClassName)
        .split(/\s+/)
        .filter((c) => c && c !== 'conversation-avatar')
    : [];
  return ['conversation-avatar', ...extraClasses, hasImage ? 'has-image' : '']
    .filter(Boolean)
    .join(' ');
}

/**
 * Converte data ISO ou string para rótulo de separador de data (Hoje, Ontem, dd/mm/aaaa).
 * @param {string|Date} dateInput
 * @param {Date} [referenceDate]
 * @returns {string}
 */
export function getDateSeparatorLabel(dateInput, referenceDate = new Date()) {
  if (!dateInput) return '';
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) return '';

  const ref = new Date(referenceDate);
  const targetYear = date.getFullYear();
  const targetMonth = date.getMonth();
  const targetDay = date.getDate();

  const refYear = ref.getFullYear();
  const refMonth = ref.getMonth();
  const refDay = ref.getDate();

  if (targetYear === refYear && targetMonth === refMonth && targetDay === refDay) {
    return 'Hoje';
  }

  const yesterday = new Date(ref);
  yesterday.setDate(refDay - 1);
  if (
    targetYear === yesterday.getFullYear() &&
    targetMonth === yesterday.getMonth() &&
    targetDay === yesterday.getDate()
  ) {
    return 'Ontem';
  }

  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

/**
 * Extrai a chave de dia (YYYY-MM-DD) para agrupamento e detecção de troca de dia.
 * @param {string|Date} dateInput
 * @returns {string}
 */
export function getDateDayKey(dateInput) {
  if (!dateInput) return '';
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Formata horário de mensagem para o padrão limpo "HH:mm".
 * Converte de formatos legados como "06/10, 13:51" ou strings ISO.
 * @param {string|Date} timeOrDateStr
 * @returns {string}
 */
export function formatMessageTime(timeOrDateStr) {
  if (!timeOrDateStr) return 'Agora';

  if (typeof timeOrDateStr === 'string') {
    const trimmed = timeOrDateStr.trim();
    if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
      return trimmed;
    }
    const legacyMatch = trimmed.match(/\b(\d{1,2}:\d{2})\b/);
    if (legacyMatch && trimmed.includes(',')) {
      return legacyMatch[1];
    }
  }

  try {
    const date = new Date(timeOrDateStr);
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      }).format(date);
    }
  } catch {
    // ignore
  }

  return String(timeOrDateStr);
}

const SYSTEM_SERVICES = new Set([
  'conversation_closed',
  'conversation_assigned',
  'resume_ai',
  'handoff_requested',
  'conversation_abandoned',
  'sales_stage_changed',
  'kanban_move',
  'kanban_stage_changed',
  'system',
]);

/**
 * Determina se uma mensagem da timeline é um evento de sistema operacional.
 * @param {object} message
 * @returns {boolean}
 */
export function isSystemTimelineMessage(message) {
  if (!message || typeof message !== 'object') return false;

  if (message.from === 'system' || message.sender_type === 'system') {
    return true;
  }

  if (message.service && SYSTEM_SERVICES.has(message.service)) {
    return true;
  }

  const text = (message.text || '').trim().toLowerCase();
  if (!text) return false;

  if (
    text.startsWith('atendimento encerrado') ||
    text.startsWith('atendimento finalizado') ||
    text.startsWith('conversa assumida por') ||
    text.startsWith('atendimento atribuído a') ||
    text.startsWith('atendimento atribuido a') ||
    text.startsWith('retornado para atendimento da ia') ||
    text.startsWith('ia ativada') ||
    text.startsWith('ia desativada') ||
    text.startsWith('aguardando atendimento humano') ||
    text.startsWith('conversa marcada como abandonada') ||
    text.startsWith('pagamento confirmado') ||
    text === 'follow-up enviado'
  ) {
    return true;
  }

  return false;
}

const SYSTEM_EVENT_KIND_BY_SERVICE = {
  conversation_closed: 'closed',
  conversation_assigned: 'assigned',
  resume_ai: 'ai_on',
  handoff_requested: 'handoff',
  conversation_abandoned: 'abandoned',
  sales_stage_changed: 'stage',
  kanban_move: 'stage',
  kanban_stage_changed: 'stage',
};

const SYSTEM_EVENT_TEXT_RULES = [
  { kind: 'closed', prefix: /^atendimento (?:encerrado|finalizado)/i },
  { kind: 'assigned', prefix: /^(?:conversa assumida por|atendimento atribu[íi]do(?: a| para)?)/i },
  { kind: 'ai_on', prefix: /^(?:retornado para atendimento da ia|ia ativada)/i },
  { kind: 'ai_off', prefix: /^ia desativada/i },
  { kind: 'handoff', prefix: /^aguardando atendimento humano/i },
  { kind: 'abandoned', prefix: /^conversa marcada como abandonada/i },
  { kind: 'payment', prefix: /^pagamento confirmado/i },
  { kind: 'follow_up', prefix: /^follow-up enviado/i },
  { kind: 'stage', prefix: /^(?:etapa comercial alterada|conversa movida)/i },
];

const SYSTEM_EVENT_TITLES = {
  closed: 'Atendimento encerrado',
  assigned: 'Atendimento atribuído',
  ai_on: 'IA reativada',
  ai_off: 'IA pausada',
  handoff: 'Transferência para atendimento humano',
  abandoned: 'Conversa marcada como abandonada',
  stage: 'Etapa comercial alterada',
  payment: 'Pagamento confirmado',
  follow_up: 'Follow-up enviado',
  generic: 'Atualização do atendimento',
};

const capitalizeFirst = (value) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : '');
const cleanEventRemainder = (value) => capitalizeFirst(String(value || '').replace(/^[\s:,.\-–]+/, '').trim());

/**
 * Descreve um evento de sistema para o atendente: tipo (ícone), título e o
 * detalhe que diz o que mudou. Nunca devolve só "Evento do sistema".
 * @param {object} message
 * @returns {{ kind: string, title: string, detail: string }}
 */
export function describeSystemEvent(message) {
  if (message?.systemEvent?.kind === 'review') return message.systemEvent;
  // Remove prefixos técnicos como "[Kanban]".
  const text = String(message?.text || '').replace(/^\[[^\]]+\]\s*/, '').trim();
  const service = String(message?.service || '');
  const textRule = SYSTEM_EVENT_TEXT_RULES.find((rule) => rule.prefix.test(text));
  const kind = SYSTEM_EVENT_KIND_BY_SERVICE[service] || textRule?.kind || 'generic';
  let title = SYSTEM_EVENT_TITLES[kind];
  const remainder = textRule && textRule.kind === kind ? text.replace(textRule.prefix, '') : text;
  let detail = '';

  if (kind === 'assigned') {
    const assignee = message?.sent_by
      || message?.sent_by_user
      || text.match(/assumida por (.+?)\.?$/i)?.[1]
      || text.match(/atribu[íi]do (?:a|para) (.+?)\.?$/i)?.[1];
    detail = assignee ? `Para ${assignee}` : '';
  } else if (kind === 'closed') {
    // O texto original ("... pela interface") é técnico; o marcador basta.
    detail = '';
  } else if (kind === 'stage') {
    if (/^conversa movida/i.test(text)) {
      title = 'Conversa movida';
      detail = cleanEventRemainder(text.replace(/^conversa movida/i, ''));
    } else {
      const target = text.match(/alterada para:?\s*(.+?)\.?$/i)?.[1];
      detail = target ? `Para ${target}` : cleanEventRemainder(remainder);
    }
  } else if (kind === 'generic') {
    detail = text || (service && service !== 'system' ? capitalizeFirst(service.replace(/_/g, ' ')) : '');
  } else {
    detail = cleanEventRemainder(remainder);
  }

  return { kind, title, detail };
}

// Estado já exibido no cabeçalho/Kanban: não repetir como linha fixa na conversa.
const HIDDEN_TIMELINE_EVENT_KINDS = new Set(['assigned', 'ai_on', 'ai_off', 'stage']);

export function isHiddenTimelineSystemEvent(message) {
  return isSystemTimelineMessage(message) && HIDDEN_TIMELINE_EVENT_KINDS.has(describeSystemEvent(message).kind);
}

/**
 * Formata o texto visível de um evento de sistema.
 * @param {object} message
 * @returns {string}
 */
export function formatSystemEventLabel(message) {
  if (!message) return 'Sistema';
  const text = (message.text || '').trim();
  const lower = text.toLowerCase();

  if (
    message.service === 'conversation_closed' ||
    lower.startsWith('atendimento finalizado') ||
    lower.startsWith('atendimento encerrado')
  ) {
    return 'Atendimento encerrado';
  }

  if (
    message.service === 'conversation_assigned' ||
    lower.startsWith('conversa assumida por') ||
    lower.startsWith('atendimento atribuído') ||
    lower.startsWith('atendimento atribuido')
  ) {
    const candidateAssignee =
      message.sent_by ||
      message.sent_by_user ||
      text.match(/assumida por (.+?)\.?$/i)?.[1] ||
      text.match(/atribu[íi]do a (.+?)\.?$/i)?.[1];
    return candidateAssignee
      ? `Atendimento atribuído a ${candidateAssignee}`
      : 'Atendimento atribuído';
  }

  if (
    message.service === 'resume_ai' ||
    lower.startsWith('retornado para atendimento da ia') ||
    lower.startsWith('ia ativada')
  ) {
    return 'IA ativada';
  }

  if (lower.startsWith('ia desativada')) {
    return 'IA desativada';
  }

  if (
    message.service === 'handoff_requested' ||
    lower.startsWith('aguardando atendimento humano')
  ) {
    return 'Aguardando atendimento humano';
  }

  if (
    message.service === 'conversation_abandoned' ||
    lower.startsWith('conversa marcada como abandonada')
  ) {
    return 'Conversa abandonada';
  }

  if (lower.startsWith('pagamento confirmado')) {
    return 'Pagamento confirmado';
  }

  if (lower === 'follow-up enviado') {
    return 'Follow-up enviado';
  }

  return text || 'Evento do sistema';
}

/**
 * Resolve o tipo e o rótulo de remetente para uma mensagem.
 * @param {object} params
 * @param {object} params.message
 * @param {string} [params.selectedContact]
 * @param {string} [params.selectedOwner]
 * @returns {{
 *   senderType: 'contact'|'ai'|'agent'|'system',
 *   senderLabel: string,
 *   rawAgentName?: string,
 *   isAi: boolean,
 *   isAgent: boolean,
 *   isSystem: boolean,
 *   isContact: boolean
 * }}
 */
export function resolveTimelineSender({ message, selectedContact = 'Cliente', selectedOwner = 'Operador' }) {
  if (!message) {
    return {
      senderType: 'contact',
      senderLabel: selectedContact || 'Cliente',
      isAi: false,
      isAgent: false,
      isSystem: false,
      isContact: true,
    };
  }

  if (isSystemTimelineMessage(message)) {
    return {
      senderType: 'system',
      senderLabel: 'Sistema',
      isAi: false,
      isAgent: false,
      isSystem: true,
      isContact: false,
    };
  }

  const isAi = message.from === 'ai' || message.sender_type === 'bot' || message.sender_type === 'assistant';
  const isAgent = message.from === 'agent' || ['agent', 'human', 'operator', 'atendente'].includes(message.sender_type);

  if (isAi) {
    return {
      senderType: 'ai',
      senderLabel: 'Assistente IA',
      isAi: true,
      isAgent: false,
      isSystem: false,
      isContact: false,
    };
  }

  if (isAgent) {
    const rawAgentName = message.sent_by || message.sent_by_user || selectedOwner || 'Atendente';
    const cleanName = String(rawAgentName).replace(/^(Operador|Atendente)\s*·?\s*/i, '').trim() || rawAgentName;
    return {
      senderType: 'agent',
      senderLabel: `Atendente · ${cleanName}`,
      rawAgentName: cleanName,
      isAi: false,
      isAgent: true,
      isSystem: false,
      isContact: false,
    };
  }

  return {
    senderType: 'contact',
    senderLabel: selectedContact || 'Cliente',
    isAi: false,
    isAgent: false,
    isSystem: false,
    isContact: true,
  };
}

/**
 * Agrupa mensagens consecutivas do mesmo remetente em intervalos de até 5 minutos,
 * inserindo separadores de data quando houver mudança de dia.
 *
 * @param {Array<object>} messages
 * @param {object} [options]
 * @param {string} [options.selectedContact]
 * @param {string} [options.selectedOwner]
 * @param {Date} [options.referenceDate]
 * @returns {Array<object>} Mensagens decoradas para renderização visual
 */
export function groupTimelineMessages(messages = [], options = {}) {
  const { selectedContact = 'Cliente', selectedOwner = 'Operador', referenceDate = new Date() } = options;
  if (!Array.isArray(messages)) return [];
  messages = messages.filter((message) => !isHiddenTimelineSystemEvent(message));
  if (!messages.length) return [];

  const decorated = [];
  const GROUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutos

  let prevDayKey = null;

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const isSystem = isSystemTimelineMessage(message);

    const sender = resolveTimelineSender({
      message,
      selectedContact,
      selectedOwner,
    });

    // Análise de data para separador
    const rawDate = message.createdAt || message.at;
    const currentDayKey = getDateDayKey(rawDate);
    const isNewDay = Boolean(currentDayKey && currentDayKey !== prevDayKey);
    const dateSeparatorLabel = isNewDay ? getDateSeparatorLabel(rawDate, referenceDate) : '';

    if (currentDayKey) {
      prevDayKey = currentDayKey;
    }

    const formattedTime = formatMessageTime(message.createdAt || message.at);

    decorated.push({
      ...message,
      _originalIndex: i,
      isSystem,
      systemLabel: isSystem ? formatSystemEventLabel(message) : '',
      systemEvent: isSystem ? describeSystemEvent(message) : null,
      senderType: sender.senderType,
      senderLabel: sender.senderLabel,
      rawAgentName: sender.rawAgentName,
      isAi: sender.isAi,
      isAgent: sender.isAgent,
      isContact: sender.isContact,
      showDateSeparator: isNewDay,
      dateSeparatorLabel,
      formattedTime,
      // Propriedades calculadas na segunda passada:
      isGroupStart: true,
      isGroupEnd: true,
      groupPosition: 'single', // 'single' | 'first' | 'middle' | 'last'
    });
  }

  // Segunda passada: calcular agrupamento de balões consecutivos
  for (let i = 0; i < decorated.length; i++) {
    const curr = decorated[i];

    if (curr.isSystem) {
      curr.groupPosition = 'single';
      curr.isGroupStart = true;
      curr.isGroupEnd = true;
      continue;
    }

    // Verifica se pode agrupar com a anterior
    let canGroupWithPrev = false;
    if (i > 0) {
      const prev = decorated[i - 1];
      if (!prev.isSystem && !curr.showDateSeparator) {
        const sameSender =
          curr.senderType === prev.senderType &&
          (curr.senderType !== 'agent' || curr.rawAgentName === prev.rawAgentName);

        if (sameSender) {
          const prevTime = prev.createdAt ? Date.parse(prev.createdAt) : NaN;
          const currTime = curr.createdAt ? Date.parse(curr.createdAt) : NaN;

          if (!Number.isNaN(prevTime) && !Number.isNaN(currTime)) {
            canGroupWithPrev = Math.abs(currTime - prevTime) <= GROUP_WINDOW_MS;
          } else {
            // Se não houver createdAt parseável, agrupa se o horário textual for igual
            canGroupWithPrev = curr.formattedTime === prev.formattedTime;
          }
        }
      }
    }

    // Verifica se pode agrupar com a próxima
    let canGroupWithNext = false;
    if (i < decorated.length - 1) {
      const next = decorated[i + 1];
      if (!next.isSystem && !next.showDateSeparator) {
        const sameSender =
          curr.senderType === next.senderType &&
          (curr.senderType !== 'agent' || curr.rawAgentName === next.rawAgentName);

        if (sameSender) {
          const currTime = curr.createdAt ? Date.parse(curr.createdAt) : NaN;
          const nextTime = next.createdAt ? Date.parse(next.createdAt) : NaN;

          if (!Number.isNaN(currTime) && !Number.isNaN(nextTime)) {
            canGroupWithNext = Math.abs(nextTime - currTime) <= GROUP_WINDOW_MS;
          } else {
            canGroupWithNext = curr.formattedTime === next.formattedTime;
          }
        }
      }
    }

    if (canGroupWithPrev && canGroupWithNext) {
      curr.groupPosition = 'middle';
      curr.isGroupStart = false;
      curr.isGroupEnd = false;
    } else if (canGroupWithPrev && !canGroupWithNext) {
      curr.groupPosition = 'last';
      curr.isGroupStart = false;
      curr.isGroupEnd = true;
    } else if (!canGroupWithPrev && canGroupWithNext) {
      curr.groupPosition = 'first';
      curr.isGroupStart = true;
      curr.isGroupEnd = false;
    } else {
      curr.groupPosition = 'single';
      curr.isGroupStart = true;
      curr.isGroupEnd = true;
    }
  }

  return decorated;
}

/**
 * Formata a linha de subtítulo do cabeçalho da conversa.
 * [AL] Alexandre
 *      Atendimento humano · Wesley
/**
 * Deriva de forma pura e unificada o estado de apresentação de uma conversa,
 * garantindo que card lateral e header consumam exatamente as mesmas regras
 * de ciclo de vida, responsável e etapa da sessão vigente.
 *
 * Precedência:
 * 1. Sessão encerrada (isClosed) -> 'closed' ('Atendimento encerrado')
 * 2. Follow-up ativo (waitingForFollowUp) -> 'follow_up' ('Aguardando cliente')
 * 3. Handoff / Human lock ATUAL (isHuman) -> 'human' ('Atendimento humano · [Assignee] · [Stage]')
 * 4. Sessão IA ativa (isAiActive) -> 'ai' ('IA ativa · [Stage]')
 * 5. Neutro -> 'none' ('Sem responsável')
 *
 * @param {object} conversation
 * @param {object} [options]
 * @param {object} [options.matchingCard]
 * @param {Array<object>} [options.activeAgents]
 * @param {string} [options.stageLabel]
 * @param {Array<object>} [options.kanbanColumns]
 * @param {string} [options.tenantSlug]
 * @param {object} [options.tenantSettings]
 * @param {object|null} [options.validOwnerAgent]
 * @param {boolean} [options.isAiOwner]
 * @returns {{
 *   lifecycle: 'closed'|'follow_up'|'human'|'ai'|'none',
 *   ownerMode: 'human'|'ai'|'none',
 *   assignee: string|null,
 *   assigneeId: string|null,
 *   stageKey: string|null,
 *   stageLabel: string,
 *   isClosed: boolean,
 *   isHuman: boolean,
 *   isAiActive: boolean,
 *   statusKind: 'closed'|'follow_up'|'human'|'ai'|'none',
 *   statusText: string,
 *   badgeLabel: string,
 * }}
 */
export function deriveConversationPresentationState(conversation, options = {}) {
  if (!conversation) {
    return {
      lifecycle: 'none',
      ownerMode: 'none',
      assignee: null,
      assigneeId: null,
      stageKey: null,
      stageLabel: '',
      isClosed: false,
      isHuman: false,
      isAiActive: false,
      statusKind: 'none',
      statusText: '',
      badgeLabel: 'IA',
    };
  }

  const {
    matchingCard = null,
    activeAgents = [],
    stageLabel = '',
    kanbanColumns = [],
    tenantSlug = '',
    tenantSettings = null,
  } = options;

  // 1. Sessão encerrada (lifecycle vigente)
  const isClosed = isConversationClosed(conversation)
    || conversation.status === 'finalizado'
    || conversation.stage === 'Finalizado'
    || conversation.stage === 'Finalizada'
    || conversation.service === 'conversation_closed'
    || matchingCard?.targetColumnId === 'finalizadas';

  // Resolução de etapa comercial (Buffering é estado técnico e nunca deve contaminar stage comercial)
  let rawStage = (conversation.salesStageKey || matchingCard?.salesStageKey || conversation.stage || matchingCard?.stage || '').trim();
  if (rawStage === 'Buffering') rawStage = 'Qualificação';
  let resolvedStageLabel = stageLabel || getStageLabel(rawStage, { kanbanColumns, tenantSettings, tenantSlug });
  if (!resolvedStageLabel || resolvedStageLabel === 'Buffering') {
    resolvedStageLabel = 'Qualificação';
  }

  if (isClosed) {
    const text = resolvedStageLabel && !['Finalizado', 'Finalizada'].includes(resolvedStageLabel)
      ? `Atendimento encerrado · ${resolvedStageLabel}`
      : 'Atendimento encerrado';
    return {
      lifecycle: 'closed',
      ownerMode: 'none',
      assignee: null,
      assigneeId: null,
      stageKey: conversation.salesStageKey || null,
      stageLabel: resolvedStageLabel,
      isClosed: true,
      isHuman: false,
      isAiActive: false,
      statusKind: 'closed',
      statusText: text,
      badgeLabel: 'Encerrada',
    };
  }

  // 1.1 Contato comercial / Telefone fixo / Não-cliente (IA desativada)
  const isCommercial = conversation.contactCategory === 'commercial'
    || conversation.service === 'non_customer'
    || conversation.ai_provider === 'non_customer_suppression';

  if (isCommercial) {
    return {
      lifecycle: 'commercial',
      ownerMode: 'none',
      assignee: null,
      assigneeId: null,
      stageKey: null,
      stageLabel: 'Número comercial',
      isClosed: false,
      isHuman: false,
      isAiActive: false,
      statusKind: 'commercial',
      statusText: 'Número comercial · IA desativada',
      badgeLabel: 'Comercial',
    };
  }

  // 2. Follow-up ativo na sessão
  const waitingForFollowUp = Boolean(conversation.waitingForFollowUp);
  if (waitingForFollowUp) {
    const text = resolvedStageLabel && !resolvedStageLabel.toLowerCase().includes('follow')
      ? `Aguardando cliente · ${resolvedStageLabel}`
      : 'Aguardando cliente';
    return {
      lifecycle: 'follow_up',
      ownerMode: conversation.ownerKind === 'agent' ? 'human' : 'ai',
      assignee: conversation.ownerKind === 'agent' ? conversation.owner : null,
      assigneeId: conversation.ownerId || null,
      stageKey: conversation.salesStageKey || null,
      stageLabel: resolvedStageLabel,
      isClosed: false,
      isHuman: false,
      isAiActive: false,
      statusKind: 'follow_up',
      statusText: text,
      badgeLabel: conversation.ownerKind === 'agent' ? (conversation.owner || 'Humano') : 'IA',
    };
  }

  // 3. Precedência de controle da sessão atual:
  const headerOwner = options.validOwnerAgent
    ? options.validOwnerAgent
    : resolveConversationHeaderOwner(conversation, matchingCard, activeAgents);

  const isHuman = (headerOwner?.kind === 'agent' || Boolean(options.validOwnerAgent))
    || conversation.status === 'atendimento_humano'
    || (Boolean(conversation.handoff) && conversation.status !== 'ia_ativa');

  if (isHuman) {
    const rawAgentName = headerOwner?.name || conversation.owner || '';
    const cleanName = cleanAgentName(rawAgentName);
    const text = cleanName
      ? (resolvedStageLabel &&
        resolvedStageLabel !== 'Atendimento humano' &&
        resolvedStageLabel !== cleanName &&
        !resolvedStageLabel.toLowerCase().includes('humano')
          ? `Atendimento humano · ${cleanName} · ${resolvedStageLabel}`
          : `Atendimento humano · ${cleanName}`)
      : (resolvedStageLabel &&
        resolvedStageLabel !== 'Atendimento humano' &&
        !resolvedStageLabel.toLowerCase().includes('humano')
          ? `Atendimento humano · ${resolvedStageLabel}`
          : 'Atendimento humano');
    return {
      lifecycle: 'human',
      ownerMode: 'human',
      assignee: cleanName || null,
      assigneeId: headerOwner?.id || conversation.ownerId || null,
      stageKey: conversation.salesStageKey || null,
      stageLabel: resolvedStageLabel,
      isClosed: false,
      isHuman: true,
      isAiActive: false,
      statusKind: 'human',
      statusText: text,
      badgeLabel: cleanName || 'Humano',
    };
  }

  // 4. Sessão AI ativa
  const isAiActive = options.isAiOwner ?? (
    headerOwner?.kind === 'ai'
    || conversation.status === 'ia_ativa'
    || (!conversation.owner || conversation.owner === 'Assistente IA')
  );

  if (isAiActive) {
    const text = resolvedStageLabel &&
      resolvedStageLabel !== 'IA ativa' &&
      resolvedStageLabel !== 'Assistente IA' &&
      !resolvedStageLabel.toLowerCase().includes('ia')
        ? `IA ativa · ${resolvedStageLabel}`
        : 'IA ativa';
    return {
      lifecycle: 'ai',
      ownerMode: 'ai',
      assignee: null,
      assigneeId: null,
      stageKey: conversation.salesStageKey || null,
      stageLabel: resolvedStageLabel,
      isClosed: false,
      isHuman: false,
      isAiActive: true,
      statusKind: 'ai',
      statusText: text,
      badgeLabel: 'IA',
    };
  }

  // 5. Neutro / Sem responsável
  const text = resolvedStageLabel ? `Sem responsável · ${resolvedStageLabel}` : 'Sem responsável';
  return {
    lifecycle: 'none',
    ownerMode: 'none',
    assignee: null,
    assigneeId: null,
    stageKey: conversation.salesStageKey || null,
    stageLabel: resolvedStageLabel,
    isClosed: false,
    isHuman: false,
    isAiActive: false,
    statusKind: 'none',
    statusText: text,
    badgeLabel: 'IA',
  };
}

/**
 * Formata semanticamente o subtítulo do cabeçalho da conversa.
 * Consome a lógica centralizada de deriveConversationPresentationState.
 *
 * @param {object} params
 * @param {object} params.conversation
 * @param {object|null} [params.validOwnerAgent]
 * @param {boolean} [params.isAiOwner]
 * @param {string} [params.stageLabel]
 * @returns {{ statusText: string, statusKind: 'human'|'ai'|'follow_up'|'closed'|'none' }}
 */
export function formatChatHeaderSubtitle({ conversation, validOwnerAgent, isAiOwner, stageLabel = '' }) {
  const presentation = deriveConversationPresentationState(conversation, {
    validOwnerAgent,
    isAiOwner,
    stageLabel,
  });
  return {
    statusText: presentation.statusText,
    statusKind: presentation.statusKind,
  };
}

/**
 * Formata duração em segundos para mm:ss (ex: 65 -> "01:05")
 * @param {number} seconds
 * @returns {string}
 */
export function formatRecordingTimer(seconds = 0) {
  const safeSec = Math.max(0, Math.floor(Number(seconds) || 0));
  const mins = Math.floor(safeSec / 60);
  const secs = safeSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Formata tamanho de arquivo em bytes para formato legível (KB, MB)
 * @param {number} bytes
 * @returns {string}
 */
export function formatFileSize(bytes = 0) {
  const safeBytes = Math.max(0, Number(bytes) || 0);
  if (safeBytes === 0) return '0 B';
  if (safeBytes < 1024) return `${safeBytes} B`;
  if (safeBytes < 1024 * 1024) return `${(safeBytes / 1024).toFixed(1)} KB`;
  return `${(safeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Categorias selecionadas de emojis para o picker rápido do chat
 */
export const EMOJI_CATEGORIES = [
  {
    id: 'frequentes',
    label: 'Mais usados',
    emojis: ['👍', '👋', '🙏', '😊', '✅', '🔥', '❤️', '👏', '🤝', '😄', '🙌', '⭐', '🎉', '😉', '👌'],
  },
  {
    id: 'expressoes',
    label: 'Expressões',
    emojis: ['😀', '😃', '😄', '😁', '😅', '😂', '🤣', '🙂', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😋', '😜', '😎', '🤔', '🤫', '🤗', '🥳'],
  },
  {
    id: 'gestos',
    label: 'Gestos',
    emojis: ['👍', '👎', '👌', '✌️', '🤞', '🤝', '👏', '🙌', '👐', '🙏', '💪', '👋', '✍️', '🗣️', '👤', '👥'],
  },
  {
    id: 'negocios',
    label: 'Negócios',
    emojis: ['✅', '❌', '⏳', '⏰', '📅', '📞', '💬', '📍', '🚗', '💼', '📊', '📋', '📝', '💡', '🔔', '🚀', '💰', '⭐', '🔥', '💯'],
  },
];

/**
 * Insere emoji na posição de cursor do draft preservando o resto do texto
 * @param {string} currentDraft
 * @param {string} emoji
 * @param {number|null} selectionStart
 * @param {number|null} selectionEnd
 * @returns {{ nextDraft: string, nextCursor: number }}
 */
export function applyEmojiToDraft(currentDraft = '', emoji = '', selectionStart = null, selectionEnd = null) {
  const text = String(currentDraft || '');
  const insert = String(emoji || '');
  if (!insert) return { nextDraft: text, nextCursor: text.length };
  const start = (selectionStart !== null && Number.isInteger(selectionStart)) ? Math.max(0, Math.min(selectionStart, text.length)) : text.length;
  const end = (selectionEnd !== null && Number.isInteger(selectionEnd)) ? Math.max(start, Math.min(selectionEnd, text.length)) : start;
  const nextDraft = text.slice(0, start) + insert + text.slice(end);
  const nextCursor = start + insert.length;
  return { nextDraft, nextCursor };
}

/**
 * Trata erros de acesso ao microfone de forma amigável e controlada
 * @param {Error|object} err
 * @returns {string}
 */
export function resolveMicrophoneRecordingError(err) {
  if (!err) return 'Erro ao acessar o microfone.';
  const name = err.name || '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Permissão para microfone não concedida pelo navegador.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'Nenhum dispositivo de microfone foi encontrado.';
  }
  return 'Permissão para microfone não concedida ou dispositivo indisponível.';
}

/**
 * Resolve o estado visual de áudio para exibição compacta
 * @param {object} media
 * @param {object|null} audioTranscription
 * @returns {{ type: 'transcribed_compact'|'playable'|'resolving'|'unavailable_compact', badge?: string, text?: string, url?: string }}
 */
export function resolveAudioNoticeState(media = {}, audioTranscription = null) {
  const transText = (audioTranscription?.text || media?.transcription?.text || media?.transcript || '').trim();
  if (transText) {
    return {
      type: 'transcribed_compact',
      badge: 'Áudio transcrito',
      text: transText,
      note: 'Gravação original indisponível',
    };
  }
  if (media?.url) {
    return {
      type: 'playable',
      url: media.url,
    };
  }
  if (media?.status === 'stored' && (media?.storagePath || media?.bucket)) {
    return {
      type: 'retryable_error',
      text: 'Não foi possível carregar este áudio agora.',
    };
  }
  if (media?.status === 'pending' || media?.loadState === 'resolving') {
    return {
      type: 'resolving',
      text: 'Preparando áudio…',
    };
  }
  if (['store_failed', 'storage_error', 'persistence_error', 'verification_failed', 'download_failed'].includes(media?.status) || media?.loadState === 'retryable_error') {
    return {
      type: 'retryable_error',
      text: 'Não foi possível carregar este áudio agora.',
    };
  }
  return {
    type: 'unavailable_compact',
    badge: 'Áudio indisponível',
    text: 'Áudio indisponível',
  };
}

/**
 * Retorna as configurações de tipos aceitos pelo file picker conforme categoria
 * @param {'image'|'document'|'audio'|'all'} category
 * @returns {{ accept: string, category: string, label: string }}
 */
export function resolveAttachmentPickerConfig(category = 'all') {
  switch (category) {
    case 'image':
      return { accept: 'image/*,video/*', category: 'image', label: 'Fotos e Vídeos' };
    case 'document':
      return { accept: '.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv', category: 'document', label: 'Documentos' };
    case 'audio':
      return { accept: 'audio/*', category: 'audio', label: 'Áudios' };
    default:
      return { accept: 'image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt,.csv', category: 'all', label: 'Todos os anexos' };
  }
}

/**
 * Retorna dimensões fixas invioláveis para ContactAvatar
 * @param {{ isHeader?: boolean, isCompact?: boolean }} options
 * @returns {object}
 */
export function resolveAvatarDimensions({ isHeader = false, isCompact = false } = {}) {
  const size = isCompact ? 32 : (isHeader ? 42 : 42);
  return {
    width: `${size}px`,
    height: `${size}px`,
    minWidth: `${size}px`,
    minHeight: `${size}px`,
    maxWidth: `${size}px`,
    maxHeight: `${size}px`,
    flex: `0 0 ${size}px`,
    borderRadius: '50%',
    overflow: 'hidden',
  };
}

/**
 * Resolve o estado visual de imagem conforme matriz de mídia
 * @param {object} media
 * @returns {{ type: 'display_image'|'preparing'|'retryable_error'|'storage_error'|'unavailable', url?: string, text?: string }}
 */
export function resolveImageNoticeState(media = {}) {
  if (media?.url) {
    return { type: 'display_image', url: media.url };
  }
  if (media?.status === 'stored' && (media?.storagePath || media?.bucket)) {
    if (media?.loadState === 'retryable_error') {
      return { type: 'retryable_error', text: 'Não foi possível carregar a imagem original.' };
    }
    return { type: 'preparing', text: 'Preparando imagem…' };
  }
  if (media?.status === 'pending' || media?.loadState === 'resolving') {
    return { type: 'preparing', text: 'Preparando imagem…' };
  }
  if (['store_failed', 'storage_error', 'persistence_error'].includes(media?.status)) {
    return { type: 'storage_error', text: 'Falha no carregamento da imagem.' };
  }
  return { type: 'unavailable', text: 'Imagem indisponível.' };
}

/**
 * Garante a regra estrita de apenas UM indicador de status no header (no avatar)
 * @param {{ hasAvatarPresence?: boolean }} options
 * @returns {{ avatarDot: boolean, subtitleDot: boolean, totalDots: number }}
 */
export function resolveHeaderIndicatorPolicy({ hasAvatarPresence = true } = {}) {
  return {
    avatarDot: Boolean(hasAvatarPresence),
    subtitleDot: false,
    totalDots: hasAvatarPresence ? 1 : 0,
  };
}

/**
 * Retorna as dimensões invariáveis do conversation card e do message preview strip
 * @returns {{ cardHeight: number, previewHeight: number, previewRadius: number, previewWidthBehavior: string }}
 */
export function resolveConversationCardDimensions() {
  return {
    cardHeight: 72,
    previewHeight: 22,
    previewRadius: 6,
    previewWidthBehavior: 'fit-content',
  };
}

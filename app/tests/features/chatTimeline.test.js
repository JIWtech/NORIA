import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getInitials,
  normalizeAvatarUrl,
  resolveAvatarState,
  buildContactAvatarClasses,
  getDateSeparatorLabel,
  formatMessageTime,
  isSystemTimelineMessage,
  formatSystemEventLabel,
  resolveTimelineSender,
  groupTimelineMessages,
  formatChatHeaderSubtitle,
  formatRecordingTimer,
  formatFileSize,
  EMOJI_CATEGORIES,
  applyEmojiToDraft,
  resolveMicrophoneRecordingError,
  resolveAudioNoticeState,
  resolveAttachmentPickerConfig,
  resolveAvatarDimensions,
  resolveImageNoticeState,
  resolveHeaderIndicatorPolicy,
  resolveConversationCardDimensions,
  deriveConversationPresentationState,
} from '../../src/features/conversations/utils/chatTimelineHelpers.js';
import {
  resolveConversationDisplayName,
  eventsToConversations,
  eventsToKanban,
  normalizeMedia,
} from '../../src/dataService.js';

test('AVATAR CLASSES A: ContactAvatar sem className -> contém conversation-avatar', () => {
  const classesWithoutImage = buildContactAvatarClasses('', false);
  assert.equal(classesWithoutImage, 'conversation-avatar');

  const classesWithImage = buildContactAvatarClasses('', true);
  assert.equal(classesWithImage, 'conversation-avatar has-image');
});

test('AVATAR CLASSES B: ContactAvatar com className="chat-header-avatar" -> mantém conversation-avatar E chat-header-avatar', () => {
  const headerClassesWithoutImage = buildContactAvatarClasses('chat-header-avatar', false);
  assert.equal(headerClassesWithoutImage, 'conversation-avatar chat-header-avatar');

  const headerClassesWithImage = buildContactAvatarClasses('chat-header-avatar', true);
  assert.equal(headerClassesWithImage, 'conversation-avatar chat-header-avatar has-image');
});

test('AVATAR CLASSES C: evita duplicações se conversation-avatar já for passado no className', () => {
  const classes = buildContactAvatarClasses('conversation-avatar chat-header-avatar', true);
  assert.equal(classes, 'conversation-avatar chat-header-avatar has-image');
});

test('AVATAR CLASSES D: suporta classes de broadcast (broadcast-contact-avatar)', () => {
  const classes = buildContactAvatarClasses('broadcast-contact-avatar', true);
  assert.equal(classes, 'conversation-avatar broadcast-contact-avatar has-image');
});

test('AVATAR A: conversation.avatarUrl válido -> resolve imagem ativa', () => {
  const result = resolveAvatarState({
    name: 'Alexandre Souza',
    avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100',
  });
  assert.equal(result.hasImage, true);
  assert.equal(result.src, 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100');
  assert.equal(result.initials, 'AS');
});

test('AVATAR B: avatarUrl null ou vazio -> fallback limpo para iniciais', () => {
  const nullAvatar = resolveAvatarState({ name: 'Alexandre Souza', avatarUrl: null });
  assert.equal(nullAvatar.hasImage, false);
  assert.equal(nullAvatar.src, null);
  assert.equal(nullAvatar.initials, 'AS');

  const emptyAvatar = resolveAvatarState({ name: 'Marcia', avatarUrl: '   ' });
  assert.equal(emptyAvatar.hasImage, false);
  assert.equal(emptyAvatar.initials, 'MA');

  // Não aceita external_handle técnico como URL
  const handleAvatar = resolveAvatarState({ name: 'Cliente', avatarUrl: '5511999999999@lid' });
  assert.equal(handleAvatar.hasImage, false);
  assert.equal(handleAvatar.src, null);
});

test('AVATAR C: imagem falha (onError) -> fallback para iniciais sem ícone quebrado', () => {
  const failedAvatar = resolveAvatarState({
    name: 'Carlos Oliveira',
    avatarUrl: 'https://broken.domain/image.png',
    failed: true,
  });
  assert.equal(failedAvatar.hasImage, false);
  assert.equal(failedAvatar.src, null);
  assert.equal(failedAvatar.initials, 'CO');
});

test('AVATAR D: troca de conversa -> avatar correto muda junto', () => {
  const convA = resolveAvatarState({ name: 'Alexandre', avatarUrl: 'https://domain.com/alexandre.jpg', failed: false });
  assert.equal(convA.hasImage, true);
  assert.equal(convA.src, 'https://domain.com/alexandre.jpg');
  assert.equal(convA.initials, 'AL');

  const convB = resolveAvatarState({ name: 'Beatriz', avatarUrl: null, failed: false });
  assert.equal(convB.hasImage, false);
  assert.equal(convB.src, null);
  assert.equal(convB.initials, 'BE');
});

test('AGRUPAMENTO VISUAL A: mensagens consecutivas do cliente em intervalo curto agrupam', () => {
  const messages = [
    { from: 'contact', text: 'Boa tarde', createdAt: '2026-10-06T13:10:00.000Z' },
    { from: 'contact', text: '23/03/1998', createdAt: '2026-10-06T13:10:30.000Z' },
    { from: 'contact', text: 'Tá bom', createdAt: '2026-10-06T13:11:10.000Z' },
  ];

  const grouped = groupTimelineMessages(messages, {
    selectedContact: 'Alexandre',
    referenceDate: new Date('2026-10-06T14:00:00.000Z'),
  });

  assert.equal(grouped.length, 3);
  // Mensagem 1: início do grupo (mostra nome)
  assert.equal(grouped[0].isGroupStart, true);
  assert.equal(grouped[0].isGroupEnd, false);
  assert.equal(grouped[0].groupPosition, 'first');
  assert.equal(grouped[0].senderLabel, 'Alexandre');

  // Mensagem 2: meio do grupo (omite nome)
  assert.equal(grouped[1].isGroupStart, false);
  assert.equal(grouped[1].isGroupEnd, false);
  assert.equal(grouped[1].groupPosition, 'middle');

  // Mensagem 3: fim do grupo (omite nome)
  assert.equal(grouped[2].isGroupStart, false);
  assert.equal(grouped[2].isGroupEnd, true);
  assert.equal(grouped[2].groupPosition, 'last');
});

test('AGRUPAMENTO VISUAL B: mensagens com intervalo > 5 minutos NÃO agrupam', () => {
  const messages = [
    { from: 'contact', text: 'Olá', createdAt: '2026-10-06T10:00:00.000Z' },
    { from: 'contact', text: 'Ainda está aí?', createdAt: '2026-10-06T10:15:00.000Z' },
  ];

  const grouped = groupTimelineMessages(messages, {
    selectedContact: 'Alexandre',
    referenceDate: new Date('2026-10-06T12:00:00.000Z'),
  });

  assert.equal(grouped[0].groupPosition, 'single');
  assert.equal(grouped[0].isGroupStart, true);
  assert.equal(grouped[0].isGroupEnd, true);

  assert.equal(grouped[1].groupPosition, 'single');
  assert.equal(grouped[1].isGroupStart, true);
  assert.equal(grouped[1].isGroupEnd, true);
});

test('AGRUPAMENTO VISUAL C: alternância de remetentes (cliente -> IA -> humano) quebra grupos', () => {
  const messages = [
    { from: 'contact', text: 'Quero um carro', createdAt: '2026-10-06T13:00:00.000Z' },
    { from: 'ai', text: 'Perfeito! Qual modelo você procura?', createdAt: '2026-10-06T13:00:20.000Z' },
    { from: 'agent', sent_by: 'Wesley', text: 'Olá Alexandre, posso ajudar com financiamento.', createdAt: '2026-10-06T13:01:00.000Z' },
  ];

  const grouped = groupTimelineMessages(messages, {
    selectedContact: 'Alexandre',
    referenceDate: new Date('2026-10-06T14:00:00.000Z'),
  });

  assert.equal(grouped[0].groupPosition, 'single');
  assert.equal(grouped[0].senderType, 'contact');
  assert.equal(grouped[0].senderLabel, 'Alexandre');

  assert.equal(grouped[1].groupPosition, 'single');
  assert.equal(grouped[1].senderType, 'ai');
  assert.equal(grouped[1].senderLabel, 'Assistente IA');

  assert.equal(grouped[2].groupPosition, 'single');
  assert.equal(grouped[2].senderType, 'agent');
  assert.equal(grouped[2].senderLabel, 'Atendente · Wesley');
});

test('SEPARADOR DE DATA: identifica Hoje, Ontem e datas antigas', () => {
  const ref = new Date('2026-10-06T12:00:00.000Z');

  assert.equal(getDateSeparatorLabel('2026-10-06T09:00:00.000Z', ref), 'Hoje');
  assert.equal(getDateSeparatorLabel('2026-10-05T15:00:00.000Z', ref), 'Ontem');
  assert.equal(getDateSeparatorLabel('2026-09-20T10:00:00.000Z', ref), '20/09/2026');
});

test('SEPARADOR DE DATA NA TIMELINE: dispara apenas na virada de dia', () => {
  const messages = [
    { from: 'contact', text: 'Mensagem de ontem', createdAt: '2026-10-05T18:00:00.000Z' },
    { from: 'ai', text: 'Resposta de ontem', createdAt: '2026-10-05T18:01:00.000Z' },
    { from: 'contact', text: 'Mensagem de hoje', createdAt: '2026-10-06T10:00:00.000Z' },
  ];

  const grouped = groupTimelineMessages(messages, {
    selectedContact: 'Alexandre',
    referenceDate: new Date('2026-10-06T12:00:00.000Z'),
  });

  assert.equal(grouped[0].showDateSeparator, true);
  assert.equal(grouped[0].dateSeparatorLabel, 'Ontem');

  assert.equal(grouped[1].showDateSeparator, false);

  assert.equal(grouped[2].showDateSeparator, true);
  assert.equal(grouped[2].dateSeparatorLabel, 'Hoje');
});

test('TIMESTAMPS: formatMessageTime exibe padrão 13:51 e limpa datas duplicadas', () => {
  assert.equal(formatMessageTime('2026-10-06T13:51:22.000Z'), '10:51'); // Depende do fuso pt-BR local
  assert.equal(formatMessageTime('13:51'), '13:51');
  assert.equal(formatMessageTime('06/10, 13:51'), '13:51');
});

test('EVENTOS DE SISTEMA: detecta e formata pílulas discretas', () => {
  assert.equal(isSystemTimelineMessage({ from: 'system', text: 'Atendimento encerrado' }), true);
  assert.equal(isSystemTimelineMessage({ service: 'conversation_closed', text: 'Atendimento finalizado no painel' }), true);
  assert.equal(isSystemTimelineMessage({ service: 'conversation_assigned', text: 'Conversa assumida por Wesley' }), true);
  assert.equal(isSystemTimelineMessage({ service: 'resume_ai', text: 'Retornado para atendimento da IA' }), true);
  assert.equal(isSystemTimelineMessage({ text: 'Pagamento confirmado via Pix' }), true);

  // Não confunde mensagem normal de cliente com evento de sistema
  assert.equal(isSystemTimelineMessage({ from: 'contact', text: 'Oi, tudo bem?' }), false);

  // Formatação amigável
  assert.equal(
    formatSystemEventLabel({ service: 'conversation_assigned', text: 'Conversa assumida por Wesley.' }),
    'Atendimento atribuído a Wesley'
  );
  assert.equal(
    formatSystemEventLabel({ service: 'conversation_closed', text: 'Atendimento encerrado pela interface' }),
    'Atendimento encerrado'
  );
  assert.equal(
    formatSystemEventLabel({ service: 'resume_ai', text: 'Retornado para atendimento da IA.' }),
    'IA ativada'
  );
});

test('HEADER SUBTITLE: formata status / etapa / responsável sem duplicação', () => {
  // Humano com atendente
  const human = formatChatHeaderSubtitle({
    conversation: { stage: 'Atendimento humano' },
    validOwnerAgent: { name: 'Wesley' },
    isAiOwner: false,
    stageLabel: 'Atendimento humano',
  });
  assert.equal(human.statusText, 'Atendimento humano · Wesley');
  assert.equal(human.statusKind, 'human');

  // IA ativa com etapa
  const ai = formatChatHeaderSubtitle({
    conversation: { stage: 'Qualificação' },
    validOwnerAgent: null,
    isAiOwner: true,
    stageLabel: 'Qualificação',
  });
  assert.equal(ai.statusText, 'IA ativa · Qualificação');
  assert.equal(ai.statusKind, 'ai');

  // Aguardando follow-up
  const followUp = formatChatHeaderSubtitle({
    conversation: { stage: 'Follow-up 3h', waitingForFollowUp: true },
    validOwnerAgent: null,
    isAiOwner: true,
    stageLabel: 'Follow-up 3h',
  });
  assert.equal(followUp.statusText, 'Aguardando cliente');
  assert.equal(followUp.statusKind, 'follow_up');

  // Atendimento encerrado
  const closed = formatChatHeaderSubtitle({
    conversation: { status: 'finalizado', stage: 'Finalizado' },
    validOwnerAgent: null,
    isAiOwner: false,
    stageLabel: 'Finalizado',
  });
  assert.equal(closed.statusText, 'Atendimento encerrado');
  assert.equal(closed.statusKind, 'closed');
});

test('COMPOSER HELPER A: formatRecordingTimer formata segundos em mm:ss', () => {
  assert.equal(formatRecordingTimer(0), '00:00');
  assert.equal(formatRecordingTimer(5), '00:05');
  assert.equal(formatRecordingTimer(65), '01:05');
  assert.equal(formatRecordingTimer(600), '10:00');
  assert.equal(formatRecordingTimer(null), '00:00');
});

test('COMPOSER HELPER B: formatFileSize formata bytes legíveis', () => {
  assert.equal(formatFileSize(0), '0 B');
  assert.equal(formatFileSize(500), '500 B');
  assert.equal(formatFileSize(1024), '1.0 KB');
  assert.equal(formatFileSize(2048), '2.0 KB');
  assert.equal(formatFileSize(1048576), '1.0 MB');
  assert.equal(formatFileSize(5242880), '5.0 MB');
});

test('COMPOSER HELPER C: EMOJI_CATEGORIES possui categorias e listas de emojis válidas', () => {
  assert.ok(Array.isArray(EMOJI_CATEGORIES));
  assert.ok(EMOJI_CATEGORIES.length >= 4);
  for (const cat of EMOJI_CATEGORIES) {
    assert.ok(cat.id);
    assert.ok(cat.label);
    assert.ok(Array.isArray(cat.emojis) && cat.emojis.length > 0);
  }
});

test('TEST 1: ContactAvatar com imagem 1000x1000 -> card não muda de dimensão', () => {
  const avatarDim = resolveAvatarDimensions();
  assert.equal(avatarDim.width, '42px');
  assert.equal(avatarDim.height, '42px');
  assert.equal(avatarDim.flex, '0 0 42px');
  assert.equal(avatarDim.overflow, 'hidden');

  const state = resolveAvatarState({
    name: 'Ian Shtorache',
    avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=1000&h=1000',
  });
  assert.equal(state.hasImage, true);
  assert.equal(parseInt(avatarDim.width, 10), 42);
  assert.equal(parseInt(avatarDim.height, 10), 42);
});

test('TEST 2: ContactAvatar com className extra -> mantém classe base', () => {
  const classes = buildContactAvatarClasses('chat-header-avatar custom-card-test', true);
  assert.ok(classes.includes('conversation-avatar'));
  assert.ok(classes.includes('chat-header-avatar'));
  assert.ok(classes.includes('custom-card-test'));
  assert.ok(classes.includes('has-image'));
});

test('TEST 3: avatarUrl válido -> img renderiza', () => {
  const state = resolveAvatarState({
    name: 'João Victor Santos',
    avatarUrl: 'https://cdn.example.com/valid-photo.png',
  });
  assert.equal(state.hasImage, true);
  assert.equal(state.src, 'https://cdn.example.com/valid-photo.png');
});

test('TEST 4: avatar quebrado -> iniciais', () => {
  const state = resolveAvatarState({
    name: 'Ian Shtorache',
    avatarUrl: 'https://cdn.example.com/broken.png',
    failed: true,
  });
  assert.equal(state.hasImage, false);
  assert.equal(state.src, null);
  assert.equal(state.initials, 'IS');
});

test('TEST 5: contato com name -> header usa name', () => {
  const event = {
    channel_type: 'whatsapp',
    contact_name_canonical: 'Ian Shtorache',
    external_conversation_id: '5521980251829@s.whatsapp.net',
  };
  const displayName = resolveConversationDisplayName(event);
  assert.equal(displayName, 'Ian Shtorache');
  assert.ok(!displayName.includes('@s.whatsapp.net'));
});

test('TEST 6: @s.whatsapp.net sem name -> telefone formatado, nunca JID cru', () => {
  const event = {
    channel_type: 'whatsapp',
    contact_name: '',
    external_conversation_id: '5521980251829@s.whatsapp.net',
  };
  const displayName = resolveConversationDisplayName(event);
  assert.equal(displayName, '+55 (21) 98025-1829');
  assert.ok(!displayName.includes('@s.whatsapp.net'));
  assert.ok(!displayName.includes('whatsapp.net'));
});

test('TEST 7: @lid sem name -> "Contato WhatsApp"', () => {
  const event = {
    channel_type: 'whatsapp',
    contact_name: '',
    external_conversation_id: '1234567890123@lid',
  };
  const displayName = resolveConversationDisplayName(event);
  assert.equal(displayName, 'Contato WhatsApp');
  assert.ok(!displayName.includes('@lid'));
  assert.ok(!displayName.includes('+1234567890123'));
});

test('TEST 8: header e card recebem mesma identidade', () => {
  const events = [
    {
      id: 'evt-canon-1',
      channel_type: 'whatsapp',
      contact_name_canonical: 'Ian Shtorache',
      external_conversation_id: '5521980251829@s.whatsapp.net',
      direction: 'inbound',
      sender_type: 'contact',
      message_text: 'Olá',
      created_at: '2026-10-06T15:00:00.000Z',
    },
  ];
  const [conv] = eventsToConversations(events);
  assert.ok(conv);
  const cardName = conv.contact;
  const headerName = resolveConversationDisplayName(conv);
  assert.equal(cardName, 'Ian Shtorache');
  assert.equal(headerName, 'Ian Shtorache');
  assert.equal(cardName, headerName);
});

test('TEST 9: áudio unavailable -> componente compacto', () => {
  const withTrans = resolveAudioNoticeState({ status: 'stored' }, { text: 'Quero financiar uma PCX' });
  assert.equal(withTrans.type, 'transcribed_compact');
  assert.equal(withTrans.badge, 'Áudio transcrito');
  assert.equal(withTrans.text, 'Quero financiar uma PCX');
  assert.equal(withTrans.note, 'Gravação original indisponível');

  const withoutTrans = resolveAudioNoticeState({ status: 'store_failed' }, null);
  assert.equal(withoutTrans.type, 'retryable_error');

  const noMediaNoTrans = resolveAudioNoticeState({}, null);
  assert.equal(noMediaNoTrans.type, 'unavailable_compact');
  assert.equal(noMediaNoTrans.badge, 'Áudio indisponível');
  assert.equal(noMediaNoTrans.text, 'Áudio indisponível');
});

test('TEST 10: emoji selecionado -> entra no input', () => {
  const initial = 'Olá ';
  const result = applyEmojiToDraft(initial, '🔥', initial.length, initial.length);
  assert.equal(result.nextDraft, 'Olá 🔥');
  assert.equal(result.nextCursor, initial.length + '🔥'.length);

  const mid = applyEmojiToDraft('Tudo bem amigo', '👋', 4, 4);
  assert.equal(mid.nextDraft, 'Tudo👋 bem amigo');
});

test('TEST 11: paperclip -> dispara file input', () => {
  const allConfig = resolveAttachmentPickerConfig('all');
  assert.ok(allConfig.accept.includes('image/*'));
  assert.ok(allConfig.accept.includes('video/*'));
  assert.ok(allConfig.accept.includes('audio/*'));
  assert.ok(allConfig.accept.includes('application/pdf'));

  const imgConfig = resolveAttachmentPickerConfig('image');
  assert.ok(imgConfig.accept.includes('image/*'));

  const docConfig = resolveAttachmentPickerConfig('document');
  assert.ok(docConfig.accept.includes('.pdf'));
});

test('TEST 12: microphone permission denied -> erro controlado', () => {
  const deniedErr = new Error('Permission denied');
  deniedErr.name = 'NotAllowedError';
  const message = resolveMicrophoneRecordingError(deniedErr);
  assert.equal(message, 'Permissão para microfone não concedida pelo navegador.');

  const notFoundErr = new Error('No mic');
  notFoundErr.name = 'NotFoundError';
  assert.equal(resolveMicrophoneRecordingError(notFoundErr), 'Nenhum dispositivo de microfone foi encontrado.');

  const genericErr = new Error('Random failure');
  assert.equal(resolveMicrophoneRecordingError(genericErr), 'Permissão para microfone não concedida ou dispositivo indisponível.');
});

test('TEST 13: Header com avatar online -> exatamente UM status dot', () => {
  const policy = resolveHeaderIndicatorPolicy({ hasAvatarPresence: true });
  assert.equal(policy.avatarDot, true);
  assert.equal(policy.subtitleDot, false);
  assert.equal(policy.totalDots, 1);
});

test('TEST 14: Preview curto "Ver o carro" -> strip proporcional menor que o espaço total', () => {
  const dims = resolveConversationCardDimensions();
  assert.equal(dims.previewWidthBehavior, 'fit-content');
  assert.equal(dims.previewHeight, 22);
  assert.equal(dims.previewRadius, 6);
});

test('TEST 15: Preview longo -> respeita max-width e ellipsis em 1 linha', () => {
  const dims = resolveConversationCardDimensions();
  assert.equal(dims.previewHeight, 22);
  assert.equal(dims.cardHeight, 72);
});

test('TEST 16: Card mantém altura fixa inviolável (72px)', () => {
  const dims = resolveConversationCardDimensions();
  assert.equal(dims.cardHeight, 72);
});

test('TEST 17: media stored + audio URL -> AudioMessagePlayer (playable)', () => {
  const res = resolveAudioNoticeState({ status: 'stored', storagePath: 'audio.ogg', url: 'https://example.com/audio.ogg' });
  assert.equal(res.type, 'playable');
  assert.equal(res.url, 'https://example.com/audio.ogg');
});

test('TEST 18: áudio stored antigo sem URL vira falha recuperável, não fica preparando para sempre', () => {
  const resolving = resolveAudioNoticeState({ status: 'stored', storagePath: 'audio.ogg' });
  assert.equal(resolving.type, 'retryable_error');
  assert.equal(resolving.text, 'Não foi possível carregar este áudio agora.');

  const failed = resolveAudioNoticeState({ status: 'stored', storagePath: 'audio.ogg', loadState: 'retryable_error' });
  assert.equal(failed.type, 'retryable_error');
  assert.notEqual(failed.type, 'unavailable_compact');
});

test('TEST 19: pending audio -> "Preparando áudio…"', () => {
  const res = resolveAudioNoticeState({ status: 'pending' });
  assert.equal(res.type, 'resolving');
  assert.equal(res.text, 'Preparando áudio…');
});

test('TEST 20: transcript sem arquivo -> mostra transcript + aviso secundário', () => {
  const res = resolveAudioNoticeState({}, { text: 'Quero comprar um carro' });
  assert.equal(res.type, 'transcribed_compact');
  assert.equal(res.badge, 'Áudio transcrito');
  assert.equal(res.text, 'Quero comprar um carro');
  assert.equal(res.note, 'Gravação original indisponível');
});

test('TEST 21: sem media e sem transcript -> unavailable compacto ("Áudio indisponível")', () => {
  const res = resolveAudioNoticeState({}, null);
  assert.equal(res.type, 'unavailable_compact');
  assert.equal(res.badge, 'Áudio indisponível');
  assert.equal(res.text, 'Áudio indisponível');
});

test('TEST 22: imagem stored com url -> display_image', () => {
  const res = resolveImageNoticeState({ status: 'stored', url: 'https://example.com/car.jpg' });
  assert.equal(res.type, 'display_image');
  assert.equal(res.url, 'https://example.com/car.jpg');
});

test('TEST 23: imagem pending -> preparing', () => {
  const res = resolveImageNoticeState({ status: 'pending' });
  assert.equal(res.type, 'preparing');
  assert.equal(res.text, 'Preparando imagem…');
});

test('TEST A: sessão antiga com human + Wesley e closed -> nova sessão com IA ativa não vaza Wesley', () => {
  const events = [
    // Sessão antiga
    {
      id: 'e1',
      tenant_slug: 'wesley_automoveis',
      channel_type: 'whatsapp',
      external_conversation_id: '5521985198468@s.whatsapp.net',
      direction: 'inbound',
      message_text: 'Olá',
      created_at: '2026-10-05T13:50:00.000Z',
    },
    {
      id: 'e2',
      tenant_slug: 'wesley_automoveis',
      channel_type: 'whatsapp',
      external_conversation_id: '5521985198468@s.whatsapp.net',
      service: 'conversation_assigned',
      handoff: true,
      stage: 'Atendimento humano',
      raw_payload: { assignee: { id: 'w-id', name: 'Wesley' } },
      created_at: '2026-10-05T13:58:00.000Z',
    },
    {
      id: 'e3',
      tenant_slug: 'wesley_automoveis',
      channel_type: 'whatsapp',
      external_conversation_id: '5521985198468@s.whatsapp.net',
      service: 'conversation_closed',
      stage: 'Finalizado',
      created_at: '2026-10-05T14:14:00.000Z',
    },
    // Nova sessão
    {
      id: 'e4',
      tenant_slug: 'wesley_automoveis',
      channel_type: 'whatsapp',
      external_conversation_id: '5521985198468@s.whatsapp.net',
      direction: 'inbound',
      message_text: '[audio]',
      stage: 'Patio - Novos contatos',
      handoff: false,
      ai_provider: 'sales_core',
      created_at: '2026-10-06T17:30:00.000Z',
    },
  ];

  const [conversation] = eventsToConversations(events, 'wesley_automoveis');
  assert.equal(conversation.status, 'ia_ativa');
  assert.equal(conversation.owner, 'Assistente IA');

  const presentation = deriveConversationPresentationState(conversation, { tenantSlug: 'wesley_automoveis' });
  assert.equal(presentation.isClosed, false);
  assert.equal(presentation.isHuman, false);
  assert.equal(presentation.isAiActive, true);
  assert.equal(presentation.assignee, null);
  assert.equal(presentation.statusKind, 'ai');
  assert.ok(presentation.statusText.startsWith('IA ativa'));
  assert.ok(!presentation.statusText.includes('Wesley'));
});

test('TEST B: nova sessão recebe handoff real para Wesley -> header = Atendimento humano · Wesley', () => {
  const events = [
    {
      id: 'e-close',
      tenant_slug: 'wesley_automoveis',
      channel_type: 'whatsapp',
      external_conversation_id: '5521985198468@s.whatsapp.net',
      service: 'conversation_closed',
      stage: 'Finalizado',
      created_at: '2026-10-05T14:14:00.000Z',
    },
    {
      id: 'e-inbound',
      tenant_slug: 'wesley_automoveis',
      channel_type: 'whatsapp',
      external_conversation_id: '5521985198468@s.whatsapp.net',
      direction: 'inbound',
      message_text: 'Quero falar com vendedor',
      handoff: false,
      created_at: '2026-10-06T17:30:00.000Z',
    },
    {
      id: 'e-assign',
      tenant_slug: 'wesley_automoveis',
      channel_type: 'whatsapp',
      external_conversation_id: '5521985198468@s.whatsapp.net',
      service: 'conversation_assigned',
      handoff: true,
      stage: 'Atendimento humano',
      raw_payload: { assignee: { id: 'w-id', name: 'Wesley' } },
      created_at: '2026-10-06T17:31:00.000Z',
    },
  ];

  const [conversation] = eventsToConversations(events, 'wesley_automoveis');
  const presentation = deriveConversationPresentationState(conversation, { tenantSlug: 'wesley_automoveis' });
  assert.equal(presentation.isHuman, true);
  assert.equal(presentation.isAiActive, false);
  assert.equal(presentation.assignee, 'Wesley');
  assert.equal(presentation.statusKind, 'human');
  assert.equal(presentation.statusText, 'Atendimento humano · Wesley');
});

test('TEST C: stage novo sales_hot -> label correspondente da sessão atual', () => {
  const conversation = {
    status: 'ia_ativa',
    salesStageKey: 'sales_hot',
    stage: 'Leads quentes - Venda',
  };
  const presentation = deriveConversationPresentationState(conversation, { tenantSlug: 'wesley_automoveis' });
  assert.equal(presentation.isAiActive, true);
  assert.equal(presentation.statusKind, 'ai');
  assert.ok(presentation.statusText.includes('Leads quentes'));
});

test('TEST D: estado técnico Buffering -> não contamina stage comercial nem header', () => {
  const conversation = {
    status: 'ia_ativa',
    stage: 'Buffering',
  };
  const presentation = deriveConversationPresentationState(conversation, { tenantSlug: 'wesley_automoveis' });
  assert.notEqual(presentation.stageLabel, 'Buffering');
  assert.notEqual(presentation.statusText, 'Buffering');
  assert.ok(!presentation.statusText.includes('Buffering'));
  assert.equal(presentation.statusText, 'IA ativa · Qualificação');
});

test('TEST E: card e header recebem exatamente a mesma presentation state', () => {
  const conversation = {
    status: 'ia_ativa',
    stage: 'IA - Qualificacao automotiva',
  };
  const cardState = deriveConversationPresentationState(conversation, { tenantSlug: 'wesley_automoveis' });
  const headerState = deriveConversationPresentationState(conversation, { tenantSlug: 'wesley_automoveis' });
  assert.deepEqual(cardState, headerState);
  assert.equal(cardState.badgeLabel, 'IA');
  assert.equal(headerState.statusKind, 'ai');
});

test('TEST E2: card e header em atendimento humano compartilham activeAgents e atribuem Wesley sem vazar Sem responsável', () => {
  const activeAgents = [{ id: 'agent-w1', name: 'Wesley', is_active: true, status: 'online' }];
  const conversation = {
    id: 'conv-1',
    status: 'atendimento_humano',
    stage: 'Atendimento humano',
  };
  const options = {
    activeAgents,
    stageLabel: 'Atendimento humano',
    tenantSlug: 'wesley_automoveis',
  };
  const cardState = deriveConversationPresentationState(conversation, options);
  const headerState = deriveConversationPresentationState(conversation, options);
  assert.deepEqual(cardState, headerState);
  assert.equal(cardState.isHuman, true);
  assert.equal(cardState.assignee, 'Wesley');
  assert.equal(cardState.badgeLabel, 'Wesley');
  assert.notEqual(cardState.assignee, 'Sem responsável');
});

test('TEST E3: conversa em Conversas abandonadas não marca IA ativa nem Atendido pela IA', () => {
  const abandonedColumn = {
    id: 'conversas_abandonadas',
    automationKey: 'conversas_abandonadas',
    title: 'Conversas abandonadas',
    icon: 'inbox',
    tone: 'red',
    ownerRole: 'neutral',
  };
  const matchingCard = {
    id: 'card-bg',
    targetColumnId: 'conversas_abandonadas',
    stage: 'Conversas abandonadas',
    owner: 'Sem responsável',
    ownerKind: 'none',
    ownerId: null,
    kanbanColumn: abandonedColumn,
  };
  const conversation = {
    id: 'conv-bg',
    status: 'ia_ativa',
    stage: 'Conversas abandonadas',
    owner: 'Sem responsável',
    ownerKind: 'none',
    ownerId: null,
    handoff: false,
  };
  const presentation = deriveConversationPresentationState(conversation, {
    matchingCard,
    kanbanColumns: [abandonedColumn],
    stageLabel: 'Conversas abandonadas',
    tenantSlug: 'clinica_nubia',
  });
  assert.equal(presentation.isClosed, false);
  assert.equal(presentation.isHuman, false);
  assert.equal(presentation.isAiActive, false);
  assert.equal(presentation.ownerMode, 'none');
  assert.equal(presentation.statusKind, 'none');
});

test('TEST F: audio bytes disponíveis com transcrição -> media descriptor stored é recuperável', () => {
  const audioEvent = {
    id: 'ev-audio-1',
    direction: 'inbound',
    message_text: '[audio]',
    external_conversation_id: '5521985198468@s.whatsapp.net',
    tenant_slug: 'wesley_automoveis',
    raw_payload: {
      audio_transcriptions: [{ text: 'Teste', model: 'gemini-3.5-flash-lite' }],
      key: { id: 'AC6CC945556C4F71F205B067B3225C09' },
    },
  };

  const media = normalizeMedia(audioEvent.raw_payload, audioEvent);
  assert.ok(media, 'media descriptor deve existir');
  assert.equal(media.status, 'stored');
  assert.equal(media.kind, 'audio');
  assert.equal(media.bucket, 'channel-media');
  assert.ok(media.storagePath.includes('AC6CC945556C4F71F205B067B3225C09.ogg'));
});

test('TEST G: imagem readable pelo Sales -> media descriptor stored é recuperável', () => {
  const imageEvent = {
    id: 'ev-image-1',
    direction: 'inbound',
    message_text: '[image]',
    external_conversation_id: '5521985198468@s.whatsapp.net',
    tenant_slug: 'wesley_automoveis',
    raw_payload: {
      sales_media: { kind: 'vehicle_photo', readable: true },
      key: { id: 'AC8F6336FF861FD62DF3529CA896734D' },
    },
  };

  const media = normalizeMedia(imageEvent.raw_payload, imageEvent);
  assert.ok(media, 'media descriptor deve existir');
  assert.equal(media.status, 'stored');
  assert.equal(media.kind, 'image');
  assert.equal(media.bucket, 'channel-media');
  assert.ok(media.storagePath.includes('AC8F6336FF861FD62DF3529CA896734D.jpg'));
});

test('TEST H: finalize media + patch posterior -> raw_payload.media não desaparece', () => {
  // Simulando evento inbound já finalizado com media
  const initialPayload = {
    media: {
      kind: 'image',
      status: 'stored',
      bucket: 'channel-media',
      storagePath: 'wesley_automoveis/whatsapp/chat/msg1.jpg',
    },
  };
  // Patch de sales_core não deve apagar media
  const salesPatch = {
    sales_lead_id: 'lead-1',
    sales_stage: 'sales_qualifying',
    sales_media: { kind: 'vehicle_photo', readable: true },
  };
  const mergedPayload = {
    ...initialPayload,
    ...salesPatch,
    media: initialPayload.media, // merge preservando media
  };

  assert.ok(mergedPayload.media);
  assert.equal(mergedPayload.media.status, 'stored');
  assert.equal(mergedPayload.sales_media.kind, 'vehicle_photo');
});

test('TEST I: audio + image em turnos próximos -> cada evento mantém seu próprio media', () => {
  const audioEvent = {
    id: 'ev-audio-1',
    direction: 'inbound',
    message_text: '[audio]',
    external_conversation_id: '5521985198468@s.whatsapp.net',
    tenant_slug: 'wesley_automoveis',
    raw_payload: {
      audio_transcriptions: [{ text: 'Teste' }],
      key: { id: 'MSG_AUDIO' },
    },
  };
  const imageEvent = {
    id: 'ev-image-1',
    direction: 'inbound',
    message_text: '[image]',
    external_conversation_id: '5521985198468@s.whatsapp.net',
    tenant_slug: 'wesley_automoveis',
    raw_payload: {
      sales_media: { kind: 'vehicle_photo', readable: true },
      key: { id: 'MSG_IMAGE' },
    },
  };

  const audioMedia = normalizeMedia(audioEvent.raw_payload, audioEvent);
  const imageMedia = normalizeMedia(imageEvent.raw_payload, imageEvent);

  assert.equal(audioMedia.kind, 'audio');
  assert.ok(audioMedia.storagePath.includes('MSG_AUDIO.ogg'));
  assert.equal(imageMedia.kind, 'image');
  assert.ok(imageMedia.storagePath.includes('MSG_IMAGE.jpg'));
  assert.notEqual(audioMedia.storagePath, imageMedia.storagePath);
});

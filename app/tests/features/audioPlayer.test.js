import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatAudioTime,
  calculateAudioProgress,
  isTechnicalMediaPlaceholder,
  isMediaPlaceholderForKind,
  normalizeTechnicalMediaPlaceholder,
  formatConversationPreview,
  formatCoordinates,
  formatFileSize,
  formatFriendlyMimeType,
  mediaSourceChanged,
  REAL_MEDIA_KINDS,
  unavailableMediaLabel,
} from '../../src/utils/audioUtils.js';
import {
  hasStoredMediaNeedingUrl,
  enrichMediaUrls,
  enrichSingleMediaEvent,
  resolveEventMessagePreview,
  applyIncomingEventToConversations,
  clearMediaUrlCache,
  normalizeLocation,
  eventsToConversations,
  normalizeAudioTranscription,
  normalizeMedia,
} from '../../src/dataService.js';

// ============================================================================
// TEMPOS E CÁLCULOS DO PLAYER
// ============================================================================

test('formatAudioTime: formata segundos corretamente para tempos curtos e longos', () => {
  assert.equal(formatAudioTime(0), '0:00');
  assert.equal(formatAudioTime(4), '0:04'); // Cenário C
  assert.equal(formatAudioTime(8), '0:08');
  assert.equal(formatAudioTime(17), '0:17'); // Contexto áudio real
  assert.equal(formatAudioTime(25), '0:25'); // Cenário D
  assert.equal(formatAudioTime(59), '0:59');
  assert.equal(formatAudioTime(60), '1:00');
  assert.equal(formatAudioTime(63), '1:03');
  assert.equal(formatAudioTime(125), '2:05');
  assert.equal(formatAudioTime(765), '12:45');
});

test('formatAudioTime: trata valores inválidos e extremos sem quebrar (sem NaN:NaN ou Infinity)', () => {
  assert.equal(formatAudioTime(NaN), '0:00');
  assert.equal(formatAudioTime(Infinity), '0:00');
  assert.equal(formatAudioTime(-Infinity), '0:00');
  assert.equal(formatAudioTime(-10), '0:00');
  assert.equal(formatAudioTime(null), '0:00');
  assert.equal(formatAudioTime(undefined), '0:00');
  assert.equal(formatAudioTime('invalid'), '0:00');
});

test('calculateAudioProgress: calcula porcentagem precisa e com clamping [0, 100]', () => {
  assert.equal(calculateAudioProgress(0, 17), 0);
  assert.equal(calculateAudioProgress(8.5, 17), 50);
  assert.equal(calculateAudioProgress(17, 17), 100);
  assert.equal(calculateAudioProgress(20, 17), 100); // Clamped no máximo
  assert.equal(calculateAudioProgress(-5, 17), 0);   // Clamped no mínimo
  assert.equal(calculateAudioProgress(0, 0), 0);     // Sem duração não divide por zero
  assert.equal(calculateAudioProgress(10, -5), 0);
  assert.equal(calculateAudioProgress(NaN, 17), 0);
  assert.equal(calculateAudioProgress(10, Infinity), 0);
});

// ============================================================================
// TESTES OBRIGATÓRIOS DO ESCOPO (TEST 1 a TEST 13)
// ============================================================================

test('TEST 1: Evento realtime de áudio com status stored ganha URL e integra na conversa sem F5', async () => {
  const audioEvent = {
    id: 'evt-audio-rt-1',
    created_at: '2026-10-02T14:00:00.000Z',
    direction: 'inbound',
    sender_type: 'contact',
    channel_type: 'whatsapp',
    external_conversation_id: '5511999999999',
    message_text: '[audio]',
    raw_payload: {
      media: {
        status: 'stored',
        kind: 'audio',
        category: 'audio',
        bucket: 'channel-media',
        storagePath: 'tenant/audio/audio.ogg',
        mimeType: 'audio/ogg; codecs=opus',
        duration: 17,
        size: 40256,
      },
    },
  };

  assert.equal(hasStoredMediaNeedingUrl(audioEvent), true);

  const mockSupabase = {
    storage: {
      from: (bucket) => ({
        download: async (path) => ({
          data: new Blob(['fake ogg opus data'], { type: 'audio/ogg' }),
          error: null,
        }),
      }),
    },
  };

  const enriched = await enrichSingleMediaEvent(audioEvent, mockSupabase);
  assert.ok(enriched.raw_payload.media.url, 'Deve possuir URL após enrichSingleMediaEvent');
  assert.match(enriched.raw_payload.media.url, /^(blob:|data:)/);

  const initialConv = {
    id: 'conv-5511999999999',
    canonicalKey: 'whatsapp::5511999999999',
    channel: 'WhatsApp',
    channelType: 'whatsapp',
    externalConversationId: '5511999999999',
    contact: 'Cliente',
    messages: [],
  };

  const updatedConvs = applyIncomingEventToConversations([initialConv], enriched, 'tenant');
  assert.equal(updatedConvs.length, 1);
  const latestMsg = updatedConvs[0].messages[0];
  assert.ok(latestMsg.media.url, 'message.media.url deve estar preenchida na conversa');
  assert.equal(latestMsg.media.kind, 'audio');
});

test('TEST 2: Evento realtime de imagem stored também ganha URL sem F5', async () => {
  const imageEvent = {
    id: 'evt-img-rt-1',
    created_at: '2026-10-02T14:05:00.000Z',
    direction: 'inbound',
    sender_type: 'contact',
    channel_type: 'whatsapp',
    external_conversation_id: '5511888888888',
    message_text: '[image]',
    raw_payload: {
      media: {
        status: 'stored',
        kind: 'image',
        category: 'image',
        bucket: 'channel-media',
        storagePath: 'tenant/images/foto.jpg',
        mimeType: 'image/jpeg',
      },
    },
  };

  assert.equal(hasStoredMediaNeedingUrl(imageEvent), true);

  const mockSupabase = {
    storage: {
      from: (bucket) => ({
        download: async (path) => ({
          data: {
            size: 2048,
            type: 'image/jpeg',
            arrayBuffer: async () => Buffer.from('fake image binary'),
          },
          error: null,
        }),
      }),
    },
  };

  const enriched = await enrichSingleMediaEvent(imageEvent, mockSupabase);
  assert.ok(enriched.raw_payload.media.url, 'Deve possuir URL para imagem stored');
});

test('TEST 3: Evento realtime de texto não executa trabalho desnecessário de Storage', async () => {
  const textEvent = {
    id: 'evt-txt-1',
    message_text: 'Olá, gostaria de saber os horários',
    raw_payload: {},
  };

  assert.equal(hasStoredMediaNeedingUrl(textEvent), false);
  const result = await enrichSingleMediaEvent(textEvent, null);
  assert.equal(result, textEvent);
});

test('TEST 4: Placeholder [audio] vira Áudio', () => {
  assert.equal(normalizeTechnicalMediaPlaceholder('[audio]'), 'Áudio');
  assert.equal(normalizeTechnicalMediaPlaceholder('[áudio]'), 'Áudio');
  assert.equal(normalizeTechnicalMediaPlaceholder('[ptt]'), 'Áudio');
  assert.equal(normalizeTechnicalMediaPlaceholder('[audio recebido]'), 'Áudio');
  assert.equal(formatConversationPreview('[audio]'), 'Áudio');
});

test('placeholder de áudio sem media continua identificável para o aviso amigável', () => {
  assert.equal(isMediaPlaceholderForKind('[audio]', 'audio'), true);
  assert.equal(isMediaPlaceholderForKind('[PTT]', 'audio'), true);
  assert.equal(isMediaPlaceholderForKind('[audio]', 'image'), false);
  assert.equal(isMediaPlaceholderForKind('mensagem sobre [audio]', 'audio'), false);
});

test('TEST 5: Placeholder [image] vira Imagem', () => {
  assert.equal(normalizeTechnicalMediaPlaceholder('[image]'), 'Imagem');
  assert.equal(normalizeTechnicalMediaPlaceholder('[imagem]'), 'Imagem');
  assert.equal(normalizeTechnicalMediaPlaceholder('[photo]'), 'Imagem');
  assert.equal(normalizeTechnicalMediaPlaceholder('[foto]'), 'Imagem');
  assert.equal(formatConversationPreview('[image]'), 'Imagem');
});

test('TEST 6: Placeholder [sticker] vira Figurinha', () => {
  assert.equal(normalizeTechnicalMediaPlaceholder('[sticker]'), 'Figurinha');
  assert.equal(normalizeTechnicalMediaPlaceholder('[figurinha]'), 'Figurinha');
  assert.equal(formatConversationPreview('[sticker]'), 'Figurinha');
});

test('TEST 7: [secretencrypted] não aparece como preview principal', () => {
  assert.equal(normalizeTechnicalMediaPlaceholder('[secretencrypted]'), '');
  assert.equal(formatConversationPreview('[secretencrypted]'), '');

  const secretEvent = {
    id: 'e-secret',
    message_text: '[secretencrypted]',
    direction: 'inbound',
    raw_payload: {},
  };
  const preview = resolveEventMessagePreview(secretEvent);
  assert.equal(preview, null, 'resolveEventMessagePreview deve retornar null para secretencrypted');
});

test('TEST 8: reaction não substitui última mensagem normal', () => {
  assert.equal(normalizeTechnicalMediaPlaceholder('reaction'), '');
  assert.equal(normalizeTechnicalMediaPlaceholder('[reaction]'), '');

  const reactionEvent = {
    id: 'e-react',
    direction: 'inbound',
    message_text: '❤️',
    service: 'reaction',
    raw_payload: {
      messageType: 'reactionMessage',
    },
  };
  const preview = resolveEventMessagePreview(reactionEvent);
  assert.equal(preview, null, 'resolveEventMessagePreview deve retornar null para reaction');
});

test('TEST 9: media existe + text="[audio]" -> player renderiza e "[audio]" não renderiza abaixo', () => {
  const audioMedia = { kind: 'audio', url: 'https://example.com/audio.ogg' };
  assert.equal(isTechnicalMediaPlaceholder('[audio]', audioMedia), true);
  assert.equal(isTechnicalMediaPlaceholder('[áudio]', audioMedia), true);
});

test('TEST 10: media não existe + text="[audio]" -> mostra fallback "Áudio"', () => {
  // Quando media não existe, isTechnicalMediaPlaceholder é false para que o bloco trate o fallback:
  assert.equal(isTechnicalMediaPlaceholder('[audio]', null), false);
  // O displayText exibido na bolha deve ser normalizado:
  assert.equal(normalizeTechnicalMediaPlaceholder('[audio]'), 'Áudio');
  assert.equal(normalizeTechnicalMediaPlaceholder('[image]'), 'Imagem');
  assert.equal(normalizeTechnicalMediaPlaceholder('[sticker]'), 'Figurinha');
});

test('TEST 11: media caption real + text="[image]" -> preview usa caption real', () => {
  const mediaWithCaption = {
    kind: 'image',
    caption: 'Olha esse carro',
  };
  assert.equal(formatConversationPreview('[image]', mediaWithCaption), 'Olha esse carro');

  const eventWithCaption = {
    id: 'e-caption',
    direction: 'inbound',
    sender_type: 'contact',
    message_text: '[image]',
    raw_payload: {
      media: {
        kind: 'image',
        caption: 'Olha esse carro',
      },
    },
  };
  const preview = resolveEventMessagePreview(eventWithCaption);
  assert.equal(preview.text, 'Olha esse carro');
});

test('TEST 12: texto legítimo como "Eu uso [audio] como nome da variável" NÃO deve ser transformado', () => {
  const legitimateText = 'Eu uso [audio] como nome da variável';
  assert.equal(normalizeTechnicalMediaPlaceholder(legitimateText), legitimateText);
  assert.equal(formatConversationPreview(legitimateText), legitimateText);

  const bracketsText = 'Relatório [2026] finalizado com sucesso [doc]';
  assert.equal(normalizeTechnicalMediaPlaceholder(bracketsText), bracketsText);
});

test('TEST 13: variações de caixa e espaços (" [AUDIO] ", "[Imagem]") também devem funcionar', () => {
  assert.equal(normalizeTechnicalMediaPlaceholder(' [AUDIO] '), 'Áudio');
  assert.equal(normalizeTechnicalMediaPlaceholder('  [áudio]  '), 'Áudio');
  assert.equal(normalizeTechnicalMediaPlaceholder('[Imagem]'), 'Imagem');
  assert.equal(normalizeTechnicalMediaPlaceholder(' [STICKER] '), 'Figurinha');
  assert.equal(normalizeTechnicalMediaPlaceholder('[Vídeo]'), 'Vídeo');
  assert.equal(normalizeTechnicalMediaPlaceholder(' [Documento] '), 'Documento');
  assert.equal(formatConversationPreview(' [AUDIO] '), 'Áudio');
  assert.equal(formatConversationPreview('[Imagem]'), 'Imagem');
});

test('TEST 14: Storage com createSignedUrl retorna URL assinada direta para imagens sem executar download de Blob ou FileReader', async () => {
  clearMediaUrlCache();
  let downloadCalled = false;
  let createSignedUrlCalls = 0;

  const mockSupabase = {
    storage: {
      from: (bucket) => ({
        createSignedUrl: async (storagePath, expiresIn) => {
          createSignedUrlCalls += 1;
          assert.equal(bucket, 'channel-media');
          assert.equal(storagePath, 'tenant/images/foto_signed.jpg');
          assert.ok(expiresIn >= 7200, 'Duração do link assinado deve ser adequada (>= 2 horas)');
          return {
            data: { signedUrl: 'https://project.supabase.co/storage/v1/object/sign/channel-media/tenant/images/foto_signed.jpg?token=secret123' },
            error: null,
          };
        },
        download: async () => {
          downloadCalled = true;
          throw new Error('download não deveria ser chamado quando createSignedUrl é suportado!');
        },
      }),
    },
  };

  const imageEvent = {
    id: 'evt-img-signed-1',
    raw_payload: {
      media: {
        status: 'stored',
        kind: 'image',
        bucket: 'channel-media',
        storagePath: 'tenant/images/foto_signed.jpg',
        mimeType: 'image/jpeg',
      },
    },
  };

  const enriched = await enrichSingleMediaEvent(imageEvent, mockSupabase);
  assert.equal(downloadCalled, false, 'Download de Blob nunca deve ser executado no caminho preferencial');
  assert.equal(createSignedUrlCalls, 1);
  assert.equal(
    enriched.raw_payload.media.url,
    'https://project.supabase.co/storage/v1/object/sign/channel-media/tenant/images/foto_signed.jpg?token=secret123',
  );
});

test('TEST 15: Storage com createSignedUrl para áudio retorna URL assinada direta para o AudioMessagePlayer sem download de Blob', async () => {
  clearMediaUrlCache();
  let downloadCalled = false;

  const mockSupabase = {
    storage: {
      from: (bucket) => ({
        createSignedUrl: async (storagePath, expiresIn) => {
          return {
            data: { signedUrl: 'https://project.supabase.co/storage/v1/object/sign/channel-media/tenant/audio/audio_signed.ogg?token=tok456' },
            error: null,
          };
        },
        download: async () => {
          downloadCalled = true;
          throw new Error('download não deveria ser chamado para áudio quando createSignedUrl é suportado!');
        },
      }),
    },
  };

  const audioEvent = {
    id: 'evt-audio-signed-1',
    raw_payload: {
      media: {
        status: 'stored',
        kind: 'audio',
        bucket: 'channel-media',
        storagePath: 'tenant/audio/audio_signed.ogg',
        mimeType: 'audio/ogg; codecs=opus',
      },
    },
  };

  const enriched = await enrichSingleMediaEvent(audioEvent, mockSupabase);
  assert.equal(downloadCalled, false);
  assert.equal(
    enriched.raw_payload.media.url,
    'https://project.supabase.co/storage/v1/object/sign/channel-media/tenant/audio/audio_signed.ogg?token=tok456',
  );
});

test('TEST 16: Cache de URLs reutiliza signed URL sem chamadas repetidas ao Storage para o mesmo bucket e storagePath', async () => {
  clearMediaUrlCache();
  let createSignedUrlCalls = 0;

  const mockSupabase = {
    storage: {
      from: () => ({
        createSignedUrl: async () => {
          createSignedUrlCalls += 1;
          return {
            data: { signedUrl: 'https://project.supabase.co/storage/v1/object/sign/cached.jpg?token=xyz' },
            error: null,
          };
        },
      }),
    },
  };

  const event1 = {
    id: 'evt-cache-1',
    raw_payload: {
      media: {
        status: 'stored',
        kind: 'image',
        bucket: 'channel-media',
        storagePath: 'tenant/cache/foto.jpg',
      },
    },
  };
  const event2 = {
    id: 'evt-cache-2',
    raw_payload: {
      media: {
        status: 'stored',
        kind: 'image',
        bucket: 'channel-media',
        storagePath: 'tenant/cache/foto.jpg',
      },
    },
  };

  const res1 = await enrichSingleMediaEvent(event1, mockSupabase);
  assert.equal(createSignedUrlCalls, 1);
  assert.equal(res1.raw_payload.media.url, 'https://project.supabase.co/storage/v1/object/sign/cached.jpg?token=xyz');

  const res2 = await enrichSingleMediaEvent(event2, mockSupabase);
  assert.equal(createSignedUrlCalls, 1, 'Segunda requisição para o mesmo arquivo deve ser atendida pelo cache');
  assert.equal(res2.raw_payload.media.url, 'https://project.supabase.co/storage/v1/object/sign/cached.jpg?token=xyz');
});

test('TEST 17: Falha em createSignedUrl executa fallback gracioso para download de Blob', async () => {
  clearMediaUrlCache();
  let downloadCalled = false;

  const mockSupabase = {
    storage: {
      from: () => ({
        createSignedUrl: async () => ({
          data: null,
          error: new Error('createSignedUrl não suportado nesta região'),
        }),
        download: async () => {
          downloadCalled = true;
          return {
            data: {
              size: 1024,
              type: 'image/jpeg',
              arrayBuffer: async () => Buffer.from('binary-data'),
            },
            error: null,
          };
        },
      }),
    },
  };

  const event = {
    id: 'evt-fallback-1',
    raw_payload: {
      media: {
        status: 'stored',
        kind: 'image',
        bucket: 'channel-media',
        storagePath: 'tenant/fallback/foto.jpg',
        mimeType: 'image/jpeg',
      },
    },
  };

  const enriched = await enrichSingleMediaEvent(event, mockSupabase);
  assert.equal(downloadCalled, true, 'Deve ter chamado download() em caso de falha de createSignedUrl');
  assert.ok(enriched.raw_payload.media.url, 'Deve possuir URL do fallback');
});

test('media recovery TEST 1: URL nova do áudio libera nova tentativa após falha anterior', () => {
  assert.equal(mediaSourceChanged('https://signed.example/audio-a', 'https://signed.example/audio-b'), true);
  assert.equal(mediaSourceChanged('https://signed.example/audio-b', 'https://signed.example/audio-b'), false);
});

test('media recovery TEST 2: URL ou thumbnail nova da imagem libera novo carregamento', () => {
  const imageA = 'https://signed.example/thumb-a\u0000https://signed.example/image-a';
  const imageB = 'https://signed.example/thumb-b\u0000https://signed.example/image-b';
  assert.equal(mediaSourceChanged(imageA, imageB), true);
});

test('media recovery TEST 3: signed URL bem-sucedida não faz retry', async () => {
  clearMediaUrlCache();
  let calls = 0;
  const event = {
    raw_payload: { media: { status: 'stored', kind: 'audio', bucket: 'channel-media', storagePath: 'retry/first.ogg' } },
  };
  const client = {
    storage: { from: () => ({
      createSignedUrl: async () => {
        calls += 1;
        return { data: { signedUrl: 'https://signed.example/first.ogg' }, error: null };
      },
    }) },
  };

  const result = await enrichSingleMediaEvent(event, client);
  assert.equal(calls, 1);
  assert.equal(result.raw_payload.media.url, 'https://signed.example/first.ogg');
});

test('media recovery: tentativa manual força nova URL assinada após falha do player', async () => {
  clearMediaUrlCache();
  let calls = 0;
  const event = {
    raw_payload: {
      media: {
        status: 'stored',
        kind: 'audio',
        bucket: 'channel-media',
        storagePath: 'retry/manual.ogg',
        url: 'https://signed.example/expired.ogg',
      },
    },
  };
  const client = {
    storage: { from: () => ({
      createSignedUrl: async () => {
        calls += 1;
        return { data: { signedUrl: 'https://signed.example/renewed.ogg' }, error: null };
      },
    }) },
  };

  const result = await enrichSingleMediaEvent(event, client, { force: true });
  assert.equal(calls, 1);
  assert.equal(result.raw_payload.media.url, 'https://signed.example/renewed.ogg');
});

test('media recovery TEST 4: falha transitória faz exatamente um retry de signed URL', async () => {
  clearMediaUrlCache();
  let calls = 0;
  const event = {
    raw_payload: { media: { status: 'stored', kind: 'audio', bucket: 'channel-media', storagePath: 'retry/transient.ogg' } },
  };
  const client = {
    storage: { from: () => ({
      createSignedUrl: async () => {
        calls += 1;
        if (calls === 1) return { data: null, error: { status: 503, message: 'service unavailable' } };
        return { data: { signedUrl: 'https://signed.example/transient.ogg' }, error: null };
      },
    }) },
  };

  const result = await enrichSingleMediaEvent(event, client);
  assert.equal(calls, 2);
  assert.equal(result.raw_payload.media.url, 'https://signed.example/transient.ogg');
});

test('media recovery TEST 5: falha permanente não entra em loop de retry', async () => {
  clearMediaUrlCache();
  let calls = 0;
  const event = {
    raw_payload: { media: { status: 'stored', kind: 'image', bucket: 'channel-media', storagePath: 'retry/missing.jpg' } },
  };
  const client = {
    storage: { from: () => ({
      createSignedUrl: async () => {
        calls += 1;
        return { data: null, error: { status: 404, message: 'not found' } };
      },
    }) },
  };

  const result = await enrichSingleMediaEvent(event, client);
  assert.equal(calls, 1);
  assert.equal(result.raw_payload.media.url, undefined);
});

test('media recovery TEST 6: store_failed sem storagePath não tenta assinar URL', async () => {
  clearMediaUrlCache();
  let calls = 0;
  const event = {
    raw_payload: { media: { status: 'store_failed', kind: 'audio', bucket: 'channel-media', storagePath: null } },
  };
  const client = {
    storage: { from: () => ({
      createSignedUrl: async () => {
        calls += 1;
        return { data: { signedUrl: 'https://signed.example/should-not-run.ogg' }, error: null };
      },
    }) },
  };

  const result = await enrichSingleMediaEvent(event, client);
  assert.equal(calls, 0);
  assert.equal(result, event);
  assert.equal(unavailableMediaLabel('audio'), 'Áudio não disponível');
  assert.equal(unavailableMediaLabel('image'), 'Imagem não disponível');
});

test('media recovery TEST 7: fila de assinatura mantém no máximo quatro operações simultâneas', async () => {
  clearMediaUrlCache();
  let active = 0;
  let peak = 0;
  const events = Array.from({ length: 8 }, (_, index) => ({
    id: `concurrency-${index}`,
    raw_payload: { media: { status: 'stored', kind: 'image', bucket: 'channel-media', storagePath: `concurrency/${index}.jpg` } },
  }));
  const client = {
    storage: { from: () => ({
      createSignedUrl: async (path) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 15));
        active -= 1;
        return { data: { signedUrl: `https://signed.example/${path}` }, error: null };
      },
    }) },
  };

  const enriched = await enrichMediaUrls(events, client);
  assert.equal(peak <= 4, true);
  assert.equal(enriched.every((event) => Boolean(event.raw_payload.media.url)), true);
});

test('media recovery TEST 8 a 10: mídia stored válida e Realtime com URL renovada continuam recuperáveis', async () => {
  clearMediaUrlCache();
  const event = {
    id: 'stored-verified-audio',
    channel_type: 'whatsapp',
    external_conversation_id: '5511999999999@s.whatsapp.net',
    direction: 'inbound',
    sender_type: 'contact',
    message_text: '[audio]',
    raw_payload: {
      media: {
        status: 'stored', verified: true, kind: 'audio', bucket: 'channel-media', storagePath: 'stored/verified.ogg', mimeType: 'audio/ogg; codecs=opus',
      },
    },
  };
  const client = {
    storage: { from: () => ({
      createSignedUrl: async () => ({ data: { signedUrl: 'https://signed.example/verified.ogg' }, error: null }),
    }) },
  };

  const enriched = await enrichSingleMediaEvent(event, client);
  assert.equal(enriched.raw_payload.media.url, 'https://signed.example/verified.ogg');
  assert.equal(mediaSourceChanged('https://signed.example/expired.ogg', enriched.raw_payload.media.url), true);
  assert.equal(unavailableMediaLabel('video'), 'Vídeo não disponível');
  assert.equal(unavailableMediaLabel('document'), 'Documento não disponível');
});

// ============================================================================
// TESTES OBRIGATÓRIOS: TEXTO PURO, LOCATION, DOCUMENTOS E REGRESSÕES
// ============================================================================

test('TEST A: category=text + media ausente -> não cria media nem renderiza MediaAttachment', () => {
  const pureTextEvent = {
    id: 'evt-text-pure',
    channel_type: 'whatsapp',
    external_conversation_id: '5511999999999',
    direction: 'inbound',
    sender_type: 'contact',
    message_text: 'Tem manual e chave reserva',
    raw_payload: {
      messageType: 'conversation',
      media: null,
      magia_normalized: {
        media: {
          category: 'text',
        },
      },
    },
  };
  const [conv] = eventsToConversations([pureTextEvent], 'tenant');
  assert.equal(conv.messages[0].media, null, 'media deve ser estritamente null para texto puro');
  assert.equal(conv.messages[0].text, 'Tem manual e chave reserva');
  assert.equal(hasStoredMediaNeedingUrl(pureTextEvent), false);
});

test('TEST B: message_text="Tem manual e chave reserva" -> somente texto', () => {
  const anotherTextEvent = {
    id: 'evt-text-amassados',
    channel_type: 'whatsapp',
    external_conversation_id: '5511999999999',
    direction: 'inbound',
    sender_type: 'contact',
    message_text: 'Ele só tá com uns amassados...',
    raw_payload: {
      messageType: 'conversation',
      media: {
        category: 'text',
      },
    },
  };
  const [conv2] = eventsToConversations([anotherTextEvent], 'tenant');
  assert.equal(conv2.messages[0].media, null, 'objeto com category=text não pode gerar media');
  assert.equal(conv2.messages[0].text, 'Ele só tá com uns amassados...');
});

test('evento outbound não renderiza a imagem inbound que ficou no envelope bruto do workflow', () => {
  const outboundReplyWithInheritedEnvelope = {
    id: 'evt-outbound-inherited-image',
    channel_type: 'whatsapp',
    external_conversation_id: '5511999999999@s.whatsapp.net',
    direction: 'outbound',
    sender_type: 'assistant',
    message_text: 'Qual modelo você procura?',
    created_at: '2026-10-03T15:40:00.000Z',
    raw_payload: {
      media: {
        kind: 'image',
        status: 'stored',
        bucket: 'channel-media',
        storagePath: 'tenant/inbound/copied-to-outbound.jpg',
        url: '',
      },
      data: {
        message: {
          imageMessage: {
            url: 'https://example.test/client-photo.jpg',
            caption: 'Quero vender esse carro',
          },
        },
      },
    },
  };

  const [conversation] = eventsToConversations([outboundReplyWithInheritedEnvelope], 'tenant');
  assert.equal(conversation.messages[0].from, 'ai');
  assert.equal(conversation.messages[0].media, null);
  assert.equal(conversation.messages[0].text, 'Qual modelo você procura?');
  assert.equal(hasStoredMediaNeedingUrl(outboundReplyWithInheritedEnvelope), false);
});

test('mídia outbound declarada no bloco normalizado continua renderizável', () => {
  const outboundImage = {
    id: 'evt-outbound-own-image',
    channel_type: 'whatsapp',
    external_conversation_id: '5511999999999@s.whatsapp.net',
    direction: 'outbound',
    sender_type: 'assistant',
    message_text: '[image]',
    created_at: '2026-10-03T15:41:00.000Z',
    raw_payload: {
      media: {
        kind: 'image',
        status: 'stored',
        origin: 'outbound',
        bucket: 'channel-media',
        storagePath: 'tenant/outbound/image.jpg',
        url: 'https://example.test/outbound-image.jpg',
      },
      data: {
        message: {
          imageMessage: {
            url: 'https://example.test/inherited-input.jpg',
          },
        },
      },
    },
  };

  const [conversation] = eventsToConversations([outboundImage], 'tenant');
  assert.equal(conversation.messages[0].media?.url, 'https://example.test/outbound-image.jpg');
});

test('duas imagens inbound com o mesmo minuto não se fundem no Realtime', () => {
  const firstImage = {
    id: 'evt-first-image-same-minute',
    channel_type: 'whatsapp',
    external_conversation_id: '5511999999999@s.whatsapp.net',
    direction: 'inbound',
    sender_type: 'contact',
    message_text: '[image]',
    created_at: '2026-10-03T15:42:01.000Z',
    raw_payload: { media: { kind: 'image', url: 'https://example.test/first.jpg' } },
  };
  const secondImage = {
    ...firstImage,
    id: 'evt-second-image-same-minute',
    created_at: '2026-10-03T15:42:45.000Z',
    raw_payload: { media: { kind: 'image', url: 'https://example.test/second.jpg' } },
  };

  const conversations = eventsToConversations([firstImage], 'tenant');
  const updated = applyIncomingEventToConversations(conversations, secondImage, 'tenant');
  const messages = updated[0].messages;
  assert.equal(messages.length, 2);
  assert.deepEqual(messages.map((message) => message.eventId), [firstImage.id, secondImage.id]);
  assert.deepEqual(messages.map((message) => message.media?.url), [
    'https://example.test/first.jpg',
    'https://example.test/second.jpg',
  ]);
});

test('TEST C: locationMessage + [location] -> preview "Localização"', () => {
  const locationEvent = {
    id: 'evt-loc-1',
    channel_type: 'whatsapp',
    external_conversation_id: '5511777777777',
    direction: 'inbound',
    sender_type: 'contact',
    message_text: '[location]',
    raw_payload: {
      messageType: 'locationMessage',
      locationMessage: {
        degreesLatitude: -22.9068,
        degreesLongitude: -43.1729,
      },
    },
  };
  const preview = resolveEventMessagePreview(locationEvent);
  assert.equal(preview.text, 'Localização');
});

test('TEST D: locationMessage com nome/endereço/coordenadas -> LocationAttachment recebe os dados corretos', () => {
  const locationWithDetailsEvent = {
    id: 'evt-loc-details',
    channel_type: 'whatsapp',
    external_conversation_id: '5511777777777',
    direction: 'inbound',
    sender_type: 'contact',
    message_text: '[location]',
    raw_payload: {
      messageType: 'locationMessage',
      locationMessage: {
        degreesLatitude: -22.9068,
        degreesLongitude: -43.1729,
        name: 'Gênesis automóveis',
        address: 'Av. das Américas, 500',
      },
    },
  };
  const loc = normalizeLocation(locationWithDetailsEvent.raw_payload);
  assert.equal(loc.name, 'Gênesis automóveis');
  assert.equal(loc.address, 'Av. das Américas, 500');
  assert.equal(loc.latitude, -22.9068);
  assert.equal(loc.longitude, -43.1729);
  assert.ok(loc.url.includes('google.com/maps'));

  const previewDetails = resolveEventMessagePreview(locationWithDetailsEvent);
  assert.equal(previewDetails.text, 'Gênesis automóveis');

  const [convLoc] = eventsToConversations([locationWithDetailsEvent], 'tenant');
  assert.ok(convLoc.messages[0].location);
  assert.equal(convLoc.messages[0].location.name, 'Gênesis automóveis');
  assert.equal(convLoc.messages[0].location.address, 'Av. das Américas, 500');
});

test('TEST E: [location] nunca aparece cru', () => {
  assert.equal(normalizeTechnicalMediaPlaceholder('[location]'), 'Localização');
  assert.equal(normalizeTechnicalMediaPlaceholder(' [LOCATION] '), 'Localização');
  assert.equal(normalizeTechnicalMediaPlaceholder('[localização]'), 'Localização');
  assert.equal(formatConversationPreview('[location]'), 'Localização');
  assert.equal(formatConversationPreview(' [location] '), 'Localização');
});

test('TEST F: document stored + URL -> card de documento real com metadados', async () => {
  clearMediaUrlCache();
  const docEvent = {
    id: 'evt-doc-1',
    channel_type: 'whatsapp',
    external_conversation_id: '5511666666666',
    direction: 'inbound',
    sender_type: 'contact',
    message_text: '[document]',
    raw_payload: {
      media: {
        status: 'stored',
        kind: 'document',
        bucket: 'channel-media',
        storagePath: 'tenant/docs/manual.pdf',
        fileName: 'manual_do_proprietario.pdf',
        mimeType: 'application/pdf',
        size: 1048576,
      },
    },
  };
  const mockSupabase = {
    storage: {
      from: () => ({
        createSignedUrl: async () => ({
          data: { signedUrl: 'https://project.supabase.co/storage/v1/object/sign/manual.pdf?token=xyz' },
          error: null,
        }),
      }),
    },
  };
  const enrichedDoc = await enrichSingleMediaEvent(docEvent, mockSupabase);
  assert.equal(enrichedDoc.raw_payload.media.url, 'https://project.supabase.co/storage/v1/object/sign/manual.pdf?token=xyz');
  const [convDoc] = eventsToConversations([enrichedDoc], 'tenant');
  const docMsg = convDoc.messages[0];
  assert.equal(docMsg.media.kind, 'document');
  assert.equal(docMsg.media.fileName, 'manual_do_proprietario.pdf');
  assert.equal(formatFriendlyMimeType(docMsg.media.mimeType, docMsg.media.fileName), 'PDF');
  assert.equal(formatFileSize(docMsg.media.size), '1.0 MB');
});

test('sticker stored uses a signed URL and remains a sticker in the conversation', async () => {
  clearMediaUrlCache();
  const stickerEvent = {
    id: 'evt-sticker-1', channel_type: 'whatsapp', external_conversation_id: '5511666666666',
    direction: 'inbound', sender_type: 'contact', message_text: '[sticker]',
    raw_payload: { media: { status: 'stored', kind: 'sticker', category: 'sticker', bucket: 'channel-media',
      storagePath: 'tenant/stickers/adesivo.webp', mimeType: 'image/webp', size: 3192 } },
  };
  const client = { storage: { from: (bucket) => ({ createSignedUrl: async (path) => {
    assert.equal(bucket, 'channel-media'); assert.equal(path, 'tenant/stickers/adesivo.webp');
    return { data: { signedUrl: 'https://project.supabase.co/storage/v1/object/sign/sticker.webp?token=xyz' }, error: null };
  } }) } };
  const enriched = await enrichSingleMediaEvent(stickerEvent, client);
  assert.equal(enriched.raw_payload.media.url, 'https://project.supabase.co/storage/v1/object/sign/sticker.webp?token=xyz');
  const [conversation] = eventsToConversations([enriched], 'tenant');
  assert.equal(conversation.messages[0].media.kind, 'sticker');
  assert.equal(conversation.messages[0].media.mimeType, 'image/webp');
});

test('TEST G: document sem URL -> fallback amigável Documento, sem card fantasma de imagem', () => {
  const pendingDocEvent = {
    id: 'evt-doc-pending',
    channel_type: 'whatsapp',
    external_conversation_id: '5511666666666',
    direction: 'inbound',
    sender_type: 'contact',
    message_text: '[document]',
    raw_payload: {
      media: {
        status: 'pending',
        kind: 'document',
        fileName: 'contrato.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
    },
  };
  const [convPending] = eventsToConversations([pendingDocEvent], 'tenant');
  const pendingMsg = convPending.messages[0];
  assert.equal(pendingMsg.media.kind, 'document');
  assert.equal(pendingMsg.media.url, '');
  assert.equal(formatFriendlyMimeType(pendingMsg.media.mimeType, pendingMsg.media.fileName), 'Word');
});

test('TEST H: áudio e imagem atuais continuam funcionando', () => {
  assert.equal(REAL_MEDIA_KINDS.has('audio'), true);
  assert.equal(REAL_MEDIA_KINDS.has('image'), true);
  assert.equal(REAL_MEDIA_KINDS.has('text'), false);
  assert.equal(REAL_MEDIA_KINDS.has('conversation'), false);
});

// ============================================================================
// LOCALIZAÇÃO: FORMATAÇÃO, RESOLUÇÃO IMEDIATA E CACHE
// ============================================================================

test('formatCoordinates: formata latitude e longitude com cardinalidade e 4 casas decimais', () => {
  assert.equal(formatCoordinates(-23.55052, -46.633308), '23.5505° S, 46.6333° O');
  assert.equal(formatCoordinates(40.7128, -74.0060), '40.7128° N, 74.0060° O');
  assert.equal(formatCoordinates(-22.9068, 43.1729), '22.9068° S, 43.1729° L');
  assert.equal(formatCoordinates(0, 0), '0.0000° N, 0.0000° L');
});

test('formatCoordinates: trata valores nulos ou inválidos retornando string vazia', () => {
  assert.equal(formatCoordinates(null, null), '');
  assert.equal(formatCoordinates(undefined, -46.63), '');
  assert.equal(formatCoordinates('abc', 10), '');
  assert.equal(formatCoordinates(NaN, NaN), '');
});

test('normalizeLocation: reconhece imediatamente mensagem de localização mesmo sem coordenadas prévias', () => {
  const event = {
    id: 'evt-loc-pending',
    message_text: '[location]',
    raw_payload: {},
  };
  const result = normalizeLocation(event.raw_payload, event);
  assert.ok(result);
  assert.equal(result.isResolving, true);
  assert.equal(result.name, '');
  assert.equal(result.address, '');
  assert.equal(result.latitude, null);
  assert.equal(result.longitude, null);
});

test('normalizeLocation: extrai nome, endereço e coordenadas do payload Evolution / WhatsApp', () => {
  const event = {
    id: 'evt-loc-complete',
    message_text: 'Localização',
    raw_payload: {
      messageType: 'locationMessage',
      locationMessage: {
        degreesLatitude: -23.55052,
        degreesLongitude: -46.63331,
        name: 'Parque Ibirapuera',
        address: 'Av. Pedro Álvares Cabral - Vila Mariana, São Paulo - SP',
      },
    },
  };
  const result = normalizeLocation(event.raw_payload, event);
  assert.ok(result);
  assert.equal(result.isResolving, false);
  assert.equal(result.name, 'Parque Ibirapuera');
  assert.equal(result.address, 'Av. Pedro Álvares Cabral - Vila Mariana, São Paulo - SP');
  assert.equal(result.latitude, -23.55052);
  assert.equal(result.longitude, -46.63331);
  assert.ok(result.url.includes('-23.55052,-46.63331'));
});

test('normalizeLocation: reutiliza cache de endereço e nome para coordenadas idênticas', () => {
  // 1º evento tem nome e endereço
  const event1 = {
    id: 'evt-loc-cached-1',
    tenant_slug: 'tenant-localizacao',
    raw_payload: {
      locationMessage: {
        degreesLatitude: -22.90684,
        degreesLongitude: -43.17291,
        name: 'Cristo Redentor',
        address: 'Parque Nacional da Tijuca - Alto da Boa Vista, Rio de Janeiro - RJ',
      },
    },
  };
  normalizeLocation(event1.raw_payload, event1);

  // 2º evento com as mesmas coordenadas mas sem nome/endereço (apenas coordenadas brutas)
  const event2 = {
    id: 'evt-loc-cached-2',
    tenant_slug: 'tenant-localizacao',
    raw_payload: {
      locationMessage: {
        degreesLatitude: -22.90684,
        degreesLongitude: -43.17291,
      },
    },
  };
  const result2 = normalizeLocation(event2.raw_payload, event2);
  assert.ok(result2);
  assert.equal(result2.name, 'Cristo Redentor');
  assert.equal(result2.address, 'Parque Nacional da Tijuca - Alto da Boa Vista, Rio de Janeiro - RJ');
});

test('applyIncomingEventToConversations: atualiza location atomicamente quando mensagem pendente é enriquecida', () => {
  // 1. Mensagem inicial chega como [location] pendente
  const pendingEvent = {
    id: 'evt-loc-realtime',
    channel_type: 'whatsapp',
    external_conversation_id: '5511999887766',
    direction: 'inbound',
    sender_type: 'contact',
    message_text: '[location]',
    created_at: '2026-10-02T18:00:00.000Z',
    raw_payload: {},
  };

  const initialConversations = applyIncomingEventToConversations([], pendingEvent, 'tenant');
  assert.equal(initialConversations.length, 1);
  const msg1 = initialConversations[0].messages[0];
  assert.ok(msg1.location);
  assert.equal(msg1.location.isResolving, true);

  // 2. Evento atualizado chega com coordenadas e endereço resolvidos
  const resolvedEvent = {
    id: 'evt-loc-realtime',
    channel_type: 'whatsapp',
    external_conversation_id: '5511999887766',
    direction: 'inbound',
    sender_type: 'contact',
    message_text: '[location]',
    created_at: '2026-10-02T18:00:00.000Z',
    raw_payload: {
      messageType: 'locationMessage',
      locationMessage: {
        degreesLatitude: -23.55,
        degreesLongitude: -46.63,
        name: 'Sé',
        address: 'Praça da Sé, São Paulo - SP',
      },
    },
  };

  const updatedConversations = applyIncomingEventToConversations(initialConversations, resolvedEvent, 'tenant');
  assert.equal(updatedConversations[0].messages.length, 1);
  const updatedMsg = updatedConversations[0].messages[0];
  assert.ok(updatedMsg.location);
  assert.equal(updatedMsg.location.isResolving, false);
  assert.equal(updatedMsg.location.name, 'Sé');
  assert.equal(updatedMsg.location.address, 'Praça da Sé, São Paulo - SP');
  assert.equal(updatedMsg.location.latitude, -23.55);
});

// ============================================================================
// HISTORICAL AUDIO TRANSCRIPTION & RECOVERY RENDERING (FRONTEND FIX)
// ============================================================================

test('Cenário 1: media de áudio válida -> player normal', () => {
  const validAudioEvent = {
    id: 'evt-audio-valid-1',
    channel_type: 'whatsapp',
    external_conversation_id: '5511999999999',
    direction: 'inbound',
    sender_type: 'contact',
    message_text: '[audio]',
    created_at: '2026-10-02T14:00:00.000Z',
    raw_payload: {
      media: {
        kind: 'audio',
        status: 'stored',
        url: 'https://example.test/real-audio.ogg',
        mimeType: 'audio/ogg',
        duration: 12,
      },
    },
  };

  const [conversation] = eventsToConversations([validAudioEvent], 'tenant');
  const message = conversation.messages[0];

  assert.ok(message.media);
  assert.equal(message.media.kind, 'audio');
  assert.equal(message.media.url, 'https://example.test/real-audio.ogg');
  // Deve renderizar player normal (media com url presente)
  const isPlayableAudio = Boolean(message.media && message.media.url);
  assert.equal(isPlayableAudio, true);
});

test('Cenário 2: sem media + audio_transcriptions[event.id].status = transcribed + texto válido -> exibe transcrição e NÃO exibe "arquivo não chegou"', () => {
  const historicalTranscribedAudioEvent = {
    id: 'evt-audio-hist-123',
    channel_type: 'whatsapp',
    external_conversation_id: '5511999999999',
    direction: 'inbound',
    sender_type: 'contact',
    message_text: '[audio]',
    created_at: '2026-10-02T14:05:00.000Z',
    raw_payload: {
      // O raw_payload antigo perdeu data.message.audioMessage, logo media é null
      audio_transcriptions: {
        'evt-audio-hist-123': {
          status: 'transcribed',
          version: 'whatsapp_audio_v1',
          text: 'Boa tarde, gostaria de avaliar um Honda Civic 2020 para troca.',
          model: 'whisper-1',
          transcribed_at: '2026-10-02T14:05:05.000Z',
        },
      },
    },
  };

  // Normalização do audioTranscription
  const transcription = normalizeAudioTranscription(historicalTranscribedAudioEvent.raw_payload, historicalTranscribedAudioEvent);
  assert.ok(transcription);
  assert.equal(transcription.status, 'transcribed');
  assert.equal(transcription.version, 'whatsapp_audio_v1');
  assert.equal(transcription.text, 'Boa tarde, gostaria de avaliar um Honda Civic 2020 para troca.');
  assert.equal(transcription.model, 'whisper-1');

  // Integração em conversa
  const [conversation] = eventsToConversations([historicalTranscribedAudioEvent], 'tenant');
  const message = conversation.messages[0];

  // Não tem mídia binária/reproduzível
  assert.equal(message.media, null);
  // Possui a transcrição normalizada
  assert.ok(message.audioTranscription);
  assert.equal(message.audioTranscription.text, 'Boa tarde, gostaria de avaliar um Honda Civic 2020 para troca.');

  // Preview da conversa reflete a transcrição em vez de [audio]
  const preview = resolveEventMessagePreview(historicalTranscribedAudioEvent);
  assert.equal(preview.text, 'Boa tarde, gostaria de avaliar um Honda Civic 2020 para troca.');

  // Regra de renderização do frontend:
  // 1. Não renderiza player de áudio pois não há media.url
  const rendersPlayer = Boolean(message.media && message.media.url);
  assert.equal(rendersPlayer, false);

  // 2. Renderiza o card de transcrição
  const rendersTranscribedCard = !message.media && Boolean(message.audioTranscription?.text);
  assert.equal(rendersTranscribedCard, true);

  // 3. NÃO exibe notice de missing_source ("arquivo não chegou")
  const rendersMissingSourceNotice = !message.media && !message.audioTranscription && isMediaPlaceholderForKind(message.text, 'audio');
  assert.equal(rendersMissingSourceNotice, false);
});

test('Cenário 3: sem media + sem transcrição + text = [audio] -> exibe estado realmente indisponível', () => {
  const missingAudioEvent = {
    id: 'evt-audio-missing-456',
    channel_type: 'whatsapp',
    external_conversation_id: '5511999999999',
    direction: 'inbound',
    sender_type: 'contact',
    message_text: '[audio]',
    created_at: '2026-10-02T14:10:00.000Z',
    raw_payload: {}, // Sem media e sem transcrição
  };

  const transcription = normalizeAudioTranscription(missingAudioEvent.raw_payload, missingAudioEvent);
  assert.equal(transcription, null);

  const [conversation] = eventsToConversations([missingAudioEvent], 'tenant');
  const message = conversation.messages[0];

  assert.equal(message.media, null);
  assert.equal(message.audioTranscription, null);
  assert.equal(isMediaPlaceholderForKind(message.text, 'audio'), true);

  // Regra de renderização do frontend:
  const rendersPlayer = Boolean(message.media && message.media.url);
  const rendersTranscribedCard = !message.media && Boolean(message.audioTranscription?.text);
  const rendersMissingSourceNotice = !message.media && !message.audioTranscription && isMediaPlaceholderForKind(message.text, 'audio');

  assert.equal(rendersPlayer, false);
  assert.equal(rendersTranscribedCard, false);
  assert.equal(rendersMissingSourceNotice, true, 'Deve exibir aviso de áudio ausente/indisponível');
});

test('Cenário 4: transcrição pertencente a OUTRO event_id presente no mesmo raw_payload -> NÃO usar no evento atual', () => {
  // Simula agrupamento de mensagens no mesmo turno de debounce onde o raw_payload copiou audio_transcriptions
  const sharedRawPayload = {
    audio_transcriptions: {
      'evt-audio-original-999': {
        status: 'transcribed',
        version: 'whatsapp_audio_v1',
        text: 'Olá, segue o comprovante do sinal.',
      },
    },
  };

  // Evento de texto da mesma janela de debounce (não é o áudio!)
  const textEvent = {
    id: 'evt-text-other-888',
    channel_type: 'whatsapp',
    external_conversation_id: '5511999999999',
    direction: 'inbound',
    sender_type: 'contact',
    message_text: '25/12/1994',
    created_at: '2026-10-02T14:15:00.000Z',
    raw_payload: sharedRawPayload,
  };

  // Evento de áudio original que realmente corresponde ao ID
  const audioEvent = {
    id: 'evt-audio-original-999',
    channel_type: 'whatsapp',
    external_conversation_id: '5511999999999',
    direction: 'inbound',
    sender_type: 'contact',
    message_text: '[audio]',
    created_at: '2026-10-02T14:15:02.000Z',
    raw_payload: sharedRawPayload,
  };

  // 1. Para o evento de texto: NÃO deve adotar a transcrição do áudio vizinho!
  const textTranscription = normalizeAudioTranscription(textEvent.raw_payload, textEvent);
  assert.equal(textTranscription, null, 'Evento com ID diferente não pode herdar audio_transcriptions');

  // 2. Para o evento de áudio original: deve associar corretamente
  const audioTranscription = normalizeAudioTranscription(audioEvent.raw_payload, audioEvent);
  assert.ok(audioTranscription);
  assert.equal(audioTranscription.text, 'Olá, segue o comprovante do sinal.');

  // 3. Ao montar a conversa:
  const [conversation] = eventsToConversations([textEvent, audioEvent], 'tenant');
  assert.equal(conversation.messages.length, 2);

  const textMsg = conversation.messages.find((m) => m.eventId === 'evt-text-other-888');
  const audioMsg = conversation.messages.find((m) => m.eventId === 'evt-audio-original-999');

  assert.equal(textMsg.text, '25/12/1994');
  assert.equal(textMsg.audioTranscription, null);

  assert.equal(audioMsg.audioTranscription?.text, 'Olá, segue o comprovante do sinal.');
});

// ============================================================================
// SECTION: FRONTEND MEDIA CONTRACT TESTS (video, storage_error, audio+transcription)
// ============================================================================

test('contract: video stored uses signed URL and produces MediaAttachment kind video', async () => {
  clearMediaUrlCache();
  const videoEvent = {
    id: 'evt-video-contract',
    channel_type: 'whatsapp',
    external_conversation_id: '5511777777777',
    direction: 'inbound',
    sender_type: 'contact',
    message_text: '[video]',
    raw_payload: {
      media: {
        status: 'stored',
        kind: 'video',
        category: 'video',
        bucket: 'channel-media',
        storagePath: 'tenant/video/video-walkaround.mp4',
        mimeType: 'video/mp4',
        size: 5242880,
      },
    },
  };
  const mockSupabase = {
    storage: {
      from: (bucket) => ({
        createSignedUrl: async (storagePath) => {
          assert.equal(bucket, 'channel-media');
          assert.equal(storagePath, 'tenant/video/video-walkaround.mp4');
          return { data: { signedUrl: 'https://project.supabase.co/storage/v1/object/sign/video.mp4?token=abc' }, error: null };
        },
      }),
    },
  };
  const enriched = await enrichSingleMediaEvent(videoEvent, mockSupabase);
  assert.equal(enriched.raw_payload.media.url, 'https://project.supabase.co/storage/v1/object/sign/video.mp4?token=abc');
  const [conv] = eventsToConversations([enriched], 'tenant');
  const msg = conv.messages[0];
  assert.equal(msg.media.kind, 'video');
  assert.equal(msg.media.url, 'https://project.supabase.co/storage/v1/object/sign/video.mp4?token=abc');
  assert.equal(msg.media.mimeType, 'video/mp4');
});

test('contract: storage_error does NOT attempt to generate signed URL', async () => {
  clearMediaUrlCache();
  let calledSignedUrl = false;
  const errorEvent = {
    id: 'evt-storage-error-contract',
    channel_type: 'whatsapp',
    external_conversation_id: '5511777777777',
    direction: 'inbound',
    sender_type: 'contact',
    message_text: '[image]',
    raw_payload: {
      media: {
        status: 'storage_error',
        kind: 'image',
        bucket: 'channel-media',
        storagePath: null,
        error: 'media_too_large',
      },
    },
  };
  const mockSupabase = {
    storage: {
      from: () => ({
        createSignedUrl: async () => {
          calledSignedUrl = true;
          return { data: null, error: new Error('should not be called') };
        },
      }),
    },
  };
  const enriched = await enrichSingleMediaEvent(errorEvent, mockSupabase);
  assert.equal(calledSignedUrl, false, 'createSignedUrl must NOT be called for storage_error');
  assert.equal(enriched.raw_payload.media.url, undefined);
});

test('contract: audio stored + audio_processing renders player and transcription together', async () => {
  clearMediaUrlCache();
  const audioEvent = {
    id: 'evt-audio-full-contract',
    channel_type: 'whatsapp',
    external_conversation_id: '5511777777777',
    direction: 'inbound',
    sender_type: 'contact',
    message_text: '[audio]',
    raw_payload: {
      media: {
        status: 'stored',
        kind: 'audio',
        category: 'audio',
        bucket: 'channel-media',
        storagePath: 'tenant/audio/audio-contract.ogg',
        mimeType: 'audio/ogg',
        size: 32000,
      },
      audio_processing: {
        version: 'whatsapp_audio_v1',
        status: 'transcribed',
        text: 'Boa tarde, gostaria de agendar uma visita.',
      },
    },
  };
  const mockSupabase = {
    storage: {
      from: () => ({
        createSignedUrl: async () => ({
          data: { signedUrl: 'https://project.supabase.co/storage/v1/object/sign/audio.ogg?token=xyz' },
          error: null,
        }),
      }),
    },
  };
  const enriched = await enrichSingleMediaEvent(audioEvent, mockSupabase);
  const [conv] = eventsToConversations([enriched], 'tenant');
  const msg = conv.messages[0];
  assert.equal(msg.media.kind, 'audio');
  assert.equal(msg.media.url, 'https://project.supabase.co/storage/v1/object/sign/audio.ogg?token=xyz');
  assert.equal(msg.audioTranscription?.text, 'Boa tarde, gostaria de agendar uma visita.');
});

test('contract: pending audio keeps its descriptor and never requests a signed URL prematurely', async () => {
  clearMediaUrlCache();
  let signed = false;
  const event = {
    id: 'evt-pending-audio', direction: 'inbound', channel_type: 'whatsapp', external_conversation_id: '5511000000000', message_text: '[audio]',
    raw_payload: { media: { status: 'pending', kind: 'audio', bucket: 'channel-media', storagePath: 'loja/whatsapp/chat/voice.ogg', mimeType: 'audio/ogg' }, audio_processing: { status: 'transcribed', text: 'Teste de áudio.' } },
  };
  const client = { storage: { from: () => ({ createSignedUrl: async () => { signed = true; return { data: null, error: null }; } }) } };
  assert.equal(hasStoredMediaNeedingUrl(event), false);
  const enriched = await enrichSingleMediaEvent(event, client);
  assert.equal(signed, false);
  const [conversation] = eventsToConversations([enriched], 'tenant');
  assert.equal(conversation.messages[0].media.status, 'pending');
  assert.equal(conversation.messages[0].audioTranscription?.text, 'Teste de áudio.');
});

test('contract: pending image stays pending rather than becoming unavailable in the data model', async () => {
  const event = {
    id: 'evt-pending-image', direction: 'inbound', channel_type: 'whatsapp', external_conversation_id: '5511000000001', message_text: '[image]',
    raw_payload: { media: { status: 'pending', kind: 'image', bucket: 'channel-media', storagePath: 'loja/whatsapp/chat/photo.jpg', mimeType: 'image/jpeg' } },
  };
  const media = normalizeMedia(event.raw_payload, event);
  assert.equal(media.status, 'pending');
  assert.equal(media.url, '');
  assert.equal(media.storagePath, 'loja/whatsapp/chat/photo.jpg');
});

test('contract: unavailable historical audio retains transcription without pretending it has a URL', () => {
  const event = {
    id: 'evt-historical-audio', direction: 'inbound', channel_type: 'whatsapp', external_conversation_id: '5511000000002', message_text: '[audio]',
    raw_payload: { media: { status: 'unavailable', kind: 'audio', error: 'media_download_failed' }, audio_processing: { status: 'transcribed', text: 'Áudio antigo transcrito.' } },
  };
  const [conversation] = eventsToConversations([event], 'tenant');
  const message = conversation.messages[0];
  assert.equal(message.media.status, 'unavailable');
  assert.equal(message.media.url, '');
  assert.equal(message.audioTranscription?.text, 'Áudio antigo transcrito.');
});

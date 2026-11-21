import test from 'node:test';
import assert from 'node:assert/strict';
import { isStorageNotFoundError } from '../../src/services/media/storageErrors.js';
import { mergeMediaDescriptors, normalizeMedia } from '../../src/services/media/mediaNormalization.js';
import {
  clearMediaUrlCache,
  getMediaUrlFromCache,
  resolveSingleMediaUrl,
  invalidateMediaUrl,
} from '../../src/services/media/mediaUrlService.js';
import { applyIncomingEventToConversations } from '../../src/services/conversations/applyIncomingEvent.js';

test('VERIFICATION 1: isStorageNotFoundError detects 404 and NoSuchKey errors', () => {
  assert.equal(isStorageNotFoundError({ status: 404, message: 'Not found' }), true);
  assert.equal(isStorageNotFoundError({ statusCode: '404', message: 'Not found' }), true);
  assert.equal(isStorageNotFoundError({ message: 'Object not found' }), true);
  assert.equal(isStorageNotFoundError({ message: 'The specified key does not exist' }), true);
  assert.equal(isStorageNotFoundError({ message: 'NoSuchKey' }), true);
  assert.equal(isStorageNotFoundError({ message: 'Rate limit exceeded', status: 429 }), false);
  assert.equal(isStorageNotFoundError(null), false);
});

test('VERIFICATION 2: normalizeMedia does not fabricate storage paths for messages without storagePath', () => {
  const unconfirmedInbound = {
    tenant_slug: 'wesley_automoveis',
    direction: 'inbound',
    external_conversation_id: '5521985198468@s.whatsapp.net',
    external_message_id: 'UNKNOWN_MSG_123',
    message_text: '[image]',
    raw_payload: {},
  };

  const media = normalizeMedia(unconfirmedInbound.raw_payload, unconfirmedInbound);
  assert.equal(media, null, 'Plain placeholder without media payload must not produce a media object');

  // Evolution message with encrypted mmg URL and no storagePath
  const evolutionOnly = {
    tenant_slug: 'wesley_automoveis',
    direction: 'inbound',
    external_conversation_id: '5521985198468@s.whatsapp.net',
    external_message_id: 'UNKNOWN_MSG_456',
    raw_payload: {
      data: {
        message: {
          imageMessage: {
            url: 'https://mmg.whatsapp.net/v/t62.7118-24/test.enc',
            mimetype: 'image/jpeg',
          },
        },
      },
    },
  };
  const normEvolution = normalizeMedia(evolutionOnly.raw_payload, evolutionOnly);
  assert.ok(normEvolution);
  assert.equal(normEvolution.storagePath, '', 'Must not invent storagePath');
  assert.equal(normEvolution.status, 'unavailable');
  assert.equal(normEvolution.url, '');
});

test('VERIFICATION 3: resolveSingleMediaUrl caches negative 404 results and prevents request loops', async () => {
  clearMediaUrlCache();

  let storageCallCount = 0;
  let downloadCallCount = 0;

  const mockSupabase404 = {
    storage: {
      from: () => ({
        createSignedUrl: async () => {
          storageCallCount += 1;
          return { data: null, error: { message: 'Object not found', status: 404 } };
        },
        download: async () => {
          downloadCallCount += 1;
          return { data: null, error: { message: 'Object not found', status: 404 } };
        },
      }),
    },
  };

  const mediaItem = {
    kind: 'image',
    bucket: 'channel-media',
    storagePath: 'wesley_automoveis/whatsapp/chat/nonexistent.jpg',
    status: 'stored',
  };

  // First resolution: calls createSignedUrl once, fails with 404, does NOT call download fallback!
  const url1 = await resolveSingleMediaUrl(mediaItem, mockSupabase404);
  assert.equal(url1, '');
  assert.equal(storageCallCount, 1);
  assert.equal(downloadCallCount, 0, 'Must NOT attempt download fallback on 404 / NoSuchKey');

  // Cache should now have a negative entry
  const cached = getMediaUrlFromCache(mediaItem.bucket, mediaItem.storagePath);
  assert.deepEqual(cached, { error: true, code: 'not_found' });

  // Subsequent call: should use negative cache and NOT make another storage call!
  const url2 = await resolveSingleMediaUrl(mediaItem, mockSupabase404);
  assert.equal(url2, '');
  assert.equal(storageCallCount, 1, 'Storage call count must remain 1 (negative cached)');

  // Retry with invalidateMediaUrl: clears cache and permits a fresh attempt
  invalidateMediaUrl(mediaItem.bucket, mediaItem.storagePath);
  const cachedAfterInvalidate = getMediaUrlFromCache(mediaItem.bucket, mediaItem.storagePath);
  assert.equal(cachedAfterInvalidate, null);

  await resolveSingleMediaUrl(mediaItem, mockSupabase404, { force: true });
  assert.equal(storageCallCount, 2, 'Force retry allows exactly 1 new request after invalidation');
});

test('VERIFICATION 4: deduplicates concurrent requests for the same media', async () => {
  clearMediaUrlCache();

  let callCount = 0;
  const mockSupabaseSlow = {
    storage: {
      from: () => ({
        createSignedUrl: async () => {
          callCount += 1;
          await new Promise((resolve) => setTimeout(resolve, 20));
          return { data: { signedUrl: 'https://supabase.co/signed/fast.jpg' }, error: null };
        },
      }),
    },
  };

  const mediaItem = {
    kind: 'image',
    bucket: 'channel-media',
    storagePath: 'wesley_automoveis/whatsapp/chat/fast.jpg',
    status: 'stored',
  };

  // Launch 5 concurrent calls
  const promises = [1, 2, 3, 4, 5].map(() => resolveSingleMediaUrl(mediaItem, mockSupabaseSlow));
  const results = await Promise.all(promises);

  assert.equal(callCount, 1, 'Concurrent requests for the same media path must share a single promise');
  for (const res of results) {
    assert.equal(res, 'https://supabase.co/signed/fast.jpg');
  }
});

test('VERIFICATION 5: applyIncomingEvent preserves resolved media.url and thumbnailUrl on realtime updates', () => {
  const existingConv = {
    id: 'conv-1',
    externalConversationId: '5521985198468@s.whatsapp.net',
    channelType: 'whatsapp',
    messages: [
      {
        eventId: 'evt-img-1',
        from: 'contact',
        text: '',
        at: '10:00',
        media: {
          kind: 'image',
          bucket: 'channel-media',
          storagePath: 'wesley_automoveis/whatsapp/chat/photo.jpg',
          status: 'stored',
          url: 'https://supabase.co/signed/photo.jpg?token=secret123',
          thumbnailUrl: 'https://supabase.co/signed/photo-thumb.jpg?token=secret123',
        },
      },
    ],
  };

  // Incoming realtime update for the same event (e.g. delivery status update or transcript update)
  const incomingRealtimeEvent = {
    id: 'evt-img-1',
    channel_type: 'whatsapp',
    external_conversation_id: '5521985198468@s.whatsapp.net',
    direction: 'inbound',
    delivery_status: 'delivered',
    created_at: '2026-10-16T18:00:00.000Z',
    raw_payload: {
      media: {
        kind: 'image',
        bucket: 'channel-media',
        storagePath: 'wesley_automoveis/whatsapp/chat/photo.jpg',
        status: 'stored',
        url: '', // realtime payloads from DB do NOT include client-signed URLs!
      },
    },
  };

  const updatedConvs = applyIncomingEventToConversations([existingConv], incomingRealtimeEvent, 'wesley_automoveis');
  const updatedMsg = updatedConvs[0].messages[0];

  assert.equal(updatedMsg.status, 'delivered');
  assert.equal(
    updatedMsg.media.url,
    'https://supabase.co/signed/photo.jpg?token=secret123',
    'Preserved signed URL must NOT be overwritten by empty URL in realtime event'
  );
  assert.equal(
    updatedMsg.media.thumbnailUrl,
    'https://supabase.co/signed/photo-thumb.jpg?token=secret123',
    'Preserved signed thumbnailUrl must NOT be overwritten'
  );
});

test('VERIFICATION 6: refresh sem loadState não ressuscita erro local como spinner', () => {
  const failed = {
    kind: 'image',
    status: 'stored',
    bucket: 'channel-media',
    storagePath: 'tenant/chat/photo.jpg',
    loadState: 'retryable_error',
  };
  const staleSnapshot = {
    kind: 'image',
    status: 'stored',
    bucket: 'channel-media',
    storagePath: 'tenant/chat/photo.jpg',
    loadState: '',
  };

  const merged = mergeMediaDescriptors(failed, staleSnapshot);
  assert.equal(merged.loadState, 'retryable_error');

  const resolved = mergeMediaDescriptors(failed, { ...staleSnapshot, url: 'https://example.com/photo.jpg' });
  assert.equal(resolved.url, 'https://example.com/photo.jpg');
  assert.equal(resolved.loadState, '');
});

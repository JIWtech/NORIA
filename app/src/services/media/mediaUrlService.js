import { asObject } from '../../utils/asObject.js';
import { isExplicitOutboundMedia } from './mediaDirection.js';
import { normalizeMedia, isUsableBrowserUrl } from './mediaNormalization.js';
import { isTransientStorageError, isStorageNotFoundError } from './storageErrors.js';

export const SIGNED_URL_EXPIRES_IN = 86400;
const MEDIA_SIGNING_CONCURRENCY = 4;
const SIGNED_URL_RETRY_DELAY_MS = 300;
const NEGATIVE_CACHE_TTL_MS = 300_000; // 5 minutos para arquivos não encontrados
const mediaObjectUrlCache = new Map();
const mediaUrlRequestCache = new Map();
const invalidatedMediaRequests = new WeakSet();
let mediaCacheEpoch = 0;

export function clearMediaUrlCache() {
  mediaCacheEpoch += 1;
  for (const request of mediaUrlRequestCache.values()) invalidatedMediaRequests.add(request);
  mediaObjectUrlCache.clear();
  mediaUrlRequestCache.clear();
}

export function getMediaUrlFromCache(bucketOrKey, storagePath) {
  if (!bucketOrKey) return null;
  const key = storagePath ? `${bucketOrKey}:${storagePath}` : bucketOrKey;
  const cached = mediaObjectUrlCache.get(key);
  if (!cached) return null;
  if (typeof cached === 'string') return cached;
  if (cached.expiresAt <= Date.now()) {
    mediaObjectUrlCache.delete(key);
    return null;
  }
  if (cached.error) return { error: true, code: cached.code };
  return cached.url;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    if (typeof FileReader === 'undefined') {
      if (typeof blob?.arrayBuffer === 'function') {
        blob.arrayBuffer().then((buf) => {
          const base64 = Buffer.from(buf).toString('base64');
          resolve(`data:${blob.type || 'image/jpeg'};base64,${base64}`);
        }).catch(reject);
        return;
      }
      resolve(`data:${blob?.type || 'image/jpeg'};base64,mockdata`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Não foi possível ler a imagem.'));
    reader.readAsDataURL(blob);
  });
}

function waitForMediaRetry() {
  return new Promise((resolve) => setTimeout(resolve, SIGNED_URL_RETRY_DELAY_MS));
}

async function createSignedUrlWithRetry(storageBucket, storagePath) {
  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { data, error } = await storageBucket.createSignedUrl(storagePath, SIGNED_URL_EXPIRES_IN);
      if (!error && data?.signedUrl) return { url: data.signedUrl, error: null };
      lastError = error;
    } catch (error) {
      lastError = error;
    }

    if (attempt === 0 && isTransientStorageError(lastError)) {
      await waitForMediaRetry();
      continue;
    }
    break;
  }

  if (lastError && !isStorageNotFoundError(lastError)) {
    console.warn('createSignedUrl error:', lastError?.message || lastError);
  }
  return { url: '', error: lastError };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }));

  return results;
}

async function resolveStoredMediaUrl(media, supabase) {
  if (!supabase?.storage?.from) return { url: '', error: new Error('Storage indisponível') };
  const storageBucket = supabase.storage.from(media.bucket);
  let resolvedUrl = '';
  let lastError = null;

  // 1. Preferir createSignedUrl diretamente do Storage (sem baixar Blob nem usar FileReader)
  // Seguro para bucket privado e diretamente utilizável por <img>, <audio>, <video>
  if (media.encoding !== 'base64' && typeof storageBucket?.createSignedUrl === 'function') {
    const signResult = await createSignedUrlWithRetry(storageBucket, media.storagePath);
    resolvedUrl = signResult.url;
    lastError = signResult.error;
  }

  // 2. Se for erro de arquivo inexistente (404/NoSuchKey), NÃO tenta download!
  if (isStorageNotFoundError(lastError)) {
    return { url: '', error: lastError };
  }

  // 3. Fallback de download apenas se createSignedUrl não estiver disponível ou para base64
  if (!resolvedUrl && typeof storageBucket?.download === 'function') {
    try {
      const { data, error } = await storageBucket.download(media.storagePath);
      if (error) {
        lastError = error;
        if (!isStorageNotFoundError(error)) {
          console.warn('Media download fallback:', error.message);
        }
        return { url: '', error: lastError };
      }
      if (data?.size) {
        if (media.encoding === 'base64') {
          const base64 = (await data.text()).trim();
          if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
            console.warn('Media download fallback: conteúdo Base64 inválido.');
            return { url: '', error: new Error('Base64 inválido') };
          }
          resolvedUrl = `data:${media.mimeType || 'application/octet-stream'};base64,${base64}`;
        } else {
          if (media.kind === 'image' && data.type && !String(data.type).startsWith('image/')) {
            console.warn('Media download fallback: arquivo não é uma imagem válida.', data.type || 'tipo ausente');
            return { url: '', error: new Error('Arquivo não é imagem') };
          }
          resolvedUrl = media.kind === 'image'
            ? await blobToDataUrl(data)
            : (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(data) : '');
        }
      }
    } catch (err) {
      lastError = err;
      console.warn('Media download fallback error:', err?.message || err);
    }
  }

  return { url: resolvedUrl, error: lastError };
}

export async function resolveSingleMediaUrl(media, supabase, { force = false } = {}) {
  if (!media?.bucket || !media?.storagePath || !supabase) return '';
  const key = `${media.bucket}:${media.storagePath}`;
  const epoch = mediaCacheEpoch;

  if (force) {
    invalidateMediaUrl(key);
  } else {
    const cached = mediaObjectUrlCache.get(key);
    if (cached) {
      if (typeof cached === 'string') return cached;
      if (cached.expiresAt > Date.now()) {
        if (cached.error) return '';
        return cached.url;
      }
      mediaObjectUrlCache.delete(key);
    }
  }

  let request = mediaUrlRequestCache.get(key);
  if (!request) {
    request = resolveStoredMediaUrl(media, supabase);
    mediaUrlRequestCache.set(key, request);
  }

  let result = null;
  try {
    result = await request;
  } finally {
    if (mediaUrlRequestCache.get(key) === request) mediaUrlRequestCache.delete(key);
  }
  if (epoch !== mediaCacheEpoch || invalidatedMediaRequests.has(request)) return '';

  const resolvedUrl = typeof result === 'string' ? result : (result?.url || '');
  const resultError = typeof result === 'object' ? result?.error : null;

  if (resolvedUrl) {
    const expiresAt = Date.now() + (SIGNED_URL_EXPIRES_IN - 300) * 1000;
    mediaObjectUrlCache.set(key, { url: resolvedUrl, expiresAt });
    return resolvedUrl;
  }

  if (resultError && isStorageNotFoundError(resultError)) {
    mediaObjectUrlCache.set(key, { url: '', error: true, code: 'not_found', expiresAt: Date.now() + NEGATIVE_CACHE_TTL_MS });
  }

  return '';
}

export async function enrichMediaUrls(events, supabase, { cacheOnly = false } = {}) {
  if (!Array.isArray(events) || !events.length || !supabase) return events || [];
  const targets = new Map();
  const epoch = mediaCacheEpoch;

  for (const event of events) {
    const payload = asObject(event?.raw_payload);
    const media = normalizeMedia(payload, event) || asObject(payload.media);
    if (media.status !== 'stored' || !media.bucket || !media.storagePath || isUsableBrowserUrl(media.url)) continue;
    if (String(event?.direction || '').toLowerCase() === 'outbound'
      && !isExplicitOutboundMedia(media, payload, event)) continue;
    targets.set(`${media.bucket}:${media.storagePath}`, media);
  }

  if (!targets.size) return events;

  const mediaUrls = new Map();
  await mapWithConcurrency([...targets.entries()], MEDIA_SIGNING_CONCURRENCY, async ([key, media]) => {
    if (epoch !== mediaCacheEpoch) return;
    const cached = mediaObjectUrlCache.get(key);
    const cachedUrl = typeof cached === 'string'
      ? cached
      : (cached && !cached.error && cached.expiresAt > Date.now() ? cached.url : null);
    if (cachedUrl) {
      mediaUrls.set(key, cachedUrl);
      return;
    }
    if (cached && cached.error && cached.expiresAt > Date.now()) {
      return;
    }
    if (cacheOnly) return;

    let request = mediaUrlRequestCache.get(key);
    if (!request) {
      request = resolveStoredMediaUrl(media, supabase);
      mediaUrlRequestCache.set(key, request);
    }
    let result = null;
    try {
      result = await request;
    } finally {
      if (mediaUrlRequestCache.get(key) === request) mediaUrlRequestCache.delete(key);
    }
    if (epoch !== mediaCacheEpoch || invalidatedMediaRequests.has(request)) return;

    const resolvedUrl = typeof result === 'string' ? result : (result?.url || '');
    const resultError = typeof result === 'object' ? result?.error : null;

    if (resolvedUrl) {
      const expiresAt = Date.now() + (SIGNED_URL_EXPIRES_IN - 300) * 1000;
      mediaObjectUrlCache.set(key, { url: resolvedUrl, expiresAt });
      mediaUrls.set(key, resolvedUrl);
    } else if (resultError && isStorageNotFoundError(resultError)) {
      mediaObjectUrlCache.set(key, { url: '', error: true, code: 'not_found', expiresAt: Date.now() + NEGATIVE_CACHE_TTL_MS });
    }
  });
  if (epoch !== mediaCacheEpoch) return events;

  return events.map((event) => {
    const payload = asObject(event?.raw_payload);
    const media = normalizeMedia(payload, event) || asObject(payload.media);
    const url = mediaUrls.get(`${media.bucket}:${media.storagePath}`);
    if (!url || getMediaUrlFromCache(media.bucket, media.storagePath) !== url) return event;
    const updatedPayload = {
      ...payload,
      media: { ...media, url, status: 'stored' },
      ...(payload.magia_operator ? {
        magia_operator: {
          ...payload.magia_operator,
          media: {
            ...asObject(payload.magia_operator.media),
            url,
            status: 'stored',
          },
        },
      } : {}),
    };
    return { ...event, raw_payload: updatedPayload };
  });
}

export function invalidateMediaUrl(bucketOrKey, storagePath) {
  if (!bucketOrKey) return;
  const key = storagePath ? `${bucketOrKey}:${storagePath}` : bucketOrKey;
  const pending = mediaUrlRequestCache.get(key);
  if (pending) invalidatedMediaRequests.add(pending);
  mediaObjectUrlCache.delete(key);
  mediaUrlRequestCache.delete(key);
}

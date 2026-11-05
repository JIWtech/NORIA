import { getMediaUrlFromCache, resolveSingleMediaUrl } from './mediaUrlService.js';

export function cachedViewerMediaUrl(media = {}, fallback = '') {
  if (media.src || fallback) return media.src || fallback;
  const cached = getMediaUrlFromCache(media.bucket, media.storagePath);
  return typeof cached === 'string' ? cached : '';
}

export async function resolveViewerMediaUrl(media = {}, client, fallback = '') {
  const known = cachedViewerMediaUrl(media, fallback);
  if (known) return known;
  if (!media.bucket || !media.storagePath) return '';
  // O contrato recebe o descritor e o cliente autenticado, não duas strings.
  return resolveSingleMediaUrl(media, client);
}

const RASTER_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
export function documentPreviewType(media = {}) {
  const mime = String(media.mimeType || '').split(';')[0].trim().toLowerCase();
  if (mime === 'application/pdf') return 'pdf';
  if (RASTER_TYPES.has(mime)) return 'image';
  if (mime === 'text/plain' || mime === 'text/csv') return 'text';
  // Uma extensão só complementa MIME ausente/genérico; nunca sobrepõe HTML/SVG.
  if (!mime || mime === 'application/octet-stream') {
    const ext = String(media.fileName || '').split('.').pop().toLowerCase();
    if (ext === 'pdf') return 'pdf';
    if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return 'image';
    if (['txt', 'csv'].includes(ext)) return 'text';
  }
  return null;
}

export const DOCUMENT_PREVIEW_LIMIT = 20 * 1024 * 1024;

// Lê em memória: Content-Disposition: attachment não força abrir o Windows.
// Limite também é aplicado ao stream, sem confiar apenas no Content-Length.
export async function loadDocumentPreview(src, media, signal) {
  const type = documentPreviewType(media);
  if (!type) throw new Error('PREVIEW_UNSUPPORTED');
  if (!/^https?:\/\//i.test(src) && !/^blob:/i.test(src)) throw new Error('PREVIEW_SOURCE_INVALID');
  const response = await fetch(src, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error('PREVIEW_UNAVAILABLE');
  if (Number(response.headers.get('content-length')) > DOCUMENT_PREVIEW_LIMIT) throw new Error('PREVIEW_TOO_LARGE');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > DOCUMENT_PREVIEW_LIMIT) throw new Error('PREVIEW_TOO_LARGE');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const blob = new Blob(chunks);
  if (type === 'pdf' && !(await blob.slice(0, 5).text()).startsWith('%PDF-')) throw new Error('PREVIEW_INVALID');
  // HTML nunca é inserido no DOM; texto é exibido por React com escaping.
  if (type === 'text') {
    const text = await blob.text();
    return { text: text.slice(0, 200000), truncated: text.length > 200000 };
  }
  return { blob: new Blob(chunks, { type: type === 'pdf' ? 'application/pdf' : media.mimeType || 'application/octet-stream' }) };
}

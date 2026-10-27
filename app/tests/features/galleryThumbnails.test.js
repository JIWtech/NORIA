import test from 'node:test';
import assert from 'node:assert/strict';
import { clearMediaUrlCache } from '../../src/services/media/mediaUrlService.js';

test('miniatura da foto aberta usa a mesma URL da imagem principal', async () => {
  const { readFileSync } = await import('node:fs');
  const { createRequire } = await import('node:module');
  const ts = (await import('typescript')).default;
  const file = new URL('../../src/features/conversations/components/MediaViewer.jsx', import.meta.url);
  const require = createRequire(file);
  const output = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)(require, module, module.exports);
  const React = require('react');
  const html = require('react-dom/server').renderToStaticMarkup(React.createElement(module.exports.MediaViewer, {
    src: 'https://example.org/primeira.jpg', onClose() {}, gallery: [
      { kind: 'image', bucket: 'channel-media', storagePath: 'tenant/primeira.jpg' },
      { kind: 'image', bucket: 'channel-media', storagePath: 'tenant/segunda.jpg' },
    ],
  }));
  assert.match(html.slice(html.indexOf('class="media-viewer-thumbnails"')), /<img[^>]+src="https:\/\/example.org\/primeira.jpg"/);
});

test('galeria resolve miniaturas que só têm bucket e storagePath usando o cliente autenticado', async () => {
  const { resolveViewerMediaUrl } = await import('../../src/services/media/viewerMediaUrl.js');
  clearMediaUrlCache();
  const signed = [];
  const client = { storage: { from(bucket) {
    assert.equal(bucket, 'channel-media');
    return { createSignedUrl: async path => {
      signed.push(path);
      return { data: { signedUrl: `https://storage.example/${path}` }, error: null };
    } };
  } } };
  const media = { bucket: 'channel-media', storagePath: 'tenant-a/chat/foto.jpg' };
  assert.equal(await resolveViewerMediaUrl(media, client), 'https://storage.example/tenant-a/chat/foto.jpg');
  assert.equal(await resolveViewerMediaUrl(media, client), 'https://storage.example/tenant-a/chat/foto.jpg');
  assert.deepEqual(signed, ['tenant-a/chat/foto.jpg']);
});

test('URL disponível é reutilizada e ausência de origem não repete a foto anterior', async () => {
  const { resolveViewerMediaUrl } = await import('../../src/services/media/viewerMediaUrl.js');
  assert.equal(await resolveViewerMediaUrl({ src: 'https://example.org/foto.jpg' }, null), 'https://example.org/foto.jpg');
  assert.equal(await resolveViewerMediaUrl({}, null, 'https://example.org/abertura.jpg'), 'https://example.org/abertura.jpg');
  assert.equal(await resolveViewerMediaUrl({}, null), '');
});

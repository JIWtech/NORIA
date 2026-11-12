import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  formatProductPrice,
  resolveVisualMediaCaption,
  suppressUnrecoverableVisualMedia,
  consecutiveImageGallery,
} from '../../src/features/conversations/utils/mediaPresentation.js';

const source = readFileSync(new URL('../../src/main.jsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../../src/app/App.jsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../../src/styles/components/media-viewer.css', import.meta.url), 'utf8');
const mediaMetaSource = readFileSync(new URL('../../src/features/conversations/components/MediaMeta.jsx', import.meta.url), 'utf8');
const mediaCaptionSource = readFileSync(new URL('../../src/features/conversations/components/MediaCaption.jsx', import.meta.url), 'utf8');
const mediaPresentationSource = readFileSync(new URL('../../src/features/conversations/utils/mediaPresentation.js', import.meta.url), 'utf8');
const mediaViewerSource = readFileSync(new URL('../../src/features/conversations/components/MediaViewer.jsx', import.meta.url), 'utf8');
const mediaAttachmentSource = readFileSync(new URL('../../src/features/conversations/components/MediaAttachment.jsx', import.meta.url), 'utf8')
  + readFileSync(new URL('../../src/features/conversations/components/DocumentAttachment.jsx', import.meta.url), 'utf8');
const conversationsSource = readFileSync(new URL('../../src/features/conversations/components/Conversations.jsx', import.meta.url), 'utf8');
const timelineSource = readFileSync(new URL('../../src/features/conversations/components/ConversationTimeline.jsx', import.meta.url), 'utf8');

test('media visual: imagem sem legenda usa o bloco de mídia e metadados sobrepostos', () => {
  assert.match(mediaMetaSource, /export function MediaMeta\(/);
  assert.match(mediaAttachmentSource, /<MediaMeta meta=\{meta\} overlay \/>/);
  assert.match(timelineSource, /<MediaAttachment/);
  assert.match(appSource, /<Conversations/);
  assert.match(styles, /\.bubble\.has-visual-media/);
  assert.match(styles, /\.bubble-meta\.is-media-overlay/);
});

test('media visual: legenda fica integrada abaixo da imagem ou do vídeo', () => {
  assert.match(mediaCaptionSource, /export function MediaCaption\(/);
  assert.match(mediaCaptionSource, /<MediaMeta meta=\{meta\} \/>/);
  assert.match(mediaPresentationSource, /export function resolveVisualMediaCaption\(/);
  assert.match(timelineSource, /resolveVisualMediaCaption\(message\.media, message\.text\)/);
  assert.match(mediaAttachmentSource, /<MediaCaption caption=\{caption\} meta=\{meta\} \/>/);
  assert.match(styles, /\.media-caption/);
});

test('viewer de imagem: abre em fit e disponibiliza zoom manual, reset, ESC e pan', () => {
  assert.match(mediaViewerSource, /export function MediaViewer\(/);
  assert.match(mediaAttachmentSource, /import\s+\{\s*MediaViewer\s*\}\s+from\s+['"]\.\/MediaViewer(?:\.jsx)?['"]/);
  assert.match(mediaViewerSource, /aria-label="Diminuir zoom"/);
  assert.match(mediaViewerSource, /aria-label="Aumentar zoom"/);
  assert.match(mediaViewerSource, /aria-label="Ajustar imagem à tela"/);
  assert.match(mediaViewerSource, /zoom === 1 \? 'Ajustar'/);
  assert.match(mediaViewerSource, /event\.key === 'Escape'/);
  assert.match(mediaViewerSource, /onPointerMove=\{handlePointerMove\}/);
  assert.match(mediaViewerSource, /Math\.min\(4, nextZoom\)/);
  assert.match(styles, /max-width: calc\(100vw - 144px\)/);
  assert.match(styles, /max-height: calc\(100vh - 108px\)/);
});

test('viewer: toolbar é chrome separado e não sobrepõe o stage da imagem', () => {
  assert.doesNotMatch(appSource, /<div className="media-viewer"/);
  assert.doesNotMatch(appSource, /: 'Foto'/);
  assert.doesNotMatch(styles, /\.media-viewer \{/);
  assert.match(styles, /\.media-viewer-backdrop \{[\s\S]*position: fixed;[\s\S]*inset: 0;/);
  assert.match(styles, /\.media-viewer-stage \{[\s\S]*position: absolute;[\s\S]*inset: 0;[\s\S]*align-items: center;[\s\S]*justify-content: center;/);
  assert.match(styles, /\.media-viewer-toolbar \{[\s\S]*position: fixed;[\s\S]*top: 16px;/);
});

test('viewer: imagens consecutivas do mesmo remetente formam galeria limitada', () => {
  assert.match(mediaPresentationSource, /export function consecutiveImageGallery\(/);
  assert.match(mediaPresentationSource, /sameGroup\(messages\[start - 1\]\)/);
  assert.match(mediaPresentationSource, /sameGroup\(messages\[end \+ 1\]\)/);
  assert.match(mediaAttachmentSource, /gallery=\{gallery\?\.items \|\| \[\]\}/);
  assert.match(mediaViewerSource, /activeIndex \+ 1\} \/ \{imageGallery\.length\}/);
});

test('viewer: teclado, limites, preload e troca de foto redefinem fit', () => {
  assert.match(mediaViewerSource, /event\.key === 'ArrowLeft' && canGoPrevious/);
  assert.match(mediaViewerSource, /event\.key === 'ArrowRight' && canGoNext/);
  assert.match(mediaViewerSource, /disabled=\{!canGoPrevious\}/);
  assert.match(mediaViewerSource, /disabled=\{!canGoNext\}/);
  assert.match(mediaViewerSource, /preload\(activeIndex - 1\)/);
  assert.match(mediaViewerSource, /preload\(activeIndex \+ 1\)/);
  assert.match(mediaViewerSource, /\[kind, activeIndex, activeMedia\.src, resetImage\]/);
});

test('vídeo: mantém controles inline e visualizador amplo pausa ao fechar', () => {
  assert.match(mediaAttachmentSource, /className="media-video" controls preload="metadata"/);
  assert.match(mediaAttachmentSource, /aria-label="Abrir vídeo ampliado"/);
  assert.match(mediaViewerSource, /videoRef\.current\.pause\(\)/);
  assert.match(mediaViewerSource, /className="media-viewer-video" controls autoPlay/);
});

test('mídias armazenadas e tela móvel mantêm limites seguros sem afetar o player de áudio', () => {
  assert.match(mediaAttachmentSource, /if \(kind === 'audio'\)[\s\S]*?<AudioMessagePlayer/);
  assert.match(styles, /max-width: 360px/);
  assert.match(styles, /max-height: 360px/);
  assert.match(styles, /@media \(max-width: 600px\)/);
});

test('MediaAttachment: modularizado e consumido em Conversations.jsx', () => {
  assert.match(mediaAttachmentSource, /export function MediaAttachment\(/);
  assert.match(conversationsSource, /import\s+\{\s*MediaAttachment\s*\}\s+from\s+['"]\.\/MediaAttachment(?:\.jsx)?['"]/);
  assert.doesNotMatch(conversationsSource, /function MediaAttachment\(/);
});

test('Conversations: modularizado e consumido em App.jsx', () => {
  assert.match(conversationsSource, /export function Conversations\(/);
  assert.match(appSource, /import\s+\{\s*Conversations\s*\}\s+from\s+['"]\.\.\/features\/conversations\/components\/Conversations['"]/);
  assert.doesNotMatch(appSource, /function Conversations\(/);
});

test('MediaAttachment: suporte estrutural a diferentes tipos de anexo (product, audio, image, video, document, fallback)', () => {
  assert.match(mediaAttachmentSource, /if \(!media\) return null;/);
  assert.match(mediaAttachmentSource, /REAL_MEDIA_KINDS\.has\(kind\)/);
  assert.match(mediaAttachmentSource, /if \(kind === 'product'\)\s*\{\s*return <ProductAttachment/);
  assert.match(mediaAttachmentSource, /<AudioRecoveryNotice state=/);
  assert.match(mediaAttachmentSource, /<AudioMessagePlayer media=\{media\}/);
  assert.match(mediaAttachmentSource, /<TranscribedAudioCard transcription=\{trans\}/);
  assert.match(mediaAttachmentSource, /className="media-image-skeleton"/);
  assert.match(mediaAttachmentSource, /Falha no carregamento/);
  assert.match(mediaAttachmentSource, /className="media-video"/);
  assert.match(mediaAttachmentSource, /<MediaViewer\s+kind="video"/);
  assert.match(mediaAttachmentSource, /<DocumentAttachment key={effectiveUrl} media={media}/);
  assert.match(mediaAttachmentSource, /formatFriendlyMimeType\(media\.mimeType, name\)/);
  assert.match(mediaAttachmentSource, /formatFileSize\(media\.size\)/);
  assert.match(mediaAttachmentSource, /className="media-placeholder media-download"/);
  assert.match(mediaAttachmentSource, /title="O arquivo original ainda não foi disponibilizado pelo canal"/);
});

/* ==========================================================================
   Comportamento dos helpers puros extraídos (mediaPresentation.js)
   ========================================================================== */

test('comportamento: formatProductPrice formata centavos em moeda BRL válida', () => {
  assert.strictEqual(formatProductPrice(19900).replace(/\s/g, ' '), 'R$ 199,00');
  assert.strictEqual(formatProductPrice(150000).replace(/\s/g, ' '), 'R$ 1.500,00');
  assert.strictEqual(formatProductPrice(0).replace(/\s/g, ' '), 'R$ 0,00');

  // Entradas inválidas retornam string vazia
  assert.strictEqual(formatProductPrice(-10), '');
  assert.strictEqual(formatProductPrice(NaN), '');
  assert.strictEqual(formatProductPrice(Infinity), '');
  assert.strictEqual(formatProductPrice('19900'), '');
  assert.strictEqual(formatProductPrice(null), '');
  assert.strictEqual(formatProductPrice(undefined), '');

  // Moeda customizada
  assert.match(formatProductPrice(1000, 'USD'), /10,00/);
});

test('comportamento: resolveVisualMediaCaption prioriza legenda e descarta placeholders técnicos', () => {
  // Imagem com legenda explícita
  assert.strictEqual(
    resolveVisualMediaCaption({ kind: 'image', caption: 'Foto do veículo' }, 'texto secundário'),
    'Foto do veículo'
  );

  // Vídeo com fallback no texto da mensagem
  assert.strictEqual(
    resolveVisualMediaCaption({ kind: 'video' }, 'Assista a demonstração'),
    'Assista a demonstração'
  );

  // Mídia não visual (ex: áudio ou documento) retorna string vazia
  assert.strictEqual(
    resolveVisualMediaCaption({ kind: 'audio', caption: 'Gravação' }, 'Áudio gravado'),
    ''
  );

  // Entradas nulas ou vazias
  assert.strictEqual(resolveVisualMediaCaption(null, null), '');
  assert.strictEqual(resolveVisualMediaCaption({}, ''), '');
});

test('mídia visual sem objeto persistido não cria um card enganoso no histórico', () => {
  assert.equal(suppressUnrecoverableVisualMedia({ kind: 'image', status: 'storage_error' }), true);
  assert.equal(suppressUnrecoverableVisualMedia({ kind: 'image', status: 'storage_error', storagePath: 'tenant/chat/file.jpg', bucket: 'channel-media' }), false);
  assert.equal(suppressUnrecoverableVisualMedia({ kind: 'image', status: 'stored', url: 'https://signed.example/image.jpg' }), false);
  assert.equal(suppressUnrecoverableVisualMedia({ kind: 'audio', status: 'storage_error' }), false);
});

test('comportamento: consecutiveImageGallery agrupa apenas imagens consecutivas do mesmo remetente', () => {
  const messages = [
    { id: 1, isAi: false, isAgent: false, media: { kind: 'image', url: 'https://img/1.jpg' }, text: 'Foto 1' },
    { id: 2, isAi: false, isAgent: false, media: { kind: 'image', url: 'https://img/2.jpg' }, text: 'Foto 2' },
    { id: 3, isAi: false, isAgent: true,  media: { kind: 'image', url: 'https://img/3.jpg' }, text: 'Resposta agente' },
    { id: 4, isAi: false, isAgent: false, text: 'Texto sem mídia' },
  ];

  // Índice 0: agrupa mensagens 0 e 1 (mesmo remetente 'contact')
  const gallery0 = consecutiveImageGallery(messages, 0);
  assert.strictEqual(gallery0.items.length, 2);
  assert.strictEqual(gallery0.index, 0);
  assert.strictEqual(gallery0.items[0].src, 'https://img/1.jpg');
  assert.strictEqual(gallery0.items[1].src, 'https://img/2.jpg');

  // Índice 1: mesmo grupo, posição relativa 1
  const gallery1 = consecutiveImageGallery(messages, 1);
  assert.strictEqual(gallery1.items.length, 2);
  assert.strictEqual(gallery1.index, 1);

  // Índice 2: mensagem do atendente, não agrupa com o contato
  const gallery2 = consecutiveImageGallery(messages, 2);
  assert.strictEqual(gallery2.items.length, 1);
  assert.strictEqual(gallery2.items[0].src, 'https://img/3.jpg');

  // Índice 3: texto puro sem mídia de imagem
  const gallery3 = consecutiveImageGallery(messages, 3);
  assert.strictEqual(gallery3.items.length, 0);
});

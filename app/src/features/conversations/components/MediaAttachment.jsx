import { DocumentAttachment } from './DocumentAttachment.jsx';
import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Loader2,
  Image as ImageIcon,
  Music2,
  Video,
  FileText,
  Sparkles,
  CircleDollarSign,
  Maximize2,
  ExternalLink,
} from 'lucide-react';
import { mediaDisplayLabel } from '../../../services/media/mediaPresentation.js';
import { ProductAttachment } from './ProductAttachment.jsx';
import { AudioRecoveryNotice } from './AudioRecoveryNotice.jsx';
import { TranscribedAudioCard } from './TranscribedAudioCard.jsx';
import { MediaCaption } from './MediaCaption.jsx';
import { MediaMeta } from './MediaMeta.jsx';
import { MediaViewer } from './MediaViewer.jsx';
import { AudioMessagePlayer } from '../../../components/AudioMessagePlayer.jsx';
import {
  REAL_MEDIA_KINDS,
  mediaSourceChanged,
  unavailableMediaLabel,
} from '../../../utils/audioUtils.js';
import {
  getMediaUrlFromCache,
  resolveSingleMediaUrl,
  invalidateMediaUrl,
} from '../../../services/media/mediaUrlService.js';
import { getAuthClient } from '../../../services/auth/authService.js';
import { isStorageNotFoundError } from '../../../services/media/storageErrors.js';

export function MediaAttachment({ media, audioTranscription, onMediaLoad, onRetry, caption = '', meta = null, gallery = null }) {
  if (!media) return null;
  const kind = String(media.kind || media.category || '').toLowerCase();
  if (!kind || kind === 'text' || kind === 'conversation' || kind === 'none' || !REAL_MEDIA_KINDS.has(kind)) {
    return null;
  }

  const [viewerKind, setViewerKind] = useState(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [processingTimedOut, setProcessingTimedOut] = useState(false);

  const [resolvedUrl, setResolvedUrl] = useState(() => {
    if (media.url) return media.url;
    if (media.bucket && media.storagePath) {
      const cached = getMediaUrlFromCache(media.bucket, media.storagePath);
      if (typeof cached === 'string') return cached;
    }
    return '';
  });

  const [isResolvingUrl, setIsResolvingUrl] = useState(false);
  const [isObjectNotFound, setIsObjectNotFound] = useState(() => {
    if (media.bucket && media.storagePath) {
      const cached = getMediaUrlFromCache(media.bucket, media.storagePath);
      return Boolean(cached && typeof cached === 'object' && cached.error);
    }
    return false;
  });
  const [resolveError, setResolveError] = useState(false);

  const effectiveUrl = media.url || resolvedUrl || '';

  // Sincroniza ou resolve URL automaticamente para mídias confirmadas (stored)
  useEffect(() => {
    if (media.url) {
      setResolvedUrl(media.url);
      setIsResolvingUrl(false);
      setResolveError(false);
      setIsObjectNotFound(false);
      return;
    }

    if (media.status === 'stored' && media.bucket && media.storagePath) {
      const cached = getMediaUrlFromCache(media.bucket, media.storagePath);
      if (typeof cached === 'string') {
        setResolvedUrl(cached);
        setIsResolvingUrl(false);
        setResolveError(false);
        setIsObjectNotFound(false);
        return;
      }
      if (cached && typeof cached === 'object' && cached.error) {
        setIsObjectNotFound(true);
        setIsResolvingUrl(false);
        setResolveError(false);
        return;
      }

      let isCurrent = true;
      setIsResolvingUrl(true);
      setResolveError(false);

      resolveSingleMediaUrl(media, getAuthClient())
        .then((url) => {
          if (!isCurrent) return;
          if (url) {
            setResolvedUrl(url);
            setResolveError(false);
            setIsObjectNotFound(false);
          } else {
            setResolveError(true);
          }
        })
        .catch((err) => {
          if (!isCurrent) return;
          if (isStorageNotFoundError(err)) {
            setIsObjectNotFound(true);
          } else {
            setResolveError(true);
          }
        })
        .finally(() => {
          if (isCurrent) setIsResolvingUrl(false);
        });

      return () => {
        isCurrent = false;
      };
    }
  }, [media.url, media.status, media.bucket, media.storagePath]);

  const handleRetryMedia = () => {
    if (media.bucket && media.storagePath) {
      invalidateMediaUrl(media.bucket, media.storagePath);
      setIsObjectNotFound(false);
      setResolveError(false);
      setImageError(false);
      setImageLoaded(false);
      setIsResolvingUrl(true);

      if (typeof onRetry === 'function') {
        onRetry();
      }

      resolveSingleMediaUrl(media, getAuthClient(), { force: true })
        .then((url) => {
          if (url) {
            setResolvedUrl(url);
            setResolveError(false);
            setIsObjectNotFound(false);
          } else {
            setResolveError(true);
          }
        })
        .catch((err) => {
          if (isStorageNotFoundError(err)) {
            setIsObjectNotFound(true);
          } else {
            setResolveError(true);
          }
        })
        .finally(() => {
          setIsResolvingUrl(false);
        });
    } else if (typeof onRetry === 'function') {
      onRetry();
    }
  };

  const imageSource = `${media.thumbnailUrl || effectiveUrl || ''}\u0000${effectiveUrl || ''}`;
  const previousImageSourceRef = useRef(imageSource);

  useEffect(() => {
    if (!mediaSourceChanged(previousImageSourceRef.current, imageSource)) return;
    previousImageSourceRef.current = imageSource;
    setImageError(false);
    setImageLoaded(false);
    setViewerKind(null);
  }, [imageSource]);

  const isStalePending = useMemo(() => {
    if (media.status !== 'pending') return false;
    const ts = media.createdAt || media.created_at || meta?.createdAt || meta?.created_at;
    if (!ts) return false;
    const parsed = Date.parse(ts);
    return Number.isFinite(parsed) && (Date.now() - parsed > 90_000);
  }, [media.status, media.createdAt, media.created_at, meta?.createdAt, meta?.created_at]);

  useEffect(() => {
    const isProcessing = (media.status === 'pending' && !isStalePending) || media.loadState === 'resolving' || isResolvingUrl;
    if (!isProcessing) {
      setProcessingTimedOut(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setProcessingTimedOut(true), 30_000);
    return () => window.clearTimeout(timer);
  }, [media.status, media.loadState, media.storagePath, isStalePending, isResolvingUrl]);

  const config = {
    image: { label: 'Imagem', icon: ImageIcon },
    audio: { label: 'Áudio', icon: Music2 },
    video: { label: 'Vídeo', icon: Video },
    document: { label: 'Documento', icon: FileText },
    sticker: { label: 'Figurinha', icon: Sparkles },
    product: { label: 'Produto', icon: CircleDollarSign },
  }[kind] || { label: 'Arquivo', icon: FileText };
  const Icon = config.icon;

  if (kind === 'product') {
    return <ProductAttachment media={media} caption={caption} meta={meta} />;
  }

  if (kind === 'audio') {
    if (effectiveUrl) {
      const canRetry = media.status === 'stored' && media.bucket && media.storagePath;
      const activeMedia = { ...media, url: effectiveUrl };
      return (
        <AudioMessagePlayer
          media={activeMedia}
          /* <AudioMessagePlayer media={media} */
          onLoad={onMediaLoad}
          onRetry={canRetry ? handleRetryMedia : undefined}
        />
      );
    }
    if (isObjectNotFound) {
      return <AudioRecoveryNotice state="missing_source" />;
    }
    if (isResolvingUrl || media.loadState === 'resolving') {
      return <AudioRecoveryNotice state="resolving" />;
    }
    if (media.status === 'stored' && media.bucket && media.storagePath) {
      if (resolveError || media.loadState === 'retryable_error') {
        return <AudioRecoveryNotice state="retryable_error" onRetry={handleRetryMedia} />;
      }
      return <AudioRecoveryNotice state="resolving" />;
    }
    if (processingTimedOut || isStalePending) {
      return <AudioRecoveryNotice state="missing_source" />;
    }
    if (media.status === 'pending') {
      return <AudioRecoveryNotice state="resolving" />;
    }
    if (['store_failed', 'storage_error', 'persistence_error', 'verification_failed', 'download_failed', 'missing_binary', 'too_large', 'skipped_too_large'].includes(media.status) || media.loadState === 'retryable_error') {
      return <AudioRecoveryNotice state="retryable_error" onRetry={media.bucket && media.storagePath ? handleRetryMedia : undefined} />;
    }
    const trans = audioTranscription || (media.transcription?.text ? media.transcription : null) || (media.transcript ? { text: media.transcript } : null);
    if (trans?.text) {
      return <TranscribedAudioCard transcription={trans} />;
    }
    return <AudioRecoveryNotice state="missing_source" />;
  }

  // Visual, documento ou outras mídias
  if (isResolvingUrl || ((media.status === 'pending' || media.loadState === 'resolving') && !processingTimedOut && !isStalePending)) {
    return (
      <div className="media-placeholder media-placeholder-loading" role="status" aria-live="polite">
        <Loader2 size={20} className="audio-spinner" aria-hidden="true" />
        <span>{isResolvingUrl ? `Carregando ${config.label.toLowerCase()}…` : `Preparando ${config.label.toLowerCase()}…`}</span>
      </div>
    );
  }

  if (isObjectNotFound) {
    return (
      <div className="media-placeholder" title="Arquivo não encontrado no armazenamento">
        <Icon size={20} />
        <span>{mediaDisplayLabel(media)}</span>
        <small>Arquivo não encontrado</small>
      </div>
    );
  }

  if (resolveError && media.status === 'stored' && media.bucket && media.storagePath && !effectiveUrl) {
    return (
      <div className="media-placeholder" title={`Não foi possível carregar ${config.label.toLowerCase()}`}>
        <Icon size={20} />
        <span>Não foi possível carregar {config.label.toLowerCase()}.</span>
        <button type="button" className="media-retry-button" onClick={handleRetryMedia}>
          Tentar novamente
        </button>
      </div>
    );
  }

  if (['store_failed', 'storage_error', 'persistence_error', 'download_failed', 'missing_binary', 'too_large', 'skipped_too_large', 'unavailable'].includes(media.status) || processingTimedOut || isStalePending) {
    const canRetry = media.status === 'stored' && Boolean(media.bucket && media.storagePath);
    return (
      <div className="media-placeholder" title={unavailableMediaLabel(kind)}>
        <Icon size={20} />
        <span>{unavailableMediaLabel(kind)}</span>
        {canRetry && (
          <button type="button" className="media-retry-button" onClick={handleRetryMedia}>
            Tentar novamente
          </button>
        )}
      </div>
    );
  }

  if ((kind === 'image' || kind === 'sticker') && effectiveUrl) {
    if (imageError) {
      const canRetry = media.status === 'stored' && Boolean(media.bucket && media.storagePath);
      return (
        <div className="media-placeholder" title="Não foi possível carregar a imagem original">
          <Icon size={20} />
          <span>{mediaDisplayLabel(media)}</span>
          <small>Falha no carregamento</small>
          {canRetry && (
            <button type="button" className="media-retry-button" onClick={handleRetryMedia}>
              Tentar novamente
            </button>
          )}
        </div>
      );
    }

    const hasRealCaption = Boolean(caption);
    const accessibleAlt = hasRealCaption ? caption : '';

    return (
      <div className={`media-message ${kind === 'sticker' ? 'is-sticker' : ''} ${hasRealCaption ? 'has-caption' : 'is-media-only'}`}>
        <button
          className={`media-image-button ${!imageLoaded ? 'is-loading' : ''}`}
          type="button"
          onClick={() => imageLoaded && setViewerKind(kind)}
          aria-label={hasRealCaption ? `Ampliar ${kind === 'sticker' ? 'figurinha' : 'imagem'}: ${accessibleAlt}` : `Ampliar ${kind === 'sticker' ? 'figurinha' : 'imagem'}`}
        >
          <div className={`media-image-container ${imageLoaded ? 'is-loaded' : ''}`}>
            {!imageLoaded && (
              <div className="media-image-skeleton" aria-hidden="true">
                <ImageIcon size={24} className="media-image-skeleton-icon" />
              </div>
            )}
            <img
              className={`media-image ${imageLoaded ? 'is-loaded' : 'is-loading'}`}
              src={media.thumbnailUrl || effectiveUrl}
              alt={accessibleAlt || (kind === 'sticker' ? 'Figurinha' : '')}
              decoding="async"
              onLoad={() => {
                setImageLoaded(true);
                if (typeof onMediaLoad === 'function') onMediaLoad();
              }}
              onError={() => {
                setImageError(true);
              }}
            />
          </div>
        </button>
        {hasRealCaption && <MediaCaption caption={caption} meta={meta} />}
        {!hasRealCaption && <MediaMeta meta={meta} overlay />}
        {viewerKind && <MediaViewer kind={viewerKind} src={effectiveUrl} alt={accessibleAlt || config.label} gallery={gallery?.items || []} initialIndex={gallery?.index || 0} onClose={() => setViewerKind(null)} />}
      </div>
    );
  }

  if (kind === 'video' && effectiveUrl) {
    return (
      <div className={`media-message media-video-message ${caption ? 'has-caption' : 'is-media-only'}`}>
        <div className="media-video-wrap">
          <video className="media-video" controls preload="metadata" poster={media.thumbnailUrl || undefined} src={effectiveUrl}>Seu navegador não suporta vídeo.</video>
          <button type="button" className="media-expand-button" aria-label="Abrir vídeo ampliado" onClick={() => setViewerKind('video')}><Maximize2 size={16} /></button>
          {!caption && <MediaMeta meta={meta} overlay />}
        </div>
        {caption && <MediaCaption caption={caption} meta={meta} />}
        {viewerKind && (
          <MediaViewer
            kind="video"
            src={effectiveUrl}
            poster={media.thumbnailUrl}
            alt="Vídeo"
            gallery={gallery?.items || []}
            initialIndex={gallery?.index || 0}
            onClose={() => setViewerKind(null)}
          />
        )}
      </div>
    );
  }

  if (kind === 'document') {
    return <DocumentAttachment key={effectiveUrl} media={media} src={effectiveUrl} onLoad={onMediaLoad} />;
  }

  // Fallback somente para mídias reais desconhecidas com URL
  if (effectiveUrl) {
    return (
      <a className="media-placeholder media-download" href={effectiveUrl} target="_blank" rel="noopener noreferrer">
        <Icon size={20} />
        <span>{mediaDisplayLabel(media)}</span>
        <ExternalLink size={15} />
      </a>
    );
  }

  return (
    <div className="media-placeholder" title="O arquivo original ainda não foi disponibilizado pelo canal">
      <Icon size={20} />
      <span>{mediaDisplayLabel(media)}</span>
      <small>Prévia indisponível</small>
    </div>
  );
}

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  Play,
  RotateCcw,
  RotateCw,
  Video,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { cachedViewerMediaUrl, resolveViewerMediaUrl } from '../../../services/media/viewerMediaUrl.js';
import { getAuthClient } from '../../../services/auth/authService.js';
import { shouldCloseMediaViewer } from '../utils/viewerInteractions.js';


// Cada origem mantém seu próprio resultado; uma troca nunca reutiliza a foto anterior.
function useViewerMediaUrl(media, fallback = '') {
  const key = JSON.stringify([media.src || '', media.bucket || '', media.storagePath || '', fallback]);
  const known = cachedViewerMediaUrl(media, fallback);
  const [result, setResult] = useState({ key, url: known, error: false });
  useEffect(() => {
    if (known) return undefined;
    let active = true;
    setResult({ key, url: '', error: false });
    resolveViewerMediaUrl(media, getAuthClient(), fallback)
      .then(url => { if (active) setResult({ key, url, error: !url }); })
      .catch(() => { if (active) setResult({ key, url: '', error: true }); });
    return () => { active = false; };
  }, [key, known]);
  return { url: known || (result.key === key ? result.url : ''), error: result.key === key && result.error };
}

function GalleryThumbnail({ item, fallback = '' }) {
  const isVideo = item.kind === 'video';
  const { url, error } = useViewerMediaUrl(isVideo ? { src: item.poster || '' } : { ...item, src: item.poster || item.src }, fallback);
  const [failedUrl, setFailedUrl] = useState('');
  if (url && failedUrl !== url) return <img src={url} alt="" loading="lazy" onError={() => setFailedUrl(url)} />;
  return <div className="media-viewer-thumb-fallback">
    {!url && !error && !isVideo ? <Loader2 size={16} className="media-viewer-spinner" /> : isVideo ? <Video size={16} /> : <ImageIcon size={16} />}
  </div>;
}

const EXTENSION_BY_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

export function MediaViewer({ kind = 'image', src, alt, poster, gallery = [], initialIndex = 0, onClose }) {
  const imageGallery = gallery.length ? gallery : [{ src, alt, kind, poster }];
  const [activeIndex, setActiveIndex] = useState(Math.max(0, Math.min(initialIndex, imageGallery.length - 1)));
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [loadState, setLoadState] = useState('loading');
  const dragRef = useRef(null);
  const dragMovedRef = useRef(false);
  const pointerStartedOnBackdropRef = useRef(false);
  const pointerStartRef = useRef({ x: 0, y: 0 });
  const touchStartRef = useRef(null);
  const videoRef = useRef(null);
  const stageRef = useRef(null);
  const dialogRef = useRef(null);
  const zoomRef = useRef(zoom);
  const positionRef = useRef(position);
  zoomRef.current = zoom;
  positionRef.current = position;

  const activeMedia = imageGallery[activeIndex] || { src, alt, kind, poster };
  const activeKind = String(activeMedia.kind || (activeIndex === initialIndex ? kind : 'image')).toLowerCase();
  const isCurrentImage = activeKind === 'image' || activeKind === 'sticker';
  const isCurrentVideo = activeKind === 'video';

  const canGoPrevious = activeIndex > 0;
  const canGoNext = activeIndex < imageGallery.length - 1;

  const { url: effectiveSrc, error: sourceError } = useViewerMediaUrl(activeMedia, activeIndex === initialIndex ? src : '');
  useEffect(() => { if (sourceError) setLoadState('error'); }, [sourceError]);

  const resetImage = useCallback(() => {
    setZoom(1);
    setRotation(0);
    setPosition({ x: 0, y: 0 });
  }, []);

  const closeViewer = useCallback(() => {
    if (videoRef.current) videoRef.current.pause();
    onClose();
  }, [onClose]);

  // Troca de mídia: volta ao ajuste à tela e pausa o vídeo anterior
  useEffect(() => {
    resetImage();
    setLoadState('loading');
    if (videoRef.current) {
      videoRef.current.pause();
    }
    return () => {
      if (videoRef.current) videoRef.current.pause();
    };
  }, [kind, activeIndex, activeMedia.src, resetImage]);

  // Foco no modal, fundo travado e foco devolvido ao fechar
  useEffect(() => {
    const previouslyFocused = typeof document !== 'undefined' ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, []);

  // Pré-carrega as imagens vizinhas
  useEffect(() => {
    if (typeof Image === 'undefined') return undefined;
    const preload = (index) => {
      const item = imageGallery[index];
      if (!item || item.kind === 'video' || !item.src) return;
      const image = new Image();
      image.src = item.src;
    };
    preload(activeIndex - 1);
    preload(activeIndex + 1);
    return undefined;
  }, [activeIndex, imageGallery]);

  // Zoom limitado entre 100% e 400%. Com `anchor`, aproxima em direção ao ponto
  // indicado (cursor), mantendo esse ponto parado na tela.
  const setImageZoom = useCallback((nextZoom, anchor = null) => {
    const currentZoom = zoomRef.current;
    const boundedZoom = Math.max(1, Math.min(4, nextZoom));
    const roundedZoom = Number(boundedZoom.toFixed(2));
    if (roundedZoom === 1) {
      setPosition({ x: 0, y: 0 });
    } else if (anchor && roundedZoom !== currentZoom) {
      const ratio = roundedZoom / currentZoom;
      const current = positionRef.current;
      setPosition({
        x: anchor.x - (anchor.x - current.x) * ratio,
        y: anchor.y - (anchor.y - current.y) * ratio,
      });
    }
    setZoom(roundedZoom);
  }, []);

  const anchorFromEvent = useCallback((event) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: event.clientX - (rect.left + rect.width / 2),
      y: event.clientY - (rect.top + rect.height / 2),
    };
  }, []);

  const rotate = useCallback((direction) => {
    setRotation((current) => (current + direction * 90 + 360) % 360);
  }, []);

  const navigate = useCallback((direction) => {
    setActiveIndex((index) => Math.max(0, Math.min(imageGallery.length - 1, index + direction)));
  }, [imageGallery.length]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') closeViewer();
      if (event.key === 'ArrowLeft' && canGoPrevious) setActiveIndex((index) => index - 1);
      if (event.key === 'ArrowRight' && canGoNext) setActiveIndex((index) => index + 1);
      if (isCurrentImage) {
        if (event.key === '+' || event.key === '=') setImageZoom(zoom + 0.25);
        if (event.key === '-' || event.key === '_') setImageZoom(zoom - 0.25);
        if (event.key === '0') resetImage();
        if (event.key === 'r' || event.key === 'R') rotate(event.shiftKey ? -1 : 1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canGoNext, canGoPrevious, closeViewer, zoom, resetImage, setImageZoom, isCurrentImage, rotate]);

  // Roda do mouse: listener nativo não passivo para impedir a rolagem da página
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !isCurrentImage) return undefined;
    const onWheel = (event) => {
      event.preventDefault();
      const step = event.deltaY < 0 ? 0.25 : -0.25;
      setImageZoom(zoomRef.current + step, anchorFromEvent(event));
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [isCurrentImage, setImageZoom, anchorFromEvent]);

  const handlePointerDown = (event) => {
    pointerStartedOnBackdropRef.current = event.target === event.currentTarget;
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
    dragMovedRef.current = false;
    if (!isCurrentImage || zoom <= 1) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      origin: position,
    };
    setIsDragging(true);
  };

  const handlePointerMove = (event) => {
    const dx = event.clientX - pointerStartRef.current.x;
    const dy = event.clientY - pointerStartRef.current.y;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
      dragMovedRef.current = true;
    }
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPosition({
      x: drag.origin.x + (event.clientX - drag.x),
      y: drag.origin.y + (event.clientY - drag.y),
    });
  };

  const stopDragging = (event) => {
    if (dragRef.current && event?.pointerId === dragRef.current.pointerId) {
      try {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      } catch {
        // ignore
      }
    }
    dragRef.current = null;
    setIsDragging(false);
  };

  const handleTouchStart = (event) => {
    if (event.touches.length === 1 && zoom === 1) {
      touchStartRef.current = {
        x: event.touches[0].clientX,
        y: event.touches[0].clientY,
        time: Date.now(),
      };
    }
  };

  const handleTouchEnd = (event) => {
    if (!touchStartRef.current) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - touchStartRef.current.x;
    const dy = touch.clientY - touchStartRef.current.y;
    const dt = Date.now() - touchStartRef.current.time;
    touchStartRef.current = null;
    if (dt < 400 && Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      if (dx < 0 && canGoNext) navigate(1);
      if (dx > 0 && canGoPrevious) navigate(-1);
    }
  };

  // Clique no fundo fecha; clique depois de arrastar não fecha
  const handleStageClick = (event) => {
    event.stopPropagation();
    const close = shouldCloseMediaViewer(event, {
      moved: dragMovedRef.current, startedOnBackdrop: pointerStartedOnBackdropRef.current,
    });
    dragMovedRef.current = false;
    if (close) closeViewer();
  };

  const handleStageDoubleClick = (event) => {
    // Com zoom, a captura do ponteiro redireciona o duplo clique ao palco.
    if (!isCurrentImage || loadState !== 'ready' || pointerStartedOnBackdropRef.current) return;
    event.stopPropagation();
    if (zoomRef.current > 1) setImageZoom(1);
    else setImageZoom(2.5, anchorFromEvent(event));
  };

  const handleDownload = async (event) => {
    event.stopPropagation();
    if (!effectiveSrc) return;
    try {
      const response = await fetch(effectiveSrc);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      const cleanName = (activeMedia.alt || alt || 'midia')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9_-]/g, '_')
        .replace(/_+/g, '_')
        .slice(0, 32);
      const extension = EXTENSION_BY_TYPE[blob.type] || (isCurrentVideo ? 'mp4' : 'jpg');
      a.download = `${cleanName || 'arquivo'}.${extension}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);
    } catch {
      window.open(effectiveSrc, '_blank', 'noopener,noreferrer');
    }
  };

  const handleOpenExternal = (event) => {
    event.stopPropagation();
    if (effectiveSrc) {
      window.open(effectiveSrc, '_blank', 'noopener,noreferrer');
    }
  };

  const mediaTitle = activeMedia.alt || alt || (isCurrentVideo ? 'Vídeo' : 'Imagem');
  const isTransformed = zoom !== 1 || rotation !== 0 || position.x !== 0 || position.y !== 0;

  const modal = (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="media-viewer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={isCurrentVideo ? 'Visualizador de vídeo' : 'Visualizador de imagem'}
      onClick={(event) => {
        if (shouldCloseMediaViewer(event, { moved: dragMovedRef.current })) closeViewer();
      }}
    >
      <header
        className="media-viewer-toolbar"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="media-viewer-info">
          <span className={`media-viewer-kind ${isCurrentVideo ? 'is-video' : ''}`} aria-hidden="true">
            {isCurrentVideo ? <Video size={15} /> : <ImageIcon size={15} />}
          </span>
          <div className="media-viewer-info-text">
            <span className="media-viewer-title" title={mediaTitle}>
              {activeMedia.senderLabel || mediaTitle}
            </span>
            <span className="media-viewer-subtitle">
              {activeMedia.formattedTime && <span>{activeMedia.formattedTime}</span>}
              {imageGallery.length > 1 && (
                <span className="media-viewer-counter">
                  {activeIndex + 1} / {imageGallery.length}
                </span>
              )}
            </span>
          </div>
        </div>

        <div className="media-viewer-actions">
          {isCurrentImage && (
            <div className="media-viewer-zoom-group">
              <button
                type="button"
                className="media-viewer-action-btn"
                aria-label="Diminuir zoom"
                title="Diminuir zoom (-)"
                onClick={() => setImageZoom(zoom - 0.25)}
                disabled={zoom <= 1}
              >
                <ZoomOut size={16} />
              </button>
              <button
                type="button"
                className="media-viewer-zoom-pill"
                aria-label="Alternar zoom entre ajuste à tela e 200%"
                title="Alternar entre ajuste à tela e 200%"
                onClick={() => (zoom > 1 ? setImageZoom(1) : setImageZoom(2))}
              >
                {zoom === 1 ? 'Ajustar' : `${Math.round(zoom * 100)}%`}
              </button>
              <button
                type="button"
                className="media-viewer-action-btn"
                aria-label="Aumentar zoom"
                title="Aumentar zoom (+ ou roda do mouse)"
                onClick={() => setImageZoom(zoom + 0.25)}
                disabled={zoom >= 4}
              >
                <ZoomIn size={16} />
              </button>
              <button
                type="button"
                className="media-viewer-action-btn"
                aria-label="Girar imagem"
                title="Girar 90° (R)"
                onClick={() => rotate(1)}
              >
                <RotateCw size={16} />
              </button>
              <button
                type="button"
                className="media-viewer-action-btn"
                aria-label="Ajustar imagem à tela"
                title="Ajustar à tela (0)"
                onClick={resetImage}
                disabled={!isTransformed}
              >
                <RotateCcw size={15} />
              </button>
              <span className="media-viewer-divider" role="separator" />
            </div>
          )}

          <button
            type="button"
            className="media-viewer-action-btn"
            aria-label="Baixar mídia"
            title="Baixar arquivo"
            onClick={handleDownload}
            disabled={!effectiveSrc}
          >
            <Download size={16} />
          </button>
          <button
            type="button"
            className="media-viewer-action-btn"
            aria-label="Abrir original em nova aba"
            title="Abrir em nova aba"
            onClick={handleOpenExternal}
            disabled={!effectiveSrc}
          >
            <ExternalLink size={16} />
          </button>
          <button
            type="button"
            className="media-viewer-action-btn media-viewer-close-btn"
            aria-label="Fechar visualizador"
            title="Fechar (ESC)"
            onClick={closeViewer}
          >
            <X size={18} />
          </button>
        </div>
      </header>

      <div
        ref={stageRef}
        className={`media-viewer-stage ${isCurrentImage ? 'is-image' : 'is-video'} ${zoom > 1 ? 'is-zoomed' : ''} ${isDragging ? 'is-dragging' : ''}`}
        onClick={handleStageClick}
        onDoubleClick={handleStageDoubleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {loadState === 'loading' && isCurrentImage && (
          <span className="media-viewer-loading" aria-live="polite">
            <Loader2 size={26} className="media-viewer-spinner" aria-hidden="true" />
            <span>Carregando imagem…</span>
          </span>
        )}

        {loadState === 'error' ? (
          <div className="media-viewer-error" role="alert" onClick={(event) => event.stopPropagation()}>
            <AlertTriangle size={22} aria-hidden="true" />
            <strong>Não foi possível exibir esta mídia</strong>
            <span>O arquivo pode ter expirado ou estar indisponível no momento.</span>
            {effectiveSrc && (
              <button type="button" className="media-viewer-error-btn" onClick={handleOpenExternal}>
                <ExternalLink size={14} /> Tentar abrir o original
              </button>
            )}
          </div>
        ) : isCurrentImage ? (
          <img
            key={effectiveSrc || activeIndex}
            className={`media-viewer-image ${zoom > 1 ? 'is-zoomed' : ''} ${loadState === 'ready' ? 'is-ready' : ''}`}
            src={effectiveSrc}
            alt={mediaTitle}
            draggable="false"
            onLoad={() => setLoadState('ready')}
            onError={() => setLoadState('error')}
            onClick={(event) => event.stopPropagation()}
            style={{
              transform: `translate(${position.x}px, ${position.y}px) scale(${zoom}) rotate(${rotation}deg)`,
            }}
          />
        ) : (
          <video
            key={effectiveSrc || activeIndex}
            ref={videoRef}
            className="media-viewer-video" controls autoPlay
            preload="metadata"
            poster={activeMedia.poster || poster || undefined}
            src={effectiveSrc}
            onLoadedData={() => setLoadState('ready')}
            onError={() => setLoadState('error')}
            onClick={(event) => event.stopPropagation()}
          >
            Seu navegador não suporta vídeo.
          </video>
        )}
      </div>

      {imageGallery.length > 1 && (
        <>
          <button
            type="button"
            className="media-viewer-nav media-viewer-nav-prev"
            aria-label="Mídia anterior"
            title="Anterior (seta esquerda)"
            disabled={!canGoPrevious}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              navigate(-1);
            }}
          >
            <ChevronLeft size={24} />
          </button>
          <button
            type="button"
            className="media-viewer-nav media-viewer-nav-next"
            aria-label="Próxima mídia"
            title="Próxima (seta direita)"
            disabled={!canGoNext}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              navigate(1);
            }}
          >
            <ChevronRight size={24} />
          </button>
        </>
      )}

      {activeMedia.caption && (
        <div
          className={`media-viewer-caption ${imageGallery.length > 1 ? 'has-thumbnails' : ''}`}
          aria-label="Legenda"
          onClick={(event) => event.stopPropagation()}
        >
          {activeMedia.caption}
        </div>
      )}

      {imageGallery.length > 1 && (
        <div
          className="media-viewer-thumbnails"
          role="tablist"
          aria-label="Miniaturas da galeria"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {imageGallery.map((item, idx) => {
            const isActive = idx === activeIndex;
            const isItemVideo = item.kind === 'video';
            return (
              <button
                key={item.id || item.src || idx}
                type="button"
                className={`media-viewer-thumb-btn ${isActive ? 'is-active' : ''} ${isItemVideo ? 'is-video-thumb' : ''}`}
                aria-label={`Ver ${isItemVideo ? 'vídeo' : 'imagem'} ${idx + 1}`}
                aria-selected={isActive}
                role="tab"
                onClick={(event) => {
                  event.stopPropagation();
                  setActiveIndex(idx);
                }}
              >
                <GalleryThumbnail item={item} fallback={idx === initialIndex && !isItemVideo ? src : ''} />
                {isItemVideo && (
                  <span className="media-viewer-thumb-play" aria-hidden="true">
                    <Play size={12} fill="currentColor" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {isCurrentImage && (
        <div className="media-viewer-hint" aria-hidden="true">
          <kbd>Roda</kbd> zoom no cursor
          <kbd>Arrastar</kbd> mover
          <kbd>R</kbd> girar
          {imageGallery.length > 1 && (<><kbd>← →</kbd> navegar</>)}
          <kbd>Esc</kbd> fechar
        </div>
      )}
    </div>
  );

  return typeof document !== 'undefined' && document.body ? createPortal(modal, document.body) : modal;
}

import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, FileText, Loader2, Maximize2, X } from 'lucide-react';
import { documentPreviewType, loadDocumentPreview } from '../../../services/media/documentPreview.js';
import { formatFriendlyMimeType, formatFileSize } from '../../../utils/audioUtils.js';
import '../../../styles/components/document-preview.css';

const PdfDocumentPreview = lazy(() => import('./PdfDocumentPreview.jsx'));

function DocumentDialog({ name, children, downloadUrl, onClose }) {
  const dialog = useRef(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.showModal();
    return () => {
      document.body.style.overflow = overflow;
      previousFocus?.focus?.({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <dialog ref={dialog} className="document-dialog" aria-label={`Documento: ${name}`}
      onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="document-dialog-panel">
        <header className="document-dialog-toolbar">
          <FileText size={20} aria-hidden="true" /><strong title={name}>{name}</strong>
          <a href={downloadUrl} download={name} className="document-icon-button" aria-label="Baixar documento"><Download size={19} /></a>
          <button type="button" className="document-icon-button" onClick={onClose} aria-label="Fechar documento" autoFocus><X size={22} /></button>
        </header>
        <div className="document-dialog-content">{children}</div>
      </section>
    </dialog>, document.body,
  );
}

export function DocumentAttachment({ media, src, onLoad }) {
  const name = media.fileName || 'Documento';
  const type = documentPreviewType(media);
  const [preview, setPreview] = useState(null);
  const [status, setStatus] = useState(src && type ? 'loading' : 'unsupported');
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const card = useRef(null);
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;

  useEffect(() => {
    if (!src || !type) return undefined;
    const controller = new AbortController();
    let objectUrl;
    let timer;
    let active = true;
    const load = async () => {
      setStatus('loading');
      timer = window.setTimeout(() => controller.abort(), 20000);
      try {
        const result = await loadDocumentPreview(src, media, controller.signal);
        if (!active) return;
        if (result.blob) objectUrl = URL.createObjectURL(result.blob);
        setPreview({ ...result, url: objectUrl });
        setStatus('ready');
        onLoadRef.current?.();
      } catch (error) {
        if (active) setStatus(error.message === 'PREVIEW_TOO_LARGE' ? 'large' : 'error');
      } finally { window.clearTimeout(timer); }
    };
    // Não carrega todos os documentos do histórico fora da área visível.
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); load(); }
    }, { rootMargin: '200px' });
    if (observer) observer.observe(card.current); else load();
    return () => {
      active = false;
      observer?.disconnect();
      window.clearTimeout(timer);
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, type, media.mimeType, media.fileName, attempt]);

  const content = (expanded = false) => {
    if (type === 'image') return <img src={preview.url} alt={name} />;
    if (type === 'text') return <><pre>{preview.text}</pre>{preview.truncated && <p className="pdf-document-status">Este texto é longo. A prévia mostra apenas o início.</p>}</>;
    return <Suspense fallback={<span className="pdf-document-status">Carregando PDF…</span>}>
      <PdfDocumentPreview src={preview.url} expanded={expanded} name={name} />
    </Suspense>;
  };
  const meta = [formatFriendlyMimeType(media.mimeType, name), formatFileSize(media.size)].filter(Boolean).join(' · ');
  return (
    <div ref={card} className="document-preview-card">
      {status === 'ready' ? (
        <div className="document-preview-page">
          <div className="document-preview-sheet" aria-hidden="true">{content()}</div>
          <button type="button" className="document-preview-open" onClick={() => setOpen(true)} aria-label={`Visualizar ${name}`}>
            <span><Maximize2 size={16} /> Visualizar documento</span>
          </button>
        </div>
      ) : (
        <div className="document-preview-notice" role="status">
          {status === 'loading' ? <><Loader2 size={24} className="audio-spinner" /><span>Carregando prévia…</span></>
            : <><FileText size={28} /><span>{status === 'error' ? 'Não foi possível carregar a prévia.'
              : status === 'large' ? 'Este arquivo é grande demais para a prévia.' : 'Prévia não disponível para este formato.'}</span>
              {status === 'error' && <button type="button" onClick={() => setAttempt(n => n + 1)}>Tentar novamente</button>}</>}
        </div>
      )}
      <div className="document-preview-footer">
        <FileText size={23} aria-hidden="true" />
        <div className="document-preview-info"><strong title={name}>{name}</strong><small>{meta || 'Documento'}</small></div>
        {src && <a className="document-icon-button" href={preview?.url || src} download={name} aria-label={`Baixar ${name}`}><Download size={19} /></a>}
      </div>
      {open && preview && <DocumentDialog name={name} downloadUrl={preview.url || src} onClose={() => setOpen(false)}>{content(true)}</DocumentDialog>}
    </div>
  );
}

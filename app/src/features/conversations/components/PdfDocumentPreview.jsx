import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, ZoomIn, ZoomOut } from 'lucide-react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

export default function PdfDocumentPreview({ src, expanded = false, name = 'Documento' }) {
  const container = useRef(null);
  const canvas = useRef(null);
  const [pdf, setPdf] = useState(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(300);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    let active = true;
    setStatus('loading');
    const task = getDocument({ url: src, isEvalSupported: false, enableXfa: false, useSystemFonts: true });
    task.promise.then(document => { if (active) { setPdf(document); setPage(1); } })
      .catch(error => { if (active) setStatus(error.name === 'PasswordException' ? 'password' : 'error'); });
    return () => { active = false; task.destroy(); };
  }, [src]);

  useEffect(() => {
    const observer = new ResizeObserver(entries => setWidth(Math.max(100, entries[0].contentRect.width - (expanded ? 32 : 0))));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [expanded]);

  useEffect(() => {
    if (!pdf) return undefined;
    let active = true;
    let renderTask;
    setStatus('loading');
    pdf.getPage(page).then(async pdfPage => {
      if (!active || !canvas.current) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const viewport = pdfPage.getViewport({ scale: Math.min(width * zoom / base.width, 4096 / Math.max(base.width, base.height)) });
      const outputScale = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(12000000 / (viewport.width * viewport.height)));
      const target = canvas.current;
      target.width = Math.max(1, Math.floor(viewport.width * outputScale));
      target.height = Math.max(1, Math.floor(viewport.height * outputScale));
      target.style.width = `${viewport.width}px`;
      target.style.height = `${viewport.height}px`;
      renderTask = pdfPage.render({ canvasContext: target.getContext('2d'), viewport,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0] });
      await renderTask.promise;
      if (active) setStatus('ready');
    }).catch(error => { if (active && error.name !== 'RenderingCancelledException') setStatus('error'); });
    return () => { active = false; renderTask?.cancel(); };
  }, [pdf, page, width, zoom]);

  return (
    <div ref={container} className={`pdf-document ${expanded ? 'is-expanded' : ''}`}>
      {expanded && pdf && <nav className="pdf-document-controls" aria-label="Páginas e zoom do documento">
        <button type="button" className="document-icon-button" disabled={page <= 1} onClick={() => setPage(n => n - 1)} aria-label="Página anterior"><ChevronLeft size={20} /></button>
        <span aria-live="polite">{page} / {pdf.numPages}</span>
        <button type="button" className="document-icon-button" disabled={page >= pdf.numPages} onClick={() => setPage(n => n + 1)} aria-label="Próxima página"><ChevronRight size={20} /></button>
        <button type="button" className="document-icon-button" disabled={zoom <= .5} onClick={() => setZoom(n => Math.max(.5, n - .25))} aria-label="Diminuir zoom"><ZoomOut size={18} /></button>
        <span>{Math.round(zoom * 100)}%</span>
        <button type="button" className="document-icon-button" disabled={zoom >= 2.5} onClick={() => setZoom(n => Math.min(2.5, n + .25))} aria-label="Aumentar zoom"><ZoomIn size={18} /></button>
      </nav>}
      {status === 'loading' && <span className="pdf-document-status" role="status"><Loader2 size={20} className="audio-spinner" /> Carregando página…</span>}
      {['error', 'password'].includes(status) && <p className="pdf-document-status" role="status">{status === 'password'
        ? 'Este PDF está protegido por senha.' : 'Não foi possível exibir este PDF. O arquivo pode estar danificado.'}</p>}
      <canvas ref={canvas} aria-label={`${name}, página ${page}`} role="img" hidden={status !== 'ready'} />
    </div>
  );
}

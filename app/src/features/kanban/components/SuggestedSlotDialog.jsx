import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { buildSuggestedSlot } from './suggestedSlot.js';
import './suggestedSlotDialog.css';

export function SuggestedSlotDialog({ busy, onClose, onSubmit, suggestionEnabled = false, timeZone }) {
  const [mode, setMode] = useState('ask');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [error, setError] = useState('');
  const dialogRef = useRef(null);

  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current?.focus();
    return () => previous?.focus();
  }, []);

  function keyDown(event) {
    if (event.key === 'Escape' && !busy) { event.stopPropagation(); onClose(); }
    if (event.key !== 'Tab') return;
    const controls = [...dialogRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled)')];
    if (!controls.length) return;
    if (event.shiftKey && (document.activeElement === controls[0] || document.activeElement === dialogRef.current)) {
      event.preventDefault(); controls[controls.length - 1].focus();
    } else if (!event.shiftKey && document.activeElement === controls[controls.length - 1]) {
      event.preventDefault(); controls[0].focus();
    }
  }

  function submit(event) {
    event.preventDefault();
    try { setError(''); onSubmit(buildSuggestedSlot(mode, date, time, suggestionEnabled, { timeZone })); }
    catch (failure) { setError(failure.message); }
  }

  return createPortal(
    <div className="modal-backdrop" role="presentation" onClick={(event) => { event.stopPropagation(); if (!busy) onClose(); }}>
      <form ref={dialogRef} tabIndex={-1} className="modal-panel confirm-modal-panel suggested-slot-dialog" role="dialog" aria-modal="true" aria-labelledby="suggested-slot-title" onKeyDown={keyDown} onClick={(event) => event.stopPropagation()} onSubmit={submit}>
        <div className="confirm-modal-header">
          <h3 id="suggested-slot-title" className="modal-title">Sugerir outro horário</h3>
          <button className="icon-button modal-close-btn" type="button" onClick={onClose} disabled={busy} aria-label="Fechar"><X size={18} /></button>
        </div>
        <div className="confirm-modal-body suggested-slot-body">
          <p className="confirm-modal-desc">O horário solicitado não está disponível. Como deseja continuar?</p>
          {suggestionEnabled ? <label className="suggested-slot-option"><input type="radio" name="suggested-slot-mode" checked={mode === 'ask'} onChange={() => { setMode('ask'); setError(''); }} disabled={busy} /><span><strong>Pedir outro horário</strong><small>A pessoa informa uma nova opção.</small></span></label> : <p>A pessoa será avisada de que o horário não está disponível e poderá informar outra opção. A IA continua o atendimento.</p>}
          {suggestionEnabled && <label className="suggested-slot-option"><input type="radio" name="suggested-slot-mode" checked={mode === 'propose'} onChange={() => { setMode('propose'); setError(''); }} disabled={busy} /><span><strong>Propor um horário</strong><small>Informe dia e horário; a IA escreve a oferta.</small></span></label>}
          {suggestionEnabled && mode === 'propose' && <div className="suggested-slot-fields">
            <label>Data<input type="date" value={date} onChange={(event) => setDate(event.target.value)} required disabled={busy} /></label>
            <label>Hora<input type="time" value={time} onChange={(event) => setTime(event.target.value)} required disabled={busy} /></label>
          </div>}
          {error && <div className="inline-error confirm-error" role="alert">{error}</div>}
        </div>
        <div className="confirm-modal-footer">
          <button type="button" className="secondary-button confirm-cancel-btn" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="submit" className="primary-button" disabled={busy}>{busy ? 'Enviando...' : 'Enviar'}</button>
        </div>
      </form>
    </div>, document.body,
  );
}

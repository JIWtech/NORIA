import React, { useEffect, useState } from 'react';
import { AlertCircle, RefreshCcw, Send, UserX, X } from 'lucide-react';
import { sendN8nCommand } from '../../../services/integration.js';
import { loadServiceCatalog, markAppointmentOutcome } from '../../../services/appointments/outcomeActions.js';
import { buildNoShowPreview, sendNoShowMessageThenMark } from '../../../services/appointments/noShowMessage.js';

// "Cliente não veio" com mensagem: prévia editável enviada só no clique em Enviar.
// A mensagem sai antes do registro da falta (ver sendNoShowMessageThenMark).
export function NoShowMessageDialog({ appointment, tenantSlug, tenantSettings, sentBy, onClose, onDone }) {
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [warnings, setWarnings] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [messageSent, setMessageSent] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadServiceCatalog(tenantSlug).then((catalog) => {
      if (!active) return;
      const preview = buildNoShowPreview(appointment, { catalog, tenantSettings });
      setText(preview.text);
      setWarnings(preview.warnings);
      setLoading(false);
    });
    return () => { active = false; };
  }, [appointment, tenantSlug, tenantSettings]);

  async function sendAndMark() {
    if (busy) return;
    setBusy('send');
    setError('');
    try {
      await sendNoShowMessageThenMark({ appointment, text, tenantSlug, sentBy, sendCommand: sendN8nCommand, markOutcome: markAppointmentOutcome });
      await onDone?.('Mensagem enviada e falta registrada. A conversa foi encerrada.');
    } catch (failure) {
      if (failure?.messageSent) setMessageSent(true);
      setError(failure?.message || 'Não foi possível concluir.');
    } finally {
      setBusy('');
    }
  }

  async function markOnly() {
    if (busy) return;
    setBusy('mark');
    setError('');
    try {
      await markAppointmentOutcome(appointment.id, 'no_show');
      await onDone?.(messageSent ? 'Falta registrada. A mensagem já tinha sido enviada.' : 'Falta registrada e conversa encerrada, sem mensagem.');
    } catch (failure) {
      setError(failure?.message || 'Não foi possível registrar a falta.');
    } finally {
      setBusy('');
    }
  }

  const close = () => { if (!busy) onClose?.(); };

  return (
    <div className="modal-backdrop" onClick={close} role="presentation">
      <div
        className="modal-panel confirm-modal-panel no-show-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="no-show-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="confirm-modal-header">
          <div className="confirm-modal-title-row">
            <div className="confirm-danger-icon" aria-hidden="true"><UserX size={20} /></div>
            <h3 id="no-show-dialog-title" className="modal-title">Cliente não veio</h3>
          </div>
          <button className="icon-button modal-close-btn" type="button" onClick={close} disabled={Boolean(busy)} aria-label="Fechar" title="Fechar">
            <X size={18} />
          </button>
        </div>

        <div className="confirm-modal-body">
          <p className="confirm-modal-desc">
            {messageSent
              ? 'A mensagem já foi enviada. Falta só registrar a falta.'
              : 'Revise a mensagem para a cliente. Ela só é enviada quando você clicar em Enviar. Depois a falta é registrada e a conversa, encerrada.'}
          </p>
          {loading ? (
            <p className="confirm-modal-desc"><RefreshCcw size={14} className="spin" /> Calculando o sinal...</p>
          ) : (
            <>
              <label className="textarea-label no-show-dialog-message">
                <span className="appointment-label-text">Mensagem</span>
                <textarea value={text} onChange={(event) => setText(event.target.value)} rows={7} disabled={messageSent || Boolean(busy)} />
              </label>
              {warnings.map((warning) => (
                <div className="no-show-dialog-warning" key={warning}><AlertCircle size={14} aria-hidden="true" /> <span>{warning}</span></div>
              ))}
            </>
          )}
          {error && <div className="inline-error confirm-error">{error}</div>}
        </div>

        <div className="confirm-modal-footer no-show-dialog-footer">
          <button type="button" className="secondary-button confirm-cancel-btn" onClick={close} disabled={Boolean(busy)}>Cancelar</button>
          <button type="button" className="secondary-button" onClick={markOnly} disabled={Boolean(busy) || loading}>
            {busy === 'mark' ? 'Registrando...' : messageSent ? 'Registrar falta' : 'Registrar sem mensagem'}
          </button>
          {!messageSent && (
            <button type="button" className="primary-button" onClick={sendAndMark} disabled={Boolean(busy) || loading || !text.trim()}>
              <Send size={15} /> {busy === 'send' ? 'Enviando...' : 'Enviar'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

import React, { useState } from 'react';
import { CalendarCheck, X } from 'lucide-react';
import { updateAppointment } from '../../../services/appointments/outcomeActions.js';
import { appointmentEditDraft, buildAppointmentUpdate } from '../../../services/appointments/appointmentActions.js';

// Edição de agendamento pelo painel. Não avisa a cliente.
export function AppointmentEditDialog({ appointment, timeZone, onClose, onDone }) {
  const [draft, setDraft] = useState(() => {
    const initial = appointmentEditDraft(appointment, { timeZone });
    return { ...initial, servicesText: initial.services.join(' + ') };
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key) => (event) => setDraft((current) => ({ ...current, [key]: event.target.value }));

  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setError('');
    let changes;
    try {
      const services = draft.servicesText.split(/\s*\+\s*|\s*,\s*/);
      changes = buildAppointmentUpdate(appointment, { ...draft, services }, { timeZone });
    } catch (failure) {
      setError(failure.message);
      return;
    }
    if (!Object.keys(changes).length) { onClose?.(); return; }
    setBusy(true);
    try {
      await updateAppointment(appointment.id, changes);
      await onDone?.('Agendamento atualizado. A cliente não foi avisada.');
    } catch (failure) {
      setError(failure.message || 'Não foi possível salvar o agendamento.');
    } finally {
      setBusy(false);
    }
  }

  const close = () => { if (!busy) onClose?.(); };

  return (
    <div className="modal-backdrop" onClick={close} role="presentation">
      <form
        className="modal-panel confirm-modal-panel appointment-edit-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="appointment-edit-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={save}
      >
        <div className="confirm-modal-header">
          <div className="confirm-modal-title-row">
            <h3 id="appointment-edit-title" className="modal-title">Editar agendamento</h3>
          </div>
          <button className="icon-button modal-close-btn" type="button" onClick={close} disabled={busy} aria-label="Fechar" title="Fechar">
            <X size={18} />
          </button>
        </div>
        <div className="confirm-modal-body form-grid">
          <p className="confirm-modal-desc">{appointment.contactName || 'Cliente'} · a cliente não é avisada da alteração.</p>
          <div className="form-row-two">
            <label className="appointment-field-label"><span className="appointment-label-text">Data</span>
              <input type="date" value={draft.date} onChange={set('date')} required /></label>
            <label className="appointment-field-label"><span className="appointment-label-text">Hora</span>
              <input type="time" value={draft.time} onChange={set('time')} required /></label>
          </div>
          <label className="appointment-field-label"><span className="appointment-label-text">Serviços (separe com +)</span>
            <input value={draft.servicesText} onChange={set('servicesText')} placeholder="Ex: Corte + Escova" required /></label>
          <label className="appointment-field-label"><span className="appointment-label-text">Profissional</span>
            <input value={draft.professional} onChange={set('professional')} placeholder="Opcional" /></label>
          <label className="textarea-label appointment-field-label"><span className="appointment-label-text">Observações</span>
            <textarea value={draft.notes} onChange={set('notes')} rows={3} /></label>
          {error && <div className="inline-error confirm-error">{error}</div>}
        </div>
        <div className="confirm-modal-footer">
          <button type="button" className="secondary-button confirm-cancel-btn" onClick={close} disabled={busy}>Cancelar</button>
          <button type="submit" className="primary-button" disabled={busy}><CalendarCheck size={15} /> {busy ? 'Salvando...' : 'Salvar'}</button>
        </div>
      </form>
    </div>
  );
}

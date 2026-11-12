import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useModalDialog } from '../../../utils/useModalDialog.js';

export function AppointmentConfirmDialog({ title, message, confirmLabel, onClose, onConfirm }) {
  const { dialogProps } = useModalDialog({ onClose });
  return createPortal(<div className="modal-backdrop" onClick={onClose} role="presentation">
    <div {...dialogProps} className="modal-panel confirm-modal-panel" role="dialog" aria-modal="true" aria-labelledby="appointment-confirm-title" onClick={(event) => event.stopPropagation()}>
      <div className="confirm-modal-header">
        <div className="confirm-modal-title-row"><h3 id="appointment-confirm-title" className="modal-title">{title}</h3></div>
        <button className="icon-button modal-close-btn" type="button" onClick={onClose} aria-label="Fechar"><X size={18} /></button>
      </div>
      <div className="confirm-modal-body"><p className="confirm-modal-desc">{message}</p></div>
      <div className="confirm-modal-footer"><button type="button" className="secondary-button confirm-cancel-btn" onClick={onClose}>Voltar</button><button type="button" className="primary-button" onClick={onConfirm}>{confirmLabel}</button></div>
    </div>
  </div>, document.body);
}

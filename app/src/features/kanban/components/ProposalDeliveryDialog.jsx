import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import './suggestedSlotDialog.css';

export function ProposalDeliveryDialog({ busy, onClose, onSubmit, knownMessageId = '' }) {
  const [messageId, setMessageId] = useState('');

  return createPortal(
    <div className="modal-backdrop" role="presentation" onClick={() => { if (!busy) onClose(); }}>
      <div className="modal-panel confirm-modal-panel proposal-delivery-dialog" role="dialog" aria-modal="true" aria-labelledby="proposal-delivery-title" onClick={(event) => event.stopPropagation()}>
        <div className="confirm-modal-header">
          <h3 id="proposal-delivery-title" className="modal-title">Conferir proposta de horário</h3>
          <button type="button" className="icon-button modal-close-btn" aria-label="Fechar" onClick={onClose} disabled={busy}><X size={18} /></button>
        </div>
        <div className="confirm-modal-body">
          <p className="confirm-modal-desc">O envio da proposta não foi confirmado. Confira a conversa no WhatsApp: se a mensagem da proposta aparece lá, ela foi entregue.</p>
          {knownMessageId ? (
            <p className="confirm-modal-desc">O envio já devolveu o identificador da mensagem; não é preciso digitar nada.</p>
          ) : (
            <label className="textarea-label no-show-dialog-message">
              <span className="appointment-label-text">ID da mensagem (opcional)</span>
              <input value={messageId} onChange={(event) => setMessageId(event.target.value)} disabled={busy} placeholder="Deixe em branco se não tiver o ID" />
              <small>Sem o ID, a entrega é registrada com o seu usuário e a mensagem é reconhecida pelo texto.</small>
            </label>
          )}
        </div>
        <div className="confirm-modal-footer no-show-dialog-footer">
          <button type="button" className="secondary-button confirm-cancel-btn" onClick={onClose} disabled={busy}>Voltar</button>
          <button type="button" className="secondary-button" onClick={() => onSubmit('not_delivered')} disabled={busy}>Não foi entregue</button>
          <button type="button" className="primary-button" onClick={() => onSubmit('delivered', knownMessageId ? '' : messageId.trim())} disabled={busy}>Foi entregue</button>
        </div>
      </div>
    </div>, document.body,
  );
}

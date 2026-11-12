import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Ban, Send, X } from 'lucide-react';
import { cancelAppointment } from '../../../services/appointments/outcomeActions.js';
import { sendN8nCommand } from '../../../services/integration.js';
import { canNotifyCancellation, cancelAndNotify, noticeState, reconcileNotice } from './cancellationFlow.js';

export function AppointmentCancelDialog({ appointment, tenantSlug, onClose, onDone }) {
  const alreadyCancelled = appointment?.status === 'cancelled';
  const storedReason = String(appointment?.raw?.metadata?.cancel_reason || '');
  const [reason, setReason] = useState(alreadyCancelled ? storedReason : '');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [cancelled, setCancelled] = useState(alreadyCancelled);
  // Aviso com entrega incerta (ou preso em envio): a equipe confere no WhatsApp e informa o resultado, sem reenvio.
  const [checking, setChecking] = useState(() => noticeState(appointment?.raw?.metadata).canReconcile);
  const canNotify = canNotifyCancellation(appointment);
  const close = () => { if (!busy) { if (cancelled && !alreadyCancelled) onDone?.(checking ? 'Agendamento cancelado. A entrega do aviso está incerta: confira no WhatsApp.' : 'Agendamento cancelado. O envio do aviso não foi confirmado.'); else onClose?.(); } };

  async function submit(notify) {
    if (busy) return;
    setBusy(notify ? 'send' : 'cancel');
    setError('');
    let outcome = null;
    try {
      if (notify) {
        outcome = await cancelAndNotify({ appointment, tenantSlug, reason, cancel: cancelAppointment, send: sendN8nCommand, alreadyCancelled: cancelled });
        setCancelled(true);
      } else {
        if (!cancelled) await cancelAppointment(appointment.id, reason);
        setCancelled(true);
      }
    } catch (failure) {
      if (failure?.cancelled) setCancelled(true);
      if (failure?.noticeUncertain) setChecking(true);
      setError(failure?.message || 'Não foi possível cancelar o agendamento.');
      setBusy('');
      return;
    }
    setBusy('');
    if (!notify) { await onDone?.('Agendamento cancelado sem aviso.'); return; }
    await onDone?.(outcome?.alreadySent
      ? 'Agendamento cancelado. O aviso já havia sido enviado antes; nenhuma mensagem nova foi enviada.'
      : 'Agendamento cancelado e aviso enviado pela IA.');
  }

  async function conferNotice(resolution) {
    if (busy) return;
    setBusy('check');
    setError('');
    try {
      await reconcileNotice({ appointment, tenantSlug, reason, resolution, send: sendN8nCommand });
    } catch (failure) {
      setError(failure?.message || 'Não foi possível registrar a conferência.');
      setBusy('');
      return;
    }
    setBusy('');
    if (resolution === 'delivered') { await onDone?.('Aviso de cancelamento registrado como entregue.'); return; }
    setChecking(false);
    setError('Registrado como não entregue. Você pode pedir o envio da IA de novo.');
  }

  return createPortal(
    <div className="modal-backdrop" onClick={close} role="presentation">
      <div className="modal-panel confirm-modal-panel no-show-dialog" role="dialog" aria-modal="true" aria-labelledby="cancel-appointment-title" onClick={(event) => event.stopPropagation()}>
        <div className="confirm-modal-header">
          <div className="confirm-modal-title-row"><div className="confirm-danger-icon" aria-hidden="true"><Ban size={20} /></div><h3 id="cancel-appointment-title" className="modal-title">{alreadyCancelled ? 'Conferir aviso de cancelamento' : 'Cancelar agendamento'}</h3></div>
          <button className="icon-button modal-close-btn" type="button" onClick={close} disabled={Boolean(busy)} aria-label="Fechar"><X size={18} /></button>
        </div>
        <div className="confirm-modal-body">
          <p className="confirm-modal-desc">{cancelled ? 'O agendamento já foi cancelado.' : `Cancelar o agendamento de ${appointment.contactName || 'Cliente'}?`}</p>
          {checking ? (
            <p className="confirm-modal-desc">Não foi possível comprovar a entrega do aviso. Veja na conversa do WhatsApp se a mensagem chegou e informe o resultado. Nada será reenviado por esta conferência.</p>
          ) : canNotify ? <p className="confirm-modal-desc">Se optar pelo aviso, informe o motivo. A IA redigirá a mensagem com base nele e enviará pelo WhatsApp sem transferir a conversa para atendimento humano.</p> : <p className="confirm-modal-desc">Não há conversa de WhatsApp vinculada para enviar o aviso.</p>}
          <label className="textarea-label no-show-dialog-message"><span className="appointment-label-text">Motivo do cancelamento {canNotify ? '(obrigatório para avisar)' : '(opcional)'}</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={4} disabled={Boolean(busy) || cancelled} placeholder="Explique o motivo do cancelamento" /></label>
          {error && <div className="inline-error confirm-error" role="alert">{error}</div>}
        </div>
        <div className="confirm-modal-footer no-show-dialog-footer">
          <button type="button" className="secondary-button confirm-cancel-btn" onClick={close} disabled={Boolean(busy)}>Voltar</button>
          {checking ? (
            <>
              <button type="button" className="secondary-button" onClick={() => conferNotice('not_delivered')} disabled={Boolean(busy)}>Não chegou</button>
              <button type="button" className="primary-button" onClick={() => conferNotice('delivered')} disabled={Boolean(busy)}>{busy === 'check' ? 'Registrando...' : 'Chegou'}</button>
            </>
          ) : (
            <>
              {!cancelled && <button type="button" className="secondary-button" onClick={() => submit(false)} disabled={Boolean(busy)}>{busy === 'cancel' ? 'Cancelando...' : 'Cancelar sem avisar'}</button>}
              {canNotify && <button type="button" className="primary-button" onClick={() => submit(true)} disabled={Boolean(busy) || !reason.trim()}><Send size={15} /> {busy === 'send' ? 'A IA está enviando...' : cancelled ? 'Tentar envio da IA' : 'Cancelar e avisar pela IA'}</button>}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

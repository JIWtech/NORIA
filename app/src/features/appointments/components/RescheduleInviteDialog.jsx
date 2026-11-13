import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { sendN8nCommand } from '../../../services/integration.js';
import { appointmentServicesLabel } from '../../../services/appointments/appointmentAgenda.js';
import { useModalDialog } from '../../../utils/useModalDialog.js';

export function RescheduleInviteDialog({ appointment, tenantSlug, now, onClose, onDone }) {
  const invitation = appointment.raw.metadata.reschedule_invite;
  const services = appointmentServicesLabel(appointment);
  const [text, setText] = useState(
    `Olá! Quer que a gente veja outro horário para ${services}, para ${appointment.contactName}? Se quiser, me diga quais dias e horários funcionam melhor.`,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempted, setAttempted] = useState(false);
  const inFlight = useRef(false);
  const close = () => { if (!inFlight.current) onClose(); };
  const { dialogProps } = useModalDialog({ onClose: close });
  const canCheck = invitation?.state === 'uncertain'
    || (invitation?.state === 'sending' && now - Date.parse(invitation.at) >= 120000);
  const canSend = !invitation?.state || invitation.state === 'not_delivered';

  async function submit(resolution) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await sendN8nCommand('invite_appointment_reschedule', {
        appointment_id: appointment.id,
        channel_type: appointment.channelType,
        external_conversation_id: appointment.externalConversationId,
        ...(resolution ? { invite_resolution: resolution } : { message_text: text.trim() }),
      }, tenantSlug);
      if (result?.ok !== true) throw new Error('Envio sem confirmação.');
      await onDone(resolution === 'not_delivered' ? 'Conferência registrada. Você pode tentar novamente.'
        : result.event_warning ? 'Convite registrado. O histórico da conversa ainda precisa ser sincronizado.'
          : 'Convite para remarcar enviado.');
    } catch (failure) {
      setAttempted(true);
      setError(failure.message || 'Não foi possível confirmar o envio.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return createPortal(<div className="modal-backdrop" onClick={close} role="presentation">
    <div {...dialogProps} className="modal-panel confirm-modal-panel no-show-dialog" role="dialog"
      aria-modal="true" aria-labelledby="reschedule-invite-title" onClick={event => event.stopPropagation()}>
      <div className="confirm-modal-header">
        <h3 id="reschedule-invite-title" className="modal-title">Convidar para remarcar</h3>
      </div>
      <div className="confirm-modal-body">
        <p>{appointment.contactName} · {services}</p>
        {canSend && <label className="textarea-label no-show-dialog-message">
          Mensagem
          <textarea value={text} onChange={event => setText(event.target.value)} rows={5} maxLength={1000} disabled={busy || attempted} />
        </label>}
        {canCheck && <p>Confira o histórico no WhatsApp antes de registrar o resultado do envio.</p>}
        {!canCheck && !canSend && <p>Envio em andamento. Atualize o painel para consultar o resultado.</p>}
        {error && <p className="inline-error confirm-error" role="alert">{error}</p>}
      </div>
      <div className="confirm-modal-footer no-show-dialog-footer">
        <button type="button" className="secondary-button" onClick={close} disabled={busy}>Fechar</button>
        {attempted && <button type="button" className="secondary-button" onClick={() => onDone('Convite atualizado no painel.')} disabled={busy}>Atualizar painel</button>}
        {!attempted && canSend && <button type="button" className="primary-button" disabled={busy || !text.trim()} onClick={() => submit()}>
          {busy ? 'Enviando…' : 'Enviar pelo WhatsApp'}
        </button>}
        {!attempted && canCheck && <>
          {!invitation.message_id && <button type="button" className="secondary-button" disabled={busy} onClick={() => submit('not_delivered')}>Confirmar que não foi enviado</button>}
          <button type="button" className="primary-button" disabled={busy} onClick={() => submit('delivered')}>Confirmar envio</button>
        </>}
      </div>
    </div>
  </div>, document.body);
}

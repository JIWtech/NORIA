import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, RotateCcw } from 'lucide-react';
import { sendN8nCommand } from '../../../services/integration.js';
import { appointmentRequestErrorMessage, appointmentRequestState } from '../../../services/appointments/appointmentRequest.js';

const conflictLine = (item) => `${item.title || 'Agendamento'} (${new Date(item.starts_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })})`;

export function AppointmentRequestActions({ card, tenantSlug, staleHours, onChanged, onStatus }) {
  const [busy, setBusy] = useState('');
  const state = appointmentRequestState({ startsAt: card.appointmentStartsAt, metadata: card.appointmentMetadata }, { staleHours });

  const send = (command, extra = {}) => sendN8nCommand(command, {
    appointment_id: card.appointmentId,
    channel_type: card.channelType || 'whatsapp',
    external_conversation_id: card.externalConversationId,
    contact_name: card.title,
    request_version: state.version,
    ...extra,
  }, tenantSlug);

  async function perform(name, action, success, failure) {
    if (busy) return;
    setBusy(name);
    onStatus?.('');
    try {
      if (await action() === false) return;
      onStatus?.(success);
      await onChanged?.();
    } catch (error) {
      onStatus?.(appointmentRequestErrorMessage(error, failure));
      await onChanged?.();
    } finally {
      setBusy('');
    }
  }

  const confirm = (event) => {
    event.stopPropagation();
    perform('confirm', async () => {
      const first = await send('confirm_appointment_request');
      if (!first?.requires_acknowledgement) return true;
      const list = (first.conflicts || []).map(conflictLine).join('\n');
      if (!window.confirm(`Já existe agendamento nesse horário:\n${list}\n\nConfirmar mesmo assim?`)) return false;
      await send('confirm_appointment_request', { conflicts_acknowledged: true });
      return true;
    }, 'Agendamento confirmado e mensagem enviada.', 'Não foi possível confirmar o agendamento.');
  };

  const reject = (event) => {
    event.stopPropagation();
    if (!window.confirm('Avisar a cliente que esse horário não está disponível? A IA continua o atendimento.')) return;
    perform('reject', () => send('reject_appointment_slot'), 'Cliente avisada. A IA segue o atendimento.', 'Não foi possível avisar a cliente.');
  };

  const resolve = (event, resolution) => {
    event.stopPropagation();
    perform(resolution, () => send('confirm_appointment_request', { uncertain_resolution: resolution }),
      'Situação do pedido atualizada.', 'Não foi possível atualizar o pedido.');
  };

  return (
    <div className="appointment-request">
      <ul className="appointment-request-details">
        {state.services.length > 0 && <li>{state.services.join(' + ')}</li>}
        {state.professional && <li>Profissional: {state.professional}</li>}
        {state.firstVisit && <li>Primeira vez: {state.firstVisit}</li>}
        {state.durationUnknown && <li>Duração a confirmar</li>}
      </ul>
      {state.stale && !state.expired && (
        <span className="appointment-request-alert"><AlertTriangle size={12} /> Aguardando há muito tempo</span>
      )}
      {state.expired && (
        <span className="appointment-request-alert"><AlertTriangle size={12} /> O horário já passou</span>
      )}
      {state.uncertain ? (
        <>
          <span className="appointment-request-alert"><AlertTriangle size={12} /> Veja no WhatsApp se a mensagem chegou</span>
          <div className="appointment-request-buttons">
            <button type="button" className="confirm-signal-button" disabled={Boolean(busy)} onClick={(event) => resolve(event, 'delivered')}>Chegou</button>
            <button type="button" className="appointment-request-secondary" disabled={Boolean(busy)} onClick={(event) => resolve(event, 'not_delivered')}>Não chegou</button>
          </div>
        </>
      ) : (
        <div className="appointment-request-buttons">
          {state.canConfirm && (
            <button type="button" className="confirm-signal-button" disabled={Boolean(busy)} onClick={confirm} title="Enviar a confirmação à cliente">
              <CheckCircle2 size={14} /> {busy === 'confirm' ? 'Confirmando...' : 'Confirmar'}
            </button>
          )}
          {state.canReject && (
            <button type="button" className="appointment-request-secondary" disabled={Boolean(busy)} onClick={reject} title="Pedir outro horário à cliente">
              <RotateCcw size={13} /> {busy === 'reject' ? 'Enviando...' : 'Sugerir outro horário'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

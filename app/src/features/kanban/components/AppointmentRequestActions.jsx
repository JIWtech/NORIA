import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, RotateCcw } from 'lucide-react';
import { sendN8nCommand } from '../../../services/integration.js';
import { appointmentRequestErrorMessage, appointmentRequestState, rejectionSuccessMessage } from '../../../services/appointments/appointmentRequest.js';
import { AppointmentDetails } from './AppointmentDetails.jsx';
import { SuggestedSlotDialog } from './SuggestedSlotDialog.jsx';
import { AppointmentConfirmDialog } from '../../appointments/components/AppointmentConfirmDialog.jsx';
import { ProposalDeliveryDialog } from './ProposalDeliveryDialog.jsx';

const conflictLine = (item) => `${item.title || 'Agendamento'} (${new Date(item.starts_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })})`;

export function AppointmentRequestActions({ card, tenantSlug, staleHours, suggestionEnabled = false, timeZone, onChanged, onStatus }) {
  const [busy, setBusy] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [conflicts, setConflicts] = useState(null);
  const [checkingProposal, setCheckingProposal] = useState(false);
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
      setConflicts(first.conflicts || []);
      return false;
    }, 'Agendamento confirmado e mensagem enviada.', 'Não foi possível confirmar o agendamento.');
  };

  const confirmWithConflicts = () => {
    setConflicts(null);
    perform('confirm', () => send('confirm_appointment_request', { conflicts_acknowledged: true }),
      'Agendamento confirmado e mensagem enviada.', 'Não foi possível confirmar o agendamento.');
  };

  const reject = (event) => {
    event.stopPropagation();
    setSuggesting(true);
  };

  const submitRejection = (extra) => {
    perform('reject', async () => {
      await send('reject_appointment_slot', extra);
      setSuggesting(false);
    }, rejectionSuccessMessage(extra), 'Não foi possível enviar o aviso.');
  };

  const resolve = (event, resolution) => {
    event.stopPropagation();
    perform(resolution, () => send('confirm_appointment_request', { uncertain_resolution: resolution }),
      'Situação do pedido atualizada.', 'Não foi possível atualizar o pedido.');
  };

  const resolveProposal = (resolution, messageId = '') => {
    perform('proposal', async () => {
      await send('reject_appointment_slot', {
        proposal_id: card.appointmentMetadata?.slot_proposal?.id,
        proposal_resolution: resolution,
        ...(resolution === 'delivered' && messageId ? { proposal_message_id: messageId } : {}),
      });
      setCheckingProposal(false);
    }, 'Situação da proposta atualizada.', 'Não foi possível conferir a proposta.');
  };

  return (
    <div className="appointment-request">
      <AppointmentDetails card={card} timeZone={timeZone} />
      {suggesting && <SuggestedSlotDialog busy={Boolean(busy)} suggestionEnabled={suggestionEnabled} timeZone={timeZone} onClose={() => setSuggesting(false)} onSubmit={submitRejection} />}
      {conflicts !== null && <AppointmentConfirmDialog
        title="Horário com conflito"
        message={`Já existe agendamento nesse horário: ${conflicts.length ? conflicts.map(conflictLine).join('; ') : 'verifique a agenda'}. Confirmar mesmo assim?`}
        confirmLabel="Confirmar mesmo assim"
        onClose={() => setConflicts(null)}
        onConfirm={confirmWithConflicts}
      />}
      {checkingProposal && <ProposalDeliveryDialog busy={Boolean(busy)} knownMessageId={state.proposalMessageId} onClose={() => setCheckingProposal(false)} onSubmit={resolveProposal} />}
      {state.stale && !state.expired && (
        <span className="appointment-request-alert"><AlertTriangle size={12} /> Aguardando há muito tempo</span>
      )}
      {state.expired && (
        <span className="appointment-request-alert"><AlertTriangle size={12} /> O horário já passou</span>
      )}
      {state.sending && !state.proposalStuck && <span className="appointment-request-alert">Enviando mensagem pelo WhatsApp…</span>}
      {state.proposalCheckable ? (
        <>
          <span className="appointment-request-alert"><AlertTriangle size={12} /> {state.proposalStuck ? 'O envio da proposta não terminou. Confira no WhatsApp.' : 'Entrega da proposta incerta. Confira no WhatsApp.'}</span>
          <button type="button" className="appointment-request-secondary" disabled={Boolean(busy)} onClick={() => setCheckingProposal(true)}>Conferir proposta</button>
        </>
      ) : state.uncertain ? (
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
            <button type="button" className="confirm-signal-button" disabled={Boolean(busy)} onClick={confirm} title="Enviar a confirmação por WhatsApp">
              <CheckCircle2 size={14} /> {busy === 'confirm' ? 'Confirmando...' : 'Confirmar'}
            </button>
          )}
          {state.canReject && (
            <button type="button" className="appointment-request-secondary" disabled={Boolean(busy)} onClick={reject} title="Pedir ou propor outro horário">
              <RotateCcw size={13} /> {busy === 'reject' ? 'Enviando...' : 'Sugerir outro horário'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

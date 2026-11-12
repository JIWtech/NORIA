import { formatDate } from '../../utils/dateFormatting.js';
import { normalizeKey } from './kanbanHelpers.js';
import { kanbanAppointmentDetails } from './kanbanAppointmentDetails.js';

// Etiqueta de colunas de encerramento: a mesma para a carga completa (eventsToKanban)
// e para o tempo real (applyIncomingEventToKanban), para os dois caminhos não divergirem.
const CLOSED_COLUMN_REASONS = Object.freeze({
  finalizadas: 'Atendimento finalizado',
  nao_compareceu: 'Cliente não compareceu',
});

export function isClosedKanbanColumn(columnKey) {
  return Object.prototype.hasOwnProperty.call(CLOSED_COLUMN_REASONS, String(columnKey || ''));
}

export function closedColumnReason(columnKey) {
  return CLOSED_COLUMN_REASONS[String(columnKey || '')] || '';
}
const REASONS_ALREADY_IN_COLUMN = {
  novas_conversas: 'Primeiro contato recebido',
  agendamentos: 'Registro operacional do sistema',
  produtos_apresentados: 'Catalogo ou fotos apresentados',
  interesse_compra: 'Cliente demonstrou interesse de compra',
  aguardando_finalizacao: 'Aguardando finalizacao do pedido',
  conversas_abandonadas: 'Conversa sem encerramento recente',
};

export function kanbanCardActionMode(card, columnKey, hasOutcomes, hasChat) {
  if (card.actionType === 'confirm_request') return 'request';
  if (card.actionType === 'confirm_signal') return 'signal';
  if (hasOutcomes && (!hasChat || String(card.id || '').startsWith('appointment-')
    || columnKey === 'agendamentos' || columnKey === 'nao_compareceu')) return 'outcomes';
  return hasChat ? 'chat' : '';
}

export function kanbanCardLabels(card, column) {
  const key = column.automationKey || column.id;
  const closed = card.isClosed || isClosedKanbanColumn(key);
  const waiting = key === 'aguardando_humano';
  const appointmentOnly = card.appointmentStatusLabel && card.owner === card.appointmentStatusLabel && !card.ownerKind;
  const appointmentStatus = card.appointmentStatusLabel || '';
  const duplicatesAppointment = (key === 'nao_compareceu' && card.appointmentStatus === 'no_show')
    || normalizeKey(appointmentStatus) === normalizeKey(column.title);
  // Quando o bloco de detalhes já mostra dia e hora, o resumo de status não repete a data.
  const detailsShowWhen = Boolean(kanbanAppointmentDetails(card)?.when);
  const appointmentDate = appointmentStatus && !duplicatesAppointment && card.appointmentStartsAt
    && !String(card.id || '').startsWith('appointment-') && !detailsShowWhen
    ? formatDate(card.appointmentStartsAt)
    : '';
  const reason = card.aiReason || '';
  const duplicatesStage = reason === REASONS_ALREADY_IN_COLUMN[key] || reason === closedColumnReason(key);
  const duplicatesPayment = appointmentStatus && card.actionType === 'confirm_signal'
    && ['Sinal informado pela cliente', 'Sinal informado. Aguardando verificação humana.'].includes(reason);
  const duplicatesOwner = ['IA conduzindo a conversa', 'IA em qualificacao', 'Aguardando atendimento humano'].includes(reason);

  return {
    closed,
    owner: closed || appointmentOnly || key === 'conversas_abandonadas'
      || ((waiting || card.needsReview) && card.ownerKind !== 'agent') ? '' : card.owner || 'Sem responsável',
    reason: duplicatesStage || duplicatesPayment || duplicatesOwner || (closed && !Object.values(CLOSED_COLUMN_REASONS).includes(reason)) ? '' : reason,
    appointmentStatus: duplicatesAppointment ? '' : appointmentStatus,
    appointmentDate,
  };
}

import { asObject } from '../../utils/asObject.js';
import { normalizeStage } from '../conversations/conversationPresentation.js';
import { isExplicitAiOwnershipTransition } from '../conversations/ownershipEvidence.js';
import { technicalEventPresentation } from '../conversations/technicalEventPresentation.js';
import { canonicalKanbanKey, normalizeKey } from './kanbanHelpers.js';
import { findKanbanColumn } from './stageResolution.js';

export const HUMAN_KANBAN_COLUMNS = new Set(['aguardando_humano', 'com_humano', 'conversas_humanos', 'sales_human']);
export const AI_KANBAN_COLUMNS = new Set(['conversas_ia', 'novas_conversas', 'conversas_andamento']);
const PAYMENT_COLUMNS = ['verificar_sinal', 'aguardando_humano'];
const OPERATIONAL_COLUMNS = new Set(['confirmar_agendamento', 'agendamentos', 'nao_compareceu', 'follow_ups']);

export function followUpStepLabel(stepKey) {
  const key = String(stepKey || '').trim().toLowerCase();
  if (!key) return '';
  if (key === '3h') return '3h';
  if (key === '24h' || key === '1d' || key === '1dia') return '1 dia';
  if (key === '15d' || key === '15dias') return '15 dias';
  return String(stepKey).trim();
}

export function extractFollowUpStepKey(event = {}) {
  const payloadStep = asObject(event?.raw_payload)?.follow_up?.step_key;
  if (payloadStep) return String(payloadStep).trim();
  const stageMatch = String(event?.stage || '').trim().match(/^follow[\s_-]*up\s+(.+)$/i);
  return stageMatch ? stageMatch[1].trim() : '';
}

export function followUpCardReason(stepLabel = '') {
  return stepLabel ? 'Aguardando retorno do cliente' : 'Follow-up enviado · aguardando retorno';
}

export function nextTeamReviewRequestedAt(previous, event) {
  const manualSent = event.direction === 'outbound' && event.service === 'manual_reply'
    && ['sent', 'delivered', 'read'].includes(event.delivery_status);
  if (isKanbanClosed(event) || manualSent) return null;
  if (event.direction === 'outbound' && asObject(event.raw_payload).team_review_requested === true) return previous || event.created_at || null;
  return previous || null;
}

export function isKanbanClosed(event) {
  return event?.service === 'conversation_closed'
    || event?.ai_provider === 'conversation_closed'
    || event?.delivery_status === 'closed'
    || asObject(event?.raw_payload).event_type === 'conversation_closed'
    || (canonicalKanbanKey(event?.stage) !== 'sales_closed' && normalizeStage(event?.stage) === 'Finalizado');
}

export function isKanbanAssignedToHuman(event) {
  const payload = asObject(event?.raw_payload);
  return event?.sender_type === 'agent' || event?.service === 'manual_reply'
    || event?.service === 'conversation_assigned' || Boolean(payload.assignee);
}

export function isKanbanWaitingHuman(event) {
  const actions = asObject(event?.raw_payload).internal_actions;
  return Boolean(event?.handoff || actions?.ready_to_schedule || actions?.complaint_handoff)
    || event?.service === 'handoff_requested'
    || event?.ai_provider === 'human_lock'
    || normalizeStage(event?.stage) === 'Atendimento humano';
}

export function humanKanbanStage(event) {
  const target = canonicalKanbanKey(asObject(event?.raw_payload).kanban_transition?.to_column);
  if (HUMAN_KANBAN_COLUMNS.has(target)) return target;
  if (isKanbanAssignedToHuman(event)) return 'com_humano';
  if (isKanbanWaitingHuman(event)) return 'aguardando_humano';
  return '';
}

function humanCandidates(stage) {
  return stage === 'aguardando_humano'
    ? ['aguardando_humano', 'com_humano', 'conversas_humanos']
    : [stage, 'com_humano', 'conversas_humanos', 'aguardando_humano'];
}

export function findKanbanDestination(columns, candidates) {
  for (const candidate of candidates) {
    const column = findKanbanColumn(columns, candidate);
    if (column) return column;
  }
  return null;
}

export function conversationKanbanCandidates(event, { humanStage, isFirstContact, direction, paymentResolved, columns, live = false, waitingForFollowUp = false, resumedFromFollowUp = false } = {}) {
  const payload = asObject(event?.raw_payload);
  const stage = normalizeStage(event?.stage);
  const key = canonicalKanbanKey(event?.stage);
  if (isKanbanClosed(event)) {
    return payload.close_reason === 'no_show'
      ? ['nao_compareceu', 'finalizadas', 'conversas_andamento']
      : ['finalizadas', 'conversas_andamento'];
  }
  const paymentEvent = key === 'verificar_sinal' || stage === 'Sinal informado' || event?.service === 'pagamento_sinal'
    || event?.ai_provider === 'payment_signal' || Boolean(payload.payment_signal);
  if (paymentEvent && !paymentResolved) return PAYMENT_COLUMNS;
  if (isExplicitAiOwnershipTransition(event)) return ['conversas_ia', 'conversas_andamento', 'novas_conversas'];
  if (humanStage) return humanCandidates(humanStage);
  if (technicalEventPresentation(event)) return ['aguardando_humano', 'conversas_humanos', 'com_humano'];
  if (stage === 'Venda concluida') return ['finalizadas', 'conversas_andamento'];
  if (stage === 'Agendamento confirmado') return ['agendamentos'];
  if (waitingForFollowUp && findKanbanColumn(columns, 'follow_ups')) return ['follow_ups'];
  const createdAt = Date.parse(event?.created_at || '');
  const configuredHours = Number(payload.kanban_abandoned_after_hours);
  const idleHours = Number.isFinite(configuredHours) && configuredHours > 0 ? configuredHours : 24;
  if (!live && ['inbound', 'outbound'].includes(direction) && (!key || AI_KANBAN_COLUMNS.has(key))
    && findKanbanColumn(columns, 'conversas_abandonadas') && Date.now() - createdAt > idleHours * 3600000) {
    return ['conversas_abandonadas'];
  }
  if (normalizeKey(event?.stage) === 'conversas_andamento') return ['conversas_andamento', 'conversas_ia'];
  if (key && !paymentEvent && !OPERATIONAL_COLUMNS.has(key)) {
    if (live) return key === 'conversas_andamento' ? [] : [key];
    if (key !== 'conversas_andamento') return [key, 'conversas_ia', 'conversas_andamento', 'novas_conversas'];
  }
  if (live) {
    return resumedFromFollowUp ? ['conversas_ia', 'conversas_andamento', 'novas_conversas'] : [];
  }
  return isFirstContact && direction !== 'outbound'
    ? ['conversas_ia', 'novas_conversas', 'conversas_andamento']
    : ['conversas_ia', 'conversas_andamento', 'novas_conversas'];
}

export function kanbanMoveBlockReason(card, target) {
  if (card?.isFollowUp || target === 'follow_ups') return 'As conversas em follow-up são movidas automaticamente após resposta, encaminhamento ou encerramento.';
  const closed = card?.isClosed || ['finalizadas', 'nao_compareceu'].includes(card?.targetColumnId);
  if (closed && target !== card.targetColumnId && !target.startsWith('sales_')) {
    return 'O atendimento está encerrado. Um novo contato reabre a conversa.';
  }
  const status = card?.appointmentStatus;
  if (target === 'verificar_sinal' && status !== 'payment_reported' && status !== 'aguardando_verificacao') {
    return 'Verificar sinal exige um pagamento informado para este agendamento.';
  }
  if (target === 'confirmar_agendamento' && status !== 'pending_confirmation') return 'Esta coluna exige um pedido de agendamento pendente.';
  if (target === 'agendamentos' && !['scheduled', 'confirmed', 'reserved', 'pending_payment'].includes(status)) {
    return 'Crie um agendamento pelo botão Agendar.';
  }
  if (target === 'nao_compareceu' && status !== 'no_show') return 'Use Registrar falta no agendamento.';
  return '';
}

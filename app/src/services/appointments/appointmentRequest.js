import { userFacingError } from '../../utils/userFacingError.js';

// Pedido de agendamento aguardando confirmação do dono (status pending_confirmation, migração 031).
// O servidor confere versão e horário de novo: aqui só se decide o que o cartão mostra.

const PROPOSAL_STUCK_MS = 2 * 60 * 1000;

// O envio da proposta só funciona com as duas chaves: enviar e ler a resposta. O servidor confere de novo.
export function slotProposalSuggestionEnabled(tenantSlug, config) {
  return tenantSlug === 'ic_salon' && config?.slot_proposal_enabled === true && config?.slot_proposal_resolution_enabled === true;
}

export function rejectionSuccessMessage(extra = {}) {
  return extra.suggested_date || extra.suggested_time
    ? 'Proposta enviada. O pedido aguarda a resposta da pessoa; o resultado aparece no cartão da conversa.'
    : 'Aviso enviado. A IA segue o atendimento.';
}

export function appointmentRequestState({ startsAt, metadata } = {}, { now = Date.now(), staleHours = 0 } = {}) {
  const data = metadata || {};
  const version = Number(data.request_version) || 0;
  const expired = Date.parse(startsAt || '') <= now;
  const sending = data.confirmation_state === 'sending';
  const proposalUncertain = data.confirmation_state === 'uncertain' && data.slot_proposal?.status === 'uncertain';
  // 'sending' preso (o n8n caiu entre preparar e ativar): depois de 2 minutos a equipe pode conferir, como no incerto.
  const preparedAt = Date.parse(data.slot_proposal?.prepared_at || '');
  const proposalStuck = sending && data.slot_proposal?.status === 'sending' && Number.isFinite(preparedAt) && now - preparedAt > PROPOSAL_STUCK_MS;
  const uncertain = data.confirmation_state === 'uncertain' && !proposalUncertain;
  const updatedAt = Date.parse(data.request_updated_at || '');
  const stale = Number(staleHours) > 0 && Number.isFinite(updatedAt) && now - updatedAt >= Number(staleHours) * 3600000;
  return {
    services: Array.isArray(data.services) ? data.services : [],
    professional: data.professional || '',
    firstVisit: data.first_visit || '',
    durationUnknown: !data.duration_minutes,
    version,
    expired,
    stale,
    sending,
    uncertain,
    proposalUncertain,
    proposalStuck,
    proposalCheckable: proposalUncertain || proposalStuck,
    // Id da mensagem que o envio já devolveu: a conferência não precisa pedi-lo à equipe.
    proposalMessageId: String(data.slot_proposal?.provider_message_id || ''),
    fromProposal: data.slot_proposal?.status === 'accepted',
    canConfirm: !expired && !data.confirmation_state,
    canReject: !data.confirmation_state,
  };
}

// Os motivos de recusa do comando ajudam o dono a decidir; qualquer outro erro continua genérico.
const REFUSALS = [
  // Mais específicas primeiro: a mensagem de entrega incerta pode trazer também a falha ao registrá-la.
  [/Nao foi possivel marcar a proposta como incerta/, 'A mensagem pode não ter chegado e o pedido ficou preso em envio. Aguarde 2 minutos e use "Conferir proposta".'],
  [/proposta nao ativada/, 'A mensagem foi enviada, mas a proposta não foi ativada. Confira no WhatsApp e use "Conferir proposta".'],
  [/horario proposto ja passou|SLOT_PROPOSAL_INVALID_TIME/, 'Esse horário já passou. Escolha uma data e hora futuras.'],
  [/Data ou horario da proposta invalido|Data da proposta invalida/, 'Data ou hora inválida. Confira os campos e tente de novo.'],
  [/Proposta de horario nao esta ativa|SLOT_PROPOSAL_NOT_ENABLED/, 'A proposta de horário está desligada para esta empresa. Peça outro horário ou fale com o suporte.'],
  [/Gemini (?:nao|omitiu)/, 'A IA não conseguiu escrever a mensagem agora. Tente de novo em instantes.'],
  [/Envio em andamento/, 'Há um envio em andamento ou com entrega incerta. Confira no WhatsApp (ou use "Conferir proposta") antes de tentar de novo.'],
  [/alterado pela cliente/, 'A pessoa mudou este pedido. Confira os dados e tente de novo.'],
  [/alterado por outro operador|alterado simultaneamente/, 'Outra pessoa alterou este pedido. Confira os dados e tente de novo.'],
  [/entrega (?:nao comprovada|incerta)/i, 'Não deu para comprovar a entrega. Veja no WhatsApp se a mensagem chegou.'],
  [/horario deste pedido ja passou/, 'O horário deste pedido já passou. Sugira outro horário à pessoa.'],
  [/nao esta mais aguardando confirmacao/, 'Este pedido já foi resolvido.'],
];

export function appointmentRequestErrorMessage(error, fallback) {
  const message = String(error?.message || '');
  return REFUSALS.find(([pattern]) => pattern.test(message))?.[1] || userFacingError(error, fallback);
}

// A leitura geral para em 200 agendamentos: pedidos abertos entram por consulta própria.
export function mergeOpenAppointmentRequests(appointments = [], openRequests = []) {
  const known = new Set(appointments.map((item) => item.id));
  return [...appointments, ...openRequests.filter((item) => !known.has(item.id))];
}

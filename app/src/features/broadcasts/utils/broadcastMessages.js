// Textos de interface para os códigos técnicos do servidor de disparos.
// O servidor devolve códigos estáveis (BROADCAST_*, motivos de pausa); a tela nunca mostra diagnóstico cru.
import { userFacingError } from '../../../utils/userFacingError.js';

const ERROR_MESSAGES = {
  BROADCAST_CAMPAIGN_LIMIT: 'A lista passa do limite de contatos por campanha desta empresa. Divida em campanhas menores.',
  BROADCAST_FORBIDDEN: 'Você não tem permissão para fazer disparos nesta empresa.',
  BROADCAST_CONSENT_REQUIRED: 'Confirme o consentimento dos contatos antes de enviar.',
  BROADCAST_NO_RECIPIENTS: 'Selecione pelo menos um contato com telefone válido.',
  BROADCAST_NOT_DRAFT: 'Esta campanha já foi enviada para a fila.',
  BROADCAST_INVALID_TRANSITION: 'A campanha mudou de situação. Atualize a tela e tente de novo.',
};

export function broadcastErrorMessage(error, fallback) {
  const text = String(error?.message || '');
  const code = Object.keys(ERROR_MESSAGES).find((key) => text.includes(key));
  return code ? ERROR_MESSAGES[code] : userFacingError(error, fallback);
}

const CHANNEL_PROBLEM = 'Pausada porque o canal recusou o envio. Confira a conexão e as credenciais do WhatsApp antes de retomar.';

export function broadcastPauseReason(reason) {
  const code = String(reason || '');
  if (!code) return '';
  if (code === 'consecutive_failures') return 'Pausada automaticamente após várias falhas seguidas, para proteger o número. Confira a lista e o canal antes de retomar.';
  if (code === 'provider_rejected_http_429') return 'Pausada porque o provedor atingiu o limite de envios. Aguarde antes de retomar.';
  if (/^provider_rejected_http_|_credentials_missing$/.test(code)) return CHANNEL_PROBLEM;
  if (code === 'empty_message') return 'Pausada porque a mensagem está vazia.';
  return 'Campanha pausada pelo servidor. Confira o canal antes de retomar.';
}

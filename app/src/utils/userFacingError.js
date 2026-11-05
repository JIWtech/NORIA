// Mensagens do servidor são diagnóstico, nunca texto de interface.
export function userFacingError(error, fallback = 'Não foi possível concluir esta ação. Tente novamente.') {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  if (code === 'invalid_credentials') return 'E-mail ou senha incorretos.';
  if (code === 'email_not_confirmed') return 'Confirme seu e-mail antes de entrar.';
  if (code === 'user_already_exists') return 'Já existe uma conta com este e-mail.';
  if (code === 'weak_password') return 'Escolha uma senha mais forte.';
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit') return 'Muitas tentativas. Aguarde um pouco e tente novamente.';
  if (/SLOT_UNAVAILABLE|LEGACY_BOOKING/.test(message)) return 'Horário indisponível ou aguardando revisão da equipe. Consulte outra data.';
  if (code === 'SESSION_EXPIRED' || /^(?:Sessao|Sessão) expirada\./.test(message)) return 'Sua sessão expirou. Entre novamente para continuar.';
  return fallback;
}

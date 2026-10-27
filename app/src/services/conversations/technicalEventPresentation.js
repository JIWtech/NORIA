export function technicalEventPresentation(event = {}) {
  const system = event.sender_type === 'system' || event.from === 'system';
  if (!system || !(event.service === 'technical_error' || ['core_error', 'core_operator_review'].includes(event.ai_provider))) return null;
  return {
    kind: 'review', title: 'Atendimento precisa da equipe',
    detail: 'A IA não conseguiu continuar. Confira a conversa para ajudar o cliente.',
  };
}

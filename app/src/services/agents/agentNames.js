export function visibleAgentName(name) {
  if (!name || typeof name !== 'string') return '';
  const trimmed = name.trim();
  if (trimmed.includes('@') || /^[0-9a-f-]{36}$/i.test(trimmed)) return '';
  return trimmed;
}

export function cleanAgentName(name) {
  const trimmed = visibleAgentName(name);
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  const technicalOrGeneric = ['operador noria','operador mag.ia','operador','operador (whatsapp)','operador whatsapp','atendente','atendente humano','atendimento humano','atendimento','human_operator','sales_operator','agent','system','sistema','bot','assistente ia','ia','gemini','disparo noria','noria','mag.ia','sem responsavel','sem responsável'];
  if (technicalOrGeneric.includes(lower)) return '';
  if (/^\+?\d{8,15}$/.test(lower)) return '';
  if (lower.includes('automóveis') || lower.includes('automoveis') || lower.includes('veículos') || lower.includes('veiculos') || lower.includes('clínica') || lower.includes('clinica') || lower.includes('genesis') || lower.includes('gênesis')) return '';
  return trimmed;
}

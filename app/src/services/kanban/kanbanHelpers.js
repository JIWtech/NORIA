export const OFFICIAL_KANBAN_COLUMNS = [
  { id: 'novas_conversas', title: 'Novas conversas', automationKey: 'novas_conversas' },
  { id: 'conversas_andamento', title: 'Conversas em andamento', automationKey: 'conversas_andamento' },
  { id: 'conversas_humanos', title: 'Conversas com humanos', automationKey: 'conversas_humanos' },
  { id: 'verificar_sinal', title: 'Verificar Sinal', automationKey: 'verificar_sinal' },
  { id: 'agendamentos', title: 'Agendamentos', automationKey: 'agendamentos' },
];

export const KANBAN_KEY_ALIASES = {
  ia: 'conversas_ia',
  conversa_ia: 'conversas_ia',
  conversas_ia: 'conversas_ia',
  conversas_com_ia: 'conversas_ia',
  aguardando_humano: 'aguardando_humano',
  aguardando_atendimento: 'aguardando_humano',
  aguardando_atendimento_humano: 'aguardando_humano',
  aguardando: 'aguardando_humano',
  com_humano: 'com_humano',
  em_atendimento_humano: 'com_humano',
  conversa_com_humano: 'com_humano',
  conversas_com_humano: 'com_humano',
  designado_humano: 'com_humano',
  verificar_sinal: 'verificar_sinal',
  confirmar_agendamento: 'confirmar_agendamento',
  sinal_pago: 'verificar_sinal',
  pagamento_sinal: 'verificar_sinal',
  pagamento_reportado: 'verificar_sinal',
  sinal_informado: 'verificar_sinal',
  produtos_apresentados: 'produtos_apresentados',
  catalogo_enviado: 'produtos_apresentados',
  fotos_enviadas: 'produtos_apresentados',
  interesse_compra: 'interesse_compra',
  interesse_em_compra: 'interesse_compra',
  aguardando_finalizacao: 'aguardando_finalizacao',
  aguardando_pagamento: 'aguardando_finalizacao',
  venda_concluida: 'finalizadas',
  pedido_finalizado: 'finalizadas',
  finalizadas: 'finalizadas',
  finalizada: 'finalizadas',
  finalizado: 'finalizadas',
  encerradas: 'finalizadas',
  encerrada: 'finalizadas',
  conversas_abandonadas: 'conversas_abandonadas',
  abandonadas: 'conversas_abandonadas',
  abandonada: 'conversas_abandonadas',
  novo: 'novas_conversas',
  novos: 'novas_conversas',
  novas: 'novas_conversas',
  novas_conversas: 'novas_conversas',
  primeiro_contato: 'novas_conversas',
  entrada: 'novas_conversas',
  patio: 'novas_conversas',
  patio_novos_contatos: 'novas_conversas',
  novos_contatos: 'novas_conversas',
  qualificacao: 'conversas_andamento',
  qualificação: 'conversas_andamento',
  link_enviado: 'conversas_andamento',
  agendamento_link: 'conversas_andamento',
  conversas_andamento: 'conversas_andamento',
  andamento: 'conversas_andamento',
  ativo: 'conversas_andamento',
  em_atendimento: 'conversas_andamento',
  humano: 'conversas_humanos',
  atendimento_humano: 'conversas_humanos',
  conversas_humanos: 'conversas_humanos',
  humanos: 'conversas_humanos',
  handoff: 'conversas_humanos',
  agendamento: 'agendamentos',
  agendamentos: 'agendamentos',
  agendamento_confirmado: 'agendamentos',
  agenda: 'agendamentos',
  follow_up: 'follow_ups',
  follow_ups: 'follow_ups',
  followup: 'follow_ups',
  followups: 'follow_ups',
  concluido: 'conversas_andamento',
  concluidos: 'conversas_andamento',
  fila_de_financiamento: 'sales_financing',
  financiamento: 'sales_financing',
  sales_financing: 'sales_financing',
};

export function normalizeKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function canonicalKanbanKey(key) {
  const normalized = normalizeKey(key);
  return KANBAN_KEY_ALIASES[normalized] || normalized;
}

export function emptyKanban() {
  return OFFICIAL_KANBAN_COLUMNS.map((column) => ({ ...column, cards: [] }));
}

export function getKanbanColumnKind(column = {}) {
  const key = canonicalKanbanKey(column.automationKey || column.automation_key || column.id || '');
  if (['verificar_sinal', 'agendamentos', 'conversas_abandonadas', 'follow_ups'].includes(key)) return 'special_view';
  return 'stage';
}

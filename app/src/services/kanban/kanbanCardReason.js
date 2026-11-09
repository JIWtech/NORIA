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

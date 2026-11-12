import { canonicalKanbanKey, normalizeKey } from './kanbanHelpers.js';
import { GENESIS_SALES_STAGE_DEFAULT_NAMES, isGenesisSalesTenant } from './commercialStages.js';
export { GENESIS_SALES_STAGE_DEFAULT_NAMES } from './commercialStages.js';

export function findKanbanColumn(columns, targetKey) {
  if (!columns || !columns.length || !targetKey) return null;
  const exact = columns.find((column) => [column.automationKey, column.automation_key, column.id, column.boardColumnId].includes(targetKey));
  if (exact) return exact;
  const target = canonicalKanbanKey(targetKey);
  const targetNorm = normalizeKey(targetKey);
  return columns.find((column) => (
    canonicalKanbanKey(column.automationKey) === target ||
    canonicalKanbanKey(column.automation_key) === target ||
    canonicalKanbanKey(column.id) === target ||
    canonicalKanbanKey(column.title) === target ||
    canonicalKanbanKey(column.name) === target ||
    normalizeKey(column.title) === targetNorm ||
    normalizeKey(column.name) === targetNorm ||
    String(column.id) === String(targetKey) ||
    String(column.boardColumnId) === String(targetKey) || (targetKey === 'sales_human' && (column.id === 'conversas_humanos' || column.automationKey === 'conversas_humanos' || column.automation_key === 'conversas_humanos'))
  ));
}

export function getStageLabel(stageKeyOrName, context = {}) {
  if (!stageKeyOrName) return 'Qualificação';
  const raw = String(stageKeyOrName).trim();
  if (!raw || raw === 'Buffering' || raw.toLowerCase() === 'buffering') return 'Qualificação';

  const kanbanColumns = Array.isArray(context) ? context : context?.kanbanColumns;
  const tenantSettings = context?.tenantSettings;
  const tenantSlug = typeof context === 'string'
    ? context
    : (context?.tenantSlug || context?.tenant_slug || '');

  // 1. Prioridade máxima: resolver pelas colunas configuradas do Kanban do tenant
  if (Array.isArray(kanbanColumns) && kanbanColumns.length) {
    const col = findKanbanColumn(kanbanColumns, raw);
    if (col && (col.title || col.name)) {
      return col.title || col.name;
    }
  }

  // 2. Resolver pelas configurações do tenant (settings.sales.stages ou settings.stages)
  const settingsStages = tenantSettings?.sales?.stages
    || tenantSettings?.settings?.sales?.stages
    || tenantSettings?.stages
    || tenantSettings?.settings?.stages;
  if (settingsStages && typeof settingsStages === 'object') {
    const canonicalKey = canonicalKanbanKey(raw);
    const configuredStage = settingsStages[raw] || settingsStages[canonicalKey];
    if (configuredStage?.name) {
      return configuredStage.name;
    }
  }

  // 3. Fallback para nomes padrão Genesis: SOMENTE SE for comprovadamente o tenant Genesis (wesley_automoveis) ou capability sales_v1
  const isGenesis = isGenesisSalesTenant(tenantSlug)
    || tenantSettings?.conversation_capability === 'sales_v1'
    || tenantSettings?.settings?.conversation_capability === 'sales_v1';
  if (isGenesis) {
    const canonical = canonicalKanbanKey(raw);
    if (GENESIS_SALES_STAGE_DEFAULT_NAMES[canonical]) {
      return GENESIS_SALES_STAGE_DEFAULT_NAMES[canonical];
    }
    if (GENESIS_SALES_STAGE_DEFAULT_NAMES[raw]) {
      return GENESIS_SALES_STAGE_DEFAULT_NAMES[raw];
    }
  }

  // 4. Fallback para padrões legados (ex: clinica_nubia)
  const s = raw.toLowerCase();
  if (s === 'reset' || s === '/reset') return 'Qualificação';
  if (s.includes('aguardando') && (s.includes('final') || s.includes('pagamento'))) return 'Aguardando finalizacao';
  if (s.includes('finaliz') || s.includes('encerr')) return 'Finalizado';
  if (s.includes('verificar sinal')) return 'Verificar Sinal';
  if (s.includes('sinal informado')) return 'Sinal informado';
  if (s.includes('produto') && (s.includes('apresent') || s.includes('catalog') || s.includes('foto'))) return 'Produtos apresentados';
  if (s.includes('interesse') && s.includes('compra')) return 'Interesse em compra';
  if (s.includes('venda') && s.includes('conclu')) return 'Venda concluida';
  if (s.includes('agendamento confirmado')) return 'Agendamento confirmado';
  if (s.includes('qualific') || s === 'qualificacao') return 'Qualificação';
  if (s.includes('agend') || s === 'agendamento') return 'Agendamento';
  if (s.includes('brief') || s.includes('briefing')) return 'Briefing necessário';
  if (s.includes('suport') || s.includes('suporte')) return 'Suporte técnico';
  if (s.includes('orc') || s.includes('orç') || s.includes('orcamento')) return 'Orçamento solicitado';
  if (s.includes('human') || s.includes('atendimento_humano') || s.includes('atendimento humano')) return 'Atendimento humano';
  if (s.includes('diagnos') || s.includes('diagnostico')) return 'Diagnóstico';
  if (s.includes('negoc') || s.includes('negociacao')) return 'Negociação';
  if (s.includes('fechad') || s.includes('fechado')) return 'Cliente fechado';
  if (s.includes('propost') || s.includes('proposta')) return 'Proposta';
  if (s.includes('fora de contexto')) return 'Fora de contexto';

  // 5. Se já for um texto amigável (já contém espaços, acentos, letras maiúsculas e não é snake_case comercial puro)
  if (!raw.startsWith('sales_') && (/[A-Z]/.test(raw) || /\s/.test(raw) || /[áéíóúãõâêîôûç]/i.test(raw))) {
    return raw;
  }

  // 6. Fallback defensivo final contra chaves snake_case técnicas não mapeadas:
  // Nunca mascarar silenciosamente: avisar no console para visibilidade operacional
  if (typeof console !== 'undefined' && console.warn) {
    console.warn(`[getStageLabel] Chave de etapa não configurada "${raw}" para o tenant "${tenantSlug || 'desconhecido'}".`);
  }
  if (raw.includes('_')) {
    return raw
      .split('_')
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }

  return raw || 'Qualificação';
}

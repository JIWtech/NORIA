import { canonicalKanbanKey } from './kanbanHelpers.js';
import { normalizeChannel } from '../identity/conversationIdentity.js';
import { GENESIS_SALES_STAGE_KEYS, isGenesisSalesTenant } from './commercialStages.js';
import { getStageLabel } from './stageResolution.js';

export function buildGenesisSalesMovePayload(leadId, stageKey, revision) {
  return {
    p_lead: leadId,
    p_stage: canonicalKanbanKey(stageKey),
    p_revision: revision,
  };
}

// Canais em que o roteador do n8n faz o encerramento oficial (close_conversation).
const OFFICIAL_CLOSE_CHANNELS = new Set(['whatsapp', 'telegram', 'instagram', 'instagram_direct']);

// closeConversation: encerramento oficial, o mesmo do botão Encerrar das Conversas. Sem ele, finalizar no
// Kanban só gravava um evento interno e o atendimento humano seguia aberto (a IA não voltava a responder).
export function createMoveKanbanCard({ getClient, loadTenant, closeConversation = null }) {
async function moveGenesisSalesCard(tenantSlug, card, targetColumnKey, agentName = null, targetColObj = null) {
  const canonical = canonicalKanbanKey(targetColObj?.automationKey || targetColumnKey);
  const sourceColumn = canonicalKanbanKey(card.targetColumnId || card.salesStageKey || card.stage || '');
  const isConversationClose = canonical === 'conversation_closed';
  if (!isConversationClose && !GENESIS_SALES_STAGE_KEYS.has(canonical)) {
    throw new Error('Etapa comercial inválida para o Kanban Genesis.');
  }
  if (!isConversationClose && sourceColumn === canonical) return [];

  const conversationId = String(card.externalConversationId || card.conversationId || card.id || '');
  const channelType = normalizeChannel(card.channelType || card.channel || 'whatsapp').type;
  const nowIso = new Date().toISOString();
  const ownerName = card.ownerKind === 'agent' || card.ownerKind === 'human' ? card.owner : null;
  const targetTitle = String(targetColObj?.title || getStageLabel(targetColumnKey, { tenantSlug }) || '').trim();
  const isHumanTarget = canonical === 'sales_human';
  const stage = isConversationClose ? 'Finalizada' : (targetTitle || getStageLabel(canonical, { tenantSlug }));
  const newEvent = {
    tenant_slug: tenantSlug,
    channel_type: channelType,
    external_conversation_id: conversationId,
    external_message_id: `kanban_move_${Date.now()}`,
    direction: 'internal',
    sender_type: isHumanTarget ? 'agent' : 'system',
    sent_by_user: isHumanTarget ? (agentName || ownerName || 'Atendente') : null,
    contact_name: card.title || card.contactName || 'Contato',
    message_text: isConversationClose
      ? '[Kanban] Conversa encerrada sem alteração da etapa comercial.'
      : `[Kanban] Etapa comercial alterada para: ${stage}`,
    response_text: isConversationClose ? 'Conversa encerrada no painel.' : 'Etapa comercial atualizada no painel.',
    service: isConversationClose ? 'conversation_closed' : 'sales_stage_changed',
    stage,
    handoff: isHumanTarget,
    delivery_status: 'internal',
    ai_provider: 'kanban_action',
    created_at: nowIso,
    raw_payload: {
      event_type: isConversationClose ? 'conversation_closed' : 'kanban_stage_changed',
      event_category: 'kanban',
      is_internal: true,
      ...(card.ownerId ? { assignee: { id: card.ownerId, name: ownerName || card.owner } } : {}),
      kanban_transition: {
        from_stage: card.salesStageKey || card.stage,
        to_column: isConversationClose ? card.targetColumnId : canonical,
        moved_at: nowIso,
        moved_by: agentName || ownerName || 'Operador',
      },
    },
  };

  const supabase = getClient();
  if (!supabase) return [newEvent];

  if (isConversationClose) {
    const tenant = await loadTenant(tenantSlug);
    if (!tenant?.id) throw new Error('Tenant não encontrado ao encerrar a conversa.');
    newEvent.tenant_id = tenant.id;
    const { error } = await supabase.from('channel_events').insert([newEvent]);
    if (error) throw error;
    return [newEvent];
  }

  let leadId = card.salesLeadId || null;
  let revision = Number.isInteger(card.salesRevision) ? card.salesRevision : null;
  if (!leadId || revision === null) {
    const tenant = await loadTenant(tenantSlug);
    if (!tenant?.id) throw new Error('Tenant não encontrado ao salvar a movimentação do Kanban.');
    const { data: lead, error: leadError } = await supabase
      .from('sales_leads')
      .select('id, revision')
      .eq('tenant_id', tenant.id)
      .eq('channel_type', channelType)
      .eq('chat_id', conversationId)
      .maybeSingle();
    if (leadError) throw leadError;
    leadId = lead?.id || null;
    revision = Number.isInteger(lead?.revision) ? lead.revision : null;
  }
  if (!leadId || revision === null) throw new Error('Lead comercial não encontrado para esta conversa.');

  const { data: updatedLead, error: moveError } = await supabase.rpc(
    'magia_sales_move',
    buildGenesisSalesMovePayload(leadId, canonical, revision),
  );
  if (moveError) throw moveError;
  if (!updatedLead?.id || updatedLead.stage_key !== canonical) {
    throw new Error('A etapa comercial não foi persistida para este lead.');
  }

  newEvent.raw_payload.sales_lead_id = updatedLead.id;
  newEvent.raw_payload.sales_stage_key = updatedLead.stage_key;
  newEvent.salesLeadId = updatedLead.id;
  newEvent.salesStageKey = updatedLead.stage_key;
  newEvent.salesRevision = Number.isInteger(updatedLead.revision) ? updatedLead.revision : null;
  newEvent.salesAiLocked = Boolean(updatedLead.ai_locked);
  return [newEvent];
}

async function moveKanbanCard(activeTenantSlug, card, targetColumnKey, agentName = null, targetColObj = null) {
  const tenantSlug = activeTenantSlug || 'clinica_nubia';
  if (isGenesisSalesTenant(tenantSlug)) {
    return moveGenesisSalesCard(tenantSlug, card, targetColumnKey, agentName, targetColObj);
  }
  const canonical = canonicalKanbanKey(targetColObj?.automationKey || targetColumnKey);
  const targetTitle = String(targetColObj?.title || targetColObj?.name || targetColumnKey || '').toLowerCase();
  const sourceColumn = canonicalKanbanKey(card.targetColumnId || card.stage || '');

  // A mesma etapa não é uma transição e não deve criar auditoria duplicada.
  if (sourceColumn && sourceColumn === canonical) return [];

  let stage = 'Qualificacao';
  let service = 'kanban_move';
  let handoff = false;
  let senderType = 'system';
  let sentByUser = agentName || null;
  let responseText = null;

  const isHumanTarget = canonical === 'com_humano'
    || canonical === 'conversas_humanos'
    || targetTitle.includes('humano')
    || targetTitle.includes('atendente');

  const isWaitingHumanTarget = canonical === 'aguardando_humano'
    || targetTitle.includes('aguardando humano')
    || targetTitle.includes('aguardando atendimento');

  const isFinalizadasTarget = canonical === 'finalizadas'
    || targetTitle.includes('finalizada')
    || targetTitle.includes('concluida')
    || targetTitle.includes('encerrada');

  const isAgendamentosTarget = canonical === 'agendamentos'
    || targetTitle.includes('agendamento')
    || targetTitle.includes('agenda');

  const isAbandonedTarget = canonical === 'conversas_abandonadas'
    || targetTitle.includes('abandonad');

  if (isFinalizadasTarget) {
    stage = 'Finalizada';
    service = 'conversation_closed';
    handoff = false;
    responseText = 'Atendimento finalizado no painel.';
  } else if (isHumanTarget) {
    stage = 'Atendimento humano';
    service = 'conversation_assigned';
    handoff = true;
    senderType = 'agent';
    sentByUser = agentName || 'Atendente';
    responseText = `Conversa assumida por ${sentByUser}.`;
  } else if (isWaitingHumanTarget) {
    stage = 'Atendimento humano';
    service = 'handoff_requested';
    handoff = true;
    responseText = 'Aguardando atendimento humano.';
  } else if (isAgendamentosTarget) {
    stage = 'Agendamento';
    service = 'agendamento';
    handoff = true;
    responseText = 'Movido para agendamentos.';
  } else if (isAbandonedTarget) {
    stage = 'Finalizada';
    service = 'conversation_abandoned';
    handoff = false;
    responseText = 'Conversa marcada como abandonada.';
  } else {
    stage = targetColObj?.title || 'Qualificacao';
    service = 'ia_active';
    handoff = false;
    responseText = 'Retornado para atendimento da IA.';
  }

  const conversationId = String(card.externalConversationId || card.conversationId || card.id || '');
  const contactName = card.title || card.contactName || 'Contato';
  const channelType = card.channelType || card.channel || 'telegram';
  const nowIso = new Date().toISOString();

  const officialChannel = normalizeChannel(channelType).type;
  if (isFinalizadasTarget && closeConversation && OFFICIAL_CLOSE_CHANNELS.has(officialChannel)) {
    // O encerramento oficial grava o próprio evento de fechamento; um evento interno a mais seria duplicado.
    const closed = await closeConversation({
      tenantSlug,
      channelType: officialChannel,
      externalConversationId: conversationId,
      contactName,
      sentByUser: agentName || 'Operador NORIA',
    });
    return closed?.event ? [closed.event] : [];
  }

  const newEvent = {
    tenant_slug: tenantSlug,
    channel_type: channelType,
    external_conversation_id: conversationId,
    external_message_id: `kanban_move_${Date.now()}`,
    direction: 'internal',
    sender_type: senderType,
    sent_by_user: sentByUser,
    contact_name: contactName,
    message_text: `[Kanban] Etapa alterada para: ${stage}`,
    response_text: responseText,
    service,
    stage,
    handoff,
    delivery_status: 'internal',
    ai_provider: 'kanban_action',
    created_at: nowIso,
    raw_payload: {
      event_type: 'kanban_stage_changed',
      event_category: 'kanban',
      is_internal: true,
      kanban_transition: {
        from_stage: card.stage,
        to_column: canonical || targetColObj?.automationKey || targetColumnKey,
        moved_at: nowIso,
        moved_by: sentByUser || 'Operador',
      },
    },
  };

  const supabase = getClient();
  if (supabase) {
    const tenant = await loadTenant(tenantSlug);
    if (!tenant?.id) throw new Error('Tenant não encontrado ao salvar a movimentação do Kanban.');
    newEvent.tenant_id = tenant.id;
    const { error } = await supabase.from('channel_events').insert([newEvent]);
    if (error) throw error;
    return [newEvent];
  }

  return [newEvent];
}

  return moveKanbanCard;
}

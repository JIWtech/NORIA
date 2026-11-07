import { normalizeExternalConversationId } from '../../services/identity/conversationIdentity.js';
import { formatConversationPreview } from '../../utils/audioUtils.js';
import { normalizeMedia } from '../../services/media/mediaNormalization.js';
import { mediaPreview } from '../../services/media/mediaPresentation.js';
import { cleanAgentName } from '../../services/agents/agentNames.js';

export const OPERATOR_EVENT = 'noria:operator-event';
export const MAX_NOTIFICATIONS = 120;
export const notificationScope = (tenantId, userId) => tenantId && userId ? `noria:notifications:v1:${tenantId}:${userId}` : null;

export function belongsToTenant(row, tenantId, tenantSlug) {
  if (!row || !tenantId) return false;
  if (row.tenant_id && row.tenant_id !== tenantId) return false;
  if (row.tenant_slug && row.tenant_slug !== tenantSlug) return false;
  return row.tenant_id === tenantId || Boolean(tenantSlug && row.tenant_slug === tenantSlug);
}

export function findNotificationConversation(item, conversations) {
  if (!item.chatId) return null;
  const channel = item.channel || 'whatsapp';
  const id = normalizeExternalConversationId(channel, item.chatId);
  return conversations.find(entry => (entry.channelType || entry.channel?.toLowerCase()) === channel
    && normalizeExternalConversationId(channel, entry.externalConversationId) === id) || null;
}

const stageLabels = {
  sales_new: 'Novos contatos', sales_qualifying: 'Em qualificação', sales_hot: 'Lead quente', sales_human: 'Atendimento humano',
  sales_appraisal: 'Avaliação de troca', sales_financing: 'Financiamento', sales_closed: 'Negócio fechado',
  sales_after_sales: 'Pós-venda', sales_warm: 'Lead morno', sales_cold: 'Lead frio', follow_ups: 'Retomada de contato',
};

// No raw error, provider response, phone number or internal stage identifier is shown to the operator.
export function operatorEvents(payload, scope, now = Date.now()) {
  const { tenantId, tenantSlug } = scope;
  const row = payload?.new;
  if (!row?.id || !belongsToTenant(row, tenantId, tenantSlug) || payload.eventType === 'DELETE') return [];
  const old = payload.old || {};
  const inserted = payload.eventType === 'INSERT';
  const raw = typeof row.raw_payload === 'object' && row.raw_payload ? row.raw_payload : {};
  const notifications = [];
  const add = (kind, title, description, category = 'conversations', attention = false, version = '') => {
    notifications.push({ id: `${payload.table}:${row.id}:${kind}:${version}`, tenantId, kind, title, description, category, attention,
      ...(payload.table === 'appointments' ? { appointmentId: row.id, appointmentStatus: row.status } : {}),
      chatId: row.external_conversation_id || row.chat_id || '', channel: row.channel_type || 'whatsapp',
      contact: row.contact_name || '', createdAt: row.updated_at || row.created_at || new Date(now).toISOString(), unread: true });
  };
  if (payload.table === 'channel_events') {
    const service = row.service;
    const media = normalizeMedia(raw, row);
    const assigneeName = cleanAgentName(raw.assignee?.name || raw.assigned_to);
    const serviceEvents = {
      conversation_assigned: ['assignment', 'Conversa atribuída', assigneeName ? `Responsável: ${assigneeName}. Abra a conversa para acompanhar.` : 'Uma conversa recebeu um responsável.', true],
      handoff_requested: ['handoff', 'Cliente precisa da equipe', 'A IA encaminhou o atendimento para uma pessoa. Confira a conversa.', true],
      resume_ai: ['resumed', 'IA retomou o atendimento', 'A conversa voltou para o atendimento automático.', false],
      conversation_closed: ['closed', 'Atendimento encerrado', 'A conversa foi finalizada pela equipe.', false],
      sales_interest: ['interest', 'Cliente demonstrou interesse', 'Confira o interesse do cliente e acompanhe a próxima etapa.', true],
      payment_reported: ['payment', 'Pagamento informado', 'Confira o comprovante antes de confirmar o pagamento.', true],
      appointment_created: ['appointment', 'Novo agendamento', 'Confira o horário e os dados do atendimento.', true],
      follow_up: ['followup', 'Contato de acompanhamento enviado', 'A retomada de contato foi enviada. Acompanhe a resposta do cliente.', false],
      atendimento_humano: ['handoff', 'Cliente precisa da equipe', 'Abra a conversa para dar continuidade ao atendimento.', true],
      pagamento_sinal: ['payment', 'Sinal informado pelo cliente', 'Confira o comprovante antes de confirmar o pagamento.', true],
      appointment_payment_confirmed: ['payment-confirmed', 'Pagamento confirmado', 'O pagamento do agendamento foi confirmado pela equipe.', false],
      appointment_cancelled: ['appointment-cancelled', 'Agendamento cancelado', 'Confira a agenda antes de oferecer um novo horário.', true],
      conversation_reopened: ['reopened', 'Cliente retomou o contato', 'Uma conversa encerrada voltou a receber atendimento.', true],
      technical_error: ['interrupted', 'Atendimento precisa de ajuda', 'O atendimento encontrou uma dificuldade. Abra a conversa para ajudar o cliente.', true],
    };
    if (inserted && serviceEvents[service]) {
      const [kind, title, description, attention] = serviceEvents[service];
      add(kind, title, description, 'conversations', attention);
    } else if (inserted && row.direction === 'inbound' && row.sender_type !== 'system' && !row.is_internal && !raw.is_internal
      && !['reaction', 'non_customer'].includes(service) && !/^\[(?:reaction|secretencrypted)\]$/i.test(row.message_text || '')) {
      const preview = formatConversationPreview(row.message_text || mediaPreview(media), media);
      add('message', 'Nova mensagem de cliente', preview ? preview.slice(0, 180) : 'O cliente enviou uma mensagem. Abra a conversa para responder.');
    } else if (inserted && row.handoff && !raw.is_internal && row.sender_type !== 'system') {
      add('handoff', 'Atendimento humano solicitado', 'Este cliente precisa da atenção da equipe.', 'conversations', true);
    }
    if (['failed', 'error', 'uncertain', 'unknown'].includes(row.delivery_status) && row.delivery_status !== old.delivery_status
      && row.direction === 'outbound') {
      add('delivery', 'Confira o envio da mensagem', 'Não foi possível confirmar a entrega. Confira a conversa antes de tentar enviar novamente.', 'attention', true, row.delivery_status);
    }
    if (['store_failed', 'storage_error', 'persistence_error', 'download_failed', 'verification_failed'].includes(raw.media?.status)
      && raw.media.status !== old.raw_payload?.media?.status) {
      add('attachment', 'Anexo não carregou', 'Abra a conversa para tentar carregar o anexo novamente.', 'attention', true, raw.media.status);
    }
    if (inserted && ['kanban_stage_changed', 'sales_stage_changed', 'kanban_move'].includes(service)) {
      const stage = raw.to_stage || raw.target_stage || row.stage;
      add('stage', 'Etapa do atendimento alterada', stageLabels[stage] ? `Movido para ${stageLabels[stage]}.` : 'O card foi movido para uma nova etapa.', 'leads');
    }
  } else if (payload.table === 'sales_leads') {
    if (inserted) add('lead', 'Novo lead recebido', 'Um novo contato entrou no funil. Acompanhe a qualificação.', 'leads', true);
    else if (row.stage_key !== old.stage_key || row.ai_locked !== old.ai_locked) {
      const stage = row.stage_key;
      const label = stageLabels[stage];
      const title = stage === 'sales_hot' ? 'Lead pronto para avançar' : stage === 'sales_human' || row.ai_locked ? 'Lead precisa da equipe'
        : stage === 'sales_financing' ? 'Financiamento para acompanhar' : stage === 'sales_closed' ? 'Negócio fechado' : 'Lead mudou de etapa';
      add('lead-stage', title, label ? `Etapa atual: ${label}. Confira o card do cliente.` : 'Confira a nova etapa no card do cliente.', 'leads', ['sales_hot', 'sales_human', 'sales_financing', 'sales_appraisal'].includes(stage) || row.ai_locked === true, `${row.revision || row.updated_at || stage}`);
    }
    if (!inserted && row.stage_key === old.stage_key && row.hot === true && old.hot !== true) {
      add('hot-lead', 'Lead pronto para avançar', 'O cliente demonstrou interesse. Confira a qualificação e dê continuidade ao atendimento.', 'leads', true, row.revision || row.updated_at || 'hot');
    }
  } else if (payload.table === 'appointments') {
    const labels = { confirmed: 'Agendamento confirmado', cancelled: 'Agendamento cancelado', done: 'Atendimento concluído', payment_reported: 'Pagamento informado', aguardando_verificacao: 'Pagamento aguardando conferência', pending_payment: 'Agendamento aguarda pagamento', pending_confirmation: 'Pedido aguardando confirmação' };
    if (inserted || row.status !== old.status || row.starts_at !== old.starts_at) {
      const date = row.starts_at && new Date(row.starts_at);
      const when = date && Number.isFinite(date.getTime()) ? date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
      const title = row.status === 'pending_confirmation' ? labels[row.status]
        : inserted ? 'Novo agendamento' : labels[row.status] || 'Horário do agendamento alterado';
      add('appointment', title,
        ['payment_reported', 'aguardando_verificacao'].includes(row.status) ? 'Confira o comprovante para confirmar o pagamento.' : `Confira os dados do agendamento${when ? ` de ${when}` : ''}.`,
        'appointments', row.status !== 'done', `${row.status}:${row.starts_at}`);
    }
  } else if (payload.table === 'broadcast_campaigns' && row.status !== old.status) {
    const labels = { sent: ['Campanha concluída', 'Os envios da campanha foram concluídos.'], partial_error: ['Campanha com envios pendentes', 'Algumas mensagens não foram entregues. Confira os resultados.'], failed: ['Campanha não foi enviada', 'Abra a campanha para verificar os envios.'], paused: ['Campanha pausada', 'Os próximos envios estão pausados.'], cancelled: ['Campanha cancelada', 'Os próximos envios foram cancelados.'] };
    if (labels[row.status]) add('campaign', ...labels[row.status], 'campaigns', ['partial_error', 'failed'].includes(row.status), row.status);
  }
  return notifications;
}

export function appointmentReminders(appointments, tenantId, now = Date.now()) {
  return appointments.flatMap(appointment => {
    const starts = Date.parse(appointment.startsAt || '');
    if (!['scheduled', 'confirmed'].includes(appointment.status) || !Number.isFinite(starts) || starts < now || starts > now + 15 * 60_000) return [];
    return [{ id: `reminder:${appointment.id}:${appointment.startsAt}`, tenantId, kind: 'reminder', title: 'Agendamento em breve',
      description: `Atendimento às ${new Date(starts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}. Confira os detalhes e prepare o atendimento.`,
      category: 'appointments', attention: true, contact: appointment.contactName || '', chatId: appointment.externalConversationId || '', channel: appointment.channelType || 'whatsapp', createdAt: new Date(now).toISOString(), unread: true }];
  });
}

export function mergeOperatorNotifications(previous, incoming) {
  const items = new Map(previous.map(item => [item.id, item]));
  for (const item of incoming) if (!items.has(item.id)) items.set(item.id, item);
  return [...items.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, MAX_NOTIFICATIONS);
}

export function followUpReminders(columns, tenantId, now = Date.now()) {
  return columns.flatMap(column => (column.cards || []).flatMap(card => {
    const due = Date.parse(card.followUpDueAt || '');
    if (!card.isFollowUp || card.followUpStatus !== 'pending' || !Number.isFinite(due) || due > now || due < now - 24 * 60 * 60_000) return [];
    return [{ id: `followup-due:${card.id}:${card.followUpDueAt}`, tenantId, kind: 'followup-due', title: 'Retomada de contato prevista para agora',
      description: 'O horário programado chegou. Acompanhe o envio e a resposta do cliente.', category: 'leads', attention: true,
      chatId: card.externalConversationId || '', channel: card.channelType || 'whatsapp', contact: card.title || '', createdAt: new Date(due).toISOString(), unread: true }];
  }));
}

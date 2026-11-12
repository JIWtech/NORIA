import { asObject } from '../../utils/asObject.js';
import { isOutcomeTrackingEnabled } from './appointmentOutcome.js';
import { appointmentServicesLabel, normalizeSearchText } from './appointmentAgenda.js';

// Mensagem de "cliente não veio": prévia editável com o sinal para reagendar.
// Nada do tenant fica fixo aqui: template, Pix e fuso vêm de tenant_settings; os preços, de
// tenant_service_catalog. O sinal é 50% do valor do catálogo (decisão do produto).

export const NO_SHOW_DEPOSIT_PERCENT = 50;
export const MISSING_VALUE_MARKER = '[informe o valor]';
export const DEFAULT_NO_SHOW_TEMPLATE = 'Olá, {nome}! Sentimos sua falta no horário de {data} às {hora} ({servicos}). '
  + 'Para agendar de novo, pedimos um sinal de 50% do valor do serviço: {valor_sinal}, pelo Pix {pix_key} ({pix_holder}). '
  + 'Depois é só enviar o comprovante por aqui e escolher o novo horário.';

export function noShowMessageConfig(tenantSettings, appointment) {
  const settings = asObject(tenantSettings?.settings);
  const payment = asObject(settings.payment);
  const outcome = asObject(settings.appointment_outcome);
  const pixKey = String(payment.pix_key || '').trim();
  const hasWhatsApp = String(appointment?.channelType || '').toLowerCase() === 'whatsapp'
    && Boolean(String(appointment?.externalConversationId || '').trim());
  const template = String(outcome.no_show_message_template || '').trim() || DEFAULT_NO_SHOW_TEMPLATE;
  return {
    enabled: isOutcomeTrackingEnabled(tenantSettings) && Boolean(pixKey) && hasWhatsApp,
    template,
    pixKey,
    pixHolder: String(payment.pix_holder || '').trim(),
    timeZone: tenantSettings?.timezone || undefined,
  };
}

function wantedServices(appointment) {
  const metadata = asObject(appointment?.raw?.metadata);
  const names = (Array.isArray(metadata.services) ? metadata.services : []).map((name) => String(name || '').trim()).filter(Boolean);
  if (names.length) return names;
  const serviceId = String(metadata.service_id || '').trim();
  return serviceId ? [serviceId] : [];
}

export function noShowDeposit(appointment, catalog = []) {
  const entries = Array.isArray(catalog) ? catalog : [];
  let totalCents = 0;
  let from = false;
  const missing = [];
  for (const wanted of wantedServices(appointment)) {
    const key = normalizeSearchText(wanted);
    const entry = entries.find((item) => normalizeSearchText(item?.name) === key || normalizeSearchText(item?.external_id) === key);
    if (!entry) { missing.push(wanted); continue; }
    if (String(asObject(entry.metadata).price_type || '').toLowerCase() === 'from') from = true;
    const price = Number(entry.price);
    if (entry.price === null || entry.price === undefined || entry.price === '' || !Number.isFinite(price) || price <= 0) {
      missing.push(entry.name || wanted);
      continue;
    }
    totalCents += Math.round(price * 100);
  }
  const cents = missing.length || !totalCents ? 0 : Math.round(totalCents * NO_SHOW_DEPOSIT_PERCENT / 100);
  return { cents, from, missing };
}

export function formatBrl(cents) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function renderNoShowMessage(template, values) {
  return String(template || '').replace(/\{(nome|servicos|data|hora|valor_sinal|pix_key|pix_holder)\}/g, (_, key) => values[key] ?? '');
}

function formatInZone(epoch, timeZone, options) {
  try {
    return new Intl.DateTimeFormat('pt-BR', timeZone ? { ...options, timeZone } : options).format(new Date(epoch));
  } catch {
    return new Intl.DateTimeFormat('pt-BR', options).format(new Date(epoch));
  }
}

export function buildNoShowPreview(appointment, { catalog = [], tenantSettings } = {}) {
  const config = noShowMessageConfig(tenantSettings, appointment);
  const deposit = noShowDeposit(appointment, catalog);
  const start = Date.parse(appointment?.startsAt || '');
  const warnings = [];
  if (deposit.missing.length) {
    warnings.push(`Sem preço no catálogo para: ${deposit.missing.join(', ')}. Informe o valor do sinal antes de enviar.`);
  }
  if (deposit.from) warnings.push('O valor de um ou mais serviços é "a partir de": o sinal mostrado é o mínimo.');
  const value = deposit.cents ? `${deposit.from ? 'a partir de ' : ''}${formatBrl(deposit.cents)}` : MISSING_VALUE_MARKER;
  const firstName = String(appointment?.contactName || '').trim().split(/\s+/)[0] || '';
  const text = renderNoShowMessage(config.template, {
    nome: firstName,
    servicos: appointmentServicesLabel(appointment),
    data: Number.isFinite(start) ? formatInZone(start, config.timeZone, { day: '2-digit', month: '2-digit' }) : '',
    hora: Number.isFinite(start) ? formatInZone(start, config.timeZone, { hour: '2-digit', minute: '2-digit' }) : '',
    valor_sinal: value,
    pix_key: config.pixKey,
    pix_holder: config.pixHolder,
  }).replace(/\s+([,.!?])/g, '$1').replace(/ {2,}/g, ' ').trim();
  return { text, warnings, deposit, canSend: !text.includes(MISSING_VALUE_MARKER) };
}

function flowError(message, messageSent, cause) {
  const error = new Error(message);
  error.messageSent = messageSent;
  if (cause) error.cause = cause;
  return error;
}

// A mensagem sai ANTES do registro da falta. O registro (magia_mark_appointment_outcome) grava
// conversation_closed; um manual_reply depois dele deixaria o último controle da conversa como
// atendimento humano e a próxima mensagem da cliente cairia na fila humana.
export async function sendNoShowMessageThenMark({ appointment, text, tenantSlug, sentBy = 'Operador NORIA', sendCommand, markOutcome }) {
  const message = String(text || '').trim();
  if (!message) throw flowError('Escreva a mensagem antes de enviar.', false);
  if (message.includes(MISSING_VALUE_MARKER)) throw flowError('Informe o valor do sinal antes de enviar.', false);
  try {
    const result = await sendCommand('manual_reply', {
      channel_type: appointment.channelType || 'whatsapp',
      external_conversation_id: appointment.externalConversationId,
      contact_name: appointment.contactName || 'Cliente',
      message_text: message,
      sent_by_user: sentBy,
    }, tenantSlug);
    if (result && result.ok === false) throw new Error(result.error || 'Não foi possível enviar a mensagem.');
  } catch (error) {
    throw flowError(error?.message || 'Não foi possível enviar a mensagem.', false, error);
  }
  try {
    return await markOutcome(appointment.id, 'no_show');
  } catch (error) {
    throw flowError(`A mensagem foi enviada, mas a falta não foi registrada (${error?.message || 'erro desconhecido'}). Registre a falta de novo sem reenviar.`, true, error);
  }
}

// O Kanban guarda o agendamento achatado no card; a prévia trabalha com o formato de mapAppointment.
export function appointmentFromKanbanCard(card = {}) {
  return {
    id: card.appointmentId,
    status: card.appointmentStatus,
    startsAt: card.appointmentStartsAt,
    title: card.appointmentTitle || '',
    contactName: card.title || '',
    channelType: card.channelType || '',
    externalConversationId: card.externalConversationId || '',
    raw: { metadata: card.appointmentMetadata || {} },
  };
}

export function createLoadServiceCatalog({ getClient, loadTenant }) {
  return async function loadServiceCatalog(activeTenantSlug) {
    try {
      const supabase = getClient();
      if (!supabase) return [];
      const tenant = await loadTenant(activeTenantSlug);
      if (!tenant?.id) return [];
      const { data, error } = await supabase.from('tenant_service_catalog')
        .select('external_id,name,price,metadata').eq('tenant_id', tenant.id).eq('active', true);
      if (error) {
        console.warn('Service catalog fallback:', error.message);
        return [];
      }
      return data || [];
    } catch (error) {
      console.warn('Service catalog fallback:', error?.message || error);
      return [];
    }
  };
}

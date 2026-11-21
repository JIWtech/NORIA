import { getValidatedSession } from './auth/authService.js';
import { isEligibleForExternalOutbound } from './timeline/eventClassification.js';

const env = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || '',
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
  n8nBaseUrl: import.meta.env.VITE_N8N_BASE_URL || 'http://localhost:5678',
  tenantSlug: import.meta.env.VITE_TENANT_SLUG || 'jiw',
};

export function getIntegrationStatus(activeTenantSlug = env.tenantSlug) {
  return {
    supabase: Boolean(env.supabaseUrl && env.supabaseAnonKey),
    n8n: Boolean(env.n8nBaseUrl),
    tenantSlug: activeTenantSlug,
    mode: env.supabaseUrl ? 'integravel' : 'mock',
  };
}

async function sendCommand(command, payload, activeTenantSlug, { external = true } = {}) {
  const outboundCandidate = {
    ...payload,
    event_type: payload?.event_type || command,
    raw_payload: payload?.raw_payload || payload,
  };
  if (external && !isEligibleForExternalOutbound(outboundCandidate)) {
    throw new Error('Eventos operacionais internos não podem ser enviados para canais externos.');
  }

  const url = `${env.n8nBaseUrl.replace(/\/$/, '')}/webhook/magia-command`;
  const isKanbanFlowCommand = command === 'suggest_kanban_flow_order' || command === 'apply_kanban_flow_order';
  let session = await getValidatedSession();
  if (!session?.access_token) {
    throw new Error('Sessão expirada. Entre novamente para enviar mensagens.');
  }

  if (isKanbanFlowCommand) {
    console.info('[Kanban flow] command request', { command, endpoint: url, tenantSlug: activeTenantSlug, payload });
  }

  const post = (accessToken) => fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      tenant_slug: activeTenantSlug,
      command,
      payload,
    }),
  });

  let response;
  try {
    response = await post(session.access_token);
    // A 401/403 can mean the token went stale between validation and delivery.
    // Renew once through Auth; a genuine authorization denial stays denied.
    if (response.status === 401 || response.status === 403) {
      const renewed = await getValidatedSession({ forceRefresh: true });
      if (!renewed?.access_token) throw new Error('Sessão expirada. Entre novamente para enviar mensagens.');
      if (renewed.access_token !== session.access_token) response = await post(renewed.access_token);
    }
  } catch (error) {
    if (isKanbanFlowCommand) console.error('[Kanban flow] endpoint request failed', { command, endpoint: url, error });
    throw error;
  }

  const text = await response.text().catch(() => '');
  if (isKanbanFlowCommand) {
    console.info('[Kanban flow] command response', { command, endpoint: url, status: response.status, response: text });
  }

  if (!response.ok) {
    throw new Error(`n8n command failed: ${response.status} ${text}`);
  }

  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    if (isKanbanFlowCommand) console.error('[Kanban flow] invalid JSON response', { command, endpoint: url, status: response.status, response: text, error });
    throw new Error('n8n command returned invalid JSON');
  }
  if (data?.ok === false) {
    if (String(data.error || '').startsWith('TURN_CONTROL_RPC_UNAVAILABLE:')) {
      throw new Error('Não foi possível alterar o atendimento: a atualização do banco e do workflow está incompleta. A operação não foi confirmada.');
    }
    throw new Error(data.error || 'n8n command failed');
  }

  return data;
}

export async function sendN8nCommand(command, payload, activeTenantSlug = env.tenantSlug) {
  return sendCommand(command, payload, activeTenantSlug, { external: true });
}

export async function requestKanbanFlowSuggestion(payload, activeTenantSlug = env.tenantSlug) {
  return sendCommand('suggest_kanban_flow_order', payload, activeTenantSlug, { external: false });
}

export async function applyKanbanFlowOrder(payload, activeTenantSlug = env.tenantSlug) {
  return sendCommand('apply_kanban_flow_order', payload, activeTenantSlug, { external: false });
}

export async function requestCatalogProductRefresh(payload, activeTenantSlug = env.tenantSlug) {
  return sendCommand('refresh_whatsapp_catalog_products', payload, activeTenantSlug, { external: false });
}

export const integrationTargets = [
  {
    area: 'Conversas',
    table: 'conversations, messages, conversation_events',
    webhook: 'webhook/telegram?tenant_slug={tenant_slug}',
    status: 'ativo_telegram',
  },
  {
    area: 'Kanban',
    table: 'kanban_boards, kanban_columns, kanban_cards',
    webhook: 'n8n rules mock',
    status: 'mockado',
  },
  {
    area: 'Funil',
    table: 'funnels, funnel_stages, opportunities',
    webhook: 'n8n rules mock',
    status: 'mockado',
  },
  {
    area: 'Automações',
    table: 'automation_rules, automation_executions',
    webhook: 'Telegram Multi-tenant + Command Router',
    status: 'ativo_parcial',
  },
  {
    area: 'IA',
    table: 'ai_agents, ai_prompt_versions, knowledge_bases',
    webhook: 'Gemini por tenant via n8n',
    status: 'ativo_com_quota',
  },
];

async function main(helpers) {
  const input = typeof $json.body === 'string' ? JSON.parse($json.body || '{}') : ($json.body || $json);
  const headers = $json.headers || {};

  function env(name, fallback = '') {
    let envValue = '';
    let varsValue = '';
    try { envValue = $env[name] || ''; } catch (error) {}
    try { varsValue = $vars?.[name] || ''; } catch (error) {}
    return envValue || varsValue || fallback;
  }

  function required(value, label) {
    if (value === undefined || value === null || String(value).trim() === '') {
      throw new Error(label + ' obrigatorio');
    }
    return String(value).trim();
  }

  function envSuffix(tenantSlug) {
    return String(tenantSlug || '').toUpperCase().replace(/[^A-Z0-9]/g, '_');
  }

  function bearerToken() {
    const header = headers.authorization || headers.Authorization || input.authorization || '';
    const match = String(header).match(/^Bearer\s+(.+)$/i);
    return match ? match[1].trim() : String(input.access_token || '').trim();
  }

  function supabaseConfig() {
    const supabaseUrl = env('SUPABASE_URL').replace(/\/$/, '');
    const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = env('SUPABASE_ANON_KEY') || serviceKey;
    if (!supabaseUrl || !serviceKey) throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam estar configurados no n8n');
    return { supabaseUrl, serviceKey, anonKey };
  }

  function serviceHeaders(prefer) {
    const { serviceKey } = supabaseConfig();
    return {
      'Content-Type': 'application/json',
      apikey: serviceKey,
      Authorization: 'Bearer ' + serviceKey,
      ...(prefer ? { Prefer: prefer } : {}),
    };
  }

  async function httpJson(method, url, headers = {}, payload = null) {
    return await helpers.httpRequest({
      method,
      url,
      headers,
      ...(payload === null ? {} : { body: payload }),
      json: true,
      timeout: 15000,
    });
  }

  async function validateUserSession() {
    const token = bearerToken();
    if (!token) throw new Error('Authorization Bearer ausente');
    const { supabaseUrl, anonKey } = supabaseConfig();
    const user = await httpJson('GET', supabaseUrl + '/auth/v1/user', {
      apikey: anonKey,
      Authorization: 'Bearer ' + token,
    });
    if (!user?.id) throw new Error('Sessao Supabase invalida');
    return user;
  }

  async function loadTenant(tenantSlug) {
    const { supabaseUrl } = supabaseConfig();
    const rows = await httpJson(
      'GET',
      supabaseUrl + '/rest/v1/tenants?select=id,slug,name,industry,status&slug=eq.' + encodeURIComponent(tenantSlug) + '&limit=1',
      serviceHeaders(),
    );
    const tenant = Array.isArray(rows) ? rows[0] : null;
    if (!tenant) throw new Error('Tenant nao encontrado: ' + tenantSlug);
    if (tenant.status && !['active', 'trial', 'pilot', 'Piloto'].includes(String(tenant.status))) {
      throw new Error('Tenant inativo: ' + tenantSlug);
    }
    return tenant;
  }

  async function assertTenantMember(userId, tenantId, allowedRoles = ['owner', 'admin', 'manager', 'agent', 'operator']) {
    const { supabaseUrl } = supabaseConfig();
    const rows = await httpJson(
      'GET',
      supabaseUrl
        + '/rest/v1/tenant_members?select=role,status&tenant_id=eq.' + encodeURIComponent(tenantId)
        + '&user_id=eq.' + encodeURIComponent(userId)
        + '&status=eq.active&limit=1',
      serviceHeaders(),
    );
    const membership = Array.isArray(rows) ? rows[0] : null;
    if (!membership) throw new Error('Usuario sem permissao para este tenant');
    if (!allowedRoles.includes(String(membership.role))) {
      throw new Error('Role sem permissao para enviar mensagens');
    }
    return membership;
  }

  function tokenFor(tenantSlug, channelType) {
    const suffix = envSuffix(tenantSlug);
    if (channelType === 'telegram') return env('TELEGRAM_BOT_TOKEN_' + suffix);
    if (channelType === 'instagram' || channelType === 'instagram_direct') return env('INSTAGRAM_PAGE_ACCESS_TOKEN_' + suffix);
    return '';
  }

  function evolutionFor(tenantSlug) {
    const suffix = envSuffix(tenantSlug);
    return {
      baseUrl: env('EVOLUTION_API_URL_' + suffix),
      apiKey: env('EVOLUTION_API_KEY_' + suffix),
      instance: env('EVOLUTION_INSTANCE_' + suffix),
    };
  }

  async function insertEvent(event) {
    const { supabaseUrl, anonKey } = supabaseConfig();
    if (event.channel_type === 'whatsapp' && (event.sender_type === 'human'
      || ['conversation_closed', 'conversation_assigned', 'resume_ai', 'appointment_payment_confirmed', 'manual_reply', 'handoff_requested'].includes(event.service))) {
      let saved;
      try {
        saved = await httpJson('POST', supabaseUrl + '/rest/v1/rpc/magia_record_turn_control_event', {
          apikey: anonKey, Authorization: 'Bearer ' + bearerToken(), 'Content-Type': 'application/json',
        }, { p_event: event });
      } catch (error) {
        const status = Number(error?.statusCode || error?.response?.status || error?.response?.statusCode || 0);
        if (status === 404 || error?.response?.data?.code === 'PGRST202') {
          throw new Error('TURN_CONTROL_RPC_UNAVAILABLE: O banco e o workflow precisam da implantação coordenada do controle de atendimento. A operação não foi confirmada.');
        }
        throw error;
      }
      if (!(Array.isArray(saved) ? saved[0] : saved)?.id) throw new Error('CONTROL_ORIGIN_NOT_PERSISTED');
      return saved;
    }
    return await httpJson('POST', supabaseUrl + '/rest/v1/channel_events', serviceHeaders('return=representation'), event);
  }

  // O envio e a mudança do agendamento já aconteceram: falha ao gravar o evento no histórico não pode virar erro
  // (o painel diria "não enviado" e ofereceria novo envio). Devolve null e o chamador sinaliza o aviso.
  async function recordSentEvent(event) {
    try { return await insertEvent(event); } catch (error) {
      if (String(error?.message || '').startsWith('TURN_CONTROL_RPC_UNAVAILABLE')) throw error;
      return null;
    }
  }
  const eventWarning = saved => (saved ? {} : { event_warning: 'EVENT_NOT_RECORDED' });

  async function loadTenantSettings(tenantId) {
    const { supabaseUrl } = supabaseConfig();
    const rows = await httpJson(
      'GET',
      supabaseUrl + '/rest/v1/tenant_settings?select=settings,timezone&tenant_id=eq.' + encodeURIComponent(tenantId) + '&limit=1',
      serviceHeaders(),
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    // O fuso do tenant fica na coluna timezone; sem ela, vale o que estiver em settings.
    const settings = row?.settings || {};
    const columnZone = String(row?.timezone || '').trim();
    return columnZone ? { ...settings, timezone: columnZone } : settings;
  }

  async function loadKanbanColumns(tenantId, boardId) {
    const { supabaseUrl } = supabaseConfig();
    const rows = await httpJson(
      'GET',
      supabaseUrl + '/rest/v1/kanban_columns?select=id,name,automation_key,position&tenant_id=eq.' + encodeURIComponent(tenantId)
        + '&board_id=eq.' + encodeURIComponent(boardId) + '&order=position.asc',
      serviceHeaders(),
    );
    return Array.isArray(rows) ? rows : [];
  }

  function validateKanbanOrder(existing, orderedAutomationKeys) {
    const expected = existing.map((column) => String(column.automation_key || '')).filter(Boolean);
    const suggested = Array.isArray(orderedAutomationKeys) ? orderedAutomationKeys.map((key) => String(key || '').trim()).filter(Boolean) : [];
    return expected.length > 0 && suggested.length === expected.length
      && new Set(suggested).size === suggested.length
      && expected.every((key) => suggested.includes(key));
  }

  async function suggestKanbanFlowOrder(tenant, payload) {
    const columns = await loadKanbanColumns(tenant.id, required(payload.boardId, 'payload.boardId'));
    if (!columns.length) throw new Error('Kanban sem colunas configuradas');
    const settings = await loadTenantSettings(tenant.id);
    const contextColumns = columns.map((column) => ({
      name: column.name,
      automation_key: column.automation_key,
      kind: ['verificar_sinal', 'agendamentos', 'conversas_abandonadas', 'follow_ups'].includes(column.automation_key) ? 'special_view' : 'stage',
    }));
    const prompt = `Organize somente a ordem visual das colunas do Kanban para o tenant. Nao crie, remova, renomeie nem altere automation_key. Etapas sao operacionais; special_view sao visoes derivadas e podem ficar depois do fluxo principal. Responda APENAS JSON valido: {"orderedAutomationKeys":[...],"reasoning":"..."}. Tenant: ${tenant.name || tenant.slug}. Segmento: ${tenant.industry || settings.business_context || settings.industry || ''}. Colunas: ${JSON.stringify(contextColumns)}`;
    const model = env('GEMINI_MODEL', 'gemini-2.5-flash-lite');
    const body = await httpJson('POST', `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      'Content-Type': 'application/json',
      'x-goog-api-key': env('GEMINI_API_KEY'),
    }, { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 500, responseMimeType: 'application/json' } });
    const text = body?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
    if (!text) throw new Error('Gemini sem proposta de fluxo');
    let proposal;
    try { proposal = JSON.parse(text); } catch (error) { throw new Error('Gemini retornou proposta invalida'); }
    if (!validateKanbanOrder(columns, proposal?.orderedAutomationKeys)) throw new Error('Gemini retornou colunas invalidas');
    return { proposal: { orderedAutomationKeys: proposal.orderedAutomationKeys, reasoning: String(proposal.reasoning || '').trim() } };
  }

  async function applyKanbanFlowOrder(tenant, payload) {
    const boardId = required(payload.boardId, 'payload.boardId');
    const columns = await loadKanbanColumns(tenant.id, boardId);
    if (!validateKanbanOrder(columns, payload.orderedAutomationKeys)) throw new Error('Ordem de colunas invalida');
    const { supabaseUrl } = supabaseConfig();
    await httpJson('POST', supabaseUrl + '/rest/v1/rpc/reorder_kanban_columns', serviceHeaders(), {
      p_tenant_id: tenant.id,
      p_board_id: boardId,
      p_positions: payload.orderedAutomationKeys.map((automation_key, position) => ({ automation_key, position })),
    });
    return { ok: true, board_id: boardId, orderedAutomation_keys: payload.orderedAutomationKeys };
  }

  function paymentSignalConfirmationMessage(settings = {}) {
    const payment = settings.payment && typeof settings.payment === 'object' ? settings.payment : {};
    const configured = String(settings.payment_signal_confirmation_message || payment.confirmation_message || '').trim();
    if (configured) return configured;
    return 'Reserva confirmada! Recebemos a confirmacao do sinal. A equipe vai seguir com a confirmacao final por aqui.';
  }

  function renderAppointmentRequest(template, row, settings) {
    const timeZone = String(settings.timezone || 'America/Sao_Paulo');
    const start = new Date(row.starts_at);
    const values = {
      nome: row.contact_name || '',
      servicos: (row.metadata?.services || []).join(' e '),
      data: new Intl.DateTimeFormat('pt-BR', { timeZone, weekday: 'long', day: 'numeric', month: 'long' }).format(start),
      hora: new Intl.DateTimeFormat('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(start),
    };
    const text = String(template || '').replace(/\{(nome|servicos|data|hora)\}/g, (_, key) => values[key]);
    if (/[{}]/.test(text) || !text.trim()) throw new Error('Modelo de mensagem invalido. Revise a configuracao do pedido.');
    return text.trim();
  }

  // Fuso do tenant: data e hora "de parede" -> instante (sem bibliotecas). NaN se inválido.
  function zonedWallToEpoch(date, time, timeZone) {
    const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || '')), tm = /^(\d{2}):(\d{2})$/.exec(String(time || ''));
    if (!dm || !tm) return NaN;
    const wall = Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]));
    let guess = wall;
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(guess))
          .filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
        guess = wall - (Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - guess);
      }
    } catch (error) { return NaN; }
    return guess;
  }

  async function loadTenantTimezone(tenantId) {
    const { supabaseUrl } = supabaseConfig();
    const rows = await httpJson('GET', supabaseUrl + '/rest/v1/tenant_settings?select=timezone&tenant_id=eq.' + encodeURIComponent(tenantId) + '&limit=1', serviceHeaders());
    return String((Array.isArray(rows) ? rows[0]?.timezone : '') || 'America/Sao_Paulo');
  }

  // Parsing técnico dos campos estruturados devolvidos pelo Gemini (não analisa prosa).
  function normalizeTimeField(value) {
    const match = /^(\d{1,2})(?:[:h](\d{2})?)?h?$/.exec(String(value || '').toLowerCase().replace(/\s+/g, ''));
    if (!match) return '';
    const hour = Number(match[1]), minute = match[2] === undefined ? 0 : Number(match[2]);
    return hour > 23 || minute > 59 ? '' : String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
  }
  function sameDateField(value, expectedIso) {
    const text = String(value || '').trim();
    const br = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(text), iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    let day, month, year = null;
    if (br) { day = Number(br[1]); month = Number(br[2]); year = br[3] ? Number(br[3].length === 2 ? '20' + br[3] : br[3]) : null; }
    else if (iso) { year = Number(iso[1]); month = Number(iso[2]); day = Number(iso[3]); }
    else return false;
    return day === Number(expectedIso.slice(8, 10)) && month === Number(expectedIso.slice(5, 7)) && (year === null || year === Number(expectedIso.slice(0, 4)));
  }
  function plainKey(value) { return String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase(); }

  // Parsing técnico do texto final: procura a data (dd/mm, "dia 29", "29 de setembro", aaaa-mm-dd) e a hora (14:00, 14h, 14h30, 14 horas).
  function textMentionsSchedule(text, isoDate, hhmm) {
    const plain = plainKey(text);
    const day = Number(isoDate.slice(8, 10)), month = Number(isoDate.slice(5, 7));
    const months = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    const d = '0?' + day, m = '0?' + month;
    const dateOk = new RegExp('(?<!\\d)' + d + '\\s*/\\s*' + m + '(?!\\d)').test(plain)
      || new RegExp('(?<!\\d)' + d + '\\s+de\\s+' + months[month - 1] + '(?![a-z])').test(plain)
      || new RegExp('\\bdia\\s+' + d + '(?!\\d)').test(plain)
      || plain.includes(isoDate);
    const hour = Number(hhmm.slice(0, 2)), minute = Number(hhmm.slice(3, 5));
    const h = '0?' + hour;
    const timeOk = minute === 0
      ? new RegExp('(?<!\\d)' + h + '\\s*(?::00|h00|h|\\s+horas?)(?!\\d)').test(plain)
      : new RegExp('(?<!\\d)' + h + '\\s*(?::|h)\\s*' + String(minute).padStart(2, '0') + '(?!\\d)').test(plain);
    return dateOk && timeOk;
  }
  // O Gemini redige; o código só confere os dados estruturados que ele declara ter usado.
  // expected: { date: 'AAAA-MM-DD', time: 'HH:MM', services?: [], template?: string }. Devolve o texto ou lança.
  async function composeWithGemini(settings, tenant, row, purpose, expected, extraFacts = {}) {
    const model = env('GEMINI_MODEL', 'gemini-2.5-flash-lite');
    const key = required(env('GEMINI_API_KEY'), 'GEMINI_API_KEY');
    if (!/^gemini-[a-z0-9.-]+$/i.test(model)) throw new Error('Modelo Gemini invalido');
    // Data por extenso para o texto à cliente ("terça-feira, 29 de setembro"); o campo estruturado conferido segue DD/MM/AAAA.
    const [isoYear, isoMonth, isoDay] = expected.date.split('-').map(Number);
    const displayDate = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' })
      .format(new Date(Date.UTC(isoYear, isoMonth - 1, isoDay, 12)));
    const facts = { empresa: tenant.name || tenant.slug, tom: String(settings.tone || '').slice(0, 400), cliente: row.contact_name || '',
      servicos: expected.services || row.metadata?.services || [], data: displayDate, hora: expected.time, ...extraFacts,
      ...(expected.template ? { modelo_do_estabelecimento: expected.template } : {}) };
    const prompt = purpose + ' Escreva em português brasileiro, no tom do estabelecimento descrito em tom, como atendente da equipe (no feminino); trate a pessoa atendida de forma neutra, sem presumir gênero. Use somente os dados fornecidos, sem inventar fatos, disponibilidade ou promessas. '
      + (expected.template ? 'O modelo_do_estabelecimento traz informações e avisos obrigatórios do estabelecimento: reescreva com naturalidade, mas preserve todas elas (sem copiar a forma); marque avisos_do_modelo_mantidos como verdadeiro somente se nenhuma foi omitida. ' : '')
      + 'Informe também, nos campos estruturados, a data no formato DD/MM (sem ano), a hora no formato HH:MM e os serviços exatamente como aparecem na mensagem. Não inclua instruções internas nem aspas. Dados: ' + JSON.stringify(facts);
    const schema = { type: 'OBJECT', properties: { text: { type: 'STRING' }, date: { type: 'STRING' }, time: { type: 'STRING' },
      services: { type: 'ARRAY', items: { type: 'STRING' } }, avisos_do_modelo_mantidos: { type: 'BOOLEAN' } }, required: ['text', 'date', 'time'] };
    const generated = await httpJson('POST', `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      // Modelos com raciocínio gastam parte do limite pensando: 600 cortava a resposta (MAX_TOKENS) e a mensagem caía no modelo fixo.
      { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4, maxOutputTokens: 4096, responseMimeType: 'application/json', responseSchema: schema } });
    const raw = generated?.candidates?.[0]?.content?.parts?.filter(part => !part.thought).map(part => part.text || '').join('').trim();
    let value;
    try { value = JSON.parse(raw || ''); } catch (error) { throw new Error('Gemini nao devolveu mensagem estruturada'); }
    const text = String(value?.text || '').trim();
    if (!text) throw new Error('Gemini nao gerou mensagem');
    if (!sameDateField(value.date, expected.date) || normalizeTimeField(value.time) !== expected.time) throw new Error('Gemini nao gerou mensagem com data e horario exatos');
    // Os campos estruturados estão corretos, mas o texto enviado ao cliente também precisa trazer a data e a hora.
    if (!textMentionsSchedule(text, expected.date, expected.time)) throw new Error('Gemini nao citou data e horario no texto da mensagem');
    if (Array.isArray(expected.services) && expected.services.length) {
      const used = new Set((Array.isArray(value.services) ? value.services : []).map(plainKey));
      if (!expected.services.every(service => used.has(plainKey(service)))) throw new Error('Gemini nao citou os servicos do pedido');
    }
    if (expected.template && value.avisos_do_modelo_mantidos !== true) throw new Error('Gemini omitiu avisos obrigatorios do modelo');
    return { text, model };
  }

  async function confirmAppointment(tenantId, appointmentId) {
    const { supabaseUrl } = supabaseConfig();
    const rows = await httpJson(
      'GET',
      supabaseUrl + '/rest/v1/appointments?select=id,metadata,status&tenant_id=eq.' + encodeURIComponent(tenantId) + '&id=eq.' + encodeURIComponent(appointmentId) + '&limit=1',
      serviceHeaders(),
    );
    const appointment = Array.isArray(rows) ? rows[0] : null;
    if (!appointment) throw new Error('Agendamento nao encontrado: ' + appointmentId);
    const metadata = {
      ...(appointment.metadata || {}),
      payment_status: 'confirmed_by_operator',
      payment_confirmed_at: new Date().toISOString(),
    };
    const updated = await httpJson(
      'PATCH',
      supabaseUrl + '/rest/v1/appointments?tenant_id=eq.' + encodeURIComponent(tenantId) + '&id=eq.' + encodeURIComponent(appointmentId),
      serviceHeaders('return=representation'),
      {
        status: 'confirmed',
        metadata,
        updated_at: new Date().toISOString(),
      },
    );
    return Array.isArray(updated) ? updated[0] : updated;
  }

  async function sendTelegram(token, chatId, text) {
    const body = await httpJson('POST', 'https://api.telegram.org/bot' + token + '/sendMessage', {
      'Content-Type': 'application/json',
    }, { chat_id: chatId, text, disable_web_page_preview: true });
    if (!body || body.ok === false) throw new Error(body?.description || 'Falha ao enviar mensagem no Telegram');
    return { provider: 'telegram', raw: body, messageId: body?.result?.message_id ? String(body.result.message_id) : '' };
  }

  async function sendInstagram(token, recipientId, text) {
    const body = await httpJson('POST', 'https://graph.facebook.com/v18.0/me/messages', {
      'Content-Type': 'application/json',
    }, { recipient: { id: recipientId }, message: { text } });
    if (!body || body.error) throw new Error(body?.error?.message || 'Falha ao enviar DM no Instagram');
    return { provider: 'instagram', raw: body, messageId: body?.message_id || '' };
  }

  async function sendWhatsApp(config, recipientId, text) {
    if (!config.baseUrl || !config.apiKey || !config.instance) {
      throw new Error('Credenciais Evolution especificas do tenant nao configuradas');
    }
    const body = await httpJson(
      'POST',
      config.baseUrl.replace(/\/$/, '') + '/message/sendText/' + encodeURIComponent(config.instance),
      { 'Content-Type': 'application/json', apikey: config.apiKey },
      { number: String(recipientId).replace(/@s\.whatsapp\.net$/, ''), text },
    );
    if (!body || body.error) throw new Error(body?.message || body?.error || 'Falha ao enviar mensagem no WhatsApp');
    return { provider: 'evolution_api', raw: body, messageId: body?.key?.id || body?.message?.key?.id || body?.id || '' };
  }

  const command = required(input.command, 'command');
  const tenantSlug = required(input.tenant_slug, 'tenant_slug').toLowerCase();
  const payload = input.payload || {};
  if (!['manual_reply', 'broadcast_send', 'broadcast_campaign', 'close_conversation', 'assign_conversation', 'confirm_payment_signal', 'confirm_appointment_request', 'reject_appointment_slot', 'notify_appointment_cancellation', 'suggest_kanban_flow_order', 'apply_kanban_flow_order'].includes(command)) throw new Error('command nao suportado: ' + command);

  const user = await validateUserSession();
  const tenant = await loadTenant(tenantSlug);
  await assertTenantMember(user.id, tenant.id, ['suggest_kanban_flow_order', 'apply_kanban_flow_order'].includes(command) ? ['owner', 'admin', 'manager'] : undefined);

  if (command === 'suggest_kanban_flow_order') return await suggestKanbanFlowOrder(tenant, payload);
  if (command === 'apply_kanban_flow_order') return await applyKanbanFlowOrder(tenant, payload);

  if (command === 'broadcast_campaign') {
    const campaignId = required(payload.campaign_id, 'payload.campaign_id');
    const { supabaseUrl } = supabaseConfig();
    const campaignPath = supabaseUrl + '/rest/v1/broadcast_campaigns?tenant_id=eq.' + encodeURIComponent(tenant.id)
      + '&id=eq.' + encodeURIComponent(campaignId);
    const candidates = await httpJson('GET', campaignPath + '&select=*', serviceHeaders());
    const candidate = Array.isArray(candidates) ? candidates[0] : null;
    if (!candidate) throw new Error('Campanha nao encontrada nesta empresa');
    if (!candidate.consent_confirmed_at) throw new Error('Campanha sem confirmacao de autorizacao dos contatos');
    if (!['queued', 'scheduled'].includes(candidate.status)) throw new Error('Campanha nao esta aguardando envio');

    const claimedRows = await httpJson('PATCH', campaignPath + '&status=in.(queued,scheduled)',
      serviceHeaders('return=representation'), { status: 'sending', started_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    const campaign = Array.isArray(claimedRows) ? claimedRows[0] : null;
    if (!campaign) throw new Error('Campanha ja foi iniciada ou alterada');
    return { ok: true, command, campaign_id: campaign.id, tenant_id: tenant.id, tenant_slug: tenantSlug,
      status: 'sending', queued: true, sent_by_user: user.email || payload.sent_by_user || 'NORIA' };
  }

  const channelType = required(payload.channel_type, 'payload.channel_type').toLowerCase();
  const externalConversationId = required(payload.external_conversation_id, 'payload.external_conversation_id');
  const messageText = command === 'close_conversation'
    ? String(payload.message_text || 'Atendimento encerrado').trim()
    : command === 'assign_conversation'
      ? String(payload.message_text || 'Conversa atribuida').trim()
      : ['confirm_payment_signal', 'confirm_appointment_request', 'reject_appointment_slot', 'notify_appointment_cancellation'].includes(command)
        ? String(payload.message_text || '').trim()
    : required(payload.message_text, 'payload.message_text');
  const token = tokenFor(tenantSlug, channelType);
  const evolution = channelType === 'whatsapp' ? evolutionFor(tenantSlug) : null;
  const commandId = payload.command_id || tenantSlug + ':' + channelType + ':' + externalConversationId + ':' + Date.now();

  if (!['telegram', 'instagram', 'instagram_direct', 'whatsapp'].includes(channelType)) {
    throw new Error('channel_type ainda nao suportado para envio manual: ' + channelType);
  }
  if (!['close_conversation', 'assign_conversation'].includes(command) && channelType !== 'whatsapp' && !token) {
    throw new Error('token nao configurado para tenant=' + tenantSlug + ' channel=' + channelType);
  }

  const normalizedChannel = channelType === 'instagram_direct' ? 'instagram' : channelType;
  if (command === 'close_conversation') {
    const event = {
      tenant_id: tenant.id,
      tenant_slug: tenantSlug,
      channel_type: normalizedChannel,
      external_conversation_id: externalConversationId,
      external_message_id: commandId,
      direction: 'outbound',
      sender_type: 'system',
      contact_name: payload.contact_name || 'Contato',
      message_text: messageText,
      service: 'conversation_closed',
      stage: 'Finalizado',
      handoff: false,
      response_text: null,
      ai_provider: 'conversation_closed',
      ai_model: null,
      ai_error: '',
      ai_usage: {},
      sent_by_user: payload.sent_by_user || user.email || 'Operador Mag.IA',
      delivery_status: 'closed',
      command_id: commandId,
      raw_payload: {
        command,
        closed_by: payload.sent_by_user || user.email || 'Operador Mag.IA',
        reason: payload.reason || 'Atendimento encerrado pela interface',
      },
    };
    const saved = await insertEvent(event);
    return { ok: true, command, tenant_slug: tenantSlug, channel_type: normalizedChannel, command_id: commandId, external_message_id: event.external_message_id, saved };
  }

  if (command === 'notify_appointment_cancellation') {
    const appointmentId = required(payload.appointment_id, 'payload.appointment_id');
    const reason = required(payload.cancellation_reason, 'payload.cancellation_reason');
    if (normalizedChannel !== 'whatsapp') throw new Error('Canal incorreto para este agendamento');
    const { supabaseUrl } = supabaseConfig();
    const path = supabaseUrl + '/rest/v1/appointments?tenant_id=eq.' + encodeURIComponent(tenant.id)
      + '&id=eq.' + encodeURIComponent(appointmentId) + '&status=eq.cancelled';
    const rows = await httpJson('GET', path + '&select=*', serviceHeaders());
    const row = rows?.[0];
    if (!row || row.channel_type !== normalizedChannel || row.external_conversation_id !== externalConversationId || row.status !== 'cancelled')
      throw new Error('Agendamento cancelado nao pertence a esta conversa/canal');
    const metadata = row.metadata || {};
    if (String(metadata.cancel_reason || '').trim() !== reason) throw new Error('Motivo nao corresponde ao cancelamento registrado');
    if (payload.notice_resolution !== undefined) {
      // Conferência humana do aviso com entrega incerta (ou preso em envio há mais de 2 minutos). Nunca reenvia.
      const resolution = String(payload.notice_resolution || '');
      if (!['delivered', 'not_delivered'].includes(resolution)) throw new Error('Resolucao do aviso invalida');
      const noticeAge = Date.now() - Date.parse(metadata.cancellation_notice_at || '');
      const stuck = metadata.cancellation_notice_state === 'sending' && Number.isFinite(noticeAge) && noticeAge > 120000;
      if (metadata.cancellation_notice_state !== 'uncertain' && !stuck) throw new Error('Este aviso nao tem entrega incerta para verificar');
      if (!row.updated_at) throw new Error('Agendamento sem versao para controle de envio');
      const now = new Date().toISOString();
      const { cancellation_notice_state: _state, cancellation_notice_command: _command, cancellation_notice_echo_text: _echo, cancellation_notice_at: _at, ...cleared } = metadata;
      let next = cleared;
      if (resolution === 'delivered') {
        const knownId = String(payload.notice_message_id || metadata.cancellation_notice_message_id || '').trim();
        next = { ...cleared, cancellation_notice_state: 'sent', cancellation_notice_message_id: knownId || 'manual:' + (metadata.cancellation_notice_command || commandId),
          cancellation_notice_reconciled: { resolution, actor: user.id, at: now, message_id_unknown: !knownId } };
      } else {
        const { cancellation_notice_message_id: _id, ...withoutId } = cleared;
        next = { ...withoutId, cancellation_notice_reconciled: { resolution, actor: user.id, at: now } };
      }
      const settled = await httpJson('PATCH', path + '&updated_at=eq.' + encodeURIComponent(row.updated_at), serviceHeaders('return=representation'),
        { metadata: next, updated_at: now });
      if (settled?.length !== 1) throw new Error('Agendamento alterado por outro operador. Atualize a tela.');
      return { ok: true, command, resolved: true, resolution, appointment: settled[0] };
    }
    if (metadata.cancellation_notice_state === 'sent') return { ok: true, command, already_sent: true };
    if (metadata.cancellation_notice_state) throw new Error('Envio em andamento ou entrega incerta. Verifique no WhatsApp antes de tentar novamente.');
    if (!row.updated_at) throw new Error('Agendamento sem versao para controle de envio');
    const settings = await loadTenantSettings(tenant.id);
    const model = env('GEMINI_MODEL', 'gemini-2.5-flash-lite');
    const key = required(env('GEMINI_API_KEY'), 'GEMINI_API_KEY');
    if (!/^gemini-[a-z0-9.-]+$/i.test(model)) throw new Error('Modelo Gemini invalido');
    const context = { empresa: tenant.name || tenant.slug, segmento: tenant.industry || settings.industry || '',
      tom: String(settings.tone || '').slice(0, 400),
      cliente: row.contact_name || '', servico: row.title || row.metadata?.services || '', horario: row.starts_at || '', motivo: reason };
    const prompt = 'Escreva uma mensagem curta e acolhedora em português brasileiro para informar à pessoa atendida o cancelamento do agendamento, no tom do estabelecimento descrito em tom e como atendente da equipe (no feminino); trate a pessoa de forma neutra, sem presumir gênero. Use somente os dados fornecidos, sem inventar fatos ou promessas. Não inclua instruções internas, aspas ou explicações. Dados: ' + JSON.stringify(context);
    const generated = await httpJson('POST', `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4, maxOutputTokens: 400 } });
    const text = generated?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim();
    if (!text) throw new Error('Gemini nao gerou mensagem de cancelamento');
    const claim = { ...metadata, cancellation_notice_state: 'sending', cancellation_notice_command: commandId, cancellation_notice_echo_text: text,
      cancellation_notice_at: new Date().toISOString() };
    const claimed = await httpJson('PATCH', path + '&updated_at=eq.' + encodeURIComponent(row.updated_at), serviceHeaders('return=representation'),
      { metadata: claim, updated_at: new Date().toISOString() });
    if (claimed?.length !== 1) throw new Error('Agendamento alterado por outro operador. Atualize a tela.');
    const claimPath = path + '&metadata->>cancellation_notice_state=eq.sending&metadata->>cancellation_notice_command=eq.' + encodeURIComponent(commandId);
    let sent;
    try {
      sent = await sendWhatsApp(evolution, externalConversationId, text);
      if (!sent.messageId) throw new Error('Evolution nao retornou identificador da mensagem');
    } catch (error) {
      let marked = true;
      try { await httpJson('PATCH', claimPath, serviceHeaders(), { metadata: { ...claim, cancellation_notice_state: 'uncertain' }, updated_at: new Date().toISOString() }); }
      catch (markError) { marked = false; }
      throw new Error('Entrega nao comprovada. Verifique no WhatsApp antes de tentar novamente.'
        + (marked ? '' : ' Nao foi possivel registrar a entrega incerta: o aviso continua em envio e pode ser conferido apos alguns minutos.'));
    }
    const { cancellation_notice_echo_text: _echoText, ...settledClaim } = claim;
    let updated;
    try {
      updated = await httpJson('PATCH', claimPath, serviceHeaders('return=representation'),
        { metadata: { ...settledClaim, cancellation_notice_state: 'sent', cancellation_notice_message_id: sent.messageId }, updated_at: new Date().toISOString() });
      if (updated?.length !== 1) throw new Error('registro alterado');
    } catch (error) {
      // O envio funcionou: guarda o id para a conferência não depender de digitação e deixa o aviso conferível.
      try { await httpJson('PATCH', claimPath, serviceHeaders(), { metadata: { ...claim, cancellation_notice_state: 'uncertain', cancellation_notice_message_id: sent.messageId }, updated_at: new Date().toISOString() }); } catch (markError) {}
      throw new Error('Mensagem enviada, mas o registro nao foi atualizado. Entrega incerta: confira no WhatsApp e registre o resultado.');
    }
    const saved = await recordSentEvent({ tenant_id: tenant.id, tenant_slug: tenantSlug, channel_type: normalizedChannel,
      external_conversation_id: externalConversationId, external_message_id: sent.messageId, direction: 'outbound', sender_type: 'system',
      contact_name: row.contact_name || 'Contato', message_text: text, service: 'appointment_cancellation_notice',
      stage: 'Agendamento cancelado', handoff: false, response_text: null, ai_provider: 'gemini', ai_model: model,
      sent_by_user: null, delivery_status: 'sent', command_id: commandId, raw_payload: { command, appointment_id: appointmentId, requested_by: user.id } });
    return { ok: true, command, appointment: updated[0], saved, ...eventWarning(saved) };
  }

  if (command === 'confirm_appointment_request' || command === 'reject_appointment_slot') {
    const appointmentId = required(payload.appointment_id, 'payload.appointment_id');
    const isConfirm = command === 'confirm_appointment_request';
    const settings = await loadTenantSettings(tenant.id);
    const config = settings.appointment_request;
    if (config?.mode !== 'operator_confirmation') throw new Error('Confirmacao de agendamento nao esta ativa nesta empresa');
    if (normalizedChannel !== 'whatsapp') throw new Error('Canal incorreto para este agendamento');
    const { supabaseUrl } = supabaseConfig();
    const appointmentPath = supabaseUrl + '/rest/v1/appointments?tenant_id=eq.' + encodeURIComponent(tenant.id)
      + '&id=eq.' + encodeURIComponent(appointmentId);
    const openPath = appointmentPath + '&status=eq.pending_confirmation';
    const rows = await httpJson('GET', appointmentPath + '&select=*', serviceHeaders());
    const row = rows[0];
    if (!row || row.channel_type !== normalizedChannel || row.external_conversation_id !== externalConversationId) {
      throw new Error('Agendamento nao pertence a esta conversa/canal');
    }
    if (isConfirm && row.status === 'confirmed') return { ok: true, command, already_confirmed: true, appointment: row };
    if (row.status !== 'pending_confirmation') throw new Error('Este pedido nao esta mais aguardando confirmacao');
    const metadata = row.metadata || {};
    if (!isConfirm && payload.proposal_resolution !== undefined) {
      const resolution = String(payload.proposal_resolution || '');
      if (!['delivered', 'not_delivered'].includes(resolution)) throw new Error('Resolucao da proposta invalida');
      const proposal = metadata.slot_proposal;
      // Incerta, ou presa em envio há mais de 2 minutos (n8n caiu entre preparar e ativar). O banco confere de novo.
      const preparedAge = Date.now() - Date.parse(proposal?.prepared_at || '');
      const stuck = proposal?.status === 'sending' && metadata.confirmation_state === 'sending' && Number.isFinite(preparedAge) && preparedAge > 120000;
      if (!proposal?.id || !((metadata.confirmation_state === 'uncertain' && proposal.status === 'uncertain') || stuck))
        throw new Error('Esta proposta nao tem entrega incerta para verificar');
      // O id é opcional: sem ele o banco usa o id gravado no envio ou registra a conferência manual sem id.
      const informedId = String(payload.proposal_message_id || '').trim();
      const messageId = resolution === 'delivered' && informedId ? informedId : null;
      const result = await httpJson('POST', supabaseUrl + '/rest/v1/rpc/magia_slot_proposal_reconcile', serviceHeaders(), {
        p_tenant: tenant.id, p_channel: normalizedChannel, p_chat: externalConversationId, p_appointment: appointmentId,
        p_proposal_id: proposal.id, p_resolution: resolution, p_actor: user.id, p_message_id: messageId,
      });
      if (!result?.appointment || !result?.proposal) throw new Error('Resolucao da proposta nao comprovada. Atualize o quadro.');
      return { ok: true, command, resolved: true, appointment: result.appointment, proposal: result.proposal };
    }
    if (!isConfirm && (payload.suggested_date !== undefined || payload.suggested_time !== undefined)) {
      // A proposta só é útil se a resposta puder ser lida: as duas chaves precisam estar ligadas.
      if (config.slot_proposal_enabled !== true || config.slot_proposal_resolution_enabled !== true) throw new Error('Proposta de horario nao esta ativa nesta empresa');
      const date = required(payload.suggested_date, 'payload.suggested_date');
      const time = required(payload.suggested_time, 'payload.suggested_time');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Data ou horario da proposta invalido');
      const parsed = new Date(date + 'T00:00:00Z');
      if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error('Data da proposta invalida');
      if (!Number.isInteger(Number(payload.request_version)) || Number(payload.request_version) !== Number(metadata.request_version)) throw new Error('Pedido alterado pela cliente. Atualize o quadro.');
      if (metadata.confirmation_state) throw new Error('Envio em andamento ou entrega incerta. Verifique no WhatsApp antes de tentar novamente.');
      // Futuro no fuso do tenant, antes de gastar uma chamada ao Gemini.
      const proposalStart = zonedWallToEpoch(date, time, await loadTenantTimezone(tenant.id));
      if (!Number.isFinite(proposalStart)) throw new Error('Data ou horario da proposta invalido');
      if (proposalStart <= Date.now()) throw new Error('O horario proposto ja passou');
      // A conversa já está em andamento: sem cumprimento nem boas-vindas ("Olá! Que alegria ter você aqui" no meio do atendimento).
      const requestedAt = new Date(row.starts_at || '');
      const horarioPedido = Number.isFinite(requestedAt.getTime()) ? new Intl.DateTimeFormat('pt-BR', { timeZone: await loadTenantTimezone(tenant.id),
        weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(requestedAt) : '';
      const composed = await composeWithGemini(settings, tenant, row, 'A conversa com a pessoa já está em andamento: não cumprimente, não se apresente e não use boas-vindas. Em uma ou duas frases curtas e acolhedoras, diga que o horário pedido (horario_pedido) não está disponível e proponha o novo horário informado, perguntando se pode ser. Se o novo horário for no mesmo dia, cite o dia uma vez só. Escreva a data por extenso, como está em data. O novo horário ainda não está confirmado.', { date, time },
        horarioPedido ? { horario_pedido: horarioPedido } : {});
      const text = composed.text, model = composed.model;
      const proposalId = commandId + ':' + Date.now() + ':' + Math.random().toString(36).slice(2);
      const scope = { p_tenant: tenant.id, p_channel: normalizedChannel, p_chat: externalConversationId, p_appointment: appointmentId, p_proposal_id: proposalId };
      const prepared = await httpJson('POST', supabaseUrl + '/rest/v1/rpc/magia_slot_proposal_prepare', serviceHeaders(),
        { ...scope, p_expected_version: Number(payload.request_version), p_date: date, p_time: time, p_echo_text: text });
      if (!prepared?.proposal || prepared.proposal.status !== 'sending' || prepared.already) throw new Error('Proposta nao foi preparada para envio. Atualize o quadro.');
      let sent;
      try {
        sent = await sendWhatsApp(evolution, externalConversationId, text);
        if (!sent.messageId) throw new Error('Evolution nao retornou identificador da mensagem');
      } catch (error) {
        let markFailure = '';
        try { await httpJson('POST', supabaseUrl + '/rest/v1/rpc/magia_slot_proposal_mark_uncertain', serviceHeaders(), scope); }
        catch (markError) { markFailure = String(markError?.message || markError).slice(0, 160); }
        throw new Error('Entrega nao comprovada. Verifique no WhatsApp antes de tentar novamente.'
          + (markFailure ? ' Nao foi possivel marcar a proposta como incerta (' + markFailure + '): o pedido ficou em envio e pode ser conferido apos 2 minutos.' : ''));
      }
      let finalized;
      try {
        finalized = await httpJson('POST', supabaseUrl + '/rest/v1/rpc/magia_slot_proposal_finalize', serviceHeaders(), { ...scope, p_message_id: sent.messageId });
        if (!finalized?.proposal || finalized.proposal.status !== 'sent') throw new Error('Proposta nao ativada');
      } catch (error) {
        // O envio funcionou: grava o id do provedor para a conferência não exigir que a equipe o digite.
        let markFailure = '';
        try { await httpJson('POST', supabaseUrl + '/rest/v1/rpc/magia_slot_proposal_mark_uncertain', serviceHeaders(), { ...scope, p_message_id: sent.messageId }); }
        catch (markError) { markFailure = String(markError?.message || markError).slice(0, 160); }
        throw new Error('Mensagem enviada, mas proposta nao ativada. Verifique o agendamento antes de tentar novamente.'
          + (markFailure ? ' Nao foi possivel marcar a proposta como incerta (' + markFailure + '): o pedido ficou em envio e pode ser conferido apos 2 minutos.' : ''));
      }
      const saved = await recordSentEvent({ tenant_id: tenant.id, tenant_slug: tenantSlug, channel_type: normalizedChannel,
        external_conversation_id: externalConversationId, external_message_id: sent.messageId, direction: 'outbound', sender_type: 'system',
        contact_name: row.contact_name || 'Contato', message_text: text, service: 'appointment_slot_proposed', stage: 'Horario indisponivel',
        handoff: false, response_text: null, ai_provider: 'gemini', ai_model: model, sent_by_user: null, delivery_status: 'sent',
        command_id: commandId, raw_payload: { command, appointment_id: appointmentId, proposal_id: proposalId, requested_by: user.id } });
      return { ok: true, command, appointment: finalized.appointment, proposal: finalized.proposal, saved, ...eventWarning(saved) };
    }
    const messageInfo = { source: 'template_fallback', fallback_reason: '' };
    const currentClaimPath = (claim, state) => openPath + '&metadata->>confirmation_state=eq.' + state
      + '&metadata->>confirmation_command=eq.' + encodeURIComponent(claim.confirmation_command);

    // Grava o resultado depois da entrega comprovada. O evento não é de controle: a IA continua na conversa.
    const finish = async (claimedMetadata, state, messageId, text) => {
      const now = new Date().toISOString();
      const { confirmation_echo_text: _echoText, ...settledMetadata } = claimedMetadata;
      const done = messageRef => ({ ...settledMetadata, confirmation_state: 'sent', confirmation_message_id: messageRef,
        ...(claimedMetadata.confirmation_action === 'confirm' ? { confirmed_by: user.id, confirmed_at: now }
          : { cancel_reason: 'slot_rejected', cancelled_by: user.id, cancelled_at: now }) });
      const isConfirmAction = claimedMetadata.confirmation_action === 'confirm';
      const updated = await httpJson('PATCH', currentClaimPath(claimedMetadata, state), serviceHeaders('return=representation'), {
        status: isConfirmAction ? 'confirmed' : 'cancelled', updated_at: now, metadata: done(messageId) });
      if (updated.length !== 1) throw new Error('Mensagem enviada, mas registro alterado simultaneamente. Verifique o agendamento.');
      if (!messageId) return { ok: true, command, appointment: updated[0], resolved: true };
      const saved = await recordSentEvent({ tenant_id: tenant.id, tenant_slug: tenantSlug, channel_type: normalizedChannel,
        external_conversation_id: externalConversationId, external_message_id: messageId, direction: 'outbound', sender_type: 'system',
        contact_name: row.contact_name || 'Contato', message_text: text,
        service: isConfirmAction ? 'appointment_request_confirmed' : 'appointment_request_rejected',
        stage: isConfirmAction ? 'Agendamento confirmado' : 'Horario indisponivel', handoff: false, response_text: null,
        ai_provider: 'operator_confirmation', sent_by_user: null, delivery_status: 'sent', command_id: claimedMetadata.confirmation_command,
        raw_payload: { command, appointment_id: appointmentId, confirmed_by: user.id, appointment: updated[0], message_source: messageInfo.source,
          ...(messageInfo.fallback_reason ? { message_fallback_reason: messageInfo.fallback_reason } : {}) } });
      return { ok: true, command, appointment: updated[0], saved, ...eventWarning(saved) };
    };

    if (payload.uncertain_resolution) {
      if (metadata.confirmation_state !== 'uncertain' || !metadata.confirmation_command) throw new Error('Este pedido nao tem entrega incerta para verificar');
      if (payload.uncertain_resolution === 'delivered') return await finish(metadata, 'uncertain', null, '');
      if (payload.uncertain_resolution !== 'not_delivered') throw new Error('Resolucao invalida');
      const { confirmation_state: _state, confirmation_action: _action, confirmation_command: _command, confirmation_echo_text: _echoText, ...cleared } = metadata;
      const updated = await httpJson('PATCH', currentClaimPath(metadata, 'uncertain'), serviceHeaders('return=representation'),
        { metadata: cleared, updated_at: new Date().toISOString() });
      if (updated.length !== 1) throw new Error('Pedido alterado por outro operador. Atualize o quadro.');
      return { ok: true, command, appointment: updated[0], resolved: true };
    }
    if (metadata.confirmation_state) throw new Error('Envio em andamento ou entrega incerta. Verifique no WhatsApp antes de tentar novamente.');
    if (Number(payload.request_version) !== Number(metadata.request_version)) throw new Error('Pedido alterado pela cliente. Atualize o quadro.');
    if (isConfirm && Date.parse(row.starts_at) <= Date.now()) throw new Error('O horario deste pedido ja passou');
    const zoneRows = await httpJson('GET', supabaseUrl + '/rest/v1/tenant_settings?select=timezone&tenant_id=eq.' + encodeURIComponent(tenant.id) + '&limit=1', serviceHeaders());
    // O modelo do tenant valida a configuração, fornece os avisos obrigatórios ao Gemini e é o texto técnico de contingência.
    const templateText = renderAppointmentRequest(isConfirm ? config.confirmation_template : config.slot_rejected_template, row, { timezone: zoneRows?.[0]?.timezone });
    if (isConfirm && payload.conflicts_acknowledged !== true) {
      const conflicts = await httpJson('POST', supabaseUrl + '/rest/v1/rpc/magia_appointment_request_conflicts', serviceHeaders(),
        { p_tenant: tenant.id, p_appointment: appointmentId });
      if (Array.isArray(conflicts) && conflicts.length) return { ok: true, command, requires_acknowledgement: true, conflicts };
    }
    let text = templateText;
    try {
      const zone = String(zoneRows?.[0]?.timezone || 'America/Sao_Paulo');
      const wall = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(new Date(row.starts_at)).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
      const expected = { date: wall.year + '-' + wall.month + '-' + wall.day, time: wall.hour + ':' + wall.minute, template: templateText,
        ...(isConfirm ? { services: Array.isArray(metadata.services) ? metadata.services : [] } : {}) };
      const weekday = new Intl.DateTimeFormat('pt-BR', { timeZone: zone, weekday: 'long' }).format(new Date(row.starts_at));
      const composed = await composeWithGemini(settings, tenant, row, isConfirm
        ? 'Escreva a mensagem confirmando o agendamento: o horário está confirmado pela equipe. Cite os serviços, a data e a hora exatos.'
        : 'Avise com empatia que o horário solicitado (data e hora fornecidas) não está disponível e peça que a pessoa informe outro dia ou horário. Não proponha nenhum horário.',
      expected, { dia_da_semana: weekday });
      text = composed.text; messageInfo.source = 'gemini'; messageInfo.model = composed.model;
    } catch (error) {
      messageInfo.fallback_reason = String(error?.message || error).slice(0, 160);
    }
    const claimedMetadata = { ...metadata, confirmation_state: 'sending', confirmation_action: isConfirm ? 'confirm' : 'reject',
      confirmation_command: commandId, ...(config.reply_mode === 'contextual' ? { confirmation_echo_text: text } : {}) };
    const claimed = await httpJson('PATCH', openPath + '&updated_at=eq.' + encodeURIComponent(row.updated_at), serviceHeaders('return=representation'),
      { metadata: claimedMetadata, updated_at: new Date().toISOString() });
    if (claimed.length !== 1) throw new Error('Pedido alterado por outro operador. Atualize o quadro.');
    let sent;
    try {
      sent = await sendWhatsApp(evolution, externalConversationId, text);
      if (!sent.messageId) throw new Error('Evolution nao retornou identificador da mensagem');
    } catch (error) {
      await httpJson('PATCH', currentClaimPath(claimedMetadata, 'sending'), serviceHeaders(),
        { metadata: { ...claimedMetadata, confirmation_state: 'uncertain' }, updated_at: new Date().toISOString() });
      throw new Error('Entrega nao comprovada. Verifique no WhatsApp antes de tentar novamente.');
    }
    return await finish(claimedMetadata, 'sending', sent.messageId, text);
  }

  if (command === 'confirm_payment_signal') {
    const appointmentId = required(payload.appointment_id, 'payload.appointment_id');
    const settings = await loadTenantSettings(tenant.id);
    // Opt-in only. Preserve the existing confirmation path for every other client.
    if (settings.whatsapp_processing_mode === 'conversation_core_v1') {
      if (normalizedChannel !== 'whatsapp') throw new Error('Canal incorreto para este agendamento');
      const { supabaseUrl } = supabaseConfig();
      const appointmentPath = supabaseUrl + '/rest/v1/appointments?tenant_id=eq.' + encodeURIComponent(tenant.id)
        + '&id=eq.' + encodeURIComponent(appointmentId);
      const rows = await httpJson('GET', appointmentPath + '&select=*', serviceHeaders());
      const row = rows[0];
      if (!row || row.channel_type !== normalizedChannel || row.external_conversation_id !== externalConversationId) {
        throw new Error('Agendamento nao pertence a esta conversa/canal');
      }
      if (row.status === 'confirmed') return { ok: true, command, already_confirmed: true, appointment: row };
      if (row.status !== 'payment_reported') throw new Error('Aguardando cliente informar o sinal');
      if (row.metadata?.signal_confirmation_state) throw new Error('Confirmacao em andamento ou entrega incerta. Verifique antes de reenviar.');
      const claimedMetadata = { ...row.metadata, signal_confirmation_state: 'sending',
        signal_confirmation_command: commandId, payment_confirmed_by: user.id };
      const claimed = await httpJson('PATCH', appointmentPath + '&status=eq.payment_reported&updated_at=eq.'
        + encodeURIComponent(row.updated_at), serviceHeaders('return=representation'),
      { metadata: claimedMetadata, updated_at: new Date().toISOString() });
      if (claimed.length !== 1) throw new Error('Agendamento alterado por outro operador. Atualize o quadro.');
      let sent;
      try {
        sent = await sendWhatsApp(evolution, externalConversationId, paymentSignalConfirmationMessage(settings));
        if (!sent.messageId) throw new Error('Evolution nao retornou identificador da mensagem');
      } catch (error) {
        await httpJson('PATCH', appointmentPath, serviceHeaders(), { metadata: {
          ...claimedMetadata, signal_confirmation_state: 'uncertain' }, updated_at: new Date().toISOString() });
        throw new Error('Entrega da confirmacao nao comprovada. Verifique no WhatsApp antes de tentar novamente.');
      }
      const updated = await httpJson('PATCH', appointmentPath + '&status=eq.payment_reported', serviceHeaders('return=representation'), {
        status: 'confirmed', updated_at: new Date().toISOString(), metadata: { ...claimedMetadata,
          signal_confirmation_state: 'sent', confirmation_message_id: sent.messageId,
          payment_status: 'confirmed_by_operator', payment_confirmed_at: new Date().toISOString() },
      });
      if (updated.length !== 1) throw new Error('Mensagem enviada, mas registro alterado simultaneamente. Verifique o agendamento antes de repetir.');
      const event = { tenant_id: tenant.id, tenant_slug: tenantSlug, channel_type: normalizedChannel,
        external_conversation_id: externalConversationId, external_message_id: sent.messageId,
        direction: 'outbound', sender_type: 'system', contact_name: row.contact_name || 'Contato',
        message_text: paymentSignalConfirmationMessage(settings), service: 'appointment_payment_confirmed',
        stage: 'Agendamento confirmado', handoff: true, response_text: null, ai_provider: 'operator_confirmation',
        sent_by_user: user.email || user.id, delivery_status: 'sent', command_id: commandId,
        raw_payload: { command, appointment_id: appointmentId, confirmed_by: user.id, appointment: updated[0] } };
      // Evento de controle do atendimento (handoff): se não for gravado, a IA continuaria na conversa. O erro continua visível.
      const saved = await insertEvent(event);
      return { ok:true, command, appointment: updated[0], saved };
    }
    const confirmationText = messageText || paymentSignalConfirmationMessage(settings);

    const sent = normalizedChannel === 'telegram'
      ? await sendTelegram(token, externalConversationId, confirmationText)
      : normalizedChannel === 'whatsapp'
        ? await sendWhatsApp(evolution, externalConversationId, confirmationText)
        : await sendInstagram(token, externalConversationId, confirmationText);

    const appointment = await confirmAppointment(tenant.id, appointmentId);
    const event = {
      tenant_id: tenant.id,
      tenant_slug: tenantSlug,
      channel_type: normalizedChannel,
      external_conversation_id: externalConversationId,
      external_message_id: sent.messageId || commandId,
      direction: 'outbound',
      sender_type: 'system',
      contact_name: payload.contact_name || 'Contato',
      message_text: confirmationText,
      service: 'appointment_payment_confirmed',
      stage: 'Agendamento confirmado',
      handoff: true,
      response_text: null,
      ai_provider: 'operator_confirmation',
      ai_model: null,
      ai_error: '',
      ai_usage: {},
      sent_by_user: payload.sent_by_user || user.email || 'Operador Mag.IA',
      delivery_status: 'sent',
      command_id: commandId,
      raw_payload: {
        command,
        appointment_id: appointmentId,
        confirmed_by: payload.sent_by_user || user.email || 'Operador Mag.IA',
        appointment,
        sent,
      },
    };
    const saved = await insertEvent(event);
    return { ok: true, command, tenant_slug: tenantSlug, channel_type: normalizedChannel, command_id: commandId, external_message_id: event.external_message_id, appointment, saved };
  }

  if (command === 'assign_conversation') {
    const assignee = payload.assignee || {};
    const assigneeName = assignee.name || payload.assignee_name || payload.sent_by_user || user.email || 'Atendimento humano';
    const request = normalizedChannel === 'whatsapp' ? (await loadTenantSettings(tenant.id)).appointment_request : null;
    const reviewOnly = request?.mode === 'operator_confirmation' && request.team_review_control === 'manual_reply';
    const event = {
      tenant_id: tenant.id,
      tenant_slug: tenantSlug,
      channel_type: normalizedChannel,
      external_conversation_id: externalConversationId,
      external_message_id: commandId,
      direction: 'outbound',
      sender_type: 'system',
      contact_name: payload.contact_name || 'Contato',
      message_text: messageText,
      service: reviewOnly ? 'atendimento_humano' : 'conversation_assigned',
      stage: reviewOnly ? 'Conversas IA' : 'Atendimento humano',
      handoff: !reviewOnly,
      response_text: null,
      ai_provider: reviewOnly ? 'operator_review' : 'human_lock',
      ai_model: null,
      ai_error: '',
      ai_usage: {},
      sent_by_user: reviewOnly ? null : assigneeName,
      delivery_status: 'assigned',
      command_id: commandId,
      raw_payload: reviewOnly ? { command, team_review_requested: true, requested_by: user.id, reviewer: { id: assignee.id || null, name: assigneeName } } : {
        command,
        assigned_by: user.email || 'Operador Mag.IA',
        assignee: {
          id: assignee.id || null,
          name: assigneeName,
          role: assignee.role || null,
        },
      },
    };
    const saved = await insertEvent(event);
    return { ok: true, command, tenant_slug: tenantSlug, channel_type: normalizedChannel, command_id: commandId, external_message_id: event.external_message_id, saved };
  }

  const sent = normalizedChannel === 'telegram'
    ? await sendTelegram(token, externalConversationId, messageText)
    : normalizedChannel === 'whatsapp'
      ? await sendWhatsApp(evolution, externalConversationId, messageText)
      : await sendInstagram(token, externalConversationId, messageText);

  const event = {
    tenant_id: tenant.id,
    tenant_slug: tenantSlug,
    channel_type: normalizedChannel,
    external_conversation_id: externalConversationId,
    external_message_id: sent.messageId || commandId,
    direction: 'outbound',
    // A resposta manual passa por magia_record_turn_control_event, que aceita só 'human' ou 'system'.
    sender_type: command === 'manual_reply' ? 'human' : 'agent',
    contact_name: payload.contact_name || 'Contato',
    message_text: messageText,
    service: payload.service || (command === 'broadcast_send' ? 'broadcast' : 'manual_reply'),
    stage: payload.stage || (command === 'broadcast_send' ? 'Disparo' : 'Atendimento humano'),
    handoff: command === 'manual_reply',
    response_text: null,
    sent_by_user: payload.sent_by_user || user.email || 'Operador Mag.IA',
    delivery_status: 'sent',
    command_id: commandId,
    raw_payload: { command, payload: { ...payload, message_text: undefined }, sent },
  };

  const saved = await insertEvent(event);
  return { ok: true, command, tenant_slug: tenantSlug, channel_type: normalizedChannel, command_id: commandId, external_message_id: event.external_message_id, saved };
}

try {
  return { json: await main(this.helpers) };
} catch (error) {
  return { json: { ok: false, error: error.message || String(error) } };
}

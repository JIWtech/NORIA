// Validação local com dados sintéticos: nenhuma chamada alcança serviços reais.
const { chromium } = require(process.env.NORIA_PLAYWRIGHT_PATH || require('node:path').join(require('node:os').tmpdir(), 'noria-panel-ui-tools/node_modules/playwright'));
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const origin = 'http://127.0.0.1:5186';
const user = { id: '00000000-0000-4000-8000-000000000001', email: 'fixture@example.invalid', role: 'authenticated' };
const tenants = ['alpha', 'beta'].map((slug, i) => ({ id: `00000000-0000-4000-8000-00000000000${i + 2}`, slug, name: `Empresa ${slug}`, status: 'active' }));
const encode = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
const token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })}.fixture`;
const events = Object.fromEntries(tenants.map((t) => [t.slug, [{ id: `event-${t.slug}`, tenant_id: t.id, tenant_slug: t.slug,
  channel_type: 'whatsapp', external_conversation_id: t.slug === 'alpha' ? '5511999990000@s.whatsapp.net' : '5511999990001@s.whatsapp.net',
  contact_name: `Cliente ${t.slug}`, created_at: new Date().toISOString(), direction: 'inbound', sender_type: 'contact',
  message_text: `Mensagem ${t.slug}`, raw_payload: {}, stage: 'Qualificação' }]]));
const campaigns = Object.fromEntries(tenants.map((t) => [t.id, [{ id: `campaign-${t.slug}`, tenant_id: t.id, name: `Campanha ${t.slug}`, status: 'draft', total_recipients: 0 }]]));

(async () => {
  const server = spawn(process.execPath, [path.join(root, 'app/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5186', '--strictPort'], {
    cwd: path.join(root, 'app'), windowsHide: true, stdio: 'pipe',
    env: { ...process.env, VITE_SUPABASE_URL: 'https://panel-preview.supabase.co', VITE_SUPABASE_ANON_KEY: 'fixture-anon', VITE_REQUIRE_AUTH: 'true', VITE_N8N_BASE_URL: 'https://fixture.invalid' },
  });
  let serverError = '';
  server.stderr.on('data', (data) => { serverError += data; });
  let browser;
  try {
    for (let i = 0; i < 60; i++) {
      if (await fetch(origin).then((r) => r.ok).catch(() => false)) break;
      if (server.exitCode !== null) throw new Error(serverError || 'Vite encerrou antes da validação');
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    browser = await chromium.launch({ headless: true, channel: 'msedge' });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const counts = {};
    const channels = new Map();
    const errors = [];
    let campaignGate = null;
    let campaignReadStarted = null;
    let failNextCampaign = false;
    await context.routeWebSocket(/panel-preview\.supabase\.co/, (socket) => {
      socket.onMessage((raw) => {
        const [joinRef, ref, topic, kind, payload] = JSON.parse(String(raw));
        if (kind === 'phx_join') {
          const bindings = (payload.config?.postgres_changes || []).map((binding, index) => ({ ...binding, id: index + 1 }));
          channels.set(topic, { socket, joinRef, bindings });
          socket.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: { postgres_changes: bindings } }]));
        } else if (kind === 'phx_leave') {
          channels.delete(topic);
          socket.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]));
        } else if (kind === 'heartbeat') {
          socket.send(JSON.stringify([null, ref, topic, 'phx_reply', { status: 'ok', response: {} }]));
        }
      });
    });
    await context.routeWebSocket(/127\.0\.0\.1:5174/, (socket) => socket.send(JSON.stringify({ type: 'connected' })));
    const sendChange = (table, record) => {
      let sent = 0;
      for (const [topic, channel] of channels) {
        const binding = channel.bindings.find((b) => b.table === table);
        if (!binding) continue;
        channel.socket.send(JSON.stringify([channel.joinRef, null, topic, 'postgres_changes', { ids: [binding.id], data: {
          schema: 'public', table, type: 'UPDATE', commit_timestamp: new Date().toISOString(), errors: null,
          columns: Object.keys(record).map((name) => ({ name, type: name === 'raw_payload' ? 'jsonb' : 'text' })), record, old_record: {},
        } }]));
        sent++;
      }
      assert.ok(sent, `subscription para ${table} deve existir`);
    };
    await context.addInitScript(({ user, token }) => {
      localStorage.setItem('sb-panel-preview-auth-token', JSON.stringify({ access_token: token, refresh_token: 'fixture', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: 'bearer', user }));
      localStorage.setItem('magia:selected-tenant-slug', 'alpha');
      localStorage.setItem('magia:active-page', 'conversas');
      sessionStorage.setItem('noria:session-bootstrapped', '1');
    }, { user, token });
    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === origin) return route.continue();
      if (url.hostname !== 'panel-preview.supabase.co') return route.abort();
      const table = url.pathname.split('/').at(-1);
      counts[table] = (counts[table] || 0) + 1;
      const slug = url.searchParams.get('tenant_slug')?.replace('eq.', '') || url.searchParams.get('slug')?.replace('eq.', '') || 'alpha';
      const tenantId = url.searchParams.get('tenant_id')?.replace('eq.', '') || tenants[0].id;
      const campaignSnapshot = structuredClone(campaigns[tenantId] || []);
      if (table === 'broadcast_campaigns' && campaignGate) {
        campaignReadStarted?.();
        await campaignGate;
      }
      if (table === 'broadcast_campaigns' && failNextCampaign) {
        return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Falha sintética de campanhas' }) });
      }
      assert.ok(request.method() === 'GET' || (request.method() === 'POST' && url.pathname.includes('/rpc/')), `escrita inesperada: ${table}`);
      let data = [];
      if (url.pathname === '/auth/v1/user') data = user;
      else if (table === 'tenant_members') data = tenants.map((t) => ({ user_id: user.id, role: 'owner', status: 'active', tenants: t }));
      else if (table === 'tenants') data = tenants.filter((t) => t.slug === slug);
      else if (table === 'tenant_settings') data = [{ settings: { enabled_channels: ['whatsapp'] } }];
      else if (table === 'channel_events') data = events[slug] || [];
      else if (table === 'conversation_latest_events') data = events[request.postDataJSON().p_tenant_slug] || [];
      else if (table === 'broadcast_campaigns') data = campaignSnapshot;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${origin}/?app=1`);
    await page.getByText('Cliente alpha', { exact: true }).first().waitFor();
    await page.waitForFunction(() => !document.querySelector('.topbar [aria-label="Atualizar"]')?.disabled);
    await page.waitForTimeout(1000);
    assert.ok([...channels.values()].some((c) => c.bindings.some((b) => b.table === 'sales_leads' && b.filter === `tenant_id=eq.${tenants[0].id}`)), 'cold start deve assinar vendas após resolver tenantId');
    for (const table of ['appointments', 'broadcast_campaigns']) {
      assert.ok([...channels.values()].some((c) => c.bindings.some((b) => b.table === table && b.filter === `tenant_id=eq.${tenants[0].id}`)), `${table} deve ter filtro de tenant`);
    }
    const initialEventReads = counts.channel_events;
    const initialHeadsReads = counts.conversation_latest_events;
    await page.locator('.sidebar').getByRole('button', { name: 'Disparos', exact: true }).click();
    await page.getByText('Campanha alpha', { exact: true }).waitFor();
    campaigns[tenants[0].id][0].name = 'Campanha atualizada';
    sendChange('broadcast_campaigns', campaigns[tenants[0].id][0]);
    await page.getByText('Campanha atualizada', { exact: true }).waitFor();
    assert.equal(counts.channel_events, initialEventReads, 'campanha não deve reler eventos');
    assert.equal(counts.conversation_latest_events, initialHeadsReads, 'campanha não deve repetir RPC de heads');
    const campaignsBeforeForeignEvent = counts.broadcast_campaigns;
    sendChange('broadcast_campaigns', campaigns[tenants[1].id][0]);
    sendChange('appointments', { id: 'foreign-appointment', tenant_id: tenants[1].id });
    await page.waitForTimeout(1000);
    assert.equal(counts.broadcast_campaigns, campaignsBeforeForeignEvent, 'evento de outra empresa não deve provocar recarga');
    assert.equal(counts.conversation_latest_events, initialHeadsReads);
    let releaseCampaign;
    campaignGate = new Promise((resolve) => { releaseCampaign = resolve; });
    const startedCampaign = new Promise((resolve) => { campaignReadStarted = resolve; });
    campaigns[tenants[0].id][0].name = 'Campanha concorrente';
    sendChange('broadcast_campaigns', campaigns[tenants[0].id][0]);
    await Promise.race([startedCampaign, new Promise((_, reject) => setTimeout(() => reject(new Error('Recarga parcial não começou')), 5000))]);
    const nextEvent = { ...events.alpha[0], id: 'event-live', message_text: 'Mensagem ao vivo', created_at: new Date(Date.now() + 1000).toISOString() };
    events.alpha.unshift(nextEvent);
    sendChange('channel_events', nextEvent);
    releaseCampaign();
    campaignGate = null;
    await page.getByText('Campanha concorrente', { exact: true }).waitFor();
    await page.waitForTimeout(1100);
    assert.equal(counts.channel_events, initialEventReads, 'mensagem comum não deve reler eventos do painel');
    failNextCampaign = true;
    sendChange('broadcast_campaigns', campaigns[tenants[0].id][0]);
    await page.getByRole('alert').filter({ hasText: 'Falha ao carregar os dados.' }).waitFor();
    failNextCampaign = false;
    await page.getByText('Campanha concorrente', { exact: true }).waitFor();
    let releaseFull;
    campaignGate = new Promise((resolve) => { releaseFull = resolve; });
    const fullStarted = new Promise((resolve) => { campaignReadStarted = resolve; });
    await page.getByRole('button', { name: 'Atualizar', exact: true }).click();
    await Promise.race([fullStarted, new Promise((_, reject) => setTimeout(() => reject(new Error('Carga completa não começou')), 5000))]);
    campaigns[tenants[0].id][0].name = 'Campanha após carga';
    sendChange('broadcast_campaigns', campaigns[tenants[0].id][0]);
    await page.waitForTimeout(1000);
    campaignGate = null;
    releaseFull();
    await page.getByText('Campanha após carga', { exact: true }).waitFor();
    const headsAfterManualRefresh = counts.conversation_latest_events;
    assert.equal(headsAfterManualRefresh, initialHeadsReads + 1, 'pedido parcial durante carga completa não deve provocar outra carga completa');
    await page.locator('.sidebar').getByRole('button', { name: 'Conversas', exact: true }).click();
    await page.getByText('Mensagem ao vivo', { exact: true }).first().waitFor();
    assert.equal(counts.conversation_latest_events, headsAfterManualRefresh, 'abrir conversa não deve repetir carga completa');
    for (const name of ['Kanban', 'Agendamentos', 'Configurações', 'Dashboard', 'Conversas']) {
      await page.locator('.sidebar').getByRole('button', { name, exact: true }).click();
      await page.getByRole('heading', { name, exact: true }).first().waitFor();
    }
    assert.equal(counts.conversation_latest_events, headsAfterManualRefresh, 'navegação não deve reiniciar bootstrap');
    await page.getByRole('combobox', { name: 'Selecionar empresa' }).click();
    await page.getByRole('option', { name: 'Empresa beta' }).click();
    await page.getByText('Cliente beta', { exact: true }).first().waitFor();
    assert.equal(await page.getByText('Cliente alpha', { exact: true }).count(), 0, 'troca de empresa deve isolar conversas');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Abrir navegação' }).click();
    await page.getByRole('dialog', { name: 'Navegação principal' }).getByRole('button', { name: 'Agendamentos', exact: true }).click();
    await page.getByRole('heading', { name: 'Agendamentos', exact: true }).first().waitFor();
    await page.screenshot({ path: path.join(os.tmpdir(), 'noria-panel-loading-mobile.png'), fullPage: true });
    assert.deepEqual(errors, [], 'não deve haver exceções no navegador');
    console.log(JSON.stringify({ result: 'PASS', checks: ['cold-start', 'subscriptions-tenant', 'campanha-sem-full', 'evento-outro-tenant', 'mensagem-durante-patch', 'falha-parcial-preserva-dados', 'parcial-durante-full', 'navegacao', 'troca-tenant', 'mobile'], requests: counts }));
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });

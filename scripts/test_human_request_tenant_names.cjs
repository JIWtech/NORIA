'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readSource, loadFunctions, loadCoreEngine } = require('./lib/core_test_harness.cjs');

const SHARED_FN_NAMES = [
  'normalizeText',
  'salesEscapeRegex',
  'salesTenantHumanTargetNames',
  'salesHumanTargetRegexSource',
  'salesExplicitHumanRequest',
  'salesFrustrationDetected',
  'salesResolveDefaultAssignee',
];

function loadHumanRequestFns(file) {
  return loadFunctions(readSource(file), SHARED_FN_NAMES, {
    settingsFor: ctx => ctx?.settings?.settings || ctx?.settings || {},
    encodeFilter: v => encodeURIComponent(String(v)),
    supabaseGet: async () => [],
  });
}

function makeTenantContext(tenantId, slug, { teamAgents = [], settings = {} } = {}) {
  return {
    tenant: { id: tenantId, slug, status: 'active' },
    settings: { settings },
    team_agents: teamAgents,
  };
}

// Poda Fase 4.1 (ic_salon): helpers sales_* de atendimento comercial e o ramo sales_v1 de loadTenantContext foram removidos de clients/ic_saloon/salon_engine.js.
for (const file of ['n8n/sources/noria_core.js']) {
  test(`${file}: pedido com nome configurado em team_agents aciona deteccao sem hardcode`, () => {
    const fns = loadHumanRequestFns(file);
    const context = makeTenantContext('t-gen', 'tenant_alpha', {
      teamAgents: [{ id: 'ag-1', name: 'Wesley', role: 'owner', is_active: true }],
    });

    assert.equal(fns.salesExplicitHumanRequest('Quero falar com o Wesley', context), true);
    assert.equal(fns.salesExplicitHumanRequest('Chama Wesley por favor', context), true);
    assert.equal(fns.salesFrustrationDetected('Quero falar com o Wesley', context), true);
    assert.equal(fns.salesFrustrationDetected('Chama o Wesley agora', context), true);
  });

  test(`${file}: nome configurado em settings de vendas ou responsavel aciona e escapa metacaracteres`, () => {
    const fns = loadHumanRequestFns(file);
    const viaSales = makeTenantContext('t-sales', 'tenant_beta', {
      settings: { sales: { default_operator: { id: 'op-1', name: 'Ana Paula' } } },
    });
    assert.equal(fns.salesExplicitHumanRequest('Quero falar com a Ana', viaSales), true);
    assert.equal(fns.salesExplicitHumanRequest('Quero falar com a Ana Paula', viaSales), true);
    assert.equal(fns.salesFrustrationDetected('Chama a Ana Paula', viaSales), true);

    const viaResponsible = makeTenantContext('t-resp', 'tenant_gamma', {
      settings: { business_facts: { responsible_name: 'J. Silva (Vendas)+' } },
    });
    assert.equal(fns.salesExplicitHumanRequest('Quero falar com o J. Silva (Vendas)+', viaResponsible), true);
    assert.equal(fns.salesFrustrationDetected('Chama J. Silva (Vendas)+', viaResponsible), true);
    assert.equal(fns.salesExplicitHumanRequest('Quero falar com o Jx Silva', viaResponsible), false);
    assert.equal(fns.salesExplicitHumanRequest('Quero falar com o Analista', viaSales), false);
  });

  test(`${file}: sem configuracao de nomes, apenas termos genericos acionam`, () => {
    const fns = loadHumanRequestFns(file);
    const emptyCtx = makeTenantContext('t-empty', 'tenant_sem_config', {
      settings: { business_facts: { name: 'Loja Sem Operador' } },
    });

    assert.equal(fns.salesExplicitHumanRequest('Quero falar com o Wesley', emptyCtx), false);
    assert.equal(fns.salesFrustrationDetected('Quero falar com o Wesley', emptyCtx), false);
    assert.equal(fns.salesFrustrationDetected('Chama o Wesley', emptyCtx), false);

    assert.equal(fns.salesExplicitHumanRequest('Quero falar com o dono', emptyCtx), true);
    assert.equal(fns.salesExplicitHumanRequest('Chama o dono', emptyCtx), true);
    assert.equal(fns.salesExplicitHumanRequest('Quero falar com um atendente', emptyCtx), true);
    assert.equal(fns.salesFrustrationDetected('Quero falar com o dono', emptyCtx), true);
    assert.equal(fns.salesFrustrationDetected('Chama um humano', emptyCtx), true);
    assert.equal(fns.salesFrustrationDetected('Preciso de um atendente humano', emptyCtx), true);
  });

  test(`${file}: outro tenant com configuracao diferente ou vazia nao e afetado`, () => {
    const fns = loadHumanRequestFns(file);
    const tenantA = makeTenantContext('t-a', 'tenant_a', {
      teamAgents: [{ id: 'a1', name: 'Wesley', is_active: true }],
    });
    const tenantB = makeTenantContext('t-b', 'tenant_b', {
      teamAgents: [{ id: 'b1', name: 'Carlos', is_active: true }],
    });
    const tenantInactive = makeTenantContext('t-c', 'tenant_c', {
      teamAgents: [{ id: 'c1', name: 'Wesley', is_active: false }],
    });

    assert.equal(fns.salesExplicitHumanRequest('Quero falar com o Wesley', tenantA), true);
    assert.equal(fns.salesExplicitHumanRequest('Quero falar com o Wesley', tenantB), false);
    assert.equal(fns.salesFrustrationDetected('Quero falar com o Wesley', tenantB), false);
    assert.equal(fns.salesExplicitHumanRequest('Quero falar com o Carlos', tenantB), true);
    assert.equal(fns.salesExplicitHumanRequest('Quero falar com o Carlos', tenantA), false);
    assert.equal(fns.salesExplicitHumanRequest('Quero falar com o Wesley', tenantInactive), false);
  });

  test(`${file}: loadTenantContext carrega team_agents com escopo do tenant para uso no turno`, async () => {
    const queries = [];
    const contextDeps = file === 'n8n/sources/noria_core.js'
      ? ['normalizeInstanceKey', 'channelMatchesInstance', 'loadTenantContext', ...SHARED_FN_NAMES]
      : ['loadTenantContext', ...SHARED_FN_NAMES];
    const ctxFns = loadFunctions(
      readSource(file),
      contextDeps,
      {
        tenantSlug: 'tenant_a',
        inputJson: { tenant_id: 't-a', instance: 'inst-a' },
        encodeFilter: v => encodeURIComponent(String(v)),
        tenantGeminiDailyLimit: () => 0,
        geminiTenantBudget: {},
        activeTenantTimeZone: '',
        tenantBusinessRules: {},
        helpers: {},
        settingsFor: ctx => ctx?.settings?.settings || ctx?.settings || {},
        supabaseGet: async path => {
          queries.push(path);
          if (path.startsWith('/rest/v1/tenants')) return [{ id: 't-a', slug: 'tenant_a', status: 'active' }];
          if (path.startsWith('/rest/v1/tenant_settings')) {
            return [{ settings: { whatsapp_processing_mode: 'conversation_core_v1', conversation_capability: 'sales_v1', grounding_mode: 'canonical_v2' } }];
          }
          if (path.startsWith('/rest/v1/channels')) return [{ external_id: 'inst-a', config: {} }];
          if (path.startsWith('/rest/v1/team_agents')) {
            return path.includes('tenant_id=eq.t-a')
              ? [{ id: 'ag-a', name: 'Wesley', role: 'owner', is_active: true }]
              : [];
          }
          return [];
        },
      }
    );

    const loaded = await ctxFns.loadTenantContext();
    assert.ok(queries.some(q => q.includes('/rest/v1/team_agents') && q.includes('tenant_id=eq.t-a')));
    assert.equal(ctxFns.salesExplicitHumanRequest('Quero falar com o Wesley', loaded), true);
    assert.equal(ctxFns.salesFrustrationDetected('Quero falar com o Wesley', loaded), true);
  });
}

test('loadCoreEngine: motor principal expoe deteccao dinamica com settings reais', async () => {
  const core = await loadCoreEngine(['salesExplicitHumanRequest', 'salesFrustrationDetected']);
  const configured = makeTenantContext('t-core', 'tenant_core', {
    settings: { responsible_name: 'Fernanda Lima' },
  });
  const unconfigured = makeTenantContext('t-core-2', 'tenant_core_2');

  assert.equal(core.salesExplicitHumanRequest('Quero falar com a Fernanda', configured), true);
  assert.equal(core.salesFrustrationDetected('Chama a Fernanda Lima', configured), true);
  assert.equal(core.salesExplicitHumanRequest('Quero falar com a Fernanda', unconfigured), false);
  assert.equal(core.salesExplicitHumanRequest('Quero falar com o dono', unconfigured), true);
});

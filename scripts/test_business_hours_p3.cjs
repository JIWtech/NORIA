const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('../app/node_modules/typescript');

function functions(file, names, globals) {
  const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const source = ast.statements.filter(ts.isFunctionDeclaration).filter(n => names.includes(n.name.text)).map(n => n.getText(ast)).join('\n');
  return new Function(...Object.keys(globals), source + '\nreturn {' + names.join(',') + '};')(...Object.values(globals));
}
const core = functions('n8n/sources/noria_core.js', ['resolveTenantDayHours', 'tenantBusinessHoursStatus'], {
  normalizeText: s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(),
  tenantTimeZone: c => c.settings.timezone, settingsFor: c => c.settings.settings || {},
});
const salon = functions('clients/ic_saloon/salon_engine.js', ['resolveTenantDayHours', 'tenantBusinessHoursStatus'], {
  normalizeText: s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(),
  tenantTimeZone: c => c.settings.timezone, settingsFor: c => c.settings.settings || {},
});
const hours = { start: '09:00', end: '18:00', lunch_start: '12:00', lunch_end: '13:00', days: ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'] };
const context = business_hours => ({ settings: { timezone: 'America/Sao_Paulo', business_hours } });
test('CORE retoma após almoço no mesmo dia', () => {
  assert.equal(core.tenantBusinessHoursStatus(context(hours), new Date('2026-11-23T15:30:00Z')).next_opening.formatted, 'hoje às 13:00');
});
test('CORE pula feriado futuro e respeita virada local e domingo fechado', () => {
  const bh = { ...hours, holiday_dates: ['2026-11-24'], holiday: { closed: true } };
  assert.equal(core.tenantBusinessHoursStatus(context(bh), new Date('2026-11-23T22:00:00Z')).next_opening.formatted, 'quarta-feira às 09:00');
  assert.equal(core.tenantBusinessHoursStatus(context(hours), new Date('2026-11-29T02:30:00Z')).next_opening.formatted, 'segunda-feira às 09:00');
});
for (const [name, engine] of [['CORE', core], ['Salon', salon]]) {
  for (const [label, instant, expected] of [['hoje', '2026-11-24T14:00:00Z', 'hoje às 13:00'], ['futuro', '2026-11-23T22:00:00Z', 'amanhã às 13:00']]) test(name + ' encontra abertura após almoço: ' + label, () => {
    const bh = { ...hours, holiday_dates: ['2026-11-24'], holiday: { start: '12:30', end: '18:00' } };
    assert.equal(engine.tenantBusinessHoursStatus(context(bh), new Date(instant)).next_opening.formatted, expected);
  });
  for (const [label, instant, expected] of [['hoje', '2026-11-24T14:00:00Z', 'amanhã às 09:00'], ['futuro', '2026-11-23T22:00:00Z', 'quarta-feira às 09:00']]) test(name + ' pula dia inteiramente coberto pelo almoço: ' + label, () => {
    const bh = { ...hours, holiday_dates: ['2026-11-24'], holiday: { start: '12:00', end: '13:00' } };
    assert.equal(engine.tenantBusinessHoursStatus(context(bh), new Date(instant)).next_opening.formatted, expected);
  });
  test(name + ' calcula almoço, feriado especial e virada local', () => {
    assert.equal(engine.tenantBusinessHoursStatus(context(hours), new Date('2026-11-23T15:30:00Z')).next_opening.formatted, 'hoje às 13:00');
    const bh = { ...hours, holiday_dates: ['2026-11-24'], holiday: { start: '10:00', end: '14:00' } };
    assert.equal(engine.tenantBusinessHoursStatus(context(bh), new Date('2026-11-24T01:00:00Z')).next_opening.formatted, 'amanhã às 10:00');
    assert.equal(engine.tenantBusinessHoursStatus(context(hours), new Date('2026-11-29T15:00:00Z')).next_opening.formatted, 'amanhã às 09:00');
  });
  test(name + ' respeita limites, feriado fechado e fuso do tenant', () => {
    assert.equal(engine.tenantBusinessHoursStatus(context(hours), new Date('2026-11-23T15:00:00Z')).next_opening.formatted, 'hoje às 13:00');
    assert.equal(engine.tenantBusinessHoursStatus(context(hours), new Date('2026-11-23T16:00:00Z')).is_open, true);
    assert.equal(engine.tenantBusinessHoursStatus(context(hours), new Date('2026-11-23T21:00:00Z')).is_open, false);
    const bh = { ...hours, holiday_dates: ['2026-11-24'], holiday: { closed: true } };
    assert.equal(engine.tenantBusinessHoursStatus(context(bh), new Date('2026-11-23T22:00:00Z')).next_opening.formatted, 'quarta-feira às 09:00');
    const manaus = { settings: { timezone: 'America/Manaus', business_hours: hours } };
    assert.equal(engine.tenantBusinessHoursStatus(manaus, new Date('2026-11-23T15:30:00Z')).is_open, true);
    assert.equal(engine.tenantBusinessHoursStatus(context(hours), new Date('2026-11-23T15:30:00Z')).is_open, false);
  });
  test(name + ' avança por data civil ao mudar horário de verão', () => {
    const bh = { ...hours, days: ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'],
      holiday_dates: ['2026-03-08'], holiday: { closed: true } };
    const ny = { settings: { timezone: 'America/New_York', business_hours: bh } };
    assert.equal(engine.tenantBusinessHoursStatus(ny, new Date('2026-03-08T04:30:00Z')).next_opening.formatted, 'segunda-feira às 09:00');
  });
}
async function load(settings) {
  const globals = { tenantSlug: 'ic_salon', inputJson: { tenant_id: 't', instance: 'i' }, encodeFilter: encodeURIComponent,
    supabaseGet: async url => url.includes('/tenants?') ? [{ id: 't', status: 'active' }] : url.includes('/tenant_settings?') ? [{ settings }] : url.includes('/channels?') ? [{}] : [],
    helpers: {}, tenantGeminiDailyLimit: () => 0, tenantBusinessRules: {}, activeTenantTimeZone: '', geminiTenantBudget: null };
  return functions('clients/ic_saloon/salon_engine.js', ['loadTenantContext'], globals).loadTenantContext();
}
const base = { whatsapp_processing_mode: 'conversation_core_v1' };
test('Salon aceita configuração compatível atual', async () => assert.ok(await load(base)));
for (const mode of [{ grounding_mode: 'canonical_v2' }, { appointment_scheduling: { enabled: true } },
  { conversation_capability: 'sales_v1' }, { noria_turn_pipeline: { enabled: true } }]) {
  test('Salon recusa ' + JSON.stringify(mode), async () => {
    await assert.rejects(load({ ...base, ...mode }), /SALON_ENGINE_MODE_UNSUPPORTED/);
  });
}

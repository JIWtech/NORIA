// Motor do I&C Salon (clients/ic_saloon/salon_engine.js): feriados com horário próprio, iguais ao CORE compartilhado.
// Em data de business_hours.holiday_dates vale business_hours.holiday no lugar do horário do dia da semana.
// Rodar: node --test scripts/test_salon_holiday_hours.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../app/node_modules/typescript');

const root = path.join(__dirname, '..');
const salonCode = fs.readFileSync(path.join(root, 'clients/ic_saloon/salon_engine.js'), 'utf8');

// Carrega funções reais do motor do Salon (por nome, via AST) em um escopo controlado.
function loadSalon(names, globals) {
  const ast = ts.createSourceFile('salon.js', salonCode, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const source = ast.statements.filter(ts.isFunctionDeclaration).filter((n) => names.includes(n.name.text)).map((n) => n.getText(ast)).join('\n');
  const keys = Object.keys(globals);
  return new Function(...keys, source + '\nreturn {' + names.join(',') + '};')(...keys.map((key) => globals[key]));
}

const hours = { start: '09:00', end: '19:00', days: ['terca', 'quarta', 'quinta', 'sexta', 'sabado'], timezone: 'America/Sao_Paulo' };
const salon = loadSalon(['tenantBusinessHoursStatus', 'resolveTenantDayHours', 'normalizeText', 'tenantTimeZone'],
  { settingsFor: (context) => context.settings?.settings || {} });

test('Salon: em data de feriado vale o horário do feriado', () => {
  const context = { settings: { business_hours: { ...hours, holiday: { start: '10:00', end: '14:00' }, holiday_dates: ['2026-11-20'] } } };
  // 20/11/2026 (sexta, feriado) em São Paulo (UTC-3): 11:00 aberto, 15:00 fechado (seria aberto num dia comum).
  assert.equal(salon.tenantBusinessHoursStatus(context, new Date('2026-11-20T14:00:00Z')).is_open, true);
  assert.equal(salon.tenantBusinessHoursStatus(context, new Date('2026-11-20T18:00:00Z')).is_open, false, 'fora do horário do feriado');
  assert.equal(salon.tenantBusinessHoursStatus(context, new Date('2026-11-19T18:00:00Z')).is_open, true, 'dia comum segue o horário normal');
});

test('Salon: feriado marcado como fechado fecha o dia inteiro', () => {
  const context = { settings: { business_hours: { ...hours, holiday: { closed: true }, holiday_dates: ['2026-11-20'] } } };
  assert.equal(salon.tenantBusinessHoursStatus(context, new Date('2026-11-20T14:00:00Z')).is_open, false);
});

test('Salon: sem holiday_dates nada muda', () => {
  const context = { settings: { business_hours: { ...hours, holiday: { start: '10:00', end: '14:00' } } } };
  assert.equal(salon.tenantBusinessHoursStatus(context, new Date('2026-11-20T18:00:00Z')).is_open, true);
});

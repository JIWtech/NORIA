const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../app/node_modules/typescript');

for (const file of ['n8n/sources/noria_core.js', 'clients/ic_saloon/salon_engine.js']) {
  test(`${file}: encaminhamento às 3h respeita o expediente configurado`, () => {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const names = ['settingsFor', 'tenantTimeZone', 'resolveTenantDayHours', 'tenantBusinessHoursStatus', 'sessionHandoffMessage'];
    const code = ast.statements.filter(ts.isFunctionDeclaration).filter(node => names.includes(node.name.text)).map(node => node.getText(ast)).join('\n');
    const { tenantBusinessHoursStatus, sessionHandoffMessage } = new Function('normalizeText', code + '\nreturn { tenantBusinessHoursStatus, sessionHandoffMessage };')(
      value => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    );
    const hours = { days: ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'], start: '08:00', end: '18:00' };
    const context = { settings: { timezone: 'America/Sao_Paulo', business_hours: hours, settings: {} } };
    const status = tenantBusinessHoursStatus(context, new Date('2026-11-12T06:00:00Z'));
    assert.equal(status.configured, true);
    assert.equal(status.is_open, false);
    assert.match(status.next_opening.formatted, /hoje às 08:00/);
    const OriginalDate = global.Date;
    class FixedDate extends OriginalDate { constructor(...args) { super(...(args.length ? args : ['2026-11-12T06:00:00Z'])); } }
    try {
      global.Date = FixedDate;
      assert.match(sessionHandoffMessage(context), /fora do expediente/);
      assert.doesNotMatch(sessionHandoffMessage(context), /Vou chamar/);
      assert.doesNotMatch(sessionHandoffMessage({ settings: { settings: {} } }), /Vou chamar/);
    } finally { global.Date = OriginalDate; }
  });
}

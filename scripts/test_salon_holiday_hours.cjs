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

// Revisor semântico do adaptador: o calendário que ele recebe precisa trazer o horário e as datas de feriado,
// senão compara a resposta com o horário normal (reprova resposta certa ou não barra pedido em feriado fechado).
async function reviewerCalendar(businessHours) {
  const { createSalonHelpers } = require('../clients/ic_saloon/conversation_adapter.cjs');
  const db = 'https://db.test';
  const tenant = '76aff8a0-0466-42b9-a80d-db186ff3d8bd';
  const jid = '5511999999999@s.whatsapp.net';
  let calendar = null;
  const helpers = {
    httpRequest: async (options) => {
      const address = options.url.split('?')[0];
      if (address === db + '/rest/v1/tenant_settings') return [{ settings: { business_hours: businessHours } }];
      if (address === db + '/rest/v1/channel_events') return [{ id: 'cur', message_text: 'vocês abrem no feriado?', ai_provider: 'buffer' }];
      if (address.includes('generativelanguage')) {
        const payload = options.body?.contents?.[0]?.parts?.[0]?.text || '';
        if (payload.includes('"calendar"')) calendar = JSON.parse(payload).calendar;
        const system = options.body.system_instruction.parts[0].text;
        if (system.includes('AGENDAMENTOS CONHECIDOS')) {
          return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'No feriado abrimos das 10:00 às 14:00.' }] } }] };
        }
        return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ allowed: true }) }] } }] };
      }
      return [];
    },
  };
  const salon = createSalonHelpers(helpers, { tenant_id: tenant, tenant_slug: 'ic_salon', instance: 'ic_saloon', noria_engine_phase: 'single', remoteJid: jid },
    { SUPABASE_URL: db });
  await salon.httpRequest({ method: 'GET', url: db + '/rest/v1/tenant_settings?select=settings&tenant_id=eq.' + tenant, headers: {} });
  await salon.httpRequest({ method: 'GET', url: db + '/rest/v1/channel_events?select=*&tenant_slug=eq.ic_salon&channel_type=eq.whatsapp&external_conversation_id=eq.'
    + encodeURIComponent(jid) + '&or=(ai_provider.is.null,ai_provider.neq.buffer)&order=created_at.desc,id.desc&limit=50', headers: {} });
  await salon.httpRequest({ method: 'POST', url: 'https://generativelanguage.googleapis.com/v1beta/models/x:generateContent',
    body: { system_instruction: { parts: [{ text: 'AGENDAMENTOS CONHECIDOS PELO SISTEMA REGRAS OPERACIONAIS CURTAS' }] },
      contents: [{ role: 'user', parts: [{ text: 'vocês abrem no feriado?' }] }] } }).catch(() => null);
  return calendar;
}

test('Salon: revisor recebe horário e próximas datas de feriado no calendário', async () => {
  const calendar = await reviewerCalendar({ schedule: { sexta: { start: '09:00', end: '19:00' } },
    holiday: { start: '10:00', end: '14:00' }, holiday_dates: ['2020-01-01', '2099-12-25'] });
  assert.ok(calendar, 'revisor não foi chamado');
  assert.equal(calendar.funcionamento.sexta?.start, '09:00', 'grade semanal continua');
  assert.equal(calendar.funcionamento.feriados_horario, '10:00 às 14:00');
  assert.deepEqual(calendar.funcionamento.feriados_datas, ['25/12/2099'], 'só datas de hoje em diante');
});

test('Salon: feriado fechado aparece como fechado para o revisor', async () => {
  const calendar = await reviewerCalendar({ schedule: {}, holiday: { closed: true }, holiday_dates: ['2099-12-25'] });
  assert.equal(calendar.funcionamento.feriados_horario, 'fechado');
});

test('Salon: sem holiday_dates nada muda', () => {
  const context = { settings: { business_hours: { ...hours, holiday: { start: '10:00', end: '14:00' } } } };
  assert.equal(salon.tenantBusinessHoursStatus(context, new Date('2026-11-20T18:00:00Z')).is_open, true);
});

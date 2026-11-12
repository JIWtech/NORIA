// IA-21: detectActions precisa reconhecer as tags [AÇÃO: ...] acentuadas e sem acento (CORE e I&C Salon).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function load(file) {
  const source = fs.readFileSync(file, 'utf8');
  const start = source.indexOf('function detectActions(');
  const end = source.indexOf('\nfunction ', start + 10);
  assert.ok(start >= 0 && end > start, `detectActions ausente em ${file}`);
  return new Function(`${source.slice(start, end)}; return detectActions;`)();
}

for (const file of ['n8n/sources/noria_core.js', 'clients/ic_saloon/salon_engine.js']) {
  test(`detectActions reconhece tags acentuadas em ${file}`, () => {
    const detect = load(file);
    assert.equal(detect('Certo! [AÇÃO: RECLAMACAO]').complaint, true);
    assert.equal(detect('[AÇÃO: PRONTO_PARA_AGENDAR]').readyToSchedule, true);
    assert.equal(detect('[ação: criar_agendamento | data=2026-11-20]').createAppointment, true);
    assert.equal(detect('[ACAO: AGENDAMENTO_CONFIRMADO]').createAppointment, true);
    assert.equal(detect('[AÇÃO: OUTRA]').createAppointment, false);
    assert.equal(detect('texto sem tag').complaint, false);
  });
}

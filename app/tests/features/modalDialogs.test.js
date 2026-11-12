import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// IA-12: os três modais usam o hook de diálogo (foco inicial, Tab preso, Escape).
const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('hook de diálogo modal trata Escape, Tab preso e retorno de foco', () => {
  const hook = read('../../src/utils/useModalDialog.js');
  assert.match(hook, /event\.key === 'Escape'/);
  assert.match(hook, /event\.key !== 'Tab'/);
  assert.match(hook, /dialogRef\.current\?\.focus\(\)/);
  assert.match(hook, /previous\.focus\(\)/);
  assert.match(hook, /if \(!busy\) onClose/, 'Escape não fecha enquanto ocupado');
});

test('modais de agenda e Kanban usam o hook', () => {
  for (const file of [
    '../../src/features/appointments/components/AppointmentConfirmDialog.jsx',
    '../../src/features/appointments/components/AppointmentCancelDialog.jsx',
    '../../src/features/kanban/components/ProposalDeliveryDialog.jsx',
  ]) {
    const source = read(file);
    assert.match(source, /useModalDialog\(/, file);
    assert.match(source, /\{\.\.\.dialogProps\}/, file);
    assert.match(source, /aria-modal="true"/, file);
  }
});

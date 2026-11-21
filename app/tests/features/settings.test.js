import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBusinessHours,
  formatBusinessHoursSummary,
} from '../../src/features/settings/utils/businessHours.js';

import { resolveUnits, resolveEnabledChannels } from '../../src/features/settings/utils/units.js';
import { createTeamAgentManagement } from '../../src/services/agents/teamAgentManagement.js';
const formatBusinessHours = formatBusinessHoursSummary;

test('resolves unit address cross-referencing appointment_scheduling.units and business_facts.locations by id', () => {
  const units = {
    angra: { name: 'Angra dos Reis', slug: 'angra' },
    paraty: { name: 'Paraty', slug: 'paraty' },
  };

  const locations = [
    { id: 'angra', name: 'Nova Angra', address: 'Av. Itaguaí, 200 - Nova Angra' },
  ];

  const resolved = resolveUnits(units, locations);
  assert.equal(resolved.length, 2);

  // Unit with matching address
  assert.equal(resolved[0].displayName, 'Nova Angra');
  assert.equal(resolved[0].address, 'Av. Itaguaí, 200 - Nova Angra');

  // Unit without matching address
  assert.equal(resolved[1].displayName, 'Paraty');
  assert.equal(resolved[1].address, null);
});

test('returns empty units list when appointment_scheduling.units is absent or empty', () => {
  const resolved = resolveUnits(null, [{ id: 'angra', address: 'Rua X' }]);
  assert.deepEqual(resolved, []);
});

test('enabled channels has ZERO fallbacks to whatsapp when absent or empty', () => {
  assert.deepEqual(resolveEnabledChannels(null), []);
  assert.deepEqual(resolveEnabledChannels(undefined), []);
  assert.deepEqual(resolveEnabledChannels([]), []);
  assert.deepEqual(resolveEnabledChannels(['whatsapp']), ['whatsapp']);
  assert.deepEqual(resolveEnabledChannels(['whatsapp', 'telegram']), ['whatsapp', 'telegram']);
});

test('business hours returns null when empty or missing to allow omission of KPI card', () => {
  assert.equal(formatBusinessHours(null), null);
  assert.equal(formatBusinessHours({}), null);
  assert.equal(formatBusinessHours(undefined), null);

  const formatted = formatBusinessHours({
    days: ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'],
    start: '08:00',
    end: '18:00',
  });
  assert.equal(formatted, 'Segunda a Sábado · 08:00 às 18:00');
});

test('salva filial e turno vazios como null no serviço real', async () => {
  const inserted = [];
  const client = { from: () => ({ insert: rows => ({ select: () => ({ single: async () => {
    inserted.push(rows[0]);
    return { data: rows[0], error: null };
  } }) }) }) };
  const { saveTeamAgent } = createTeamAgentManagement({ getClient: () => client });
  for (const value of ['', '   ']) {
    const payload = await saveTeamAgent('clinica-nubia', { name: 'Maria Silva', branch: value, shift: value });
    assert.equal(payload.branch, null);
    assert.equal(payload.shift, null);
    assert.equal(payload.tenant_slug, 'clinica-nubia');
  }
  const payload = await saveTeamAgent('clinica-nubia', { name: 'Dra. Camila', role: 'Dentista', branch: 'Nova Angra', shift: '08:00 às 18:00' });
  assert.equal(payload.branch, 'Nova Angra');
  assert.equal(payload.shift, '08:00 às 18:00');
  assert.equal(payload.role, 'Dentista');
  assert.equal(inserted.length, 3);
});

test('parseBusinessHours lida corretamente com objetos estruturados, strings e fallbacks', () => {
  // Nulos e vazios
  assert.equal(parseBusinessHours(null), null);
  assert.equal(parseBusinessHours({}), null);
  assert.equal(parseBusinessHours(''), null);
  assert.equal(parseBusinessHours('   '), null);

  // String simples
  assert.deepEqual(parseBusinessHours('08:00 às 18:00'), {
    days: null,
    time: '08:00 às 18:00',
    extra: null,
  });

  // String com delimitador ·
  assert.deepEqual(parseBusinessHours('Seg a Sex · 08:00 às 18:00 · Sáb 08:00 às 12:00'), {
    days: 'Seg a Sex',
    time: '08:00 às 18:00',
    extra: 'Sáb 08:00 às 12:00',
  });

  // Objeto com start e end e 6 dias (Segunda a Sábado)
  assert.deepEqual(
    parseBusinessHours({
      days: ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'],
      start: '08:00',
      end: '18:00',
    }),
    {
      days: 'Segunda a Sábado',
      time: '08:00 às 18:00',
      extra: null,
    }
  );

  // Objeto com start e end e 5 dias (Segunda a Sexta)
  assert.deepEqual(
    parseBusinessHours({
      days: ['segunda', 'terca', 'quarta', 'quinta', 'sexta'],
      start: '09:00',
      end: '19:00',
    }),
    {
      days: 'Segunda a Sexta',
      time: '09:00 às 19:00',
      extra: null,
    }
  );

  // Objeto com formato weekdays / saturday
  assert.deepEqual(
    parseBusinessHours({
      weekdays: '08:00 às 18:00',
      saturday: '08:00 às 13:00',
    }),
    {
      days: 'Segunda a Sexta',
      time: '08:00 às 18:00',
      extra: 'Sábado: 08:00 às 13:00',
    }
  );
});

test('formatBusinessHoursSummary gera resumo legivel em linha unica', () => {
  assert.equal(formatBusinessHoursSummary(null), null);
  assert.equal(formatBusinessHoursSummary({}), null);
  assert.equal(formatBusinessHoursSummary('08:00 às 18:00'), null);

  assert.equal(
    formatBusinessHoursSummary({
      days: ['segunda', 'terca', 'quarta', 'quinta', 'sexta'],
      start: '08:00',
      end: '18:00',
    }),
    'Segunda a Sexta · 08:00 às 18:00'
  );

  assert.equal(
    formatBusinessHoursSummary({
      weekdays: '08:00 às 18:00',
      saturday: '08:00 às 12:00',
    }),
    'Seg a Sex: 08:00 às 18:00 · Sáb: 08:00 às 12:00'
  );
});

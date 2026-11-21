import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import parser from '@babel/parser';
import traverseModule from '@babel/traverse';
import {
  getConversationStartedAt,
  getConversationsForPeriod,
  getDashboardMetricsData,
  getMetricTrendSeries,
  getPeakActivityData,
  getWhoAttendsData,
} from '../../src/features/dashboard/utils/activityData.js';

const traverse = traverseModule.default || traverseModule;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('A8: averageHourly nao e inflado por 7x em 7d nem por 30x em 30d', () => {
  const now = new Date(2026, 10, 21, 18, 0, 0);
  const makeConversation = (daysAgo, hour) => {
    const dt = new Date(2026, 10, 21 - daysAgo, hour, 15, 0);
    return {
      id: `conv-${daysAgo}-${hour}-${Math.random()}`,
      messages: [{ from: 'contact', createdAt: dt.toISOString() }],
    };
  };

  // 168 conversas ao longo de 7 dias = 1 conversa/hora (antes retornava Math.round(168/24) = 7)
  const sevenDayConvs = [];
  for (let d = 0; d < 7; d += 1) {
    for (let h = 0; h < 24; h += 1) {
      sevenDayConvs.push(makeConversation(d, h));
    }
  }
  const peak7d = getPeakActivityData(sevenDayConvs, '7d', now);
  assert.equal(peak7d.total, 168);
  assert.equal(peak7d.averageHourly, 1);

  // 720 conversas ao longo de 30 dias = 1 conversa/hora (antes retornava Math.round(720/24) = 30)
  const thirtyDayConvs = [];
  for (let d = 0; d < 30; d += 1) {
    for (let h = 0; h < 24; h += 1) {
      thirtyDayConvs.push(makeConversation(d, h));
    }
  }
  const peak30d = getPeakActivityData(thirtyDayConvs, '30d', now);
  assert.equal(peak30d.total, 720);
  assert.equal(peak30d.averageHourly, 1);

  // 24 conversas hoje = 1 conversa/hora
  const todayConvs = Array.from({ length: 24 }, (_, h) => makeConversation(0, h));
  const peakToday = getPeakActivityData(todayConvs, 'today', now);
  assert.equal(peakToday.total, 24);
  assert.equal(peakToday.averageHourly, 1);
});

test('A8: parse pt-BR de message.at nao inverte dia/mes nem cai no ano 2001 e prioriza createdAt/created_at', () => {
  const ref = new Date(2026, 9, 8, 12, 0, 0); // 08/10/2026
  const convPtBr = {
    id: 'conv-ptbr',
    messages: [
      { from: 'contact', at: '06/10, 13:51' }, // 6 de outubro (antes virava 10/06/2001)
      { from: 'ai', at: '06/10, 13:52' },
    ],
  };

  const started = getConversationStartedAt(convPtBr, ref);
  assert.ok(started instanceof Date);
  assert.equal(started.getFullYear(), 2026);
  assert.equal(started.getMonth(), 9); // outubro = 9
  assert.equal(started.getDate(), 6);
  assert.equal(started.getHours(), 13);
  assert.equal(started.getMinutes(), 51);

  const in7d = getConversationsForPeriod([convPtBr], '7d', ref);
  assert.equal(in7d.length, 1);

  // Quando created_at existe junto com at, created_at deve prevalecer
  const convPriority = {
    id: 'conv-prio',
    messages: [
      { from: 'contact', created_at: '2026-10-08T10:00:00', at: '01/01, 00:00' },
      { from: 'ai', created_at: '2026-10-08T10:00:30', at: '01/01, 00:05' },
    ],
  };
  const metrics = getDashboardMetricsData([convPriority], ref);
  assert.equal(metrics.conversationsToday, 1);
  assert.equal(metrics.averageFirstResponseSeconds, 30);

  // Datas invalidas como 31/02 devem ser rejeitadas
  const convInvalidDate = {
    id: 'conv-invalid',
    messages: [{ from: 'contact', at: '31/02/2026, 10:00' }],
  };
  assert.equal(getConversationStartedAt(convInvalidDate, ref), null);
});

test('A8: donut Quem atende com 0 conversas nao fica 100% Humano', () => {
  const emptyStats = getWhoAttendsData([], 36);
  assert.equal(emptyStats.total, 0);
  assert.equal(emptyStats.iaCount, 0);
  assert.equal(emptyStats.humanCount, 0);
  assert.equal(emptyStats.iaPct, 0);
  assert.equal(emptyStats.humanPct, 0);
  assert.equal(emptyStats.iaStrokeDash, 0);
  assert.equal(emptyStats.humanStrokeDash, 0);

  const mixedStats = getWhoAttendsData([
    { status: 'ia_ativa' },
    { status: 'atendimento_humano' },
  ], 36);
  assert.equal(mixedStats.total, 2);
  assert.equal(mixedStats.iaCount, 1);
  assert.equal(mixedStats.humanCount, 1);
  assert.equal(mixedStats.iaPct, 50);
  assert.ok(mixedStats.iaStrokeDash > 0);
  assert.ok(mixedStats.humanStrokeDash > 0);
});

test('A8: getDashboardMetricsData e getMetricTrendSeries aceitam now string, timestamp ou nulo sem TypeError', () => {
  const convs = [
    {
      id: 'c1',
      status: 'ia_ativa',
      messages: [
        { from: 'contact', createdAt: '2026-11-21T10:00:00' },
        { from: 'ai', createdAt: '2026-11-21T10:00:10' },
      ],
    },
  ];

  const fromIso = getDashboardMetricsData(convs, '2026-11-21T14:30:00');
  assert.equal(fromIso.conversationsToday, 1);
  assert.equal(fromIso.trendSeries.conversations.length, 15); // horas 00..14

  const fromTimestamp = getDashboardMetricsData(convs, new Date(2026, 10, 21, 9, 0, 0).getTime());
  assert.equal(fromTimestamp.conversationsToday, 1);
  assert.equal(fromTimestamp.trendSeries.conversations.length, 10); // horas 00..09

  assert.doesNotThrow(() => getDashboardMetricsData(convs, null));
  assert.doesNotThrow(() => getDashboardMetricsData(convs, 'data-invalida'));
  assert.doesNotThrow(() => getMetricTrendSeries(convs, null, '2026-11-21T14:30:00'));
  assert.doesNotThrow(() => getMetricTrendSeries(convs, null, null));
});

test('A8 REGRESSAO AST: PeakActivitySection.jsx nao possui identificadores indefinidos e protege o donut vazio', () => {
  const filePath = path.join(__dirname, '../../src/features/dashboard/components/PeakActivitySection.jsx');
  const code = fs.readFileSync(filePath, 'utf8');
  assert.match(code, /getWhoAttendsData/);
  assert.match(code, /stats\.total > 0/);

  const ast = parser.parse(code, { sourceType: 'module', plugins: ['jsx'] });
  const jsGlobals = new Set([
    'React', 'Number', 'String', 'Array', 'Object', 'Math', 'Date', 'Set', 'Map',
    'Boolean', 'Intl', 'undefined', 'null', 'Infinity', 'NaN',
  ]);
  const undefinedRefs = new Set();
  traverse(ast, {
    ReferencedIdentifier(p) {
      const name = p.node.name;
      if (jsGlobals.has(name)) return;
      if (!p.scope.hasBinding(name)) undefinedRefs.add(name);
    },
  });
  assert.deepEqual(Array.from(undefinedRefs), []);
});

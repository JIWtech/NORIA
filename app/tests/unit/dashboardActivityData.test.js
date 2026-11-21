import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSparklinePaths,
  getDashboardMetricsData,
  getPeakActivityData,
} from '../../src/features/dashboard/utils/activityData.js';

test('distribui conversas nas 24 horas reais, inclusive madrugada e fim do dia', () => {
  const now = new Date(2026, 10, 21, 23, 59);
  const conversations = [0, 7, 23].map((hour) => ({ createdAt: new Date(2026, 10, 21, hour, 0).toISOString() }));
  const result = getPeakActivityData(conversations, 'today', now);
  assert.equal(result.points.length, 24);
  assert.equal(result.points.find((point) => point.hour === '00').value, 1);
  assert.equal(result.points.find((point) => point.hour === '07').value, 1);
  assert.equal(result.points.find((point) => point.hour === '23').value, 1);
});

function conversation(id, startedAt, options = {}) {
  return {
    id,
    status: options.status || 'ia_ativa',
    stage: options.stage || 'Qualificação',
    ownerKind: options.ownerKind || 'ai',
    lastActivityAt: options.lastActivityAt || startedAt,
    messages: options.messages || [
      { from: 'contact', createdAt: startedAt },
    ],
  };
}

test('peak activity filters real conversation starts for today, 7 days, and 30 days', () => {
  const now = new Date(2026, 9, 12, 18, 0, 0);
  const conversations = [
    conversation('today-1', new Date(2026, 9, 12, 11, 5).toISOString()),
    conversation('today-2', new Date(2026, 9, 12, 11, 45).toISOString()),
    conversation('week', new Date(2026, 9, 8, 16, 20).toISOString()),
    conversation('month', new Date(2026, 8, 20, 9, 10).toISOString()),
    conversation('old', new Date(2026, 7, 1, 10, 0).toISOString()),
  ];

  const today = getPeakActivityData(conversations, 'today', now);
  const sevenDays = getPeakActivityData(conversations, '7d', now);
  const thirtyDays = getPeakActivityData(conversations, '30d', now);

  assert.equal(today.total, 2);
  assert.equal(today.points.find((point) => point.hour === '11').value, 2);
  assert.equal(today.primaryPeak.hour, '11');
  assert.equal(sevenDays.total, 3);
  assert.equal(sevenDays.points.find((point) => point.hour === '16').value, 1);
  assert.equal(thirtyDays.total, 4);
});

test('peak activity changes immediately when a realtime conversation is appended', () => {
  const now = new Date(2026, 9, 12, 18, 0, 0);
  const initial = [conversation('first', new Date(2026, 9, 12, 14, 5).toISOString())];
  const incoming = conversation('realtime', new Date(2026, 9, 12, 14, 40).toISOString());

  const before = getPeakActivityData(initial, 'today', now);
  const after = getPeakActivityData([...initial, incoming], 'today', now);

  assert.equal(before.points.find((point) => point.hour === '14').value, 1);
  assert.equal(after.points.find((point) => point.hour === '14').value, 2);
  assert.equal(after.total, 2);
});

test('dashboard metrics use real data and keep empty states at zero', () => {
  const now = new Date(2026, 9, 12, 18, 0, 0);

  assert.deepEqual(getDashboardMetricsData([], now), {
    conversationsToday: 0,
    aiSharePct: 0,
    averageFirstResponseSeconds: null,
    qualifiedLeads: 0,
    hourlyConversationCounts: Array(24).fill(0),
    hourlyAiCounts: Array(24).fill(0),
    hourlyQualifiedCounts: Array(24).fill(0),
    hourlyResponseSeconds: Array(24).fill(0),
    trendSeries: {
      conversations: Array(19).fill(0),
      aiShare: Array(19).fill(0),
      responseSeconds: Array(19).fill(0),
      qualified: Array(19).fill(0),
    },
  });

  const conversations = [
    conversation('qualified', new Date(2026, 9, 12, 10, 0).toISOString(), {
      stage: 'Qualificado',
      messages: [
        { from: 'contact', createdAt: new Date(2026, 9, 12, 10, 0, 0).toISOString() },
        { from: 'ai', createdAt: new Date(2026, 9, 12, 10, 0, 30).toISOString() },
      ],
    }),
    conversation('human', new Date(2026, 9, 12, 16, 0).toISOString(), {
      status: 'atendimento_humano',
      ownerKind: 'agent',
      messages: [
        { from: 'contact', createdAt: new Date(2026, 9, 12, 16, 0, 0).toISOString() },
        { from: 'agent', createdAt: new Date(2026, 9, 12, 16, 1, 0).toISOString() },
      ],
    }),
  ];

  const metrics = getDashboardMetricsData(conversations, now);
  assert.equal(metrics.conversationsToday, 2);
  assert.equal(metrics.aiSharePct, 50);
  assert.equal(metrics.averageFirstResponseSeconds, 30);
  assert.equal(metrics.qualifiedLeads, 1);
  assert.equal(metrics.hourlyConversationCounts[10], 1);
  assert.equal(metrics.hourlyConversationCounts[16], 1);
  assert.equal(metrics.hourlyAiCounts[10], 1);
  assert.equal(metrics.hourlyQualifiedCounts[10], 1);
  assert.equal(metrics.hourlyResponseSeconds[10], 30);
  assert.equal(metrics.hourlyResponseSeconds[16], 0);
  assert.deepEqual(metrics.trendSeries.conversations, [...Array(10).fill(0), ...Array(6).fill(1), ...Array(3).fill(2)]);
  assert.deepEqual(metrics.trendSeries.aiShare, [...Array(10).fill(0), ...Array(6).fill(100), ...Array(3).fill(50)]);
  assert.deepEqual(metrics.trendSeries.responseSeconds, [...Array(10).fill(0), ...Array(9).fill(30)]);
  assert.deepEqual(metrics.trendSeries.qualified, [...Array(10).fill(0), ...Array(9).fill(1)]);
});

test('sparkline paths reflect the supplied realtime series', () => {
  const flat = buildSparklinePaths([0, 0, 0]);
  const rising = buildSparklinePaths([0, 1, 3]);

  assert.notEqual(flat.line, rising.line);
  assert.match(rising.line, /^M /);
  assert.match(rising.area, /Z$/);
});

test('isAiConversation correctly detects real inbound conversations where owner is null', () => {
  // Real inbound WhatsApp chat where owner has not been claimed by a human
  const inboundChat = {
    id: 'whatsapp-5511999999999',
    status: 'ia_ativa',
    owner: null,
    ownerKind: null,
    handoff: false,
    messages: [
      { from: 'contact', text: 'Olá!', createdAt: '2026-10-14T10:00:00Z' },
      { from: 'ai', text: 'Olá! Sou o assistente virtual.', createdAt: '2026-10-14T10:00:05Z' },
    ],
  };

  const humanChat = {
    id: 'whatsapp-human',
    status: 'atendimento_humano',
    owner: 'Carlos',
    ownerKind: 'agent',
    handoff: true,
    lastActivityAt: '2026-10-14T10:00:00Z',
  };

  // Metrics with 1 single AI conversation (owner is null)
  const now = new Date(2026, 9, 14, 12, 0, 0);
  const metrics = getDashboardMetricsData([inboundChat], now);
  assert.equal(metrics.aiSharePct, 100);

  // When mixed with a human conversation
  const mixedMetrics = getDashboardMetricsData([inboundChat, humanChat], now);
  assert.equal(mixedMetrics.aiSharePct, 50);
});

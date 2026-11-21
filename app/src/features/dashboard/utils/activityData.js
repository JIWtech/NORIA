export const DASHBOARD_HOURS = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'));

const PERIOD_DAYS = { today: 1, '7d': 7, '30d': 30 };

function toValidDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function getConversationStartedAt(conversation = {}) {
  const messageDates = (conversation.messages || [])
    .map((message) => toValidDate(message.createdAt || message.created_at || message.at))
    .filter(Boolean)
    .sort((left, right) => left - right);

  return messageDates[0]
    || toValidDate(conversation.createdAt || conversation.created_at)
    || toValidDate(conversation.latestCustomerInboundAt)
    || toValidDate(conversation.lastActivityAt || conversation.last_activity_at)
    || toValidDate(conversation.updatedAt || conversation.updated_at);
}

function getPeriodStart(period, now) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((PERIOD_DAYS[period] || PERIOD_DAYS['7d']) - 1));
  return start;
}

export function getConversationsForPeriod(conversations = [], period = 'today', now = new Date()) {
  const reference = toValidDate(now) || new Date();
  const start = getPeriodStart(period, reference);
  const end = new Date(reference);
  end.setHours(23, 59, 59, 999);

  return (Array.isArray(conversations) ? conversations : []).filter((conversation) => {
    const startedAt = getConversationStartedAt(conversation);
    return startedAt && startedAt >= start && startedAt <= end;
  });
}

export function isAiConversation(conversation) {
  if (!conversation) return false;
  if (conversation.status === 'atendimento_humano') return false;
  if (conversation.handoff === true) return false;
  if (conversation.salesAiLocked === true || conversation.salesLead?.ai_locked === true) return false;
  if (conversation.ownerKind === 'agent' && conversation.owner && conversation.owner !== 'Assistente IA') {
    return false;
  }
  const stage = String(conversation.stage || '').toLowerCase();
  if (stage.includes('humano')) return false;

  return true;
}

export function isQualifiedConversation(conversation) {
  if (!conversation) return false;
  const stage = `${conversation.stage || ''} ${conversation.salesStageKey || ''}`.toLowerCase();
  return /(qualificad|proposta|negocia|agendad|cliente.fechado|finalizad)/.test(stage);
}

function getFirstResponseSeconds(conversation) {
  const orderedMessages = (conversation.messages || [])
    .map((message) => ({ ...message, parsedAt: toValidDate(message.createdAt || message.at || message.created_at) }))
    .filter((message) => message.parsedAt)
    .sort((left, right) => left.parsedAt - right.parsedAt);
  const inboundIndex = orderedMessages.findIndex((message) => message.from === 'contact');
  if (inboundIndex < 0) return null;
  const inbound = orderedMessages[inboundIndex];
  // Exclusivo da IA: mede o tempo até a primeira resposta da IA
  const response = orderedMessages.slice(inboundIndex + 1).find((message) => message.from === 'ai');
  if (!response) return null;
  return Math.max(0, Math.round((response.parsedAt - inbound.parsedAt) / 1000));
}

function getHourIndex(conversation) {
  const startedAt = getConversationStartedAt(conversation);
  if (!startedAt) return -1;
  const hour = startedAt.getHours();
  return DASHBOARD_HOURS.indexOf(String(hour).padStart(2, '0'));
}

export function getPeakActivityData(conversations = [], period = '7d', now = new Date()) {
  const periodConversations = getConversationsForPeriod(conversations, period, now);
  const counts = Array(DASHBOARD_HOURS.length).fill(0);
  periodConversations.forEach((conversation) => {
    const hourIndex = getHourIndex(conversation);
    if (hourIndex >= 0) counts[hourIndex] += 1;
  });

  const maxValue = Math.max(0, ...counts);
  const points = DASHBOARD_HOURS.map((hour, index) => ({
    hour,
    value: counts[index],
    heightPct: counts[index] > 0
      ? (maxValue > 0 ? Math.max(8, Math.round((counts[index] / maxValue) * 100)) : 0)
      : 0,
  }));
  const ranked = [...points].sort((left, right) => right.value - left.value || left.hour.localeCompare(right.hour));
  const primaryPeak = ranked[0] || { hour: '—', value: 0 };
  const secondaryPeak = ranked.find((point) => point.hour !== primaryPeak.hour && point.value > 0) || null;

  return {
    period,
    total: periodConversations.length,
    averageHourly: periodConversations.length > 0 ? Math.round(periodConversations.length / DASHBOARD_HOURS.length) : 0,
    maxValue,
    primaryPeak,
    secondaryPeak,
    points,
  };
}

export function getDashboardMetricsData(conversations = [], now = new Date()) {
  const todayConversations = getConversationsForPeriod(conversations, 'today', now);
  const hourlyConversationCounts = Array(DASHBOARD_HOURS.length).fill(0);
  const hourlyAiCounts = Array(DASHBOARD_HOURS.length).fill(0);
  const hourlyQualifiedCounts = Array(DASHBOARD_HOURS.length).fill(0);
  const hourlyResponseTotals = Array(DASHBOARD_HOURS.length).fill(0);
  const hourlyResponseSamples = Array(DASHBOARD_HOURS.length).fill(0);
  const responseSeconds = [];

  todayConversations.forEach((conversation) => {
    const hourIndex = getHourIndex(conversation);
    const response = getFirstResponseSeconds(conversation);
    if (hourIndex >= 0) {
      hourlyConversationCounts[hourIndex] += 1;
      if (isAiConversation(conversation)) hourlyAiCounts[hourIndex] += 1;
      if (isQualifiedConversation(conversation)) hourlyQualifiedCounts[hourIndex] += 1;
      if (response !== null) {
        hourlyResponseTotals[hourIndex] += response;
        hourlyResponseSamples[hourIndex] += 1;
      }
    }
    if (response !== null) responseSeconds.push(response);
  });

  const allConversations = Array.isArray(conversations) ? conversations : [];
  const allAiCount = allConversations.filter(isAiConversation).length;
  const overallAiSharePct = allConversations.length > 0 ? Math.round((allAiCount / allConversations.length) * 100) : 0;
  const allQualifiedLeads = allConversations.filter(isQualifiedConversation).length;

  const aiCount = todayConversations.filter(isAiConversation).length;
  const todayAiSharePct = todayConversations.length > 0 ? Math.round((aiCount / todayConversations.length) * 100) : 0;
  const aiSharePct = todayConversations.length > 0 ? todayAiSharePct : overallAiSharePct;
  const qualifiedLeads = todayConversations.length > 0
    ? todayConversations.filter(isQualifiedConversation).length
    : allQualifiedLeads;
  const averageFirstResponseSeconds = responseSeconds.length > 0
    ? Math.round(responseSeconds.reduce((sum, value) => sum + value, 0) / responseSeconds.length)
    : null;
  const currentHourIndex = Math.max(0, Math.min(DASHBOARD_HOURS.length - 1, now.getHours()));
  const visibleLength = currentHourIndex + 1;
  let cumulativeConversations = 0;
  let cumulativeAi = 0;
  let cumulativeQualified = 0;
  let cumulativeResponseTotal = 0;
  let cumulativeResponseSamples = 0;
  const trendSeries = {
    conversations: [],
    aiShare: [],
    responseSeconds: [],
    qualified: [],
  };

  for (let index = 0; index < visibleLength; index += 1) {
    cumulativeConversations += hourlyConversationCounts[index];
    cumulativeAi += hourlyAiCounts[index];
    cumulativeQualified += hourlyQualifiedCounts[index];
    cumulativeResponseTotal += hourlyResponseTotals[index];
    cumulativeResponseSamples += hourlyResponseSamples[index];
    trendSeries.conversations.push(cumulativeConversations);
    trendSeries.aiShare.push(cumulativeConversations > 0 ? Math.round((cumulativeAi / cumulativeConversations) * 100) : 0);
    trendSeries.responseSeconds.push(cumulativeResponseSamples > 0 ? Math.round(cumulativeResponseTotal / cumulativeResponseSamples) : 0);
    trendSeries.qualified.push(cumulativeQualified);
  }

  return {
    conversationsToday: todayConversations.length,
    aiSharePct,
    averageFirstResponseSeconds,
    qualifiedLeads,
    hourlyConversationCounts,
    hourlyAiCounts,
    hourlyQualifiedCounts,
    hourlyResponseSeconds: hourlyResponseTotals.map((total, index) => (
      hourlyResponseSamples[index] > 0 ? Math.round(total / hourlyResponseSamples[index]) : 0
    )),
    trendSeries,
  };
}

function buildSplinePath(coordinates, padding = 4, height = 28) {
  if (coordinates.length <= 1) {
    const p = coordinates[0] || { x: 0, y: height - padding };
    return `M ${p.x},${p.y}`;
  }
  if (coordinates.length === 2) {
    return `M ${coordinates[0].x},${coordinates[0].y} L ${coordinates[1].x},${coordinates[1].y}`;
  }
  let path = `M ${coordinates[0].x},${coordinates[0].y}`;
  const minY = padding;
  const maxY = height - padding;

  for (let i = 0; i < coordinates.length - 1; i += 1) {
    const p0 = coordinates[Math.max(0, i - 1)];
    const p1 = coordinates[i];
    const p2 = coordinates[i + 1];
    const p3 = coordinates[Math.min(coordinates.length - 1, i + 2)];

    let cp1x = Math.round((p1.x + (p2.x - p0.x) / 6) * 10) / 10;
    let cp1y = Math.round((p1.y + (p2.y - p0.y) / 6) * 10) / 10;
    let cp2x = Math.round((p2.x - (p3.x - p1.x) / 6) * 10) / 10;
    let cp2y = Math.round((p2.y - (p3.y - p1.y) / 6) * 10) / 10;

    // Clamp strictly within bounds to guarantee curve never overshoots or dips into negative space
    cp1y = Math.max(minY, Math.min(maxY, cp1y));
    cp2y = Math.max(minY, Math.min(maxY, cp2y));

    path += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }
  return path;
}

export function buildSparklinePaths(values = [], width = 88, height = 28) {
  const safeValues = values.length > 0 ? values : [0];
  const allZero = safeValues.every((value) => value === 0);
  const maxValue = Math.max(1, ...safeValues);
  const step = safeValues.length > 1 ? width / (safeValues.length - 1) : width;
  const padding = 4;
  const usableHeight = height - (padding * 2);

  const coordinates = safeValues.map((value, index) => {
    const x = Math.round(index * step * 10) / 10;
    let y;
    if (allZero) {
      y = height - padding;
    } else {
      const clampedVal = Math.max(0, Math.min(maxValue, value));
      const normalized = clampedVal / maxValue;
      y = Math.round((height - padding - (normalized * usableHeight)) * 10) / 10;
    }
    return { x, y };
  });

  const line = buildSplinePath(coordinates, padding, height);
  const last = coordinates[coordinates.length - 1] || { x: width, y: Math.round(height / 2) };
  return {
    line,
    area: `${line} L ${last.x},${height} L 0,${height} Z`,
    lastPoint: last,
    isZero: allZero,
    hasData: !allZero,
  };
}

export function getMetricTrendSeries(conversations = [], metrics = null, now = new Date()) {
  const safeConversations = Array.isArray(conversations) ? conversations : [];
  const baseMetrics = metrics || getDashboardMetricsData(safeConversations, now);

  if (baseMetrics.conversationsToday > 0 && baseMetrics.trendSeries?.conversations?.length >= 3) {
    return baseMetrics.trendSeries;
  }

  if (safeConversations.length === 0) {
    return baseMetrics.trendSeries;
  }

  const sevenDayCounts = Array(7).fill(0);
  const sevenDayAi = Array(7).fill(0);
  const sevenDayQualified = Array(7).fill(0);
  const sevenDayResponseTotals = Array(7).fill(0);
  const sevenDayResponseSamples = Array(7).fill(0);

  const endOfYesterday = new Date(now);
  endOfYesterday.setDate(endOfYesterday.getDate() - 1);
  endOfYesterday.setHours(23, 59, 59, 999);

  safeConversations.forEach((conv) => {
    const startedAt = getConversationStartedAt(conv);
    if (!startedAt) return;
    const diffMs = endOfYesterday.getTime() - startedAt.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays >= 0 && diffDays < 7) {
      const dayIndex = 6 - diffDays;
      sevenDayCounts[dayIndex] += 1;
      if (isAiConversation(conv)) sevenDayAi[dayIndex] += 1;
      if (isQualifiedConversation(conv)) sevenDayQualified[dayIndex] += 1;
      const resp = getFirstResponseSeconds(conv);
      if (resp !== null) {
        sevenDayResponseTotals[dayIndex] += resp;
        sevenDayResponseSamples[dayIndex] += 1;
      }
    }
  });

  const sevenDayAiPct = sevenDayCounts.map((count, i) => (
    count > 0 ? Math.round((sevenDayAi[i] / count) * 100) : 0
  ));
  const sevenDayResponseAvg = sevenDayResponseTotals.map((tot, i) => (
    sevenDayResponseSamples[i] > 0 ? Math.round(tot / sevenDayResponseSamples[i]) : 0
  ));

  const hasHistoricalTraffic = sevenDayCounts.some((v) => v > 0);
  if (!hasHistoricalTraffic) {
    return baseMetrics.trendSeries;
  }

  return {
    conversations: sevenDayCounts,
    aiShare: sevenDayAiPct,
    responseSeconds: sevenDayResponseAvg,
    qualified: sevenDayQualified,
  };
}

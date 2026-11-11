import React, { useMemo } from 'react';
import { buildSparklinePaths, getDashboardMetricsData, getMetricTrendSeries } from '../utils/activityData';

function MetricSparkline({ color, values, id }) {
  const points = buildSparklinePaths(values, 88, 28);
  const lastPoint = points.lastPoint || { x: 88, y: 14 };
  const showPulse = !points.isZero;

  return (
    <svg className="metric-sparkline" viewBox="0 0 90 32" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={`metric-gradient-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={points.isZero ? '0.08' : '0.42'} />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={points.area} fill={`url(#metric-gradient-${id})`} className="metric-sparkline-area" />
      <path
        d={points.line}
        stroke={color}
        style={{ color, opacity: points.isZero ? 0.35 : 1 }}
        className="metric-sparkline-line"
      />
      {showPulse && (
        <>
          <circle cx={lastPoint.x} cy={lastPoint.y} r="4" fill={color} className="metric-sparkline-pulse" />
          <circle cx={lastPoint.x} cy={lastPoint.y} r="1.8" fill="#ffffff" className="metric-sparkline-dot" />
        </>
      )}
    </svg>
  );
}

export function DashboardMetrics({ conversations = [], ready = true }) {
  const metrics = useMemo(() => getDashboardMetricsData(conversations), [conversations]);
  const trendSeries = useMemo(() => getMetricTrendSeries(conversations, metrics), [conversations, metrics]);
  const totalCount = Array.isArray(conversations) ? conversations.length : 0;

  const cards = [
    {
      id: 'total-conversas',
      title: 'Conversas',
      badge: 'Tempo Real',
      value: totalCount,
      color: '#38bdf8',
      values: trendSeries.conversations,
    },
    {
      id: 'atendido-ia',
      title: 'Atendido pela IA',
      badge: 'Automação',
      value: `${metrics.aiSharePct}%`,
      color: '#a855f7',
      values: trendSeries.aiShare,
    },
    {
      id: 'tempo-resposta',
      title: 'Tempo da 1ª resposta',
      badge: 'IA',
      value: metrics.averageFirstResponseSeconds === null ? '—' : `${metrics.averageFirstResponseSeconds}s`,
      color: '#06b6d4',
      values: trendSeries.responseSeconds,
    },
    {
      id: 'leads-qualificados',
      title: 'Leads qualificados',
      badge: 'Funil',
      value: metrics.qualifiedLeads,
      color: '#3b82f6',
      values: trendSeries.qualified,
    },
  ];

  return (
    <div className="dashboard-top-metrics-grid" role="region" aria-label="Métricas Principais">
      {cards.map((card) => (
        <article
          className={`dashboard-metric-card metric-card-${card.id}`}
          key={card.id}
          style={{ '--card-accent': card.color }}
        >
          <div className="metric-card-accent-bar" style={{ backgroundColor: card.color }} aria-hidden="true" />
          <div className="metric-card-info">
            <div className="metric-card-title-row">
              <span className="metric-card-title">{card.title}</span>
              <span className="metric-card-badge">{card.badge}</span>
            </div>
            <div className="metric-card-value-row">
              <strong className="metric-card-value">{ready ? card.value : '—'}</strong>
            </div>
          </div>
          <div className="metric-card-chart-wrap">
            <MetricSparkline
              color={card.color}
              values={!ready || card.value === '—' || card.value === 0 || card.value === '0%' ? [0] : card.values}
              id={card.id}
            />
          </div>
        </article>
      ))}
    </div>
  );
}

export default DashboardMetrics;

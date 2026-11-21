import React, { useState, useMemo } from 'react';
import { SkeletonBlock, SkeletonLine } from '../../../components/ui/Skeletons';
import {
  getConversationsForPeriod,
  getPeakActivityData,
  getWhoAttendsData,
  isAiConversation,
  isQualifiedConversation,
} from '../utils/activityData';

const PERIOD_LABELS = {
  today: 'hoje',
  '7d': 'últimos 7 dias',
  '30d': 'últimos 30 dias',
};

export function PeakActivitySection({ conversations = [], ready = true, kanbanColumns = [] }) {
  const [period, setPeriod] = useState('7d');
  const activity = useMemo(() => getPeakActivityData(conversations, period), [conversations, period]);
  const totalConversations = useMemo(() => (Array.isArray(conversations) ? conversations : []), [conversations]);
  const circleRadius = 36;

  // Estatísticas calculadas com base no total de conversas da empresa
  const stats = useMemo(
    () => getWhoAttendsData(totalConversations, circleRadius),
    [totalConversations],
  );

  // Funil de etapas com base no volume total de conversas
  const funnel = useMemo(() => {
    const total = stats.total;
    const qualIA = totalConversations.filter(isAiConversation).length;
    const qualificados = totalConversations.filter(isQualifiedConversation).length;
    const agendados = totalConversations.filter((item) => /(agendad|cliente.fechado|finalizad)/i.test(`${item.stage || ''} ${item.salesStageKey || ''}`)).length;

    return [
      { id: 'novos', label: 'Novos contatos', count: total, color: '#38bdf8', widthPct: 100 },
      { id: 'qualificacao', label: 'Qualificação IA', count: qualIA, color: '#818cf8', widthPct: total > 0 ? (qualIA / total) * 100 : 0 },
      { id: 'qualificados', label: 'Qualificados', count: qualificados, color: '#a78bfa', widthPct: total > 0 ? (qualificados / total) * 100 : 0 },
      { id: 'agendados', label: 'Agendados', count: agendados, color: '#3b82f6', widthPct: total > 0 ? (agendados / total) * 100 : 0 },
    ];
  }, [stats.total, totalConversations]);

  // Donut chart calculations come from getWhoAttendsData (safe when total === 0)

  return (
    <div className="dashboard-right-stack" role="region" aria-label="Painel Operacional">
      {/* 1. CARD SUPERIOR: HORÁRIOS DE PICO */}
      <section className="dashboard-peak-card" aria-label="Horários de pico">
        <div className="peak-card-header">
          <div className="peak-header-titles">
            <h3 className="peak-title">Horários de pico</h3>
            <p className="peak-subtitle">Conversas iniciadas por hora · filtro: {PERIOD_LABELS[period]}</p>
          </div>

          <div className="peak-period-toggles" role="radiogroup" aria-label="Período do gráfico">
            <button
              type="button"
              role="radio"
              aria-checked={period === 'today'}
              className={`period-toggle-btn ${period === 'today' ? 'active' : ''}`}
              onClick={() => setPeriod('today')}
            >
              Hoje
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={period === '7d'}
              className={`period-toggle-btn ${period === '7d' ? 'active' : ''}`}
              onClick={() => setPeriod('7d')}
            >
              7 dias
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={period === '30d'}
              className={`period-toggle-btn ${period === '30d' ? 'active' : ''}`}
              onClick={() => setPeriod('30d')}
            >
              30 dias
            </button>
          </div>
        </div>

        {/* 3 Caixas de Destaque */}
        <div className="peak-boxes-row" aria-busy={!ready || undefined}>
          <div className="peak-summary-box">
            <div className="summary-box-header">
              <span className="summary-box-dot dot-primary" aria-hidden="true" />
              <span className="summary-box-label">Pico principal</span>
            </div>
            <div className="summary-box-body">
              {!ready ? (
                <>
                  <SkeletonLine width="64px" height="18px" />
                  <SkeletonLine width="82px" height="14px" />
                </>
              ) : (
                <>
                  <strong className="summary-box-hour">
                    {activity.primaryPeak.value > 0 ? `${activity.primaryPeak.hour}:00` : 'Sem pico'}
                  </strong>
                  {activity.primaryPeak.value > 0 ? (
                    <span className="summary-box-pill pill-primary">
                      {activity.primaryPeak.value} {activity.primaryPeak.value === 1 ? 'conversa' : 'conversas'}
                    </span>
                  ) : (
                    <span className="summary-box-pill pill-muted">0 conversas</span>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="peak-summary-box">
            <div className="summary-box-header">
              <span className="summary-box-dot dot-secondary" aria-hidden="true" />
              <span className="summary-box-label">Segundo pico</span>
            </div>
            <div className="summary-box-body">
              {!ready ? (
                <>
                  <SkeletonLine width="64px" height="18px" />
                  <SkeletonLine width="82px" height="14px" />
                </>
              ) : (
                <>
                  <strong className="summary-box-hour">
                    {activity.secondaryPeak && activity.secondaryPeak.value > 0 ? `${activity.secondaryPeak.hour}:00` : 'Sem pico'}
                  </strong>
                  {activity.secondaryPeak && activity.secondaryPeak.value > 0 ? (
                    <span className="summary-box-pill pill-secondary">
                      {activity.secondaryPeak.value} {activity.secondaryPeak.value === 1 ? 'conversa' : 'conversas'}
                    </span>
                  ) : (
                    <span className="summary-box-pill pill-muted">0 conversas</span>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="peak-summary-box">
            <div className="summary-box-header">
              <span className="summary-box-dot dot-average" aria-hidden="true" />
              <span className="summary-box-label">Média por hora</span>
            </div>
            <div className="summary-box-body">
              {!ready ? (
                <>
                  <SkeletonLine width="44px" height="18px" />
                  <SkeletonLine width="96px" height="14px" />
                </>
              ) : (
                <>
                  <strong className="summary-box-hour">
                    {Number(activity.averageHourly || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}
                  </strong>
                  <span className="summary-box-pill pill-average">
                    {activity.averageHourly === 1 ? 'conversa / hora' : 'conversas / hora'}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Gráfico de Barras por Hora */}
        <div className="peak-barchart-container" aria-busy={!ready || undefined}>
          {!ready ? (
            <div className="peak-barchart">
              {activity.points.map((item, idx) => (
                <div className="barchart-col" key={item.hour}>
                  <div className="barchart-bar-track">
                    <SkeletonBlock
                      width="100%"
                      height={`${22 + ((idx * 17) % 45)}%`}
                      style={{ borderRadius: '4px 4px 0 0', marginTop: 'auto' }}
                    />
                  </div>
                  <span className="barchart-label">{item.hour}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="peak-barchart">
              {activity.points.map((item) => {
                const isPeak = item.value > 0 && (item.hour === activity.primaryPeak.hour || item.hour === activity.secondaryPeak?.hour);
                return (
                  <div className="barchart-col" key={item.hour}>
                    <div className="barchart-bar-track">
                      {isPeak && (
                        <span className="barchart-floating-badge">
                          {item.value}
                        </span>
                      )}
                      <div
                        className={`barchart-bar ${isPeak ? 'bar-peak' : ''}`}
                        style={{ height: `${item.heightPct}%` }}
                      >
                        {item.value > 0 && <span className="bar-top-highlight" aria-hidden="true" />}
                        {isPeak && <span className="bar-peak-glow" aria-hidden="true" />}
                      </div>
                    </div>
                    <span className={`barchart-label ${isPeak ? 'label-peak' : ''}`}>
                      {item.hour}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* 2. LINHA INFERIOR: QUEM ATENDE + FUNIL POR ETAPA */}
      <div className="dashboard-bottom-dual-grid">
        {/* Card A: Quem atende (Donut Chart) */}
        <section className="dashboard-subcard card-who-attends" aria-label="Quem atende" aria-busy={!ready || undefined}>
          <div className="subcard-header">
            <h4 className="subcard-title">Quem atende</h4>
            <span className="subcard-subtitle">{ready ? `${stats.total} conversas` : 'Carregando…'}</span>
          </div>

          <div className="donut-content-row">
            <div className="donut-chart-wrap">
              <div className="donut-ambient-glow" aria-hidden="true" />
              <svg className="donut-svg" viewBox="0 0 100 100">
                <defs>
                  <linearGradient id="iaArcGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#818cf8" />
                    <stop offset="100%" stopColor="#6366f1" />
                  </linearGradient>
                  <linearGradient id="humanArcGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#22d3ee" />
                    <stop offset="100%" stopColor="#06b6d4" />
                  </linearGradient>
                </defs>
                <circle
                  cx="50"
                  cy="50"
                  r={circleRadius}
                  className="donut-bg-ring"
                />
                {ready && stats.total > 0 && (
                  <>
                    {/* Arc IA (azul/índigo) */}
                    {stats.iaStrokeDash > 0 && (
                      <circle
                        cx="50"
                        cy="50"
                        r={circleRadius}
                        className="donut-arc-ia"
                        stroke="url(#iaArcGradient)"
                        strokeDasharray={`${stats.iaStrokeDash} ${stats.circumference}`}
                        strokeDashoffset="0"
                      />
                    )}
                    {/* Arc Humano (cyan) */}
                    {stats.humanStrokeDash > 0 && (
                      <circle
                        cx="50"
                        cy="50"
                        r={circleRadius}
                        className="donut-arc-human"
                        stroke="url(#humanArcGradient)"
                        strokeDasharray={`${stats.humanStrokeDash} ${stats.circumference}`}
                        strokeDashoffset={`-${stats.iaStrokeDash}`}
                      />
                    )}
                  </>
                )}
              </svg>
              <div className="donut-center-info">
                <strong className="donut-center-pct">{ready ? `${stats.iaPct}%` : '—'}</strong>
                <span className="donut-center-sublabel">IA</span>
              </div>
            </div>

            <div className="donut-legend">
              {!ready ? (
                <>
                  <SkeletonLine width="70px" height="14px" />
                  <SkeletonLine width="82px" height="14px" />
                </>
              ) : (
                <>
                  <div className="donut-legend-item">
                    <span className="legend-square square-ia" aria-hidden="true" />
                    <span className="legend-text">IA <strong>{stats.iaCount}</strong></span>
                  </div>
                  <div className="donut-legend-item">
                    <span className="legend-square square-human" aria-hidden="true" />
                    <span className="legend-text">Humano <strong>{stats.humanCount}</strong></span>
                  </div>
                </>
              )}
            </div>
          </div>
        </section>

        {/* Card B: Funil por etapa (Barras Horizontais) */}
        <section className="dashboard-subcard card-funnel" aria-label="Funil por etapa" aria-busy={!ready || undefined}>
          <div className="subcard-header">
            <h4 className="subcard-title">Funil por etapa</h4>
          </div>

          <div className="funnel-rows-list">
            {!ready ? (
              [1, 2, 3, 4].map((i) => (
                <div className="funnel-row" key={i}>
                  <SkeletonLine width="92px" height="12px" />
                  <div className="funnel-bar-track">
                    <SkeletonLine width="100%" height="8px" style={{ display: 'block' }} />
                  </div>
                  <SkeletonLine width="24px" height="12px" />
                </div>
              ))
            ) : (
              funnel.map((step) => (
                <div className="funnel-row" key={step.id}>
                  <span className="funnel-label" title={step.label}>{step.label}</span>
                  <div className="funnel-bar-track">
                    <div
                      className={`funnel-bar-fill funnel-bar-${step.id}`}
                      style={{
                        width: `${step.widthPct}%`,
                      }}
                    >
                      <span className="funnel-shimmer-beam" aria-hidden="true" />
                    </div>
                  </div>
                  <span className="funnel-value">{step.count}</span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export default PeakActivitySection;

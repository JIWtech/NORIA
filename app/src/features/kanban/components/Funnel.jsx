import React from 'react';
import {
  GitBranch,
  CalendarCheck,
  CheckCircle2,
} from 'lucide-react';
import { PanelTitle } from '../../../components/ui/PanelTitle';
import { SkeletonLine } from '../../../components/ui/Skeletons';
import { formatCurrency } from '../../../dataService';

function Task({ title, meta }) {
  return (
    <div className="task">
      <CheckCircle2 size={18} />
      <div><strong>{title}</strong><span>{meta}</span></div>
    </div>
  );
}

export function Funnel({ funnelStages = [], tenantName, ready = true }) {
  const max = Math.max(...funnelStages.map((stage) => stage.count), 1);
  return (
    <section className="content-grid">
      <section className="panel" aria-busy={!ready || undefined}>
        <PanelTitle icon={GitBranch} title="Funil comercial" action={ready ? 'Mês atual' : 'Carregando…'} />
        <div className="funnel-list">
          {!ready ? (
            [1, 2, 3, 4, 5].map((i) => (
              <div className="funnel-row" key={i}>
                <div>
                  <SkeletonLine width="120px" height="14px" style={{ display: 'block' }} />
                  <SkeletonLine width="160px" height="12px" style={{ marginTop: '6px', display: 'block' }} />
                </div>
                <div className="funnel-track">
                  <SkeletonLine width="100%" height="8px" style={{ display: 'block' }} />
                </div>
                <SkeletonLine width="32px" height="12px" />
              </div>
            ))
          ) : (
            funnelStages.map((stage) => (
              <div className="funnel-row" key={stage.id}>
                <div>
                  <strong>{stage.name}</strong>
                  <span>{stage.count} oportunidades · {formatCurrency(stage.value)}</span>
                </div>
                <div className="funnel-track">
                  <div style={{ width: `${(stage.count / max) * 100}%` }} />
                </div>
                <em>{stage.conversion}%</em>
              </div>
            ))
          )}
        </div>
      </section>
      <section className="panel">
        <PanelTitle icon={CalendarCheck} title="Próximas ações" />
        <div className="task-list">
          <Task title="Testar conversa real no Telegram" meta={`${tenantName} · webhook multi-tenant`} />
          <Task title="Confirmar tenant no Supabase" meta="Banco de dados multi-tenant" />
          <Task title="Acompanhar mensagens reais" meta="Eventos de canais em tempo real" />
          <Task title="Monitorar IA paga" meta="Gemini com limite diário configurado" />
        </div>
      </section>
    </section>
  );
}

export { Task };

import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Building2,
  Clock3,
  MapPin,
  Radio,
  Trash2,
  UserCheck,
  UsersRound,
} from 'lucide-react';
import { SiInstagram, SiTelegram, SiWhatsapp } from 'react-icons/si';
import { PanelTitle } from '../../../components/ui/PanelTitle';
import { EmptyState } from '../../../components/ui/EmptyState';
import { SkeletonBlock, SkeletonLine } from '../../../components/ui/Skeletons';
import { getInitials } from '../../../components/ui/ContactAvatar';
import { NoriaSelect } from '../../../components/NoriaSelect';
import {
  parseBusinessHours,
  formatBusinessHoursSummary,
} from '../utils/businessHours';

export function SettingsPage({
  agents = [],
  agentsReady = true,
  onAddAgent,
  onToggleAgentStatus,
  onDeleteAgent,
  tenant,
  tenantName,
  tenantSettings,
  tenantSlug,
}) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [branch, setBranch] = useState('');
  const [shift, setShift] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Unidades reais de appointment_scheduling.units
  const rawUnits = tenantSettings?.settings?.appointment_scheduling?.units;
  const rawLocations = tenantSettings?.settings?.business_facts?.locations;

  const locationsList = useMemo(() => {
    if (Array.isArray(rawLocations)) return rawLocations;
    if (rawLocations && typeof rawLocations === 'object') {
      return Object.entries(rawLocations).map(([k, v]) => ({ id: v?.id || k, ...v }));
    }
    return [];
  }, [rawLocations]);

  const unitsList = useMemo(() => {
    if (!rawUnits) return [];
    let list = [];
    if (Array.isArray(rawUnits)) {
      list = rawUnits.map((u) => ({ id: u.id || u.slug || u.name, name: u.name || u.label || u.id, ...u }));
    } else if (typeof rawUnits === 'object') {
      list = Object.entries(rawUnits).map(([key, val]) => ({
        id: val?.id || val?.slug || key,
        name: val?.name || val?.label || key,
        ...val,
      }));
    }

    return list.map((unit) => {
      const matchedLoc = locationsList.find((loc) =>
        String(loc?.id || '').toLowerCase() === String(unit?.id || '').toLowerCase()
      );
      const address = matchedLoc?.address || unit?.address || null;
      const displayName = matchedLoc?.name || unit?.name || unit?.id;
      return {
        ...unit,
        displayName,
        address,
      };
    });
  }, [rawUnits, locationsList]);

  // KPIs dinâmicos derivados do tenant atual
  const activeCount = agents.filter((ag) => {
    const isOnline = (String(ag.status || '').toLowerCase() === 'online' || String(ag.status || '').toLowerCase() === 'ativo') && ag.is_active !== false;
    return isOnline;
  }).length;
  const pausedCount = Math.max(0, agents.length - activeCount);

  // Canais habilitados: SOMENTE os configurados em enabled_channels (sem fallback)
  const rawEnabledChannels = tenantSettings?.settings?.enabled_channels;
  const hasChannelsConfigured = Array.isArray(rawEnabledChannels);
  const enabledChannelsList = hasChannelsConfigured ? rawEnabledChannels : [];

  // Horários de atendimento condicional (se não existir/estiver vazio, card é omitido)
  const rawBusinessHours = tenantSettings?.business_hours || tenantSettings?.businessHours;
  const businessHoursSummary = formatBusinessHoursSummary(rawBusinessHours);
  const businessHoursData = parseBusinessHours(rawBusinessHours);

  // Popovers para +N outras unidades e +N outros canais
  const [showUnitsPopover, setShowUnitsPopover] = useState(false);
  const unitsPopoverRef = useRef(null);

  const [showChannelsPopover, setShowChannelsPopover] = useState(false);
  const channelsPopoverRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (unitsPopoverRef.current && !unitsPopoverRef.current.contains(e.target)) {
        setShowUnitsPopover(false);
      }
      if (channelsPopoverRef.current && !channelsPopoverRef.current.contains(e.target)) {
        setShowChannelsPopover(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const maxVisibleChannels = 3;
  const visibleChannels = enabledChannelsList.slice(0, maxVisibleChannels);
  const otherChannels = enabledChannelsList.slice(maxVisibleChannels);

  function getChannelIcon(channel) {
    const c = String(channel || '').toLowerCase();
    if (c === 'whatsapp') return <SiWhatsapp size={14} />;
    if (c === 'telegram') return <SiTelegram size={14} />;
    if (c === 'instagram') return <SiInstagram size={14} />;
    return <Radio size={14} />;
  }

  function getChannelLabel(channel) {
    const c = String(channel || '').toLowerCase();
    if (c === 'whatsapp') return 'WhatsApp';
    if (c === 'telegram') return 'Telegram';
    if (c === 'instagram') return 'Instagram';
    return channel;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || submitting) return;
    setSubmitting(true);
    try {
      await onAddAgent?.({
        id: `ag-${Date.now()}`,
        name: trimmedName,
        role: role.trim() || null,
        branch: branch.trim() || null, // branch enviado explicitamente como null quando vazio
        shift: shift.trim() || null,   // shift como texto livre, null se vazio
        status: 'online',
        is_active: true,
      });
      setName('');
      setRole('');
      setBranch('');
      setShift('');
    } finally {
      setSubmitting(false);
    }
  }

  const unitOptions = useMemo(() => [
    { value: '__none__', label: 'Sem unidade vinculada' },
    ...unitsList.map((u) => ({ value: u.displayName || u.name, label: u.displayName || u.name })),
  ], [unitsList]);

  return (
    <section className="settings-page">
      {/* 1. KPIs Dinâmicos de Resumo */}
      <div className="settings-kpi-grid">
        {/* KPI 1: Atendentes Cadastrados */}
        <div className="settings-kpi-card kpi-team">
          <div className="settings-kpi-header">
            <div className="settings-kpi-icon-wrap team-icon">
              <UsersRound size={15} />
            </div>
            <span className="settings-kpi-title">Atendentes Cadastrados</span>
          </div>

          <div className="settings-kpi-metric-row">
            <span className="settings-kpi-number">{agents.length}</span>
          </div>

          <div className="settings-kpi-divider" />

          <div className="settings-kpi-footer">
            <div className="settings-kpi-pill-group">
              <span className="settings-kpi-pill active">
                <span className="settings-kpi-dot active" />
                {activeCount} {activeCount === 1 ? 'ativo' : 'ativos'}
              </span>
              <span className="settings-kpi-pill paused">
                <span className="settings-kpi-dot paused" />
                {pausedCount} {pausedCount === 1 ? 'pausado' : 'pausados'}
              </span>
            </div>
          </div>
        </div>

        {/* KPI 2: Unidades Operacionais */}
        <div className="settings-kpi-card kpi-units">
          <div className="settings-kpi-header">
            <div className="settings-kpi-icon-wrap unit-icon">
              <Building2 size={15} />
            </div>
            <span className="settings-kpi-title">Unidades Operacionais</span>
          </div>

          <div className="settings-kpi-metric-row">
            <span className="settings-kpi-number">{unitsList.length}</span>
          </div>

          <div className="settings-kpi-divider" />

          <div className="settings-kpi-footer">
            {unitsList.length === 0 ? (
              <span className="settings-kpi-address-text empty">
                Nenhuma unidade cadastrada ainda
              </span>
            ) : (
              <div className="settings-kpi-unit-summary">
                <span className="settings-kpi-unit-name" title={unitsList[0].displayName}>
                  {unitsList[0].displayName}
                </span>
                <div className="settings-kpi-unit-address-row">
                  <MapPin size={10} className="settings-kpi-pin-icon" />
                  <span
                    className={`settings-kpi-address-text ${!unitsList[0].address ? 'empty' : ''}`}
                    title={unitsList[0].address || 'Sem endereço cadastrado ainda'}
                  >
                    {unitsList[0].address ? unitsList[0].address : 'Sem endereço cadastrado ainda'}
                  </span>
                </div>
                {unitsList.length > 1 && (
                  <div className="settings-kpi-more-wrap" ref={unitsPopoverRef}>
                    <button
                      type="button"
                      className="settings-kpi-more-btn"
                      onClick={() => setShowUnitsPopover((v) => !v)}
                      onMouseEnter={() => setShowUnitsPopover(true)}
                      onMouseLeave={() => setShowUnitsPopover(false)}
                      aria-haspopup="true"
                      aria-expanded={showUnitsPopover}
                    >
                      +{unitsList.length - 1} {unitsList.length - 1 === 1 ? 'outra unidade' : 'outras unidades'}
                    </button>
                    {showUnitsPopover && (
                      <div
                        className="settings-kpi-popover units-popover"
                        onMouseEnter={() => setShowUnitsPopover(true)}
                        onMouseLeave={() => setShowUnitsPopover(false)}
                      >
                        <div className="settings-kpi-popover-title">
                          Demais Unidades ({unitsList.length - 1})
                        </div>
                        <div className="settings-kpi-popover-list">
                          {unitsList.slice(1).map((u) => (
                            <div key={u.id} className="settings-kpi-popover-item">
                              <strong className="settings-kpi-popover-item-name">{u.displayName}</strong>
                              <span className="settings-kpi-popover-item-addr">
                                <MapPin size={10} className="settings-kpi-pin-icon" />
                                {u.address || 'Sem endereço cadastrado ainda'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* KPI 3: Canais Habilitados */}
        <div className="settings-kpi-card kpi-channels">
          <div className="settings-kpi-header">
            <div className="settings-kpi-icon-wrap channel-icon">
              <Radio size={15} />
            </div>
            <span className="settings-kpi-title">Canais Habilitados</span>
          </div>

          <div className="settings-kpi-metric-row">
            <span className="settings-kpi-number">{enabledChannelsList.length}</span>
          </div>

          <div className="settings-kpi-divider" />

          <div className="settings-kpi-footer">
            <div className="settings-kpi-channels-row">
              {visibleChannels.map((ch) => (
                <span
                  key={ch}
                  className={`settings-channel-icon-badge channel-${ch}`}
                  title={getChannelLabel(ch)}
                  aria-label={getChannelLabel(ch)}
                  role="img"
                >
                  {getChannelIcon(ch)}
                </span>
              ))}
              {otherChannels.length > 0 && (
                <div className="settings-kpi-more-wrap" ref={channelsPopoverRef}>
                  <button
                    type="button"
                    className="settings-kpi-more-btn channel-more-btn"
                    onClick={() => setShowChannelsPopover((v) => !v)}
                    onMouseEnter={() => setShowChannelsPopover(true)}
                    onMouseLeave={() => setShowChannelsPopover(false)}
                    aria-label={`Ver mais ${otherChannels.length} canais`}
                  >
                    +{otherChannels.length}
                  </button>
                  {showChannelsPopover && (
                    <div
                      className="settings-kpi-popover channels-popover"
                      onMouseEnter={() => setShowChannelsPopover(true)}
                      onMouseLeave={() => setShowChannelsPopover(false)}
                    >
                      <div className="settings-kpi-popover-title">
                        Outros Canais ({otherChannels.length})
                      </div>
                      <div className="settings-kpi-popover-channels">
                        {otherChannels.map((ch) => (
                          <div key={ch} className="settings-kpi-popover-channel-row">
                            <span className={`settings-channel-icon-badge channel-${ch}`}>
                              {getChannelIcon(ch)}
                            </span>
                            <span className="settings-kpi-popover-channel-name">{getChannelLabel(ch)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {enabledChannelsList.length === 0 && (
                <span className="settings-kpi-empty-text">Nenhum canal habilitado</span>
              )}
            </div>
          </div>
        </div>

        {/* KPI 4: Horário de Atendimento */}
        <div className="settings-kpi-card kpi-hours">
          <div className="settings-kpi-header">
            <div className="settings-kpi-icon-wrap hours-icon">
              <Clock3 size={15} />
            </div>
            <span className="settings-kpi-title">Horário de Atendimento</span>
          </div>

          <div className="settings-kpi-divider" />

          <div className="settings-kpi-footer">
            <div className="settings-kpi-hours-center-block">
              {businessHoursData?.days && (
                <span className="settings-kpi-hours-days">{businessHoursData.days}</span>
              )}
              <span className="settings-kpi-hours-time" title={businessHoursSummary || ''}>
                {businessHoursData?.time || 'Sem horário configurado'}
              </span>
            </div>
            {businessHoursData?.extra ? (
              <span className="settings-kpi-hours-extra">{businessHoursData.extra}</span>
            ) : (
              <div className="settings-kpi-hours-spacer" aria-hidden="true" />
            )}
          </div>
        </div>
      </div>

      {/* 2. Grid Principal: 40% Formulário / 60% Lista de Atendentes */}
      <div className="settings-main-grid">
        {/* Formulário (40%) */}
        <section className="panel settings-form-panel">
          <PanelTitle className="settings-panel-title" icon={UserCheck} title="Cadastrar Atendente" />
          <p className="settings-panel-desc">
            Cadastre os atendentes humanos do estabelecimento para receberem atendimentos transferidos no chat.
          </p>

          <form className="settings-agent-form" onSubmit={handleSubmit}>
            <div className="settings-form-row">
              <label className="settings-field-label">
                Nome Completo do Atendente *
                <input
                  className="settings-input"
                  placeholder="Ex: Camila Recepção, Dra. Mariana..."
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </label>

              <label className="settings-field-label">
                Cargo / Função
                <input
                  className="settings-input"
                  placeholder="Ex: Atendimento, Recepcionista, Dentista..."
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                />
              </label>
            </div>

            <div className="settings-form-row">
              <label className="settings-field-label">
                Unidade / Filial
                {unitsList.length > 0 ? (
                  <NoriaSelect
                    value={branch || '__none__'}
                    onValueChange={(value) => setBranch(value === '__none__' ? '' : value)}
                    options={unitOptions}
                    placeholder="Selecione a unidade"
                    ariaLabel="Unidade ou filial"
                  />
                ) : (
                  <input
                    className="settings-input"
                    placeholder="Ex: Filial Centro (opcional)"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                  />
                )}
              </label>

              <label className="settings-field-label">
                Turno / Horário de Trabalho
                <input
                  className="settings-input"
                  placeholder="Ex: 08:00 às 18:00, Manhã, Plantão..."
                  value={shift}
                  onChange={(e) => setShift(e.target.value)}
                />
              </label>
            </div>

            <button
              className="primary-button settings-submit-btn"
              type="submit"
              disabled={!name.trim() || submitting}
            >
              <UserCheck size={16} />
              <span>{submitting ? 'Salvando...' : 'Salvar Atendente'}</span>
            </button>
          </form>
        </section>

        {/* Lista de Equipe (60%) */}
        <section className="panel settings-team-panel">
          <PanelTitle className="settings-panel-title" icon={UsersRound} title="Equipe de Atendimento" />
          <p className="settings-panel-desc">
            Atendentes disponíveis para transferência manual na aba de conversas.
          </p>

          <div className="settings-team-list">
            {!agentsReady ? (
              [1, 2, 3].map((i) => (
                <article className="settings-agent-card agent-card-skeleton" key={i}>
                  <div className="settings-agent-avatar-col">
                    <div className="skeleton-block" style={{ width: '38px', height: '38px', borderRadius: '8px' }} />
                  </div>
                  <div className="settings-agent-info">
                    <div className="settings-agent-top-row">
                      <SkeletonLine width="120px" height="16px" />
                      <SkeletonBlock width="60px" height="20px" style={{ borderRadius: '999px' }} />
                    </div>
                    <SkeletonLine width="90px" height="14px" style={{ marginTop: '6px' }} />
                  </div>
                  <div className="settings-agent-actions">
                    <SkeletonBlock width="70px" height="32px" style={{ borderRadius: '6px' }} />
                    <SkeletonBlock width="32px" height="32px" style={{ borderRadius: '6px' }} />
                  </div>
                </article>
              ))
            ) : (
              <>
                {agents.map((agent) => {
                  const isOnline = (String(agent.status || '').toLowerCase() === 'online' || String(agent.status || '').toLowerCase() === 'ativo') && agent.is_active !== false;
                  const statusLabel = isOnline ? 'Ativo' : 'Pausado';
                  const initials = getInitials(agent.name);

                  return (
                    <article className="settings-agent-card" key={agent.id}>
                      <div className="settings-agent-avatar-col">
                        <div className={`settings-agent-avatar ${isOnline ? 'online' : 'standby'}`}>
                          <span>{initials}</span>
                        </div>
                      </div>

                      <div className="settings-agent-info">
                        <div className="settings-agent-top-row">
                          <div className="settings-agent-identity">
                            <strong className="settings-agent-name">{agent.name}</strong>
                            {agent.role && (
                              <span className="settings-agent-role-badge">{agent.role}</span>
                            )}
                          </div>
                        </div>

                        {(agent.branch || agent.shift) && (
                          <div className="settings-agent-meta-chips">
                            {agent.branch && (
                              <span className="settings-meta-chip">
                                <Building2 size={12} />
                                <span>{agent.branch}</span>
                              </span>
                            )}
                            {agent.shift && (
                              <span className="settings-meta-chip">
                                <Clock3 size={12} />
                                <span>{agent.shift}</span>
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="settings-agent-actions">
                        <span className={`status-dot-badge ${isOnline ? 'online' : 'standby'}`}>
                          <span className="pulse-dot" />
                          {statusLabel}
                        </span>
                        <button
                          className="secondary-button compact-btn settings-agent-toggle-btn"
                          type="button"
                          title="Alternar status do atendente"
                          onClick={() => onToggleAgentStatus?.(agent.id)}
                        >
                          {isOnline ? 'Pausar' : 'Retomar'}
                        </button>
                        <button
                          className="icon-button compact-btn text-danger settings-agent-delete-btn"
                          type="button"
                          title="Excluir atendente"
                          aria-label={`Excluir atendente ${agent.name}`}
                          onClick={() => onDeleteAgent?.(agent.id)}
                        >
                          <Trash2 size={14} />
                          <span className="btn-text-mobile">Excluir</span>
                        </button>
                      </div>
                    </article>
                  );
                })}

                {!agents.length && (
                  <EmptyState
                    title="Nenhum atendente cadastrado"
                    text="Cadastre os atendentes e operadores da equipe no formulário ao lado para poder transferir atendimentos a eles."
                    compact
                  />
                )}
              </>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

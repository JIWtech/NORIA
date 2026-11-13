import { userFacingError } from '../../../utils/userFacingError.js';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Archive,
  Ban,
  Building2,
  CalendarCheck,
  CalendarDays,
  CircleDollarSign,
  Clock3,
  MapPin,
  MessageCircle,
  Pencil,
  Search,
  UserRound,
} from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { PanelTitle } from '../../../components/ui/PanelTitle';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ChannelIcon, getChannelClass } from '../../../components/ui/ChannelIcon';
import { SkeletonBlock, SkeletonLine } from '../../../components/ui/Skeletons';
import { NoriaSelect } from '../../../components/NoriaSelect';
import {
  loadAppointmentAvailability,
  loadAppointmentScheduling,
  saveAppointment,
} from '../../../dataService';
import { isDepositRequired } from '../../../services/appointments/appointmentOutcome.js';
import { archiveAppointment, markAppointmentOutcome } from '../../../services/appointments/outcomeActions.js';
import { appointmentAgendaItem, appointmentSections } from '../../../services/appointments/appointmentAgenda.js';
import { useAppointmentClock } from '../utils/useAppointmentClock.js';
import { appointmentActionsFor, localInputToIso } from '../../../services/appointments/appointmentActions.js';
import { noShowMessageConfig } from '../../../services/appointments/noShowMessage.js';
import { useDepositRequired } from '../utils/useDepositRequired';
import { AppointmentOutcomeActions } from './AppointmentOutcomeActions.jsx';
import { AppointmentEditDialog } from './AppointmentEditDialog.jsx';
import { AppointmentCancelDialog } from './AppointmentCancelDialog.jsx';
import { noticeState } from './cancellationFlow.js';
import { AppointmentConfirmDialog } from './AppointmentConfirmDialog.jsx';
import { NoShowMessageDialog } from './NoShowMessageDialog.jsx';

export function Appointments({ appointments = [], conversations = [], tenantSlug, onChanged, initialData, ready = true, outcomeTracking = false, tenantSettings = null }) {
  const [outcomeBusyId, setOutcomeBusyId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [editing, setEditing] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [noShowTarget, setNoShowTarget] = useState(null);
  const timeZone = tenantSettings?.timezone || undefined;
  const depositIndex = useDepositRequired(outcomeTracking ? tenantSlug : '', appointments);
  const [schedule, setSchedule] = useState(null);
  const [unitId, setUnitId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [localDate, setLocalDate] = useState('');
  const [localTime, setLocalTime] = useState('');
  const [availableTimes, setAvailableTimes] = useState([]);
  const [checking, setChecking] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const [title, setTitle] = useState('');
  const [contactName, setContactName] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedConversationId, setSelectedConversationId] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    let active = true;
    setCancelling(null);
    setConfirmation(null);
    setSchedule(null); setUnitId(''); setServiceId(''); setLocalDate(''); setLocalTime('');
    requestId.current = crypto.randomUUID();
    loadAppointmentScheduling(tenantSlug).then(value => { if (active) setSchedule(value); })
      .catch(() => { if (active) setStatus('Nao foi possivel carregar a agenda. Atualize a pagina antes de reservar.'); });
    return () => { active = false; };
  }, [tenantSlug]);

  useEffect(() => {
    let active = true;
    setAvailableTimes([]); setLocalTime('');
    if (!schedule?.enabled || !unitId || !serviceId || !localDate) { setChecking(false); return; }
    setChecking(true);
    loadAppointmentAvailability(schedule.tenantId, unitId, serviceId, localDate)
      .then(times => { if (active) { setAvailableTimes(times); setStatus(times.length ? '' : 'Nenhum horario disponivel nesta data.'); } })
      .catch(() => { if (active) setStatus('Nao foi possivel consultar a disponibilidade. Nenhuma reserva foi criada.'); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [schedule, unitId, serviceId, localDate]);

  useEffect(() => {
    if (!initialData) return;
    if (initialData.contactName) setContactName(initialData.contactName);
    if (initialData.title) setTitle(initialData.title);
    if (initialData.notes) setNotes(initialData.notes);
    if (initialData.selectedConversationId) setSelectedConversationId(initialData.selectedConversationId);
  }, [initialData]);

  // Seções da agenda dentro do tenant ativo (as linhas já chegam filtradas por tenant_id).
  const appointmentNow = useAppointmentClock();
  const sections = useMemo(
    () => appointmentSections(appointments, { now: appointmentNow, timeZone, query: searchQuery }),
    [appointments, timeZone, searchQuery, appointmentNow],
  );
  const visibleCount = sections.reduce((total, section) => total + section.items.length, 0);

  async function finishDialog(message) {
    setEditing(null);
    setCancelling(null);
    setNoShowTarget(null);
    setStatus(message);
    await onChanged?.();
  }

  async function runAction(appointment, action, confirmed = false) {
    if (outcomeBusyId) return;
    const prompts = {
      archive: 'Arquivar este agendamento como concluído?',
    };
    if (!confirmed) {
      setConfirmation({ title: 'Arquivar agendamento', message: prompts[action], confirmLabel: 'Arquivar', onConfirm: () => runAction(appointment, action, true) });
      return;
    }
    setOutcomeBusyId(appointment.id);
    setStatus('');
    try {
      await archiveAppointment(appointment.id);
      setStatus('Agendamento arquivado como concluído.');
      await onChanged?.();
    } catch (error) {
      setStatus(error.message || 'Não foi possível atualizar o agendamento.');
    } finally {
      setOutcomeBusyId('');
    }
  }

  async function handleOutcome(appointment, outcome, confirmed = false) {
    if (outcomeBusyId) return;
    if (!confirmed && tenantSlug !== 'ic_salon' && outcome === 'no_show' && noShowMessageConfig(tenantSettings, appointment).enabled) {
      setNoShowTarget(appointment);
      return;
    }
    const message = outcome === 'no_show'
      ? 'Registrar a falta neste agendamento?'
      : 'Registrar presença neste agendamento?';
    if (!confirmed) {
      setConfirmation({ title: outcome === 'no_show' ? 'Registrar falta' : 'Registrar comparecimento', message, confirmLabel: 'Registrar', onConfirm: () => handleOutcome(appointment, outcome, true) });
      return;
    }
    setOutcomeBusyId(appointment.id);
    setStatus('');
    try {
      const result = await markAppointmentOutcome(appointment.id, outcome);
      setStatus(outcome === 'no_show'
        ? (result?.closed_conversation ? 'Falta registrada e conversa encerrada.' : 'Falta registrada.')
        : 'Comparecimento registrado.');
      await onChanged?.();
    } catch (error) {
      setStatus(error.message || 'Não foi possível registrar o desfecho.');
    } finally {
      setOutcomeBusyId('');
    }
  }

  function pickConversation(value) {
    setSelectedConversationId(value);
    const conversation = conversations.find((item) => item.externalConversationId === value);
    if (conversation) {
      setContactName(conversation.contact || '');
      if (!title) setTitle(`Atendimento - ${conversation.contact}`);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!schedule || (schedule.enabled ? !unitId || !serviceId || !localDate || !localTime || !contactName.trim() : !title.trim() || !startsAt)) return;
    setSaving(true);
    setStatus('');
    try {
      await saveAppointment(tenantSlug, {
        title: title.trim(),
        contactName: contactName.trim(),
        startsAt: schedule.enabled ? null : localInputToIso(startsAt, timeZone),
        unitId, serviceId, localDate, localTime, timeZone, requestId: requestId.current,
        endsAt: endsAt ? localInputToIso(endsAt, timeZone) : null,
        notes: notes.trim(),
        channelType: conversations.find(c => c.externalConversationId === selectedConversationId)?.channelType || 'manual',
        externalConversationId: selectedConversationId,
      });
      setTitle('');
      setContactName('');
      setStartsAt('');
      setEndsAt('');
      setNotes('');
      setSelectedConversationId('');
      setLocalTime(''); setLocalDate(''); requestId.current = crypto.randomUUID();
      setStatus('Agendamento criado e enviado para o Kanban.');
      await onChanged?.();
    } catch (error) {
      setStatus(userFacingError(error, 'Não foi possível salvar o agendamento.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="appointments-page">
      <section className="panel appointment-form-panel">
        <PanelTitle className="appointment-panel-title" icon={CalendarDays} title="Novo agendamento" />
        <form className="form-grid" onSubmit={handleSubmit}>
          {schedule?.enabled ? <div className="form-row-two">
            <label className="appointment-field-label"><span className="appointment-label-text">Unidade</span><NoriaSelect value={unitId} onValueChange={setUnitId} options={Object.entries(schedule.units).map(([id, unit]) => ({ value: id, label: unit.name }))} placeholder="Selecione" icon={Building2} className="appointment-select" /></label>
            <label className="appointment-field-label"><span className="appointment-label-text">Serviço</span><NoriaSelect value={serviceId} onValueChange={setServiceId} options={schedule.services.map(service => ({ value: service.external_id, label: service.name, category: service.category || 'Geral' }))} placeholder="Selecione" icon={CalendarCheck} className="appointment-select" contentClassName="appointment-service-select-content" /></label>
          </div> : <label className="appointment-field-label"><span className="appointment-label-text">Título</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex: Sessao de bronzeamento" required /></label>}
          <div className="form-row-two">
            <label className="appointment-field-label"><span className="appointment-label-text">Contato</span><input value={contactName} onChange={(event) => setContactName(event.target.value)} placeholder="Nome da cliente" required={schedule?.enabled} /></label>
            <label className="appointment-field-label"><span className="appointment-label-text">Conversa recente</span><NoriaSelect value={selectedConversationId} onValueChange={(value) => pickConversation(value === '__none__' ? '' : value)} options={[{ value: '__none__', label: 'Sem vínculo' }, ...conversations.map((conversation) => {
              const channelType = conversation.channelType || conversation.channel || 'whatsapp';
              const channelLabel = conversation.channel || (channelType === 'whatsapp' ? 'WhatsApp' : channelType);
              return {
                value: conversation.externalConversationId,
                label: conversation.contact,
                icon: (
                  <span
                    className={`noria-select-channel-icon ${getChannelClass(channelType)}`}
                    title={channelLabel}
                    aria-label={channelLabel}
                  >
                    <ChannelIcon channel={channelType} size={14} />
                  </span>
                ),
              };
            })]} placeholder="Sem vínculo" icon={MessageCircle} className="appointment-select" contentClassName="appointment-conversation-select-content" /></label>
          </div>
          {schedule?.enabled ? <div className="form-row-two">
            <label className="appointment-field-label"><span className="appointment-label-text">Data</span><input type="date" required value={localDate} onChange={event => setLocalDate(event.target.value)} /></label>
            <label className="appointment-field-label"><span className="appointment-label-text">Horário</span><NoriaSelect value={localTime} onValueChange={setLocalTime} options={availableTimes.map(time => ({ value: time, label: time }))} placeholder={checking ? 'Consultando...' : (availableTimes.length ? 'Selecione' : 'Sem horários')} ariaLabel="Horário" icon={Clock3} disabled={checking || !availableTimes.length} className="appointment-select" /></label>
          </div> : <div className="form-row-two">
            <label className="appointment-field-label"><span className="appointment-label-text">Início</span><input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required /></label>
            <label className="appointment-field-label"><span className="appointment-label-text">Fim</span><input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label>
          </div>}
          <label className="textarea-label appointment-field-label"><span className="appointment-label-text">Observações</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Detalhes internos do atendimento." /></label>
          <div className="header-actions appointment-save-row">
            <button className="primary-button" type="submit" disabled={saving || !schedule || checking || (schedule.enabled ? !localTime || !contactName.trim() : !title.trim() || !startsAt)}><CalendarCheck size={16} /> Salvar agendamento</button>
            <small>{status}</small>
          </div>
        </form>
      </section>

      <section className="panel appointment-list-panel">
        <PanelTitle className="appointment-panel-title" icon={Clock3} title="Agenda" action={ready ? `${appointments.length} ${appointments.length === 1 ? 'agendamento' : 'agendamentos'}` : '— agendamentos'} />
        <label className="appointment-search">
          <Search size={15} aria-hidden="true" />
          <input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Buscar por nome" aria-label="Buscar agendamento por nome" />
        </label>
        {status && <small className="appointment-list-status" role="status">{status}</small>}
        <div className="appointment-groups">
          {!ready ? (
            <div className="appointment-day appointment-day-skeleton">
              <SkeletonLine width="110px" height="14px" style={{ marginBottom: '12px', display: 'block' }} />
              {[1, 2, 3].map((i) => (
                <article className="appointment-card appointment-card-skeleton" key={i}>
                  <div className="appointment-time">
                    <SkeletonLine width="38px" height="14px" />
                    <SkeletonLine width="38px" height="11px" style={{ marginTop: '4px' }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <SkeletonLine width="130px" height="14px" style={{ display: 'block' }} />
                    <SkeletonLine width="90px" height="12px" style={{ marginTop: '5px', display: 'block' }} />
                  </div>
                  <SkeletonBlock width="70px" height="18px" style={{ borderRadius: '4px' }} />
                </article>
              ))}
            </div>
          ) : (
            <>
              {sections.map((section) => section.items.length > 0 && (
                <details className="appointment-day appointment-section" key={section.key} data-section={section.key} open={!section.collapsed || Boolean(searchQuery.trim())}>
                  <summary className="appointment-section-summary">
                    <h3>{section.title}</h3>
                    <span className="appointment-section-count">{section.items.length}</span>
                  </summary>
                  {section.items.map((appointment) => {
                    const item = appointmentAgendaItem(appointment, { timeZone });
                    const actions = appointmentActionsFor(appointment, { outcomeTracking, now: appointmentNow });
                    const outcomes = actions.filter((action) => action === 'attended' || action === 'no_show');
                    const busy = outcomeBusyId === appointment.id;
                    const depositRequired = outcomeTracking && isDepositRequired(depositIndex, appointment.channelType,
                      appointment.externalConversationId, tenantSlug === 'ic_salon' ? appointment.contactName : '');
                    return (
                      <article className="appointment-card appointment-agenda-card" key={appointment.id} data-status={appointment.status}>
                        <div className="appointment-card-content">
                          <div className="appointment-card-heading">
                            <div className="appointment-card-title-row">
                              <div className="appointment-time"><strong>{item.time || '--:--'}</strong><span>{appointment.endTimeLabel || ''}</span></div>
                              <div className="appointment-agenda-main">
                                <strong>{item.client}</strong>
                                {item.services && <span>{item.services}</span>}
                              </div>
                            </div>
                            <Badge value={item.statusLabel} status="channel" />
                          </div>
                          <div className="appointment-agenda-meta">
                            <span><CalendarDays size={13} aria-hidden="true" />{item.weekday ? `${item.weekday}, ` : ''}{item.date}{item.time ? ` às ${item.time}` : ''}</span>
                            {item.professional && <span><UserRound size={13} aria-hidden="true" />{item.professional}</span>}
                            {item.firstVisit && <span>Primeira visita: {item.firstVisit}</span>}
                            <span
                              className={`appointment-channel-meta ${getChannelClass(appointment.channelType)}`}
                              title={appointment.channelLabel || 'WhatsApp'}
                              aria-label={appointment.channelLabel || 'WhatsApp'}
                            >
                              <ChannelIcon channel={appointment.channelType} size={14} />
                            </span>
                          </div>
                          {appointment.unitName && (
                            <span className="appointment-location-meta"><MapPin size={14} />{appointment.unitName}</span>
                          )}
                          {appointment.notes && <p className="appointment-card-notes">{appointment.notes}</p>}
                          {depositRequired && (
                            <span className="deposit-required-badge" title="O último desfecho registrado foi uma falta.">
                              <CircleDollarSign size={12} /> Sinal obrigatório
                            </span>
                          )}
                          {actions.length > 0 && (
                            <div className="appointment-agenda-actions" aria-busy={busy || undefined}>
                              {actions.includes('edit') && (
                                <button type="button" className="secondary-button appointment-action-button" disabled={Boolean(outcomeBusyId)} onClick={() => setEditing(appointment)}>
                                  <Pencil size={13} aria-hidden="true" /> Editar
                                </button>
                              )}
                              {actions.includes('cancel') && (
                                <button type="button" className="secondary-button appointment-action-button" disabled={Boolean(outcomeBusyId)} onClick={() => setCancelling(appointment)}>
                                  <Ban size={13} aria-hidden="true" /> Cancelar
                                </button>
                              )}
                              {actions.includes('archive') && (
                                <button type="button" className="secondary-button appointment-action-button" disabled={Boolean(outcomeBusyId)} onClick={() => runAction(appointment, 'archive')}>
                                  <Archive size={13} aria-hidden="true" /> Arquivar
                                </button>
                              )}
                              <AppointmentOutcomeActions
                                outcomes={outcomes}
                                disabled={Boolean(outcomeBusyId)}
                                busy={busy}
                                onOutcome={(outcome) => handleOutcome(appointment, outcome)}
                              />
                            </div>
                          )}
                          {appointment.status === 'cancelled' && noticeState(appointment.raw?.metadata).canReconcile && (
                            <div className="appointment-agenda-actions">
                              <button type="button" className="secondary-button appointment-action-button" disabled={Boolean(outcomeBusyId)} onClick={() => setCancelling(appointment)}>
                                <Ban size={13} aria-hidden="true" /> Conferir aviso de cancelamento
                              </button>
                            </div>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </details>
              ))}
              {appointments.length > 0 && !visibleCount && <EmptyState title="Nenhum agendamento encontrado" text="Nenhum agendamento com esse nome." compact />}
              {!appointments.length && <EmptyState title="Nenhum agendamento" text="Crie um agendamento para acompanhar seus próximos atendimentos." compact />}
            </>
          )}
        </div>
      </section>
      {editing && (
        <AppointmentEditDialog appointment={editing} timeZone={timeZone} onClose={() => setEditing(null)} onDone={finishDialog} />
      )}
      {confirmation && (
        <AppointmentConfirmDialog {...confirmation} onClose={() => setConfirmation(null)} onConfirm={() => { const confirm = confirmation.onConfirm; setConfirmation(null); confirm(); }} />
      )}
      {cancelling && (
        <AppointmentCancelDialog appointment={cancelling} tenantSlug={tenantSlug} onClose={() => setCancelling(null)} onDone={finishDialog} />
      )}
      {noShowTarget && (
        <NoShowMessageDialog
          appointment={noShowTarget}
          tenantSlug={tenantSlug}
          tenantSettings={tenantSettings}
          onClose={() => setNoShowTarget(null)}
          onDone={finishDialog}
        />
      )}
    </section>
  );
}

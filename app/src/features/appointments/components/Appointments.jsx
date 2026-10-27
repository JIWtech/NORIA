import { userFacingError } from '../../../utils/userFacingError.js';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Building2,
  CalendarCheck,
  CalendarDays,
  Clock3,
  MapPin,
  MessageCircle,
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
import { groupAppointmentsByDay } from '../utils/appointmentHelpers';

export function Appointments({ appointments = [], conversations = [], tenantSlug, onChanged, initialData, ready = true }) {
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

  const grouped = useMemo(() => groupAppointmentsByDay(appointments), [appointments]);

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
        startsAt: schedule.enabled ? null : new Date(startsAt).toISOString(),
        unitId, serviceId, localDate, localTime, requestId: requestId.current,
        endsAt: endsAt ? new Date(endsAt).toISOString() : null,
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
            <label className="appointment-field-label"><span className="appointment-label-text">Horário</span><select required value={localTime} disabled={checking || !availableTimes.length} onChange={event => setLocalTime(event.target.value)}>
              <option value="">{checking ? 'Consultando...' : 'Selecione'}</option>{availableTimes.map(time => <option key={time}>{time}</option>)}
            </select></label>
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
              {grouped.map((group) => (
                <div className="appointment-day" key={group.day}>
                  <h3>{group.day}</h3>
                  {group.items.map((appointment) => (
                    <article className="appointment-card" key={appointment.id} data-status={appointment.status}>
                      <div className="appointment-card-content">
                        <div className="appointment-card-heading">
                          <div className="appointment-card-title-row">
                            <div className="appointment-time"><strong>{appointment.timeLabel}</strong><span>{appointment.endTimeLabel || '--:--'}</span></div>
                            <strong>{appointment.title}</strong>
                          </div>
                          <Badge value={appointment.statusLabel} status="channel" />
                        </div>
                        <div className="appointment-contact-row">
                          <UserRound size={14} />
                          <span>{appointment.contactName || 'Sem contato'}</span>
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
                      </div>
                    </article>
                  ))}
                </div>
              ))}
              {!appointments.length && <EmptyState title="Nenhum agendamento" text="Crie um agendamento para acompanhar seus próximos atendimentos." compact />}
            </>
          )}
        </div>
      </section>
    </section>
  );
}

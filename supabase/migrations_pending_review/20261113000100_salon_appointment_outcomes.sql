begin;

create or replace function public.magia_mark_appointment_outcome(
  p_appointment uuid,
  p_outcome text,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a public.appointments%rowtype;
  v_actor text;
  v_status text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_closed boolean := false;
begin
  if auth.uid() is null then raise exception 'APPOINTMENT_OUTCOME_FORBIDDEN'; end if;
  if p_outcome is null or p_outcome not in ('no_show', 'attended') then raise exception 'APPOINTMENT_OUTCOME_INVALID'; end if;

  select * into a from public.appointments where id = p_appointment for update;
  if not found then raise exception 'APPOINTMENT_NOT_FOUND'; end if;

  select coalesce(nullif(m.email, ''), auth.uid()::text) into v_actor
  from public.tenant_members m
  where m.tenant_id = a.tenant_id and m.user_id = auth.uid() and m.status = 'active'
    and m.role in ('owner', 'admin', 'manager', 'operator', 'agent')
  limit 1;
  if v_actor is null then raise exception 'APPOINTMENT_OUTCOME_FORBIDDEN'; end if;

  v_status := case p_outcome when 'no_show' then 'no_show' else 'completed' end;
  if a.status = v_status or (p_outcome = 'attended' and a.status = 'done') then
    return jsonb_build_object('ok', true, 'appointment_id', a.id, 'status', a.status, 'already', true, 'closed_conversation', false);
  end if;

  -- Só agendamentos ainda abertos ou o desfecho oposto (correção de clique errado).
  if a.status not in ('scheduled', 'confirmed', 'pending_payment', 'payment_reported', 'reserved', 'no_show', 'completed', 'done') then
    raise exception 'APPOINTMENT_OUTCOME_INVALID_STATUS';
  end if;
  if (case when a.ends_at >= a.starts_at then a.ends_at else a.starts_at end) > now() then raise exception 'APPOINTMENT_NOT_STARTED'; end if;

  update public.appointments
  set status = v_status,
      updated_at = clock_timestamp(),
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object('outcome', p_outcome, 'outcome_at', now(), 'outcome_by', v_actor)
        || case when v_note is null then '{}'::jsonb else jsonb_build_object('outcome_note', v_note) end
  where id = a.id;

  if p_outcome = 'no_show' and a.channel_type = 'whatsapp' and nullif(a.external_conversation_id, '') is not null
    and not exists (select 1 from public.tenants t where t.id = a.tenant_id and t.slug = 'ic_salon') then
    perform public.magia_record_turn_control_event(jsonb_build_object(
      'tenant_id', a.tenant_id,
      'channel_type', 'whatsapp',
      'direction', 'outbound',
      'sender_type', 'system',
      'external_conversation_id', a.external_conversation_id,
      'external_message_id', 'appointment_outcome_no_show_' || a.id::text,
      'command_id', 'appointment_outcome_no_show_' || a.id::text,
      'contact_name', a.contact_name,
      'message_text', 'Atendimento encerrado: cliente não veio',
      'service', 'conversation_closed',
      'stage', 'Finalizado',
      'handoff', false,
      'ai_provider', 'conversation_closed',
      'delivery_status', 'closed',
      'sent_by_user', v_actor,
      'raw_payload', jsonb_build_object(
        'command', 'appointment_outcome', 'close_reason', 'no_show',
        'appointment_id', a.id, 'closed_by', v_actor, 'note', v_note)
    ));
    v_closed := true;
  end if;

  return jsonb_build_object('ok', true, 'appointment_id', a.id, 'status', v_status, 'already', false, 'closed_conversation', v_closed);
end
$$;

create or replace function public.magia_slot_proposal_resolve(
 p_tenant uuid,p_channel text,p_chat text,p_appointment uuid,p_proposal_id text,p_decision text,p_turn_event uuid
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.appointments%rowtype; proposal jsonb; stamp timestamptz := clock_timestamp(); start_at timestamptz;
 ttl_text text; ttl_hours numeric := 48;
begin
 if p_tenant is null or p_channel is distinct from 'whatsapp' or nullif(trim(p_chat),'') is null or p_appointment is null
   or nullif(trim(p_proposal_id),'') is null or p_decision is null or p_decision not in ('accept','reject') or p_turn_event is null then
   raise exception 'SLOT_PROPOSAL_INVALID'; end if;
 perform pg_advisory_xact_lock(hashtextextended('slot_proposal:' || p_tenant::text || ':' || p_channel || ':' || p_chat,0));
 stamp := clock_timestamp();
 select * into r from public.appointments where id=p_appointment and tenant_id=p_tenant and channel_type=p_channel
   and external_conversation_id=p_chat for update;
 if not found then raise exception 'SLOT_PROPOSAL_SCOPE'; end if;
 proposal := r.metadata->'slot_proposal';
 if proposal->>'id' is distinct from p_proposal_id then raise exception 'SLOT_PROPOSAL_CHANGED'; end if;
 if proposal->>'status' in ('accepted','rejected') then
   if proposal->>'decision' is distinct from p_decision or proposal->>'turn_event' is distinct from p_turn_event::text then
     raise exception 'SLOT_PROPOSAL_ALREADY_RESOLVED'; end if;
   return jsonb_build_object('appointment',to_jsonb(r),'proposal',proposal,'already',true);
 end if;
 if r.status <> 'cancelled' or proposal->>'status' is distinct from 'sent'
   or nullif(proposal->>'message_id','') is null or nullif(proposal->>'sent_at','') is null then
   raise exception 'SLOT_PROPOSAL_NOT_SENT'; end if;
 -- Prazo da proposta (horas) por tenant; ausente ou inválido usa 48. Vencida: nem aceite nem recusa tardia mudam o pedido.
 select settings->'appointment_request'->>'slot_proposal_ttl_hours' into ttl_text from public.tenant_settings where tenant_id=p_tenant;
 if ttl_text ~ '^[0-9]{1,4}(\.[0-9]+)?$' and ttl_text::numeric > 0 then ttl_hours := ttl_text::numeric; end if;
 if (proposal->>'sent_at')::timestamptz + make_interval(secs => ttl_hours * 3600) < stamp then
   raise exception 'SLOT_PROPOSAL_EXPIRED'; end if;
 if not exists(select 1 from public.channel_events e where e.id=p_turn_event and e.tenant_id=p_tenant
   and e.channel_type=p_channel and e.external_conversation_id=p_chat and e.direction='inbound'
   and e.sender_type='contact' and e.created_at > (proposal->>'sent_at')::timestamptz) then
   raise exception 'SLOT_PROPOSAL_INVALID_TURN'; end if;
 start_at := (proposal->>'starts_at')::timestamptz;
 if p_decision='accept' and start_at <= stamp then raise exception 'SLOT_PROPOSAL_PAST'; end if;
 -- Sem destinatário confiável, preserve a proteção anterior.
 if p_decision='accept' and exists(select 1 from public.appointments a where a.tenant_id=p_tenant and a.channel_type=p_channel
   and a.external_conversation_id=p_chat and a.status='pending_confirmation' and a.id<>r.id
   and (coalesce(r.metadata->>'recipient_key','')='' or coalesce(a.metadata->>'recipient_key','')=''
     or a.metadata->>'recipient_key'=r.metadata->>'recipient_key')) then
   raise exception 'SLOT_PROPOSAL_OPEN_REQUEST_EXISTS'; end if;
 proposal := proposal || jsonb_build_object('status',case when p_decision='accept' then 'accepted' else 'rejected' end,
   'decision',p_decision,'turn_event',p_turn_event,'resolved_at',stamp);
 if p_decision='accept' then
   update public.appointments set status='pending_confirmation',starts_at=start_at,
     ends_at=case when r.ends_at is null then null else start_at + (r.ends_at-r.starts_at) end,
     metadata=(metadata - 'confirmation_state' - 'confirmation_command' - 'confirmation_action' - 'confirmation_message_id'
       - 'confirmation_echo_text' - 'cancel_reason' - 'cancelled_at' - 'cancelled_by') || jsonb_build_object(
       'slot_proposal',proposal,'requested_date',proposal->>'date','requested_time',proposal->>'time',
       'request_version',coalesce((r.metadata->>'request_version')::integer,0)+1,
       'request_key','slot_proposal:' || p_proposal_id,'request_updated_at',stamp),updated_at=stamp
     where id=r.id returning * into r;
 else
   update public.appointments set metadata=metadata || jsonb_build_object('slot_proposal',proposal),updated_at=stamp
     where id=r.id returning * into r;
 end if;
 return jsonb_build_object('appointment',to_jsonb(r),'proposal',proposal,'already',false);
end $$;

create or replace function public.magia_deposit_required_recipients(p_tenant uuid)
returns table (channel_type text, external_conversation_id text, recipient_key text, appointment_id uuid, last_no_show_at timestamptz)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select latest.channel_type, latest.external_conversation_id, latest.recipient, latest.id, latest.starts_at
  from (
    select distinct on (a.channel_type, a.external_conversation_id, person.recipient)
      a.channel_type, a.external_conversation_id, person.recipient, a.id, a.starts_at, a.status
    from public.appointments a
    join public.tenants t on t.id = a.tenant_id and t.slug = 'ic_salon'
    cross join lateral (
      select lower(btrim(regexp_replace(normalize(coalesce(nullif(a.contact_name, ''), a.metadata->>'customer_name', ''), NFKC), '[[:space:]]+', ' ', 'g'))) as recipient
    ) person
    where a.tenant_id = p_tenant and nullif(a.external_conversation_id, '') is not null
      and person.recipient <> '' and a.status in ('no_show', 'completed', 'done')
    order by a.channel_type, a.external_conversation_id, person.recipient, a.starts_at desc, a.created_at desc
  ) latest
  where latest.status = 'no_show';
$$;

revoke all on function public.magia_deposit_required_recipients(uuid) from public, anon;
grant execute on function public.magia_deposit_required_recipients(uuid) to authenticated, service_role;

commit;
notify pgrst, 'reload schema';

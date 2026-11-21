-- PROPOSTA: atribuição do motor e origem comprovada na mesma transação.
-- Aplicar somente após revisão e autorização explícita.
alter table public.conversation_turn_control_origins alter column actor_id drop not null;
alter table public.conversation_turn_control_origins add constraint engine_origin_actor_check
  check ((source_kind = 'engine_assignment' and actor_id is null) or (source_kind <> 'engine_assignment' and actor_id is not null));

create or replace function public.magia_record_engine_assignment(p_tenant uuid, p_chat text, p_token uuid, p_event jsonb)
returns setof public.channel_events language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.conversation_turn_queue%rowtype; e public.channel_events%rowtype; snapshot jsonb;
begin
  if p_tenant is null or nullif(p_chat,'') is null or p_token is null or jsonb_typeof(p_event) is distinct from 'object'
    then raise exception 'ENGINE_ASSIGNMENT_SCOPE_INVALID'; end if;
  select * into q from public.conversation_turn_queue where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat for update;
  if not found or q.token is distinct from p_token or q.phase not in ('processing','sending')
    or q.lease_until is null or q.lease_until <= clock_timestamp() or q.retry_batch_id is null
    or jsonb_typeof(q.claimed) is distinct from 'array' or jsonb_array_length(q.claimed)=0
    then raise exception 'ENGINE_ASSIGNMENT_TURN_INVALID'; end if;
  if exists (select 1 from jsonb_array_elements(q.claimed) m where not exists (
    select 1 from public.channel_events c where c.id::text=m->>'event_id' and c.tenant_id=p_tenant
      and c.channel_type='whatsapp' and c.external_conversation_id=p_chat and c.external_message_id=m->>'id' and c.direction='inbound'))
    then raise exception 'ENGINE_ASSIGNMENT_CLAIM_INVALID'; end if;
  if p_event->>'tenant_id' is distinct from p_tenant::text or p_event->>'external_conversation_id' is distinct from p_chat
    or p_event->>'channel_type' is distinct from 'whatsapp' or p_event->>'direction' is distinct from 'outbound'
    or p_event->>'sender_type' is distinct from 'system' or p_event->>'service' is distinct from 'conversation_assigned'
    or p_event->>'ai_provider' is distinct from 'human_lock' or p_event->'handoff' is distinct from 'true'::jsonb
    or p_event#>>'{raw_payload,command}' is distinct from 'assign_conversation'
    or nullif(p_event->>'external_message_id','') is null or p_event->>'command_id' is distinct from p_event->>'external_message_id'
    or nullif(p_event->>'tenant_slug','') is null or not exists (select 1 from public.tenants t where t.id=p_tenant and t.slug=p_event->>'tenant_slug')
    then raise exception 'ENGINE_ASSIGNMENT_EVENT_INVALID'; end if;
  insert into public.channel_events(tenant_id,tenant_slug,channel_type,external_conversation_id,external_message_id,direction,sender_type,
    contact_name,message_text,service,stage,handoff,response_text,ai_provider,ai_model,ai_error,ai_usage,sent_by_user,delivery_status,command_id,raw_payload)
  values(p_tenant,p_event->>'tenant_slug','whatsapp',p_chat,p_event->>'external_message_id','outbound','system',
    p_event->>'contact_name',p_event->>'message_text','conversation_assigned',p_event->>'stage',true,null,'human_lock',
    p_event->>'ai_model',p_event->>'ai_error',coalesce(p_event->'ai_usage','{}'::jsonb),p_event->>'sent_by_user',
    p_event->>'delivery_status',p_event->>'command_id',coalesce(p_event->'raw_payload','{}'::jsonb))
  on conflict do nothing returning * into e;
  if e.id is null then
    select * into e from public.channel_events where tenant_id=p_tenant and channel_type='whatsapp' and external_conversation_id=p_chat
      and external_message_id=p_event->>'external_message_id' for update;
    if not found or e.command_id is distinct from p_event->>'command_id' or e.raw_payload is distinct from p_event->'raw_payload'
      or e.service is distinct from 'conversation_assigned' or e.sender_type is distinct from 'system' or e.ai_provider is distinct from 'human_lock'
      or e.direction is distinct from 'outbound' or e.handoff is distinct from true then raise exception 'ENGINE_ASSIGNMENT_CONFLICT'; end if;
    if not exists (select 1 from public.conversation_turn_control_origins o where o.event_id=e.id and o.tenant_id=p_tenant
      and o.actor_id is null and o.source_kind='engine_assignment' and o.event_snapshot=public.magia_control_event_projection(to_jsonb(e)))
      then raise exception 'ENGINE_ASSIGNMENT_ORIGIN_CONFLICT'; end if;
    return next e; return;
  end if;
  snapshot:=public.magia_control_event_projection(to_jsonb(e));
  insert into public.conversation_turn_control_origins(event_id,tenant_id,actor_id,event_snapshot,source_kind)
    values(e.id,p_tenant,null,snapshot,'engine_assignment') on conflict do nothing;
  if not exists (select 1 from public.conversation_turn_control_origins o where o.event_id=e.id and o.tenant_id=p_tenant
    and o.actor_id is null and o.source_kind='engine_assignment' and o.event_snapshot=snapshot)
    then raise exception 'ENGINE_ASSIGNMENT_ORIGIN_CONFLICT'; end if;
  return next e;
end $$;
revoke all on function public.magia_record_engine_assignment(uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.magia_record_engine_assignment(uuid,text,uuid,jsonb) to service_role;

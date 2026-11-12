-- PROPOSTA LOCAL PARA REVISÃO. Não aplicar sem autorização e testes em PostgreSQL isolado.
-- Todas as operações de proposta devem usar estas RPCs e o mesmo lock por conversa.
-- Escritores diretos de metadata.slot_proposal não participam da serialização.
-- `sent` significa aceite do provedor com message_id, não entrega ou leitura no aparelho.
-- sending/uncertain bloqueiam novas propostas e exigem reconciliação operacional; não reenviar.
-- Um `sending` com mais de 2 minutos (queda do n8n entre prepare e finalize) também pode ser conferido pela equipe.
-- Envio exige slot_proposal_enabled E slot_proposal_resolution_enabled (não se envia proposta que não será lida).
-- Prazo: appointment_request.slot_proposal_ttl_hours (padrão 48h); proposta `sent` vencida não é aceita nem recusada.
-- A data de channel_events é a ingestão: mensagem anterior à finalização é recusada.
-- Ambiguidade de horário em mudança de fuso deve ser avaliada antes da ativação.
begin;

create or replace function public.magia_slot_proposal_prepare(
 p_tenant uuid, p_channel text, p_chat text, p_appointment uuid, p_expected_version integer,
 p_proposal_id text, p_date date, p_time time, p_echo_text text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.appointments%rowtype; other public.appointments%rowtype; cfg jsonb; zone text;
 start_at timestamptz; old_proposal jsonb; proposal jsonb; history jsonb; stamp timestamptz := clock_timestamp();
begin
 if p_tenant is null or p_channel is distinct from 'whatsapp' or nullif(trim(p_chat),'') is null or p_appointment is null
    or p_expected_version is null or nullif(trim(p_proposal_id),'') is null or p_date is null or p_time is null
    or p_time <> date_trunc('minute',p_time::interval)::time or nullif(trim(p_echo_text),'') is null then
   raise exception 'SLOT_PROPOSAL_INVALID';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('slot_proposal:' || p_tenant::text || ':' || p_channel || ':' || p_chat,0));
 stamp := clock_timestamp();
 select settings, timezone into cfg, zone from public.tenant_settings where tenant_id=p_tenant;
 if not found or cfg->'appointment_request'->>'mode' is distinct from 'operator_confirmation'
    or cfg->'appointment_request'->>'slot_proposal_enabled' is distinct from 'true'
    or cfg->'appointment_request'->>'slot_proposal_resolution_enabled' is distinct from 'true'
    or nullif(zone,'') is null then raise exception 'SLOT_PROPOSAL_NOT_ENABLED'; end if;
 start_at := (p_date + p_time) at time zone zone;
 if start_at <= clock_timestamp() or (start_at at time zone zone) <> p_date + p_time then
   raise exception 'SLOT_PROPOSAL_INVALID_TIME';
 end if;
 select * into r from public.appointments where id=p_appointment and tenant_id=p_tenant
   and channel_type=p_channel and external_conversation_id=p_chat for update;
 if not found then raise exception 'SLOT_PROPOSAL_SCOPE'; end if;
 old_proposal := coalesce(r.metadata->'slot_proposal','{}'::jsonb);
 if old_proposal->>'id'=p_proposal_id then
   if old_proposal->>'date' is distinct from p_date::text or old_proposal->>'time' is distinct from to_char(p_time,'HH24:MI')
     or old_proposal->>'echo_text' is distinct from p_echo_text
     or (old_proposal->>'request_version')::integer is distinct from p_expected_version then
     raise exception 'SLOT_PROPOSAL_ID_REUSED';
   end if;
   return jsonb_build_object('appointment',to_jsonb(r),'proposal',old_proposal,'already',true);
 end if;
 if r.status <> 'pending_confirmation' or (r.metadata->>'request_version')::integer is distinct from p_expected_version
   or r.metadata->>'confirmation_state' is not null then raise exception 'SLOT_PROPOSAL_CHANGED'; end if;
 if exists(select 1 from public.appointments a where a.tenant_id=p_tenant and a.channel_type=p_channel
   and a.external_conversation_id=p_chat and (a.metadata->'slot_proposal'->>'id'=p_proposal_id
     or coalesce(a.metadata->'slot_proposal_history','[]'::jsonb) @> jsonb_build_array(jsonb_build_object('id',p_proposal_id)))) then
   raise exception 'SLOT_PROPOSAL_ID_REUSED';
 end if;
 if exists(select 1 from public.appointments a where a.tenant_id=p_tenant and a.channel_type=p_channel
   and a.external_conversation_id=p_chat and a.metadata->'slot_proposal'->>'status' in ('sending','uncertain')) then
   raise exception 'SLOT_PROPOSAL_DELIVERY_UNCERTAIN';
 end if;
 for other in select * from public.appointments a where a.tenant_id=p_tenant and a.channel_type=p_channel
   and a.external_conversation_id=p_chat and a.id<>p_appointment and a.metadata->'slot_proposal'->>'status'='sent' for update loop
   update public.appointments set metadata=jsonb_set(coalesce(other.metadata,'{}'),'{slot_proposal,status}','"superseded"'::jsonb),
     updated_at=stamp where id=other.id;
 end loop;
 history := coalesce(r.metadata->'slot_proposal_history','[]'::jsonb);
 if old_proposal <> '{}'::jsonb then history := history || jsonb_build_array(old_proposal); end if;
 proposal := jsonb_build_object('id',p_proposal_id,'status','sending','date',p_date::text,'time',to_char(p_time,'HH24:MI'),
   -- Em UTC fixo: o texto não depende do TimeZone da sessão que chamou a RPC.
   'starts_at',to_char(start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),'request_version',p_expected_version,'echo_text',p_echo_text,'prepared_at',stamp,
   'previous_start',r.starts_at,'previous_end',r.ends_at);
 update public.appointments set metadata=coalesce(r.metadata,'{}') || jsonb_build_object('slot_proposal',proposal,
   'slot_proposal_history',history,'confirmation_state','sending','confirmation_command',p_proposal_id,
   'confirmation_action','reject','confirmation_echo_text',p_echo_text),updated_at=stamp where id=r.id returning * into r;
 return jsonb_build_object('appointment',to_jsonb(r),'proposal',proposal,'already',false);
end $$;

create or replace function public.magia_slot_proposal_finalize(
 p_tenant uuid,p_channel text,p_chat text,p_appointment uuid,p_proposal_id text,p_message_id text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.appointments%rowtype; proposal jsonb; stamp timestamptz := clock_timestamp();
begin
 if p_tenant is null or p_channel is distinct from 'whatsapp' or nullif(trim(p_chat),'') is null or p_appointment is null
   or nullif(trim(p_proposal_id),'') is null or nullif(trim(p_message_id),'') is null then raise exception 'SLOT_PROPOSAL_INVALID'; end if;
 perform pg_advisory_xact_lock(hashtextextended('slot_proposal:' || p_tenant::text || ':' || p_channel || ':' || p_chat,0));
 stamp := clock_timestamp();
 select * into r from public.appointments where id=p_appointment and tenant_id=p_tenant and channel_type=p_channel
   and external_conversation_id=p_chat for update;
 if not found then raise exception 'SLOT_PROPOSAL_SCOPE'; end if;
 proposal := r.metadata->'slot_proposal';
 if proposal->>'id' is distinct from p_proposal_id then raise exception 'SLOT_PROPOSAL_CHANGED'; end if;
 if proposal->>'status'='sent' and proposal->>'message_id'=p_message_id then
   return jsonb_build_object('appointment',to_jsonb(r),'proposal',proposal,'already',true); end if;
 if r.status is distinct from 'pending_confirmation' or coalesce(proposal->>'status','') not in ('sending','uncertain')
   or r.metadata->>'confirmation_state' is distinct from proposal->>'status'
   or r.metadata->>'confirmation_command' is distinct from p_proposal_id then raise exception 'SLOT_PROPOSAL_CHANGED'; end if;
 proposal := proposal || jsonb_build_object('status','sent','message_id',p_message_id,'sent_at',stamp);
 update public.appointments set status='cancelled',metadata=(metadata - 'confirmation_echo_text') ||
   jsonb_build_object('slot_proposal',proposal,'confirmation_state','sent','confirmation_message_id',p_message_id,
   'cancel_reason','slot_rejected','cancelled_at',stamp),updated_at=stamp where id=r.id returning * into r;
 return jsonb_build_object('appointment',to_jsonb(r),'proposal',proposal,'already',false);
end $$;

-- p_message_id: id devolvido pelo provedor quando o envio funcionou mas o finalize falhou. Fica em provider_message_id
-- para a conferência humana não precisar digitar um id que o atendente não tem.
create or replace function public.magia_slot_proposal_mark_uncertain(
 p_tenant uuid,p_channel text,p_chat text,p_appointment uuid,p_proposal_id text,p_message_id text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.appointments%rowtype; proposal jsonb; known text := nullif(trim(coalesce(p_message_id,'')),'');
begin
 if p_tenant is null or p_channel is distinct from 'whatsapp' or nullif(trim(p_chat),'') is null
   or p_appointment is null or nullif(trim(p_proposal_id),'') is null then raise exception 'SLOT_PROPOSAL_INVALID'; end if;
 perform pg_advisory_xact_lock(hashtextextended('slot_proposal:' || p_tenant::text || ':' || p_channel || ':' || p_chat,0));
 select * into r from public.appointments where id=p_appointment and tenant_id=p_tenant and channel_type=p_channel
   and external_conversation_id=p_chat for update;
 if not found then raise exception 'SLOT_PROPOSAL_SCOPE'; end if;
 proposal := r.metadata->'slot_proposal';
 if proposal->>'id' is distinct from p_proposal_id then raise exception 'SLOT_PROPOSAL_CHANGED'; end if;
 if proposal->>'status'='uncertain' then
   if known is not null and nullif(proposal->>'provider_message_id','') is null then
     proposal := proposal || jsonb_build_object('provider_message_id',known);
     update public.appointments set metadata=metadata || jsonb_build_object('slot_proposal',proposal),updated_at=clock_timestamp()
       where id=r.id returning * into r;
   end if;
   return jsonb_build_object('appointment',to_jsonb(r),'proposal',proposal,'already',true);
 end if;
 if r.status <> 'pending_confirmation' or proposal->>'status' is distinct from 'sending'
   or r.metadata->>'confirmation_state' is distinct from 'sending'
   or r.metadata->>'confirmation_command' is distinct from p_proposal_id then raise exception 'SLOT_PROPOSAL_CHANGED'; end if;
 proposal := proposal || jsonb_build_object('status','uncertain','uncertain_at',clock_timestamp())
   || case when known is null then '{}'::jsonb else jsonb_build_object('provider_message_id',known) end;
 update public.appointments set metadata=metadata || jsonb_build_object('slot_proposal',proposal,'confirmation_state','uncertain'),
   updated_at=clock_timestamp() where id=r.id returning * into r;
 return jsonb_build_object('appointment',to_jsonb(r),'proposal',proposal,'already',false);
end $$;

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
 -- Só pode haver um pedido pendente por conversa (appointments_one_open_request_idx). Se a cliente abriu outro pedido
 -- depois da proposta, o aceite não reabre este: a decisão fica com a equipe e com a conversa atual.
 if p_decision='accept' and exists(select 1 from public.appointments a where a.tenant_id=p_tenant and a.channel_type=p_channel
   and a.external_conversation_id=p_chat and a.status='pending_confirmation' and a.id<>r.id) then
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

-- Somente após verificação humana explícita. O chamador deve autorizar o operador no tenant.
-- Aceita `uncertain` e `sending` antigo (> 2 min, n8n caiu entre prepare e finalize).
-- delivered: usa p_message_id, senão o provider_message_id gravado pelo mark_uncertain; sem nenhum dos dois grava
-- um marcador 'manual:<proposta>' e reconciliation.message_id_unknown=true (o eco do WhatsApp casa por texto).
create or replace function public.magia_slot_proposal_reconcile(
 p_tenant uuid,p_channel text,p_chat text,p_appointment uuid,p_proposal_id text,p_resolution text,p_actor uuid,p_message_id text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.appointments%rowtype; proposal jsonb; stamp timestamptz; receipt jsonb; known text; unknown boolean := false;
 prepared timestamptz;
begin
 if p_tenant is null or p_channel is distinct from 'whatsapp' or nullif(trim(p_chat),'') is null or p_appointment is null
   or nullif(trim(p_proposal_id),'') is null or p_resolution is null or p_resolution not in ('delivered','not_delivered')
   or p_actor is null or (p_resolution='not_delivered' and p_message_id is not null) then raise exception 'SLOT_PROPOSAL_INVALID'; end if;
 perform pg_advisory_xact_lock(hashtextextended('slot_proposal:' || p_tenant::text || ':' || p_channel || ':' || p_chat,0));
 stamp := clock_timestamp();
 select * into r from public.appointments where id=p_appointment and tenant_id=p_tenant and channel_type=p_channel
   and external_conversation_id=p_chat for update;
 if not found then raise exception 'SLOT_PROPOSAL_SCOPE'; end if;
 proposal := r.metadata->'slot_proposal';
 if proposal->>'id' is distinct from p_proposal_id then raise exception 'SLOT_PROPOSAL_CHANGED'; end if;
 if proposal->'reconciliation'->>'resolution'=p_resolution then
   if proposal->'reconciliation'->>'actor' is distinct from p_actor::text
     or (p_resolution='delivered' and nullif(trim(coalesce(p_message_id,'')),'') is not null
       and proposal->>'message_id' is distinct from p_message_id) then
     raise exception 'SLOT_PROPOSAL_RECONCILIATION_CONFLICT'; end if;
   return jsonb_build_object('appointment',to_jsonb(r),'proposal',proposal,'already',true);
 end if;
 begin prepared := (proposal->>'prepared_at')::timestamptz; exception when others then prepared := null; end;
 if r.status <> 'pending_confirmation'
   or not (proposal->>'status'='uncertain'
     or (proposal->>'status'='sending' and prepared is not null and prepared < clock_timestamp() - interval '2 minutes'))
   or r.metadata->>'confirmation_state' is distinct from proposal->>'status'
   or r.metadata->>'confirmation_command' is distinct from p_proposal_id then raise exception 'SLOT_PROPOSAL_CHANGED'; end if;
 if p_resolution='delivered' then
   known := coalesce(nullif(trim(coalesce(p_message_id,'')),''), nullif(proposal->>'provider_message_id',''));
   if known is null then known := 'manual:' || p_proposal_id; unknown := true; end if;
   receipt := public.magia_slot_proposal_finalize(p_tenant,p_channel,p_chat,p_appointment,p_proposal_id,known);
   select * into r from public.appointments where id=p_appointment for update;
   proposal := r.metadata->'slot_proposal';
 else
   proposal := proposal || jsonb_build_object('status','not_delivered');
 end if;
 proposal := proposal || jsonb_build_object('reconciliation',jsonb_build_object('resolution',p_resolution,'actor',p_actor,'at',stamp,
   'message_id_unknown',unknown));
 update public.appointments set metadata=(case when p_resolution='not_delivered' then
   metadata - 'confirmation_state' - 'confirmation_command' - 'confirmation_action' - 'confirmation_echo_text'
   else metadata end) || jsonb_build_object('slot_proposal',proposal),updated_at=clock_timestamp()
   where id=r.id returning * into r;
 return jsonb_build_object('appointment',to_jsonb(r),'proposal',proposal,'already',false);
end $$;

revoke all on function public.magia_slot_proposal_prepare(uuid,text,text,uuid,integer,text,date,time,text) from public,anon,authenticated;
revoke all on function public.magia_slot_proposal_finalize(uuid,text,text,uuid,text,text) from public,anon,authenticated;
revoke all on function public.magia_slot_proposal_mark_uncertain(uuid,text,text,uuid,text,text) from public,anon,authenticated;
revoke all on function public.magia_slot_proposal_resolve(uuid,text,text,uuid,text,text,uuid) from public,anon,authenticated;
revoke all on function public.magia_slot_proposal_reconcile(uuid,text,text,uuid,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.magia_slot_proposal_prepare(uuid,text,text,uuid,integer,text,date,time,text) to service_role;
grant execute on function public.magia_slot_proposal_finalize(uuid,text,text,uuid,text,text) to service_role;
grant execute on function public.magia_slot_proposal_mark_uncertain(uuid,text,text,uuid,text,text) to service_role;
grant execute on function public.magia_slot_proposal_resolve(uuid,text,text,uuid,text,text,uuid) to service_role;
grant execute on function public.magia_slot_proposal_reconcile(uuid,text,text,uuid,text,text,uuid,text) to service_role;
commit;
notify pgrst, 'reload schema';

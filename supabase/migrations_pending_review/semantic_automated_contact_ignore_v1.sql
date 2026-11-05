-- PROPOSTA LOCAL: aplicar apenas com autorização, antes do CORE correspondente.
-- Não altera tabelas, contatos nem autorizações humanas. Ignora só um turno.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
create or replace function public.magia_ignore_automated_turn(
  p_tenant uuid, p_chat text, p_token uuid, p_model text, p_proof jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.conversation_turn_queue%rowtype; r public.conversation_turn_terminal_receipts%rowtype;
  ids jsonb; expected_model text; tenant_key text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'SEMANTIC_IGNORE_FORBIDDEN'; end if;
  select * into r from public.conversation_turn_terminal_receipts where turn_token=p_token;
  if found then
    if r.tenant_id is distinct from p_tenant or r.chat_id is distinct from p_chat
      or r.evidence->>'contract' is distinct from 'noria_semantic_contact_ignore_v1' then raise exception 'SEMANTIC_IGNORE_SCOPE_MISMATCH'; end if;
    return jsonb_build_object('finished',true,'outcome','done','contract','noria_semantic_contact_ignore_v1','idempotent',true);
  end if;
  select * into q from public.conversation_turn_queue where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat for update;
  if not found or p_token is null or q.token is distinct from p_token or q.phase<>'sending'
    or q.lease_until is null or q.lease_until<=clock_timestamp() or jsonb_array_length(q.claimed)=0 then raise exception 'STALE_SEMANTIC_IGNORE_TURN'; end if;
  if q.current_delivery_id is not null or exists(select 1 from public.conversation_turn_delivery_attempts
    where tenant_id=p_tenant and chat_id=p_chat and turn_token=p_token) then raise exception 'SEMANTIC_IGNORE_DELIVERY_ATTEMPTED'; end if;
  select t.slug,s.settings->>'ai_model' into tenant_key,expected_model from public.tenants t
    join public.tenant_settings s on s.tenant_id=t.id where t.id=p_tenant;
  if expected_model is null or p_model is distinct from expected_model then raise exception 'SEMANTIC_IGNORE_MODEL_MISMATCH'; end if;
  select jsonb_agg(m->>'event_id' order by m->>'event_id') into ids from jsonb_array_elements(q.claimed) m;
  if p_proof->>'contract' is distinct from 'noria_semantic_contact_ignore_v1'
    or p_proof->>'kind' is distinct from 'external_automated_contact'
    or p_proof->'quoted_or_forwarded' is distinct from 'false'::jsonb
    or p_proof->'contains_customer_request' is distinct from 'false'::jsonb
    or jsonb_typeof(p_proof->'evidence_ids') is distinct from 'array'
    or jsonb_typeof(p_proof->'other_business') is distinct from 'string'
    or coalesce(length(p_proof->>'other_business'),0) not between 1 and 160
    then raise exception 'SEMANTIC_IGNORE_PROOF_INVALID'; end if;
  if (select jsonb_agg(x order by x) from jsonb_array_elements_text(p_proof->'evidence_ids') x) is distinct from ids then
    raise exception 'SEMANTIC_IGNORE_EVIDENCE_MISMATCH'; end if;
  -- Cada mensagem precisa existir no escopo correto E ter ingresso autenticado.
  if exists(select 1 from jsonb_array_elements(q.claimed) m where not exists(
    select 1 from public.channel_events e join public.conversation_turn_ingress_facts f
      on f.tenant_id=e.tenant_id and f.chat_id=e.external_conversation_id and f.external_message_id=e.external_message_id
      join public.conversation_turn_ingress_sources src on src.id=f.source_id
      where e.id::text=m->>'event_id' and e.external_message_id=m->>'id' and e.tenant_id=p_tenant
        and e.channel_type='whatsapp' and e.external_conversation_id=p_chat and e.direction='inbound' and e.sender_type in ('contact','customer')
        and not f.from_me and f.instance_name=q.instance_name and src.enabled and src.tenant_id=p_tenant and src.instance_name=q.instance_name
  )) then raise exception 'SEMANTIC_IGNORE_INGRESS_REQUIRED'; end if;
  insert into public.channel_events(tenant_id,tenant_slug,channel_type,external_conversation_id,external_message_id,direction,sender_type,
    message_text,service,stage,handoff,ai_provider,ai_model,delivery_status,raw_payload)
  values(p_tenant,tenant_key,'whatsapp',p_chat,'ignored_'||p_token::text,'outbound','system','',
    'non_customer','Contato automático ignorado',false,'automated_contact_ignored',p_model,'internal',
    jsonb_build_object('ai_suppressed',true,'customer_reply_sent',false,'conversation_session_id',q.boundary_id,
      'contact_context',p_proof,'suppression_scope','current_turn_only'));
  update public.follow_up_jobs set status='cancelled',error='automated_contact_ignored',lease_token=null,locked_until=null,updated_at=clock_timestamp()
    where tenant_id=p_tenant and channel_type='whatsapp' and external_conversation_id=p_chat and status in ('pending','processing');
  insert into public.conversation_turn_terminal_receipts(turn_token,tenant_id,chat_id,outcome,claimed,evidence)
    values(p_token,p_tenant,p_chat,'done',q.claimed,p_proof);
  update public.conversation_turn_queue set claimed='[]',token=null,lease_until=null,phase='ready',current_delivery_id=null,
    retry_batch_id=null,attempt_count=0,retry_max_attempts=null,retry_base_seconds=null,retry_cap_seconds=null,
    next_attempt_at=null,last_error_code=null,review_required_at=null,updated_at=clock_timestamp()
    where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat;
  return jsonb_build_object('finished',true,'outcome','done','contract','noria_semantic_contact_ignore_v1','idempotent',false);
end $$;
revoke all on function public.magia_ignore_automated_turn(uuid,text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.magia_ignore_automated_turn(uuid,text,uuid,text,jsonb) to service_role;
commit;

-- PROPOSTA NAO APLICADA. Nao executar em nenhum ambiente sem aprovacao explicita.
-- Antes de aplicar, comparar magia_fail_turn, magia_resolve_turn_review e
-- magia_resolve_closed_turn_review desta proposta com as funcoes vigentes em producao
-- (pg_get_functiondef); as copias abaixo partem de turn_queue_lifecycle_v1.sql e
-- turn_queue_closure_recovery_v1.sql locais e podem divergir do que esta em producao.
-- Objetivo: rejeicao HTTP 4xx da Evolution (POST /message/sendText) comprova nao-entrega;
-- o turno vai para 'review' (reason provider_rejected_delivery), a tentativa vira 'rejected'
-- e a revisao humana pode retomar (resume_unattempted) ou encerrar (close_with_evidence).
-- Sem p_delivery_rejected=true o comportamento permanece identico (uncertain).
-- Rollback: turn_fail_provider_rejected_v1_rollback.sql.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- a) check de status aceita 'rejected' (nome da constraint descoberto em pg_constraint).
do $$
declare c record;
begin
  for c in select con.conname from pg_constraint con
    where con.conrelid='public.conversation_turn_delivery_attempts'::regclass and con.contype='c'
      and pg_get_constraintdef(con.oid) like '%status%' and pg_get_constraintdef(con.oid) like '%uncertain%' loop
    execute format('alter table public.conversation_turn_delivery_attempts drop constraint %I',c.conname);
  end loop;
  alter table public.conversation_turn_delivery_attempts add constraint conversation_turn_delivery_attempts_status_check
    check (status in ('attempting','confirmed','uncertain','superseded_uncertain','rejected'));
end $$;

-- b) magia_fail_turn com p_delivery_rejected (6 args). A assinatura antiga e removida;
-- chamadas posicionais de 5 args (claim, finish) resolvem pelo default.
drop function if exists public.magia_fail_turn(uuid,text,uuid,text,boolean);
-- Lock/fence and decide atomically. current_delivery_id=NULL is NOT proof by
-- itself: also check the attempt ledger and require a batch created by v1.
create or replace function public.magia_fail_turn(
  p_tenant uuid,p_chat text,p_token uuid,p_error text,p_retryable boolean default false,p_delivery_rejected boolean default false
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.conversation_turn_queue%rowtype; has_attempt boolean; target text; reason text; delay_s numeric; rejected boolean:=false;
begin
  select * into q from public.conversation_turn_queue where tenant_id=p_tenant
    and channel_type='whatsapp' and chat_id=p_chat for update;
  if not found or p_token is null or q.token is distinct from p_token then
    return jsonb_build_object('finished',false,'reason','stale_token');
  end if;
  select exists(select 1 from public.conversation_turn_delivery_attempts a
    where a.tenant_id=p_tenant and a.channel_type='whatsapp' and a.chat_id=p_chat
      and a.turn_token=p_token) into has_attempt;
  if q.phase in ('uncertain','review') then
    return jsonb_build_object('finished',true,'outcome',q.phase,'retry_queued',false,
      'contract','noria_turn_lifecycle_v1');
  end if;
  if q.phase not in ('processing','sending') then
    return jsonb_build_object('finished',false,'reason','invalid_phase');
  end if;
  -- Rejeicao 4xx do provedor comprova nao-entrega: so vale se nenhuma tentativa do
  -- token foi confirmada nem recebeu provider_message_id. Caso contrario, comportamento atual.
  if (has_attempt or q.current_delivery_id is not null) and p_delivery_rejected is true
    and not exists(select 1 from public.conversation_turn_delivery_attempts a
      where a.tenant_id=p_tenant and a.channel_type='whatsapp' and a.chat_id=p_chat
        and a.turn_token=p_token and (a.status='confirmed' or a.provider_message_id is not null)) then
    rejected:=true; target:='review'; reason:='provider_rejected_delivery';
  elsif has_attempt or q.current_delivery_id is not null then
    target:='uncertain'; reason:='delivery_reconciliation_required';
  elsif q.retry_batch_id is null then
    target:='review'; reason:='legacy_untracked_batch';
  elsif p_retryable is not true then
    target:='review'; reason:='permanent_or_unclassified_failure';
  elsif q.retry_max_attempts is null then
    target:='review'; reason:='retry_policy_missing';
  elsif q.attempt_count>=q.retry_max_attempts then
    target:='review'; reason:='retry_budget_exhausted';
  else
    target:='ready'; reason:='retry_scheduled';
    delay_s:=least(q.retry_cap_seconds::numeric,
      q.retry_base_seconds::numeric * power(2::numeric,least(greatest(q.attempt_count-1,0),100)));
  end if;
  -- Keep claimed, pending, token, batch identity and delivery reference intact.
  -- Expire the lease to fence the old worker before retrying with a new token.
  update public.conversation_turn_queue set phase=target,lease_until=clock_timestamp(),
    next_attempt_at=case when target='ready' then clock_timestamp()+make_interval(secs=>delay_s::double precision) else null end,
    last_error_code=left(coalesce(p_error,reason),300),
    review_required_at=case when target in ('review','uncertain') then clock_timestamp() else null end,
    current_delivery_id=case when rejected then null else current_delivery_id end,
    updated_at=clock_timestamp()
    where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat;
  update public.conversation_turn_delivery_attempts set status=case when rejected then 'rejected' else 'uncertain' end,
    error_code=coalesce(error_code,left(p_error,300)),updated_at=clock_timestamp()
    where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=p_chat
      and turn_token=p_token and status<>'confirmed';
  return jsonb_build_object('finished',true,'outcome',target,'reason',reason,
    'retry_queued',target='ready','attempt_count',q.attempt_count,
    'contract','noria_turn_lifecycle_v1');
end $$;

revoke all on function public.magia_fail_turn(uuid,text,uuid,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.magia_fail_turn(uuid,text,uuid,text,boolean,boolean) to service_role;

-- c) revisao ignora tentativas 'rejected' na verificacao de reconciliacao.
create or replace function public.magia_resolve_turn_review(
  p_tenant uuid,p_ticket uuid,p_expected_revision bigint,p_action text,p_note text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.conversation_turn_review_tickets%rowtype; q public.conversation_turn_queue%rowtype;
  pol public.conversation_turn_retry_policy%rowtype; actor uuid; result jsonb; proof jsonb; reviewer boolean;
  bt timestamptz; before_p jsonb; after_p jsonb;
begin
  actor:=auth.uid();
  reviewer:=exists(select 1 from public.conversation_turn_review_operators
    where tenant_id=p_tenant and operator_id=actor);
  -- Closing one's own authenticated attendance is not general review authority.
  -- Recheck that exact closure below, under the queue/ticket locks.
  if actor is null or (not reviewer and (p_action is distinct from 'close_with_evidence'
    or not exists(select 1 from public.tenant_members where tenant_id=p_tenant and user_id=actor
      and status='active' and role in ('owner','admin','manager','operator','agent')))) then
    raise exception 'TURN_REVIEW_FORBIDDEN';
  end if;
  if p_action is null or p_action not in ('acknowledge','finalize_confirmed','close_with_evidence','resume_unattempted')
    or nullif(btrim(p_note),'') is null then raise exception 'INVALID_REVIEW_RESOLUTION'; end if;
  select * into t from public.conversation_turn_review_tickets where id=p_ticket and tenant_id=p_tenant;
  if not found then raise exception 'TURN_REVIEW_NOT_FOUND'; end if;
  -- Same lock order as every queue RPC/trigger: queue first, then ticket.
  select * into q from public.conversation_turn_queue where tenant_id=p_tenant
    and channel_type='whatsapp' and chat_id=t.chat_id for update;
  select * into t from public.conversation_turn_review_tickets where id=p_ticket and tenant_id=p_tenant for update;
  if q.tenant_id is null or t.resolved_at is not null or p_expected_revision is null
    or t.revision<>p_expected_revision or q.phase not in ('review','uncertain')
    or to_jsonb(q) is distinct from t.queue_snapshot then raise exception 'STALE_TURN_REVIEW'; end if;
  if p_action='acknowledge' then
    update public.conversation_turn_review_tickets set acknowledged_by=actor,acknowledged_at=clock_timestamp(),
      notification_pending=false,revision=revision+1,updated_at=clock_timestamp() where id=t.id;
    return jsonb_build_object('resolved',false,'acknowledged',true,'revision',t.revision+1);
  elsif p_action='finalize_confirmed' then
    -- finish revalidates the ledger + outbound evidence; no HTTP send occurs.
    result:=public.magia_finish_turn(p_tenant,q.chat_id,q.token,'done');
    if result->>'outcome' is distinct from 'done' then raise exception 'CONFIRMED_DELIVERY_REQUIRED'; end if;
    select evidence into proof from public.conversation_turn_terminal_receipts where turn_token=q.token;
  else
    -- Check the entire claimed message set across tokens, not merely a NULL
    -- current_delivery_id. Missing legacy ledger entries are NOT no-send proof.
    if q.current_delivery_id is not null or exists(select 1 from public.conversation_turn_delivery_attempts a
      where a.tenant_id=p_tenant and a.channel_type='whatsapp' and a.chat_id=q.chat_id
        and a.status<>'rejected'
        and (a.turn_token=q.token or exists(select 1 from jsonb_array_elements(q.claimed) m
          where a.claimed_event_ids ? (m->>'event_id')))) then raise exception 'DELIVERY_RECONCILIATION_REQUIRED'; end if;
    if p_action='close_with_evidence' then
      proof:=public.magia_turn_terminal_evidence(p_tenant,q.chat_id,q.token,'cancelled');
      if proof is null then raise exception 'TERMINAL_EVIDENCE_MISSING'; end if;
      if not reviewer and (q.phase<>'review' or proof->>'kind' is distinct from 'conversation_closed'
        or not exists(select 1 from public.conversation_turn_control_origins o
          where o.event_id::text=proof->>'event_id' and o.tenant_id=p_tenant
            and o.actor_id=actor and o.source_kind='authenticated_operator')) then
        raise exception 'TURN_REVIEW_FORBIDDEN';
      end if;
      -- Session boundary: messages received up to the closure belong to the
      -- closed session and are receipted with it (never answered or resent).
      -- Only messages received after the closure stay pending for a new batch.
      select e.created_at into bt from public.channel_events e where e.id::text=proof->>'event_id' and e.tenant_id=p_tenant;
      select coalesce(jsonb_agg(x.m order by x.ord) filter (where x.stale),'[]'::jsonb),
             coalesce(jsonb_agg(x.m order by x.ord) filter (where not x.stale),'[]'::jsonb)
        into before_p,after_p
        from (select m,ord,exists(select 1 from public.channel_events c where c.id::text=m->>'event_id'
                and c.tenant_id=p_tenant and c.created_at<=bt) as stale
              from jsonb_array_elements(q.pending) with ordinality as t(m,ord)) x;
      insert into public.conversation_turn_terminal_receipts(turn_token,tenant_id,chat_id,outcome,claimed,evidence)
        values(q.token,p_tenant,q.chat_id,'cancelled',q.claimed||before_p,proof);
      update public.conversation_turn_queue set phase='ready',claimed='[]',pending=after_p,token=null,lease_until=null,current_delivery_id=null,
        retry_batch_id=null,attempt_count=0,retry_max_attempts=null,retry_base_seconds=null,retry_cap_seconds=null,
        next_attempt_at=null,last_error_code=null,review_required_at=null,updated_at=clock_timestamp()
        where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=q.chat_id;
    else
      -- Only a v1 REVIEW batch with no delivery reservation may be resumed.
      -- UNCERTAIN and all legacy batches have no resend action in this RPC.
      if q.phase<>'review' or q.retry_batch_id is null or q.token is null then raise exception 'NO_SEND_PROOF_REQUIRED'; end if;
      select * into pol from public.conversation_turn_retry_policy where tenant_id=p_tenant;
      if not found then raise exception 'RETRY_POLICY_REQUIRED'; end if;
      proof:=jsonb_build_object('kind','v1_no_delivery_reservation','prior_batch_id',q.retry_batch_id);
      update public.conversation_turn_queue set phase='ready',token=gen_random_uuid(),lease_until=clock_timestamp(),
        retry_batch_id=gen_random_uuid(),attempt_count=0,retry_max_attempts=pol.max_attempts,
        retry_base_seconds=pol.base_backoff_seconds,retry_cap_seconds=pol.max_backoff_seconds,
        next_attempt_at=clock_timestamp()+make_interval(secs=>pol.base_backoff_seconds),last_error_code=null,
        review_required_at=null,updated_at=clock_timestamp()
        where tenant_id=p_tenant and channel_type='whatsapp' and chat_id=q.chat_id;
    end if;
  end if;
  update public.conversation_turn_review_tickets set resolved_by=actor,resolved_at=clock_timestamp(),resolution=p_action,
    resolution_note=p_note,resolution_snapshot=to_jsonb(q),resolution_evidence=proof,notification_pending=false,
    updated_at=clock_timestamp() where id=t.id;
  return jsonb_build_object('resolved',true,'action',p_action,'ticket_id',t.id);
end $$;

create or replace function public.magia_resolve_closed_turn_review(p_event uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.channel_events%rowtype; q public.conversation_turn_queue%rowtype;
  t public.conversation_turn_review_tickets%rowtype; proof jsonb;
begin
  select c.* into e from public.channel_events c
    join public.conversation_turn_control_origins o on o.event_id=c.id and o.tenant_id=c.tenant_id
      and o.event_snapshot=public.magia_control_event_projection(to_jsonb(c))
    where c.id=p_event and c.channel_type='whatsapp' and c.direction='outbound'
      and c.sender_type='system' and c.service='conversation_closed'
      and c.raw_payload->>'command'='close_conversation'
      and o.actor_id=auth.uid() and o.source_kind='authenticated_operator';
  if not found then return jsonb_build_object('resolved',false,'reason','closure_not_proven'); end if;
  select * into q from public.conversation_turn_queue where tenant_id=e.tenant_id
    and channel_type='whatsapp' and chat_id=e.external_conversation_id for update;
  if not found or q.phase<>'review' or q.token is null or jsonb_array_length(q.claimed)=0 then
    return jsonb_build_object('resolved',false,'reason','no_covered_review');
  end if;
  if q.current_delivery_id is not null or exists(select 1 from public.conversation_turn_delivery_attempts a
    where a.tenant_id=q.tenant_id and a.channel_type=q.channel_type and a.chat_id=q.chat_id
      and a.status<>'rejected'
      and (a.turn_token=q.token or exists(select 1 from jsonb_array_elements(q.claimed) m
        where a.claimed_event_ids ? (m->>'event_id')))) then
    return jsonb_build_object('resolved',false,'reason','delivery_reconciliation_required');
  end if;
  proof:=public.magia_turn_terminal_evidence(q.tenant_id,q.chat_id,q.token,'cancelled');
  if proof->>'kind' is distinct from 'conversation_closed'
    or proof->>'event_id' is distinct from e.id::text then
    return jsonb_build_object('resolved',false,'reason','closure_does_not_cover_batch');
  end if;
  select * into t from public.conversation_turn_review_tickets where tenant_id=q.tenant_id
    and channel_type=q.channel_type and chat_id=q.chat_id and resolved_at is null for update;
  if not found then raise exception 'TURN_REVIEW_TICKET_MISSING'; end if;
  return public.magia_resolve_turn_review(q.tenant_id,t.id,t.revision,'close_with_evidence',
    'Authenticated attendance closure: '||e.id::text);
end $$;

-- Grants originais preservados (create or replace nao os altera; reafirmados).
revoke all on function public.magia_resolve_closed_turn_review(uuid) from public,anon,authenticated,service_role;
revoke all on function public.magia_resolve_turn_review(uuid,uuid,bigint,text,text) from public,anon,authenticated,service_role;
grant execute on function public.magia_resolve_turn_review(uuid,uuid,bigint,text,text) to authenticated;

commit;

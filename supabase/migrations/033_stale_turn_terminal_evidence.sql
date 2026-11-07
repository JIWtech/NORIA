-- Migration 033: turno barrado por mensagem antiga encerra como concluído, com prova do banco.
--
-- Defeito (05/11/2026 a 07/11/2026): a trava do CORE para mensagens entregues com muito atraso encerrava o turno com
-- 'done' sem prova que magia_finish_turn aceitasse. O banco recusava (TERMINAL_EVIDENCE_MISSING:done), punha o turno em
-- revisão e a conversa ficava bloqueada para novas mensagens (technical_review_required).
--
-- A prova não confia no CORE: o banco confere que TODAS as mensagens do turno foram atestadas pelo ingresso, que o
-- horário de envio está no evento de cada uma e que a mais nova passou do limite do tenant
-- (settings.stale_message_max_age_hours, padrão 6 h; a mesma regra de turnStaleMessages no CORE).
-- Sem horário de envio, nunca há prova: o turno segue o caminho normal.
--
-- magia_turn_terminal_evidence é a definição publicada em produção, com um único acréscimo: a prova de mensagem
-- antiga, só para o desfecho 'done'. Reaplicável.
-- Rollback: supabase/migrations_pending_review/033_stale_turn_terminal_evidence_rollback.sql

begin;

create or replace function public.magia_turn_stale_evidence(p_tenant uuid, p_chat text, p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  q public.conversation_turn_queue%rowtype;
  configured text;
  limit_hours numeric := 6;
  total integer;
  proven integer;
  newest timestamptz;
  ids jsonb;
begin
  select * into q from public.conversation_turn_queue
  where tenant_id = p_tenant and channel_type = 'whatsapp' and chat_id = p_chat;
  if not found or p_token is null or q.token is distinct from p_token
    or jsonb_array_length(coalesce(q.claimed, '[]'::jsonb)) = 0 then
    return null;
  end if;

  select s.settings->>'stale_message_max_age_hours' into configured
  from public.tenant_settings s where s.tenant_id = p_tenant;
  if configured ~ '^[0-9]+(\.[0-9]+)?$' and configured::numeric > 0 then limit_hours := configured::numeric; end if;

  select count(*),
         count(*) filter (where c.id is not null and f.external_message_id is not null
           and (c.raw_payload->>'message_timestamp') ~ '^[0-9]{9,12}$'),
         max(to_timestamp((c.raw_payload->>'message_timestamp')::bigint))
           filter (where (c.raw_payload->>'message_timestamp') ~ '^[0-9]{9,12}$'),
         jsonb_agg(m->>'event_id')
    into total, proven, newest, ids
  from jsonb_array_elements(q.claimed) m
  left join public.channel_events c
    on c.id::text = m->>'event_id' and c.tenant_id = p_tenant and c.channel_type = 'whatsapp'
   and c.external_conversation_id = p_chat and c.direction = 'inbound' and c.external_message_id = m->>'id'
  left join public.conversation_turn_ingress_facts f
    on f.tenant_id = p_tenant and f.chat_id = p_chat and f.external_message_id = m->>'id' and not f.from_me;

  if total = 0 or proven <> total or newest is null then return null; end if;
  if newest > clock_timestamp() - make_interval(secs => (limit_hours * 3600)::double precision) then return null; end if;

  return jsonb_build_object('kind', 'stale_message', 'newest_sent_at', newest, 'limit_hours', limit_hours,
    'claimed_event_ids', ids);
end
$$;
revoke all on function public.magia_turn_stale_evidence(uuid, text, uuid) from public, anon, authenticated;

create or replace function public.magia_turn_terminal_evidence(p_tenant uuid, p_chat text, p_token uuid, p_outcome text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare q public.conversation_turn_queue%rowtype; proof jsonb; authority jsonb; kind text; ids jsonb;
begin
  proof:=public.magia_turn_control_evidence(p_tenant,p_chat,p_token,p_outcome);
  if proof is null then return null; end if;
  if proof->>'kind'<>'unproven' then return proof; end if;
  select * into q from public.conversation_turn_queue where tenant_id=p_tenant
    and channel_type='whatsapp' and chat_id=p_chat for update;
  select jsonb_agg(m->>'event_id') into ids from jsonb_array_elements(q.claimed) m;
  authority:=public.magia_turn_suppression_status(p_tenant,p_chat,p_token)->'evidence';
  foreach kind in array case when p_outcome='done' then
    array['ai_disabled','lead_locked','contact_excluded','owner_saved_contact','commercial_contact','non_customer','silent_ack']
    else array['lead_locked','ai_disabled'] end loop
    if authority ? kind then return jsonb_build_object('kind',kind,'authority',authority->kind,'claimed_event_ids',ids); end if;
  end loop;
  -- 033: mensagem entregue com muito atraso, comprovada pelo banco (ver magia_turn_stale_evidence).
  if p_outcome='done' then
    proof:=public.magia_turn_stale_evidence(p_tenant,p_chat,p_token);
    if proof is not null then return proof; end if;
  end if;
  return null;
end $function$;

commit;

notify pgrst, 'reload schema';

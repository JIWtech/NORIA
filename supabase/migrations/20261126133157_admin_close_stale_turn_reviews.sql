-- Encerramento em lote de conversas travadas em revisão que a equipe já atendeu por fora (Frente 3, 26/11/2026).
-- APLICADA em produção em 26/11/2026 com autorização do responsável (versão registrada 20261126133157) e executada no mesmo dia:
-- 94 conversas encerradas (Núbia 33, Gênesis 61); as outras 114 seguem abertas para a equipe.
-- Rollback: supabase/migrations_pending_review/20261126133157_admin_close_stale_turn_reviews.rollback.sql
--
-- Contexto: 94 conversas (33 da Núbia, 61 da Gênesis) estão em phase='review' desde outubro, com chamado aberto, e a equipe
-- respondeu por último em todas. A RPC do painel (magia_resolve_turn_review) recusa essas conversas com STALE_TURN_REVIEW,
-- porque o queue_snapshot do chamado não bate mais com a fila.
--
-- A função reaplica, conversa a conversa e com a linha da fila travada, os MESMOS critérios da classificação "segura":
--   phase='review', token presente, sem entrega em andamento nem tentativa de entrega do lote, um único chamado aberto, e
--   a última mensagem da equipe (sender_type='agent', mesmo tenant e conversa) depois do início da revisão e não anterior
--   à última mensagem da cliente.
-- Efeito por conversa (o mesmo do 'close_with_evidence' da RPC oficial): recibo terminal 'cancelled' com o lote travado e as
-- pendentes anteriores à resposta da equipe; fila volta para 'ready' só com as pendentes posteriores (nenhuma, pelo critério);
-- o gatilho magia_track_turn_review resolve o chamado e esta função registra motivo, nota e evidência nele.
-- A IA não responde mensagens antigas: as pendentes antigas saem da fila, e a conversa segue com a equipe (a última
-- mensagem é humana, então a trava humana continua valendo).
-- Por padrão só simula (p_dry_run=true). Só o service_role executa.
create or replace function public.magia_admin_close_stale_turn_reviews(p_tenant uuid, p_chats text[], p_note text, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  chat text; q public.conversation_turn_queue%rowtype; ticket_id uuid; open_tickets int;
  agent_id uuid; agent_at timestamptz; last_inbound timestamptz; evidence jsonb; before_p jsonb; after_p jsonb;
  closed jsonb := '[]'::jsonb; skipped jsonb := '[]'::jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'ADMIN_CLOSE_FORBIDDEN'; end if;
  if p_tenant is null or p_chats is null or cardinality(p_chats) = 0 or cardinality(p_chats) > 500 then raise exception 'ADMIN_CLOSE_INVALID_INPUT'; end if;
  if nullif(btrim(p_note), '') is null then raise exception 'ADMIN_CLOSE_NOTE_REQUIRED'; end if;
  for chat in select distinct x from unnest(p_chats) x where nullif(btrim(x), '') is not null loop
    select * into q from public.conversation_turn_queue where tenant_id = p_tenant and channel_type = 'whatsapp' and chat_id = chat for update;
    if not found then skipped := skipped || jsonb_build_object('chat_id', chat, 'reason', 'QUEUE_NOT_FOUND'); continue; end if;
    if q.phase <> 'review' or q.token is null then skipped := skipped || jsonb_build_object('chat_id', chat, 'reason', 'NOT_IN_REVIEW'); continue; end if;
    if q.current_delivery_id is not null or exists(select 1 from public.conversation_turn_delivery_attempts a
      where a.tenant_id = p_tenant and a.channel_type = 'whatsapp' and a.chat_id = chat
        and (a.turn_token = q.token or exists(select 1 from jsonb_array_elements(coalesce(q.claimed, '[]'::jsonb)) m where a.claimed_event_ids ? (m->>'event_id')))) then
      skipped := skipped || jsonb_build_object('chat_id', chat, 'reason', 'DELIVERY_RECONCILIATION_REQUIRED'); continue;
    end if;
    if exists(select 1 from public.conversation_turn_terminal_receipts r where r.turn_token = q.token) then
      skipped := skipped || jsonb_build_object('chat_id', chat, 'reason', 'RECEIPT_ALREADY_EXISTS'); continue;
    end if;
    select count(*), min(k.id::text)::uuid into open_tickets, ticket_id from public.conversation_turn_review_tickets k
      where k.tenant_id = p_tenant and k.channel_type = 'whatsapp' and k.chat_id = chat and k.resolved_at is null;
    if open_tickets <> 1 then skipped := skipped || jsonb_build_object('chat_id', chat, 'reason', 'OPEN_TICKET_COUNT_' || open_tickets); continue; end if;
    select e.id, e.created_at into agent_id, agent_at from public.channel_events e
      where e.tenant_id = p_tenant and e.channel_type = 'whatsapp' and e.external_conversation_id = chat and e.direction = 'outbound' and e.sender_type = 'agent'
      order by e.created_at desc, e.id desc limit 1;
    select max(e.created_at) into last_inbound from public.channel_events e
      where e.tenant_id = p_tenant and e.channel_type = 'whatsapp' and e.external_conversation_id = chat and e.direction = 'inbound';
    if agent_at is null or q.review_required_at is null or agent_at <= q.review_required_at or (last_inbound is not null and agent_at < last_inbound) then
      skipped := skipped || jsonb_build_object('chat_id', chat, 'reason', 'TEAM_DID_NOT_REPLY_LAST'); continue;
    end if;
    evidence := jsonb_build_object('kind', 'admin_stale_review_closure', 'agent_event_id', agent_id, 'agent_at', agent_at,
      'last_inbound_at', last_inbound, 'review_required_at', q.review_required_at, 'note', p_note);
    if not p_dry_run then
      select coalesce(jsonb_agg(x.m order by x.ord) filter (where x.stale), '[]'::jsonb),
             coalesce(jsonb_agg(x.m order by x.ord) filter (where not x.stale), '[]'::jsonb)
        into before_p, after_p
        from (select m, ord, exists(select 1 from public.channel_events c where c.id::text = m->>'event_id' and c.tenant_id = p_tenant and c.created_at <= agent_at) as stale
              from jsonb_array_elements(coalesce(q.pending, '[]'::jsonb)) with ordinality as t(m, ord)) x;
      insert into public.conversation_turn_terminal_receipts(turn_token, tenant_id, chat_id, outcome, claimed, evidence)
        values(q.token, p_tenant, chat, 'cancelled', coalesce(q.claimed, '[]'::jsonb) || before_p, evidence);
      update public.conversation_turn_queue set phase = 'ready', claimed = '[]', pending = after_p, token = null, lease_until = null, current_delivery_id = null,
        retry_batch_id = null, attempt_count = 0, retry_max_attempts = null, retry_base_seconds = null, retry_cap_seconds = null,
        next_attempt_at = null, last_error_code = null, review_required_at = null, updated_at = clock_timestamp()
        where tenant_id = p_tenant and channel_type = 'whatsapp' and chat_id = chat;
      -- O gatilho já resolveu o chamado ('queue_finalized'); aqui fica o motivo real, a nota e a fila de antes.
      update public.conversation_turn_review_tickets set resolution = 'admin_closed_stale', resolution_note = p_note,
        resolution_evidence = evidence, resolution_snapshot = to_jsonb(q), resolved_at = coalesce(resolved_at, clock_timestamp()),
        notification_pending = false, updated_at = clock_timestamp()
        where id = ticket_id;
    end if;
    closed := closed || jsonb_build_object('chat_id', chat, 'ticket_id', ticket_id, 'pending_dropped', jsonb_array_length(coalesce(q.pending, '[]'::jsonb)));
  end loop;
  return jsonb_build_object('dry_run', p_dry_run, 'closed', jsonb_array_length(closed), 'skipped', jsonb_array_length(skipped),
    'closed_chats', closed, 'skipped_chats', skipped);
end $function$;

revoke all on function public.magia_admin_close_stale_turn_reviews(uuid, text[], text, boolean) from public, anon, authenticated;
grant execute on function public.magia_admin_close_stale_turn_reviews(uuid, text[], text, boolean) to service_role;

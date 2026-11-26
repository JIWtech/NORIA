-- Rollback de 20261126_admin_close_stale_turn_reviews.
-- 1) Desfaz os encerramentos feitos pela função (se ela foi executada com p_dry_run=false): devolve cada fila ao estado
--    guardado em resolution_snapshot, reabre o chamado e apaga o recibo terminal criado. Só toca chamados com
--    resolution='admin_closed_stale' e filas que continuam em 'ready' sem lote travado (nada aconteceu depois).
-- 2) Remove a função.
do $rollback$
declare k record; s jsonb;
begin
  for k in select * from public.conversation_turn_review_tickets where resolution = 'admin_closed_stale' loop
    s := k.resolution_snapshot;
    if exists(select 1 from public.conversation_turn_queue q where q.tenant_id = k.tenant_id and q.channel_type = 'whatsapp' and q.chat_id = k.chat_id
      and q.phase = 'ready' and q.token is null and jsonb_array_length(coalesce(q.claimed, '[]'::jsonb)) = 0) then
      delete from public.conversation_turn_terminal_receipts where turn_token = (s->>'token')::uuid and tenant_id = k.tenant_id and chat_id = k.chat_id
        and evidence->>'kind' = 'admin_stale_review_closure';
      -- Reabrir o chamado antes de devolver a fila, para o gatilho reutilizar este chamado em vez de criar outro.
      update public.conversation_turn_review_tickets set resolved_at = null, resolved_by = null, resolution = null, resolution_note = null,
        resolution_evidence = null, resolution_snapshot = null, updated_at = clock_timestamp() where id = k.id;
      update public.conversation_turn_queue set phase = s->>'phase', claimed = s->'claimed', pending = s->'pending', token = (s->>'token')::uuid,
        lease_until = (s->>'lease_until')::timestamptz, retry_batch_id = (s->>'retry_batch_id')::uuid, attempt_count = coalesce((s->>'attempt_count')::int, 0),
        retry_max_attempts = (s->>'retry_max_attempts')::int, retry_base_seconds = (s->>'retry_base_seconds')::int, retry_cap_seconds = (s->>'retry_cap_seconds')::int,
        next_attempt_at = (s->>'next_attempt_at')::timestamptz, last_error_code = s->>'last_error_code', review_required_at = (s->>'review_required_at')::timestamptz,
        updated_at = clock_timestamp()
        where tenant_id = k.tenant_id and channel_type = 'whatsapp' and chat_id = k.chat_id;
    end if;
  end loop;
end $rollback$;

drop function if exists public.magia_admin_close_stale_turn_reviews(uuid, text[], text, boolean);

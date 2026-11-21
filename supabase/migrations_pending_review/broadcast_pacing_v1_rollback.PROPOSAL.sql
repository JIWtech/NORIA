-- Reverter somente após restaurar o worker anterior e encerrar suas execuções.
-- A remoção da tabela perde as reservas: aguardar pelo menos o maior intervalo configurado
-- desde o último envio antes de retomar o worker antigo.
begin;
drop function if exists public.broadcast_begin_send_paced(uuid, uuid, numeric);
drop function if exists public.broadcast_requeue_recipient_paced(uuid, uuid, text, numeric);
create or replace function public.broadcast_schedule_next(p_campaign_id uuid, p_lease_token uuid, p_delay_seconds numeric)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_now timestamptz := clock_timestamp(); v_next timestamptz;
begin
  update public.broadcast_campaigns
  set next_send_at = v_now + make_interval(secs => greatest(0, least(coalesce(p_delay_seconds, 0), 86400))::double precision),
      updated_at = v_now
  where id = p_campaign_id and lease_token = p_lease_token and p_lease_token is not null
  returning next_send_at into v_next;
  if not found then return jsonb_build_object('ok', false, 'reason', 'lease_lost'); end if;
  return jsonb_build_object('ok', true, 'next_send_at', v_next, 'db_now', v_now);
end $$;
drop table if exists public.broadcast_channel_pacing;
notify pgrst, 'reload schema';
commit;

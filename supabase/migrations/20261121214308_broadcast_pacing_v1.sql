-- Cadência entre campanhas do mesmo tenant e canal. Aplicada em produção em 2026-11-21 com autorização do
-- responsável (versão 20261121214308), sem disparos em andamento. Compatível com o worker anterior; o worker
-- novo (RPCs *_paced) só depois desta migração. Rollback: migrations_pending_review/20261121214308_broadcast_pacing_v1.rollback.sql
begin;
create table public.broadcast_channel_pacing (
  tenant_id uuid not null references public.tenants(id),
  channel_type text not null,
  next_send_at timestamptz not null,
  pending_campaign_id uuid references public.broadcast_campaigns(id),
  pending_recipient_id uuid references public.broadcast_campaign_recipients(id),
  primary key (tenant_id, channel_type)
);
alter table public.broadcast_channel_pacing enable row level security;
revoke all on public.broadcast_channel_pacing from public, anon, authenticated;
grant all on public.broadcast_channel_pacing to service_role;
insert into public.broadcast_channel_pacing(tenant_id, channel_type, next_send_at)
select tenant_id, channel_type, max(next_send_at) from public.broadcast_campaigns
where next_send_at > clock_timestamp() group by tenant_id, channel_type;

create function public.broadcast_begin_send_paced(p_recipient_id uuid, p_lease_token uuid, p_delay_seconds numeric)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.broadcast_campaign_recipients%rowtype; c public.broadcast_campaigns%rowtype;
  v_now timestamptz; v_next timestamptz; v_pending uuid; v_result text; v_delay numeric;
begin
  select * into r from public.broadcast_campaign_recipients where id = p_recipient_id;
  if not found then return 'lease_lost'; end if;
  select * into c from public.broadcast_campaigns where id = r.campaign_id and tenant_id = r.tenant_id for update;
  if not found or c.lease_token is distinct from p_lease_token or p_lease_token is null
    or c.locked_until <= clock_timestamp() or c.locked_until is null or c.channel_type <> r.channel_type then
    return 'lease_lost';
  end if;
  insert into public.broadcast_channel_pacing(tenant_id, channel_type, next_send_at)
    values (r.tenant_id, r.channel_type, '-infinity') on conflict do nothing;
  select next_send_at, pending_recipient_id into v_next, v_pending from public.broadcast_channel_pacing
    where tenant_id = r.tenant_id and channel_type = r.channel_type for update;
  v_now := clock_timestamp();
  if v_pending is not null or v_next > v_now then
    v_next := greatest(v_next, case when v_pending is not null then v_now + interval '1 minute' else v_next end);
    update public.broadcast_campaigns set next_send_at = greatest(coalesce(next_send_at, v_next), v_next)
      where id = c.id and lease_token = p_lease_token;
    return case when v_pending is not null then 'pending_review' else 'paced' end;
  end if;
  v_result := public.broadcast_begin_send(p_recipient_id, p_lease_token);
  if v_result <> 'sending' then return v_result; end if;
  v_delay := greatest(2460, least(coalesce(p_delay_seconds, 2460), 86400),
    coalesce((public.broadcast_protection_settings(r.tenant_id)->>'min_interval_seconds')::numeric, 2460));
  update public.broadcast_channel_pacing set next_send_at = v_now + make_interval(secs => v_delay::double precision),
    pending_campaign_id = c.id, pending_recipient_id = r.id
    where tenant_id = r.tenant_id and channel_type = r.channel_type;
  return 'sending';
end $$;
revoke all on function public.broadcast_begin_send_paced(uuid, uuid, numeric) from public, anon, authenticated;
grant execute on function public.broadcast_begin_send_paced(uuid, uuid, numeric) to service_role;

-- Rejeições de canal comprovadas são reenfileiradas junto com a liberação e o novo intervalo.
create function public.broadcast_requeue_recipient_paced(p_recipient_id uuid, p_lease_token uuid, p_reason text, p_delay_seconds numeric)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.broadcast_campaign_recipients%rowtype; c public.broadcast_campaigns%rowtype; v_now timestamptz; v_delay numeric; v_next timestamptz;
begin
  if p_reason is null or p_reason not in ('provider_rejected_http_401', 'provider_rejected_http_403', 'provider_rejected_http_404', 'provider_rejected_http_429') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_rejection');
  end if;
  select * into r from public.broadcast_campaign_recipients where id=p_recipient_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'recipient_missing'); end if;
  select * into c from public.broadcast_campaigns where id=r.campaign_id and tenant_id=r.tenant_id and lease_token=p_lease_token and p_lease_token is not null for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'lease_lost'); end if;
  perform 1 from public.broadcast_channel_pacing where tenant_id=r.tenant_id and channel_type=r.channel_type
    and pending_recipient_id=r.id and pending_campaign_id=c.id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'reservation_missing'); end if;
  if not public.broadcast_requeue_recipient(p_recipient_id, p_lease_token, p_reason) then
    return jsonb_build_object('ok', false, 'reason', 'recipient_lease_lost');
  end if;
  v_now := clock_timestamp();
  v_delay := greatest(2460, least(coalesce(p_delay_seconds, 2460), 86400),
    coalesce((public.broadcast_protection_settings(r.tenant_id)->>'min_interval_seconds')::numeric, 2460));
  update public.broadcast_channel_pacing set next_send_at=greatest(next_send_at,v_now+make_interval(secs => v_delay::double precision)),
    pending_campaign_id=null, pending_recipient_id=null where tenant_id=r.tenant_id and channel_type=r.channel_type returning next_send_at into v_next;
  update public.broadcast_campaigns set next_send_at=v_next, updated_at=v_now where id=c.id;
  return jsonb_build_object('ok', true, 'next_send_at', v_next, 'db_now', v_now);
end $$;
revoke all on function public.broadcast_requeue_recipient_paced(uuid, uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.broadcast_requeue_recipient_paced(uuid, uuid, text, numeric) to service_role;

-- Reforça a reserva a partir da confirmação, sem jamais encurtá-la.
create or replace function public.broadcast_schedule_next(p_campaign_id uuid, p_lease_token uuid, p_delay_seconds numeric)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.broadcast_campaigns%rowtype; v_now timestamptz; v_next timestamptz; v_delay numeric;
begin
  select * into c from public.broadcast_campaigns where id = p_campaign_id and lease_token = p_lease_token
    and p_lease_token is not null for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'lease_lost'); end if;
  insert into public.broadcast_channel_pacing(tenant_id, channel_type, next_send_at)
    values (c.tenant_id, c.channel_type, '-infinity') on conflict do nothing;
  perform 1 from public.broadcast_channel_pacing where tenant_id = c.tenant_id and channel_type = c.channel_type for update;
  if exists (select 1 from public.broadcast_channel_pacing where tenant_id = c.tenant_id and channel_type = c.channel_type
    and pending_campaign_id is not null and pending_campaign_id <> c.id) then
    return jsonb_build_object('ok', false, 'reason', 'other_campaign_pending');
  end if;
  if exists (select 1 from public.broadcast_channel_pacing p join public.broadcast_campaign_recipients r
    on r.id = p.pending_recipient_id and r.tenant_id = p.tenant_id and r.campaign_id = c.id
    where p.tenant_id = c.tenant_id and p.channel_type = c.channel_type and r.status not in ('sent', 'failed')) then
    return jsonb_build_object('ok', false, 'reason', 'delivery_unresolved');
  end if;
  v_now := clock_timestamp();
  v_delay := greatest(2460, least(coalesce(p_delay_seconds, 2460), 86400),
    coalesce((public.broadcast_protection_settings(c.tenant_id)->>'min_interval_seconds')::numeric, 2460));
  update public.broadcast_channel_pacing set next_send_at = greatest(next_send_at, v_now + make_interval(secs => v_delay::double precision)),
    pending_campaign_id = null, pending_recipient_id = null
    where tenant_id = c.tenant_id and channel_type = c.channel_type returning next_send_at into v_next;
  update public.broadcast_campaigns set next_send_at = v_next, updated_at = v_now where id = c.id;
  return jsonb_build_object('ok', true, 'next_send_at', v_next, 'db_now', v_now);
end $$;
notify pgrst, 'reload schema';
commit;

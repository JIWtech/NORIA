-- Disparos executados pelo servidor (n8n), não pelo navegador.
--
-- O painel só cria a campanha (draft + destinatários) e a enfileira por broadcast_enqueue_campaign, que
-- registra consentimento, autor e horário com o relógio do banco. O worker do n8n reivindica campanhas
-- vencidas com lease (uma por tenant por vez, para o número não receber duas cadências), envia um
-- destinatário por vez e agenda o próximo envio também pelo relógio do banco.
--
-- Campanhas antigas sem scheduled_at (criadas pelo fluxo do navegador) NUNCA são pegas pelo worker.

begin;

alter table public.broadcast_campaigns
  add column if not exists scheduled_at timestamptz,
  add column if not exists next_send_at timestamptz;

create index if not exists broadcast_campaigns_due_idx
  on public.broadcast_campaigns (scheduled_at)
  where status in ('queued', 'scheduled', 'sending');

-- Membro ativo do tenant com papel que pode operar disparos.
create or replace function public.broadcast_assert_operator(p_tenant_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
      and tm.role in ('owner', 'admin', 'manager', 'agent')
  ) then
    raise exception 'BROADCAST_FORBIDDEN' using errcode = '42501';
  end if;
end $$;

-- Painel: enfileira uma campanha em rascunho. p_scheduled_at nulo = agora (relógio do banco).
create or replace function public.broadcast_enqueue_campaign(
  p_campaign_id uuid,
  p_scheduled_at timestamptz default null,
  p_consent_confirmed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_campaign public.broadcast_campaigns%rowtype;
  v_now timestamptz := clock_timestamp();
  v_at timestamptz;
  v_recipients integer;
begin
  select * into v_campaign from public.broadcast_campaigns where id = p_campaign_id for update;
  if not found then raise exception 'BROADCAST_NOT_FOUND' using errcode = 'P0002'; end if;
  perform public.broadcast_assert_operator(v_campaign.tenant_id);
  if p_consent_confirmed is not true then raise exception 'BROADCAST_CONSENT_REQUIRED' using errcode = '22023'; end if;
  if v_campaign.status <> 'draft' then raise exception 'BROADCAST_NOT_DRAFT' using errcode = '55000'; end if;

  select count(*) into v_recipients from public.broadcast_campaign_recipients
  where campaign_id = p_campaign_id and tenant_id = v_campaign.tenant_id and status = 'queued';
  if v_recipients = 0 then raise exception 'BROADCAST_NO_RECIPIENTS' using errcode = '22023'; end if;

  v_at := greatest(coalesce(p_scheduled_at, v_now), v_now);
  update public.broadcast_campaigns
  set status = case when v_at > v_now then 'scheduled' else 'queued' end,
      scheduled_at = v_at,
      next_send_at = null,
      total_recipients = v_recipients,
      consent_confirmed_at = v_now,
      consent_confirmed_by = auth.uid(),
      updated_at = v_now
  where id = p_campaign_id;

  return jsonb_build_object('ok', true, 'campaign_id', p_campaign_id,
    'status', case when v_at > v_now then 'scheduled' else 'queued' end, 'scheduled_at', v_at);
end $$;

-- Painel: pausar, retomar ou cancelar. Nunca toca em destinatários já enviados ou em envio.
create or replace function public.broadcast_control_campaign(p_campaign_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_campaign public.broadcast_campaigns%rowtype;
  v_now timestamptz := clock_timestamp();
  v_cancelled integer := 0;
begin
  select * into v_campaign from public.broadcast_campaigns where id = p_campaign_id for update;
  if not found then raise exception 'BROADCAST_NOT_FOUND' using errcode = 'P0002'; end if;
  perform public.broadcast_assert_operator(v_campaign.tenant_id);

  if p_action = 'pause' then
    if v_campaign.status not in ('queued', 'scheduled', 'sending') then raise exception 'BROADCAST_INVALID_TRANSITION' using errcode = '55000'; end if;
    update public.broadcast_campaigns set status = 'paused', updated_at = v_now where id = p_campaign_id;
  elsif p_action = 'resume' then
    if v_campaign.status <> 'paused' or v_campaign.scheduled_at is null then raise exception 'BROADCAST_INVALID_TRANSITION' using errcode = '55000'; end if;
    update public.broadcast_campaigns
    set status = case when v_campaign.scheduled_at > v_now then 'scheduled' else 'queued' end,
        last_error = null, updated_at = v_now
    where id = p_campaign_id;
  elsif p_action = 'cancel' then
    if v_campaign.status in ('sent', 'cancelled') then raise exception 'BROADCAST_INVALID_TRANSITION' using errcode = '55000'; end if;
    update public.broadcast_campaigns set status = 'cancelled', updated_at = v_now where id = p_campaign_id;
    with cancelled as (
      update public.broadcast_campaign_recipients
      set status = 'cancelled', lease_token = null, locked_until = null
      where campaign_id = p_campaign_id and tenant_id = v_campaign.tenant_id and status in ('queued', 'claimed')
      returning id
    )
    select count(*) into v_cancelled from cancelled;
  else
    raise exception 'BROADCAST_INVALID_ACTION' using errcode = '22023';
  end if;

  return jsonb_build_object('ok', true, 'campaign_id', p_campaign_id, 'action', p_action, 'cancelled_recipients', v_cancelled);
end $$;

-- Worker: reivindica campanhas vencidas com lease. No máximo uma campanha ativa por tenant.
create or replace function public.broadcast_claim_due_campaigns(
  p_lease_token uuid,
  p_limit integer default 5,
  p_lease_seconds integer default 120
)
returns table (
  id uuid,
  tenant_id uuid,
  tenant_slug text,
  channel_type text,
  name text,
  message_text text,
  next_send_at timestamptz,
  db_now timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_expiry timestamptz := clock_timestamp() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 120), 600)));
  v_claimed uuid[] := '{}';
  v_tenants uuid[] := '{}';
  v_candidate record;
begin
  if p_lease_token is null then return; end if;

  for v_candidate in
    select c.id, c.tenant_id
    from public.broadcast_campaigns c
    join public.tenants t on t.id = c.tenant_id and t.status = 'active' and t.deleted_at is null
    where c.status in ('queued', 'scheduled', 'sending')
      and c.scheduled_at is not null
      and c.scheduled_at <= v_now
      and c.consent_confirmed_at is not null
      and (c.next_send_at is null or c.next_send_at <= v_now)
      and (c.locked_until is null or c.locked_until <= v_now)
    order by c.scheduled_at, c.created_at
  loop
    exit when coalesce(array_length(v_claimed, 1), 0) >= greatest(1, least(coalesce(p_limit, 5), 20));
    continue when v_candidate.tenant_id = any(v_tenants);
    -- Outra campanha do mesmo tenant com lease válida: o número já está em cadência.
    continue when exists (
      select 1 from public.broadcast_campaigns o
      where o.tenant_id = v_candidate.tenant_id and o.id <> v_candidate.id and o.locked_until > v_now);

    update public.broadcast_campaigns c
    set lease_token = p_lease_token,
        locked_until = v_expiry,
        status = 'sending',
        started_at = coalesce(c.started_at, v_now),
        updated_at = v_now
    where c.id = (
      select x.id from public.broadcast_campaigns x
      where x.id = v_candidate.id
        and x.status in ('queued', 'scheduled', 'sending')
        and (x.locked_until is null or x.locked_until <= v_now)
      for update skip locked
    );
    if found then
      v_claimed := v_claimed || v_candidate.id;
      v_tenants := v_tenants || v_candidate.tenant_id;
    end if;
  end loop;

  return query
  select c.id, c.tenant_id, t.slug, c.channel_type, c.name, c.message_text, c.next_send_at, v_now
  from public.broadcast_campaigns c
  join public.tenants t on t.id = c.tenant_id
  where c.id = any(v_claimed)
  order by c.scheduled_at, c.created_at;
end $$;

-- Worker: agenda o próximo envio da campanha pelo relógio do banco.
create or replace function public.broadcast_schedule_next(
  p_campaign_id uuid,
  p_lease_token uuid,
  p_delay_seconds numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_next timestamptz;
begin
  update public.broadcast_campaigns
  set next_send_at = v_now + make_interval(secs => greatest(0, least(coalesce(p_delay_seconds, 0), 86400))::double precision),
      updated_at = v_now
  where id = p_campaign_id and lease_token = p_lease_token and p_lease_token is not null
  returning next_send_at into v_next;
  if not found then return jsonb_build_object('ok', false, 'reason', 'lease_lost'); end if;
  return jsonb_build_object('ok', true, 'next_send_at', v_next, 'db_now', v_now);
end $$;

-- Worker: libera a lease. Pausa quando pedido; finaliza quando não há mais pendentes.
create or replace function public.broadcast_release_campaign(
  p_campaign_id uuid,
  p_lease_token uuid,
  p_pause_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_campaign public.broadcast_campaigns%rowtype;
  v_pending integer;
  v_sent integer;
  v_failed integer;
  v_unknown integer;
  v_total integer;
  v_status text;
begin
  select * into v_campaign from public.broadcast_campaigns
  where id = p_campaign_id and lease_token = p_lease_token and p_lease_token is not null
  for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'lease_lost'); end if;

  select count(*) filter (where status in ('queued', 'claimed', 'sending')),
         count(*) filter (where status = 'sent'),
         count(*) filter (where status = 'failed'),
         count(*) filter (where status = 'unknown'),
         count(*)
  into v_pending, v_sent, v_failed, v_unknown, v_total
  from public.broadcast_campaign_recipients
  where campaign_id = p_campaign_id and tenant_id = v_campaign.tenant_id;

  v_status := v_campaign.status;
  if p_pause_reason is not null and v_status in ('queued', 'scheduled', 'sending') then
    v_status := 'paused';
  elsif v_pending = 0 and v_status in ('queued', 'scheduled', 'sending', 'partial_error') then
    v_status := case
      when v_failed + v_unknown = 0 then 'sent'
      when v_sent = 0 and v_unknown = 0 then 'failed'
      else 'partial_error'
    end;
  end if;

  update public.broadcast_campaigns
  set lease_token = null,
      locked_until = null,
      status = v_status,
      last_error = case when p_pause_reason is not null then left(p_pause_reason, 300) else last_error end,
      sent_count = v_sent,
      failed_count = v_failed,
      unknown_count = v_unknown,
      sent_at = case when v_pending = 0 and v_status in ('sent', 'partial_error', 'failed') then coalesce(sent_at, v_now) else sent_at end,
      updated_at = v_now
  where id = p_campaign_id;

  return jsonb_build_object('ok', true, 'status', v_status, 'pending', v_pending,
    'sent_count', v_sent, 'failed_count', v_failed, 'unknown_count', v_unknown, 'total', v_total);
end $$;

revoke all on function public.broadcast_assert_operator(uuid) from public, anon, authenticated;
revoke all on function public.broadcast_enqueue_campaign(uuid, timestamptz, boolean) from public, anon;
revoke all on function public.broadcast_control_campaign(uuid, text) from public, anon;
revoke all on function public.broadcast_claim_due_campaigns(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.broadcast_schedule_next(uuid, uuid, numeric) from public, anon, authenticated;
revoke all on function public.broadcast_release_campaign(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.broadcast_enqueue_campaign(uuid, timestamptz, boolean) to authenticated, service_role;
grant execute on function public.broadcast_control_campaign(uuid, text) to authenticated, service_role;
grant execute on function public.broadcast_claim_due_campaigns(uuid, integer, integer) to service_role;
grant execute on function public.broadcast_schedule_next(uuid, uuid, numeric) to service_role;
grant execute on function public.broadcast_release_campaign(uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';

commit;

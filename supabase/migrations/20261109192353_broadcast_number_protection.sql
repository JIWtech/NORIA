-- Proteção do número nos disparos.
--
-- A configuração é por tenant, em tenant_settings.settings.broadcast:
--   { "min_interval_seconds", "max_interval_seconds", "daily_limit", "campaign_limit", "max_consecutive_failures" }
-- broadcast_protection_settings é a única fonte dos padrões e pisos de segurança: valores ausentes ou
-- inválidos caem no padrão conservador; nenhum valor desliga a proteção.

begin;

create or replace function public.broadcast_protection_settings(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_raw jsonb;
  v_timezone text;
  v_min integer;
  v_max integer;
  v_daily integer;
  v_campaign integer;
  v_failures integer;
  v_num_pattern constant text := '^\d+(\.\d+)?$';
begin
  select coalesce(ts.settings -> 'broadcast', '{}'::jsonb), nullif(trim(ts.timezone), '')
  into v_raw, v_timezone
  from public.tenant_settings ts where ts.tenant_id = p_tenant_id;
  v_raw := coalesce(v_raw, '{}'::jsonb);

  v_min := case when (v_raw ->> 'min_interval_seconds') ~ v_num_pattern then floor((v_raw ->> 'min_interval_seconds')::numeric) end;
  v_max := case when (v_raw ->> 'max_interval_seconds') ~ v_num_pattern then floor((v_raw ->> 'max_interval_seconds')::numeric) end;
  v_daily := case when (v_raw ->> 'daily_limit') ~ v_num_pattern then floor((v_raw ->> 'daily_limit')::numeric) end;
  v_campaign := case when (v_raw ->> 'campaign_limit') ~ v_num_pattern then floor((v_raw ->> 'campaign_limit')::numeric) end;
  v_failures := case when (v_raw ->> 'max_consecutive_failures') ~ v_num_pattern then floor((v_raw ->> 'max_consecutive_failures')::numeric) end;

  -- Padrões conservadores e pisos de segurança.
  v_min := least(greatest(coalesce(v_min, 30), 10), 3600);
  v_max := least(greatest(coalesce(v_max, greatest(v_min, 90)), v_min), 7200);
  v_daily := least(greatest(coalesce(v_daily, 200), 1), 5000);
  v_campaign := least(greatest(coalesce(v_campaign, 500), 1), 5000);
  v_failures := least(greatest(coalesce(v_failures, 5), 1), 50);

  return jsonb_build_object(
    'min_interval_seconds', v_min,
    'max_interval_seconds', v_max,
    'daily_limit', v_daily,
    'campaign_limit', v_campaign,
    'max_consecutive_failures', v_failures,
    'timezone', coalesce(v_timezone, 'America/Sao_Paulo')
  );
end $$;

-- Enfileirar passa a respeitar o limite por campanha do tenant.
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
  v_limit integer;
begin
  select * into v_campaign from public.broadcast_campaigns where id = p_campaign_id for update;
  if not found then raise exception 'BROADCAST_NOT_FOUND' using errcode = 'P0002'; end if;
  perform public.broadcast_assert_operator(v_campaign.tenant_id);
  if p_consent_confirmed is not true then raise exception 'BROADCAST_CONSENT_REQUIRED' using errcode = '22023'; end if;
  if v_campaign.status <> 'draft' then raise exception 'BROADCAST_NOT_DRAFT' using errcode = '55000'; end if;

  select count(*) into v_recipients from public.broadcast_campaign_recipients
  where campaign_id = p_campaign_id and tenant_id = v_campaign.tenant_id and status = 'queued';
  if v_recipients = 0 then raise exception 'BROADCAST_NO_RECIPIENTS' using errcode = '22023'; end if;

  v_limit := (public.broadcast_protection_settings(v_campaign.tenant_id) ->> 'campaign_limit')::integer;
  if v_recipients > v_limit then
    raise exception 'BROADCAST_CAMPAIGN_LIMIT' using errcode = '22023', detail = format('limit=%s recipients=%s', v_limit, v_recipients);
  end if;

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

-- Cota diária do tenant (no fuso do tenant). Esgotada, a campanha espera o início do próximo dia.
create or replace function public.broadcast_daily_quota(p_campaign_id uuid, p_lease_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_campaign public.broadcast_campaigns%rowtype;
  v_settings jsonb;
  v_tz text;
  v_day_start timestamptz;
  v_used integer;
  v_limit integer;
  v_resume timestamptz;
begin
  select * into v_campaign from public.broadcast_campaigns
  where id = p_campaign_id and lease_token = p_lease_token and p_lease_token is not null;
  if not found then return jsonb_build_object('ok', false, 'reason', 'lease_lost'); end if;

  v_settings := public.broadcast_protection_settings(v_campaign.tenant_id);
  v_tz := v_settings ->> 'timezone';
  begin
    v_day_start := date_trunc('day', clock_timestamp() at time zone v_tz) at time zone v_tz;
  exception when others then
    v_tz := 'America/Sao_Paulo';
    v_day_start := date_trunc('day', clock_timestamp() at time zone v_tz) at time zone v_tz;
  end;
  v_resume := (date_trunc('day', clock_timestamp() at time zone v_tz) + interval '1 day') at time zone v_tz;
  v_limit := (v_settings ->> 'daily_limit')::integer;

  select count(*) into v_used
  from public.broadcast_campaign_recipients r
  where r.tenant_id = v_campaign.tenant_id
    and r.last_attempt_at >= v_day_start
    and r.status in ('sending', 'sent', 'unknown', 'failed');

  if v_used >= v_limit then
    update public.broadcast_campaigns set next_send_at = v_resume, updated_at = clock_timestamp()
    where id = p_campaign_id and lease_token = p_lease_token;
  end if;

  return jsonb_build_object('ok', true, 'used', v_used, 'limit', v_limit,
    'remaining', greatest(v_limit - v_used, 0), 'resume_at', v_resume);
end $$;

-- Tentativas seguidas sem sucesso do tenant (a mais recente primeiro, até o último envio confirmado).
create or replace function public.broadcast_consecutive_failures(p_tenant_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::integer
  from (
    select r.status,
           count(*) filter (where r.status = 'sent') over (order by r.last_attempt_at desc, r.id rows unbounded preceding) as sent_seen
    from public.broadcast_campaign_recipients r
    where r.tenant_id = p_tenant_id
      and r.status in ('sent', 'failed', 'unknown')
      and r.last_attempt_at is not null
    order by r.last_attempt_at desc, r.id
    limit 100
  ) recent
  where recent.sent_seen = 0;
$$;

-- Recusa definitiva do provedor antes da entrega que não é culpa do destinatário (credencial, instância,
-- limite do provedor): o destinatário volta para a fila, sem perder a vez.
create or replace function public.broadcast_requeue_recipient(p_recipient_id uuid, p_lease_token uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows integer;
begin
  update public.broadcast_campaign_recipients
  set status = 'queued', lease_token = null, locked_until = null, error = left(p_reason, 300)
  where id = p_recipient_id
    and p_lease_token is not null
    and lease_token = p_lease_token
    and status = 'sending';
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end $$;

revoke all on function public.broadcast_protection_settings(uuid) from public, anon, authenticated;
revoke all on function public.broadcast_daily_quota(uuid, uuid) from public, anon, authenticated;
revoke all on function public.broadcast_consecutive_failures(uuid) from public, anon, authenticated;
revoke all on function public.broadcast_requeue_recipient(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.broadcast_protection_settings(uuid) to service_role;
grant execute on function public.broadcast_daily_quota(uuid, uuid) to service_role;
grant execute on function public.broadcast_consecutive_failures(uuid) to service_role;
grant execute on function public.broadcast_requeue_recipient(uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';

commit;

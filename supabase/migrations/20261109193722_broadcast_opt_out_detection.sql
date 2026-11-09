-- Detecção do pedido de saída de quem recebeu disparo.
--
-- O worker do servidor reivindica respostas recebidas (channel_events inbound do contato) de quem recebeu
-- um disparo dentro da janela do tenant, pede ao Gemini uma decisão estruturada com evidências e, só com
-- evidência válida, registra noria_broadcast_opt_out_v1 em broadcast_register_opt_out. Nenhuma regex decide
-- intenção. Cada mensagem é analisada uma vez (broadcast_opt_out_reviews, com lease e novas tentativas).

begin;

-- Janela de análise passa a fazer parte da configuração de proteção do tenant.
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
  v_window integer;
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
  v_window := case when (v_raw ->> 'opt_out_window_days') ~ v_num_pattern then floor((v_raw ->> 'opt_out_window_days')::numeric) end;

  -- Padrões conservadores e pisos de segurança.
  v_min := least(greatest(coalesce(v_min, 30), 10), 3600);
  v_max := least(greatest(coalesce(v_max, greatest(v_min, 90)), v_min), 7200);
  v_daily := least(greatest(coalesce(v_daily, 200), 1), 5000);
  v_campaign := least(greatest(coalesce(v_campaign, 500), 1), 5000);
  v_failures := least(greatest(coalesce(v_failures, 5), 1), 50);
  v_window := least(greatest(coalesce(v_window, 7), 1), 60);

  return jsonb_build_object(
    'min_interval_seconds', v_min,
    'max_interval_seconds', v_max,
    'daily_limit', v_daily,
    'campaign_limit', v_campaign,
    'max_consecutive_failures', v_failures,
    'opt_out_window_days', v_window,
    'timezone', coalesce(v_timezone, 'America/Sao_Paulo')
  );
end $$;

create table if not exists public.broadcast_opt_out_reviews (
  event_id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  channel_type text not null,
  contact_key text not null,
  campaign_id uuid references public.broadcast_campaigns(id) on delete set null,
  status text not null check (status in ('claimed', 'deferred', 'done', 'failed')),
  attempts integer not null default 0,
  lease_token uuid,
  locked_until timestamptz,
  decision jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists broadcast_opt_out_reviews_tenant_idx
  on public.broadcast_opt_out_reviews (tenant_id, created_at desc);

-- Só o backend lê e escreve as revisões.
alter table public.broadcast_opt_out_reviews enable row level security;
revoke all on public.broadcast_opt_out_reviews from anon, authenticated;
grant all on public.broadcast_opt_out_reviews to service_role;

-- Reivindica respostas a analisar: inbound do contato, com texto, depois de um disparo enviado
-- a ele dentro da janela do tenant, contato ainda fora da lista e mensagem ainda não decidida.
create or replace function public.broadcast_claim_opt_out_reviews(
  p_lease_token uuid,
  p_limit integer default 10,
  p_lease_seconds integer default 120
)
returns table (
  event_id uuid,
  tenant_id uuid,
  tenant_slug text,
  channel_type text,
  external_conversation_id text,
  message_text text,
  campaign_id uuid,
  broadcast_message text,
  attempts integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_now timestamptz := clock_timestamp();
  v_expiry timestamptz := clock_timestamp() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 120), 600)));
  v_limit integer := greatest(1, least(coalesce(p_limit, 10), 50));
  v_count integer := 0;
  v_row record;
  v_attempts integer;
begin
  if p_lease_token is null then return; end if;

  for v_row in
    with sent as (
      select r.tenant_id, r.channel_type, r.campaign_id, r.external_conversation_id as recipient_external,
             public.broadcast_contact_key(r.external_conversation_id) as contact_key, r.sent_at,
             (public.broadcast_protection_settings(r.tenant_id) ->> 'opt_out_window_days')::integer as window_days
      from public.broadcast_campaign_recipients r
      where r.status = 'sent' and r.sent_at >= v_now - interval '60 days'
    )
    select distinct on (e.id)
      e.id as ev_id, e.tenant_id as ev_tenant, t.slug as ev_slug, e.channel_type as ev_channel,
      e.external_conversation_id as ev_external, e.message_text as ev_text, e.created_at as ev_at,
      s.campaign_id as ev_campaign, s.contact_key as ev_key, c.message_text as ev_broadcast
    from sent s
    join public.tenants t on t.id = s.tenant_id and t.status = 'active' and t.deleted_at is null
    join public.broadcast_campaigns c on c.id = s.campaign_id and c.tenant_id = s.tenant_id
    join public.channel_events e
      on e.tenant_id = s.tenant_id
     and e.channel_type = s.channel_type
     and e.external_conversation_id in (s.recipient_external, s.contact_key, s.contact_key || '@s.whatsapp.net')
     and e.created_at > s.sent_at
     and e.created_at <= s.sent_at + make_interval(days => s.window_days)
     and e.created_at >= v_now - interval '2 days'
    where e.direction = 'inbound'
      and e.sender_type = 'contact'
      and nullif(trim(coalesce(e.message_text, '')), '') is not null
      and not exists (
        select 1 from public.broadcast_opt_outs o
        where o.tenant_id = s.tenant_id and o.channel_type = s.channel_type and o.contact_key = s.contact_key)
      and not exists (
        select 1 from public.broadcast_opt_out_reviews v
        where v.event_id = e.id
          and (v.status in ('done', 'failed') or v.locked_until > v_now or v.attempts >= 5))
    order by e.id, s.sent_at desc
  loop
    exit when v_count >= v_limit;
    v_attempts := null;
    insert into public.broadcast_opt_out_reviews as rv
      (event_id, tenant_id, channel_type, contact_key, campaign_id, status, attempts, lease_token, locked_until)
    values (v_row.ev_id, v_row.ev_tenant, v_row.ev_channel, v_row.ev_key, v_row.ev_campaign, 'claimed', 1, p_lease_token, v_expiry)
    on conflict (event_id) do update
      set status = 'claimed', attempts = rv.attempts + 1, lease_token = p_lease_token, locked_until = v_expiry, updated_at = v_now
      where rv.status in ('claimed', 'deferred') and rv.locked_until <= v_now and rv.attempts < 5
    returning rv.attempts into v_attempts;
    continue when v_attempts is null;

    v_count := v_count + 1;
    event_id := v_row.ev_id;
    tenant_id := v_row.ev_tenant;
    tenant_slug := v_row.ev_slug;
    channel_type := v_row.ev_channel;
    external_conversation_id := v_row.ev_external;
    message_text := v_row.ev_text;
    campaign_id := v_row.ev_campaign;
    broadcast_message := v_row.ev_broadcast;
    attempts := v_attempts;
    return next;
  end loop;
end $$;

-- Conclui a análise: 'done' (decidido), 'deferred' (tenta de novo depois) ou 'failed'.
-- Após 5 tentativas adiadas, a mensagem fica como 'failed'.
create or replace function public.broadcast_finish_opt_out_review(
  p_event_id uuid,
  p_lease_token uuid,
  p_status text,
  p_decision jsonb default '{}'::jsonb,
  p_retry_seconds integer default 300
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows integer;
begin
  if p_status not in ('done', 'deferred', 'failed') then raise exception 'BROADCAST_INVALID_REVIEW_STATUS' using errcode = '22023'; end if;
  update public.broadcast_opt_out_reviews
  set status = case when p_status = 'deferred' and attempts >= 5 then 'failed' else p_status end,
      decision = coalesce(p_decision, '{}'::jsonb),
      lease_token = null,
      locked_until = case when p_status = 'deferred'
        then clock_timestamp() + make_interval(secs => greatest(30, least(coalesce(p_retry_seconds, 300), 86400))) end,
      updated_at = clock_timestamp()
  where event_id = p_event_id and lease_token = p_lease_token and p_lease_token is not null and status = 'claimed';
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end $$;

revoke all on function public.broadcast_claim_opt_out_reviews(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.broadcast_finish_opt_out_review(uuid, uuid, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.broadcast_claim_opt_out_reviews(uuid, integer, integer) to service_role;
grant execute on function public.broadcast_finish_opt_out_review(uuid, uuid, text, jsonb, integer) to service_role;

notify pgrst, 'reload schema';

commit;

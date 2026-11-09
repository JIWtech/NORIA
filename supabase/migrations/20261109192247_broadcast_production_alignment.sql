-- Alinha o repositório com o schema de disparos (broadcasts) que já está em produção.
--
-- Origem: definições lidas em 09/11/2026 do projeto Supabase de produção (pg_get_functiondef,
-- information_schema, pg_constraint) e da migração aplicada fora do repositório
-- `20261015042814_noria_030_broadcast_idempotency_worker_leases_secure_20261015`.
-- O conteúdo abaixo reproduz essa migração e acrescenta o único ajuste de produção que não
-- estava registrado em nenhuma migração: `send_interval_seconds` como integer entre 2 e 86400
-- (o repositório, em 023, tinha smallint entre 2 e 10).
--
-- Idempotente: em produção é um no-op de schema (mesmas colunas, constraints, índices e funções).

begin;

-- 1. broadcast_campaign_recipients: idempotência e leases
alter table public.broadcast_campaign_recipients
  add column if not exists idempotency_key text,
  add column if not exists lease_token uuid,
  add column if not exists locked_until timestamptz,
  add column if not exists claimed_at timestamptz,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists last_attempt_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'broadcast_recipients_campaign_external_id_uniq'
  ) then
    alter table public.broadcast_campaign_recipients
      add constraint broadcast_recipients_campaign_external_id_uniq
      unique (campaign_id, external_conversation_id);
  end if;
end $$;

alter table public.broadcast_campaign_recipients
  drop constraint if exists broadcast_campaign_recipients_status_check;

alter table public.broadcast_campaign_recipients
  add constraint broadcast_campaign_recipients_status_check
  check (status in ('queued', 'claimed', 'sending', 'sent', 'failed', 'unknown', 'cancelled', 'skipped'));

create index if not exists broadcast_recipients_claim_idx
  on public.broadcast_campaign_recipients (campaign_id, status, locked_until);

create unique index if not exists broadcast_recipients_idempotency_idx
  on public.broadcast_campaign_recipients (campaign_id, idempotency_key)
  where idempotency_key is not null;

-- 2. broadcast_campaigns: contadores, lease, status e intervalo
alter table public.broadcast_campaigns
  add column if not exists unknown_count integer not null default 0,
  add column if not exists lease_token uuid,
  add column if not exists locked_until timestamptz;

alter table public.broadcast_campaigns
  drop constraint if exists broadcast_campaigns_status_check;

alter table public.broadcast_campaigns
  add constraint broadcast_campaigns_status_check
  check (status in ('draft', 'queued', 'scheduled', 'sending', 'paused', 'sent', 'partial_error', 'failed', 'cancelled'));

alter table public.broadcast_campaigns
  drop constraint if exists broadcast_campaigns_send_interval_seconds_check;

alter table public.broadcast_campaigns
  alter column send_interval_seconds type integer;

alter table public.broadcast_campaigns
  add constraint broadcast_campaigns_send_interval_seconds_check
  check (send_interval_seconds >= 2 and send_interval_seconds <= 86400);

-- 3. broadcast_claim_batch: reserva atômica de lote (FOR UPDATE SKIP LOCKED)
create or replace function public.broadcast_claim_batch(
  p_campaign_id uuid,
  p_lease_token uuid,
  p_batch_size integer default 10,
  p_lease_seconds integer default 120
)
returns table (
  id uuid,
  campaign_id uuid,
  tenant_id uuid,
  channel_type text,
  external_conversation_id text,
  contact_name text,
  idempotency_key text,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lease_expiry timestamptz;
  v_campaign_status text;
begin
  -- Verificar se a campanha está ativa para envio
  select status into v_campaign_status
  from public.broadcast_campaigns
  where public.broadcast_campaigns.id = p_campaign_id;

  if v_campaign_status is null or v_campaign_status not in ('sending', 'queued') then
    return;
  end if;

  if p_lease_token is null or p_batch_size is null or p_lease_seconds is null then
    return;
  end if;

  v_lease_expiry := clock_timestamp() + make_interval(secs => greatest(10, least(p_lease_seconds, 600)));

  return query
  with candidates as (
    select r.id as rec_id
    from public.broadcast_campaign_recipients r
    where r.campaign_id = p_campaign_id
      and r.tenant_id = (select c.tenant_id from public.broadcast_campaigns c where c.id = p_campaign_id)
      and (
        r.status = 'queued'
        or (r.status = 'claimed' and r.locked_until is not null and r.locked_until <= clock_timestamp())
      )
    order by r.created_at asc
    for update skip locked
    limit greatest(1, least(p_batch_size, 50))
  ),
  updated as (
    update public.broadcast_campaign_recipients r
    set
      status = 'claimed',
      lease_token = p_lease_token,
      locked_until = v_lease_expiry,
      claimed_at = clock_timestamp(),
      attempt_count = r.attempt_count + 1,
      last_attempt_at = clock_timestamp()
    from candidates
    where r.id = candidates.rec_id
    returning r.*
  )
  select
    u.id,
    u.campaign_id,
    u.tenant_id,
    u.channel_type,
    u.external_conversation_id,
    u.contact_name,
    u.idempotency_key,
    u.attempt_count
  from updated u;
end $$;

-- 4. broadcast_mark_sending: 'claimed' -> 'sending' imediatamente antes da chamada externa
create or replace function public.broadcast_mark_sending(
  p_recipient_id uuid,
  p_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows integer;
begin
  update public.broadcast_campaign_recipients
  set status = 'sending'
  where id = p_recipient_id
    and p_lease_token is not null
    and lease_token = p_lease_token
    and status = 'claimed'
    and locked_until > clock_timestamp()
    and exists (
      select 1 from public.broadcast_campaigns c
      where c.id = public.broadcast_campaign_recipients.campaign_id
        and c.tenant_id = public.broadcast_campaign_recipients.tenant_id
        and c.status in ('queued', 'sending')
    );

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end $$;

-- 5. broadcast_record_result: grava o resultado ('sent' é imutável) e recalcula contadores
create or replace function public.broadcast_record_result(
  p_recipient_id uuid,
  p_lease_token uuid,
  p_status text,
  p_external_message_id text default null,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rec public.broadcast_campaign_recipients%rowtype;
  v_campaign_id uuid;
  v_sent_count integer;
  v_failed_count integer;
  v_unknown_count integer;
  v_total integer;
begin
  if p_status is null or p_status not in ('sent', 'failed', 'unknown') then
    raise exception 'Status de resultado invalido: %', p_status;
  end if;

  select * into v_rec
  from public.broadcast_campaign_recipients
  where id = p_recipient_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'recipient_not_found');
  end if;

  -- Se já estiver marcado como 'sent', resposta atrasada não pode sobrescrever
  if v_rec.status = 'sent' then
    return jsonb_build_object('ok', true, 'status', 'sent', 'note', 'already_sent');
  end if;

  if p_lease_token is null
     or v_rec.lease_token is distinct from p_lease_token
     or v_rec.status <> 'sending'
     or v_rec.locked_until is null
     or v_rec.locked_until <= clock_timestamp() then
    return jsonb_build_object('ok', false, 'reason', 'invalid_or_expired_lease');
  end if;

  v_campaign_id := v_rec.campaign_id;

  update public.broadcast_campaign_recipients
  set
    status = p_status,
    external_message_id = coalesce(p_external_message_id, v_rec.external_message_id),
    error = p_error,
    sent_at = case when p_status = 'sent' then coalesce(v_rec.sent_at, clock_timestamp()) else v_rec.sent_at end,
    lease_token = null,
    locked_until = null
  where id = p_recipient_id;

  -- Atualizar contadores agregados da campanha
  select
    count(*) filter (where status = 'sent'),
    count(*) filter (where status = 'failed'),
    count(*) filter (where status = 'unknown'),
    count(*)
  into v_sent_count, v_failed_count, v_unknown_count, v_total
  from public.broadcast_campaign_recipients
  where campaign_id = v_campaign_id;

  update public.broadcast_campaigns
  set
    sent_count = v_sent_count,
    failed_count = v_failed_count,
    unknown_count = v_unknown_count,
    total_recipients = v_total,
    updated_at = clock_timestamp(),
    status = case
      when v_sent_count + v_failed_count + v_unknown_count >= v_total and v_total > 0 then
        case
          when v_unknown_count > 0 then 'partial_error'
          when v_failed_count > 0 then 'partial_error'
          else 'sent'
        end
      else status
    end
  where id = v_campaign_id;

  return jsonb_build_object(
    'ok', true,
    'status', p_status,
    'campaign_id', v_campaign_id,
    'sent_count', v_sent_count,
    'failed_count', v_failed_count,
    'unknown_count', v_unknown_count
  );
end $$;

-- 6. broadcast_recover_stale_leases: 'claimed' vencido volta à fila; 'sending' vencido vira 'unknown'
create or replace function public.broadcast_recover_stale_leases(
  p_campaign_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_requeued integer := 0;
  v_marked_unknown integer := 0;
begin
  -- Destinatários que expiraram ainda na fase 'claimed' voltam para 'queued'
  with reclaimed as (
    update public.broadcast_campaign_recipients
    set
      status = 'queued',
      lease_token = null,
      locked_until = null
    where campaign_id = p_campaign_id
      and status = 'claimed'
      and locked_until is not null
      and locked_until < clock_timestamp()
    returning id
  )
  select count(*) into v_requeued from reclaimed;

  -- Destinatários que expiraram na fase 'sending' tornam-se 'unknown' por segurança contra duplicidade
  with marked_uncertain as (
    update public.broadcast_campaign_recipients
    set
      status = 'unknown',
      lease_token = null,
      locked_until = null,
      error = coalesce(error, 'Timeout de confirmacao externa: resultado incerto para prevenir duplicacao')
    where campaign_id = p_campaign_id
      and status = 'sending'
      and locked_until is not null
      and locked_until < clock_timestamp()
    returning id
  )
  select count(*) into v_marked_unknown from marked_uncertain;

  -- Recalcular contadores na campanha se houve alterações
  if v_marked_unknown > 0 then
    update public.broadcast_campaigns
    set
      unknown_count = (select count(*) from public.broadcast_campaign_recipients where campaign_id = p_campaign_id and status = 'unknown'),
      updated_at = clock_timestamp()
    where id = p_campaign_id;
  end if;

  return jsonb_build_object(
    'requeued', v_requeued,
    'marked_unknown', v_marked_unknown
  );
end $$;

-- 7. broadcast_cancel_campaign: cancela sem tocar em mensagens já enviadas
create or replace function public.broadcast_cancel_campaign(
  p_campaign_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cancelled_count integer := 0;
begin
  update public.broadcast_campaigns
  set status = 'cancelled', updated_at = clock_timestamp()
  where id = p_campaign_id;

  with cancelled as (
    update public.broadcast_campaign_recipients
    set
      status = 'cancelled',
      lease_token = null,
      locked_until = null
    where campaign_id = p_campaign_id
      and status in ('queued', 'claimed')
    returning id
  )
  select count(*) into v_cancelled_count from cancelled;

  return jsonb_build_object(
    'ok', true,
    'cancelled_recipients', v_cancelled_count
  );
end $$;

-- 8. RPCs administrativas restritas ao backend: SECURITY DEFINER sem acesso público.
revoke all on function public.broadcast_claim_batch(uuid, uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.broadcast_mark_sending(uuid, uuid) from public, anon, authenticated;
revoke all on function public.broadcast_record_result(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.broadcast_recover_stale_leases(uuid) from public, anon, authenticated;
revoke all on function public.broadcast_cancel_campaign(uuid) from public, anon, authenticated;
grant execute on function public.broadcast_claim_batch(uuid, uuid, integer, integer) to service_role;
grant execute on function public.broadcast_mark_sending(uuid, uuid) to service_role;
grant execute on function public.broadcast_record_result(uuid, uuid, text, text, text) to service_role;
grant execute on function public.broadcast_recover_stale_leases(uuid) to service_role;
grant execute on function public.broadcast_cancel_campaign(uuid) to service_role;

commit;

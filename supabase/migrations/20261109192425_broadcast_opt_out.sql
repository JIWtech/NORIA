-- Lista de bloqueio (opt-out) de disparos, por tenant.
--
-- Entradas:
--   - equipe do tenant, pelo painel (broadcast_set_opt_out; desbloquear exige gestor);
--   - pedido do próprio cliente, registrado pelo backend somente com o contrato estruturado
--     noria_broadcast_opt_out_v1 (evidências validadas pelo CORE a partir da interpretação do modelo;
--     nenhuma regex decide intenção).
-- O bloqueio vale ao enfileirar e no momento do envio (broadcast_begin_send), atomicamente com a lease.

begin;

-- Chave técnica do contato: remove só o sufixo de JID do WhatsApp (parsing de formato, não de intenção).
create or replace function public.broadcast_contact_key(p_external text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select nullif(lower(regexp_replace(trim(coalesce(p_external, '')), '@(s\.whatsapp\.net|c\.us)$', '')), '');
$$;

create table if not exists public.broadcast_opt_outs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  channel_type text not null,
  contact_key text not null,
  source text not null check (source in ('operator', 'customer_request')),
  reason text,
  evidence jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, channel_type, contact_key)
);

alter table public.broadcast_opt_outs enable row level security;
revoke all on public.broadcast_opt_outs from anon;
revoke insert, update, delete, truncate on public.broadcast_opt_outs from authenticated;
grant select on public.broadcast_opt_outs to authenticated;
grant all on public.broadcast_opt_outs to service_role;

drop policy if exists "broadcast_opt_outs_member_select" on public.broadcast_opt_outs;
create policy "broadcast_opt_outs_member_select"
on public.broadcast_opt_outs
for select
to authenticated
using (
  exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = broadcast_opt_outs.tenant_id
      and tm.user_id = auth.uid()
      and tm.status = 'active'
  )
);

-- Pula destinatários ainda na fila de campanhas do tenant para um contato bloqueado.
create or replace function public.broadcast_skip_opted_out_contact(p_tenant_id uuid, p_channel text, p_key text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows integer;
begin
  update public.broadcast_campaign_recipients r
  set status = 'skipped', error = 'opt_out', lease_token = null, locked_until = null
  where r.tenant_id = p_tenant_id
    and r.channel_type = p_channel
    and public.broadcast_contact_key(r.external_conversation_id) = p_key
    and r.status = 'queued';
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;

-- Painel: bloquear (qualquer operador) ou desbloquear (gestor) um contato do próprio tenant.
create or replace function public.broadcast_set_opt_out(
  p_tenant_id uuid,
  p_channel text,
  p_external text,
  p_opted_out boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := public.broadcast_contact_key(p_external);
  v_channel text := lower(trim(coalesce(p_channel, '')));
  v_skipped integer := 0;
begin
  perform public.broadcast_assert_operator(p_tenant_id);
  if v_key is null or v_channel = '' then raise exception 'BROADCAST_INVALID_CONTACT' using errcode = '22023'; end if;

  if p_opted_out is true then
    insert into public.broadcast_opt_outs(tenant_id, channel_type, contact_key, source, reason, created_by)
    values (p_tenant_id, v_channel, v_key, 'operator', left(p_reason, 300), auth.uid())
    on conflict (tenant_id, channel_type, contact_key) do nothing;
    v_skipped := public.broadcast_skip_opted_out_contact(p_tenant_id, v_channel, v_key);
  else
    if not exists (
      select 1 from public.tenant_members tm
      where tm.tenant_id = p_tenant_id and tm.user_id = auth.uid() and tm.status = 'active'
        and tm.role in ('owner', 'admin', 'manager')
    ) then
      raise exception 'BROADCAST_FORBIDDEN' using errcode = '42501';
    end if;
    delete from public.broadcast_opt_outs
    where tenant_id = p_tenant_id and channel_type = v_channel and contact_key = v_key;
  end if;

  return jsonb_build_object('ok', true, 'contact_key', v_key, 'opted_out', p_opted_out is true, 'skipped_recipients', v_skipped);
end $$;

-- Backend (CORE): registra o pedido do cliente. Só aceita o contrato estruturado com evidências.
create or replace function public.broadcast_register_opt_out(
  p_tenant_id uuid,
  p_channel text,
  p_external text,
  p_proof jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := public.broadcast_contact_key(p_external);
  v_channel text := lower(trim(coalesce(p_channel, '')));
  v_inserted integer;
  v_skipped integer;
begin
  if p_proof is null
     or p_proof ->> 'contract' is distinct from 'noria_broadcast_opt_out_v1'
     or jsonb_typeof(p_proof -> 'evidence_ids') is distinct from 'array'
     or jsonb_array_length(p_proof -> 'evidence_ids') = 0 then
    raise exception 'BROADCAST_OPT_OUT_PROOF' using errcode = '22023';
  end if;
  if v_key is null or v_channel = '' or not exists (select 1 from public.tenants where id = p_tenant_id) then
    raise exception 'BROADCAST_INVALID_CONTACT' using errcode = '22023';
  end if;

  insert into public.broadcast_opt_outs(tenant_id, channel_type, contact_key, source, evidence)
  values (p_tenant_id, v_channel, v_key, 'customer_request', p_proof)
  on conflict (tenant_id, channel_type, contact_key) do nothing;
  get diagnostics v_inserted = row_count;
  v_skipped := public.broadcast_skip_opted_out_contact(p_tenant_id, v_channel, v_key);

  return jsonb_build_object('ok', true, 'contract', 'noria_broadcast_opt_out_v1', 'created', v_inserted > 0, 'skipped_recipients', v_skipped);
end $$;

-- Worker: transição 'claimed' -> 'sending', recusando contato bloqueado no mesmo passo.
-- Retorna 'sending', 'skipped_opt_out' ou 'lease_lost'.
create or replace function public.broadcast_begin_send(p_recipient_id uuid, p_lease_token uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rec public.broadcast_campaign_recipients%rowtype;
begin
  select * into v_rec from public.broadcast_campaign_recipients
  where id = p_recipient_id and p_lease_token is not null and lease_token = p_lease_token
    and status = 'claimed' and locked_until > clock_timestamp()
  for update;
  if not found then return 'lease_lost'; end if;

  if exists (
    select 1 from public.broadcast_opt_outs o
    where o.tenant_id = v_rec.tenant_id
      and o.channel_type = v_rec.channel_type
      and o.contact_key = public.broadcast_contact_key(v_rec.external_conversation_id)
  ) then
    update public.broadcast_campaign_recipients
    set status = 'skipped', error = 'opt_out', lease_token = null, locked_until = null
    where id = p_recipient_id;
    return 'skipped_opt_out';
  end if;

  if public.broadcast_mark_sending(p_recipient_id, p_lease_token) then return 'sending'; end if;
  return 'lease_lost';
end $$;

-- Enfileirar passa a pular bloqueados antes de contar os destinatários.
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
  v_total integer;
  v_limit integer;
begin
  select * into v_campaign from public.broadcast_campaigns where id = p_campaign_id for update;
  if not found then raise exception 'BROADCAST_NOT_FOUND' using errcode = 'P0002'; end if;
  perform public.broadcast_assert_operator(v_campaign.tenant_id);
  if p_consent_confirmed is not true then raise exception 'BROADCAST_CONSENT_REQUIRED' using errcode = '22023'; end if;
  if v_campaign.status <> 'draft' then raise exception 'BROADCAST_NOT_DRAFT' using errcode = '55000'; end if;

  update public.broadcast_campaign_recipients r
  set status = 'skipped', error = 'opt_out'
  where r.campaign_id = p_campaign_id and r.tenant_id = v_campaign.tenant_id and r.status = 'queued'
    and exists (
      select 1 from public.broadcast_opt_outs o
      where o.tenant_id = r.tenant_id and o.channel_type = r.channel_type
        and o.contact_key = public.broadcast_contact_key(r.external_conversation_id));

  select count(*) filter (where status = 'queued'), count(*)
  into v_recipients, v_total
  from public.broadcast_campaign_recipients
  where campaign_id = p_campaign_id and tenant_id = v_campaign.tenant_id;
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
      total_recipients = v_total,
      consent_confirmed_at = v_now,
      consent_confirmed_by = auth.uid(),
      updated_at = v_now
  where id = p_campaign_id;

  return jsonb_build_object('ok', true, 'campaign_id', p_campaign_id,
    'status', case when v_at > v_now then 'scheduled' else 'queued' end, 'scheduled_at', v_at,
    'recipients', v_recipients, 'skipped_opt_out', v_total - v_recipients);
end $$;

revoke all on function public.broadcast_contact_key(text) from public, anon;
revoke all on function public.broadcast_skip_opted_out_contact(uuid, text, text) from public, anon, authenticated;
revoke all on function public.broadcast_set_opt_out(uuid, text, text, boolean, text) from public, anon;
revoke all on function public.broadcast_register_opt_out(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.broadcast_begin_send(uuid, uuid) from public, anon, authenticated;
grant execute on function public.broadcast_contact_key(text) to authenticated, service_role;
grant execute on function public.broadcast_skip_opted_out_contact(uuid, text, text) to service_role;
grant execute on function public.broadcast_set_opt_out(uuid, text, text, boolean, text) to authenticated, service_role;
grant execute on function public.broadcast_register_opt_out(uuid, text, text, jsonb) to service_role;
grant execute on function public.broadcast_begin_send(uuid, uuid) to service_role;

notify pgrst, 'reload schema';

commit;

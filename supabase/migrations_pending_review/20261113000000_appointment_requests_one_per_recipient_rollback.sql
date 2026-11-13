-- Rollback da proposta 20261113000000_appointment_requests_one_per_recipient.sql (NAO APLICADA).
-- Volta a um pedido pendente por conversa. Se já existirem vários pendentes na mesma conversa, a reversão para antes de
-- mexer no índice: a equipe precisa resolver (confirmar ou cancelar) os excedentes primeiro.
begin;

do $$
begin
  if exists (
    select 1 from public.appointments where status = 'pending_confirmation'
    group by tenant_id, channel_type, external_conversation_id having count(*) > 1
  ) then
    raise exception 'ROLLBACK_BLOCKED: ha conversas com mais de um pedido pendente';
  end if;
end $$;

drop index if exists public.appointments_one_open_request_idx;

create unique index appointments_one_open_request_idx
  on public.appointments (tenant_id, channel_type, external_conversation_id)
  where status = 'pending_confirmation';

create or replace function public.magia_upsert_appointment_request(
  p_tenant uuid,
  p_channel text,
  p_chat text,
  p_contact text,
  p_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_details jsonb,
  p_request text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_row public.appointments%rowtype;
  saved public.appointments%rowtype;
  stamp jsonb;
begin
  if p_tenant is null or nullif(btrim(coalesce(p_channel, '')), '') is null or nullif(btrim(coalesce(p_chat, '')), '') is null
    or nullif(btrim(coalesce(p_title, '')), '') is null or p_starts_at is null or nullif(btrim(coalesce(p_request, '')), '') is null
    or jsonb_typeof(coalesce(p_details, '{}'::jsonb)) <> 'object' then
    raise exception 'APPOINTMENT_REQUEST_INVALID';
  end if;

  select * into current_row from public.appointments
  where tenant_id = p_tenant and channel_type = p_channel and external_conversation_id = p_chat
    and status = 'pending_confirmation'
  for update;

  if found and current_row.metadata->>'request_key' = p_request then
    return jsonb_build_object('appointment', to_jsonb(current_row), 'created', false, 'already', true);
  end if;
  if found and current_row.metadata->>'confirmation_state' is not null then
    raise exception 'APPOINTMENT_REQUEST_BUSY';
  end if;
  if p_starts_at <= now() then raise exception 'APPOINTMENT_REQUEST_PAST'; end if;

  stamp := jsonb_build_object('source', 'ai_appointment_request', 'request_key', p_request,
    'request_version', coalesce((current_row.metadata->>'request_version')::integer, 0) + 1,
    'request_updated_at', now());

  insert into public.appointments as a(tenant_id, title, starts_at, ends_at, status, contact_name, channel_type,
    external_conversation_id, notes, metadata)
  values (p_tenant, p_title, p_starts_at, p_ends_at, 'pending_confirmation', p_contact, p_channel, p_chat,
    'Pedido registrado pela IA. Aguardando confirmação da equipe.', coalesce(p_details, '{}'::jsonb) || stamp)
  on conflict (tenant_id, channel_type, external_conversation_id) where status = 'pending_confirmation'
  do update set title = excluded.title, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
    contact_name = excluded.contact_name, metadata = a.metadata || excluded.metadata, updated_at = now()
  returning * into saved;

  return jsonb_build_object('appointment', to_jsonb(saved), 'created', (saved.metadata->>'request_version')::integer = 1, 'already', false);
end
$$;

commit;

-- Migration 031: pedido de agendamento aguardando confirmação do dono.
--
-- A IA registra o pedido sem travar a conversa; o dono confirma pelo Kanban. Só é usado por tenants com
-- settings.appointment_request ligado: nos demais nenhuma linha nasce com este status.
--
--   * um pedido aberto por conversa (índice parcial);
--   * cada mudança sobe metadata.request_version, que o comando de confirmação confere;
--   * a repetição do mesmo turno (p_request) não tem efeito;
--   * pedido com envio em andamento ou incerto não muda até o dono resolver.
--
-- 'pending_confirmation' não entra em nenhuma lista das migrações 018, 019 e 021, que listam os status
-- encerrados: ele já conta como ativo. A 030 usa lista fechada e continua recusando desfecho de pedido.
-- Reaplicável. Rollback: supabase/migrations_pending_review/031_appointment_requests_rollback.sql

begin;

create unique index if not exists appointments_one_open_request_idx
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

create or replace function public.magia_cancel_appointment_request(
  p_tenant uuid,
  p_channel text,
  p_chat text,
  p_reason text,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_row public.appointments%rowtype;
begin
  select * into current_row from public.appointments
  where tenant_id = p_tenant and channel_type = p_channel and external_conversation_id = p_chat
    and status = 'pending_confirmation'
  for update;
  if not found then return jsonb_build_object('cancelled', false); end if;
  if current_row.metadata->>'confirmation_state' is not null then raise exception 'APPOINTMENT_REQUEST_BUSY'; end if;

  update public.appointments
  set status = 'cancelled', updated_at = now(),
      metadata = metadata || jsonb_build_object('cancel_reason', p_reason, 'cancelled_by', p_actor, 'cancelled_at', now())
  where id = current_row.id
  returning * into current_row;

  return jsonb_build_object('cancelled', true, 'appointment', to_jsonb(current_row));
end
$$;

-- Sobreposição no tenant, para o aviso antes de confirmar. Sem ends_at considera 2 horas, como a migração 018.
create or replace function public.magia_appointment_request_conflicts(p_tenant uuid, p_appointment uuid)
returns table (id uuid, title text, contact_name text, starts_at timestamptz, ends_at timestamptz, status text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select other.id, other.title, other.contact_name, other.starts_at, other.ends_at, other.status
  from public.appointments mine
  join public.appointments other
    on other.tenant_id = mine.tenant_id and other.id <> mine.id
   and other.starts_at < coalesce(mine.ends_at, mine.starts_at + interval '2 hours')
   and coalesce(other.ends_at, other.starts_at + interval '2 hours') > mine.starts_at
  where mine.tenant_id = p_tenant and mine.id = p_appointment
    and lower(coalesce(other.status, 'scheduled')) not in ('cancelled', 'canceled', 'cancelado', 'cancelada', 'completed', 'done', 'no_show')
  order by other.starts_at;
$$;

revoke all on function public.magia_upsert_appointment_request(uuid, text, text, text, text, timestamptz, timestamptz, jsonb, text) from public, anon, authenticated;
revoke all on function public.magia_cancel_appointment_request(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.magia_appointment_request_conflicts(uuid, uuid) from public, anon, authenticated;
grant execute on function public.magia_upsert_appointment_request(uuid, text, text, text, text, timestamptz, timestamptz, jsonb, text) to service_role;
grant execute on function public.magia_cancel_appointment_request(uuid, text, text, text, text) to service_role;
grant execute on function public.magia_appointment_request_conflicts(uuid, uuid) to service_role;

commit;

notify pgrst, 'reload schema';

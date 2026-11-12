-- Migration 034: editar, cancelar e arquivar agendamentos pelo painel (tela Agendamentos).
-- APLICADA em 11/11/2026.
--
-- Por que RPC e não UPDATE direto: a política appointments_member_update deixa o membro mudar
-- qualquer coluna. As funções abaixo limitam o que muda, conferem o papel do membro, recusam status
-- encerrados e registram quem alterou. Nenhuma delas avisa a cliente (decisão do produto).
--
--   * magia_update_appointment: data/hora (mantém a duração), serviços, profissional e observações;
--   * magia_close_appointment: 'cancel' -> cancelled; 'archive' -> completed (encerrar como concluído).
--
-- O gatilho de capacidade (018) continua valendo: horário fora da grade ou sem vaga gera
-- INVALID_SESSION_SLOT / SLOT_UNAVAILABLE. Pedido pendente (031) não é editado aqui: segue o fluxo
-- de confirmação do Kanban, que confere request_version. Ele pode ser cancelado, salvo durante o envio.
-- Atenção: 'completed' conta como comparecimento para magia_deposit_required_contacts (030).
-- Reaplicável. Rollback: supabase/migrations_pending_review/034_appointment_manage_actions_rollback.sql

begin;

create or replace function public.magia_appointment_actor(p_tenant uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(nullif(m.email, ''), auth.uid()::text)
  from public.tenant_members m
  where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.status = 'active'
    and m.role in ('owner', 'admin', 'manager', 'operator', 'agent')
  limit 1;
$$;

create or replace function public.magia_update_appointment(
  p_appointment uuid,
  p_starts_at timestamptz default null,
  p_services jsonb default null,
  p_professional text default null,
  p_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a public.appointments%rowtype;
  v_actor text;
  v_services text[];
  v_metadata jsonb;
begin
  if auth.uid() is null then raise exception 'APPOINTMENT_ACTION_FORBIDDEN'; end if;
  select * into a from public.appointments where id = p_appointment for update;
  if not found then raise exception 'APPOINTMENT_NOT_FOUND'; end if;
  v_actor := public.magia_appointment_actor(a.tenant_id);
  if v_actor is null then raise exception 'APPOINTMENT_ACTION_FORBIDDEN'; end if;
  if a.status not in ('scheduled', 'confirmed', 'reserved', 'pending_payment', 'payment_reported', 'aguardando_verificacao') then
    raise exception 'APPOINTMENT_EDIT_INVALID_STATUS';
  end if;
  if p_starts_at is not null and p_starts_at <= now() then raise exception 'APPOINTMENT_EDIT_PAST'; end if;

  v_metadata := coalesce(a.metadata, '{}'::jsonb);
  if p_services is not null then
    if jsonb_typeof(p_services) <> 'array' then raise exception 'APPOINTMENT_EDIT_INVALID'; end if;
    select array_agg(btrim(value)) into v_services
    from jsonb_array_elements_text(p_services) as value
    where nullif(btrim(value), '') is not null;
    if coalesce(array_length(v_services, 1), 0) = 0 then raise exception 'APPOINTMENT_EDIT_INVALID'; end if;
    v_metadata := v_metadata || jsonb_build_object('services', to_jsonb(v_services));
  end if;
  if p_professional is not null then
    v_metadata := case when nullif(btrim(p_professional), '') is null then v_metadata - 'professional'
      else v_metadata || jsonb_build_object('professional', btrim(p_professional)) end;
  end if;
  v_metadata := v_metadata || jsonb_build_object('edited_at', now(), 'edited_by', v_actor);

  update public.appointments
  set starts_at = coalesce(p_starts_at, starts_at),
      ends_at = case when p_starts_at is null or ends_at is null then ends_at else p_starts_at + (ends_at - starts_at) end,
      title = case when v_services is null then title
        else array_to_string(v_services, ' + ') || coalesce(' - ' || nullif(btrim(contact_name), ''), '') end,
      notes = case when p_notes is null then notes else nullif(btrim(p_notes), '') end,
      metadata = v_metadata,
      updated_at = now()
  where id = a.id
  returning * into a;

  return jsonb_build_object('ok', true, 'appointment', to_jsonb(a));
end
$$;

create or replace function public.magia_close_appointment(
  p_appointment uuid,
  p_action text,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a public.appointments%rowtype;
  v_actor text;
  v_status text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if auth.uid() is null then raise exception 'APPOINTMENT_ACTION_FORBIDDEN'; end if;
  if p_action is null or p_action not in ('cancel', 'archive') then raise exception 'APPOINTMENT_CLOSE_INVALID'; end if;
  select * into a from public.appointments where id = p_appointment for update;
  if not found then raise exception 'APPOINTMENT_NOT_FOUND'; end if;
  v_actor := public.magia_appointment_actor(a.tenant_id);
  if v_actor is null then raise exception 'APPOINTMENT_ACTION_FORBIDDEN'; end if;

  v_status := case p_action when 'cancel' then 'cancelled' else 'completed' end;
  if a.status = v_status or (p_action = 'cancel' and a.status = 'canceled') then
    return jsonb_build_object('ok', true, 'appointment', to_jsonb(a), 'already', true);
  end if;
  if a.status not in ('scheduled', 'confirmed', 'reserved', 'pending_payment', 'payment_reported', 'aguardando_verificacao')
    and not (p_action = 'cancel' and a.status = 'pending_confirmation') then
    raise exception 'APPOINTMENT_CLOSE_INVALID_STATUS';
  end if;
  if a.status = 'pending_confirmation' and a.metadata->>'confirmation_state' is not null then
    raise exception 'APPOINTMENT_REQUEST_BUSY';
  end if;

  update public.appointments
  set status = v_status,
      updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb)
        || case when p_action = 'cancel'
          then jsonb_build_object('cancelled_at', now(), 'cancelled_by', v_actor, 'cancel_reason', coalesce(v_note, 'panel'))
          else jsonb_build_object('archived_at', now(), 'archived_by', v_actor)
            || case when v_note is null then '{}'::jsonb else jsonb_build_object('archive_note', v_note) end end
  where id = a.id
  returning * into a;

  return jsonb_build_object('ok', true, 'appointment', to_jsonb(a), 'already', false);
end
$$;

revoke all on function public.magia_appointment_actor(uuid) from public, anon, authenticated;
revoke all on function public.magia_update_appointment(uuid, timestamptz, jsonb, text, text) from public, anon;
grant execute on function public.magia_update_appointment(uuid, timestamptz, jsonb, text, text) to authenticated;
revoke all on function public.magia_close_appointment(uuid, text, text) from public, anon;
grant execute on function public.magia_close_appointment(uuid, text, text) to authenticated;

commit;

notify pgrst, 'reload schema';

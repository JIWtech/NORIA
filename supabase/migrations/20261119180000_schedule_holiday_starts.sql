-- Agenda em feriados (genérico, qualquer tenant): datas em tenant_settings.business_hours.holiday_dates usam os
-- horários de início da unidade em appointment_scheduling.units.<unidade>.holiday_starts (sem a chave, o feriado não
-- tem horários). Fora dos feriados nada muda: continua valendo units.<unidade>.starts pelo dia da semana.
-- Só a leitura dos horários do dia muda nas duas funções abaixo; o resto é idêntico à versão anterior.
-- Rollback: recriar magia_appointment_availability e magia_appointment_capacity_guard lendo
--   spec->'unit'->'starts'->extract(dow ...)::integer::text e remover magia_schedule_day_starts(uuid, jsonb, date).

create or replace function public.magia_schedule_day_starts(p_tenant uuid, p_unit jsonb, p_date date)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select case
    when exists (select 1 from public.tenant_settings s where s.tenant_id = p_tenant
      and coalesce(s.business_hours->'holiday_dates', '[]'::jsonb) ? to_char(p_date, 'YYYY-MM-DD'))
      then coalesce(p_unit->'holiday_starts', '[]'::jsonb)
    else coalesce(p_unit->'starts'->(extract(dow from p_date)::integer::text), '[]'::jsonb)
  end;
$$;
revoke all on function public.magia_schedule_day_starts(uuid, jsonb, date) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.magia_appointment_availability(p_tenant uuid, p_unit text, p_service text, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare spec jsonb; start_text text; start_time timestamptz; result jsonb := '[]'; occupied integer;
begin
  perform public.magia_schedule_authorize(p_tenant);
  spec := public.magia_schedule_spec(p_tenant, p_unit, p_service);
  for start_text in select jsonb_array_elements_text(public.magia_schedule_day_starts(p_tenant, spec->'unit', p_date)) loop
    start_time := (p_date + start_text::time) at time zone (spec->>'timezone');
    select used into occupied from public.appointment_capacity_slots
      where tenant_id = p_tenant and unit_id = p_unit and resource_id = spec->>'resource' and starts_at = start_time;
    if start_time > now() and coalesce(occupied, 0) < (spec->>'capacity')::integer
      and not public.magia_schedule_legacy_conflict(p_tenant, p_unit, start_time, start_time + make_interval(mins => (spec->>'duration')::integer))
      then result := result || to_jsonb(start_text); end if;
  end loop;
  return jsonb_build_object('date', p_date, 'unit_id', p_unit, 'available_starts', result);
end $function$;

CREATE OR REPLACE FUNCTION public.magia_appointment_capacity_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare allocation public.appointment_capacity_allocations%rowtype;
  cfg jsonb; spec jsonb; local_start timestamp; slot_used integer; enabled boolean;
begin
  if tg_op <> 'INSERT' then
    select * into allocation from public.appointment_capacity_allocations where appointment_id = old.id for update;
    if tg_op = 'UPDATE' then
      -- Payment verification and notes preserve an existing allocation or an unclassified legacy booking.
      if new.tenant_id = old.tenant_id and new.starts_at = old.starts_at
        and new.ends_at is not distinct from old.ends_at
        and new.metadata->>'unit_id' is not distinct from old.metadata->>'unit_id'
        and new.metadata->>'service_id' is not distinct from old.metadata->>'service_id'
        and (new.status not in ('cancelled', 'canceled', 'completed', 'done', 'no_show'))
          = (old.status not in ('cancelled', 'canceled', 'completed', 'done', 'no_show')) then return new; end if;
    end if;
    if allocation.appointment_id is not null then
      update public.appointment_capacity_slots set used = used - 1
        where tenant_id = allocation.tenant_id and unit_id = allocation.unit_id
          and resource_id = allocation.resource_id and starts_at = allocation.starts_at;
      delete from public.appointment_capacity_allocations where appointment_id = old.id;
    end if;
    if tg_op = 'DELETE' then return old; end if;
  end if;
  if new.status in ('cancelled', 'canceled', 'completed', 'done', 'no_show') then return new; end if;
  select settings->'appointment_scheduling' into cfg from public.tenant_settings where tenant_id = new.tenant_id;
  enabled := coalesce((cfg->>'enabled')::boolean, false);
  if not enabled then return new; end if;
  spec := public.magia_schedule_spec(new.tenant_id, new.metadata->>'unit_id', new.metadata->>'service_id');
  local_start := new.starts_at at time zone (spec->>'timezone');
  if new.starts_at <= now() or local_start <> date_trunc('minute', local_start)
    or not coalesce(public.magia_schedule_day_starts(new.tenant_id, spec->'unit', local_start::date) ? to_char(local_start, 'HH24:MI'), false)
    or new.ends_at is distinct from new.starts_at + make_interval(mins => (spec->>'duration')::integer)
    then raise exception 'INVALID_SESSION_SLOT'; end if;
  -- Atomic row update serializes competitors for the last place. No count-then-insert race.
  insert into public.appointment_capacity_slots as slots(tenant_id, unit_id, resource_id, starts_at, used)
    values(new.tenant_id, new.metadata->>'unit_id', spec->>'resource', new.starts_at, 1)
    on conflict (tenant_id, unit_id, resource_id, starts_at)
    do update set used = slots.used + 1 where slots.used < (spec->>'capacity')::integer
    returning used into slot_used;
  if slot_used is null then raise exception 'SLOT_UNAVAILABLE'; end if;
  if public.magia_schedule_legacy_conflict(new.tenant_id, new.metadata->>'unit_id', new.starts_at, new.ends_at, new.id)
    then raise exception 'LEGACY_BOOKING_REQUIRES_REVIEW'; end if;
  insert into public.appointment_capacity_allocations values(new.id, new.tenant_id, new.metadata->>'unit_id', spec->>'resource', new.starts_at);
  new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object('unit_name', spec->'unit'->>'name',
    'resource_id', spec->>'resource', 'duration_minutes', (spec->>'duration')::integer);
  return new;
end $function$;

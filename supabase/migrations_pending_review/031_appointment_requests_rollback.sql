-- Rollback da migração 031. Só rodar sem pedidos abertos:
--   select count(*) from public.appointments where status = 'pending_confirmation';
-- Antes, remover settings.appointment_request dos tenants que o ligaram.
begin;

do $$
begin
  if exists (select 1 from public.appointments where status = 'pending_confirmation') then
    raise exception 'APPOINTMENT_REQUESTS_STILL_OPEN';
  end if;
end $$;

drop function if exists public.magia_appointment_request_conflicts(uuid, uuid);
drop function if exists public.magia_cancel_appointment_request(uuid, text, text, text, text);
drop function if exists public.magia_upsert_appointment_request(uuid, text, text, text, text, timestamptz, timestamptz, jsonb, text);
drop index if exists public.appointments_one_open_request_idx;

commit;

notify pgrst, 'reload schema';

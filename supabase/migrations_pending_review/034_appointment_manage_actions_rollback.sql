-- Rollback da proposta 034. Remove só as funções; não altera agendamentos já editados.
begin;
drop function if exists public.magia_close_appointment(uuid, text, text);
drop function if exists public.magia_update_appointment(uuid, timestamptz, jsonb, text, text);
drop function if exists public.magia_appointment_actor(uuid);
commit;
notify pgrst, 'reload schema';

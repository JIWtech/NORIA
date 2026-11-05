-- Rollback da migration 030. Não apaga nem altera agendamentos: os que já foram marcados
-- como no_show/completed continuam com esse status (apenas deixam de existir as funções).
begin;
drop function if exists public.magia_mark_appointment_outcome(uuid, text, text);
drop function if exists public.magia_deposit_required_contacts(uuid);
drop index if exists public.appointments_outcome_lookup_idx;
commit;
notify pgrst, 'reload schema';

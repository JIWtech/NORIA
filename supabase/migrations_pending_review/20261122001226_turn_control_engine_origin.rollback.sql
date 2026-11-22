-- PROPOSTA DE ROLLBACK: não apaga evidências de controle já usadas.
-- Antes do rollback, reconciliar as origens do motor por procedimento autorizado.
do $$ begin
  if exists(select 1 from public.conversation_turn_control_origins where source_kind='engine_assignment') then
    raise exception 'ENGINE_ASSIGNMENT_ROLLBACK_REQUIRES_RECONCILIATION';
  end if;
end $$;
drop function if exists public.magia_record_engine_assignment(uuid,text,uuid,jsonb);
alter table public.conversation_turn_control_origins drop constraint if exists engine_origin_actor_check;
alter table public.conversation_turn_control_origins alter column actor_id set not null;

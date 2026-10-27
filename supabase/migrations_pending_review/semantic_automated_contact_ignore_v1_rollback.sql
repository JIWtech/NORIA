-- PROPOSTA: restaurar primeiro o CORE anterior, que não chama esta RPC.
-- Recibos e eventos históricos permanecem para auditoria.
begin;
drop function if exists public.magia_ignore_automated_turn(uuid,text,uuid,text,jsonb);
commit;

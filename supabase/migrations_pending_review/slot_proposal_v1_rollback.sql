-- Remover somente após interromper os chamadores e reconciliar envios `sending`.
-- Não apaga nem desfaz propostas, decisões ou agendamentos já persistidos.
begin;
drop function if exists public.magia_slot_proposal_prepare(uuid,text,text,uuid,integer,text,date,time,text);
drop function if exists public.magia_slot_proposal_finalize(uuid,text,text,uuid,text,text);
drop function if exists public.magia_slot_proposal_mark_uncertain(uuid,text,text,uuid,text,text);
drop function if exists public.magia_slot_proposal_resolve(uuid,text,text,uuid,text,text,uuid);
drop function if exists public.magia_slot_proposal_reconcile(uuid,text,text,uuid,text,text,uuid,text);
commit;
notify pgrst, 'reload schema';

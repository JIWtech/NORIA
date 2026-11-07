-- Rollback da migração 033: volta magia_turn_terminal_evidence à definição anterior e remove a prova de mensagem antiga.
-- Depois disso, turnos barrados por mensagem antiga voltam a cair em revisão.
begin;

create or replace function public.magia_turn_terminal_evidence(p_tenant uuid, p_chat text, p_token uuid, p_outcome text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare q public.conversation_turn_queue%rowtype; proof jsonb; authority jsonb; kind text; ids jsonb;
begin
  proof:=public.magia_turn_control_evidence(p_tenant,p_chat,p_token,p_outcome);
  if proof is null then return null; end if;
  if proof->>'kind'<>'unproven' then return proof; end if;
  select * into q from public.conversation_turn_queue where tenant_id=p_tenant
    and channel_type='whatsapp' and chat_id=p_chat for update;
  select jsonb_agg(m->>'event_id') into ids from jsonb_array_elements(q.claimed) m;
  authority:=public.magia_turn_suppression_status(p_tenant,p_chat,p_token)->'evidence';
  foreach kind in array case when p_outcome='done' then
    array['ai_disabled','lead_locked','contact_excluded','owner_saved_contact','commercial_contact','non_customer','silent_ack']
    else array['lead_locked','ai_disabled'] end loop
    if authority ? kind then return jsonb_build_object('kind',kind,'authority',authority->kind,'claimed_event_ids',ids); end if;
  end loop;
  return null;
end $function$;

drop function if exists public.magia_turn_stale_evidence(uuid, text, uuid);

commit;

notify pgrst, 'reload schema';

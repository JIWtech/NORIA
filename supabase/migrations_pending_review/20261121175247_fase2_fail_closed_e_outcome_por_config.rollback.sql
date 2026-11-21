-- Rollback de supabase/migrations/20261121175247_fase2_fail_closed_e_outcome_por_config.sql (versão registrada no banco). Ensaiado em produção numa transação desfeita: restaura as três definições byte a byte.
-- Restaura as três definições anteriores. Não altera tenant_settings (a migração também não alterou).
do $rollback$
declare d text; old_text text; new_text text;
begin
  select pg_get_functiondef('public.match_ai_knowledge(extensions.vector,integer,jsonb)'::regprocedure) into d;
  -- A definição em produção quebra a condição em linhas ("and (\n      ...\n      or d.tenant_slug"): o trecho
  -- abaixo preserva a quebra e o recuo de 6 espaços para restaurar a definição byte a byte.
  old_text := $old$false
      or d.tenant_slug$old$;
  new_text := $new$filter->>'tenant_slug' is null
      or d.tenant_slug$new$;
  if strpos(d, old_text) = 0 or strpos(replace(d, old_text, ''), old_text) > 0 then raise exception 'KNOWLEDGE_CHANGED'; end if;
  execute replace(d, old_text, new_text);

  select pg_get_functiondef('public.magia_mark_appointment_outcome(uuid,text,text)'::regprocedure) into d;
  old_text := $old$not exists (select 1 from public.tenant_settings ts where ts.tenant_id = a.tenant_id and ts.settings->'appointment_outcome_tracking' = 'true'::jsonb)$old$;
  new_text := $new$not exists (select 1 from public.tenants t where t.id = a.tenant_id and t.slug = 'ic_salon')$new$;
  if strpos(d, old_text) = 0 or strpos(replace(d, old_text, ''), old_text) > 0 then raise exception 'OUTCOME_CHANGED'; end if;
  execute replace(d, old_text, new_text);

  select pg_get_functiondef('public.magia_deposit_required_recipients(uuid)'::regprocedure) into d;
  old_text := $old$join public.tenant_settings ts on ts.tenant_id = a.tenant_id and ts.settings->'appointment_outcome_tracking' = 'true'::jsonb$old$;
  new_text := $new$join public.tenants t on t.id = a.tenant_id and t.slug = 'ic_salon'$new$;
  if strpos(d, old_text) = 0 or strpos(replace(d, old_text, ''), old_text) > 0 then raise exception 'RECIPIENTS_CHANGED'; end if;
  execute replace(d, old_text, new_text);
end $rollback$;

notify pgrst, 'reload schema';

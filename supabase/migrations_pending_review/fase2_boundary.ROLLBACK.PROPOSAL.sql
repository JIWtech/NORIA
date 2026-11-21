-- Rollback exclusivo para a proposta e sua pré-condição de chave ausente.
begin;
do $rollback$
declare d text; old_text text; new_text text; n integer;
begin
  select count(*) into n from public.tenant_settings ts join public.tenants t on t.id=ts.tenant_id
    where t.slug='ic_salon' and ts.settings->'appointment_outcome_tracking' = 'true'::jsonb;
  if n <> 1 then raise exception 'SALON_SETTINGS_CHANGED'; end if;
  select pg_get_functiondef('public.match_ai_knowledge(extensions.vector,integer,jsonb)'::regprocedure) into d;
  old_text := $old$false$old$;
  new_text := $new$filter->>'tenant_slug' is null$new$;
  if strpos(d,old_text)=0 or strpos(replace(d,old_text,''),old_text)>0 then raise exception 'KNOWLEDGE_CHANGED'; end if;
  execute replace(d,old_text,new_text);
  select pg_get_functiondef('public.magia_mark_appointment_outcome(uuid,text,text)'::regprocedure) into d;
  old_text := $old$not exists (select 1 from public.tenant_settings ts where ts.tenant_id = a.tenant_id and ts.settings->'appointment_outcome_tracking' = 'true'::jsonb)$old$;
  new_text := $new$not exists (select 1 from public.tenants t where t.id = a.tenant_id and t.slug = 'ic_salon')$new$;
  if strpos(d,old_text)=0 or strpos(replace(d,old_text,''),old_text)>0 then raise exception 'OUTCOME_CHANGED'; end if;
  execute replace(d,old_text,new_text);
  select pg_get_functiondef('public.magia_deposit_required_recipients(uuid)'::regprocedure) into d;
  old_text := $old$join public.tenant_settings ts on ts.tenant_id = a.tenant_id and ts.settings->'appointment_outcome_tracking' = 'true'::jsonb$old$;
  new_text := $new$join public.tenants t on t.id = a.tenant_id and t.slug = 'ic_salon'$new$;
  if strpos(d,old_text)=0 or strpos(replace(d,old_text,''),old_text)>0 then raise exception 'RECIPIENTS_CHANGED'; end if;
  execute replace(d,old_text,new_text);
  update public.tenant_settings ts set settings=ts.settings - 'appointment_outcome_tracking'
    from public.tenants t where t.id=ts.tenant_id and t.slug='ic_salon';
end $rollback$;
commit;
notify pgrst, 'reload schema';

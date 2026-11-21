-- PROPOSTA: não aplicar sem conferir as definições e a configuração atuais.
-- Pré-condições estritas impedem substituir silenciosamente versões divergentes.
begin;
do $proposal$
declare d text; old_text text; new_text text; n integer;
begin
  select pg_get_functiondef('public.match_ai_knowledge(extensions.vector,integer,jsonb)'::regprocedure) into d;
  old_text := $old$filter->>'tenant_slug' is null$old$;
  new_text := $new$false$new$;
  if strpos(d,old_text)=0 or strpos(replace(d,old_text,''),old_text)>0 then raise exception 'BASELINE_KNOWLEDGE_DIVERGED'; end if;
  execute replace(d,old_text,new_text);

  select pg_get_functiondef('public.magia_mark_appointment_outcome(uuid,text,text)'::regprocedure) into d;
  old_text := $old$not exists (select 1 from public.tenants t where t.id = a.tenant_id and t.slug = 'ic_salon')$old$;
  new_text := $new$not exists (select 1 from public.tenant_settings ts where ts.tenant_id = a.tenant_id and ts.settings->'appointment_outcome_tracking' = 'true'::jsonb)$new$;
  if strpos(d,old_text)=0 or strpos(replace(d,old_text,''),old_text)>0 then raise exception 'BASELINE_OUTCOME_DIVERGED'; end if;
  execute replace(d,old_text,new_text);

  select pg_get_functiondef('public.magia_deposit_required_recipients(uuid)'::regprocedure) into d;
  old_text := $old$join public.tenants t on t.id = a.tenant_id and t.slug = 'ic_salon'$old$;
  new_text := $new$join public.tenant_settings ts on ts.tenant_id = a.tenant_id and ts.settings->'appointment_outcome_tracking' = 'true'::jsonb$new$;
  if strpos(d,old_text)=0 or strpos(replace(d,old_text,''),old_text)>0 then raise exception 'BASELINE_RECIPIENTS_DIVERGED'; end if;
  execute replace(d,old_text,new_text);

  -- Exige chave ausente para que o rollback possa removê-la com segurança.
  select count(*) into n from public.tenant_settings ts join public.tenants t on t.id=ts.tenant_id
    where t.slug='ic_salon' and jsonb_typeof(ts.settings)='object' and not (ts.settings ? 'appointment_outcome_tracking');
  if n <> 1 then raise exception 'SALON_SETTINGS_BASELINE_DIVERGED'; end if;
  update public.tenant_settings ts set settings=ts.settings || '{"appointment_outcome_tracking":true}'::jsonb
    from public.tenants t where t.id=ts.tenant_id and t.slug='ic_salon';
end $proposal$;
commit;
notify pgrst, 'reload schema';

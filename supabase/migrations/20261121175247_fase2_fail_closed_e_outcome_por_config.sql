-- Fase 2 da refatoração (aplicada com autorização do responsável em 2026-11-21).
-- 1) match_ai_knowledge passa a ser fail-closed: sem filter->>'tenant_slug' não retorna documentos.
-- 2) Desfechos de agendamento e lista de sinal deixam de depender do slug fixo 'ic_salon' e passam a ler
--    tenant_settings.settings.appointment_outcome_tracking = true.
-- Pré-condições estritas: a troca só acontece se as definições atuais forem exatamente as esperadas e se o
-- comportamento resultante for idêntico (somente ic_salon tem appointment_outcome_tracking = true).
-- Rollback: supabase/migrations_pending_review/20261121175247_fase2_fail_closed_e_outcome_por_config.rollback.sql
do $migration$
declare d text; old_text text; new_text text; n integer; total integer;
begin
  select count(*) filter (where t.slug = 'ic_salon'), count(*) into n, total
    from public.tenant_settings ts join public.tenants t on t.id = ts.tenant_id
   where ts.settings->'appointment_outcome_tracking' = 'true'::jsonb;
  if n <> 1 or total <> 1 then raise exception 'OUTCOME_TRACKING_BASELINE_DIVERGED'; end if;

  select pg_get_functiondef('public.match_ai_knowledge(extensions.vector,integer,jsonb)'::regprocedure) into d;
  old_text := $old$filter->>'tenant_slug' is null$old$;
  new_text := $new$false$new$;
  if strpos(d, old_text) = 0 or strpos(replace(d, old_text, ''), old_text) > 0 or strpos(d, 'false') > 0 then
    raise exception 'BASELINE_KNOWLEDGE_DIVERGED';
  end if;
  execute replace(d, old_text, new_text);

  select pg_get_functiondef('public.magia_mark_appointment_outcome(uuid,text,text)'::regprocedure) into d;
  old_text := $old$not exists (select 1 from public.tenants t where t.id = a.tenant_id and t.slug = 'ic_salon')$old$;
  new_text := $new$not exists (select 1 from public.tenant_settings ts where ts.tenant_id = a.tenant_id and ts.settings->'appointment_outcome_tracking' = 'true'::jsonb)$new$;
  if strpos(d, old_text) = 0 or strpos(replace(d, old_text, ''), old_text) > 0 then raise exception 'BASELINE_OUTCOME_DIVERGED'; end if;
  execute replace(d, old_text, new_text);

  select pg_get_functiondef('public.magia_deposit_required_recipients(uuid)'::regprocedure) into d;
  old_text := $old$join public.tenants t on t.id = a.tenant_id and t.slug = 'ic_salon'$old$;
  new_text := $new$join public.tenant_settings ts on ts.tenant_id = a.tenant_id and ts.settings->'appointment_outcome_tracking' = 'true'::jsonb$new$;
  if strpos(d, old_text) = 0 or strpos(replace(d, old_text, ''), old_text) > 0 then raise exception 'BASELINE_RECIPIENTS_DIVERGED'; end if;
  execute replace(d, old_text, new_text);
end $migration$;

notify pgrst, 'reload schema';

-- Reverte somente os campos escritos pela proposta 25, se ainda tiverem os valores aplicados.
begin;

do $rollback$
declare
  v_id constant uuid := '76aff8a0-0466-42b9-a80d-db186ff3d8bd';
  v_current public.tenant_settings%rowtype;
  v_backup jsonb;
begin
  select s.* into v_current
  from public.tenant_settings s
  join public.tenants t on t.id = s.tenant_id and t.slug = 'ic_salon'
  where s.tenant_id = v_id
  for update of s;

  if not found or v_current.settings->>'prompt_revision' is distinct from 'ic_salon_recepcao_v17_enxuto_alinhado' then
    return;
  end if;

  v_backup := v_current.settings->'salon_v17_rollback';
  if jsonb_typeof(v_backup->'previous_settings') is distinct from 'object'
    or jsonb_typeof(v_backup->'previous_hours_sql_null') is distinct from 'boolean'
    or v_backup->>'applied_prompt_md5' is null
    or v_backup->>'previous_prompt_md5' is null
    or md5(v_current.settings->>'system_prompt') is distinct from v_backup->>'applied_prompt_md5'
    or md5(v_current.settings->>'system_prompt_v16_backup') is distinct from v_backup->>'previous_prompt_md5'
    or (v_current.settings->'tone') is distinct from (v_backup->'applied_tone')
    or v_current.business_hours is distinct from (v_backup->'applied_hours') then
    raise exception 'IC_SALON_V17_ROLLBACK_STATE_CHANGED';
  end if;

  update public.tenant_settings
  set business_hours = case when (v_backup->>'previous_hours_sql_null')::boolean then null
        else v_backup->'previous_hours' end,
      settings = (v_current.settings - array['prompt_revision', 'tone', 'system_prompt_v16_backup', 'salon_v17_rollback'])
        || (v_backup->'previous_settings')
        || jsonb_build_object('system_prompt', v_current.settings->>'system_prompt_v16_backup'),
      updated_at = now()
  where tenant_id = v_id;
end
$rollback$;

commit;

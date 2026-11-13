-- Reverte a v15: restaura o prompt v14 guardado literalmente pelo apply.
begin;

update public.tenant_settings s
set settings = (s.settings - 'system_prompt_v14_backup') || jsonb_build_object(
    'system_prompt', s.settings->>'system_prompt_v14_backup',
    'prompt_revision', 'ic_salon_recepcao_v14_primeira_mensagem'
  ), updated_at = now()
where s.tenant_id = '76aff8a0-0466-42b9-a80d-db186ff3d8bd'::uuid
  and exists (select 1 from public.tenants t where t.id = s.tenant_id and t.slug = 'ic_salon')
  and s.settings->>'prompt_revision' = 'ic_salon_recepcao_v15_abertura_lista'
  and length(coalesce(s.settings->>'system_prompt_v14_backup', '')) > 0;

commit;

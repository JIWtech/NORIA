-- Reverte a v13: restaura o prompt v12 guardado literalmente pelo apply e a revisão v12.
begin;

update public.tenant_settings s
set settings = (s.settings - 'system_prompt_v12_backup') || jsonb_build_object(
    'system_prompt', s.settings->>'system_prompt_v12_backup',
    'prompt_revision', 'ic_salon_recepcao_v12_servicos_curtos_cancelamento'
  ), updated_at = now()
where s.tenant_id = '76aff8a0-0466-42b9-a80d-db186ff3d8bd'::uuid
  and exists (select 1 from public.tenants t where t.id = s.tenant_id and t.slug = 'ic_salon')
  and s.settings->>'prompt_revision' = 'ic_salon_recepcao_v13_catalogo_frases_proprias'
  and length(coalesce(s.settings->>'system_prompt_v12_backup', '')) > 0;

commit;

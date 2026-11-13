-- Reverte a v14: restaura o prompt v13 e as observações do catálogo guardados literalmente pelo apply.
begin;

update public.tenant_settings s
set settings = (s.settings - 'system_prompt_v13_backup') || jsonb_build_object(
    'system_prompt', s.settings->>'system_prompt_v13_backup',
    'prompt_revision', 'ic_salon_recepcao_v13_alinhado_motor'
  ), updated_at = now()
where s.tenant_id = '76aff8a0-0466-42b9-a80d-db186ff3d8bd'::uuid
  and exists (select 1 from public.tenants t where t.id = s.tenant_id and t.slug = 'ic_salon')
  and s.settings->>'prompt_revision' = 'ic_salon_recepcao_v14_primeira_mensagem'
  and length(coalesce(s.settings->>'system_prompt_v13_backup', '')) > 0;

update public.tenant_service_catalog c
set notes = c.metadata->>'notes_v13', searchable_text = c.metadata->>'searchable_text_v13',
    metadata = c.metadata - 'notes_v13' - 'searchable_text_v13', updated_at = now()
where c.tenant_id = '76aff8a0-0466-42b9-a80d-db186ff3d8bd'::uuid
  and c.metadata ? 'notes_v13';

commit;

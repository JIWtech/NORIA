-- Reverte 22: restaura os textos de recibo e confirmação guardados pelo apply.
begin;

update public.tenant_settings s
set settings = jsonb_set(s.settings, '{appointment_request}', ((s.settings->'appointment_request') - 'templates_backup_v1') || jsonb_build_object(
    'received_template', s.settings->'appointment_request'->'templates_backup_v1'->>'received_template',
    'confirmation_template', s.settings->'appointment_request'->'templates_backup_v1'->>'confirmation_template',
    'review_handoff_template', s.settings->'appointment_request'->'templates_backup_v1'->>'review_handoff_template'
  )), updated_at = now()
where s.tenant_id = '76aff8a0-0466-42b9-a80d-db186ff3d8bd'::uuid
  and exists (select 1 from public.tenants t where t.id = s.tenant_id and t.slug = 'ic_salon')
  and s.settings->'appointment_request' ? 'templates_backup_v1';

commit;

-- Rollback: remove só o template de falta do I&C Salon; o painel volta ao padrão do código.
begin;
update public.tenant_settings ts
set settings = jsonb_set(ts.settings, '{appointment_outcome}', (ts.settings->'appointment_outcome') - 'no_show_message_template'),
    updated_at = now()
from public.tenants t
where t.id = ts.tenant_id and t.slug = 'ic_salon' and ts.settings->'appointment_outcome' ? 'no_show_message_template';
commit;

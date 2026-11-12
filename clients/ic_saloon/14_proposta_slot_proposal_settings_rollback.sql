-- Remove somente o par introduzido pela proposta, desde que ambos ainda sejam true.
begin;
do $$
declare target uuid; affected integer;
begin
 if (select count(*) from public.tenants where slug='ic_salon') <> 1 then
   raise exception 'IC_SALON_TENANT_CARDINALITY'; end if;
 select id into target from public.tenants where slug='ic_salon';
 if (select count(*) from public.tenant_settings where tenant_id=target) <> 1 then
   raise exception 'IC_SALON_SETTINGS_CARDINALITY'; end if;
 update public.tenant_settings s
 set settings=jsonb_set(s.settings,'{appointment_request}',(s.settings->'appointment_request')
   - 'slot_proposal_enabled' - 'slot_proposal_resolution_enabled' - 'slot_proposal_ttl_hours'),updated_at=now()
 where s.tenant_id=target and jsonb_typeof(s.settings)='object'
   and jsonb_typeof(s.settings->'appointment_request')='object'
   and s.settings->'appointment_request'->>'slot_proposal_enabled'='true'
   and s.settings->'appointment_request'->>'slot_proposal_resolution_enabled'='true';
 get diagnostics affected = row_count;
 if affected <> 1 then raise exception 'IC_SALON_FLAGS_CHANGED'; end if;
end $$;
commit;

-- PROPOSTA LOCAL: não aplicar. Requer RPCs, router e CORE aprovados e publicados.
-- Rollback: 14_proposta_slot_proposal_settings_rollback.sql.
-- Liga as duas chaves (envio e leitura da resposta; a proposta só funciona com ambas) e define o prazo padrão da
-- proposta enviada: slot_proposal_ttl_hours=48 (horas; depois disso a resposta tardia não aceita o horário antigo).
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
 set settings=jsonb_set(jsonb_set(jsonb_set(s.settings,'{appointment_request,slot_proposal_enabled}','true'::jsonb,true),
   '{appointment_request,slot_proposal_resolution_enabled}','true'::jsonb,true),
   '{appointment_request,slot_proposal_ttl_hours}','48'::jsonb,true),updated_at=now()
 where s.tenant_id=target and jsonb_typeof(s.settings)='object'
   and jsonb_typeof(s.settings->'appointment_request')='object'
   and s.settings->'appointment_request'->>'mode'='operator_confirmation'
   and not (s.settings->'appointment_request' ? 'slot_proposal_enabled')
   and not (s.settings->'appointment_request' ? 'slot_proposal_resolution_enabled')
   and not (s.settings->'appointment_request' ? 'slot_proposal_ttl_hours');
 get diagnostics affected = row_count;
 if affected <> 1 then raise exception 'IC_SALON_SETTINGS_CHANGED_OR_FLAGS_PRESENT'; end if;
end $$;
commit;

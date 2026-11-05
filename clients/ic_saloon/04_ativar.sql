-- I&C Salon: ATIVAÇÃO. Só rodar com a infraestrutura pronta:
--   1. variáveis *_IC_SALON no n8n e no n8n-runner (e ambos reiniciados);
--   2. serviço noria-ingress-ic-salon no ar (GET /healthz = {"status":"listening"});
--   3. instância ic_saloon da Evolution conectada (state = open).
-- Depois de rodar, conecte o webhook da Evolution (ver docs/operations/ic_salon_infra.md).
--
-- Para DESLIGAR de novo: troque para ai_enabled=false, whatsapp_processing_mode='disabled' e enabled=false.

update public.tenant_settings
set settings = settings || jsonb_build_object(
      'ai_enabled', true,
      'whatsapp_processing_mode', 'conversation_core_v1',
      'onboarding_status', 'completed')
where tenant_id = (select id from public.tenants where slug = 'ic_salon');

update public.conversation_turn_ingress_sources
set enabled = true
where tenant_id = (select id from public.tenants where slug = 'ic_salon') and instance_name = 'ic_saloon';

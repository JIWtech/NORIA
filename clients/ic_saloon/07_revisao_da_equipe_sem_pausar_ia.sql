-- Aplicar somente após a publicação do CORE e do roteador de comandos compatíveis.
-- Rollback: remover team_review_control, reply_mode e updated_template de appointment_request deste tenant.
with policy as (select jsonb_build_object(
  'team_review_control', 'manual_reply',
  'reply_mode', 'contextual',
  'updated_template', 'Pedido atualizado para {servicos}, {data}, às {hora}. A equipe ainda vai confirmar o horário por aqui.') as settings)
update public.tenant_settings s
set settings = jsonb_set(s.settings, '{appointment_request}', (s.settings->'appointment_request') || policy.settings)
from public.tenants t cross join policy
where t.id = s.tenant_id
  and t.slug = 'ic_salon'
  and s.settings->'appointment_request'->>'mode' = 'operator_confirmation'
  and not (s.settings->'appointment_request' @> policy.settings);

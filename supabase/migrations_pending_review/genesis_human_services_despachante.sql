-- Gênesis (wesley_automoveis): declara o serviço de despachante como atendido pela equipe.
-- Usado pelo CORE (business_facts.human_services): pedido sobre documentação do veículo é
-- confirmado com o texto abaixo, transferido para a fila humana e atribuído ao atendente padrão.
-- Mudança aditiva de dados (sem schema). Rollback ao final.
update tenant_settings ts
set settings = jsonb_set(ts.settings, '{business_facts,human_services}', '[
  {
    "id": "despachante",
    "name": "Serviço de despachante",
    "description": "Regularização, transferência, licenciamento, segunda via e demais serviços de documentação de veículos",
    "confirmation": "Fazemos sim! A loja faz serviço de despachante."
  }
]'::jsonb, true)
from tenants t
where t.id = ts.tenant_id and t.slug = 'wesley_automoveis'
returning ts.settings->'business_facts'->'human_services' as human_services;

-- Rollback:
-- update tenant_settings ts set settings = ts.settings #- '{business_facts,human_services}'
-- from tenants t where t.id = ts.tenant_id and t.slug = 'wesley_automoveis';

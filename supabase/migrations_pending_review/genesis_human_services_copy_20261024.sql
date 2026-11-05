-- Gênesis (wesley_automoveis): textos dos serviços declarados, feedback do usuário em 24/10.
-- 1) busca_veiculo: a IA não promete que consegue o veículo; diz que a equipe pode verificar com parceiros.
-- 2) despachante: responde pelo que o cliente perguntou (documentação), sem o jargão "despachante".
-- Mudança de dados (sem schema). Substitui só confirmation/description pelo id; demais campos e itens preservados.
update tenant_settings ts
set settings = jsonb_set(ts.settings, '{business_facts,human_services}', (
  select jsonb_agg(case s->>'id'
    when 'busca_veiculo' then s || '{
      "description": "O cliente procura um veículo específico (marca, modelo ou ano) que não está no estoque anunciado: a equipe pode verificar com lojas parceiras e locadoras se consegue o veículo",
      "confirmation": "Esse modelo não está no nosso estoque agora, mas a nossa equipe pode verificar com lojas parceiras se consegue ele pra você!"
    }'::jsonb
    when 'despachante' then s || '{
      "confirmation": "Sim! A loja cuida da documentação do seu veículo, como transferência, licenciamento e regularização."
    }'::jsonb
    else s end order by ord)
  from jsonb_array_elements(ts.settings->'business_facts'->'human_services') with ordinality as e(s, ord)))
from tenants t
where t.id = ts.tenant_id and t.slug = 'wesley_automoveis'
  and ts.settings->'business_facts'->'human_services' @> '[{"id": "busca_veiculo", "confirmation": "Conseguimos buscar esse veículo pra você!"}]'::jsonb
returning ts.settings->'business_facts'->'human_services' as human_services;

-- Rollback:
-- update tenant_settings ts set settings = jsonb_set(ts.settings, '{business_facts,human_services}', (
--   select jsonb_agg(case s->>'id'
--     when 'busca_veiculo' then s || '{"description": "O cliente procura um veículo específico (marca, modelo ou ano) que não está no estoque anunciado: a loja consegue o veículo com lojas parceiras e locadoras", "confirmation": "Conseguimos buscar esse veículo pra você!"}'::jsonb
--     when 'despachante' then s || '{"confirmation": "Fazemos sim! A loja faz serviço de despachante."}'::jsonb
--     else s end order by ord)
--   from jsonb_array_elements(ts.settings->'business_facts'->'human_services') with ordinality as e(s, ord)))
-- from tenants t where t.id = ts.tenant_id and t.slug = 'wesley_automoveis';

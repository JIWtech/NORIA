-- Gênesis (wesley_automoveis): feedback do dono em 23/10.
-- 1) Não listar o estoque sem critério do cliente; com critério, no máximo 3 opções.
-- 2) Veículo que não está no estoque: a loja busca em parceiros/locadoras; a IA confirma, transfere e atribui.
-- Requer o CORE com sales.catalog_presentation e human_services.requires (commits b68f5a2 e 6a045ce) publicado.
-- Mudança aditiva de dados (sem schema). Rollback ao final.
update tenant_settings ts
set settings = jsonb_set(
  jsonb_set(ts.settings, '{sales,catalog_presentation}', '{"list_requires_criteria": true, "max_items": 3}'::jsonb, true),
  '{business_facts,human_services}',
  coalesce(ts.settings->'business_facts'->'human_services', '[]'::jsonb)
    || '[{
      "id": "busca_veiculo",
      "name": "Busca de veículo fora do estoque",
      "description": "O cliente procura um veículo específico (marca, modelo ou ano) que não está no estoque anunciado: a loja consegue o veículo com lojas parceiras e locadoras",
      "requires": "no_inventory_product",
      "confirmation": "Conseguimos buscar esse veículo pra você!"
    }]'::jsonb,
  true)
from tenants t
where t.id = ts.tenant_id and t.slug = 'wesley_automoveis'
  and not (coalesce(ts.settings->'business_facts'->'human_services', '[]'::jsonb) @> '[{"id": "busca_veiculo"}]'::jsonb)
returning ts.settings->'sales'->'catalog_presentation' as catalog_presentation,
          ts.settings->'business_facts'->'human_services' as human_services;

-- Opcional (decisão do negócio): sem job de sincronização ativo, ligar o limite de idade esconde todo o estoque
-- até a planilha voltar a sincronizar.
-- update tenant_settings ts set settings = jsonb_set(ts.settings, '{sales,inventory_max_age_hours}', '48'::jsonb, true)
-- from tenants t where t.id = ts.tenant_id and t.slug = 'wesley_automoveis';

-- Rollback:
-- update tenant_settings ts set settings = jsonb_set(ts.settings #- '{sales,catalog_presentation}', '{business_facts,human_services}',
--   (select coalesce(jsonb_agg(s), '[]'::jsonb) from jsonb_array_elements(ts.settings->'business_facts'->'human_services') s where s->>'id' <> 'busca_veiculo'))
-- from tenants t where t.id = ts.tenant_id and t.slug = 'wesley_automoveis';

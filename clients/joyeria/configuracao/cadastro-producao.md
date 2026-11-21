# JOYERÍA — cadastro em produção (NORIA-prod)

Executado em 2026-11-21, com autorização explícita do responsável.

## O que foi feito

1. **Migration do catálogo** `supabase/migrations/20261121000901_product_catalog.sql` (versão remota `20261121000901`).
   Antes de aplicar: teste em PGlite com 44 verificações (RLS, isolamento por tenant, privilégios, rollback) e conferência
   das funções usadas (`is_active_tenant_member`, `touch_updated_at`, `prevent_tenant_reparent`). Depois: 4 tabelas com
   RLS ativo, uma política de leitura por membro ativo, sem acesso para `anon` e sem escrita para `authenticated`.
2. **Tenant** `joyeria` (id `1dc637b1-2f4f-4bd0-a88b-5ccd516dcf74`), no mesmo padrão do onboarding
   (`magia_create_tenant_onboarding`), com slug fixo:
   - usuária já existente no Supabase Auth vinculada como `owner` ativa (o e-mail não fica no repositório);
   - quadro "Atendimento" com 4 colunas (Conversas IA, Aguardando humano, Atendimento humano, Finalizadas);
   - canal WhatsApp `pending`, **sem instância** (`external_id` nulo): nenhuma mensagem é roteada;
   - `tenant_settings` a partir de `tenant_settings_proposta.json` + `prompts/system_prompt_v1.txt`, com tudo desligado:
     `ai_enabled=false`, `whatsapp_processing_mode='disabled'`, `noria_turn_pipeline.enabled=false`,
     `pilot.allowed_contacts=[]`, `onboarding_status='pending_configuration'`; `noria_client_policy.tenant_id` = id real.

3. **Fonte de ingresso** `09ff87e6-b1fd-463e-b973-61a1fff01297` (instância `joyeria`, **desativada**), com usuário de
   serviço `noria.ingress.joyeria@example.invalid` criado pelo responsável no Supabase Auth (senha fora do repositório,
   sem vínculo com tenant). Canal com `external_id='joyeria'`, ainda `pending`.

## Falta (cada item exige autorização)

- Carga do catálogo e upload das fotos (`scripts/product_catalog_load.cjs`, bucket público `product-catalog`).
- Workflows: publicar o CORE regenerado e a EXT `NORIA-EXT-JOYERIA-Decisao-Comercial` (ID em `NORIA_RETAIL_EXT_WORKFLOW_ID`).
- Instância Evolution no canal (`external_id`, `config.instance_name`), variáveis `EVOLUTION_*_JOYERIA` e
  `NORIA_INGRESS_FORWARD_TOKEN_JOYERIA` no n8n e no runner, fonte de ingresso e serviço de ingresso no Easypanel.
- Número de teste em `noria_turn_pipeline.pilot.allowed_contacts`; depois `ai_enabled`, modo de processamento e pipeline.

## Rollback

- Cadastro (sem conversas): desativar com `update tenants set status='inactive' where slug='joyeria'` ou remover as linhas
  do tenant (settings, canal, colunas, quadro, membro, tenant), nessa ordem, enquanto não houver eventos.
- Migration: `supabase/migrations_pending_review/20261120200000_product_catalog.rollback.sql` (recusa se houver dados).

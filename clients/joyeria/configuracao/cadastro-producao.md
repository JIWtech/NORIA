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

4. **Catálogo** (2026-11-21): 16 alianças blend do PDF ofertáveis, 32 origens, 30 fotos no bucket `product-catalog`
   (conferidas por SHA-256 depois do envio, `catalogo_pdf/subir_fotos.cjs`) e 32 vínculos aprovados. Produtos do site
   ficaram de fora por decisão do responsável.
5. **Workflows** (2026-11-21): EXT `vE8rPAAdzkkVzPBG` criada e ativa; Motor `mlKNPv862H2g3Gap` e Roteador
   `3N5oN6sxtir9lFrA` publicados com `scripts/publish_retail_chain.cjs` (travas: só nós novos `CORE | Retail |`, ponto de
   entrada só com o desvio retail inserido antes de "Serviços | Núbia v2?"). Testes antes: 220/220 (retail e outros
   clientes). Backup e recibos em `.local/deploy_backups/retail-joyeria-2026-11-21T02-18-33-035Z/`. Regerar com
   `NORIA_RETAIL_EXT_WORKFLOW_ID=vE8rPAAdzkkVzPBG`.

## Falta (cada item exige autorização)

- Produtos do site (prata, aço, semijoias) e suas fotos, quando o responsável decidir.
- Instância Evolution no canal (`external_id`, `config.instance_name`), variáveis `EVOLUTION_*_JOYERIA` e
  `NORIA_INGRESS_FORWARD_TOKEN_JOYERIA` no n8n e no runner, fonte de ingresso e serviço de ingresso no Easypanel.
- Número de teste em `noria_turn_pipeline.pilot.allowed_contacts`; depois `ai_enabled`, modo de processamento e pipeline.

## Rollback

- Cadastro (sem conversas): desativar com `update tenants set status='inactive' where slug='joyeria'` ou remover as linhas
  do tenant (settings, canal, colunas, quadro, membro, tenant), nessa ordem, enquanto não houver eventos.
- Migration: `supabase/migrations_pending_review/20261120200000_product_catalog.rollback.sql` (recusa se houver dados).
- Workflows: repor com PUT os JSON do backup acima (Motor e Roteador) e ativar; desativar a EXT `vE8rPAAdzkkVzPBG`.
- Catálogo: `update product_catalog_items set offerable=false, active=false where tenant_id=<id>` (sem apagar).

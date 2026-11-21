# Inventário de `migrations_pending_review`

Leitura local em 21/11/2026. Este índice descreve os 59 arquivos encontrados na pasta (57 SQL, um documento de referência e este README), sem mover ou executar nada. “Aplicada” significa que há registro documental local de evidência de produção, não uma verificação ao vivo nesta rodada. Status sem evidência específica ficam como **a confirmar**. A pasta contém SQL de schema, alterações de dados/configuração de tenants, rollbacks e propostas; o nome da pasta não determina o estado remoto.

## Evidência e uso

- [Retrato de estrutura](../../.agents/context/estrutura-atual-2026-11-21.md#3-banco-de-produção-schema-public) registra as migrações recentes até `20261121000901_product_catalog` e informa que há arquivos pendentes de revisão.
- [Auditoria de arquitetura](../../docs/operations/auditoria_arquitetura_2026-11-21.md#ajustes-da-conferência) confirma deriva de nomes/versões entre o histórico de produção e arquivos locais, sem implicar mudança de banco.
- O inventário de 24/10 abaixo documenta inspeção do banco naquela data para um subconjunto. Ele é evidência histórica, não estado atual garantido.
- [Inventário de 24/10](../../docs/archive/reports/noria_post_publish_errors_and_migration_inventory_2026-10-24.md#4-inventário-de-migrações) e [aplicações autorizadas de 24/10](../../docs/archive/reports/noria_authorized_apply_2026-10-24.md) dão evidência nominal/funcional para alguns arquivos.
- [Estado CORE de 21/10](../../docs/operations/estado_producao_core_2026-10-21.md#banco-supabase) registra aplicação de dois SQLs de dados/configuração.
- Referências a scripts abaixo indicam cobertura local ou consumo de fixture; **não** comprovam aplicação em produção.

Não se deve reaplicar em lote: arquivos antigos podem ser substituídos por revisões, e rollback desfaz estado. Confira o estado remoto e o histórico antes de qualquer operação autorizada.

## Arquivos

| Arquivo | Classificação/status pela evidência local | Evidência local | Referências diretas em scripts/testes |
|---|---|---|---|
| `030_appointment_outcomes_no_show_rollback.sql` | Rollback | Reverte funções/índice da migração 030; a própria anotação do arquivo descreve o rollback. | Nenhuma referência direta localizada. |
| `031_appointment_requests_rollback.sql` | Rollback | Reverte funções/índice de 031; exige verificar pedidos pendentes e settings antes. | Nenhuma referência direta localizada. |
| `032_kanban_column_presentation_rollback.sql` | Rollback | Reverte campos lidos pelo painel atual; arquivo exige publicar painel anterior primeiro. | Nenhuma referência direta localizada. |
| `033_stale_turn_terminal_evidence_rollback.sql` | Rollback | Reverte a função 033 e remove prova antiga. | `scripts/test_stale_turn_terminal_evidence.cjs` |
| `034_appointment_manage_actions_rollback.sql` | Rollback | Remove funções da proposta 034; nota diz não alterar agendamentos. Contexto: `.agents/context/noria-core-ext-salon-nubia-handoff.md`. | Nenhuma referência direta localizada. |
| `fase2_boundary.PROPOSAL.sql` | Proposta da Fase 2, não aplicada | Proposta para revisão de fronteiras/isolamento; sem evidência de aplicação. | `scripts/test_fase2_boundary_proposal.cjs` |
| `fase2_boundary.ROLLBACK.PROPOSAL.sql` | Rollback proposto, não aplicado | Par da proposta; não representa rollback de produção. | `scripts/test_fase2_boundary_proposal.cjs` |
| `20261017180000_genesis_inventory_vehicle_images.sql` | Aplicada, registro histórico | Inventário de 24/10 registra versão `20261020013518` e tabela existente; comentário SQL pedia revisão de mapeamento/hash. | Nenhuma referência direta localizada. |
| `20261017190000_enable_sales_leads_realtime_optional.sql` | Não aplicada na inspeção de 24/10; estado atual a confirmar | Naquela inspeção não estava na publicação realtime e `REPLICA IDENTITY` era `default`. | Nenhuma referência direta localizada. |
| `20261019210000_sales_assignment_preserves_human_stage.rollback.sql` | Rollback | Restaura corpos observados em produção em 19/10; evidência no cabeçalho do SQL. | Nenhuma referência direta localizada. |
| `20261019210000_sales_assignment_preserves_human_stage.sql` | Aplicada, registro histórico | Inventário de 24/10 diz registrada e corpos das duas funções coincidentes. | Nenhuma referência direta localizada. |
| `20261020010000_gemini_tenant_daily_budget.rollback.sql` | Rollback | SQL avisa republicar CORE anterior antes; preserva tabelas de auditoria. | Nenhuma referência direta localizada. |
| `20261020010000_gemini_tenant_daily_budget.sql` | Aplicada, registro histórico | Inventário de 24/10 registra migração e corpo coincidente para `magia_gemini_reserve`. | Nenhuma referência direta localizada. |
| `20261021000000_genesis_follow_up_disposition_actions.PROPOSAL.rollback.sql` | Rollback de proposta | Nome/conteúdo indicam rollback da proposta; aplicação a confirmar. | Nenhuma referência direta localizada. |
| `20261021000000_genesis_follow_up_disposition_actions.PROPOSAL.sql` | Proposta, não aplicada em 24/10 | Inventário registra coluna ausente naquela inspeção. | Nenhuma referência direta localizada. |
| `20261109163222_genesis_preserve_sales_stage_on_conversation_close.rollback.sql` | Rollback | Migração correspondente está versionada em `supabase/migrations/`. | Nenhuma referência direta localizada. |
| `20261113000000_appointment_requests_one_per_recipient.sql` | Proposta/estado remoto a confirmar | Está na pasta de revisão; cobertura local não prova aplicação. | `scripts/test_appointment_request_per_recipient_sql.cjs` |
| `20261113000000_appointment_requests_one_per_recipient_rollback.sql` | Rollback de proposta | Par da migração; teste local carrega ambos. | `scripts/test_appointment_request_per_recipient_sql.cjs` |
| `20261113000100_salon_appointment_outcomes.sql` | Proposta/estado remoto a confirmar | Testes locais não provam produção. | `scripts/test_appointment_outcomes.cjs`; `scripts/test_slot_proposal_sql.cjs`; `scripts/test_fase2_boundary_proposal.cjs` |
| `20261113000100_salon_appointment_outcomes_rollback.sql` | Rollback de proposta | Carregado em cenário local. | `scripts/test_appointment_outcomes.cjs` |
| `20261120200000_product_catalog.rollback.sql` | Rollback | Migração versionada com nome/versão divergente está em `supabase/migrations/20261121000901_product_catalog.sql`. | `supabase/tests/product_catalog_migration.pglite.mjs` |
| `channel_media_exact_tenant_scope.PROPOSAL.sql` | Aplicada, registro histórico | Apesar do sufixo PROPOSAL, inventário de 24/10 registra aplicação como `20261024025505`. | `scripts/test_storage_tenant_scope.cjs` |
| `genesis_catalog_presentation_and_sourcing.sql` | Efeito aplicado; texto local pode estar desatualizado | Inventário de 24/10 encontrou limite de itens e serviço `busca_veiculo`. | Nenhuma referência direta localizada. |
| `genesis_human_services_copy_20261024.sql` | Efeito aplicado; estado exato pode ter evoluído | Relatório de aplicação de 24/10 registra textos aplicados. | Nenhuma referência direta localizada. |
| `genesis_human_services_despachante.sql` | Efeito aplicado e posteriormente substituído | Inventário de 24/10 registra serviço existente e confirmação original substituída. | Nenhuma referência direta localizada. |
| `genesis_prompt_v14_21_photos_no_error.sql` | Versão antiga, superada; não reaplicar | Inventário de 24/10 registra v14.21 superada por v14.25. | Nenhuma referência direta localizada. |
| `genesis_prompt_v14_22_photo_flow.sql` | Aplicada, registro histórico | Estado CORE de 21/10 registra aplicação às 19h49, substituindo v14.21. | Nenhuma referência direta localizada. |
| `genesis_prompt_v14_23_photo_availability.sql` | A confirmar | Nenhuma evidência específica de produção localizada; numeração não prova aplicação. | Nenhuma referência direta localizada. |
| `genesis_prompt_v14_24_sale_year.sql` | A confirmar | Nenhuma evidência específica localizada. | Nenhuma referência direta localizada. |
| `ic_salon_no_show_message_template.sql` | A confirmar | Sem evidência específica de produção localizada. | Nenhuma referência direta localizada. |
| `ic_salon_no_show_message_template_rollback.sql` | Rollback | Par do SQL acima; estado da alteração em produção a confirmar. | Nenhuma referência direta localizada. |
| `ingress_landline_commercial_v1.sql` | A confirmar | Fixture é evidência local de teste, não de aplicação. | `scripts/test_ingress_landline_commercial.cjs`; `supabase/tests/fixtures/attest_turn_ingress_prod_2026_10_27.sql` |
| `ingress_landline_commercial_v1_cancel_pending.sql` | A confirmar; alteração de dados pontual | Comentário relata fotografia de 27/10, não execução. | Nenhuma referência direta localizada. |
| `ingress_landline_commercial_v1_rollback.sql` | Rollback | Par do SQL de ingresso. | `scripts/test_ingress_landline_commercial.cjs` |
| `nubia_audience_name_prompt_v7.sql` | Seed/configuração de cliente, a confirmar | Atualiza `tenant_settings`; não altera schema. | Nenhuma referência direta localizada. |
| `nubia_audience_name_prompt_v7_rollback.sql` | Rollback de configuração | Reverte o prompt v7; execução em produção a confirmar. | Nenhuma referência direta localizada. |
| `nubia_context_prompt_v6.sql` | Seed/configuração de cliente, a confirmar | Arquivo de prompt/configuração. | `scripts/build_nubia_context_prompt.cjs`; `scripts/test_semantic_contact_ignore_rpc.cjs` |
| `nubia_context_prompt_v6_rollback.sql` | Rollback de configuração | Reverte o prompt v6; aplicação a confirmar. | `scripts/build_nubia_context_prompt.cjs`; `scripts/test_semantic_contact_ignore_rpc.cjs` |
| `nubia_diva_persona_v8.sql` | Seed/configuração de cliente, a confirmar | Atualiza dados/configuração de tenant. | Nenhuma referência direta localizada. |
| `nubia_diva_persona_v8_rollback.sql` | Rollback de configuração | Par do prompt v8; aplicação a confirmar. | Nenhuma referência direta localizada. |
| `nubia_diva_v10.sql` | Seed/configuração de cliente, a confirmar | SQL local examinado pelo teste. | `scripts/test_booking_authorization.cjs` |
| `nubia_diva_v11.sql` | Seed/configuração de cliente, a confirmar | SQL local examinado pelo teste. | `scripts/test_booking_authorization.cjs` |
| `nubia_pix_regras_v9.sql` | Seed/configuração de cliente, a confirmar | Atualiza dados/configuração. | Nenhuma referência direta localizada. |
| `nubia_pix_regras_v9_rollback.sql` | Rollback de configuração | Par do v9; aplicação/reversão a confirmar. | Nenhuma referência direta localizada. |
| `prompt_contract_alignment_20261023.sql` | Aplicada, conteúdo confirmado historicamente | Inventário de 24/10 relata hashes MD5 dos prompts correspondentes. | Nenhuma referência direta localizada. |
| `prompt_contract_alignment_20261023_rollback.sql` | Rollback | Relatório de aplicação autorizada documenta guards contra apagar edições posteriores. | Nenhuma referência direta localizada. |
| `semantic_automated_contact_ignore_v1.sql` | A confirmar | Teste local não confirma aplicação. | `scripts/test_semantic_contact_ignore_rpc.cjs` |
| `semantic_automated_contact_ignore_v1_rollback.sql` | Rollback, estado remoto a confirmar | Execução depende de verificar estado e dependências. | Nenhuma referência direta localizada. |
| `slot_proposal_v1.sql` | A confirmar | SQL carregado em teste local; plano operacional descreve a proposta. | `scripts/test_slot_proposal_sql.cjs` |
| `slot_proposal_v1_rollback.sql` | Rollback, estado remoto a confirmar | Par da proposta. | `scripts/test_slot_proposal_sql.cjs` |
| `turn_control_fromme_manual_reply_v1.sql` | Aplicada, evidência de 21/10; backfill não certificado | Inventário de 24/10 ressalva que corpos coincidentes não provam backfill integral. | `scripts/test_turn_control_fromme.cjs`; `supabase/tests/fixtures/turn_control_prod_2026_10_21.sql` |
| `turn_control_fromme_manual_reply_v1_rollback.sql` | Rollback | Referenciado nos registros de 21/10 e 24/10. | Nenhuma referência direta localizada. |
| `turn_fail_provider_rejected_v1.sql` | A confirmar | Cobertura local não comprova aplicação. | `scripts/test_turn_fail_provider_rejected.cjs` |
| `turn_fail_provider_rejected_v1_rollback.sql` | Rollback, estado remoto a confirmar | Carregado em teste local. | `scripts/test_turn_fail_provider_rejected.cjs` |
| `turn_queue_closure_recovery_v1.sql` | Aplicada, registro histórico | Inventário de 24/10 registra funções coincidentes. | `scripts/test_turn_fail_provider_rejected.cjs`; `scripts/test_fase2_boundary_proposal.cjs` |
| `turn_queue_lifecycle_v1.sql` | Aplicada com revisões posteriores; não reaplicar inteira | Inventário de 24/10 registra somente 20/26 corpos coincidentes após patches. | `scripts/build_noria_workflows.cjs`; `scripts/test_turn_fail_provider_rejected.cjs` |
| `turn_queue_retry_provisioning_v1.sql` | Aplicada, registro histórico | Inventário de 24/10 registra corpos das duas funções coincidentes. | `scripts/test_turn_fail_provider_rejected.cjs` |
| `reference/turn_queue_production_20261018.md` | Referência/snapshot, nunca migração | Cabeçalho declara snapshot somente leitura e alerta sobre descarte inseguro e ausência de retry durável. | Não é SQL; nenhuma referência direta localizada. |

## Referências de scripts e testes

Cobertura/consumo localizado no repositório: `scripts/build_noria_workflows.cjs` (referência declarativa a lifecycle); `scripts/build_nubia_context_prompt.cjs`; `scripts/test_appointment_outcomes.cjs`; `scripts/test_appointment_request_per_recipient_sql.cjs`; `scripts/test_booking_authorization.cjs`; `scripts/test_ingress_landline_commercial.cjs`; `scripts/test_prompt_contract_patch.cjs`; `scripts/test_semantic_contact_ignore_rpc.cjs`; `scripts/test_slot_proposal_sql.cjs`; `scripts/test_stale_turn_terminal_evidence.cjs`; `scripts/test_storage_tenant_scope.cjs`; `scripts/test_turn_control_fromme.cjs`; `scripts/test_turn_fail_provider_rejected.cjs`; `supabase/tests/product_catalog_migration.pglite.mjs`; `supabase/tests/product_catalog_load.pglite.mjs`.

Fixtures que mencionam SQL não são confirmação de produção: `supabase/tests/fixtures/attest_turn_ingress_prod_2026_10_27.sql` e `supabase/tests/fixtures/turn_control_prod_2026_10_21.sql`. Verifique nomes de arquivo e chamadas com `rg -n "migrations_pending_review" scripts supabase`.

## Limites deste inventário

Esta rodada consultou apenas o repositório. Não conectou ao Supabase, não conferiu o histórico remoto atual, dados/configurações atuais, grants, publicação realtime nem conteúdo vivo das funções. A expressão “aplicada” nas linhas pertinentes é sustentada por relatórios históricos locais e pode ter sido alterada desde então. “A confirmar” é falta de evidência neste escopo, não prova de ausência em produção. O retrato de 21/11 lista seeds conhecidos sob `supabase/seeds/`; nenhum arquivo desta pasta é identificado ali como seed executável geral, embora os SQLs `nubia_*` e `genesis_*` atualizem dados/configuração de clientes.

# Estrutura atual do NORIA (2026-11-21)

Retrato montado pelo Gemini e conferido pelo orquestrador. Origem de cada dado: `[código]` repositório, `[banco]` leitura de produção (schema, tenants, migrações; sem dados de clientes), `[n8n]` workflows exportados. Atualize este arquivo quando a arquitetura, o banco ou os workflows mudarem.

## 1. Arquitetura `[código]`

- **Roteador** (`n8n/sources/noria_router.js`): workflow pai. Valida `tenant_id` + slug ativo + canal/instância no Supabase (fail-closed), escolhe extensão e pipeline e mantém o lote em andamento preso ("pinado") à versão que o iniciou.
- **Despachante** (`noria_turn_dispatch.js`): confere o ciclo de vida (`magia_turn_lifecycle_status`), faz um único `magia_claim_turn`, valida o escopo e grava o pino do lote. `request_id = <last_event_id>:<token>`.
- **Gemini**: interpreta intenção e entidades com `evidence_ids` e redige só com fatos autorizados. Nunca decide política comercial. Modelo vem de `settings.ai_model`/`semantic_model`.
- **EXT**: só lê o Supabase, aplica a política comercial do tenant e devolve ações autorizadas ou recusadas. Não escreve, não envia WhatsApp e não chama o Gemini.
- **CORE** (`noria_core.js` + `noria_retail.js`): motor genérico, sem slug nem regra comercial. Fases `single|prepare|availability|finalize` (`noria_engine_phase_v1`). Confere identidade e contrato da EXT antes de qualquer efeito, executa RPCs, mídia e avisos, redige, audita e entrega (`commit → begin → provedor → confirm → finish`).

### Pipelines por tenant `[código][banco]`

| Pipeline | Perfil / contrato | Fases | Tenants |
|---|---|---|---|
| `services_v1` | `services_booking_v2` / `noria_turn_pipeline_v1` | EXT bootstrap → dispatch → prepare → EXT decide → availability → EXT decide → finalize | `clinica_nubia_oficial` |
| `retail_v1` | `retail_consultative_v1` / `noria_turn_pipeline_v1` | dispatch → prepare (recorte do catálogo) → EXT decide → finalize (texto, fotos, aviso à especialista) | `joyeria` (rollout `all`, número de teste) |
| `sales_v1` | `vehicle_sales_v1` / `noria_commercial_decision_v1` | dispatch Gênesis → gate → EXT turno → prepare → gate → EXT comercial → finalize | `wesley_automoveis` |
| Motor próprio do Salon | adaptador `clients/ic_saloon/salon_engine.js` | rota direta no motor, validando tenant, slug e instância | `ic_salon` |
| Legado (`single`) | `conversation_core_v1` | EXT (quando houver) → motor `single` | `noria`, reversão da Núbia v1 |
| `royal_stock_v1` | desligado por padrão no roteador | responde ACK sem EXT | `royal_4x4` |

Seleção: `settings.noria_turn_pipeline` com `contract: noria_turn_pipeline_v1` e `capability` `services_v1` ou `retail_v1` (o retail também exige o perfil `retail_consultative_v1`). Fora disso, vale o caminho legado.

### Contrato EXT → CORE `[código]`

- Envelope: `{ noria_phase, commercial_decision, commercial_decision_status: ok|refused|error, commercial_decision_error, commercial_identity }`.
- O CORE confere `contract`, `provenance`, versão, status e a igualdade exata de `tenant_id`, `tenant_slug`, `instance`, `remote_jid`, `session_id`, `request_id` e `turn_token` antes de qualquer efeito.
- `refused` → contingência neutra com handoff. `error`, identidade ou proveniência inválida → exceção antes dos efeitos e `magia_fail_turn` (retry ou revisão humana).
- Ações `services_v1`: `present_information`, `check_availability`, `create_reservation` (idempotente por lote), `forward_payment_declaration`, `confirm_payment` (sempre falso), `handoff`, `follow_up`.
- Ações `retail_v1`: `present_information`, `send_product_media` (até 4 fotos aprovadas), `send_site_link`, `notify_specialist` (um aviso idempotente por conversa e sessão, sem pausar a IA), `handoff`.

### Redator, auditor e recomposição `[código]`

- **services_v1** (`servicesComposeAudited`):
  1. O redator devolve `reply`, `block_keys` (anexados literalmente) e `claims` tipadas.
  2. `servicesAudit` faz a auditoria determinística: claims × autoridades, R$, datas e horários.
  3. `servicesSemanticAudit` é o auditor semântico: Gemini sem persona, temperatura 0. Confere citação literal, polaridade, cobertura dos pedidos e abertura repetida. Há uma recomposição por ramo (preparo, abertura e falha recomponível). A reprovação final leva à contingência com handoff.
- **retail_v1** (`runRetailTurnFinalize`): plano de fotos → redator → auditoria determinística (preço, URL, telefone, promessa indevida, acentuação, negativa) → uma recomposição. Fotos e aviso saem depois do texto, se a continuidade confirmar.
- **sales_v1**: geração estruturada com uma regeneração e validação contra `fact_ledger`. Sem resposta segura, segura o atendimento ou passa para humano.

## 2. Workflows no n8n `[n8n][código]`

| Workflow | ID | Fonte canônica |
|---|---|---|
| NORIA CORE Motor Conversacional Compartilhado | `mlKNPv862H2g3Gap` | `noria_core.js` + `noria_retail.js` |
| NORIA CORE Roteador WhatsApp, Comandos e Follow-ups | `3N5oN6sxtir9lFrA` | `noria_router.js`, `noria_turn_dispatch.js`, `n8n/code/*.js` |
| NORIA EXT Gênesis Automóveis Política Comercial | `fXGorIlPbyf9Qtsp` | `genesis_extension.js` + `genesis_tenant_identity.js` |
| NORIA EXT IC Salon Atendimento e Agendamentos | `yxdKP0PeskDMUFSo` | `clients/ic_saloon/salon_engine.js` |
| NORIA EXT JOYERÍA Decisão Comercial | `vE8rPAAdzkkVzPBG` | `joyeria_extension.js` |
| NORIA EXT NORIA Política | `sLxNG9o2falquchd` | `noria_extension.js` |
| NORIA EXT Núbia NB Bronze Catálogo de Serviços (v2) | `6jSiEH2ugboYSack` | `nubia_extension.js` |
| NORIA EXT Núbia NB Bronze Política de Atendimento (v1, reversão) | `vCDXJLqIBCZJRTVv` | export mantido por ID |
| NORIA UTIL WhatsApp Fotos de Perfil | `rvAsu0RdGTk98sWq` | `n8n/code/whatsapp_avatar_refresh.js` |

O estado ativo/inativo de cada um não foi conferido ao vivo neste retrato. Confira no n8n antes de assumir.

### Publicação segura `[código]`

1. Nunca edite o JSON à mão. Altere a fonte canônica e rode `node scripts/build_noria_workflows.cjs` (`NORIA_BUILD_OUT_DIR` valida sem sujar `n8n/workflows/`). Os exports em `n8n/workflows/` são gitignored.
2. Mudança só de código: `node scripts/publish_exports_by_id.cjs check` → revisar → `apply`. Só o `jsCode` muda, com backup em `.local/deploy_backups/<ts>/` e verificação SHA-256.
3. Nós novos da cadeia retail: `node scripts/publish_retail_chain.cjs check` → `apply`.
4. Rollback: repor o JSON do backup pelo mesmo ID e reativar. Para pipelines novos, `settings.noria_turn_pipeline.enabled = false`.
5. Publicar, alterar produção, aplicar migração ou enviar WhatsApp real exige autorização explícita.

## 3. Banco de produção (schema `public`) `[banco]`

Todas as tabelas têm RLS ativo. O número entre parênteses é a quantidade de políticas: 0 significa acesso só por `service_role` ou RPC `SECURITY DEFINER`. O painel lê com `is_active_tenant_member(tenant_id)`.

| Domínio | Tabelas (políticas) | Pontos-chave |
|---|---|---|
| Tenants e acesso | `tenants(3)`, `tenant_members(5)`, `tenant_settings(4)`, `users(6)`, `teams(8)`, `team_agents(4)`, `audit_logs(2)` | `tenant_settings.settings` (jsonb): `system_prompt`, `ai_model`, `approved_messages`, `noria_turn_pipeline`, `noria_client_policy`, `retail_policy`, `pilot`; `business_hours`, `timezone` |
| Canais e eventos | `channels(8)`, `channel_events(5)`, `conversations(8)`, `messages(5)`, `contacts(8)`, `conversation_events(4)`, `conversation_reads(3)`, `conversation_tags(2)`, `tags(4)` | `channels.external_id` = instância Evolution. `channel_events` registra a entrada e a saída das mensagens (`raw_payload`, `ai_*`, `error_code`, `tenant_id` + `tenant_slug`) |
| Fila de turnos | `conversation_turn_queue`, `_ingress_sources`, `_ingress_facts`, `_delivery_attempts`, `_terminal_receipts`, `_review_tickets`, `_review_consumers`, `_review_operators`, `_retry_policy`, `_suppression_authorizations`, `_control_origins`, `_notification_reads` (todas 0) | RPCs `magia_enqueue/claim/commit/begin_turn_delivery/confirm_turn_delivery/finish/fail_turn`; `phase` = `ready`, `processing`, `sending`, `uncertain` ou `review` |
| Catálogo de serviços | `tenant_service_catalog(5)` | `external_id`, `category`, `name`, `price`, `active` |
| Catálogo de produtos | `product_catalog_items`, `_item_images`, `_item_sources`, `_assets` (1 cada) | `price_cents`, `price_status`, `offerable`, `active`, `site_url`. Imagens com `review_status='aprovada'` e `sha256` |
| Agenda | `appointments(7)`, `appointment_capacity_slots(0)`, `appointment_capacity_allocations(0)` | RPCs `magia_appointment_availability`, `magia_reserve_session_appointment` |
| CRM/Kanban | `kanban_boards`, `kanban_columns`, `kanban_cards` (4 cada), `kanban_column_presets(0)`, `funnels`, `funnel_stages`, `opportunities` (4 cada) | |
| Vendas (Gênesis) | `sales_leads(1)`, `sales_documents(1)`, `genesis_inventory_vehicles(0)`, `genesis_inventory_vehicle_images(1)`, `noria_genesis_followup_*` (0) | Estado do lead por `session_id` + `revision` |
| Royal, disparos, follow-up | `royal_*` (0); `broadcast_campaigns`, `_recipients`, `_contacts` (3 cada), `broadcast_opt_outs(1)`, `_opt_out_reviews(0)`; `follow_up_policies(0)`, `follow_up_jobs(2)` | Disparo no servidor, intervalo mínimo de 41 min, opt-out |
| Controle do Gemini | `gemini_rate_control_state/leases/events`, `gemini_tenant_daily_usage`, `gemini_tenant_budget_reservations` (0), `ai_usage_daily(1)` | Orçamento por tenant (`magia_gemini_reserve`) |
| Legados | `ai_agents`, `ai_prompt_versions`, `ai_knowledge_documents`, `automation_*`, `whatsapp_catalog_*`, `integration_health`, `tenant_ai_excluded_contacts` | |

Últimas migrações: `20261109` (disparos), `20261112` (`conversation_latest_events`, intervalo de 41 min), `20261119` (`latest_events` leve, feriados), `20261121000901` (`product_catalog`). Há migração pendente de revisão em `supabase/migrations_pending_review/`.

## 4. Tenants `[banco]`

| Slug | Segmento | Modo / pipeline | Canal (instância) |
|---|---|---|---|
| `clinica_nubia_oficial` | Bronzeamento | `conversation_core_v1` + `services_v1` | `clinica_nubia` |
| `joyeria` | Joias e alianças | `conversation_core_v1` + `retail_v1` (teste) | `joyeria` |
| `ic_salon` | Salão de beleza | motor próprio | `ic_saloon` |
| `wesley_automoveis` | Veículos (Gênesis) | `sales_v1` | `wesley-carros` |
| `noria` | Serviços gerais | legado com EXT NORIA | `Noria` |
| `royal_4x4` | Veículos | `royal_stock_v1` (desligado no roteador) | `Royal 4x4` |
| `clinica_nubia` | Bronzeamento | legado, só Telegram | bots do Telegram |
| `universo_prata` | Joias e prata | não configurado | `universo_prata` |

## 5. Regras

- [AGENTS.md](../../AGENTS.md), [regras CORE × EXT](../rules/anti-hardcode-core-ext.md) e [lições de auditoria](../rules/licoes-pipeline-auditoria.md).
- Regra de negócio na EXT e no Supabase; CORE genérico; Gemini para semântica; regex só para parsing técnico.
- Isolamento por tenant em toda consulta, evento, fila e ação. Segredos só em variáveis de ambiente.

## 6. Onde procurar

| Área | Caminhos |
|---|---|
| Fontes n8n | `n8n/sources/` (core, retail, router, dispatch, EXTs) |
| Salon | `clients/ic_saloon/` |
| Build e publicação | `scripts/build_noria_workflows.cjs`, `n8n/build_manifest.json`, `scripts/publish_exports_by_id.cjs`, `scripts/publish_retail_chain.cjs`, `docs/operations/production_deploy_checklist.md` |
| Especificações | `docs/architecture/nubia_ext_v2_contract.md`, `docs/operations/retail_pipeline_v1.md`, `docs/operations/whatsapp_conversation_core.md` |
| Schema | `supabase/migrations/`, `supabase/migrations_pending_review/`, `supabase/README.md` |
| Painel | `app/` (`npm --prefix app test`) |
| Testes | `scripts/audit_anti_hardcode.cjs`, `scripts/validate_noria_release.cjs`, `scripts/test_noria_services_pipeline.cjs`, `scripts/test_nubia_extension_v2.cjs`, `scripts/test_noria_retail.cjs`, `scripts/test_retail_pipeline_core.cjs`, `clients/ic_saloon/*.test.cjs` |

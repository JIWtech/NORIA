# NORIA — Correção das regras comerciais CORE/EXT × Supabase

> Plano histórico de outubro de 2026. Confira o código atual antes de retomar qualquer item e siga o [AGENTS.md](../../../AGENTS.md) para validar alterações.

**Prioridade:** P0/P1  
**Escopo:** Exclusivamente inconsistências comerciais entre Supabase, CORE e EXT Gênesis.

## 1. INSTRUÇÕES OBRIGATÓRIAS

Corrigir diretamente o código existente, com mudanças mínimas e objetivas.


- Não alterar dados, configurações, políticas ou estruturas do Supabase.
- Não executar migrações SQL.
- Não publicar workflows no n8n.
- Não alterar o comportamento da EXT Núbia ou de outros tenants.
- Não implementar novas funcionalidades fora deste escopo.
- Não substituir regras comerciais por constantes, regex, listas ou textos fixos.
- Não criar fallbacks que inventem políticas ausentes.
- Não duplicar políticas comerciais no CORE e na EXT.
- Não mudar valores comerciais existentes para satisfazer validações antigas.
- Não apagar mecanismos técnicos de segurança, idempotência, isolamento multi-tenant ou confirmação de envio.
- Preservar os contratos e comportamentos não relacionados às correções solicitadas.
- Alterar as fontes canônicas em `n8n/sources/`, ajustando o gerador existente para refletir as mudanças nos JSONs.
- Não editar somente os JSONs gerados se o build puder sobrescrever as correções.


## 2. PRINCÍPIO ARQUITETURAL INEGOCIÁVEL

**SUPABASE = FONTE ÚNICA DE VERDADE COMERCIAL.**

**EXT GÊNESIS = ÚNICA AUTORIDADE DE DECISÃO COMERCIAL.**

**CORE = INFRAESTRUTURA COMPARTILHADA E MOTOR CONVERSACIONAL.**

O CORE pode interpretar semanticamente a mensagem com Gemini, validar estruturas e evidências, controlar sessões, persistir dados e enviar mensagens.

O CORE **NÃO PODE** definir autonomamente:

- Percentuais ou critérios de leads quentes.
- Marcas, modelos ou anos comercialmente aceitos.
- Requisitos documentais para financiamento.
- Regras de entrada, troca, compra ou avaliação.
- Modalidades e condições de pagamento.
- Critérios de qualificação comercial.
- Destinos e etapas comerciais do Kanban.
- Elegibilidade comercial de veículos.
- Políticas de garantia, visita ou encaminhamento.
- Disponibilidade, preços ou promoções comerciais.

Todas essas decisões pertencem à EXT, fundamentadas em configurações verificadas do tenant no Supabase.

Constantes técnicas de contratos, enums estruturais, validação de tipos, segurança e códigos de erro podem permanecer no código. **Valores que representem política comercial não podem ficar hardcoded.**

## 3. FONTE OFICIAL — SUPABASE NORIA-PROD

Tenant: `wesley_automoveis`.

As configurações abaixo foram consultadas diretamente no banco. São referências para localizar os campos corretos, **não autorização para copiar os valores para o código**.

### 3.1 Regras SDR

Fonte: `tenant_settings.settings.sdr_rules`

| Campo | Valor atual |
|---|---|
| `hot_lead_percent` | 30 |
| `minimum_purchase_year` | 1995 |
| `rejected_purchase_brands` | Peugeot, Citroen |
| `preferred_purchase_models` | Uno, Palio, Gol, Corsa, Celta |
| `warranty_response` | `human_review_required` |
| `document_processing` | `private_ocr_human_review` |

Todos devem ser lidos dinamicamente. Nenhuma dessas regras deve ser reproduzida com valores fixos no CORE ou EXT.

### 3.2 Configurações comerciais

Fonte: `tenant_settings.settings.sales`

- `hot_lead_rule = deposit_30_and_financing_documents_v1`
- `collect_documents = true`
- `birth_date_required = true`
- `document_ocr_enabled = true`
- `required_financing_documents = [full_name, birth_date, identity_document_photo]`
- `whatsapp_catalog_price_mode = sheet_authorized`
- `whatsapp_catalog_photo_enabled = false`
- `whatsapp_catalog_sync_enabled = false`
- `whatsapp_catalog_fallback_max_age_minutes = 5`
- `financing_require_deposit_for_progress = null`

Também existem `conversation_contract`, `stage_keys`, `stages` e `ad_campaign_routing`.

**IMPORTANTE:** `financing_require_deposit_for_progress = null` não autoriza presumir `true`. O percentual de lead quente NÃO representa automaticamente entrada mínima exigida para financiamento.

### 3.3 Fatos comerciais

Fonte: `tenant_settings.settings.business_facts`

- `financing.offered_by_business = true`
- `trade_in_policy.accepted_subject_to_appraisal = true`
- `financing.required_information.full_name.required = true`
- `financing.required_information.birth_date.required = true`
- `financing.required_information.identity_document_photo.required = true`
- `financing.required_information.identity_document_photo.one_of = [cnh, cpf]`
- `financing.required_information.identity_document_photo.format = photo`
- `vehicle_appraisal.walk_in.photos_required_before_visit = false`
- `vehicle_appraisal.walk_in.booking_mandatory_before_visit = false`
- `vehicle_appraisal.walk_in.visit_is_not_a_purchase_offer = true`
- `vehicle_appraisal.remote.photos_required = true`

Horários oficiais: `business_facts.opening_hours`.

Endereços oficiais: `business_facts.locations`.

Meios de pagamento: `business_facts.payment_methods`.

Nenhuma regra de visita, horário, fotografia, entrada ou financiamento pode ser inferida quando seu campo oficial estiver ausente.

## 4. CORREÇÕES OBRIGATÓRIAS

### P0-01 — Eliminar políticas comerciais duplicadas no CORE

Inspecionar as funções comerciais do CORE, especialmente:

- `executeCommercialOperationSync()`
- `executeCommercialDecision()`
- `salesFinancingPolicy()`
- `salesDialogueFactLedger()`
- `salesValidatePrimaryDialogue()`
- `salesApplyIntentEvidence()`
- `salesApplyDeterministicPaymentState()`
- Rotinas de estado de troca, avaliação e qualificação.

Remover decisões comerciais autônomas que reproduzam regras do Supabase.

O CORE deve consumir decisões e fatos autorizados pela EXT. Não remover validações genéricas de segurança, consistência ou proveniência.

Nenhuma função compartilhada deve conter políticas específicas de `wesley_automoveis`.

### P0-02 — Corrigir contrato documental incompatível

O CORE atualmente possui uma validação antiga que aceita identificadores como `cpf`, `cnh` e `birth_date`.

O Supabase define oficialmente:

`full_name`, `birth_date`, `identity_document_photo`.

Corrigir `salesFinancingPolicy()` e funções dependentes para que consumam o contrato normalizado pela EXT.

CNH e CPF são alternativas configuradas dentro de `identity_document_photo.one_of`, não substitutos automáticos de todos os requisitos documentais.

Não alterar a configuração do banco. Não criar listas documentais fixas dentro do CORE.

### P0-03 — Centralizar qualificação de leads na EXT

A EXT possui comparação comercial fixa com `0.3`.

Eliminar esse valor hardcoded.

Usar:

- `sdr_rules.hot_lead_percent`
- `sales.hot_lead_rule`
- `sales.collect_documents`
- `sales.required_financing_documents`
- `business_facts.financing.required_information`

Interpretar a regra configurada integralmente. Não classificar automaticamente um lead como quente apenas porque a entrada alcançou determinado percentual, se a regra também exigir documentação.

A classificação final deve vir da EXT e ser persistida pelo CORE sem recálculo comercial independente.

### P0-04 — Corrigir políticas de troca

`trade_in_policy: true`, `official.policy.trade_in: true` e afirmações equivalentes só podem ser autorizadas quando respaldadas por:

`business_facts.trade_in_policy.accepted_subject_to_appraisal`.

O CORE não deve gerar esses fatos porque o cliente perguntou sobre entrada ou porque existe um veículo selecionado.

A EXT deve distinguir:

- Pergunta sobre aceitar troca.
- Oferta concreta de veículo de entrada.
- Venda independente do veículo do cliente.
- Compra sem troca.
- Posse ambígua de veículo.

Perguntar se aceita troca não significa oferecer um veículo. Não exigir modelo de entrada sem intenção concreta.

Aceitação sujeita à avaliação não equivale a promessa de compra ou aprovação.

### P0-05 — Corrigir a modalidade de financiamento

A presença de uma pergunta sobre financiamento NÃO significa que o cliente escolheu financiar.

Distinguir semanticamente:

- Consulta informativa.
- Intenção explícita.
- Escolha confirmada.
- Coleta documental autorizada.
- Documentação completa.
- Revisão humana.

Verificar `business_facts.financing.offered_by_business`.

A coleta documental precisa respeitar as configurações verificadas. Não impor entrada mínima, percentual bancário ou documentos de financiamento a uma compra à vista.

### P0-06 — Corrigir classificação de compra de veículos

A EXT deve aplicar dinamicamente:

- `minimum_purchase_year`
- `rejected_purchase_brands`
- `preferred_purchase_models`

Essas regras são para avaliação comercial de veículos oferecidos à loja pelo cliente, não para bloquear a venda de veículos anunciados pela própria loja.

Não manter anos, marcas e modelos fixos no código.

Quando a política exigir avaliação humana, gerar decisão estruturada de handoff, sem promessa de compra.

### P0-07 — Usar etapas Kanban configuradas

Consultar:

- `sales.stage_keys`
- `sales.stages`

Não retornar diretamente `sales_hot`, `sales_financing`, `sales_human` ou outros identificadores como decisão comercial fixa.

Resolver a etapa por sua chave configurada e verificar:

- Existência da etapa.
- Permissão `allow_ai`.
- Status de encerramento.
- Necessidade de atendimento humano.

O CORE pode executar a transição autorizada, mas não escolher a etapa comercial por conta própria.

### P0-08 — Corrigir o contrato de decisão comercial

`commercial.decide` deve receber a política comercial verificada para o tenant, não depender de valores default.

Sua resposta precisa conter decisões comerciais estruturadas, incluindo quando aplicável:

- Estado comercial.
- Classificação do lead.
- Etapa autorizada.
- Requisitos pendentes.
- Handoff.
- Fatos comerciais autorizados.
- Proveniência dos parâmetros.
- Status explícito de erro/indisponibilidade.

A finalização deve consumir essa decisão, sem recalcular políticas no CORE.

Validar identidade, sessão e correspondência ao turno antes de aplicar resultados da EXT.

### P0-09 — Preservar todos os parâmetros necessários na EXT

O nó `Validar identidade e capacidade do tenant` usa uma allowlist que descarta algumas configurações existentes.

Revisar essa projeção para transportar, quando necessários:

- `sales.birth_date_required`
- `sales.document_ocr_enabled`
- `sales.whatsapp_catalog_photo_enabled`
- `sales.whatsapp_catalog_sync_enabled`
- `sales.whatsapp_catalog_fallback_max_age_minutes`
- `business_facts.opening_hours`
- `business_facts.locations`
- `business_facts.vehicle_types`
- Demais dependências efetivamente usadas pelas decisões comerciais.

Não transportar dados indiscriminadamente. Preservar a allowlist e acrescentar somente os campos necessários e comprovadamente existentes.

Não substituir campos omitidos por valores comerciais inventados.

### P0-10 — Centralizar a elegibilidade do estoque

Fonte: `public.genesis_inventory_vehicles`.

Utilizar os campos reais:

- `status`
- `availability_confirmed`
- `price_cents`
- `previous_price_cents`
- `price_source`
- `source_observed_at`
- `synced_at`

Preservar exatamente o significado dos status autorizados.

Não converter `reserved`, `unavailable` ou `unverified` para `announced`.

Não recuperar o inventário bruto quando a lista de veículos ofertáveis estiver vazia.

Veículo anunciado não equivale a disponibilidade confirmada.

A EXT define elegibilidade; o CORE apenas utiliza os dados validados.

### P0-11 — Preços e catálogo sem fontes paralelas

Respeitar `sales.whatsapp_catalog_price_mode = sheet_authorized`.

A planilha sincronizada no Supabase é a referência autorizada para preço comercial, conforme a configuração atual.

Não substituir valores por preços antigos, capturas de anúncios ou catálogo WhatsApp sem autorização configurada.

Distinguir o preço atual do preço anterior.

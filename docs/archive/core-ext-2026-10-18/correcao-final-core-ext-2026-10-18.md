# NORIA — Correções finais CORE × EXT Gênesis

> Plano histórico de outubro de 2026. Confira o código atual antes de retomar qualquer item e siga o [AGENTS.md](../../../AGENTS.md) para validar alterações.

## 1. Objetivo e escopo

Corrigir os defeitos comerciais e arquiteturais identificados nas auditorias dos workflows de 18/10/2026, revisão `conversation_core_v2_1_34_core_ext_decision_identity_2026_10_18`.

**Não refazer a arquitetura.** A separação `CORE prepare → EXT commercial.decide → CORE finalize` já foi implementada. Preservá-la.

Plano relacionado: [CORE/EXT × Supabase](correcao-ext-supabase.md).

Fontes canônicas:
- `n8n/sources/noria_core.js`
- `n8n/sources/genesis_extension.js`
- `n8n/sources/genesis_tenant_identity.js`
- `scripts/build_noria_workflows.cjs`

Confirmar cada defeito no código atual antes de modificar. Não reaplicar correções existentes.

## 2. Regras inegociáveis

**SUPABASE = fonte de verdade comercial.**

**EXT GÊNESIS = única autoridade comercial da Gênesis.**

**CORE = infraestrutura compartilhada, Gemini, sessões, validação técnica, persistência e transporte.**

Nenhuma política comercial pode ser inventada pelo Gemini ou recalculada pelo CORE após decisão da EXT.

Não hardcodar percentuais, documentos, marcas, anos mínimos, modalidades, preços, etapas, regras de avaliação ou financiamento. Constantes técnicas e contratos estruturais são permitidos.

Preservar Núbia, demais tenants, ownership humano, idempotência, sessões, confirmação de envio e segurança.

### Configurações oficiais de referência

Valores anteriormente consultados no Supabase do tenant `wesley_automoveis`; reler se necessário, nunca copiar como constantes comerciais:

- `sdr_rules`: lead quente 30%; ano mínimo de compra direta 1995; rejeição de Peugeot/Citroen; modelos preferidos Uno, Palio, Gol, Corsa e Celta; garantia `human_review_required`; documentos `private_ocr_human_review`.
- `sales`: regra `deposit_30_and_financing_documents_v1`; documentos `full_name`, `birth_date`, `identity_document_photo`; `financing_require_deposit_for_progress = null`; etapas em `stage_keys`/`stages`.
- `business_facts.financing`: financiamento oferecido; foto de documento conforme `one_of`, atualmente CNH ou CPF.
- `business_facts.trade_in_policy.accepted_subject_to_appraisal = true`.
- Avaliação presencial: permitida sem foto ou agendamento obrigatório prévio. Remota: exige fotos e descrição, conforme configuração.
- Inventário: `genesis_inventory_vehicles`, com status, preço, preço anterior e `availability_confirmed`.
- Catálogo: preço autorizado conforme `sales.whatsapp_catalog_price_mode`.

**30% é critério de temperatura do lead, não entrada mínima obrigatória de financiamento.**

---

## 3. P0 — Corrigir antes da publicação

### P0-01 — Estoque bloqueando mensagens independentes


A EXT executa `loadSupabaseInventory()` indiscriminadamente e pode retornar `COMMERCIAL_INVENTORY_UNAVAILABLE` até para saudações, horário, localização ou pedido de humano.

Também rejeita todo o turno com `COMMERCIAL_INVENTORY_PRODUCT_UNAVAILABLE` quando `state.product_id` antigo aponta para produto vendido, reservado ou ausente.

**Corrigir:**
- Distinguir semanticamente operações dependentes de estoque das independentes.
- Exigir inventário válido para catálogo, preço, seleção, disponibilidade e afirmações sobre veículos.
- Permitir saudações, localização, horário, solicitação humana e venda independente sem depender de inventário.
- Não recuperar preço ou disponibilidade de snapshot antigo.
- Produto antigo vendido ou indisponível deve ser representado como inelegível, sem continuar ofertando.
- Permitir informar indisponibilidade e mudar de assunto, quando houver evidência oficial.
- Limpar foco comercial obsoleto sem apagar histórico legítimo.

### P0-02 — Parser monetário interpretando idade como entrada


A regex com `tenho` e números isolados pode interpretar "tenho 25 anos" como R$ 25.000 de entrada, alterando `deposit_cents` e a classificação comercial.

**Corrigir:**
- Exigir contexto monetário/entrada comprovado.
- Não converter idades, anos, quantidades e medidas em dinheiro.
- Distinguir pergunta hipotética de entrada confirmada.
- Não multiplicar automaticamente números sem evidência de `mil`, `k`, `R$`, entrada ou valor monetário.
- Atualizar `deposit_cents` somente mediante evidência validada.
- Preservar formatos monetários brasileiros.

### P0-03 — Proveniência comercial deve falhar fechado


A autoridade comercial depende de `commercialDecisionAuthoritative`, mas proveniência inválida não pode permitir retorno às decisões comerciais locais do CORE.

**Corrigir:** para Gênesis, exigir antes da finalização comercial:

- `commercial_decision_status === 'ok'`.
- Contrato e proveniência esperados.
- Correspondência de tenant, instância, JID, sessão, `request_id` e `turn_token`.

Se inválido, rejeitar explicitamente. Não recalcular política, não persistir decisão comercial não autorizada, não enviar mensagem indevida. Preservar recuperação técnica e idempotência.

### P0-04 — Retornos terminais inconsistentes


O workflow possui `CORE | Turno terminal Genesis?`, mas alguns retornos antecipados podem ter apenas `skipped: true`, sem `noria_terminal: true`.

**Corrigir:**
- Normalizar todos os resultados efetivamente terminais.
- Preservar identidade e dados técnicos necessários.
- Desviar corretamente da EXT pelo gate existente.
- Não repetir Gemini, persistência final ou envio.
- Encerrar tokens e processamento de forma consistente.

Não criar bypass permissivo que ignore validação de tenant. Só modificar o primeiro nó de identidade da EXT se houver caminho terminal legítimo que realmente o atravesse.

### P0-05 — Compra direta confundida com troca


`purchaseEvaluation` aplica critérios de marca/ano da compra direta também a ofertas de troca. `requires_human` pode disparar somente quando há marca/ano rejeitado, deixando trocas válidas sem avaliação humana.

**Corrigir:**
- `independent_sale`: aplicar regras SDR de compra direta.
- `offer`: aplicar `trade_in_policy` e regras próprias de avaliação.
- Não rejeitar troca automaticamente por regras da compra direta.
- Definir handoff `appraisal_review` no momento correto, conforme evidências e política.
- Não encaminhar prematuramente nem prometer compra aprovada.
- Respeitar avaliação presencial/remota, fila, etapa e motivo definidos pela EXT.

---

## 4. P1 — Integridade comercial e conversacional

### P1-01 — Documentos configurados rigidamente

**Arquivos:** `genesis_extension.js`, `noria_core.js`.

Em `genesisCommercialPolicy()`, condições como `identityOneOf.length === 2` e `configuredDocuments.length === 3` fixam o formato atual do Supabase.

CORE e EXT também divergem em `full_name`, `identity_document_photo` e verificação de CNH/CPF.

**Corrigir:** interpretar dinamicamente `required_financing_documents` e `required_information`; respeitar alternativas `one_of`, evidências e verificação real. Unificar validação documental entre CORE/EXT sem tratar documento não verificado como completo.

### P1-02 — Financiamento e entrada obrigatória indevida

**Arquivos:** CORE `salesGenerate()`; EXT `financing.evaluate` e `commercial.decide`.

Há instruções para solicitar CNH, CPF, data de nascimento e entrada mesmo quando o cliente apenas consulta financiamento.

**Corrigir:** diferenciar consulta, interesse e escolha. Respeitar `financing_require_deposit_for_progress`; não usar percentual de lead quente como entrada mínima. Compra à vista não exige documentação de financiamento.

### P1-03 — Status e disponibilidade distorcidos


Problemas:
- Status desconhecido ou `nao verificado` pode virar `announced`.
- `reserved` vira `unavailable`.
- `listed` vira `announced`.
- Pickup, van e utilitários podem virar `car`.
- `availability_verified` pode ser sobrescrito apenas por `status === 'listed'`, ignorando `availability_confirmed`.

**Corrigir:** preservar status, categorias e disponibilidade oficial. Desconhecidos não ofertáveis. Não recuperar estoque bruto quando não existem ofertas válidas. CORE não deve decidir elegibilidade comercial.

### P1-04 — Enum inválido e troca antiga persistindo


`commercial_state.intent` pode receber `buy_and_sell`, valor pertencente a `transaction_mode`, não ao enum de intenção do CORE.

Em `buy_only_correction`, `sell_vehicle` pode continuar preenchido.

**Corrigir:** manter enums compatíveis; usar `buy_and_sell` somente em `transaction_mode`; em correção explícita para compra, limpar troca e `sell_vehicle` ativos sem apagar o histórico legítimo.

### P1-05 — Negação de leilão ou sinistro invertida


Regex por simples presença de `leilao`/`sinistro` pode interpretar "não tem leilão" como `reported_yes`.

**Corrigir:** respeitar `semanticVehicle.auction_history` e `sinister_history`: `reported_yes`, `reported_no`, `unknown`. Não sobrescrever negação por regex. Não usar mapa fixo de modelos como autoridade semântica.

### P1-06 — Kanban, garantia e handoff incompletos


A seleção de etapas ignora possíveis estados `warm`, `cold`, `after_sales` e algumas avaliações. Revisar também `warranty_response`, revisão humana de OCR, conflito documental e `human_requested`.

**Corrigir:**
- Resolver todos os papéis relevantes por `sales.stage_keys`/`sales.stages`.
- Respeitar `allow_ai`.
- Garantia com `human_review_required` deve receber tratamento humano apropriado.
- Respeitar solicitação explícita de humano.
- Preservar handoff, fila e motivo até a persistência.
- Não aplicar escalonamento genérico por cima da EXT.

### P1-07 — Fatos comerciais autorizados pelo próprio CORE

**Arquivos:** `noria_core.js` e `genesis_extension.js`.

` salesDialogueFactLedger()` pode preparar fatos antes de `commercial.decide`; `salesValidatePrimaryDialogue()` pode aceitar `trade_in_policy = true` por interpretação conversacional.

A EXT também emite fatos genéricos de troca quando a política verdadeira é **aceitação sujeita à avaliação**.

**Corrigir:**
- Separar fatos oficiais previamente verificados, evidências do cliente e autorizações comerciais.
- CORE não pode transformar tópico conversacional em política aprovada.
- A validação final deve consumir `commercial_decision.authorized_facts`.
- A autorização de troca deve preservar a condição de avaliação.
- Evitar segunda chamada obrigatória ao Gemini.
- Não substituir respostas naturais por templates fixos.

### P1-08 — Hardcodes comerciais no prompt do Gemini


Remover instruções fixas que mandam pedir CNH, entrada, CPF ou fotos independentemente da modalidade e das configurações.

Construir instruções a partir de fatos e requisitos verificados. Respeitar visita presencial sem foto obrigatória, documentos alternativos e mudanças de assunto.

### P1-09 — Inicialização incorreta da etapa


Verificar referência a `context?.tenant_settings?.settings?.sales?.stage_keys?.qualifying` quando o contexto utiliza `settingsFor(context)`.

Corrigir leitura sem introduzir etapa comercial fixa. Transições comerciais definitivas pertencem à EXT.

---

## 5. Verificações finais por leitura

Verificar, sem presumir novos defeitos:

- `prepare` não envia nem persiste resposta final.
- Fase terminal não executa EXT desnecessariamente.
- EXT não provoca finalização comercial sem contrato válido.
- Handoff e classificação não são sobrescritos depois da EXT.
- Envio não é duplicado em retry, concorrência ou intervenção humana.
- Verificar o desfecho do turno em caso de falha no Gemini, no processamento de áudio, no Supabase ou na Evolution.

# Relatório Fase 4.1 — Poda Segura de `clients/ic_saloon/salon_engine.js`

## Resumo

- **Arquivo-alvo:** `clients/ic_saloon/salon_engine.js`
- **Tamanho antes:** `15.450` linhas
- **Tamanho depois:** `3.801` linhas
- **Redução total:** `11.649` linhas removidas (`~75,4%`)
- **Escopo preservado:** O caminho de execução do tenant `ic_salon` em fase `'single'` no canal WhatsApp foi mantido intacto, sem alteração de regras de negócio ou lógica funcional ativa.
- **Execução local (build e testes):** **Não executada nesta etapa**, pois o uso de terminal/comandos foi desabilitado pelas instruções da tarefa. A validação via `npm test`, suítes `scripts/test_*.cjs` e `clients/ic_saloon/*.test.cjs`, bem como a regeneração via `scripts/build_noria_workflows.cjs`, fica pendente de execução pelo orquestrador.

---

## 1. Prova de Inalcançabilidade para o `ic_salon`

A comprovação estrutural baseia-se em três pontos diretamente verificados no código-fonte:

1. **Roteamento exclusivo para o nó único em fase `'single'` (`clients/ic_saloon/conversation_route.cjs` + `scripts/build_noria_workflows.cjs`):**
   - `conversation_route.cjs` aplica no nó `'CORE | Motor conversacional único'` (`ENGINE_PHASES` em `build_noria_workflows.cjs`, linha 561 = `'single'`) a expressão condicional:
     `$json.tenant_id === '76aff8a0-0466-42b9-a80d-db186ff3d8bd' && $json.tenant_slug === 'ic_salon' && $json.instance === 'ic_saloon'`.
   - Dessa forma, todo turno do `ic_salon` entra no sub-workflow dedicado (`yxdKP0PeskDMUFSo`) recebendo `noria_engine_phase = 'single'` consumido por `ENGINE_PHASE_HEADER` (`NORIA_NODE_PHASE`) montado por `salonEngineNodeCode()` em `scripts/build_noria_workflows.cjs`.
   - Os fluxos multifase (`prepare`, `availability`, `finalize`), bem como o sub-workflow da Núbia (`vCDXJLqIBCZJRTVv`) e os nós de `services_v1` / `sales_v1` (Gênesis), nunca roteiam para o workflow do Salon.

2. **Entrada e carregamento no próprio `salon_engine.js`:**
   - **Canal WhatsApp exclusivo:** `loadTenantContext()` consulta `channels` com `&type=eq.whatsapp&status=eq.active&external_id=eq.` e `loadRecentHistory()` / `loadAppointments()` / `saveAppointmentRequest()` / `sendChannelMessage()` / `queueRpc()` operam com `channel_type=eq.whatsapp` e envio via `EVOLUTION_API_URL_*` (`/message/sendText/`). Não há suporte a Telegram no caminho de entrada do Salon.
   - **Fase `'single'` única:** Em `salon_engine.js`, `noriaPhase` é resolvido como `'single'` (a menos de override explícito em `prepare`/`finalize`, inexistente no roteamento do Salon). O ramo `phasedPipeline` (`['prepare', 'availability', 'finalize'].includes(noriaPhase)`) e o pipeline `services_v1` (`TURN_PIPELINE_CONTRACT`, `services_v1`) são inalcançáveis.
   - **Ausência de `sales_v1` (Gênesis) e `canonical_v2` / `appointment_scheduling` (Núbia):**
     - `salesEnabled(context)` exigia `conversation_capability === 'sales_v1'` e `tenantBusinessRules.capability === 'sales_v1'`. O Salon opera como agendamento de serviços (`standard`), nunca com política comercial automotiva (`vehicle_sales_v1` / `sales_v1`).
     - O modo `grounding_mode === 'canonical_v2'` (fluxo Núbia grounded + `callGroundedGemini` + `ignoreAutomatedContact`) e o módulo `appointment_scheduling.enabled === true` (`schedulingEnabled`, `schedulingReserve`, `composeSchedulingOutcomeReply`) pertencem ao fluxo Núbia/`services_booking_v2`, nunca ativos no Salon — onde o agendamento usa `appointmentRequestConfig` (`mode === 'operator_confirmation'`) ou, em último caso, o caminho legado `createAppointmentFromTag`.

3. **Ausência de chamadas pendentes no código mantido:**
   - A leitura integral das `3.801` linhas finais de `clients/ic_saloon/salon_engine.js` confirma que nenhuma função ou constante mantida no caminho executável chama qualquer símbolo removido. Funções que residiam dentro dos blocos mortos mas são referenciadas pelo caminho ativo do Salon ou por handlers de erro/testes do Salon foram preservadas.

---

## 2. Blocos Removidos (com Linhas Originais)

As coordenadas abaixo referem-se ao arquivo **original** de `15.450` linhas antes da poda:

| Bloco / Categoria | Intervalo Original | Linhas Removidas (aprox.) | Justificativa de Inalcançabilidade |
| --- | --- | --- | --- |
| **Telegram (Bloco 1)** (`telegramTokenFor`, `sendTelegramMessage`, `sendTelegramFallbackMessage`, `detectTelegramMedia`) | `1165–1349` | `185` | O `ic_salon` opera exclusivamente via WhatsApp (Evolution API). Nenhuma função ativa chama o canal Telegram. |
| **Telegram (Bloco 2) + `mediaFallbackText`** (`mediaFallbackText`, `downloadTelegramMedia`, `analyzeTelegramMedia`) | `1380–1691` | `312` | `downloadTelegramMedia` e `analyzeTelegramMedia` são exclusivos de Telegram; `mediaFallbackText` era chamado apenas por blocos de entrada de áudio/imagem já ausentes no caminho do Salon (`sales_v1`). `mediaError`, `MEDIA_NOTICE_INSTRUCTIONS` e `composeMediaNotice` foram preservados. |
| **Núbia `canonical_v2` (Parte 1)** (`groundingLocationRequested` até `groundingTimeFromEvidence`) | `3550–3656` | `107` | Exclusivo do pipeline `grounding_mode === 'canonical_v2'`. Preservada `groundingIsFullName` (`3658–3672`), pois é chamada por `saveAppointmentRequest` e pelo caminho legado `else if (tag && !requestConfig)`. |
| **Núbia `canonical_v2` (Parte 2) + `appointment_scheduling`** (`groundingPreviousState` até `callGroundedGemini`, e `schedulingEnabled` até `schedulingReserve`) | `3674–4794` | `1.121` | Exclusivos de `canonical_v2` e `appointment_scheduling.enabled === true`. O Salon nunca ativa esses modos e possui tratamento próprio de pedidos (`appointment_request` / `salon*`) e criação legada via `createAppointmentFromTag`. |
| **Pipeline `services_v1`** (`TURN_PIPELINE_CONTRACT` até `runServicesTurnFinalize`) | `4796–5479` | `684` | Executado apenas com `NORIA_TURN_PIPELINE` multifase (`prepare`, `availability`, `finalize`) + `turnPipeline.contract === 'noria_turn_pipeline_v1'`. O Salon roda sempre em fase `'single'`. |
| **Fluxo `sales_v1` / Gênesis** (`salesEnabled` até `salesReadMedia`, dividido nos sub-blocos entre itens preservados) | `5684–5992`, `6004–6100`, `6115–7498`, `7506–14697` (excluindo os 3 itens preservados abaixo) | `~8.860` | Exclusivo de `conversation_capability === 'sales_v1'` (`NORIA_COMMERCIAL_PROTOCOL` / Gênesis Automóveis). Preservados `salesRedactPersonalData`, `turnAdContext` e `CONTRACT_CUTOVER_PATTERN`. |

---

## 3. Ramos `if` Podados por Predicado Sempre Falso para o Salon

Todos os ramos removidos dentro de funções ativas receberam comentário explicativo `// Poda Fase 4.1 (ic_salon): ...` no código resultante:

1. **`loadTenantContext()` (`1743–1757` originais -> `1249–1254` atuais):**
   - Removida a consulta condicional de `ai_agents` para `grounding_mode === 'canonical_v2'` (mantida a consulta padrão `provider=eq.gemini`).
   - Removida a consulta condicional de `team_agents` para `conversation_capability === 'sales_v1'`, mantendo `const teamAgents = [];`.
   - *(Correção aplicada após a primeira edição: garantido que a URL de canais permanece `/rest/v1/channels?...`).*
2. **`loadRecentHistory()` (`1779–1790` originais -> `1278–1286` atuais):**
   - Removido o desvio `grounded = settingsFor(context).grounding_mode === 'canonical_v2'` (`limit=81` e cálculo de `history_overflow`), mantendo o caminho padrão `limit=50` e `turn.history_overflow = false`.
3. **`scheduleFollowUps()` (`3281–3305` originais -> `2786` atual):**
   - Removido o bloco `if (salesEnabled(context)) { ... }`.
4. **`sendChannelMessage()` (`3340–3344` e `3404–3534` originais -> `2822–2824` e `2885` atuais):**
   - Removida a bifurcação `if (salesEnabled(context) && ...)` mantendo diretamente a chamada obrigatória a `refreshTurnSuppressionEvidence()`.
   - Removido o bloco morto `if (catalogPhoto && event.ai_provider === 'sales_core' && !event.handoff) { ... }` de envio de foto de catálogo comercial.
5. **`runTurn()` (`14799–15289` originais -> `3282–3643` atuais):**
   - Removido `if (phasedPipeline) ...` (fase sempre `'single'`).
   - Removida a variável `const grounded = ...`, mantendo diretamente `const history = control.activeHistory.slice(-12);`.
   - Removidos os desvios `if (salesEnabled(context))`, `turnPipeline`, `noria_turn_dispatch_v1` e `servicesPinFound`.
   - Removido o ramo `if (grounded) { ... callGroundedGemini ... ignoreAutomatedContact ... }`, mantendo o caminho padrão `if (!gate.allowed) ... else { ... callGemini ... }`.
   - Dentro de `else if (tag && !requestConfig)`, removidos os desvios internos de `groundingGuardNubiaFutureAppointment`, `schedulingEnabled(context)` / `schedulingReserve` e `composeSchedulingOutcomeReply`, mantendo o fluxo direto de `createAppointmentFromTag`.

---

## 4. O Que Foi Mantido por Uso Transversal ou Dúvida (Regra 1)

Estes símbolos permaneceram em `clients/ic_saloon/salon_engine.js` para garantir compatibilidade com o caminho ativo, contratos compartilhados, testes do Salon ou por cautela diante de referências estáticas:

- **Contrato e validação de entrada / protocolo (`42–94` atuais):** `salesUsesStructuredDialogue`, `salesCommercialContract`, `SUPPORTED_COMMERCIAL_CONTRACTS`, `salesSupportedContractVersion`, `salesGroundedMaxOutputTokens`, `salesDialogueCopy`, `allowedBusinessProfiles`, `hasRevisionedServiceTextsContract`, `validateTenantPolicyContract`. Mantidos porque `validateTenantPolicyContract()` é executada no início de `runTurn()` e validada nos testes do motor.
- **Variáveis e estado de módulo (`18`, `102–112` atuais):**
  - `salesOwnAssignmentEventId`: referenciada diretamente em `sendChannelMessage()` (linha `2820` atual).
  - `salesInventoryMemo`, `salesSemanticEvidenceProofs`, `salesPhotoActionProofs`, `salesCatalogRuntimeAudit`: mantidos sem alteração por cautela estrutural no topo do arquivo (sem custo de execução e caso algum harness de teste inspecione o escopo).
- **Diagnóstico seguro e erros (`156–160`, `1153–1157` atuais):**
  - `salesSafeFailureDiagnostics`: chamada diretamente no `catch (error)` global do motor (linha `3744` atual).
  - `mediaError`: mantida por cautela junto ao bloco de mídia/WhatsApp.
- **Transversalidade preservada no meio dos blocos removidos:**
  - `groundingIsFullName` (`2904–2918` atuais): chamada diretamente em `saveAppointmentRequest()` e em `runTurn()`.
  - `sessionHandoffMessage`, `sessionRecall`, `sessionUsageDiagnostic`, `audioHistoryText` (`2943–2986` atuais): `sessionHandoffMessage` e `sessionUsageDiagnostic` são ativas no Salon; `sessionRecall` e `audioHistoryText` foram mantidas por estarem no bloco de sessão/áudio e por cautela para eventuais testes que carreguem o bloco.
  - `salesAudioBatchLimit` (`3027–3030` atuais): chamada diretamente em `transcribeTurnAudio()`.
  - `salesRedactPersonalData` (`3129–3137` atuais): chamada diretamente em `composeMediaNotice()`.
  - `turnAdContext` (`3143–3153` atuais): chamada diretamente em `callGemini()` e testada no Salon por `scripts/test_export_fixes_salon_nubia.cjs`.
  - `CONTRACT_CUTOVER_PATTERN` (`3163` atual): usada diretamente em `runTurn()` (`NORIA_EXT_DISPATCH_UNAVAILABLE`) e no `catch` global.
  - `patchSalesMedia` (`2685–2687` atuais): mantida porque `saveEvent()` a referencia no loop de `event.raw_payload?.sales_media`.
- **Guarda `mediaOnly` em `sendChannelMessage()` (`2802` atual):** mantida por segurança defensiva e para não editar linhas do corpo principal da função do Salon.
- **Checagem `liveSettings.conversation_capability === 'sales_v1'` em `runTurn()` (`3274` atual):** mantida dentro da guarda `NORIA_POLICY_OUTDATED_RETRY` para falhar fechado caso haja divergência entre política e configuração ao vivo.

---

## 5. Testes Verificados e Ajustados

Os testes em `clients/ic_saloon/*.test.cjs`, `scripts/test_salon_*.cjs` e os casos `[salon]` de `scripts/test_no_conversational_regex_nubia_salon.cjs` foram preservados compatíveis com os símbolos e trechos ativos de `salon_engine.js`.

Quatro arquivos de teste em `scripts/` extraíam ou validavam funções pertencentes aos blocos mortos removidos na poda e foram ajustados para manter a cobertura total em `n8n/sources/noria_core.js` sem falhar na ausência dos blocos podados de `clients/ic_saloon/salon_engine.js`:

1. **`scripts/test_generic_approved_service_contract.cjs`**
   - **Ajuste:** Alterado o loop de arquivos para `['n8n/sources/noria_core.js']` (removendo `clients/ic_saloon/salon_engine.js` desse teste específico) com comentário explicativo.
   - **Motivo:** O teste extrai `groundingApprovedMessageMap` e `groundingApprovedReplyText`, que pertencem exclusivamente ao fluxo `canonical_v2` (Núbia) removido do Salon. `validateTenantPolicyContract` segue presente no `salon_engine.js` e coberta no `noria_core.js` e nos testes do Salon.

2. **`scripts/test_human_request_tenant_names.cjs`**
   - **Ajuste:** Alterado o loop de arquivos para `['n8n/sources/noria_core.js']` com comentário explicativo.
   - **Motivo:** O arquivo testa `salesEscapeRegex`, `salesTenantHumanTargetNames`, `salesHumanTargetRegexSource`, `salesExplicitHumanRequest`, `salesFrustrationDetected`, `salesResolveDefaultAssignee` e o ramo `sales_v1` de `loadTenantContext` — todos removidos do Salon por pertencerem exclusivamente ao fluxo `sales_v1`.

3. **`scripts/test_no_conversational_regex_nubia_salon.cjs`**
   - **Ajuste:** Apenas os dois casos prefixados com `[nubia]` que extraem `composeSchedulingOutcomeReply` e `schedulingComposeReply` (linhas `127–170`) passaram a iterar sobre `[SOURCES.core]` em vez de `[SOURCES.core, SOURCES.salon]`, mantendo os testes `[salon]` e `isPaymentSignalPaidText` inalterados para `SOURCES.salon`.
   - **Motivo:** `composeSchedulingOutcomeReply` e `schedulingComposeReply` são exclusivos de `canonical_v2` / `appointment_scheduling` (Núbia) e foram podados de `salon_engine.js`.

4. **`scripts/test_export_fixes_salon_nubia.cjs`**
   - **Ajuste:** Adicionado o helper `salonPruned(label, code, symbol)` para marcar `skip` explícito nos 4 testes exclusivos de `services_v1` (`servicesSemanticAudit` e `servicesMessageLocalDate`) quando executados sobre o motor podado do Salon; no teste de `turnAdContext`, o recorte auxiliar de `servicesSemanticSchema(` passou a ser verificado apenas se `code.includes('servicesSemanticSchema(')`, mantendo o teste completo de `turnAdContext` e `systemText` ativo para o Salon.
   - **Motivo:** `services_v1` foi removido de `salon_engine.js` por rodar apenas em fase `'single'`. Os casos restantes do arquivo (`appointmentOutsideBusinessHours`, `turnAdContext` + `systemText`, `turnDeliveryRejectedByProvider`) continuam ativos no Salon.

---

## 6. Próximos Passos para o Orquestrador

Como a execução via terminal está bloqueada neste ambiente:
1. Executar `npm test` em `app/` e os scripts de teste em `scripts/` e `clients/ic_saloon/*.test.cjs`.
2. Executar `node scripts/build_noria_workflows.cjs` para validar a sintaxe via `new AsyncFunction(...)`, regenerar o workflow do Salon (`yxdKP0PeskDMUFSo`) e comparar os artefatos resultantes.

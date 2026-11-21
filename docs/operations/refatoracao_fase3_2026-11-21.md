# Refatoração Fase 3 — fronteira CORE × EXT e utilitários

Implementação local na worktree `C:\noria-wt-ref3`, branch `refactor/fase3-shared`, em 2026-11-21. O estado inicial estava limpo. Sem commit, push, publicação no n8n, instalação de dependências ou escrita em produção.

## Escopo e critérios

Remover dependências de nomes de clientes do motor compartilhado, extrair utilitários projetados pelo gerador e reunir a seleção de pipeline/pino. Preservar os contratos, as consultas com escopo de tenant, a topologia dos workflows e o comportamento existente, distinguindo as correções explicitamente solicitadas da equivalência da refatoração.

## Evidência anterior às alterações

- `node scripts/validate_noria_release.cjs`: 698 testes, 698 passaram, zero falhas e skipped.
- `npm test` em `app/`: 962 testes, 962 passaram, zero falhas e skipped.
- Build anterior preservado em `%TEMP%\noria-fase3-baseline`, com `NORIA_RETAIL_EXT_WORKFLOW_ID=vE8rPAAdzkkVzPBG` e saída fora do repositório.
- O gerador atual produz oito workflows e 44 nós com `jsCode`. O export legado da política Núbia v1 (`vCDXJLqIBCZJRTVv`) não é uma saída desse gerador; permanece preservado.

## Mudanças e equivalência

| Arquivo:linha | Mudança e limite de equivalência |
| --- | --- |
| `n8n/code/command_router.js:746` | O convite de remarcação depende de `appointment_outcome_tracking === true` e do canal WhatsApp. Preserva o Salon habilitado e permite outros tenants que declarem a mesma capacidade, conforme solicitado. |
| `n8n/sources/nubia_extension.js` / `n8n/sources/noria_core.js` | A EXT declara `handoff.auto_assign`; o motor usa esse sinal, com handoff autorizado e envio não cancelado, sem interpretar o código comercial do motivo. |
| `n8n/sources/noria_core.js:64` / `clients/ic_saloon/salon_engine.js:68` | `hasRevisionedServiceTextsContract` reconhece a declaração booleana `approved_service_texts` e o objeto `messages`. Mantém a validação das seis mensagens obrigatórias e o fechamento seguro quando os textos estão desabilitados ou o catálogo está inválido. O perfil legado continua aceito pela declaração, sem depender do nome. |
| `n8n/sources/noria_router.js:33` | `selectPipeline` reúne consulta de lote/pino, validação de rollout e seleção de versão. Preserva a rejeição de declaração primitiva nos serviços e a tolerância do retail; preserva também a versão fixa dos serviços e a versão ofertada pelo retail. |
| `scripts/audit_anti_hardcode.cjs:22` | As 26 exceções foram removidas; todas as listas da baseline estão vazias. O teste de auditoria agora rejeita os padrões antigos. |
| `scripts/compare_noria_builds.cjs:8` | Novo inventário de alterações por nó, mantendo o comparador estrito como padrão. |
| `scripts/test_build_noria_workflows.cjs:28-38` | Ajuste de teste equivalente: inclui `n8n/sources/shared/tenant_identity.js`, `n8n/sources/shared/text_utils.js` e `n8n/sources/shared/whatsapp_jid.js` na lista esperada de `manifest.source_sha256`, alinhando ao conjunto gravado por `scripts/build_noria_workflows.cjs:768-778`. |
| `scripts/test_noria_engine_subworkflow.cjs:24-30` | Ajuste de teste equivalente: projeta `text_variants` (extraído entre `// >>> text_variants` e `// <<< text_variants` de `text_utils.js`) além de `whatsapp_jid` em `noria_retail.js`, espelhando `scripts/build_noria_workflows.cjs:54-58,75`. |
| `scripts/test_noria_services_pipeline.cjs:14-29,328` | Ajuste de teste equivalente: suporta projeção de `text_variants` em `projectShared` e compara `EXT | Serviços Núbia v2` com `['tenant_identity', 'text_variants']`, conforme `scripts/build_noria_workflows.cjs:83`. |
| `scripts/test_noria_services_pipeline.cjs:676,848` | Ajuste de teste equivalente: inclui `servicesShouldAutoAssign` em `loadCore(...)` nos dois testes de `runServicesTurnFinalize`, pois a Fase 3 extraiu o contrato `handoff.auto_assign === true` para essa função em `n8n/sources/noria_core.js`. |
| `n8n/sources/noria_core.js:1963-1980` / `clients/ic_saloon/salon_engine.js:1749-1767` | `loadTenantContext` passa a carregar `team_agents` ativos (`is_active=eq.true`) com filtro estrito por `tenant_id` (em falha branda) quando `conversation_capability === 'sales_v1'`, disponibilizando `context.team_agents` no turno. |
| `n8n/sources/noria_core.js:10579-10675` / `clients/ic_saloon/salon_engine.js:9125-9220` | Adiciona `salesEscapeRegex`, `salesTenantHumanTargetNames`, `salesHumanTargetRegexSource` e `salesExplicitHumanRequest`; `salesFrustrationDetected(text, context)` monta dinamicamente alternativas escapadas a partir de `context.team_agents`, `default_operator`, `sales` e campos de responsável/dono do tenant, mantendo apenas termos genéricos quando não há configuração. `salesResolveDefaultAssignee` também reaproveita `context.team_agents` já carregado. |
| `n8n/sources/noria_core.js:13926,14858` / `clients/ic_saloon/salon_engine.js:12470,13402` | Atualiza `runSalesTurnFinalize` nos dois motores para chamar `salesExplicitHumanRequest(currentTurnText, context)` e `salesFrustrationDetected(m.text, context)`. |
| `scripts/test_human_request_tenant_names.cjs` / `scripts/validate_noria_release.cjs:19` | Novo teste (`node:test` + `scripts/lib/core_test_harness.cjs`) cobrindo nomes configurados (`team_agents`, `sales.default_operator`, `responsible_name`, escape regex e `loadTenantContext`), fallback apenas genérico sem configuração, isolamento entre tenants e `loadCoreEngine`; registrado em `validate_noria_release.cjs`. |

As regex de pedido de humano do CORE (`n8n/sources/noria_core.js:10639-10662,13926,14858`) e do clone Salon (`clients/ic_saloon/salon_engine.js:9185-9208,12470,13402`) deixam de usar nome fixo e de depender exclusivamente de `o dono`: combinam os termos genéricos com os nomes configurados no próprio tenant já disponíveis no turno (`team_agents`, `default_operator`, configurações de vendas e responsável), devidamente escapados para regex. Sem configuração no tenant, apenas os termos genéricos permanecem ativos.

A identidade das EXTs Gênesis e Núbia agora aceita `config.instanceId` e diferenças de caixa pela função compartilhada. Essa é uma correção intencional do bug reproduzido, não equivalência para entradas antes rejeitadas. O ramo NORIA do roteador preserva sua lista antiga de aliases e a correspondência por chave sanitizada vazia; usa a normalização compartilhada sem mudar essas duas regras.

## Comparação dos workflows

O comparador `scripts/compare_noria_builds.cjs` mantém seu modo padrão estrito e acrescenta `--list-changes`. Esse modo exige igualdade de toda a estrutura fora de `jsCode` e lista, por workflow, os nomes, IDs e hashes dos nós alterados. Somente `coreBuildMetadata` é normalizado.

## Validação final

Evidências incrementais antes do build integrado:

- EXT de cliente anterior: teste falhou antes pela ausência de `auto_assign`; três testes passaram depois.
- Capacidade de remarcação em outro tenant: o teste inicial falhou, mas a fixture também carecia das credenciais fictícias para o novo slug. A leitura do guard antigo comprova a restrição pelo slug; o teste final com fixture completa cobre a capacidade habilitada e desabilitada. A falha inicial não isola a causa.
- Identidade Gênesis/Núbia: duas falhas em quatro testes novos antes; depois, os quatro novos e três existentes do CORE passaram (7/7).
- Contrato genérico de textos: teste novo falhou nos dois motores antes; passou nos dois após a mudança.
- Contrato, preço, autorização, auditoria e handoff anterior: 42/42 testes passaram.
- Router: 8/8 testes retail passaram antes; após a extração, 11/11 de retail/identidade e 4/4 direcionados de serviços/piloto passaram. Inclui lote com declaração inválida, lote sem versão ofertada, precedência de pino e JID de piloto estrito.

Correções finais desta etapa (alinhamento dos 5 testes quebrados pelas projeções `shared/` e por `servicesShouldAutoAssign`, correção dinâmica das regex de pedido de humano em CORE/Salon e novo teste em `scripts/test_human_request_tenant_names.cjs`) aplicadas via edição de arquivos sem execução de terminal neste ambiente; aguardam validação integrada pelo orquestrador (`build_noria_workflows`, `validate_noria_release`, `audit_anti_hardcode`, testes do Salon, `app` e comparação dos workflows gerados).

## Riscos, adiamentos e rollback

As verificações são locais: não demonstram paridade com workflows publicados, aceitação do provedor ou atendimento real. Nenhuma chamada real ao Gemini ou envio de WhatsApp faz parte desta entrega.

A normalização de instância existente no CORE remove caracteres fora de `[a-z0-9_-]`. Sua preservação evita mudar essa regra nesta fase, mas identificadores como `foo.bar` e `foobar` podem colidir. A correção dessa regra exige uma revisão específica das identidades existentes.

Rollback local: desfazer somente o diff desta entrega e retirar os arquivos novos correspondentes, preservando alterações futuras de terceiros. Nenhum rollback de produção é necessário.

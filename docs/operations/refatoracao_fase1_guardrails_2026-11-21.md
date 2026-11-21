# Fase 1 — proteções, testes e build

Implementação local em `C:\noria-wt-ref1`, branch `refactor/fase1-guardrails`, em 2026-11-21. A worktree estava limpa no início. Nenhum commit, push, publicação, migração ou acesso de escrita à produção foi realizado. Nenhuma dependência foi instalada.

## Mudanças e justificativas

| Arquivo:linha | Mudança e motivo |
| --- | --- |
| `scripts/audit_anti_hardcode.cjs:15` | Audita CORE, retail, Gênesis, Núbia, JOYERÍA, NORIA, Salon e command router. Arquivos obrigatórios ausentes passam a falhar. O diff auditado usa HEAD e inclui todas essas fontes. |
| `scripts/audit_anti_hardcode.cjs:23` | Documenta o passivo da Fase 3 por arquivo, linhas originais e hashes de linha. Cada ocorrência só pode consumir uma exceção; retail tem baseline vazia. |
| `scripts/test_audit_anti_hardcode.cjs:7` | Comprova que alterar ou duplicar a condição legada do router falha, assim como introduzir Wesley no retail. |
| `scripts/validate_noria_release.cjs:12` | Acrescenta retail, pipeline retail, JOYERÍA, routing/região retail, auditoria CLI e regressão da baseline, quatro arquivos Salon, teste do gerador, encaminhamento e foto. Núbia v2 e services pipeline já estavam incluídos e foram preservados. Usa o PGlite existente em app/node_modules quando MAGIA_TEST_MODULES não foi informado. |
| `scripts/lib/core_test_harness.cjs:8` | Centraliza leitura de fontes, extração de funções com AST TypeScript, cache de AST e montagem de globals em VM. O carregamento integral compõe CORE e retail canônicos e interrompe antes de runTurn; não depende da projeção versionada desatualizada. |
| `scripts/test_action_tag_detection.cjs:1` | Migra leitura e extração de funções para o harness, preservando asserções. |
| `scripts/test_noria_document_identity.cjs:1` | Migra leitura e extração para o harness, preservando asserções. |
| `scripts/test_salon_slot_proposal_semantics.cjs:1` | Migra leitura e extração para o harness, preservando asserções. |
| `scripts/test_noria_handoff_announcement.cjs:7` | Usa o harness e substitui a asserção textual do guard por execução de salesValidatePrimaryDialogue: anúncio sem handoff executado é reprovado; com execução confirmada, essa reprovação desaparece. |
| `scripts/test_noria_photo_promise.cjs:7` | Usa o harness; executa o validador real para promessa sem foto autorizada e negativa com foto autorizada. Verifica elegibilidade real à recomposição, em lugar de procurar o código de erro no texto da fonte. |
| `app/src/features/settings/utils/units.js:1` | Extrai os helpers puros de unidades/locais e canais da implementação existente, sem mudar suas regras. |
| `app/src/features/settings/components/SettingsPage.jsx:17` | Consome os helpers extraídos; mantém a derivação por useMemo com as mesmas entradas. |
| `app/tests/features/settings.test.js:8` | Remove funções copiadas. Importa helpers reais de unidades e expediente e executa saveTeamAgent do serviço real com cliente local simulado para validar os payloads. |
| `scripts/build_noria_workflows.cjs:137` | Reutiliza os metadados anteriores pelo manifesto. Remove a escrita de noria_core.js; metadados são injetados somente nas projeções e jsCode gerados. |
| `scripts/build_noria_workflows.cjs:742` | Registra hashes dos bytes de 23 fontes/módulos locais usados no build. Substitui o nome morto noria_router_core.js por noria_router.js e inclui noria_turn_dispatch.js em artifacts. |
| `n8n/build_manifest.json:14` | Atualiza o manifesto a partir do candidato. source_sha256 distingue os hashes das fontes canônicas do CORE composto com metadados. O campo legado raw_disk_sha256 continua disponível, com sua semântica esclarecida. |
| `scripts/test_build_noria_workflows.cjs:1` | Executa duas vezes o gerador real em diretório temporário; confere preservação da fonte, ausência de cópia de fonte como saída, hashes completos e repetibilidade do manifesto. Falhou antes da correção pela gravação da fonte e passou depois. |
| `scripts/compare_noria_builds.cjs:1` | Comparador reexecutável de todos os workflows, suas estruturas, jsCode e projeções CORE/sales, normalizando apenas o bloco coreBuildMetadata. |
| `scripts/test_noria_nubia_route.cjs:36` | Corrige a referência de teste ao roteador inexistente para a fonte real noria_router.js. |
| `scripts/test_noria_engine_subworkflow.cjs:30` | Normaliza CRLF/LF nas comparações de fonte/export, mantendo a igualdade do conteúdo e asserções de topologia. |
| `scripts/test_noria_services_pipeline.cjs:300` | Normaliza CRLF/LF na comparação da EXT canônica com o export. |
| `scripts/test_semantic_contact_ignore_rpc.cjs:84` | Carrega fixtures de prompt e SQL em LF, correspondente aos hashes versionados; preserva validação de hash, configuração e rollback em banco PGlite local. |

Foram migrados **cinco** scripts ao harness. Somente **três** arquivos receberam conversões de verificações textuais/cópias para comportamento: settings, handoff e photo. Os três primeiros scripts da tabela mantiveram suas asserções. O exemplo `test_nubia_previous_service.cjs` já executava a EXT real e permaneceu intacto. Os outros ajustes de testes corrigem referências e finais de linha, sem trocar asserções de conteúdo por verificações mais permissivas.

## Exceções conhecidas — remover na Fase 3

São **26 ocorrências** aceitas, sem correção da lógica legada nesta fase:

| Fonte | Linhas originais e passivo |
| --- | --- |
| `n8n/sources/noria_core.js` | 64, 82, 4121, 4172, 4256, 4622, 5098 e 5617: nb_bronze_v1; 6445: PREVIOUS_SERVICE_CUSTOMER; 7439 e 7795: comentários com Wesley; 10541 e 13802: Wesley nas regex. Total: 13. |
| `clients/ic_saloon/salon_engine.js` | 68, 83, 3751, 3802, 3886, 4252, 4728 e 4802: nb_bronze_v1; 6012 e 6368: comentários com Wesley; 9114 e 12373: Wesley nas regex. Total: 12. |
| `n8n/code/command_router.js` | 746: condição tenantSlug !== 'ic_salon'. Total: 1. |

As exceções são hashes da linha exata, aparada, por arquivo, com consumo único. Mudar a linha ou adicionar outra ocorrência deixa de corresponder à baseline. Mudanças somente na posição da linha não geram uma nova exceção. A auditoria detecta os padrões definidos; não comprova ausência geral de hardcodes semânticos.

## Evidências de validação

| Verificação final | Resultado |
| --- | --- |
| node --test nos scripts modificados e regressões de build | **114/114**, zero falhas, zero skipped |
| node scripts/validate_noria_release.cjs | **698/698**, zero falhas, zero skipped |
| node scripts/audit_anti_hardcode.cjs | Passou, sem achados novos fora da baseline |
| npm test em app/ | **952/952**, zero falhas, zero skipped; baseline anterior também tinha 952/952 |
| npm run build em app/ | Comando padrão falhou com EPERM ao gravar .vite-temp dentro da junção de node_modules |
| npm run build -- --configLoader runner em app/ | **Passou**, sem instalar dependências ou mudar a configuração; avisos de chunks grandes e importações estáticas/dinâmicas |
| Idempotência virtual existente | **2/2**, incluindo travessia da meia-noite |
| Comparação do gerador antigo com o corrigido | **9 workflows** estruturalmente iguais e **46 jsCode** iguais após normalizar apenas metadados |
| git -c core.safecrlf=false diff --check | Passou |
| node --check nos arquivos JS/CJS alterados ou novos | **18 arquivos**, sem erro de sintaxe; JSX também compilado pelo Vite |

As falhas iniciais do gate foram investigadas: exports ausentes nesta cópia, diferenças CRLF/LF nas comparações e no hash de fixtures de prompt. Os exports locais autorizados foram copiados de `C:\Noria_Plataform\n8n\workflows` para o worktree e continuam ignorados pelo Git. Não se alterou SQL de produção para tornar testes verdes. O teste de fila do Salon inicialmente não encontrava PGlite no caminho temporário padrão; o gate agora usa a instalação já existente, preservando um eventual override explícito.

O gerador foi executado com NORIA_RETAIL_EXT_WORKFLOW_ID=vE8rPAAdzkkVzPBG e NORIA_BUILD_OUT_DIR fora do repositório. Diretórios preservados para inspeção:

- `%TEMP%\noria-generator-baseline-ref1`: saída do gerador anterior.
- `%TEMP%\noria-generator-candidate-ref1`: saída do gerador corrigido.

Reprodução da comparação em PowerShell, a partir da worktree:

```powershell
node scripts/compare_noria_builds.cjs `
  (Join-Path $env:TEMP 'noria-generator-baseline-ref1') `
  (Join-Path $env:TEMP 'noria-generator-candidate-ref1')
```

Comando da rodada de 114 testes, usando apenas a dependência local existente:

```powershell
$env:MAGIA_TEST_MODULES = Join-Path (Get-Location) 'app/node_modules'
node --test scripts/test_action_tag_detection.cjs scripts/test_noria_document_identity.cjs scripts/test_salon_slot_proposal_semantics.cjs scripts/test_noria_handoff_announcement.cjs scripts/test_noria_photo_promise.cjs scripts/test_audit_anti_hardcode.cjs scripts/test_build_noria_workflows.cjs scripts/test_noria_build_idempotency.cjs scripts/test_noria_nubia_route.cjs scripts/test_noria_engine_subworkflow.cjs scripts/test_noria_services_pipeline.cjs scripts/test_semantic_contact_ignore_rpc.cjs
```

## Limitações, riscos e rollback

As projeções versionadas `n8n/code/whatsapp_conversation_core.generated.js` e `n8n/code/whatsapp_sales.js` **já divergiam do build anterior à refatoração**. Foram preservadas para não incorporar mudanças comportamentais desse passivo nesta fase. A comparação relevante é gerador anterior versus corrigido sobre as mesmas fontes e exports; ela passou. Os hashes normalizados permitem distinguir essa deriva:

| Projeção | Build anterior | Projeção versionada preservada |
| --- | --- | --- |
| CORE | 398b06f381dafbd7dbdcb946f7951111385fadcfa3811ceb10126d6925e2b3a9 | 13209274064450bab3cc6aa4ace61fc9a591a33a38de26bc9606931d9d1f59ca |
| Sales | 132caf0393c1ab9239995de0c5bd37809063845e26a0cbc71b29508805552d30 | 71fed636173efabd258ace02398160e322e2aeaf27813fb0fd6dc206422a2fad |

Nenhuma fonte canônica do motor, EXT ou Salon foi alterada. A única refatoração de código usado pela UI é a extração dos helpers de settings, coberta pelos testes e pelo build. A topologia produzida pelo gerador não mudou. Mantiveram-se as estratégias existentes de projeção do builder; não foi feita uma reescrita geral do mecanismo de injeção.

Os testes não chamam Gemini nem enviam mídia ou WhatsApp. A prova de foto autorizada é uma fixture WeakMap em memória; a recomposição é verificada pela elegibilidade real, sem executar a redação completa com Gemini. Não houve validação de UI no navegador nem confirmação de paridade com workflows publicados. Os hashes de source_sha256 são de bytes e, portanto, sensíveis a finais de linha.

Não foram executadas as Fases 2 a 5, remoção de hardcodes, mudanças de schema, dependências, migração do Salon, alteração da topologia ou correção da deriva anterior das projeções. O build padrão do Vite continua sujeito à restrição de escrita da junção; use o loader runner neste ambiente.

Rollback local: reverta somente os arquivos desta entrega, incluindo a extração de helpers junto da importação em SettingsPage, preservando futuras alterações de terceiros. Remova apenas os novos arquivos desta entrega se desejar desfazê-la por completo. Nenhum rollback de produção é necessário.

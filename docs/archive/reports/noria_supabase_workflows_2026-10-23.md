# Supabase e workflows NORIA — investigação e correções locais

Data: 23/10/2026, consultas entre aproximadamente 22:19 e 22:33, America/Sao_Paulo.
Checkout inicial: `0549c3fd49d48de7ae723015fe549816eb04acd9`.
Projeto consultado: `NORIA-prod` / `gfwwawazivmuqyctjsxj`.

## Resultado

As correções feitas com o Claude estão no commit `0549c3f`. O código publicado continua diferente do local, confirmado por GET de três workflows específicos. Esta rodada corrigiu a validação semântica, ampliou a recuperação auditada e tornou a regeneração repetível. As fontes e os artefatos derivados foram atualizados localmente.

Validação final do escopo: **90 testes passaram**, **16 verificações de fotos passaram**, **32 nós JavaScript compilaram**, **15/15 entradas do build permaneceram idênticas na regeneração repetida**. A auditoria anti-hardcode e `git diff --check` passaram.

Isso não significa suíte geral verde nem correção publicada. Permanecem **72 falhas anteriores** em duas suítes antigas, problemas operacionais na fila e configurações comerciais ainda ausentes em produção. Nenhuma publicação, migração, escrita no Supabase, envio real, chamada real ao Gemini, commit ou push foi realizado. As três alterações locais preexistentes em `app/` foram preservadas.

## Escopo e método

- Consultas SELECT ao Supabase, introspecção das tabelas e de funções específicas, logs PostgreSQL e advisors de segurança/performance.
- Agregação inicial de **2.487 eventos** de canal nas últimas 48 horas: 1.681 da Gênesis e 806 da Núbia. É uma janela móvel; consultas posteriores podem incluir novos eventos.
- Inspeção dos **17 eventos com erro** dessa janela, com 86 registros de contexto próximos desses casos.
- Amostra adicional de 98 registros das 16 conversas mais recentes, oito por tenant. Não representa revisão integral de todo o histórico.
- Inspeção das fontes canônicas, commit do Claude, executor de homologação e workflows locais/publicados.
- Testes com provedores simulados; nenhuma autorização de teste foi extrapolada para produção.

## O que já estava corrigido pelo Claude

O commit `0549c3f`, de 23/10 às 17:57 BRT, contém:

| Área | Implementação local verificada | Limite atual |
| --- | --- | --- |
| Identidade dos fatos do estoque | `official.inventory.N.*` é vinculado ao veículo do próprio índice; `official.product.*` continua preso ao foco | Ainda não publicada |
| Origem de controle humano | `TURN_CONTROL_ORIGIN_REQUIRED` é extraído da resposta do banco e tratado como retry antes do envio | Não recupera automaticamente as linhas históricas já em review |
| Pressão do Gemini | Falha transitória antes do envio retorna à fila em vez de mandar frase técnica | Não houve teste real do provedor |
| Serviço humano | Serviço validado contra `business_facts.human_services`, com execução e prova de encaminhamento | Somente `despachante` aparece na configuração verificada da Gênesis |
| Apresentação de catálogo | Suporte a critérios obrigatórios e limite configurável de itens | `sales.catalog_presentation` está ausente em produção |
| Idade do estoque | CORE e EXT podem retirar a elegibilidade de linhas antigas | `sales.inventory_max_age_hours` está ausente; proteção opcional ainda desativada |

As cinco suítes adicionadas nesse commit passaram antes das mudanças desta rodada.

## Correções desta rodada

### 1. Remoção da promoção lexical de fatos rejeitados

`salesValidateSemanticEvidence` ignorava determinados segmentos `unsupported` se suas palavras aparecessem em uma lista de ligação ou na identidade do produto. Isso sobrepunha a decisão do auditor independente.

Reprodução: um relatório que rejeitava `O Onix custa 2020.` era aceito quando outro segmento comprovava apenas o ano 2020. O ano presente no ID do veículo fazia o preço inventado passar pela lista de palavras.

Mudança: removidos `linkingWords`, `supportedIdentity` e `onlyLinksSupportedProduct`. O veredito independente permanece bloqueante. O prompt de auditoria agora pede proposições completas, incluindo sujeito, ligação e qualificadores; o código não interpreta esses trechos por vocabulário.

Prova: dois novos casos falharam antes e passaram depois; um controle confirma a aceitação de uma proposição inteira sustentada por evidência.

### 2. Recuperação limitada de resposta sem suporte semântico

Os motivos `SEMANTIC_FACT_UNSUPPORTED` e `UNSUPPORTED_SEMANTIC_CLAIM` não eram elegíveis para a recuperação já existente. Mesmo quando seria possível reconhecer a ausência de informação, o atendimento ficava retido sem tentativa de candidata segura.

Mudança: esses dois motivos podem produzir **uma única** candidata nova. O prompt exige retirar a afirmação sem prova e seus pressupostos, sem confirmar hipótese do cliente, inventar negação ou anunciar ação não executada. Contradição, incerteza, auditor indisponível, origem divergente e evidência inválida continuam fora dessa recuperação.

Não há mensagem comercial pronta nem novo classificador. A recuperação usa o mecanismo e orçamento existentes. O caminho aceito de primeira não ganha chamadas; um turno elegível rejeitado pode consumir uma geração de reparo e uma auditoria adicional. Falha, indisponibilidade ou nova rejeição mantém o turno para o operador.

### 3. Reauditoria obrigatória da candidata recuperada

Durante a implementação do item anterior, foi reproduzida uma possível evasão: a candidata nova podia devolver `fact_evidence_mode: standard` e, em um pedido de preço, deixar de chamar o auditor semântico.

Mudança: depois de rejeição semântica elegível, o CORE impõe `fact_evidence_mode: semantic` ao contrato novo. O próprio modelo não pode reduzir a exigência de prova.

Prova: dois testes demonstraram uma auditoria em vez de duas antes do ajuste. Depois dele, a candidata passa por nova auditoria; se essa auditoria falha, nada é enviado e não ocorre nova reescrita. Os testes simulam os vereditos e comprovam a mecânica, não o julgamento real do Gemini.

### 4. Build idempotente

O builder alterava `built_at` a cada execução e a revisão ao mudar a data UTC, mesmo sem mudança das fontes. Isso modificava o CORE, motor e manifesto sem alteração de comportamento.

Mudança: metadados existentes de CORE+EXT são preservados quando os respectivos hashes continuam iguais e a revisão/data são válidas. Uma mudança real de CORE ou EXT renova os metadados. Os demais componentes continuam identificados pelos próprios hashes no manifesto.

Prova: teste executa o builder real com filesystem em memória, atravessa a meia-noite e compara todos os bytes. Outro caso altera CORE e EXT separadamente e verifica renovação de metadados e hashes. Na execução real repetida, os **14 artefatos declarados e o próprio manifesto**, 15 entradas totais nesta versão, permaneceram idênticos.

### 5. Fixture de identidade comercial compatível com a consulta atual

A suíte `test_genesis_commercial_policy_contract.cjs` devolvia `{settings}` no mock da consulta Supabase. O nó de identidade agora consulta aliases `campo:settings->campo`, cujo resultado expõe os campos diretamente. A fixture foi ajustada a esse formato; nenhuma asserção de negócio ou isolamento foi alterada. O teste voltou a passar, incluindo o bloqueio de outro tenant.

## Evidências de produção e pendências

### Eventos com erro

Foram encontrados 14 eventos com erro na Gênesis e três na Núbia. Entre os casos examinados:

| Evento | Evidência | Conclusão |
| --- | --- | --- |
| `1623b924-adb9-486b-9ebd-3f9d417a4f6a`, `1d32d60d-7eb0-49d8-b622-d018a8af26b7`, `6d839dfe-ab98-46ec-b9f8-f37ab0ac75a4` | `FACT_PRODUCT_IDENTITY_MISMATCH:official.inventory.3.advertised_price_cents` | Compatível com a correção local do Claude; publicação continua pendente |
| `4b3b14a0-5e1c-43d5-80f7-d9bcc99dd031` | Núbia, HTTP 400; log PostgreSQL registra `TURN_CONTROL_ORIGIN_REQUIRED` na RPC de supressão | Causa comprovada para esse caso; o erro genérico sozinho não permite atribuir a mesma causa a todo o histórico |
| `83cc7dcb-58cf-4233-845e-17aa8ef07d02` | Cliente pergunta a origem de leilão; candidata confirma recuperação de financiamento; auditor rejeita por falta de prova | Bloqueio factual correto. A melhoria local permite tentar uma candidata segura, sem autorizar a afirmação original |
| `7b9c1f98-07ed-48ff-8c6d-283fbb13ebd0` | Pergunta sobre compra de veículo com chassi remarcado; resposta atribui procedimento específico sem fonte | Não liberar a afirmação sem política/evidência; candidata alternativa ainda exige auditoria |
| `88a236f4-32c1-4e2e-981d-5e419109cffc` | Catálogo com nove opções, acompanhado de `UNFULFILLED_CATALOG_REQUEST` | Há suporte local a uma política de apresentação, mas a configuração de produção continua ausente |

Na amostra adicional da Núbia, o evento `3b933ce4-14da-48cb-8678-c8adaa7c8247` retoma Bronze Comfort após o cliente se referir ao primeiro serviço, tendo visto Clássico e depois Comfort. O estado cita uma mensagem anterior sobre o serviço deitado. **Hipótese pendente:** informação consultada pode ter permanecido como escolha. Não foi aplicada interpretação por palavra/ordinal; é necessário reproduzir o input completo da geração e validar a referência semântica antes de alterar esse fluxo.

### Fila durável

Consulta de estado atual, sem limitar a criação das filas às últimas 48 horas:

- **87 linhas com pending ou claimed**, sendo 83 em `review` e quatro em `uncertain`.
- 557 itens em `pending` e 166 em `claimed`. Esses itens não equivalem automaticamente a clientes distintos nem a mensagens ainda sem atendimento humano.
- **48 linhas em review com HTTP 400 genérico:** 31 da Núbia e 17 da Gênesis. O token específico do banco não foi preservado nesses registros antigos.
- Outros motivos incluem `explicit_technical_hold`, `new_messages_before_commit`, `lease_expired`, falha de áudio e ausência de prova terminal.
- As quatro linhas `uncertain` são de 06/10. Não foram liberadas nem reenviadas: precisam de reconciliação com prova de entrega.
- As 205 tentativas de entrega registradas na janela consultada estavam confirmadas, 93 da Núbia e 112 da Gênesis. Isso descreve essa tabela e janela; não comprova cada evento de mensagem ou follow-up.

Publicar a classificação de retry não remove retroativamente o estado `review`. A recuperação histórica exige triagem dos eventos, controle humano atual, validade da sessão e prova de envio; esta rodada não alterou essas filas.

### Configuração comercial e estoque

Na Gênesis, `business_facts.human_services` contém `despachante`. O serviço `busca_veiculo` e `sales.catalog_presentation` do arquivo pendente `supabase/migrations_pending_review/genesis_catalog_presentation_and_sourcing.sql` não aparecem na configuração consultada.

O snapshot contém nove veículos `announced`, dois `sold` e um `unverified`. A atualização mais recente das linhas anunciadas é de **19/10**; parte delas está em **14/10**. Isso comprova a idade do snapshot, não quais veículos foram vendidos depois.

`inventory_max_age_hours` está ausente. Ligar um limite de 48 horas no estado atual ocultaria todos os nove anunciados até uma sincronização válida. Não foi escolhida uma política comercial nem alterada essa configuração.

## Comparação com o n8n publicado

Somente GET por ID; comparação de parâmetros por objeto com chaves ordenadas, conexões e settings. Hashes abaixo são prefixos de SHA-256 do JavaScript com CRLF normalizado, não o hash normalizado do manifesto.

| Workflow ativo | ID | Nós local/publicado | Parâmetros divergentes |
| --- | --- | --- | --- |
| CORE de entrada | `3N5oN6sxtir9lFrA` | 70 / 70 | Registrar Mensagem na Fila: local `bbe2bb57ee5aa623`, publicado `b721fa04a5e2d223` |
| Motor conversacional | `mlKNPv862H2g3Gap` | 2 / 2 | CORE Motor: local `e1160b8b738b92dc`, publicado `4ad9b20720272fd9` |
| EXT Gênesis | `fXGorIlPbyf9Qtsp` | 3 / 3 | Identidade: local `f6a3667504656c99`, publicado `a813a6fdfa753849`; política: local `327be4517d05eff3`, publicado `6c02a966313951f3` |

As conexões são iguais nos três workflows. Os settings são iguais na entrada e EXT; o motor difere em `availableInMCP`. Portanto, topologia igual não comprova igualdade do código. A divergência do nó de entrada inclui revisão de build; não se atribui automaticamente a ele uma falha de comportamento.

CORE normalizado local: `a5844f3f9c9b73022e88bb8cc26615302136745c6d12dd0423526c1cc2ff4286`.
EXT local: `a608194a317ff12cc3addbd4a71c890fe361d37457388cad98ae91aacc82b77a`.

## Segurança e performance do Supabase

Os advisors produziram alertas de triagem, não prova automática de exploração ou gargalo:

- Segurança: 29 tabelas com RLS sem políticas, 21 funções SECURITY DEFINER executáveis por `authenticated`, extensão em `public` e proteção de senha vazada desativada.
- Performance: 55 FKs sem índice de cobertura, 30 ocorrências de avaliação de autenticação em RLS, 29 políticas permissivas múltiplas, quatro índices duplicados, sete índices sem uso e uma tabela sem PK.
- As funções críticas examinadas (`magia_claim_turn`, `magia_fail_turn` e `magia_turn_suppression_status`) **não** concedem execução a `anon` ou `authenticated`. Não foi demonstrado vazamento entre tenants nessa inspeção.
- Tabelas internas com RLS sem política podem estar intencionalmente fechadas a usuários; não se deve abrir políticas para eliminar aviso. Índice sem uso não deve ser removido apenas por esse contador.

Referências de remediação: [funções SECURITY DEFINER](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [RLS e avaliação de autenticação](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan), [índices duplicados](https://supabase.com/docs/guides/database/database-linter?lint=0009_duplicate_index). A documentação de [erros PostgREST](https://supabase.com/docs/guides/api/rest/postgrest-error-codes) explica por que um `P0001` pode chegar como HTTP 400; o token da resposta é necessário para classificar o caso.

Nenhuma política, função, índice ou configuração de produção foi alterada.

## Validação e limitações

Comando final, PowerShell na raiz do repositório:

```powershell
$env:MAGIA_TEST_MODULES = (Join-Path (Get-Location) 'app/node_modules')
node --test --test-reporter=tap scripts/test_genesis_dialogue_recovery.cjs scripts/test_dialogue_audit_business_claims.cjs scripts/test_turn_transient_failures.cjs scripts/test_inventory_snapshot_age.cjs scripts/test_catalog_presentation_policy.cjs scripts/test_human_services_handoff.cjs scripts/test_genesis_name_audit_flow.cjs scripts/test_genesis_deposit_ext_core.cjs scripts/test_catalog_presentation_proof.cjs scripts/test_genesis_identity_cache.cjs scripts/test_core_unavailable_media.cjs scripts/test_noria_services_pipeline.cjs scripts/test_nubia_extension_v2.cjs scripts/test_whatsapp_turn_queue.cjs scripts/test_noria_build_idempotency.cjs scripts/test_genesis_commercial_policy_contract.cjs
```

Resultado: **90/90**. A variável usa o PGlite já instalado em `app/node_modules`; não foi adicionada dependência. Os testes de Núbia v2 verificam a implementação isolada, não ativação do pipeline.

Checks adicionais:

- `photo_switch_checks.cjs`: **5/5**.
- `photo_authorization_checks.cjs`: **7/7**.
- `photo_delivery_checks.cjs`: **4/4**.
- `audit_anti_hardcode.cjs`: passou.
- `node --check scripts/build_noria_workflows.cjs`: passou.
- Regeneração repetida: **15/15 entradas idênticas**, incluindo manifesto.
- Compilação de 32 nós JavaScript e checagem de IDs/nomes e referências de conexão em quatro workflows: sem erros.
- `git -c core.safecrlf=false diff --check`: passou.

A bateria ampliada inicialmente teve 74 falhas: 50 em `test_whatsapp_core.cjs`, 22 em `test_whatsapp_sales.cjs`, uma em `test_genesis_commercial_policy_contract.cjs` e uma na carga da suíte SQL da fila. As fontes do HEAD foram carregadas apenas em memória para estabelecer a linha de base, sem restaurar arquivos do checkout: as três primeiras suítes reproduziram as mesmas **73 falhas** anteriores. Os primeiros erros das suítes CORE/vendas são fixtures sem o contrato atual de ingresso (`TURN_INGRESS_CONFIG_REQUIRED`). Isso não demonstra que todos os casos passem após adaptar as fixtures. A falha de carga SQL foi resolvida na execução apontando para o PGlite existente; a suíte SQL passou sem edição. A fixture de identidade comercial foi corrigida conforme o item 5. Restam **72 falhas anteriores** nas suítes CORE e vendas.

Nenhuma asserção antiga foi removida, flexibilizada ou alterada para ocultar essas falhas. Não há base para promover este conjunto alegando suíte completa verde. Também não há prova nova de comportamento do Gemini real, envio real ou paridade publicada após as correções.

## Arquivos e rollback

Fontes alteradas: `n8n/sources/noria_core.js` e `scripts/build_noria_workflows.cjs`.
Testes ampliados: `scripts/test_dialogue_audit_business_claims.cjs` e `scripts/test_genesis_dialogue_recovery.cjs`. Fixture atualizada: `scripts/test_genesis_commercial_policy_contract.cjs`.
Teste novo: `scripts/test_noria_build_idempotency.cjs`.
Derivados regenerados: manifesto, projeção de vendas, CORE gerado e JSONs do motor/entrada.

Rollback local: revisar e reverter somente os hunks desta rodada nesses arquivos-fonte e testes; remover o teste novo se a mudança do builder for desfeita; regenerar novamente a partir das fontes restauradas. Preservar qualquer trabalho posterior e as alterações preexistentes em `app/`; não usar restauração global do checkout. Como produção não foi modificada, não existe rollback remoto desta rodada.

Próximos trabalhos concretos: atualizar as fixtures antigas sem reduzir as proteções de entrada; reproduzir a referência de serviço da Núbia com a geração completa; validar sincronização/atualidade do estoque e a política comercial desejada; preparar publicação coordenada e triagem das filas históricas somente com autorização específica.

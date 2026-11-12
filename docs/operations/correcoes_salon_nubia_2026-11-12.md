# Correções do Salon e da NB Bronze (Núbia) — 12/11/2026

Este documento registra o que foi corrigido a partir da investigação de conversas do I&C Salon e da Núbia (relatório do Gemini revisado pelo Codex), o que foi aplicado em produção e o que vem a seguir. Ele substitui `investigacao_conversas_salon_nubia_2026-11-12.md`.

## Estado em uma linha

Tudo publicado no n8n em 12/11/2026 às 05:51 UTC (02:51 em São Paulo), com autorização do responsável: motor compartilhado, motor do Salon, EXT Núbia serviços e roteador (só o carimbo de revisão). Gênesis, EXT NORIA e Núbia política não mudaram. O prompt v5 do Salon está no NORIA-prod. A migração da fila ainda não foi aplicada.

Backup das versões publicadas antes: `.local/deploy_backups/2026-11-12T05-51-26-093Z/` (um JSON por workflow, mais `receipts.json` com versão anterior e nova). Para voltar, publique o JSON do backup do workflow afetado.

## Referência de verdade

- Os exports em `n8n/workflows/*.json` (nomes `NORIA-...--<workflowId>.json`) são a versão publicada e a referência. Eles estão no `.gitignore`; o backup anterior às correções, com o diff, está em `n8n/workflows/backup_pre_correcao_2026-11-12/`.
- As fontes foram sincronizadas com os exports e o gerador voltou a reproduzi-los: gerando numa cópia (`NORIA_BUILD_OUT_DIR`), 4 exports saem idênticos e 3 diferem só no carimbo de build.
- O I&C Salon passou a ter motor próprio: `clients/ic_saloon/salon_engine.js` (decisão do responsável). Correção no motor compartilhado (`n8n/sources/noria_core.js`) que também valha para o Salon precisa ser feita nos dois arquivos.

## Correções feitas

### Salon

| Problema | Correção |
| --- | --- |
| Cliente mandava o nome completo e a IA perguntava de novo, em loop | O nome dito na mensagem atual (ainda marcada como `buffer`) conta como prova |
| Com histórico estendido (`canonical_v2`) o adaptador dava erro | Aceita os dois tamanhos de leitura (50 e 251) |
| Hora do relógio usada como hora pedida | O revisor exige que dia e hora tenham sido ditos ou aceitos pela cliente |
| Pedido gravado em dia fechado ou fora do horário | O motor recusa e pede outro horário (usa `settings.business_hours`) |
| Prompt neutro e desalinhado do motor | Prompt v5 aplicado (ver abaixo) |

### NB Bronze (Núbia, `services_v1`)

| Problema | Correção |
| --- | --- |
| Auditoria aprovava horário de disponibilidade ou reserva só porque foi o horário pedido | Disponibilidade só com horário livre na prova; reserva só com o horário do recibo; o auditor marca se a frase afirma ou nega |
| Auditoria aprovava relatório sem nenhuma afirmação | Relatório vazio reprova |
| Serviço escolhido no turno anterior era recusado quando o dia e a hora vinham depois | Vale a escolha da mesma sessão; a do turno atual prevalece; outra sessão continua recusada |
| “Amanhã” dito antes da meia-noite | Cada mensagem chega ao modelo com a data local em que foi recebida |
| Anúncio que trouxe a cliente era ignorado | Título e texto do anúncio entram como contexto (texto de terceiro, nunca fato nem instrução) |

### Comum aos motores

- Saudação encadeada no meio da conversa deixava resto truncado em minúscula.
- O prompt passou a informar o dia da semana de hoje e de amanhã.
- **HTTP 4xx da Evolution** (envio rejeitado): o motor sinaliza a rejeição e a fila manda o turno para `review` em vez de `uncertain`, com a tentativa marcada como `rejected`. Se a migração ainda não estiver aplicada, o motor repete a chamada antiga e nada muda. Migração pendente: `supabase/migrations_pending_review/turn_fail_provider_rejected_v1.sql` (com rollback).

## Aplicado em produção

**Prompt v5 do Salon** — `clients/ic_saloon/11_proposta_prompt_v5_persona.sql`, aplicado em 12/11/2026 às 05:20 UTC com autorização do responsável. Rollback: `11_proposta_prompt_v5_persona_rollback.sql`.

- Persona pedida no questionário do salão: a integrante mais nova da equipe, no feminino, acolhedora e animada. Se perguntarem a sério se é pessoa ou robô, diz que é a assistente virtual da equipe.
- Sem frase de abertura decorada.
- Alinhado ao motor: sinal após falta pede concordância antes de registrar; mudar ou desistir de pedido vai para a equipe; `business_hours` criado (terça a sábado, 9h às 18h).
- Removido `invalid_request_template`, que alegava uma falha de WhatsApp inexistente.
- Conferência: o md5 do prompt em produção bate com o do arquivo; o teste `scripts/test_ic_salon_prompt_v5_proposal.cjs` prova que o rollback devolve exatamente o estado anterior.

## Testes

| Teste | Resultado |
| --- | --- |
| `scripts/test_export_fixes_salon_nubia.cjs` (exports, fonte compartilhada e fonte do Salon) | 45/45 |
| `scripts/test_turn_fail_provider_rejected.cjs` (fila em PGlite) | 7/7 |
| `scripts/test_ic_salon_prompt_v5_proposal.cjs` | 2/2 |
| `clients/ic_saloon/*.test.cjs` (adaptador reescrito para o comportamento atual) | 29/29 |
| `scripts/test_nubia_extension_v2.cjs` | 15/15 |
| Testes de topologia, follow-up e build atualizados | verdes, exceto `test_noria_services_pipeline` (17/18) até regenerar o manifesto |
| 60 suítes do CORE, antes × depois | nenhuma regressão |

## Regras de conversa por palavra-chave (NB Bronze e Salon) — feito localmente

As decisões que vinham de regex ou lista de palavras nos caminhos da Núbia e do Salon passaram para o Gemini, sem chamada nova (só o pedido de catálogo completo no Salon passa a usar a chamada normal):

| Antes (regex/palavras) | Depois (Gemini) |
| --- | --- |
| Corte de saudação repetida (`removeMidConversationGreeting`) | Instrução na geração; no Salon o revisor indica `remove_prefix` |
| Frustração com a IA (`isBotFrustrationText`) | Tag `[RECLAMACAO]` do Gemini decide handoff e emoji |
| Dicas de público, menor, idade, classificação no prompt do Salon | O prompt manda o Gemini interpretar |
| Pedido de catálogo completo (Salon) | Tag `[CATALOGO_COMPLETO]` do Gemini aciona a lista oficial do banco |
| Frases “paguei o sinal”, “pix realizado” | Só o gatilho configurado do tenant é comando; o resto o Gemini interpreta |
| `sessionReferenceIntent` (Núbia) | Campo `reference_intent` |
| Atalho de endereço antes do Gemini | `action: location` com o endereço do tenant |
| Regex sobre a resposta da IA (endereço, desculpa de memória, reserva/pagamento concluído) | Campo `reply_assertions` |
| Regex de desfecho (sinal pendente, nome completo, indisponível) | Campo `outcome_check` |
| `claimsBooking` do adaptador do Salon | Campo `claims_registration` no revisor |

Campo ausente ou fora do contrato falha fechado. A Gênesis não mudou (mesmos testes passando e falhando antes e depois); a auditoria anti-hardcode passa. Teste novo: `scripts/test_no_conversational_regex_nubia_salon.cjs` (18/18). O build foi regenerado localmente (exports, `generated.js` e manifesto), sem publicar.

Pendente desta frente: Gênesis (cerca de 100 regras nas funções `sales*`) e o caminho padrão do tenant NORIA.

## O que vem agora

1. **Acompanhar conversas novas** (atendimentos iniciados depois de 12/11 05:51 UTC) do Salon e da Núbia, com foco em tom, nome, horários e transferências.
2. **Sem frases prontas.** Os textos de configuração (`received_template`, `review_handoff_template`, `processing_error_template` e outros) passam a ser escritos pela IA no tom do tenant, com os dados obrigatórios (serviço, data, hora, aviso de menores, Pix) conferidos pelo sistema.
3. **Aplicar a migração da fila** (`turn_fail_provider_rejected_v1.sql`), só com autorização e depois de comparar com as funções de produção.
4. **Gênesis e tenant NORIA:** a mesma troca de regras por palavra-chave.
5. Confirmar se a EXT NORIA deveria manter `saveDataSuccessExecution: none`, que o export publicado perdeu.

## Recorte para avaliar conversas

Para julgar o comportamento das versões novas, considerar só atendimentos iniciados depois da publicação correspondente. O prompt v5 do Salon vale para conversas a partir de 12/11/2026 05:20 UTC (02:20 em São Paulo); as correções de motor valem a partir de 12/11/2026 05:51 UTC (02:51 em São Paulo).

## Investigação adicional após a publicação de 12/11/2026 (incidentes novos)

Recorte: a análise de comportamento em produção usa apenas mensagens posteriores ao prompt v5 do Salon (05:20 UTC) e aos workflows publicados (05:51 UTC). Arquivos locais abaixo ainda **não foram publicados** após esta investigação.

| Ponto | Evidência e causa | Alteração local / situação |
| --- | --- | --- |
| Núbia: repetiu “Oie, maravilhosa!” após “Quero marcar um bronze pra mim e minha amiguerr” | Eventos de `channel_events` às 06:01:33, 06:02:14, 06:04:24 e 06:04:52 UTC na mesma conversa (identificador anonimizado por MD5 `c39a495bfc9d3da44b44d3a47f750182`). O prompt v2 já pedia continuidade, mas a resposta de 06:04:52 abriu com saudação. A auditoria semântica anterior tratava cumprimento como `conversational` e não avaliava repetição. | `n8n/sources/noria_core.js`: auditoria independente passa a informar `opening_repeated` quando houve mensagem anterior da empresa; uma nova abertura dispara uma revisão única da resposta e, se persistir, reprovação. Teste focado em `scripts/test_noria_services_pipeline.cjs`. Precisa homologar com Gemini real e observar conversa posterior à nova publicação. |
| Núbia: cliente que já fez bronze pede “o que sempre faço / naquela máquina com 2 lados” | O relato de serviço anterior é evidência do turno atual; a descrição da máquina não basta para escolher modalidade. | `n8n/sources/nubia_extension.js`: `previous_service` com evidência atual exige `handoff`, sem consulta de vaga ou reserva. `n8n/sources/noria_core.js`: campo no contrato semântico, instrução ao Gemini e tentativa de atribuição a agente ativo após entrega. Há dois agentes ativos no tenant consultado. Teste `scripts/test_nubia_previous_service.cjs` 3/3. A atribuição ainda não foi exercitada com envio real; se falhar, o turno mantém o encaminhamento para a etapa humana. |
| Encaminhamento às 3h | `tenant_settings.business_hours` da Núbia: segunda a sábado, 08h–18h, `America/Sao_Paulo`; Salon: terça a sábado, 09h–18h em `settings.business_hours`; Gênesis: segunda a sexta 09h–18h, sábado 09h–14h. O fallback anterior dizia “Vou chamar a equipe” sem avaliar o expediente. | `n8n/sources/noria_core.js` e `clients/ic_saloon/salon_engine.js`: fallback consulta o horário estruturado; prompts operacionais recebem estado aberto/fechado e próxima abertura. Teste `scripts/test_handoff_business_hours.cjs` 2/2 às 03h. Royal 4x4 e tenant NORIA não apresentam horários estruturados em `tenant_settings.business_hours`, `settings.business_hours` ou `business_facts.opening_hours`; tampouco houve menção a horário no texto de configuração/agente consultado; o fallback evita prometer resposta imediata, mas a próxima abertura depende de configuração confirmada. |
| Salon se apresentou como “assistente virtual” | O v5 publicado já instrui “nova na equipe” na abertura, mas permite dizer “assistente virtual” quando perguntarem. A mensagem relatada viola a condição da abertura. | `clients/ic_saloon/12_proposta_prompt_v6_integrante_nova.sql` explicita a apresentação inicial e mantém resposta transparente à pergunta direta. Rollback correspondente; `scripts/test_ic_salon_prompt_v6_proposal.cjs` 2/2. Proposta SQL local, não aplicada. |
| “Atualização do atendimento” antes da resposta da IA | Evento operacional `noria_pipeline_pin` às 06:04:40 UTC, `delivery_status=internal`, texto vazio; `app/src/services/timeline/eventClassification.js` não o classificava como interno, então `chatTimelineHelpers.js` produzia título genérico. | Filtro compartilhado de carga/realtime e envio externo oculta o pin interno; `app/src/features/conversations/utils/chatTimelineHelpers.js` também o oculta de timelines já armazenadas em cache. `app/tests/unit/internalPipelineEvent.test.js`: falhou antes, passou depois. Eventos de auditoria permanecem no banco. |

Arquivos examinados nesta rodada: `C:\Noria_Plataform\n8n\sources\noria_core.js`, `C:\Noria_Plataform\n8n\sources\nubia_extension.js`, `C:\Noria_Plataform\clients\ic_saloon\salon_engine.js`, `C:\Noria_Plataform\clients\ic_saloon\11_proposta_prompt_v5_persona.sql`, `C:\Noria_Plataform\clients\ic_saloon\12_proposta_prompt_v6_integrante_nova.sql`, `C:\Noria_Plataform\scripts\build_noria_workflows.cjs`, `C:\Noria_Plataform\app\src\services\timeline\eventClassification.js`, `C:\Noria_Plataform\app\src\features\conversations\utils\chatTimelineHelpers.js`, `C:\Noria_Plataform\app\src\services\conversations\eventsToConversations.js`, `C:\Noria_Plataform\app\src\services\conversations\applyIncomingEvent.js`, `C:\Noria_Plataform\app\src\services\kanban\applyIncomingEvent.js`.

Validação: gerador de workflows executado localmente e exports atualizados; testes focados 69 passaram, 2 ignorados, nenhuma falha. Suíte completa do painel: 799 testes, 786 passaram e 13 falharam em áreas não resolvidas nesta rodada (AST/organização do painel, mídia/localização, Kanban). A alteração do filtro de pin passou nos testes unitários focados. `scripts/test_genesis_fixes.cjs` falha com `ReferenceError: referenceRoleOf is not defined` no harness do teste; a causa não foi investigada nesta rodada. Não houve nova publicação de workflow, aplicação de SQL nem envio WhatsApp real.




## Publicação autorizada das correções novas — 12/11/2026

O responsável autorizou nesta conversa a publicação dos workflows atualizados e a aplicação do prompt v6.

- **Prompt v6 do I&C Salon:** aplicado em produção em 12/11/2026 às 06:26:26 UTC (03:26:26 em São Paulo). `tenant_settings.settings.prompt_revision` conferida como `ic_salon_recepcao_v6_integrante_nova`; MD5 do prompt `142c7f4cd7ab6978a2a70278a0912afe`. Fonte: `C:\Noria_Plataform\clients\ic_saloon\12_proposta_prompt_v6_integrante_nova.sql`; rollback: `C:\Noria_Plataform\clients\ic_saloon\12_proposta_prompt_v6_integrante_nova_rollback.sql`.
- **EXT Núbia serviços v2:** workflow `6jSiEH2ugboYSack`, versão ativa `33ef543b-25cf-4a20-9764-3ad285d274d5` → `0ee137e6-529e-4d5c-87f3-a7e20ae525a7`.
- **Motor CORE compartilhado:** workflow `mlKNPv862H2g3Gap`, versão ativa `c5639a8e-1921-489d-a690-2c8a68dd9ba5` → `ca45df11-3b68-4af0-bbc6-9550f6170e34`.
- **Motor do I&C Salon:** workflow `yxdKP0PeskDMUFSo`, versão ativa `a416bf18-6611-4314-b18b-46d96bac2644` → `9387fe1d-445f-4599-8d44-1c56a5cf1ff2`.
- Os três workflows estão `active=true` e `versionId=activeVersionId`, conferidos pelo publicador e novamente pela API oficial do n8n. A última ativação foi às 06:28:16 UTC (03:28:16 em São Paulo). Núbia v1, Gênesis EXT, NORIA EXT e roteador permaneceram sem alterações.
- Backup anterior à escrita e recibos por nó: `C:\Noria_Plataform\.local\deploy_backups\2026-11-12T06-28-10-209Z\`. Para rollback, restaurar os JSONs desse diretório pelos mesmos IDs e ativar as versões restauradas; para o prompt, executar o rollback SQL com a revisão v6 ainda presente.

**Preflight:** `scripts/publish_exports_by_id.cjs check` comparou o estado ativo às versões e hashes da publicação anterior de 05:51 UTC. O `apply` alterou apenas `jsCode` dos três nós acima, preservando conexões, configurações e credenciais. Testes focados: 69 passaram e 2 foram ignorados; auditoria anti-hardcode passou. A regressão ampla `scripts/validate_noria_release.cjs` continua vermelha; os casos `test_human_services_handoff.cjs` e `test_genesis_fixes.cjs` também falham no checkout HEAD anterior a estas correções. Isso não demonstra regressão nova nesses casos, mas não equivale a suíte completa verde. Não houve homologação Gemini real nem WhatsApp real nesta publicação.

**Novo recorte de observação:** considerar apenas conversas iniciadas após **12/11/2026 06:28:16 UTC (03:28:16 em São Paulo)** para avaliar os motores novos. Para isolar apenas a mudança de persona v6, o corte do prompt é 06:26:26 UTC; como o motor do Salon mudou depois, preferir 06:28:16 UTC para avaliação conjunta.

A correção local do painel que oculta `noria_pipeline_pin` não foi publicada por esta operação: o pedido autorizou workflows e prompt, e a suíte completa do painel permanece com 13 falhas. Assim, a linha “Atualização do atendimento” ainda pode aparecer no painel implantado até que o frontend seja publicado.

## Rodada da tarde (12/11) — pronta, aguardando publicação

Comparação com o n8n (`scripts/compare_live_workflows.cjs`): a alteração do guarda de preço do Salon feita direto no n8n às 12:17 UTC e os nomes novos dos workflows da Núbia foram trazidos para o local. As únicas diferenças restantes são as correções abaixo.

**NB Bronze (motor + EXT):** encaminhamento à equipe deixa de ser reprovado como reserva sem recibo; repetir o horário pedido pela cliente é aceito; preparo só de blocos autorizados, com uma recomposição; `session_id` deixa de depender do eco do modelo; abertura repetida isolada não trava mais a conversa; fatos de público só quando o assunto é público ou bloqueio.

**Salon (motor próprio + adaptador):** revisor reprova horário oferecido como livre (`claims_availability`); reparo vazio corrigido (o reparo herdava a regra "só a tag"); pedido de nome, confirmação de nome, conflito e preço reprovado escritos pelo Gemini no tom do salão (templates só como reserva técnica); preço reprovado corrige só o preço e preserva o resto; falha técnica do auditor de preço registrada como `price_audit_unavailable`, separada de `price_rejected`; tratamento neutro da pessoa atendida (o salão atende homens e mulheres).

**Caso Rosemary (13:29–13:35 UTC):** não foi limite diário (115/300). O guarda de preço trocou duas respostas inteiras pela frase fixa; a pergunta sobre horário ficou sem resposta.

**Prompt v7 do Salon (proposta):** `clients/ic_saloon/13_proposta_prompt_v7_publico_misto.sql` — atendente no feminino, pessoa atendida neutra até se identificar, sem oferecer horário como livre.

**Validação:** regressão contra o que está no ar sem nenhuma regressão (motor: 62 suítes, 28 testes passaram a funcionar; Salon: 62 suítes); testes focados verdes; auditoria anti-hardcode passa.

**Decisão pendente:** qualquer reprovação do auditor ainda trava a IA para a equipe até um operador encerrar (`runServicesTurnFinalize`).

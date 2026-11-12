# Passagem de contexto para Claude e Gemini · NORIA CORE, Salon e Núbia

Registro de continuidade de 11/11/2026. Leia também [AGENTS.md](../../AGENTS.md) e as [regras CORE × EXT](../rules/anti-hardcode-core-ext.md). Confirme o estado atual no MCP antes de usar qualquer versão, horário ou diagnóstico abaixo como referência para produção.

## Mensagem para o Claude

Claude, retome em `C:\Noria_Plataform`. O Roteador é o único workflow pai, o Salon usa um motor isolado e as políticas comerciais pertencem às EXTs. Preserve comandos, follow-ups e disparos. As versões da tabela abaixo foram publicadas pelo MCP. A Núbia v2 está ativa para todos, sem lista de números. O piloto no final 5989 e o atendimento após a ativação geral no final 2313 tiveram entrega confirmada pela Evolution.

Corrigimos no Motor a rejeição da rota v1 durante o piloto da Núbia v2. Os finais 8468 e 1817 esvaziaram as filas após a publicação. No Salon, corrigimos handoff, persistência do estágio e respostas de agendamento que perdiam o contexto. A entrega de uma resposta vazia foi reproduzida como um caminho para HTTP 400 e recebeu proteção. O erro original não guarda o corpo da rejeição, então sua causa exata continua sem confirmação. Nenhuma migração nova foi necessária.

Os sete exports operacionais estão diretamente em `n8n/workflows`. Mantenha essa organização. Comece pela integração seletiva abaixo e confira o estado do n8n e do Supabase em leitura. Novas publicações, alterações no Supabase e envios reais exigem autorização explícita.

## O que falta integrar no dev

Na comparação, o checkout principal `dev` e o worktree `.claude/worktrees/subagentes-sonnet-haiku-opus-46ec52` apontavam para o mesmo commit `8e26437`. As duas cópias têm alterações locais. A publicação pelo MCP já aconteceu. A incorporação das fontes, do gerador e dos testes ao histórico do `dev` continua pendente.

| Área | Pendência no dev |
| --- | --- |
| Motor compartilhado | Integrar seletivamente de `n8n/sources/noria_core.js` a coexistência v1/v2, a proteção de resposta vazia e o registro de divergência entre pedido novo e reserva recuperada. A fonte do `dev` diverge da que foi validada no worktree. |
| Roteador e EXTs | Conciliar `noria_router.js`, `noria_turn_dispatch.js` e `nubia_extension.js` com os exports publicados. As fontes divergem entre os checkouts. `noria_extension.js` tem o mesmo conteúdo nos dois. Preservar chamadas por ID, validação de tenant, contrato de fase e comportamento de disparos. |
| Salon | Integrar as mudanças de `clients/ic_saloon/conversation_adapter.cjs` e `build_conversation_adapter.cjs`. Trazer `patch_salon_engine.cjs` e `build_conversation_adapter.test.cjs`, ausentes no checkout principal, e conciliar `conversation_adapter.test.cjs`. `price_guard.cjs` está igual. |
| Gerador e arquivos | Conciliar `scripts/build_noria_workflows.cjs` com a topologia publicada. Separar o contrato dos artefatos do gerador das cópias operacionais. Os seis JSONs com nomes antigos aparecem como removidos no `dev` e ainda há scripts que esperam esses caminhos. Ajustar as referências ou recuperar os insumos canônicos necessários em local apropriado, preservando os sete exports em `n8n/workflows`. |
| Homologação | Conciliar `scripts/test_noria_services_pipeline.cjs`, `scripts/homolog/services_executor.cjs` e `scripts/validate_noria_release.cjs`. Trazer `scripts/homolog/n8n_parent_runtime.cjs`, ausente no checkout principal. Rodar os testes no `dev` depois de resolver as referências aos artefatos. Os 561 testes aprovados foram executados no worktree. |
| Ferramentas de publicação | Revisar `scripts/publish_noria_cutover.cjs` e `scripts/test_noria_cutover_publisher.cjs`, presentes só no worktree, antes de incorporá-los. A publicação registrada aqui foi feita pelo MCP. |

Revise os diffs por responsabilidade e integre em commits pequenos. Regenere a partir das fontes e compare o código e as conexões com os exports ativos antes de considerar a integração concluída. As propostas SQL citadas no histórico já estavam aplicadas e não fazem parte dessa integração operacional.

## Arquitetura e escopo

- O **Roteador WhatsApp, Comandos e Follow-ups** é o workflow pai. Ele resolve a identidade do tenant, escolhe o caminho e chama os subworkflows. O Motor Conversacional Compartilhado é chamado pelo Roteador para executar o contrato comum. As EXTs concentram políticas de cada operação e usam os dados do tenant no Supabase.
- O I&C Salon usa um motor isolado para atendimento e pedidos de agendamento. A rota do Salon no Roteador exige correspondência de tenant ID, slug e instância. O Roteador envia o contrato de fase `noria_engine_phase_v1` aos motores.
- Núbia v1 e v2 são caminhos distintos. Publicar a EXT Núbia v2 disponibiliza a dependência para o Roteador. A seleção de v2 depende de `tenant_settings.settings.noria_turn_pipeline`. A v1 continua publicada para o caminho legado e para reversão.
- Preserve os disparos. O Roteador mantém comandos, follow-ups e os caminhos de disparo já existentes. Mudanças no Salon ou na Núbia não justificam alterar outros tenants.

## Workflows em produção

| Workflow | ID | Versão observada |
| --- | --- | --- |
| Roteador | `3N5oN6sxtir9lFrA` | `105b1eea-6686-4838-9712-396235c2e80d` |
| Motor compartilhado | `mlKNPv862H2g3Gap` | `98275ee2-acbb-4657-b968-d3b4ff87eb6d` |
| I&C Salon | `yxdKP0PeskDMUFSo` | `e47829c8-cf5a-435c-b688-17379cf0a0b2` (reversão: `717833ec-272b-4449-a59d-1818c061bcb8`) |
| EXT NORIA | `sLxNG9o2falquchd` | `eca29179-9512-4ead-bf07-90e91c280c1d` |
| EXT Núbia v1 | `vCDXJLqIBCZJRTVv` | `5d545c63-9e38-4325-aa2a-b6bf93ecd546` |
| EXT Núbia v2 | `6jSiEH2ugboYSack` | `6752feb2-eac4-48b8-94eb-ce46f19b3b36` |
| EXT Gênesis | `fXGorIlPbyf9Qtsp` | `2338fefd-6fe3-4ec3-bc43-9b7410133aac` |

Os sete exports estão em [n8n/workflows](../../n8n/workflows/README.md). O diretório contém cópias locais conferidas com o n8n e os JSONs ficam fora do Git. JIW, recuperação de fotos e Royal 4x4 estavam despublicados. Os artefatos canônicos exigidos pelo build e pelos testes usados neste corte estão no worktree do Claude. Use o MCP para ler, publicar ou restaurar versões e preserve IDs, credenciais e conexões.

## Corte e banco de dados

- A primeira tentativa de publicação foi revertida. O MCP exigiu a EXT Núbia v2 publicada porque três nós do Roteador a referenciavam. Depois de atualizar e publicar essa EXT, o corte publicou EXT NORIA, Roteador, Motor e Salon. A seleção da Núbia v2 permaneceu desligada durante o corte.
- A homologação isolada em n8n 2.44.5 cobriu as rotas dos tenants, a troca e a reversão dos motores. Foram 40 cenários de contrato e roteamento, 10 cenários da transição de versões e seis turnos completos sintéticos. A entrada com instância desconhecida seguiu o caminho legado com fallback JIW sintético. Esse achado não comprovou atendimento real.
- As propostas do Claude estavam em `supabase/migrations_pending_review`. A função de `sales_followup_resume_after_deferral_proposta.sql` já estava aplicada. O corpo no banco foi comparado ao arquivo local. A opção de retomada para Gênesis continuou desligada. As alterações de dados de `nubia_v2_follow_up_disposition_proposta.sql` também já estavam no banco. O contrato `noria_turn_lifecycle_v1` respondeu `ready:true`. Nenhuma migração foi necessária para o corte.
- O backup original do corte foi salvo no diretório temporário `NORIA-backup-corte-KtPpZV`, com ZIP `NORIA-backup-corte-KtPpZV-quatro.zip`. A pasta de exports publicados contém as versões posteriores às correções.

## I&C Salon

- A correção inicial removeu a supressão global de handoff, preservou o estágio conforme o pedido persistido e deu prioridade a pedido humano, reclamação, alteração e cancelamento. A revisão operacional com `manual_reply` preserva o atendimento automático quando o pedido ainda aguarda confirmação.
- A revisão pós-publicação encontrou sete respostas repetindo a alegação de mensagem perdida em 88 eventos, mais um erro `APPOINTMENT_CONTEXTUAL_REPLY_INVALID` após agradecimento. O texto repetido vinha do template de pedido inválido usado pelo adaptador para recusas diferentes. A escova anunciada a partir de R$ 50 correspondia ao catálogo vigente. Uma faixa de horário virou horário exato em um pedido, expondo a falta de auditoria desse dado.
- A versão atual do Salon substitui a resposta repetida por uma tentativa contextual auditada. A auditoria de criação avalia serviço, data, hora e nome com o contexto do atendimento. Uma faixa requer escolha de horário exato. Quando a resposta segura não é viável, o fluxo encaminha à equipe e preserva a reserva. Passaram 49 testes focados incluindo o motor isolado. O MCP confirmou a versão ativa. Na checagem imediatamente após publicar ainda não havia atendimento real novo para confirmar.
- A fonte corrigida está no worktree `.claude/worktrees/subagentes-sonnet-haiku-opus-46ec52`, em `clients/ic_saloon/conversation_adapter.cjs` e `clients/ic_saloon/patch_salon_engine.cjs`. Regenere com `clients/ic_saloon/build_conversation_adapter.cjs`. O repositório principal e o worktree têm alterações locais preexistentes. Confira o diff antes de integrar.
- Em 11/11/2026 foi publicada a versão `717833ec-272b-4449-a59d-1818c061bcb8`, com reversão para `4aa15d3c-85ce-459d-8c73-5cdfa9981c9b`. O adaptador passou a ler os agendamentos futuros do contato (`confirmed` e `pending_confirmation`) e a responder citando o que já está marcado. Pedido no mesmo horário vai para a equipe com texto visível. Nome que vem só de reserva anterior pede confirmação. Entraram templates por cenário, `full_name_template`, `missing_details_template` e `processing_error_template`, com padrão no código. `invalid_request_template` deixou de ser curinga. O reparo faz até 2 tentativas, mais uma terceira no caso de agradecimento, e nenhum handoff sai sem texto. O artefato incorpora o núcleo do Motor compartilhado `98275ee2`. A fonte é o mesmo worktree `subagentes-sonnet-haiku-opus-46ec52`. Testes: 11 novos, `clients/ic_saloon` 34/35 (a falha é de ambiente), núcleo 41/41 e comandos 36/36. O SQL `clients/ic_saloon/11_proposta_templates_contexto.sql` não foi aplicado e é opcional. A proposta 10 também não está aplicada em produção. Ainda não houve atendimento real após a publicação.
- Ainda em 11/11/2026, os 12 agendamentos de teste do Salon foram excluídos, com backup em JSON no scratchpad da sessão. As conversas 5989, 8468, 3474 e 3898 receberam um evento `resume_ai` (`kanban_stage_changed`) para sair da coluna Agendamentos.
- Na versão `717833ec`, o Ian (2313) pediu "corte amanhã 9:30" numa sessão sem nome e recebeu o erro de processamento. A causa foi reproduzida em teste: o revisor do adaptador não recebia `recent_context` e reprovava o pedido de nome. Não há execução salva no n8n que confirme isso.
- Publicada a versão `e47829c8-cf5a-435c-b688-17379cf0a0b2`, com reversão para `717833ec`. Mudanças:
  - Sem nome comprovado, a IA pede o nome completo (`full_name_template`). Se o nome vier de reserva anterior, usa `name_confirmation_template`.
  - `processing_error_template` fica só para falha técnica. Reprovação de conteúdo usa `review_handoff_template`. O revisor sempre recebe `recent_context`.
  - O `raw_payload` de saída passa a ter o diagnóstico `adapter_outcome`/`adapter_reason`/`adapter_trail`.
  - O adaptador lê o histórico do contato: agendamentos ativos futuros e também `no_show`, `cancelled`, `completed` e `done`. Se o desfecho mais recente for falta, exige sinal de 50% via Pix (`settings.payment`), avisa o cliente antes de registrar e grava `deposit_required` no pedido. Desmarcação em cima da hora ainda não conta; essa decisão está pendente.
  - Testes: Salon 47/48 (1 falha de ambiente), núcleo 41/41 e comandos 36/36. O filtro `or` foi validado com GET real.
- Aplicado no Supabase:
  - Migração `034_appointment_manage_actions` (arquivo em `supabase/migrations/034_appointment_manage_actions.sql`, rollback em `supabase/migrations_pending_review/`), com as RPCs `magia_update_appointment` e `magia_close_appointment` (cancelar → `cancelled`, arquivar → `completed`). As duas são `security definer`, só para membros ativos do tenant e sem `anon`.
  - Templates do Salon em `settings.appointment_request`: `conflict_existing`, `missing_details`, `processing_error`, `name_confirmation` e `review_handoff`. Também `settings.appointment_outcome.no_show_message_template`. A parte 2 do `11_proposta` não teve efeito, porque a proposta 10 não estava aplicada.
- O painel novo de Agendamentos ainda não foi commitado nem implantado: está só no checkout principal. Arquivar = `completed` conta como comparecimento para `magia_deposit_required_contacts`.

## Núbia v2 e entrega

- A EXT v2 é o catálogo e a decisão comercial. A cadeia executa bootstrap, dispatch, prepare, decisão, disponibilidade, reavaliação e finalize. A reserva recuperada deve ser preservada em um retry. Foi corrigido o cenário em que o pedido novo divergia da reserva recuperada e a EXT encaminhava à equipe, mas o Motor não registrava `NEW_REQUEST_DIFFERS_FROM_RECOVERED_RECEIPT`.
- Na conversa final **8468**, a v1 enviou uma resposta às 18h46:54 com recibo. A v2 recebeu a mensagem de 18h58, fixou o lote e tentou enviar às 18h58:54. O POST à Evolution `/message/sendText/{id}` retornou HTTP 400. O registro disponível não contém o corpo de rejeição nem o texto submetido. V1 e v2 usavam a mesma função, instância e formato de destinatário. A v2 não protegia contra texto que fica vazio após remover marcações, enquanto a v1 já o fazia. O cenário reproduziu o 400 em simulador. A correção encaminha à contingência se o texto final estiver vazio. Essa é uma causa reproduzida, ainda sem confirmação para o incidente real.
- Depois dessa correção no Motor, passaram 18 de 18 cenários de serviços e 560 de 560 testes de regressão. O final **5989** recebeu resposta às 19h13 pela v1. O log de 60 s encontrado na execução `563545` era do Motor compartilhado para a Núbia em 10/11, anterior ao corte. O timeout não foi ligado à falha do Salon nem ao HTTP 400.
- O piloto foi reativado em **11/11 às 19h27:07**, só para o final **5989**. Antes da ativação, a fila desse contato estava `ready`, sem mensagens pendentes ou reivindicadas. O teste real depende de uma nova mensagem enviada desse contato para o WhatsApp do NB Bronze. Verifique `noria_pipeline_pin`, evento de saída da v2 e recibo `confirmed` do mesmo lote em `conversation_turn_delivery_attempts`. Um envio pela v1 ou um fallback de contingência isolado não valida atendimento normal da v2.
- Às **19h28:48**, a consulta confirmou o piloto ativo e ainda não havia nova mensagem do 5989 após a ativação. A promoção geral seguia pendente.
- O critério para promoção era confirmar uma entrega normal da v2 antes de trocar `rollout` para `all` e remover a chave `pilot`. A promoção foi concluída, conforme o resultado abaixo. Em reversão, `enabled:false` devolve novos lotes à v1. Lotes já fixados seguem seu contrato até resolução.

## Reconciliação do final 8468

Na checagem anterior ao piloto, a fila estava `uncertain` com uma mensagem reivindicada e três pendentes, tentativa `uncertain` e nenhum ID de mensagem do provedor gravado. O erro registrado foi HTTP 400. O RPC `magia_resolve_turn_review` impede liberação ou retomada quando já existe tentativa. `magia_confirm_turn_delivery` exige recibo do provedor e evento de saída correspondente. A ausência de ID no banco não substitui a conferência no histórico da Evolution.

Conferir na instância `clinica_nubia` o histórico do envio correspondente. Com prova de entrega, usar o caminho de confirmação e finalização do lote. Com prova de rejeição, avaliar uma ação operacional auditável para encerrar somente o lote antigo, preservando as mensagens pendentes. Nenhum RPC implantado verificado cobre essa segunda transição sem prova de entrega. Não forçar `phase=ready`, apagar registros, forjar recibo nem reenviar a resposta antiga. Referências no worktree em `docs/operations/turn_queue_lifecycle_review.md` e `docs/operations/nubia_v2_cutover.md`.

## Resultado do piloto e ativação geral

- O 5989 recebeu duas respostas da v2, uma saudação e o menu cadastrado. Ambas tiveram auditoria aprovada e recibo confirmado da Evolution.
- O lote incerto do 8468 saiu da fila ativa após o encerramento pelo painel. A falha seguinte era outra. O Motor rejeitava a rota v1 escolhida pelo Roteador para contatos fora do piloto, antes de reivindicar as mensagens.
- A versão `98275ee2-acbb-4657-b968-d3b4ff87eb6d` aceita a rota legada da Núbia com os marcadores esperados e mantém a checagem de pino após a reivindicação. Foram 561 testes de regressão aprovados. Após a publicação, as filas do 8468 e do 1817 ficaram vazias. O 8468 recebeu uma resposta pela v1 nesse intervalo.
- Às **20h06:07 de 11/11/2026**, a Núbia v2 foi ativada para todos com `enabled:true`, `rollout:all` e sem a chave `pilot`. Em reversão, use `enabled:false` para novos lotes. A v1 continua publicada.

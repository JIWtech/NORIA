# Revisão e correções locais: CRLV, robôs, diagnóstico Gemini e contexto da Núbia

**Atualização posterior:** RPC, prompt v6 e Motor foram aplicados em produção em 27/10 com autorização do usuário. Estado ativo, backups e validações em [publicacao_correcoes_conversas_2026-10-27.md](publicacao_correcoes_conversas_2026-10-27.md). As indicações de pendência abaixo descrevem o estado anterior à publicação.

## Estado verificado antes de alterar

Em 27/10/2026, o Motor ativo consultado foi `5e456a7c-6275-40f2-910a-575c043f53ec`. O código ativo foi lido pela API do n8n e guardado em `.local/pending-four-fixes/active-core-before.js`. SHA-256 normalizado: `c58921da0302bc923d100ffdebdd3976a22689961554bdebe09f2a45862475e2`. Não foi publicado ou sobrescrito.

O repositório já continha correções recentes de contatos comerciais/fixos, encerramento de follow-up, observabilidade HTTP e tratamento de retenção técnica. Elas foram preservadas. Os quatro pontos deste relatório ainda tinham lacunas:

| Item | Lacuna confirmada | Alteração local |
| --- | --- | --- |
| P1-11 | Classificador sem categoria veicular; OCR exigia identidade pessoal | Categoria `vehicle_document`, extração veicular separada e preservação das fotos |
| P1-6 | Núbia sem supressão genérica de não cliente; robôs sem fato comercial no ingresso | Classificação semântica com prova atual e encerramento silencioso por turno |
| P2-9, passo 0 | Regeneração não registrava o motivo e metadados das duas candidatas | Diagnóstico sem conteúdo, preservado entre preparação e finalização |
| N-1 | Histórico comercial anterior filtrado por grounding/revisão; sem abertura estruturada | Contexto por autor, sinal `opening` e nome com evidência; prompt sucessor v6 |

As configurações lidas confirmaram Gênesis em `sales_v1` e Núbia em `canonical_v2`, com a pipeline de serviços v2 desabilitada. Não houve mudança de roteamento ou ativação de piloto.

## P1-11: CRLV

- `salesClassifyImages` distingue documento veicular de documento pessoal.
- O OCR também distingue ambos, inclusive para um PDF recebido como documento. Em `vehicle_document`, CPF/CNPJ/nome do proprietário, RENAVAM e CNH não são utilizados como identidade do solicitante.
- Só marca, modelo e anos legíveis são disponibilizados ao modelo como dados relatados pelo documento do cliente. Não viram fatos oficiais de estoque nem são injetados diretamente no estado comercial.
- Uma leitura veicular que falha fica marcada como ilegível sem perder as demais fotos. Para documento pessoal, as validações anteriores de CPF/CNH/nascimento continuam bloqueando dados inválidos.
- O teste reproduz um documento veicular e quatro fotos, com CPF inválido do proprietário deliberadamente devolvido pelo OCR simulado: esse CPF é descartado e as fotos permanecem.

Limitação: a execução antiga do Rodolfo não estava disponível; o campo exato que disparou o erro histórico continua não comprovado. Não foi feita leitura paga de suas imagens nem reenviado seu turno.

## P1-6: ignorar a resposta automática, sem bloquear o contato

Nos ingressos consultados dos dois contatos relatados, `business_account` e `owner_saved` estavam nulos. Portanto, a correção recente de números comerciais não resolvia esses casos. Não foram fabricadas autorizações `non_customer` nem usados nomes de contatos no código.

A decisão usa o Gemini já chamado pelo atendimento e um campo estruturado `contact_context`. Ignorar exige identificação de outra empresa copiada da mensagem, prova de todas as mensagens atuais e ausência de pedido real, citação ou encaminhamento. Dúvida, menção a outra empresa ou lote com mensagem humana não são motivo de descarte. Prova autenticada de `non_customer` agora é respeitada genericamente, sem depender de regex de saudação.

O contrato atual da fila não permite declarar `done` silenciosamente sem evidência terminal autorizada. Colocar o turno em `review` prenderia também mensagens humanas futuras. Por isso foi preparada uma **nova RPC**, sem criar ou alterar tabelas, para concluir somente esse turno de forma atômica:

- restrita ao serviço; exige token e lease atuais, modelo configurado, nenhuma tentativa de entrega e ingresso autenticado de todos os eventos no tenant/canal/conversa corretos;
- grava apenas um evento interno vazio e um recibo do turno;
- cancela follow-ups pendentes/em processamento dessa conversa e tenant;
- não envia texto, não agenda novos follow-ups e não altera contatos, identidade ou bloqueio de IA;
- devolve a fila a `ready`, preservando mensagens novas em `pending`;
- repetição da mesma conclusão não duplica os efeitos.

**Dependência de publicação:** `supabase/migrations_pending_review/semantic_automated_contact_ignore_v1.sql` é uma proposta de alteração de função no schema, ainda não aplicada. Exige autorização explícita antes de aplicação. Para esta parte, não publicar o Motor novo sem a RPC correspondente. A intenção do usuário registrada foi ignorar sem responder; não foi interpretada como autorização para alterar produção.

Limitação: classificação semântica não é garantia absoluta de zero falso positivo. Foram testados os contratos, a ausência de envio e os limites de evidência com respostas simuladas; homologação paga e aceite em produção ainda não ocorreram.

## P2-9: observabilidade da saída

`model_output_diagnostics` registra somente `finish_reason`, `output_chars`, `validation_reason` e `attempt`. Distingue JSON inválido, estrutura incompleta, resposta vazia, saída incompleta e candidata ausente. Não grava resposta, prompt, documento, telefone ou mensagens do provedor.

Uma regressão exercitando preparação → EXT → finalização encontrou que os metadados se perdiam na passagem entre fases; essa passagem foi corrigida. Os testes verificam duas rejeições e uma regeneração bem-sucedida, além de JSON inválido e `MAX_TOKENS`. Não foram aumentados tokens, orçamento ou número de tentativas. A projeção comercial gerada inclui a dependência do diagnóstico.

## N-1: contexto e abertura

O contexto recente contém até 12 mensagens em ordem, com IDs e autores (`customer`, `assistant`, `follow_up`, `operator`), inclusive respostas antigas de prompt e respostas diretas. Falhas e eventos técnicos não contam como mensagens enviadas. Mudança de prompt não reinicia a abertura. O histórico continua sendo contexto, nunca fonte comercial oficial.

`opening` considera as respostas efetivamente enviadas na sessão. `known_customer_name` exige nome em estado validado e evidência do próprio cliente. Nos casos consultados, os nomes usados pelos follow-ups não tinham essa prova nos estados examinados; não foram promovidos a nomes comprovados.

O filtro anterior do histórico é um defeito concreto, mas não explica sozinho todos os casos: havia apresentação anterior com a mesma revisão no caso examinado. A ausência de um sinal explícito de abertura e a instrução de apresentação também precisavam ser tratadas. Os testes comprovam o novo contexto entregue ao modelo; o efeito sobre a redação real ainda depende de homologação/observação autorizadas.

Prompt sucessor: `clients/clinica_nubia_oficial/prompts/system_prompt_context_v6.txt`. Propostas de atualização e rollback são geradas por `node scripts/build_nubia_context_prompt.cjs`, sem conexão ao banco. O hash do v5 local confere com o prompt ativo lido: `d7601f67881365a8ba2bd463d99a6321`. O SQL exige exatamente uma linha com esse hash, aborta em caso de drift, preserva as outras configurações e tem rollback exato testado. Nenhum prompt de produção foi alterado.

## Validação e artefatos

- Testes novos reproduziram as lacunas antes da correção. Foram exercitadas funções canônicas, o executor real de fases com Gemini simulado e PostgreSQL local via PGlite.
- Barreira: **277/277 aprovados**.
- Suíte ampla antes: 662 testes, 502 aprovados, 150 falhas e 10 skips. Depois: 680 testes, 520 aprovados, mesmas 150 falhas e 10 skips. Comparação por identidade das falhas; nenhuma nova. A suíte ampla não está integralmente verde.
- Nenhum teste removido. A expectativa da lista de campos obrigatórios em `test_follow_up_closure.cjs` foi estendida para também exigir `contact_context`, preservando `customer_disposition`.
- Auditoria anti-hardcode aprovada. Artefatos n8n regenerados e teste de build idempotente aprovado pela barreira. Diff sem erros de whitespace.
- Logs em `.local/pending-four-fixes/`: `tests-before.log`, `focused.log`, `release.log`, `broad-before.log`, `broad-after.log`, `anti-hardcode.log`, `build.log` e `diff-check.log`.
- Mudanças de frontend já existentes foram preservadas e não integram este incremento.

## Publicação e rollback

Nada foi aplicado em produção: sem migração/RPC, atualização de prompt, publicação de workflow, WhatsApp ou liberação de fila antiga. Os testes não usaram Gemini pago.

Para publicar posteriormente, revisar e autorizar cada incremento. A supressão semântica exige RPC primeiro e Motor compatível depois. O prompt v6 é uma atualização de dado separada, guardada por hash. Conferir novamente a versão ativa e fazer backup do workflow antes de qualquer publicação.

Rollback: reverter o prompt v6 com seu SQL guardado, se aplicado; restaurar o Motor anterior com versão esperada e backup; só então remover a nova RPC com `semantic_automated_contact_ignore_v1_rollback.sql`. Eventos e recibos históricos permanecem para auditoria. Não restaurar a árvore inteira nem sobrescrever alterações paralelas.

# NORIA — logs e correção da autoridade CORE × EXT — 24/10/2026

## Estado desta rodada

As correções abaixo foram implementadas nas fontes locais e os workflows derivados foram regenerados. Não houve nova publicação no n8n, escrita no Supabase, liberação de filas nem envio real de WhatsApp nesta rodada. O repositório começou limpo no commit `2df6270`.

## Comparação local × produção antes de editar

Leitura direta de `/api/v1/workflows/{id}`, incluindo `activeVersion`, em 24/10. Não foram usados somente nomes, contagem de nós ou datas para inferir paridade.

| Workflow | ID | Versão ativa verificada | Resultado |
|---|---|---|---|
| Entrada compartilhada | `3N5oN6sxtir9lFrA` | `e95f9020-a88f-4603-b1e4-8ce225293c4a` | Parâmetros dos nós e conexões iguais; settings diferiam apenas na ordem das chaves JSON |
| Motor | `mlKNPv862H2g3Gap` | `eebbab87-35c5-456c-9327-0e2d6cc0265a` | Mesmo código executável; CRLF e duas linhas vazias finais diferiam. Produção também tem `availableInMCP: true`, ausente no settings local |
| EXT Gênesis | `fXGorIlPbyf9Qtsp` | `201abb2b-e872-461e-924d-e0544bf20b8e` | Parâmetros, conexões e settings iguais |

Portanto, a suspeita de paridade de comportamento era correta; dizer que todos os hashes brutos são iguais seria impreciso. Após as correções desta rodada, o Motor e a EXT locais passam a diferir intencionalmente das versões acima.

## Erros posteriores à última publicação

Janela investigada: 24/10 às 01:15 BRT em diante. Logs PostgreSQL consultados entre `2026-10-24T04:15:00Z` e `2026-10-24T13:45:00Z`.

### n8n

Nenhuma execução com status `error` ou `crashed` encontrada após o corte. Isso não significa ausência de falhas de atendimento: o CORE captura erros e os persiste no Supabase, podendo concluir a execução do n8n sem status vermelho. Sucessos não são armazenados pelo workflow.

### Supabase — falhas comprovadas no atendimento

- Núbia: três eventos `Request failed with status code 400`, às 09:15:18, 09:38:18 e 10:07:12 BRT.
- Os logs PostgreSQL correlacionam esses três horários a `TURN_CONTROL_ORIGIN_REQUIRED`, na função `magia_turn_suppression_status`, linha 60. Não são erros comprovados do Gemini.
- O último controle anterior a cada erro era uma `manual_reply` de 17/10 ou 19/10 sem registro em `conversation_turn_control_origins`. Respostas manuais posteriores já têm origem atestada. Não foi fabricada origem para os eventos históricos.
- Gênesis às 08:31:07: `INVALID_PRIMARY_REPLY;UNANSWERED_REQUEST:request_1`.
- Gênesis às 10:23:54: `SEMANTIC_FACT_AUDIT_REQUIRED;UNSUPPORTED_FACT:official.product.color`. Houve tentativa de reparação, também rejeitada por `SEMANTIC_FACT_UNSUPPORTED`.
- Gênesis às 10:24:06: `INVALID_PRIMARY_REPLY;MISSING_RESPONSE_CONTRACT`, com fallback registrado como `invalid_or_missing_semantic_intent`.
- O Onix correspondente tem `color = NULL` no inventário. O bloqueio da afirmação de cor é necessário; não se deve remover a auditoria para enviar essa afirmação.
- A consulta de filas atualizadas desde o corte encontrou 7 linhas da Núbia em `review:Request failed with status code 400`, 2 da Gênesis com o mesmo motivo, 2 da Gênesis em `explicit_technical_hold` e 1 em `new_messages_before_commit`. Atualização de fila não comprova o instante da falha original nem equivale a uma nova mensagem sem resposta.

As falhas de resposta/contrato vazio da Gênesis e a reconciliação dos controles históricos continuam pendentes. Testes locais de recuperação não provam que o Gemini produzirá uma candidata válida nessas conversas reais.

## Violações corrigidas nas fontes

### 1. Serviços e apresentação do catálogo passam a ser decididos pela EXT

Antes, `salesTenantHumanService` no CORE interpretava o cadastro comercial, validava `requires=no_inventory_product` e convertia o serviço em `human_requested=true`. Isso misturava solicitação de serviço e pedido explícito de atendente.

Agora a EXT Gênesis:

- autoriza o ID contra `business_facts.human_services` vindo das configurações verificadas;
- rejeita IDs ausentes, semântica inválida e objetos `human_service` pré-montados pelo CORE;
- avalia `requires=no_inventory_product`, bloqueando busca de parceiros quando há seleção/interesse atual validado em produto; um foco histórico sozinho não bloqueia a procura de outro veículo;
- emite `operations.human_service` e `handoff.reason=declared_service`;
- normaliza `sales.catalog_presentation` e emite `operations.catalog_presentation`.

O CORE transporta a indicação do modelo e executa o resultado da decisão comercial validada. O plano preparado deixa de fabricar um pedido explícito de humano. Os textos de confirmação continuam no cadastro do tenant.

### 2. Pós-venda e silêncio passam a ser política da EXT

A EXT emite `operations.after_sales.active` e `response_policy.silent`. Um pedido de serviço autorizado recebe a confirmação; um pós-venda sem serviço continua seguindo a regra de silêncio da Gênesis. Quando um serviço havia sido indevidamente marcado como pós-venda, a EXT também limpa esse modo do estado comercial para não perpetuar o erro.

Foram removidos do CORE o `if (tenantSlug === 'wesley_automoveis' && afterSales)` que zerava a mensagem e a regex que usava texto livre como autoridade de pós-venda. O CORE aplica a política de silêncio somente quando a decisão comercial está autorizada.

### 3. Nome do atendente

Foi removida a preferência `/wesley/i` de `salesResolveDefaultAssignee`. O operador configurado continua prioritário; na ausência dele, usa-se o primeiro operador ativo do próprio tenant pela ordenação já existente.

Foi removida a condição pelo slug da Gênesis em `salesHandoffMessage`. A EXT informa o rótulo de apresentação em `response_policy.assignee_label`; o CORE usa esse resultado ao compor o aviso operacional.

### 4. A identidade do EXT descartava configurações necessárias

`genesis_tenant_identity.js` não projetava `human_services`, `catalog_presentation` nem `inventory_max_age_hours`. Assim, essas configurações podiam estar no Supabase e no CORE, mas não chegar à EXT.

A projeção agora inclui os três campos e mantém a exclusão de campos alheios. O cache ganhou o marcador `genesis_identity_commercial_projection_v2`: uma entrada produzida pela versão antiga não é reutilizada depois da mudança.

### 5. Diagnóstico dos erros PostgREST

`supabaseRaisedToken` reconhecia apenas alguns envelopes com corpo já convertido em objeto. Acrescentado suporte a `response.body`, `error` e corpos JSON serializados, inclusive no `cause`, com limite de tamanho e aceitação exclusiva de tokens técnicos.

O teste reproduziu a perda de `TURN_CONTROL_ORIGIN_REQUIRED` para um HTTP 400 genérico e passou após a correção. O turno aguarda a origem pelo retry existente, sem envio e respeitando o orçamento de tentativas. Essa melhora não atesta automaticamente controles históricos nem libera filas já retidas. O envelope exato das exceções antigas não foi preservado; não se atribui a essa melhoria a resolução comprovada de todos os 400 históricos.

## Validação

- 145 testes passando em 19 arquivos direcionados: serviços, identidade/cache, catálogo, pós-venda, recuperação, handoff, CORE×EXT, financiamento/documentos, marca/ano, reservas, follow-up e privacidade no Telegram.
- Reproduções de falha antes da correção para o transporte dos tokens e o cache antigo.
- Casos negativos: ID inventado, semântica inválida, objeto de serviço forjado, busca com produto selecionado, política de silêncio sem autorização e isolamento de campos da projeção.
- O teste que exigia literalmente o `if` por slug no CORE foi substituído por uma verificação da política do EXT, incluindo os casos de silêncio autorizado, não autorizado e decisão ausente. O cenário completo de pós-venda silencioso também continua passando.
- Build executado repetidamente com os mesmos hashes nas fontes e workflows derivados; `git diff --check` limpo.
- Nenhuma alteração em frontend, dependências ou schema.
- A suíte ampla possui falhas legadas e dependências locais ausentes. A comparação das falhas relevantes com o HEAD confirmou as três falhas anteriores de `test_noria_contextual_reply`; a suíte completa não está verde. O teste que exige Gemini real foi excluído da varredura final.
- A varredura ampla registrada nesta rodada executou 67 arquivos, com 391 testes passando e 168 falhando em 28 arquivos. Depois dela foi acrescentado mais um caso para preservar a troca de veículo com foco histórico, e os 19 arquivos direcionados foram repetidos: 145/145. Não se apresenta a suíte ampla como verde nem se misturam esses dois recortes.

## Limites e próximos blocos

Esta rodada não torna todo o CORE genérico. Ainda há 94 linhas com comparações diretas de `tenantSlug` com `wesley_automoveis`, além de outras regras legadas. Foram retiradas as decisões dos fluxos de serviço, apresentação do catálogo, pós-venda e apresentação/escolha do atendente tratados aqui. Migrar os outros fluxos exige seus próprios blocos de regressão; não devem ser removidos em massa.

## Publicação e rollback

As mudanças são locais. Caso sejam publicadas, a EXT e sua projeção de identidade precisam estar disponíveis antes de o Motor começar a consumir os novos campos. A entrada de follow-ups não precisa ser alterada por esta correção. Preservar IDs, conexões, credenciais, configurações e versões de referência da tabela acima.

Rollback: reaplicar os nós das versões de referência do Motor e da EXT. No repositório, recuperar as fontes correspondentes de `2df6270` numa revisão explícita e regenerar os artefatos juntos. Não reverter só um JSON nem descartar alterações locais não relacionadas.

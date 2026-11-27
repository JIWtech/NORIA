# Análise das conversas da semana e correções (26/11/2026)

Análise das conversas de 23 a 26/11 dos tenants com mensagens (`clinica_nubia_oficial`, `joyeria`, `noria`) e as correções feitas no `dev`. Nada foi publicado no n8n nem enviado ao GitHub nesta data, salvo a migração indicada abaixo.

## Achados

| Tenant | Problema | Dado |
| --- | --- | --- |
| JOYERÍA | A IA conversou com o robô de atendimento de uma operadora | 250 respostas em 1h40 (25/11); só parou no limite interno do Gemini |
| Núbia | Auditoria barrava respostas seguras e mandava para a equipe | 15 reprovações por pedido sem resposta desde 21/11; 11 sem nenhuma outra falha |
| Núbia | EXT não liberava o menu de valores em pedido genérico com esclarecimento | Confirmado no simulador com mensagem real |
| noria | Caminho padrão sem trava de laço | 7 respostas em 4 min ao mesmo robô (21/11) |
| Núbia e Gênesis | Conversas travadas em revisão desde outubro | 208 (Núbia 40, Gênesis 168), todas com chamado aberto |

Espera da equipe na Núbia (semana de 23/11): 25 encaminhamentos, 19 respondidos e 6 sem resposta. Mediana de 24 min (22 min no expediente); os 10% mais lentos passam de 7h40.

## Correções no `dev`

| Commit | Correção |
| --- | --- |
| `4da1f34e` | Pipelines `retail_v1` e `services_v1`: a interpretação classifica robô de outra empresa (`contact_context`, sem chamada extra) e o turno é ignorado; trava de laço configurável em `settings.conversation_loop_guard` |
| `90bf4044` | Repetição de texto do contato: com 5+ mensagens repetidas, a IA para com 10 respostas em 30 min (30 sem repetição) |
| `0917d1ae` | CORE usa a RPC de ignorar contato também com o `semantic_model` |
| `d29e2773` | Núbia: resposta segura que não cobre todo o pedido, depois da recomposição, é entregue e marcada (`audit.semantic.tolerated_failures`) |
| `ebe236bb` | EXT Núbia: pedido genérico de valores com esclarecimento recebe o menu aprovado |
| `b0355551` | Trava de laço também no caminho padrão (`runTurn`, tenant `noria`) |
| `d86cb87c` | Proposta de encerramento em lote das revisões seguras (não aplicada) |

Testes: suíte de release `node scripts/validate_noria_release.cjs` com 791/791. Simuladores com o Gemini real em `scripts/validate_pipeline_contact_gemini.cjs` e `clients/clinica_nubia_oficial/simulador/simular_conversa.cjs` (teto de 5 chamadas por execução; `SIM_MAX_CHAMADAS` só com pedido explícito).

## Mudança operacional aplicada em produção

- Migração `20261126125941_semantic_contact_ignore_semantic_model`, aplicada em 26/11 com autorização do responsável: `magia_ignore_automated_turn` aceita a prova do `ai_model` ou do `semantic_model` do tenant. Conferido depois de aplicar: definição nova ativa, `SECURITY DEFINER`, execução só por `service_role`.
- Rollback: `supabase/migrations_pending_review/20261126125941_semantic_contact_ignore_semantic_model.rollback.sql` (cópia exata da função anterior, md5 `08ba2e28beac805599f0fff7e882591f`).
- Compatível com o motor publicado: ele ainda não chama a RPC pelos pipelines em fases.

## Revisões travadas (Frente 3)

| Situação | Núbia | Gênesis | Tratamento |
| --- | --- | --- | --- |
| Equipe respondeu por último | 33 | 61 | Encerramento em lote pela função proposta |
| Equipe atendeu, cliente falou depois | 1 | 58 | Equipe revisa no painel |
| Possível envio a conferir | 1 | 1 | Equipe revisa no painel |
| Equipe nunca respondeu | 5 | 48 | Equipe revisa no painel |

A RPC do painel recusa os casos seguros com `STALE_TURN_REVIEW`, porque o `queue_snapshot` do chamado não bate mais com a fila.

Migração `supabase/migrations/20261126133157_admin_close_stale_turn_reviews.sql`, aplicada e executada em 26/11 com autorização do responsável. Teste em `scripts/test_admin_close_stale_turn_reviews.cjs`. A função simula por padrão (`p_dry_run = true`) e reaplica os critérios conversa a conversa.

Resultado: a simulação apontou 33 (Núbia) e 61 (Gênesis), exatamente as seguras. A execução fechou as 94, com 94 recibos `cancelled` e chamados marcados `admin_closed_stale`; nenhuma fila ficou com sobra. Ficaram abertas 114 (Núbia 7, Gênesis 107) para a equipe.

Rollback: `supabase/migrations_pending_review/20261126133157_admin_close_stale_turn_reviews.rollback.sql`. Ele devolve cada fila à revisão com o mesmo chamado aberto, apaga o recibo e remove a função; só toca filas que continuam prontas e sem lote travado.

Para listar as conversas que ficam para a equipe, sem expor dados aqui:

```sql
select t.slug, q.chat_id, q.phase, q.review_required_at, q.last_error_code
from conversation_turn_queue q join tenants t on t.id = q.tenant_id
where q.phase in ('review', 'uncertain')
order by t.slug, q.review_required_at;
```

## Publicação no n8n (26/11/2026 13:34 UTC, autorizada pelo responsável)

Feita com `scripts/publish_exports_by_id.cjs apply`, a partir do `dev` em `b1304cf2`. O `check` anterior confirmou que as versões ativas eram as dos recibos de 22/11. Só o `jsCode` mudou, e cada workflow foi conferido byte a byte depois da ativação.

| Workflow | Versão anterior | Versão publicada | Conteúdo |
| --- | --- | --- | --- |
| Núbia v2 `6jSiEH2ugboYSack` | `8f05c355` | `e064bf9b` | Menu aprovado em pedido genérico de valores |
| Motor `mlKNPv862H2g3Gap` | `488ec4be` | `b4ce917f` | Contato automático, repetição, trava de laço (fases e caminho padrão), cobertura tolerada |
| Salon `yxdKP0PeskDMUFSo` | `b84b7e75` | `d88e0f92` | Só os metadados do build (revisão e hash) |
| Roteador `3N5oN6sxtir9lFrA` | `abbe1a73` | `8557b60d` | Só a revisão do CORE gravada no evento |

Sem mudança: Núbia v1 `vCDXJLqIBCZJRTVv`, Gênesis `fXGorIlPbyf9Qtsp` e NORIA `sLxNG9o2falquchd`.

**Ordem:** as migrações `20261126125941` e `20261126133157` foram aplicadas antes da publicação.

**Rollback:** os backups completos e os recibos estão em `.local/deploy_backups/2026-11-26T13-34-50-126Z/`. Para reverter, reenvie o JSON de cada workflow por `PUT /workflows/<id>` e ative. As migrações são compatíveis com as versões anteriores.

**Pendência:** não houve tráfego até o registro deste relatório. Os primeiros turnos reais precisam ser conferidos em `channel_events`, pela revisão `conversation_core_v2_1_34_core_ext_decision_identity_2026_11_26`, e na fila.

## Checagens a cada 30 min depois da publicação

| Horário (Brasília) | Resultado |
| --- | --- |
| 10:39 a 12:39 | Sem erro. A IA responde com a revisão nova (`…_2026_11_26`). |
| 13:09 | Contingência na Núbia: "Qual os horários de atendimento?" respondido certo, mas reprovado com `AUDIT_QUOTE_MISMATCH:fact`, porque a resposta citou só um trecho do resumo do horário. Corrigido e publicado (abaixo). Também houve um `core_error` HTTP 500 do Supabase em `magia_turn_suppression_status`: falha momentânea, que a fila reprocessou sozinha 30 s depois. |

Correção de 13:12 (Brasília), commit `de651071`: um fato composto aceita citação por trecho literal de pelo menos 8 caracteres, como os blocos. Valor curto, como preço, continua exigindo igualdade, e as conferências de horário e valor afirmados seguem valendo. Serviços 61/61 (com o caso real) e release 792/792.

Publicado às 16:12 UTC com `publish_exports_by_id.cjs apply`, autorizado para a checagem: Motor `b4ce917f` → `4223f074` e Salon `d88e0f92` → `600f66fa` (só metadado do build). Backups em `.local/deploy_backups/2026-11-26T16-12-05-783Z/`.

### Checagem das 15:09 (Brasília)

- "ainda tem vaga para a black?": a redação prometeu chamar a equipe, mas a EXT não tinha decidido encaminhar. A auditoria barrou corretamente com `AUDIT_HANDOFF_NOT_EXECUTED`, e a contingência encaminhou. Não há dado sobre a promoção, então a equipe responder é o desfecho certo.
- "Queria marca pra fazer bronze": a EXT pediu esclarecimento, e a IA listou as opções reais e perguntou qual a cliente prefere. As duas redações foram reprovadas com `AUDIT_QUOTE_MISMATCH:fact`. Com o Gemini real (2 chamadas) e os nomes reais do catálogo, o mesmo texto foi aprovado, porque o auditor citou o nome inteiro. Sem a citação feita em produção, a causa não pode ser comprovada.
- Correção, commit `beb2b101`: a reprovação passa a gravar as afirmações que falharam (`failed_assertions`: motivo, referência e citação; até 5, com dados pessoais mascarados) em `services_pipeline.rejected_candidates`. Serviços 63/63 e release 794/794.
- Publicado às 18:13 UTC: Motor `4223f074` → `74a35947` e Salon `600f66fa` → `c63576d1` (só metadado). Backups em `.local/deploy_backups/2026-11-26T18-13-00-892Z/`.

### JOYERÍA: "Olá" respondido com pendência antiga (15:20, Brasília)

- Relato do responsável: no número de teste recém-conectado, a IA respondeu um "oi" com uma frase sobre a linha blend.
- Causa: o número já tinha conversado em 22/11. A cliente pediu aliança "com ametista escarlate", e a IA respondeu "vou verificar com a equipe". Quatro dias depois chegou só "Olá", e a redação, que recebe as últimas 10 mensagens sem noção de tempo, respondeu a pendência ("a linha blend é ... sem pedras"). A JOYERÍA não usa sessões por inatividade (`attendance_lifecycle` vazio).
- Correção, commit `724e20dd`: a redação do `retail_v1` recebe `previous_contact_hours_ago` e uma regra de leitura. Com 12 h ou mais e sem retomada de assunto, a IA cumprimenta e pergunta como ajudar. Validado no simulador com o histórico real (2 chamadas). Retail 23/23 e release 795/795.
- Publicado às 18:21 UTC: Motor `74a35947` → `935898eb` e Salon `c63576d1` → `01552f28` (só metadado). Backups em `.local/deploy_backups/2026-11-26T18-21-06-218Z/`.
- Alternativa de configuração, não aplicada (é mudança de dados de tenant): ligar `attendance_lifecycle: session_v2` na JOYERÍA, como na Núbia, para abrir sessão nova depois de inatividade.

### Checagem das 20:00 (Brasília): robô de pedidos de restaurante

- Núbia, 19:37: o robô de pedidos de um restaurante mandou "Seu pedido na <empresa> foi realizado" (ignorada certo) e, 20 s depois, "Seu pedido já está em produção", sem o nome. A IA respondeu "Recebemos sua mensagem por aqui. Como posso te ajudar hoje?". A mensagem seguinte já caiu na trava humana.
- Causa: o nome de outra empresa só valia como prova vindo de mensagens anteriores quando o texto atual era repetição. A primeira mensagem do robô nem entra no histórico (fica como `buffer`).
- Correção, commit `48c88154`: a prova gravada pela RPC (`automated_contact_ignored`) na mesma conversa, dentro da janela da trava de laço, passa a valer como nome da empresa; a interpretação recebe `recently_ignored_businesses` e uma regra de leitura. Prova antiga, inválida ou de outra empresa não serve, e cliente que escreve depois segue normal. Contato 37/37 e release 801/801. Não validado com o Gemini real.
- Restante do período sem erro da IA: a pergunta da promoção de 30% foi para a equipe (sem dados da promoção), e os pedidos de valores receberam o menu.
- Publicado às 23:08 UTC, autorizado pelo responsável: Motor `935898eb` → `00175ff8` e Salon `01552f28` → `6ef63af8` (só metadado). Backups em `.local/deploy_backups/2026-11-26T23-08-34-299Z/`.

### Checagem de 27/11 (11:04, Brasília): dois bloqueios indevidos da auditoria

- Nenhuma execução com erro no n8n desde as 23:08 UTC de 26/11. Na Núbia, 4 contingências, todas respondidas pela equipe.
- 26/11 21:06: "No momento estamos fechados" foi classificado como `availability` (vaga na agenda), que não aceita o fato `business_hours.current_status`.
- 27/11 00:38: "Vou te enviar todos os detalhes" foi classificado como afirmação sobre o serviço.
- Correção no `dev`, sem publicar: o auditor é orientado a tratar aberto/fechado como `schedule`, e o contrato ganhou a categoria `attachment_notice` (suporte `attached_block`), aceita só quando o bloco citado segue anexado. A primeira tentativa, só com instrução (`conversational`), falhou no Gemini real.
- Validação com o Gemini real (7 chamadas, cerca de 13,9 mil tokens): "fechados" aprovado; aviso com anexo aprovado depois da segunda correção; vaga sem prova, promessa de envio sem anexo e promessa de privacidade sem fonte continuam reprovadas. Foram auditorias isoladas, não turnos completos. Serviços 66/66 e release 804/804.
- Rollback antes de publicar: reverter o commit no `dev`.
- Em aberto: 27/11 08:10 e 22/11, interpretação inválida (`EVIDENCE_MISSING_SERVICE`) com a mensagem de anúncio mandou para a equipe; a pasta `.local/deploy_backups` não foi encontrada, e `publish_exports_by_id.cjs` depende dos recibos dela.

## Limitações conhecidas

- O robô que repete mensagens sem citar a empresa só é ignorado quando o nome aparece em mensagens anteriores dele; nos demais casos, quem segura é a trava de laço.
- Núbia: "não atendemos na sua cidade" continua barrado, porque não há configuração de atendimento a domicílio.
- `test_whatsapp_core` (50/52) e `test_p0_final_audit` (5/5) estão quebrados desde 20/10 e fora da suíte de release.

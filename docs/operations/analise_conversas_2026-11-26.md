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

## Limitações conhecidas

- O robô que repete mensagens sem citar a empresa só é ignorado quando o nome aparece em mensagens anteriores dele; nos demais casos, quem segura é a trava de laço.
- Núbia: "não atendemos na sua cidade" continua barrado, porque não há configuração de atendimento a domicílio.
- `test_whatsapp_core` (50/52) e `test_p0_final_audit` (5/5) estão quebrados desde 20/10 e fora da suíte de release.

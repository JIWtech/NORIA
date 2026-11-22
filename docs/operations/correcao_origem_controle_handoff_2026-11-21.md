# Correção: turno travado depois de um encaminhamento feito pela própria IA (2026-11-21)

## Problema

Quando a IA encaminha a conversa, o CORE grava em `channel_events` o evento `conversation_assigned` ("Conversa atribuida a X", `handoff=true`, `ai_provider='human_lock'`). Esse evento não tinha registro em `conversation_turn_control_origins`.

Na mensagem seguinte do cliente, a `magia_turn_suppression_status` encontra esse controle recente sem origem comprovada e lança `TURN_CONTROL_ORIGIN_REQUIRED` (HTTP 400). O resultado é `core_error`, e o turno vai para revisão técnica, em vez de apenas silenciar a IA.

Ocorrências: Núbia às 19:55 UTC (turno ainda em revisão) e NORIA às 03:14 UTC, ambas em 21/11.

## Correção

- **Migração APLICADA em produção em 2026-11-22 (versão 20261122001226), com autorização e após ensaio numa transação desfeita:** `supabase/migrations/20261122001226_turn_control_engine_origin.sql`, com rollback em `supabase/migrations_pending_review/20261122001226_turn_control_engine_origin.rollback.sql`. Ela cria a `magia_record_engine_assignment`, que grava o evento de atribuição e a origem `engine_assignment` na mesma transação. Só aceita a gravação se:
  - o turno estiver ativo (token, fase `processing`/`sending`, lease válido, lote com `retry_batch_id`);
  - os itens do lote forem mensagens recebidas daquela conversa;
  - o evento tiver exatamente o formato que o motor gera.

  A função é executável só pelo `service_role`. Um `conversation_assigned` forjado, sem prova, continua bloqueado (teste em PGlite).
- **CORE (`salesAssignConversation`, usado pelos serviços e pelas vendas):** chama a RPC. Se ela recusar ou não existir, grava o evento como antes, marcado com `raw_payload.control_origin = 'unproven_fallback'`. Assim o encaminhamento nunca deixa de acontecer; no pior caso, o comportamento volta a ser o anterior.
- **Testes:** `scripts/test_engine_assignment_origin.cjs` (RPC, salvaguarda e propagação de erro) e `scripts/test_turn_control_engine_origin.cjs` (SQL em PGlite), ambos incluídos na suíte de release.
  - Release: 750/750.
  - Painel: 1025/1025.

Iniciado pelo Codex (proposta SQL, chamada no CORE e testes). O Claude acrescentou a salvaguarda, os testes dela e este relatório.

## Ordem de publicação

1. Aplicar a migração, com autorização.
2. Publicar o Motor.

Publicar o Motor antes da migração não quebra nada, por causa da salvaguarda, mas o problema continua até a migração ser aplicada.

## Publicação no n8n (2026-11-22 01:17 UTC, autorizada pelo responsável)

Feita com `scripts/publish_exports_by_id.cjs apply`, a partir do `dev` em `16e52f2c`. Só o `jsCode` mudou. A ativação e o código foram conferidos byte a byte.

| Workflow | Versão anterior | Versão publicada |
| --- | --- | --- |
| Núbia v2 `6jSiEH2ugboYSack` | `82a99237` | `8f05c355` |
| Gênesis `fXGorIlPbyf9Qtsp` | `2338fefd` | `0600d5f6` |
| Motor `mlKNPv862H2g3Gap` | `0886111d` | `01650402` |
| Salon `yxdKP0PeskDMUFSo` | `4b8f82fe` | `a95ff499` |
| Roteador `3N5oN6sxtir9lFrA` | `2bf2dc89` | `e29de9c4` |

O pacote inclui:
- a origem comprovada no encaminhamento (Motor e Salon);
- o worker de disparos com as RPCs `*_paced` (Roteador);
- o roteador com `selectPipeline`;
- os ajustes das EXTs Gênesis e Núbia.

O publicador passou a aceitar nós que não estão na referência de 12/11 quando o recibo mais recente os cobre. É o caso da cadeia retail do Roteador. Um nó de código sem referência nem recibo continua bloqueado.

**Rollback:** os backups completos de cada workflow estão em `.local/deploy_backups/2026-11-22T01-17-18-913Z/<id>.json`. Para reverter, reenvie o JSON do backup por `PUT /workflows/<id>` e ative o workflow. As migrações já aplicadas são compatíveis com as versões anteriores.

**Pendência:** não houve tráfego entre a publicação e o registro deste relatório. Os primeiros turnos reais precisam ser conferidos em `channel_events`.

## Como destravar o turno preso da Núbia (não executado)

O turno está em `phase='review'`, com um ticket em `conversation_turn_review_tickets`. Ele deve ser resolvido pelo fluxo de revisão do painel (sino de notificações → revisão do turno, RPC `magia_resolve_turn_review`) por um operador do tenant. A conversa já está com a equipe ("Conversa atribuida a Will") e houve uma resposta manual depois, então a resolução esperada é encerrar a revisão sem reenviar nada pela IA.

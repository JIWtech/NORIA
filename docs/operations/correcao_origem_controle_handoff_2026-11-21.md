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

## Como destravar o turno preso da Núbia (não executado)

O turno está em `phase='review'`, com um ticket em `conversation_turn_review_tickets`. Ele deve ser resolvido pelo fluxo de revisão do painel (sino de notificações → revisão do turno, RPC `magia_resolve_turn_review`) por um operador do tenant. A conversa já está com a equipe ("Conversa atribuida a Will") e houve uma resposta manual depois, então a resolução esperada é encerrar a revisão sem reenviar nada pela IA.

# Incidente I&C Salon (09/11/2026): estado da investigação e plano

Tenant `ic_salon` (id `76aff8a0-0466-42b9-a80d-db186ff3d8bd`), caminho dinâmico `saas_dynamic`,
perfil `services_booking_v2`, sem EXT. Conversa de teste `5521967095989@s.whatsapp.net`.

Sintomas relatados: card com texto `technical_error`; card duplicado em Finalizadas depois de
"cliente não veio" + encerrar; cliente sem resposta depois disso; etiquetas incoerentes.

## Causas confirmadas (com evidência)

1. **CORE envia texto vazio** (`n8n/sources/noria_core.js`, caminho genérico ~linha 14674).
   A IA respondeu só `[HUMANO_SOLICITADO]`; `cleanReplyText` removeu a marcação e o texto ficou
   vazio; `sendChannelMessage` chamou `magia_begin_turn_delivery` e a Evolution recusou com 400.
   Evidência: logs do Supabase 12:40:12 UTC (begin_turn_delivery 200 → fail_turn), inbound "10hrs"
   marcado `atendimento_humano`/handoff, tentativa em `conversation_turn_delivery_attempts` com
   status `uncertain` e sem provider_message_id. O caminho de vendas já tem guarda; o genérico não.
2. **Turno travado sem saída**: fila em `uncertain` com o "Oii" das 09:46 pendente. Nenhuma ação de
   `magia_resolve_turn_review` libera turno incerto com tentativa registrada
   (`close_with_evidence` → `DELIVERY_RECONCILIATION_REQUIRED`; `finalize_confirmed` →
   `CONFIRMED_DELIVERY_REQUIRED`). O "não compareceu" (`magia_mark_appointment_outcome`) registra
   encerramento, mas `magia_resolve_closed_turn_review` só cobre `review` + `close_conversation`.
3. **Central de notificações quebrada**: `magia_list_turn_notifications` exige
   `conversation_turn_review_operators`; `ic_salon` e `noria` têm 0 operadores → 400 no painel.
4. **Kanban mostra `technical_error`**: `app/src/services/kanban/eventsToKanban.js` usa
   `activityEvent.service` como texto quando a mensagem é vazia. Conversas já usa
   `technicalEventPresentation` ("Atendimento precisa da equipe"); o Kanban não.
5. **Card duplicado**: `reconcilePendingKanbanMoves` (`app/src/app/App.jsx` ~156) reaplica o
   movimento pelo `card.id`, mas o id do card da conversa muda a cada evento (`card-<último evento>`)
   e o próprio arrasto grava evento → a cópia antiga é reinserida. Além disso,
   `applyIncomingEventToKanban` muda o card de coluna sem atualizar `targetColumnId` nem `aiReason`
   (fica "IA conduzindo a conversa" em Finalizadas e o painel acha que o card está na coluna antiga).

Por desenho (não é bug): "Sinal obrigatório" (migração 030: quem falta precisa de sinal) e
"Compareceu" depois da falta (corrigir o registro).

Data 10/10: escolhida à mão no formulário do painel (campo "Início" não tem preenchimento automático).

Por que a IA não registrou o pedido no "10hrs": o prompt da I&C (`ic_salon_recepcao_v3`) manda emitir só
`[ACAO: CRIAR_AGENDAMENTO|...]` e proíbe `[HUMANO_SOLICITADO]` nesse momento, e o CORE de produção tem
`appointment_request` (revisão 2026_11_06). O `service=atendimento_humano` sem texto só sai do ramo
`actions.humanRequested` (noria_core.js ~14828): a IA respondeu só marcações, incluindo a de humano.
Com as duas marcações, o CORE ignora o pedido (`requestAction && !actions.humanRequested`).
Decisão pendente do usuário: com `appointment_request` configurado e `CRIAR_AGENDAMENTO` válido, o pedido
deve vencer a marcação de humano? (A coluna "Confirmar agendamento" já é o passo humano.) O nome "Wesley"
sem sobrenome faria o CORE pedir o nome completo antes de registrar.

## Segundo caso (…8468, João Victor, 09/11 11:07)

Operador respondeu pelo painel em 07/11 (trava humana persistida, correta). Em 09/11 o card foi arrastado
para Finalizadas: `kanbanCardMovement` gravava só evento interno, sem `close_conversation`, então a trava
humana não foi liberada e o "Oieee" das 11:11 ficou sem resposta; o card duplicou pelo mesmo bug do
`reconcilePendingKanbanMoves`. Correção: `createMoveKanbanCard({ closeConversation })` usa o encerramento
oficial para Finalizadas (whatsapp/telegram/instagram); `dataService` injeta `closeConversationFromKanban`
(import tardio de integration.js). Teste: `app/tests/features/kanbanOfficialClose.test.js` (4/4).
Contorno imediato sem deploy: botão Encerrar na aba Conversas.

## Plano

- [x] CORE: `visibleReplyOrHandoffNotice` + guarda `EMPTY_REPLY_TEXT` antes de
      `magia_begin_turn_delivery`. Teste: `scripts/test_empty_reply_delivery.cjs` (5/5).
      Build feito numa cópia LF (o checkout Windows embute `\r\n`); copiados só noria_core.js,
      generated, manifest e os dois workflows CORE. Gênesis EXT não mexido (só diferia em quebra de
      linha). Falhas de `test_whatsapp_core` (50) e `test_noria_services_pipeline` (1) já existiam na base.
      **Falta publicar no n8n (usuário).**
- [x] Kanban: `kanbanCardReason.js` (etiqueta de Finalizadas/Não compareceu nos dois caminhos),
      subtítulo técnico, tempo real com `targetColumnId`/`aiReason`, falta vai para `nao_compareceu`,
      reconciliação extraída para `services/kanban/pendingKanbanMoves.js` com identidade da conversa
      (exceto `follow-up-*`). Teste: `app/tests/features/kanbanIcSalonIncident.test.js` (7/7).
      `npm test`: 743, 11 falhas antigas, nenhuma nova.
- [ ] Banco (usuário roda; gravação direta bloqueada): operadores de revisão para `ic_salon`/`noria`.
- [ ] Decisão do usuário (mudança de função no banco): ação de revisão "não foi entregue" para turno
      `uncertain` cuja tentativa não tem provider_message_id; operador de revisão no onboarding.
      Até lá, a conversa de teste `…5989` segue travada.
- [x] Parte 1 (painel) publicada: commits `0abcdf2` e `a15da73` no `dev` do JIWtech/NORIA (Vercel publica
      produção a partir do `dev`). Validada sozinha numa cópia limpa: 727 testes, 11 falhas antigas, build ok.
- [ ] Migração `supabase/migrations/034_closure_releases_uncertain_turn.sql` (sem commit, não aplicada):
      encerramento autenticado (Encerrar, Kanban, "não veio") libera também turno `uncertain`; tentativa vira
      `superseded_uncertain`, nada é reenviado. Fixture da versão publicada, rollback em
      `migrations_pending_review/034_..._rollback.sql`. Teste PGlite `scripts/test_closure_releases_uncertain_turn.cjs` (7/7).
      Substitui o SQL avulso `ic_salon_destravar_5989.sql` (não precisa rodar os dois).
- [ ] Parte 2 (CORE no n8n) sem commit: noria_core.js + generated + manifest + 2 workflows CORE + teste.
- [ ] Sem commit: disparos agendados, clients/noria, este arquivo e o ponteiro no AGENTS.md.

## Estado do repositório

`dev` local avançado para `origin/dev` 838c2be (09/11). Sem commit ainda: disparos agendados
(`n8n/code/broadcast_scheduler.js`, migração `20261103120000_broadcast_scheduled_pacing.sql`,
painel de Disparos) e `clients/noria/`. Nada aplicado em produção.

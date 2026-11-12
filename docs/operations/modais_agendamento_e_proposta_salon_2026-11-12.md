# Modais de agendamento e proposta de horário — 12/11/2026

## Escopo verificado

- `app/src/features/appointments/components/Appointments.jsx`: cancelamento, arquivamento e desfechos.
- `app/src/features/appointments/components/AppointmentCancelDialog.jsx`, `AppointmentConfirmDialog.jsx`, `NoShowMessageDialog.jsx`: diálogos e apresentação.
- `app/src/features/appointments/components/cancellationFlow.js`: ordem entre cancelamento e aviso.
- `app/src/features/kanban/components/Kanban.jsx`, `AppointmentRequestActions.jsx`, `SuggestedSlotDialog.jsx`, `suggestedSlot.js`: ações no Kanban.
- `app/src/services/appointments/appointmentActions.js`, `noShowMessage.js`: ações e vínculo com conversa.
- `n8n/code/command_router.js`: contratos de `manual_reply` e `reject_appointment_slot`.
- `n8n/code/whatsapp_capture_manual_reply.js` e `scripts/build_noria_workflows.cjs`: captura do eco e projeção do router no workflow gerado.
- `n8n/sources/noria_core.js` e `clients/ic_saloon/conversation_adapter.cjs`: leitura de contexto e interpretação da resposta.
- `clients/ic_saloon/05_confirmacao_agendamento.sql`, `06_prompt_pre_agendamento.sql`, `07_revisao_da_equipe_sem_pausar_ia.sql`: configuração histórica do fluxo Salon.

## Constatações

1. Os comandos `confirm()` nativos da agenda e do Kanban foram substituídos por modais do painel. O cancelamento oferece aviso opcional. O atendente informa o motivo; a IA deve redigir e enviar com base nele. Não há envio automático ao abrir o modal.
2. O comando `manual_reply` registra `sender_type=human` e `handoff=true`, portanto não serve para esse aviso. Foi implementado localmente `notify_appointment_cancellation`, que valida tenant, agendamento cancelado, conversa e motivo persistido; gera a mensagem no Gemini e envia sem handoff. O aviso só poderá ser usado em produção após publicação do router atualizado. Falha de geração não envia; entrega incerta bloqueia reenvio até conferência no WhatsApp.
3. O `reject_appointment_slot` atual envia o template `slot_rejected_template`, cancela o pedido pendente e pede que a cliente informe outro horário. Ele não aceita nem persiste uma proposta de data/hora feita pela equipe. O modal ativo confirma esse pedido livre; os campos de proposta estão ocultos.
4. Uma resposta curta como “sim” não pode ser associada com segurança a uma proposta apenas por histórico recente. O fluxo precisa de proposta durável e validação de tenant/conversa/versão, inclusive após entrega incerta, proposta substituída ou resposta tardia.
5. Decisão do responsável: se a cliente aceitar um horário proposto, criar **novo pedido pendente** e devolvê-lo à coluna **Confirmar agendamento**. A IA não confirma automaticamente.

## Contrato proposto para o Salon

1. A equipe escolhe data/hora no modal. O router valida o pedido ainda pendente e grava uma proposta identificada, ligada a tenant, conversa e versão do pedido.
2. O texto de oferta vem da configuração do tenant, com prévia editável; o CORE permanece genérico. O envio deve ter identificador idempotente e estado de entrega verificável.
3. Só a proposta com entrega comprovada fica elegível. Entrega incerta exige reconciliação sem duplicar mensagem ou perder o evento de saída.
4. A IA interpreta a resposta atual da cliente e emite uma decisão estruturada de aceitar, recusar ou pedir esclarecimento. O CORE valida a decisão contra a proposta ativa; não usa regex conversacional para decidir intenção.
5. Aceite cria novo `pending_confirmation`, vinculado à proposta, e retorna ao Kanban para aprovação da equipe. Recusa, substituição ou expiração invalidam a proposta.

## Verificações e limites

- `node --test tests/features/cancellationFlow.test.js tests/features/suggestedSlot.test.js tests/features/appointmentRequest.test.js` em `app/`: 23/23 passaram.
- O teste de cancelamento falhou antes da troca de contrato e passou após a alteração para `notify_appointment_cancellation`.
- `npm run build` em `app/`: passou; Vite avisou sobre chunks grandes.
- Testes do router de cancelamento, eco e regressões correlatas: 45/45 passaram; o comando também foi verificado no nó gerado. Duas gerações isoladas tiveram SHA-256 idêntico `5C2AA0B1685023423F90A031DF8B4E2456590BEA2432BAB0C454D5EE80C98055`.
- Subagentes relataram 792/805 na suíte completa durante o trabalho compartilhado, com 13 falhas em outras áreas; não foi estabelecido baseline limpo dessas falhas.
- Não houve envio real, publicação de workflow, escrita de configuração no Supabase nem validação visual autenticada. Qualquer observação de conversa em produção deve considerar apenas mensagens **posteriores ao horário da última publicação do workflow correspondente**.

## Rollback

Reverter apenas os diffs dos componentes, router, captura de eco e builder citados; remover os novos diálogos/helpers/testes deste incremento; regenerar o export a partir das fontes preservadas. Preservar as demais alterações locais. Como nenhum workflow ou configuração de produção foi alterado neste incremento, não há rollback remoto correspondente.

## Conclusão local (Claude, 12/11/2026 tarde)

O contrato proposto acima foi implementado localmente pelo Codex e conferido de ponta a ponta:

- **Painel:** `SuggestedSlotDialog` com “Pedir outro horário” e “Propor um horário” (visível só no Salon com `appointment_request.slot_proposal_enabled=true`); `ProposalDeliveryDialog` para conferir proposta com entrega incerta; `AppointmentCancelDialog` com motivo e aviso opcional pela IA.
- **Router (`n8n/code/command_router.js`):** `reject_appointment_slot` com `suggested_date`/`suggested_time` gera a oferta no Gemini (confere data e hora literais), prepara a proposta, envia e só ativa após entrega comprovada; `proposal_resolution` reconcilia entrega incerta. `notify_appointment_cancellation` gera o aviso a partir do motivo e envia sem handoff. As duas gerações recebem o tom do tenant (`settings.tone`) e tratam o cliente de forma neutra quando o gênero não é conhecido.
- **Banco (proposta, não aplicada):** `supabase/migrations_pending_review/slot_proposal_v1.sql` + rollback — uma proposta ativa por conversa (trava por conversa), versão do pedido, entrega comprovada, aceite só depois do envio, reabre como novo `pending_confirmation` para aprovação da equipe. `starts_at` sai em UTC fixo (não depende do fuso da sessão).
- **Motor do Salon (`clients/ic_saloon/salon_engine.js`):** com `slot_proposal_resolution_enabled=true`, interpreta a resposta da cliente à proposta ativa por decisão estruturada do Gemini e chama `magia_slot_proposal_resolve`.
- **Ativação:** `clients/ic_saloon/14_proposta_slot_proposal_settings.sql` (+ rollback) liga as duas chaves só no Salon.

**Validação local:** testes do router (proposta 5/5, cancelamento 4/4, eco 2/2, comandos 36/36), SQL da proposta em PGlite 1/1, semântica 3/3, adaptador do Salon 17/17; app 794/807 (as 13 falhas são anteriores e fora de agendamento/Kanban) e build do app ok; regressão do motor compartilhado e do Salon contra o que está no ar sem regressões; auditoria anti-hardcode ok. Sem validação visual autenticada nem envio real.

**Ordem para colocar no ar (cada passo com autorização):** 1) aplicar `slot_proposal_v1.sql`; 2) publicar roteador e motor do Salon; 3) publicar o painel; 4) aplicar `14_proposta_slot_proposal_settings.sql`. O aviso de cancelamento só precisa dos passos 2 e 3.

## Revisão técnica (12/11/2026 noite): correções confirmadas

Todas locais; nada publicado, aplicado ou enviado. A migração `slot_proposal_v1.sql` continua pendente e foi alterada em lugar (ainda não aplicada).

**Chaves de `settings.appointment_request` (Salon):**
- `slot_proposal_enabled` (envio) **e** `slot_proposal_resolution_enabled` (leitura da resposta) são exigidas juntas: no `prepare` da RPC, no router (`reject_appointment_slot` com data/hora) e no Kanban (`slotProposalSuggestionEnabled`).
- `slot_proposal_ttl_hours` (novo): prazo da proposta `sent`. Padrão **48** (definido em `14_proposta_slot_proposal_settings.sql`; o banco, o motor e o painel também usam 48 se a chave faltar ou for inválida).

**RPCs (assinaturas):**
- `magia_slot_proposal_mark_uncertain(p_tenant, p_channel, p_chat, p_appointment, p_proposal_id, p_message_id text default null)`: assinatura nova de 6 argumentos (a de 5 deixa de existir; o rollback remove a de 6). Com `p_message_id` grava `provider_message_id` na proposta.
- `magia_slot_proposal_reconcile` (mesma assinatura): aceita `uncertain` e também `sending` com `prepared_at` > 2 min. `delivered` não exige id: usa o informado, senão o `provider_message_id` gravado, senão registra `manual:<proposta>` e `reconciliation.message_id_unknown=true` (o eco casa por texto; nesse caso o evento de saída não é gravado pelo router).
- `magia_slot_proposal_resolve`: nova recusa `SLOT_PROPOSAL_EXPIRED` (aceite ou recusa depois do prazo).
- `prepare`: nova recusa `SLOT_PROPOSAL_NOT_ENABLED` também sem `slot_proposal_resolution_enabled`. Um `sending` preso continua bloqueando novas propostas até a conferência.

**Painel:** o cartão da conversa mostra selo de estado (aguardando resposta, recusada, substituída, expirada; "pedido reaberto: aceitou a proposta" no pedido reaberto). Os pedidos cancelados com proposta entram por consulta própria (`metadata->slot_proposal->>status in (sent,rejected,superseded)`). Selos de recusa/substituição/expiração saem após 72 h. A conferência de proposta aparece também para `sending` > 2 min e não pede mais o ID quando ele já foi gravado (senão é opcional). Data e hora da proposta são validadas (futuras, fuso do tenant) no diálogo e no router antes do Gemini. Mensagens de sucesso e de erro específicas. Aviso de cancelamento: conferência "Chegou / Não chegou" (no diálogo e por botão na agenda), mensagem correta quando o aviso já havia sido enviado.

**Router:** o mark_uncertain que falha agora é informado na resposta (não é engolido); se o envio funcionou e o `finalize` falhou, o id do provedor é gravado. `notify_appointment_cancellation` aceita `notice_resolution` (`delivered`/`not_delivered`) para estados `uncertain` ou `sending` > 2 min, sem reenviar. Proposta, confirmação (`confirm_appointment_request`) e "pedir outro horário" (`reject_appointment_slot` sem proposta) são escritos pelo Gemini com saída estruturada `{text, date, time, services, avisos_do_modelo_mantidos}`; data (dd/mm, dd/mm/aaaa, aaaa-mm-dd), hora (14h, 14:00, 14h00) e serviços são conferidos nos campos estruturados, sem regex sobre prosa. O modelo do tenant (`confirmation_template`/`slot_rejected_template`, já renderizado) segue como fato obrigatório (inclui o aviso de menores) e como texto técnico só se o Gemini falhar ou reprovar na conferência; `raw_payload.message_source` registra `gemini` ou `template_fallback`.

**Motor do Salon:** `SLOT_PROPOSAL_DECISION_INVALID/_MODEL_INCOMPLETE/_MODEL_UNAVAILABLE/_LOOKUP_UNAVAILABLE` viram "sem decisão" (o turno segue) e o motivo fica em `raw_payload.slot_proposal_resolution.skipped`; falha de banco continua subindo. Proposta vencida não dispara Gemini. Na segunda geração após a resolução: sem `preserveLiteralReply`/`needsTeamReview` herdados e a tag de agendamento não cria nem altera pedido.

**Supersede ao criar pedido pendente pela IA:** não foi implementado. Um gatilho no INSERT disputaria o mesmo lock por conversa com `resolve` (risco de deadlock com o índice único de pedido aberto), e mudar a RPC de criação, já aplicada, está fora deste incremento. A proteção é dupla: `SLOT_PROPOSAL_OPEN_REQUEST_EXISTS` no `resolve` enquanto houver pedido aberto e o prazo (`slot_proposal_ttl_hours`) depois que ele for resolvido.

**Limites conhecidos:** um `sending` comum de confirmar/recusar (sem proposta) continua sem prazo de saída; a conferência manual sem ID não grava o evento de saída na linha do tempo; a conferência do cancelamento só aparece para agendamentos cancelados presentes na lista carregada.

**Testes:** `scripts/test_slot_proposal_sql.cjs` (5), `test_salon_slot_proposal_router.cjs` (10), `test_salon_slot_proposal_semantics.cjs` (7), `test_cancel_appointment_ai.cjs` (6), `test_cancel_appointment_echo.cjs` (2); app: `slotProposalStatus`, `suggestedSlot`, `cancellationFlow`, `appointmentRequest`, `tenantDataReads`. Os testes de router leem o export de `NORIA_WORKFLOWS_DIR` quando definido (cópia gerada com `NORIA_BUILD_OUT_DIR`).

**Ordem de ativação (cada passo com autorização):** 1) aplicar `slot_proposal_v1.sql`; 2) regenerar e publicar roteador/Entrada e motor do Salon; 3) publicar o painel; 4) aplicar `14_proposta_slot_proposal_settings.sql` (liga as duas chaves e define o prazo de 48 h). Antes do passo 4 o painel não oferece "Propor um horário". O aviso de cancelamento (e a conferência dele) só precisa dos passos 2 e 3. Rollback: `14_..._rollback.sql` (remove as três chaves), depois `slot_proposal_v1_rollback.sql`.

## Conferência da publicação — 12/11/2026, 13h42 (São Paulo)

As seções anteriores registram estados **históricos** da preparação; as frases “não aplicada” e “nada publicado” deixaram de descrever o estado atual. Conferência de leitura nesta data:

- **Banco:** `NORIA-prod` registra a migração `20261112150006 slot_proposal_v1`. As cinco funções `magia_slot_proposal_prepare`, `finalize`, `mark_uncertain`, `reconcile` e `resolve` existem; `service_role` pode executá-las e `anon`/`authenticated` não podem. `ic_salon` está em `America/Sao_Paulo`, com `slot_proposal_enabled=true`, `slot_proposal_resolution_enabled=true` e `slot_proposal_ttl_hours=48`.
- **n8n:** os quatro workflows estão `active=true` e `versionId=activeVersionId`: catálogo NB Bronze `6jSiEH2ugboYSack` (`3bfaf67b-b263-469a-b186-da928e56c1d1`), CORE compartilhado `mlKNPv862H2g3Gap` (`b8e075c3-1ee4-47d0-8819-abe46cd4c99f`), Salon `yxdKP0PeskDMUFSo` (`9987c288-cf9f-4251-84b9-edda275e7e5b`) e roteador `3N5oN6sxtir9lFrA` (`917f8841-751a-4e51-a5fa-58806cca987f`). Recibos e backups: `.local/deploy_backups/2026-11-12T15-00-29-010Z/receipts.json` e JSONs ao lado. `node scripts/compare_live_workflows.cjs` retornou **7/7 iguais**, ignorando apenas o carimbo de build; inclui nós, conexões e settings.
- **Git e painel:** `HEAD`, `origin/dev` e a referência remota `refs/heads/dev` coincidem em `c7218cb8df0ba83382af6c5ab4a451c1518b4d0d`. O deploy Vercel de produção `dpl_7XdriJoPihSAMcrvFcWX7FJjQo8u` está `READY` nesse SHA e tem os aliases `noriasync.com.br`/`www.noriasync.com.br`. `https://noriasync.com.br/` respondeu HTTP 200; o bundle servido contém “Propor um horário”, `slot_proposal_enabled` e “Cancelar e avisar pela IA”.
- **Testes repetidos nesta conferência:** 25/25 no router/motor para proposta, aviso de cancelamento e eco; 38/38 focados no painel. Não foi feito envio real, teste pago do Gemini ou validação visual autenticada.
- **Tráfego após a publicação:** consulta agregada a `channel_events` do Salon, a partir de `2026-11-12T15:00:40Z`, não encontrou eventos de `appointment_slot_proposed`, `appointment_cancellation_notice`, `appointment_request_rejected` ou `appointment_request_confirmed`. Assim, a publicação e os contratos estão confirmados, mas ainda não há caso real posterior ao último workflow que comprove esse percurso de atendimento.

Nenhuma migração, publicação, alteração de flags ou push foi repetida nesta conferência. Os itens do checklist de ativação já estavam concluídos; ficou pendente somente observar um caso real posterior à publicação e conferir no painel autenticado o fluxo com dados reais, sem enviar mensagem de teste a cliente.

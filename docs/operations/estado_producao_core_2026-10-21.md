# Estado de produção do CORE — 21/10/2026

O que está publicado depois da estabilização de 21/10, e o que não se deduz do código: IDs, variáveis de ambiente e configuração de banco.

## Workflows no n8n (auton8n)

| Workflow | ID | Estado | Origem no repositório |
|---|---|---|---|
| NORIA CORE \| WhatsApp + Comandos + Follow-ups \| Motor compartilhado v2 | `3N5oN6sxtir9lFrA` | publicado, versão `1bf7b6c2` (19h49) | `n8n/workflows/NORIA CORE _ WhatsApp + … v2.json` |
| NORIA CORE \| Motor conversacional | `mlKNPv862H2g3Gap` | publicado, versão `0344c87f` (20h20) | `n8n/workflows/NORIA CORE _ Motor conversacional.json` |
| NORIA EXT \| Gênesis \| Política comercial v2 | `fXGorIlPbyf9Qtsp` | publicado, versão `b2743de9` (20h20) | `n8n/workflows/NORIA EXT _ Gênesis _ Política comercial v2 (1).json` |
| NORIA EXT \| NB Bronze \| Política de negócio v2 (Núbia v1) | `vCDXJLqIBCZJRTVv` | publicado em 21/10 | `n8n/workflows/NORIA EXT _ NB Bronze _ Política de negócio v2.json` |

- O motor (~0,9 MB) vive só no sub-workflow `Motor conversacional`. O CORE (216 KB) o chama nos nós `CORE | Motor conversacional único`, `CORE | Preparar resposta` e `CORE | Finalizar resposta`, cada um precedido por `… | Fase`.
- Gerar o CORE sempre com o ID do motor: `NORIA_ENGINE_WORKFLOW_ID=mlKNPv862H2g3Gap node scripts/build_noria_workflows.cjs`. Sem a variável, o build mantém o ID já configurado no JSON ou gera `PREENCHER_ID_MOTOR` e avisa.
- O n8n 2.x só publica um workflow se todos os sub-workflows que ele chama estiverem publicados. Publique o motor e as EXTs antes do CORE.
- A Núbia v1 passa por `CORE - É Núbia?` → `CORE | Executar EXT Núbia` → motor em fase única. Nenhum turno de fila termina em "Responder Evento Ignorado".

## Variáveis de ambiente (EasyPanel)

| Serviço | Variável | Valor | Motivo |
|---|---|---|---|
| `n8n-runner` | `N8N_RUNNERS_AUTO_SHUTDOWN_TIMEOUT` | `0` | Sem isso, o runner desliga após 15 s ocioso e leva ~20 s para voltar (VPS de 1 vCPU). |
| `n8n-runner` | `N8N_RUNNERS_MAX_CONCURRENCY` | `10` | Os nós Code esperam a rede (Supabase, Gemini). Com `2`, as tarefas expiravam em fila. |
| `noria-ingress-genesis` e `noria-ingress-nubia` | `NORIA_BRIDGE_HTTP_TIMEOUT_MS` | `30000` | Com 10 s, um webhook lento virava 502 e a Evolution reenviava a mensagem até 10 vezes. |
| `n8n` | `EXECUTIONS_DATA_SAVE_ON_SUCCESS` | `none` | Execuções com sucesso não são gravadas; a lista de Executions mostra só falhas. |

Fixe as imagens `n8nio/n8n:2.44.5` e `n8nio/runners:2.44.5` (versões iguais) antes de qualquer Deploy.

## Evolution (instâncias)

As instâncias `wesley-carros`, `clinica_nubia`, `Royal 4x4` e `testes` enviam só `MESSAGES_UPSERT` e têm `groupsIgnore: true`. Gênesis e Núbia entregam pelos ingressos autenticados. Editar o webhook pela tela da Evolution já salvou `enabled:false` e `events:[]` sozinho (21/10, 16:41). Confira depois de qualquer edição.

## Banco (Supabase)

- `turn_control_fromme_manual_reply_v1.sql` foi aplicada em 21/10. Resposta manual pelo celular com origem comprovada passa a ser controle humano, e a IA cede a vez. O rollback está em `supabase/migrations_pending_review/turn_control_fromme_manual_reply_v1_rollback.sql`.
- Gênesis: prompt `wesley-sales-v14.22-photo-flow-2026-10-21` (aplicado 21/10, 19h49; migração `genesis_prompt_v14_22_photo_flow.sql`, substitui a v14.21 nunca aplicada). O v14.20 está em `settings.prompt_snapshot_before_v14_22`; o rollback está no fim da migração.
- Núbia: `tenant_settings.settings.noria_turn_pipeline.enabled = false`. **Não ligar enquanto a cadeia v2 não estiver de volta no CORE.** Ligado, todo turno da Núbia termina em `NORIA_TURN_PIPELINE_CONFIG_INVALID`, sem resposta e sem erro visível no n8n.
- Conversas em `review` só saem por ação de operador: encerrar o atendimento pelo painel libera a revisão coberta pelo encerramento (`magia_record_turn_control_event` → `magia_resolve_closed_turn_review`).

## Testes

`scripts/test_noria_engine_subworkflow.cjs` (motor fora do CORE) e `scripts/test_noria_nubia_route.cjs` (rota da Núbia).

## Fluxo de fotos e eventos ignorados (21/10, noite)

- Pedido só de foto com foto autorizada: se a auditoria barrar só o texto, a foto sai sozinha (`photo_text_audit: rejected_photo_only_text`), sem revisão.
- Resposta que promete ou anuncia foto sem foto autorizada no turno é barrada (`UNAUTHORIZED_PHOTO_PROMISE`) e reescrita; se o veículo for ambíguo, a reescrita pergunta qual.
- Reações, apagamentos/edições e votos de enquete são descartados em `Normalizar Entrada WhatsApp` (`ignoredReason: non_conversational_message`): não abrem turno nem contam como resposta manual.
- Testes: `scripts/test_noria_photo_promise.cjs`, `scripts/test_noria_ignore_reactions.cjs` e `scripts/homolog/photo_delivery_checks.cjs` (8 cenários; os dados vêm de `%USERPROFILE%\.noria-homolog\`, fora do repositório).
- Foto de outro veículo move o foco do lead para ele (EXT, `commercial_state.product_id` e `buy_interest`, com a mensagem atual como evidência). Antes, só a foto mudava e "quantos km?" seguia o veículo anterior.
- O modelo recebe `last_photo_sent` (último veículo fotografado na sessão): "esse último que eu vi" e perguntas sem veículo logo após a foto se referem a ele. Teste: `scripts/test_noria_last_photo_context.cjs`; harness `scripts/homolog/photo_switch_checks.cjs` (6 verificações).

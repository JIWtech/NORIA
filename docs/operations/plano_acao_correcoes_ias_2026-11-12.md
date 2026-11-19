# Plano de ação — correções da auditoria das IAs (12/11/2026)

Base: [auditoria_funcionamento_ias_2026-11-12.md](auditoria_funcionamento_ias_2026-11-12.md). Premissa: local = publicado. Spot-check feito: IA-21 (regex `A??O` em `noria_core.js:475` e `salon_engine.js:445`) e IA-19 (`messages.update` aceito em `whatsapp_normalize_entry.js:264`) confirmados no código.

## Regras de execução (valem para todas as ondas)

- Cada item: teste que falha → correção → teste verde → um commit por item, em `dev`.
- Workflows: editar a fonte (`n8n/sources/`, `n8n/code/`), rodar `scripts/build_noria_workflows.cjs`, revisar o diff. Publicar n8n, migrar Supabase de produção ou enviar WhatsApp real só com autorização explícita.
- Itens de CORE afetam todos os tenants: validar isolamento por tenant e rodar `validate_noria_release.cjs` + `npm test` em `app/`.
- Rollback: reverter o commit; para n8n, restaurar o export de backup (`n8n/workflows/backup_pre_correcao_2026-11-12/`).

## Onda 0 — Destravar a validação (pré-requisito, baixo risco)

| Item | Ação | Pronto quando |
| --- | --- | --- |
| IA-11 | Atualizar `genesis_executor.cjs:521-529` e `n8n_parent_routes.cjs:14-22` para o nome atual dos exports. Marcar `patch_*.cjs` / `publish_nubia_v2.cjs` como legados (ou mover). | Gate normal 480/480 sem shim. |
| Harness (seção "sem bug") | Corrigir testes defasados: import `NotificationCenter`, contagem `useState`, data fixa Kanban, `const photoEvent`. | `npm test` sem falhas de harness; sobram só as 3 de IA-10. |

Sem isso, nenhuma onda seguinte tem gate confiável.

## Onda 1 — Falhas que a IA entrega ao cliente (P1, produção)

1. **IA-21 (regex `AÇÃO`)** — corrigir em `noria_core.js:475` e `salon_engine.js:445,2110/2173` (`A[ÇC]`+`[ÃA]`+`O`, aceitando também sem acento). Teste com `[AÇÃO: CRIAR_AGENDAMENTO]`, `PRONTO_PARA_AGENDAR`, `RECLAMACAO`. Rápido e provavelmente com efeito amplo; fazer primeiro.
2. **IA-02 (cobertura de pedido no lote)** — no CORE, o verificador de cobertura deve exigir que cada intenção do lote (saudação + "marcar bronze") tenha tratamento. Reproduzir com o lote real; teste de regressão com 2+ intenções.
3. **IA-01 (afirmação falsa contra catálogo)** — o validador deve checar o conteúdo da afirmação contra o fato citado, não só a existência do `fact_id`. Incluir caso sintético contraditório (Premium = "produtos extras") como teste que falha. Atenção ao anti-hardcode: a checagem é semântica (Gemini/auditoria) + fatos do catálogo, sem regra por serviço.
4. **IA-03 (texto vago na proposta Salon)** — validar no router que o texto enviado contém data/hora coerentes com os campos estruturados; rejeitar "que tal esse dia?". Ajustar `test_salon_slot_proposal_router.cjs:38-43` para falhar nesse caso.
5. **IA-24 (`loadTenantContext` por `external_id`)** — aceitar `config.instance_name`/`config.instance` e normalizar caixa, reutilizando a lógica do normalizador. Regenerar `whatsapp_conversation_core.generated.js`. Mesmo helper será usado em IA-20, IA-23, IA-25.
6. **IA-19 (normalizador de entrada)** — ignorar ACKs de `messages.update` sem `data.message` (`event_not_supported` ou `non_conversational`); priorizar `remoteJidAlt` quando `remoteJid` for `@lid`; não aplicar `isLandline` a `@lid`. Testes com fixtures de ACK e `@lid`.

## Onda 2 — Dados e painel (P1, app)

7. **IA-17 (fuso na criação manual)** — converter `datetime-local` com o fuso do tenant (`saveAppointment.js:17-25`, `Appointments.jsx:170-181`). Teste com TZ do processo = UTC e tenant = São Paulo (10:00 permanece 10:00).
8. **IA-15 (`noria_pipeline_pin` no Kanban)** — unificar os dois loops de `eventsToKanban.js` para tratar pin de forma idêntica; teste com a fixture realista (realtime × recarga dão a mesma coluna).
9. **IA-16 (limite de 1.000 eventos)** — decisão de arquitetura (precisa do responsável): paginar, ou carregar por conversa/lista de conversas em vez de eventos. Proposta mínima: buscar a lista de conversas separadamente e eventos só da janela recente. **Não mudar schema sem aprovar.**
10. **IA-18 / IA-25 (disparos)** — decisão antes de codar: o nó `Processar Disparos` em produção é a fonte da verdade. Passos: (a) trazer o código do nó para `n8n/code/` e fazer o gerador projetá-lo; (b) alinhar `Broadcasts.jsx` (`broadcast_start/resume/cancel` rejeitados pelo router → implementar ou remover as chamadas e o `.catch` silencioso); (c) versionar as RPCs de lease em `supabase/migrations/` (extrair da produção, **sem aplicar**); (d) `config.instance_name` via helper de IA-24. Só então reconstruir o Roteador.

## Onda 3 — Resiliência de envio e eventos (P2)

11. **IA-08 / IA-13 (falha de `channel_events` após envio)** — padrão único: se o envio ou a mutação já ocorreu, falha em `channel_events` vira aviso/retry, não erro. Retornar sucesso com `warning`, e registrar para reconciliação. Cobre `command_router.js:513-529, 602-645, 734-748` e ajustar `cancellationFlow.js` / `AppointmentRequestActions.jsx` para exibir "enviado, histórico pendente".
12. **IA-20 (follow-up)** — selecionar `timezone`; aceitar `config.instance_name`; se `post('channel_events')` falhar, preservar `external_message_id` no job (estado `sent_event_pending`) em vez de `uncertain` sem ID.
13. **IA-09 (eco automático descartado)** — só descartar como eco quando houver ID de provedor correspondente; sem ID, tratar como manual. Teste com mesmo texto manual durante envio incerto.
14. **IA-26 (fuso do tenant)** — selecionar `timezone` em `command_router.js:146` e usar o fuso do tenant em `appointmentDateLabel()` (CORE e Salon) no lugar de `APP_TIMEZONE`.
15. **IA-27 (`@lid` em `contacts.phone`)** — não derivar telefone de JID `@lid`; deixar `phone` nulo e guardar o handle à parte. Verificar contatos já gravados com dígitos de `@lid` (consulta somente leitura) antes de decidir limpeza.
16. **IA-22 (cota Gemini no Salon)** — passar `review`, `priceAudit`, `generate` por `magia_gemini_reserve/release`.

## Onda 4 — Qualidade conversacional Núbia/Salon (P2)

17. **IA-05** — preservar a candidata rejeitada na auditoria e, ao falhar por `AUDIT_UNSUPPORTED_ASSERTION`, tentar uma regeneração guiada pelos fatos do catálogo antes de escalar ao humano.
18. **IA-04** — gravar o motivo do falso negativo no log de auditoria; reproduzir com as duas respostas "Oie, maravilhosa" antes de alterar a regra de abertura repetida.
19. **IA-06** — aplicar o prompt v7 (`13_proposta_prompt_v7_publico_misto.sql`) no Salon: **mudança em Supabase de produção, exige autorização**; revisar o texto e ter rollback para v6.
20. **IA-14** — ampliar a lista de estados de reserva futura no adaptador do Salon para o mesmo conjunto de `appointmentAgenda.js:6` (importar da mesma fonte, evitar duplicação).

## Onda 5 — Configuração, higiene e acessibilidade (P2/P3)

21. **IA-07** — pedir ao responsável o horário oficial da NORIA e preencher `tenant_settings`; além disso, rever o default `is_open:true` do CORE quando faltam dados (decisão de produto).
22. **IA-10** — implementar `isResolving` e o uso do cache de coordenadas em `conversationPresentation.js:38-56` até os 3 testes passarem.
23. **IA-23** — comparação de instância case-insensitive em `noria_router.js:26` e `noria_extension.js:19` (helper compartilhado).
24. **IA-28** — mudar `saveDataErrorExecution` do Salon para `all` na fonte do workflow.
25. **IA-12** — extrair um hook/componente de diálogo (foco inicial, trap de Tab, Escape) baseado em `SuggestedSlotDialog` e aplicar aos 3 modais; teste de teclado.

## Decisões que precisam de você

1. IA-16: estratégia de carga do painel (paginação vs. lista de conversas própria).
2. IA-18/25: confirmar que o fluxo por lease em produção é o oficial, e autorizar extrair as RPCs para migrations.
3. IA-06: autorizar aplicar o prompt v7 no Salon.
4. IA-07: horário comercial oficial da NORIA.
5. Publicação: uma publicação conjunta por onda (1 e 2 primeiro), com a suíte completa verde.

## Ordem sugerida

Onda 0 → Onda 1 (itens 1, 6, 5 primeiro: baixo risco, alto alcance) → Onda 2 → Ondas 3–5. Após publicar a Onda 1, validar só com conversas posteriores à nova publicação, como na auditoria.

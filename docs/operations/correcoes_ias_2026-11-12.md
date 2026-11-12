# Correções da auditoria das IAs — 12/11/2026

Referência: [auditoria_funcionamento_ias_2026-11-12.md](auditoria_funcionamento_ias_2026-11-12.md) e [plano_acao_correcoes_ias_2026-11-12.md](plano_acao_correcoes_ias_2026-11-12.md). Tudo está em commits locais no branch `dev`, **não publicado**: nenhum workflow foi publicado no n8n, nenhuma migração foi aplicada e nenhum WhatsApp real foi enviado. Os exports em `n8n/workflows/` foram regenerados localmente (backup em `n8n/workflows/backup_pre_ondas_2026-11-12/`).

## Aplicado em produção (Supabase), com autorização

| Item | Alteração | Rollback |
| --- | --- | --- |
| IA-06 | Prompt v7 do I&C Salon (`prompt_revision` = `ic_salon_recepcao_v7_publico_misto`) | `clients/ic_saloon/13_proposta_prompt_v7_publico_misto_rollback.sql` |
| IA-07 | NORIA: `business_hours = {is_24h: true}` e regra de transferência ("a equipe entrará em contato o mais breve possível") | `clients/noria/01_atendimento_24h_e_transferencia_rollback.sql` |

## Corrigido no código (testes automatizados)

| Item | Correção |
| --- | --- |
| IA-01 | Auditoria rejeita afirmação sem relação com o fato citado (`AUDIT_ASSERTION_NOT_GROUNDED`) e o auditor é instruído a usar `support none` nesses casos |
| IA-02 | Auditoria confirma que todos os pedidos do lote foram tratados (`AUDIT_REQUEST_NOT_COVERED`) e o compositor é instruído a responder saudação e pedido juntos |
| IA-03 | Proposta/confirmação só segue se o texto citar data e hora corretas |
| IA-04 | Comparação técnica barra abertura igual à de resposta recente da empresa |
| IA-05 | Afirmação sem sustentação recompõe uma vez; candidatas rejeitadas ficam em `error.rejected_candidates` |
| IA-08, IA-13 | Falha ao gravar `channel_events` após o envio vira `event_warning`, não erro |
| IA-09 | Mesmo texto de aviso antigo (mais de 3 min) é resposta manual, não eco |
| IA-10 | Localização com `isResolving` e cache de coordenadas |
| IA-11 | Homologação aponta para os exports atuais (480/480 sem shim) |
| IA-12 | Hook `useModalDialog` nos três modais (foco, Tab preso, Escape) |
| IA-14 | Salon considera todos os estados de reserva futura aberta |
| IA-15 | Recarga do Kanban ignora o pin interno |
| IA-16 | Painel completa a janela de 1.000 eventos com o último evento de cada conversa (depende da migração abaixo) |
| IA-17 | Agenda manual usa o fuso do tenant |
| IA-18, IA-25 | Worker de disparos por lease versionado em `n8n/code/broadcast_campaign_worker.js` e projetado pelo gerador; painel só enfileira (consentimento obrigatório) e controla pausa/retoma/cancela pelo servidor; migrações das RPCs copiadas para o repositório |
| IA-19 | Normalizador ignora ACK de `messages.update`, usa `remoteJidAlt` em `@lid` e não classifica `@lid` como fixo |
| IA-20 | Follow-up: fuso da coluna, canal por alias, id do provedor preservado se o evento falhar |
| IA-21 | Regex das tags `[AÇÃO: ...]` corrigida (CORE e Salon) |
| IA-23 | Instância do tenant `noria` sem diferenciar caixa |
| IA-24 | `loadTenantContext` aceita aliases de instância |
| IA-26 | Fuso do tenant em confirmações, CORE e Salon |
| IA-27 | JID `@lid` não vira `contacts.phone` |
| IA-28 | Salon passa a reter execuções com erro |

## Migrações criadas e NÃO aplicadas (exigem autorização)

- `supabase/migrations/20261112120000_conversation_latest_events.sql` — RPC `conversation_latest_events` e índice (IA-16). Sem ela o painel segue com a janela atual, sem erro.
- `supabase/migrations/20261112130000_broadcast_interval_floor_41min.sql` — piso de **41 minutos** entre mensagens de disparo, intervalo máximo padrão de 55 min e limite diário padrão de 30. Até ser aplicada, vale a cadência atual do banco (padrão 30 a 90 s).
- As cinco migrações `20261109192247` a `20261109193722` (disparos) já estavam aplicadas em produção; foram apenas versionadas aqui.

## Não feito ou parcial

- **IA-22** (cota Gemini nas chamadas extras do Salon): não alterado. As chamadas extras ocorrem dentro da reserva da chamada principal; reservar cota própria aninhada pode negar a revisão quando o limite de concorrência for 2 e falhar fechado. Precisa de decisão de desenho.
- **IA-16**: o histórico completo de uma conversa antiga ainda depende da janela de eventos; só a presença da conversa na lista foi corrigida.
- Para publicar: gerar com `node scripts/build_noria_workflows.cjs`, revisar e publicar com autorização.

## Testes

- `app`: 835/835. `scripts/validate_noria_release.cjs`: 484/484.
- Suítes legadas de `scripts/` que já falhavam antes (módulo `pglite` ausente e fixtures antigas de Gênesis/financiamento) continuam com o mesmo número de falhas; não foram tocadas.

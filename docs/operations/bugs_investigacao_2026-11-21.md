# Investigação de bugs e inconsistências (2026-11-21, noite)

O Codex investigou o backend e o Gemini (Neon) o painel. As duas análises foram só de leitura. O Claude conferiu os itens críticos no código.

Marcações: **[conferido]** = verificado pelo Claude; **[reprod.]** = reproduzido pelo agente com as funções reais; **[pré-existente]** = já existia antes das mudanças de hoje.

## Backend (Codex)

| Prioridade | Problema | Onde | Correção |
|---|---|---|---|
| Alto [reprod.] | O intervalo de 41 min entre disparos pode ser violado: campanhas e workers concorrentes do mesmo tenant não compartilham um bloqueio, e o próximo horário só é gravado depois do envio. | `supabase/migrations/20261109192323_broadcast_server_dispatch.sql:168,214`; `n8n/code/broadcast_campaign_worker.js:189` | Reservar a próxima elegibilidade por tenant e canal, sob bloqueio transacional, antes de chamar o provedor. |
| Alto [reprod.][conferido] | A EXT Núbia libera um bloco de preparo que a própria validação reprovou: o ramo lê `approved.blocks` em vez de `validBlocks`. | `n8n/sources/nubia_extension.js:189,377` | Selecionar só de `validBlocks`, com teste de regressão. |
| Médio [reprod.] | A previsão de reabertura erra no horário de almoço, e no CORE também em feriado futuro. | `noria_core.js:484,496`; `salon_engine.js:416` | Calcular o próximo intervalo aberto, com o retorno do almoço e as exceções da data. |
| Médio [reprod.] | O retail pode afirmar "enviei as fotos" antes de tentar o envio, porque `photosSent` recebe só o plano. | `noria_core.js:6902,6938` | Só confirmar o envio depois do resultado da mídia. |
| Médio [reprod.] | O disparo perde o histórico sem avisar: um `.catch(() => {})` depois do envio confirmado. | `broadcast_campaign_worker.js:191` | Registrar uma pendência idempotente do histórico e reconciliar depois. |
| Hipótese | Uma interrupção entre o claim e a gravação do pino pode desviar o lote para o caminho legado. | `noria_turn_dispatch.js:29,51`; `noria_router.js:55` | Tornar claim e pino atômicos (verificar antes). |
| Nota [conferido] | A poda do Salon é segura em produção (`grounding_mode` vazio e sem `appointment_scheduling`). Falta uma recusa explícita caso esses modos sejam ligados no Salon. | `salon_engine.js` | Lançar um erro claro se a configuração exigir os modos removidos. |

## Painel (Gemini)

Críticos:
- **C1 [conferido]:** `MediaAttachment` retorna antes dos hooks. Quando o tipo da mídia muda, o React derruba a tela (`MediaAttachment.jsx:36-42`). Correção: um wrapper que verifica a mídia antes de montar o componente interno.
- **C2:** a tela de Agendamentos pode quebrar em três casos:
  - `NoriaSelect` recebe `value=""` (o Radix lança erro);
  - `available_starts` ou `schedule.units` vêm ausentes;
  - o select de conversas ignora o canal.

  Arquivos: `Appointments.jsx`, `appointmentDataService.js:22`.
- **C3 [conferido][pré-existente]:** `scheduleConversationRead` guarda o `refreshData` antigo (deps `[sessionUserId]`). Depois de trocar de empresa, o rollback da leitura otimista não acontece.
- **C4 [conferido]:** a chave canônica no Kanban é montada sem o tenant e nas Conversas com o tenant. As duas nunca casam, e o fallback ignora o canal (`eventsToKanban.js:68,78,103,388`).
- **C5:** no sino de notificações, a marcação em lote descarta os itens 2..N e deixa uma contagem fantasma.
- **C6:** `mapAppointment` quebra a agenda com `starts_at` inválido. Também mostra início e fim em fusos diferentes, e o `dateKey` é calculado em UTC.
- **C7:** o retry de mídia invalida a própria requisição e marca a mensagem como `retryable_error`.

Altos (seleção):
- **A1:** `loading` fica preso ao trocar de empresa durante uma atualização manual.
- **A3:** o mesmo card pode aparecer em duas colunas entre 4 e 5 s depois de um movimento.
- **A4:** a ordenação do Kanban usa um comparador não transitivo.
- **A5:** há fallbacks fixos `'clinica_nubia'` e `'jiw'` em funções de escrita, e o `locationDetailsCache` é compartilhado entre tenants.
- **A6:** uma falha ao salvar um atendente cria um agente falso `local-…`, sem rollback.
- **A7:** horários aparecem no fuso do navegador, e não no do tenant.
- **A8:** a média por hora do dashboard está inflada.
- **A9 e A10:** a edição e a criação de agendamento têm problemas de fuso, duplo envio e reuso de `requestId`.
- **A13:** uma campanha multicanal é criada sempre com o canal padrão.
- **A14:** o sino mostra um falso erro de login enquanto o cache é hidratado.
- **A16:** `DocumentDialog` lança `InvalidStateError`.

Médios e baixos: 11 médios e 2 baixos, entre eles a ordem de mensagens do Realtime, `followUpReminders` que nunca dispara, a seção "Próximos" da agenda e o ciclo de vida de mídia e áudio.

## Ordem sugerida de correção

1. Núbia `validBlocks`; retail "enviei as fotos"; intervalo de 41 min dos disparos (risco ao número do WhatsApp).
2. Painel: C1, C2, C4, C3 e A5 (fallbacks de tenant fixos).
3. Previsão de reabertura; histórico de disparo; A1, A3, A6 e A7.
4. Os demais médios e baixos.

# Auditoria de Kanban e agendamentos — 12/11/2026

## Escopo e método

Revisão somente de leitura do worktree `dev` (`ce37ee3` + alterações não commitadas), da branch `origin/claude/subagentes-sonnet-haiku-opus-46ec52` (`530fe2c`, com coautoria Claude), dos exports locais e workflows ativos, do código do painel e de dados/configurações do Supabase. As alterações pendentes no worktree não têm autoria demonstrável pelo Git. Nenhuma correção, migração, publicação ou mensagem WhatsApp foi executada nesta auditoria.

**Conclusão:** não há evidência para afirmar que Kanban e agendamentos estejam 100% funcionais em todos os tenants. Há defeitos reproduzidos e limites de cobertura listados abaixo.

## Achados priorizados

### P1 — Pin interno altera a coluna do Kanban após recarga (reproduzido)

`app/src/services/kanban/eventsToKanban.js:75` ignora `noria_pipeline_pin` no primeiro processamento, mas o segundo loop (`:98-104`) o seleciona como último evento da conversa; a etapa é resolvida a partir dele em `:172-203`. `app/src/services/kanban/applyIncomingEvent.js:91` ignora o mesmo evento no realtime, enquanto `app/src/services/timeline/realtimeRefresh.js:44-47` pode solicitar recarga. Com fixture no formato do pin real (`stage='Pipeline'`), a conversa ficou em triagem antes do pin, em `conversas_ia` após recarga e continuou em triagem no incremental. Afeta o pipeline de serviços v2 da Núbia; a ocorrência visual em produção não foi observada. A correção local de `app/src/services/timeline/eventClassification.js` e `chatTimelineHelpers.js` impede a linha genérica na conversa, mas não resolve o segundo loop do Kanban.

### P1 — Janela de 1.000 eventos pode remover conversas do Kanban (código e dados ativos)

`app/src/dataService.js:327-333` carrega no máximo 1.000 `channel_events` por tenant. `eventsToKanban.js` monta as conversas a partir dessa janela; só Gênesis tem recuperação adicional por `sales_leads`. No Supabase, Núbia oficial tem 14.647 eventos e 901 conversas; **841 conversas** não têm nenhum evento na janela dos 1.000 mais recentes (corte aproximado 11/11/2026 00:15 UTC). A tabela `kanban_cards` está vazia para todos os tenants, portanto não é fonte alternativa no painel atual. Isso prova ausência dessas conversas na carga baseada em eventos; não prova que as 841 ainda deveriam estar abertas. O mesmo limite atinge outros tenants quando crescerem. Gênesis tem 22.188 eventos, mas seus leads persistidos reduzem o impacto para cards comerciais.

### P1 — Criação manual usa o fuso do navegador, não o do tenant (reproduzível)

`app/src/features/appointments/components/Appointments.jsx:167-169` converte campos `datetime-local` com `new Date(...).toISOString()`. A agenda usa o fuso configurado do tenant; `app/src/services/appointments/appointmentActions.js:26` já possui `zonedDateTimeToIso` para edição. Em navegador UTC e tenant `America/Sao_Paulo`, digitar 10:00 grava 10:00Z e a agenda mostra 07:00. O fallback de `app/src/services/appointments/saveAppointment.js:19` repete a conversão pelo fuso do navegador. Afeta criação manual nos tenants sem agenda por unidade e a rota de fallback `SCHEDULE_NOT_CONFIGURED`; a existência de um registro errado específico não foi demonstrada.

### P2 — Adaptador do Salon omite estados de reserva futura (contrato divergente)

`clients/ic_saloon/conversation_adapter.cjs:81-105` carrega como futuras apenas `confirmed` e `pending_confirmation`. A agenda (`app/src/services/appointments/appointmentAgenda.js:6`) trata `scheduled`, `reserved`, `pending_payment`, `payment_reported` e `aguardando_verificacao` como abertos; a RPC de edição também aceita estados adicionais. Uma reserva futura do mesmo contato em um desses estados não entra em `existing_appointments` (`conversation_adapter.cjs:514`) e não aciona a pergunta para distinguir novo pedido de mudança. No banco ativo do Salon, os estados observados foram `confirmed` e `cancelled`, sem duplicidade futura observada. O defeito contratual permanece para novos estados.

### P2 — O código local do CORE permite saudação repetida após segunda reprovação

Em `n8n/sources/noria_core.js:5675-5705`, o compositor tenta reparar `AUDIT_REPEATED_OPENING` uma vez. Se a única falha da segunda auditoria continuar sendo essa, troca `status` para `approved` e entrega a resposta com `tolerated_failures`. Portanto, a versão **local** ainda pode publicar exatamente a saudação repetida que motivou a correção. O CORE ativo no n8n não contém essa tolerância; é divergência local, não ocorrência comprovada em produção.

### P2 — Atribuição da Núbia após o envio não tem confirmação durável no evento

`n8n/sources/noria_core.js` tenta atribuir a cliente de serviço anterior após o envio. Falha ou ausência de agente são capturadas, o turno termina e `assignment_status` aparece apenas no retorno, sem atualização confirmada do evento já salvo. Há dois agentes ativos na Núbia oficial, mas não houve teste integrado com entrega real/erro de atribuição. O handoff para a etapa humana foi verificado em teste da EXT; atribuição nominal no Kanban segue não demonstrada.

## Paridade local × publicado

Consulta de leitura ao n8n em 12/11/2026: roteador, EXT Gênesis, EXT NORIA e política Núbia v1 coincidem com os exports locais. **CORE, EXT Núbia v2 e motor do Salon diferem em código**, além do carimbo. No CORE local há, entre outras mudanças, retirada de `session_id` do schema semântico, reparo de claims de preparo e tolerância de abertura repetida; na EXT Núbia local há tópico `audience` e mudança na validação de sessão. O Salon ativo foi atualizado às 12:17 UTC e ainda difere do motor local em auditoria de preço, revisão de disponibilidade e mensagens. Assim, a observação de que o Salon já teve integração local é compatível com parte do histórico, mas a comparação atual não permite tratar CORE e Núbia locais como idênticos aos workflows ativos. Não publiquei essas diferenças.

Prompts ativos consultados: Salon `ic_salon_recepcao_v6_integrante_nova`, Núbia `nubia-2026-11-11-diva-v11`. As propostas locais v7 do Salon e v12 da Núbia passaram em 9 testes de SQL simulado, mas **não estão aplicadas**.

## Cobertura por tenant

| Tenant ativo | WhatsApp ativo | Agenda configurada | Evidência desta auditoria |
| --- | ---: | --- | --- |
| `clinica_nubia_oficial` | Sim | `appointment_scheduling.enabled=true` | Pipeline v2, Kanban com 8 colunas, 15 agendamentos no banco; pin e limite de 1.000 relevantes. |
| `ic_salon` | Sim | Fluxo próprio de pedidos/agenda manual | Kanban com 10 colunas, 5 agendamentos; estados futuros do adaptador divergentes. |
| `wesley_automoveis` | Sim | `appointment_scheduling.enabled=false` | Kanban comercial com 11 colunas, `sales_leads` persistidos; agenda por serviço não habilitada. |
| `royal_4x4` | Sim | `appointment_scheduling.enabled=false` | Kanban com 5 colunas; processamento `royal_stock_v1` fora dos sete exports revisados. |
| `noria` | Sim | Sem configuração de agendamento encontrada | Kanban com 7 colunas; nenhuma reserva observada. |
| `universo_prata` | Sim | Sem configuração de agendamento encontrada | Dois boards com 15 colunas somadas; nenhuma reserva observada. |
| `clinica_nubia` (legado) | Não | Sem configuração encontrada | Dois boards e 5 reservas históricas; sem canal WhatsApp ativo. |

Não foi encontrada divergência `tenant_id` × `tenant_slug` nos `channel_events` ativos. As políticas de leitura de `appointments`, `kanban_boards`, `kanban_columns` e `kanban_cards` exigem vínculo de tenant; isso não substitui teste autenticado entre contas de tenants diferentes. As assinaturas realtime de agendamentos/campanhas em `app/src/dataService.js:218-235` não incluem filtro de tenant, mas não há evidência de vazamento porque a entrega depende do RLS do Supabase.

## Validação executada

- `npm run build` no painel: passou (avisos de tamanho de bundle/import dinâmico).
- `npm test` no painel: **786/799 passaram, 13 falharam**. Duas falhas de `kanbanRouting.test.js` são dependentes de datas fixas de 09/11/2026 e passaram com relógio congelado nessa data; não são prova de regressão funcional. Outras 11 permanecem sem solução nesta auditoria (AST/estrutura, localização/mídia e apresentação).
- Testes focados de agendamento: autorização 22/22, comandos 36/36, capacidade 1/1, CORE de pedidos 41/41, EXT Núbia 17/17, adaptador Salon 17/17, interface 50/50, SQL de pedidos 13/13 e desfechos 6/6. São simulações locais, sem provider real.
- Testes das propostas de prompt v7/v12: 9/9. Nenhum teste ponta a ponta com vários usuários, realtime e WhatsApp real foi executado.
- Consulta read-only: não há pares de agendamentos futuros ativos com o mesmo `tenant`/`starts_at` no banco no momento da auditoria. Isso não prova que conflitos por recurso/intervalo nunca ocorram.

## Próximas verificações necessárias para afirmar funcionamento integral

1. Corrigir a seleção de evento mais recente no segundo loop do Kanban e testar recarga versus realtime para pin interno.
2. Definir carga paginada ou fonte persistida de cards/conversas e testar tenants com mais de 1.000 eventos.
3. Unificar a conversão de `datetime-local` no fuso do tenant, inclusive fallback, e testar navegadores em fusos diferentes.
4. Alinhar o adaptador do Salon aos estados efetivamente abertos e testar reserva futura em cada status.
5. Executar cenários autenticados por tenant: abertura, movimentação, atribuição, pausa/retomada da IA, reserva, edição/cancelamento, conflito concorrente, confirmação de sinal, falta e realtime. Conferir o resultado no banco e no painel sem envio real até a autorização operacional correspondente.

Arquivos principais analisados: `C:\Noria_Plataform\app\src\dataService.js`, `C:\Noria_Plataform\app\src\services\kanban\eventsToKanban.js`, `C:\Noria_Plataform\app\src\services\kanban\applyIncomingEvent.js`, `C:\Noria_Plataform\app\src\services\timeline\realtimeRefresh.js`, `C:\Noria_Plataform\app\src\features\appointments\components\Appointments.jsx`, `C:\Noria_Plataform\app\src\services\appointments\saveAppointment.js`, `C:\Noria_Plataform\app\src\services\appointments\appointmentAgenda.js`, `C:\Noria_Plataform\app\src\services\appointments\appointmentActions.js`, `C:\Noria_Plataform\clients\ic_saloon\conversation_adapter.cjs`, `C:\Noria_Plataform\n8n\sources\noria_core.js`, `C:\Noria_Plataform\n8n\sources\nubia_extension.js`, `C:\Noria_Plataform\scripts\compare_live_workflows.cjs` e os sete JSONs em `C:\Noria_Plataform\n8n\workflows\`.

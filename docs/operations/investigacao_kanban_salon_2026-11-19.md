# I&C Salon · investigação do retorno de cartões a Agendamentos

Em 19/11/2026, o painel publicado mostrou novamente em Agendamentos um contato que acabara de ser finalizado. O comportamento foi reproduzido em Edge com o JavaScript publicado `/assets/index-3EuBD0Wc.js`, sessão fictícia, respostas HTTP de negócio simuladas e WebSocket interceptado. As consultas ao banco e às definições de workflows de produção foram de leitura. Nenhuma informação pessoal dos clientes é necessária para reproduzir.

## O incidente observado

| Horário de Brasília | Registro no Salon |
| --- | --- |
| 09h09min16s | Presença no agendamento A |
| 09h09min27s | Presença no agendamento B |
| 09h09min46s | Encerramento da conversa ligada a B |
| 09h09min47s | Encerramento de outra conversa, que tinha uma reserva confirmada para as 15h de hoje |
| 09h09min54s | Presença no agendamento C, vinculado ao mesmo contato de A |

A função ativa `magia_mark_appointment_outcome` bloqueia a linha por ID, verifica o membro do tenant, o papel, o status e o fim do horário. Para presença, grava `completed`, autor e data no agendamento selecionado. O caminho de presença não grava evento de conversa. Os gatilhos ativos verificam tenant e capacidade, atualizam a data e tratam follow-ups. Não foi encontrada atualização em massa dos demais agendamentos.

Na leitura do Salon havia 14 agendamentos, sendo quatro com presença, um confirmado e nove cancelados. Reexecutei a montagem das colunas localmente com os 990 eventos da janela do tenant, as 10 linhas da consulta de últimas conversas, os agendamentos e as colunas configuradas. Em Agendamentos apareceram três cartões. Apenas um era a reserva confirmada para as 15h. Dos outros dois, um combinava um agendamento concluído com uma **conversa marcada como encerrada**. O outro era um agendamento concluído separado, com a conversa do mesmo contato também visível em Finalizadas. Essa reconstrução usa os registros disponíveis na leitura e não pretende reconstituir o estado da aba do operador a cada segundo.

## Reprodução na interface publicada

No cenário sintético, Ana e Bia tinham horários encerrados e estavam em Aguardando desfecho. Uma terceira conversa já estava encerrada e tinha uma presença posterior ao encerramento.

1. Marquei a presença de Ana e confirmei o diálogo. O cartão passou para Agendamentos.
2. Usei **Finalizar atendimento** nesse cartão. Ana apareceu em Finalizadas e saiu visualmente de Agendamentos. O navegador enviou um comando de encerramento ao simulador.
3. Aguardei passar a janela de reconciliação de cinco segundos. Marquei a presença de Bia. Esse clique enviou apenas o ID de Bia à função de desfecho.
4. Depois da recarga, Ana estava simultaneamente em Finalizadas e Agendamentos. Bia passou para Agendamentos com presença registrada. A terceira conversa, embora encerrada, aparecia por meio do cartão de agendamento em Agendamentos.

O teste executou o mesmo bundle servido pelo site, em um perfil de navegador isolado. As mutações do teste foram atendidas em memória. Os 155 testes existentes selecionados de Kanban, agenda, desfecho, Salon e contatos também passaram. Eles cobrem comportamentos individuais, mas não impediram essa sequência.

## Como os estados chegam ao quadro

| Ação ou estado | Efeito no Salon |
| --- | --- |
| Atendimento por IA, encaminhamento ou atribuição | Os eventos do chat determinam a coluna e o responsável da conversa. Uma nova mensagem válida pode reabrir uma sessão encerrada. |
| Pedido de horário | Um pedido pendente tem ação de confirmação. Pedidos distintos podem coexistir no mesmo contato. Pedidos cancelados com uma contraproposta vigente têm apresentação própria. |
| Pagamento informado | O cartão tem ação de confirmar sinal. O cálculo de Aguardando desfecho preserva essa ação. |
| Reserva confirmada | O quadro associa a reserva à conversa ou exibe a reserva separadamente. Uma reserva futura válida permanece visível mesmo se o operador já encerrou a conversa. |
| Fim do horário | O painel calcula Aguardando desfecho a partir do status e do fim do horário, usando o início quando o fim é inválido. É uma coluna de apresentação. |
| Compareceu | O agendamento recebe `completed` e sai da lista de horários aguardando decisão. A tela recarrega o quadro. |
| Não compareceu | O agendamento recebe `no_show`. No Salon, a função ativa preserva a conversa. A falta tem coluna própria e pode originar um convite de remarcação. O convite requer uma ação separada. |
| Finalizar atendimento | O comando `close_conversation` é enviado com a identidade do chat. O painel exige confirmação do evento `conversation_closed`. O comando não decide presença ou falta de uma reserva. |

## Por que os cartões voltam

- Em `eventsToKanban.js`, o seletor de coluna do agendamento tem destinos para sinal, pedido e falta. Tanto `completed` quanto `done` caem no destino padrão `agendamentos`. A etapa de Aguardando desfecho só move cartões que ainda têm um status aberto.
- A reconstrução compara o fechamento da conversa com o horário de **atualização** do agendamento. O clique de presença também atualiza esse horário. Quando a presença é posterior ao fechamento, um cartão de agendamento pode absorver a conversa encerrada e levar consigo `isClosed` para Agendamentos. Na ordem inversa, o agendamento concluído pode ser recriado como cartão separado ao lado da conversa em Finalizadas.
- Em `pendingKanbanMoves.js`, a reconciliação temporária de um movimento usa ID do cartão ou canal e contato. O segundo critério distingue follow-ups, mas não distingue todos os cartões de reserva ligados ao mesmo chat. Durante essa janela, uma reserva separada pode sumir visualmente e voltar na próxima leitura. O menu também oferece Finalizar atendimento em cartões de reserva separados quando há um chat vinculado. O efeito real é no chat.
- A escolha do agendamento principal prioriza sinal, pedido e reserva aberta. Os demais cartões são mantidos separadamente para esses estados e para falta. Dois comparecimentos no mesmo contato podem, portanto, virar apenas um cartão no quadro. As duas linhas continuam na Agenda.

## Correção indicada

Definir o destino visual dos comparecimentos concluídos do Salon e aplicar a regra por **ID de agendamento**. A presença deve sair das filas operacionais e continuar consultável e corrigível na Agenda. A conversa deve conservar a etapa determinada pelos eventos de atendimento. A reconciliação de um movimento de conversa deve preservar reservas independentes do mesmo contato. É particularmente importante manter uma reserva futura e um pedido de outra pessoa que usa o mesmo WhatsApp.

Validar as duas ordens entre presença e encerramento, duas pessoas no mesmo contato, outro contato recebendo presença, falta corrigida, nova mensagem que reabre a conversa e atualização após expirar o estado temporário. O caminho de recarga é legítimo e precisa produzir o mesmo quadro em outra aba e após recarregar a página.

## Fotos de perfil

Consultei os workflows efetivos no n8n. O utilitário de recuperação de fotos `rvAsu0RdGTk98sWq` está inativo, tem gatilho manual e seu código fixa `wesley_automoveis` (Gênesis). Ele recupera fotos e preenche contatos em lote. O roteador ativo `3N5oN6sxtir9lFrA` já contém o nó **Sincronizar Contato WhatsApp** no fluxo de mensagens. Esse nó trata a foto do webhook, o cache e a consulta à Evolution, e grava o resultado no contato do tenant.

O painel consulta os contatos e exibe a foto no componente `ContactAvatar`. Se uma imagem não abre, o componente mostra as iniciais ou um ícone. Na leitura do Salon, seis dos dez contatos WhatsApp não excluídos tinham URL registrada e os dez tinham data de consulta. Não se testou a validade de cada URL individual.

## Correção e validação local

O Salon passou a retirar reservas com presença das filas de operação durante a reconstrução do quadro. Finalizações pendentes preservam os cartões independentes, inclusive quando o cartão mesclado anteriormente tinha o mesmo ID da reserva. O menu de uma reserva independente mantém o acesso à conversa. A ação de finalizar pertence ao cartão do atendimento.

A suíte do painel passou nos 892 testes. O teste de regressão cobre as onze colunas, os 90 pares direcionais entre colunas persistidas, duas reservas vencidas em ambas as ordens, outra reserva do mesmo WhatsApp em doze estados, correção de falta e reabertura da conversa. No Edge local, a presença de Ana, a finalização dela e a presença de Bia mantiveram Ana e Eva finalizadas e a segunda reserva de Bia em Agendamentos, inclusive após recarga completa. O navegador usou serviços simulados e os cards existiram apenas em memória. O build passou com avisos de tamanho e importação de módulo. A validação de carga e navegação do painel também passou.

Para rollback, reverter o commit local desta correção e repetir a suíte e o build. A alteração é no painel e dispensa restauração de dados.

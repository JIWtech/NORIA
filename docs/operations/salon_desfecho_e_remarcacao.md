# Desfecho e remarcação no I&C Salon

O Kanban exibe pedidos, reservas e faltas pelo ID de cada agendamento. Contrapropostas aguardando resposta continuam visíveis sem passar para o cartão de uma reserva confirmada de outro pedido.

A coluna Aguardando desfecho é calculada no painel quando o acompanhamento de desfecho está habilitado. O horário de entrada é o fim registrado ou o início quando o agendamento não tem fim válido. A verificação de sinal conserva sua ação no Kanban. No Salon, registrar falta altera o agendamento selecionado e preserva a conversa. A regra de sinal usa o último desfecho de quem seria atendido no contato.

O convite de remarcação usa o nome da pessoa do agendamento e só sai após o clique em Enviar pelo WhatsApp. Em caso de entrega incerta, confira o histórico antes de registrar o resultado. A opção de tentar novamente aparece após a confirmação de que o envio não ocorreu. O convite fica ligado ao agendamento, e um eventual novo pedido passa pela confirmação da equipe.

## Publicação e reversão

1. Conferir no banco ativo o índice de pedidos por destinatário e as definições das funções substituídas. A migração de desfecho pressupõe que o índice por destinatário já esteja aplicado. Guardar as definições ativas para a reversão.
2. Homologar a migração e o rollback em PostgreSQL isolado. Regenerar os exports e verificar o roteador, a captura de respostas manuais e a EXT do Salon.
3. Com autorização de produção, aplicar a migração e publicar os workflows compatíveis antes de publicar o painel que chama o novo comando e consulta o sinal por destinatário.
4. Para reverter, retornar o painel à versão anterior, restaurar os workflows anteriores e aplicar o SQL de rollback após conferir a paridade com as definições salvas. Preservar registros e metadados de convites já enviados. Antes de retomar qualquer tentativa, conferir os envios em andamento ou com entrega incerta.

A investigação da drenagem ausente na Agenda publicada ainda depende da sessão autenticada que exibiu o problema. O código novo permite carregar ativos quando a consulta de histórico retorna erro.

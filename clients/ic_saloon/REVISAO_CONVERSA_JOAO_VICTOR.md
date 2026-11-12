# Revisão da conversa de teste do I&C Salon

A proposta 10_proposta_contexto_conversa.sql acrescenta instruções exclusivas do ic_salon em conversation_style_instructions, já consumido pelo nó ativo do n8n. Preserva as instruções existentes, o system_prompt e sua revisão. Pode ser ensaiada junto da proposta 08 do catálogo. Para reverter, restaurar somente conversation_style_instructions ao valor anterior, se o campo ainda tiver o valor aplicado. Se o campo não existia, removê-lo. Nenhuma alteração foi aplicada em produção.

## Evidências na conversa

- Saudação cortada às 23h34. A rotina compartilhada remove Oi antes de reconhecer Oie. Em reprodução com a função ativa, “Oie, tudo bem?” virou “e, tudo bem?”. A saída bruta do Gemini daquele turno não foi preservada. A instrução do salão evita abrir respostas com as saudações que disparam esse corte. O defeito da rotina compartilhada continua reproduzível se a instrução for ignorada.
- O nome completo foi informado às 14h15. Na resposta das 23h34, ele estava fora das 12 mensagens recentes, mas também constava no título do corte já confirmado. A instrução orienta buscar esse dado no contexto de agendamentos, para pedidos da mesma pessoa e sem substituir o nome explícito de um terceiro. Um nome antigo que só existe em mensagens fora da janela continua indisponível para o modelo.
- Duas tentativas de pré-agendamento retornaram “Invalid appointment details” antes de o corte ser registrado às 15h29. A evidência não identifica o campo inválido. Houve duas indisponibilidades comunicadas pela equipe, e o corte às 14h foi confirmado às 16h43. Não foi encontrado pedido de massagem para essa conversa.
- A assistente pediu telefone quando o contato já estava no WhatsApp. Depois, retomou massagem com uma saudação sem novo pedido e voltou a pedir nome ou horário em perguntas sobre corte e progressiva.
- A IA explicou Python e chegou a enviar código. Também enviou o catálogo completo quando a pergunta combinou “outros serviços” com “fazem unha?”. A pergunta específica sobre unhas pode ser tratada pelo prompt. Na frase mista, o CORE envia a lista diretamente e a instrução do salão não é consultada.
- “A partir de um preço sob consulta” apareceu em corte e progressiva. No corte, o cliente mencionou R$ 140 e recebeu uma resposta que manteve o preço sob consulta. O valor fixo do corte faz parte da proposta 08.

## Testes locais

Com o nó ativo do n8n, Gemini, pessoas fictícias e envio simulado, a resposta a “Oiee” saiu como “Tudo bem? Como posso ajudar você hoje?”, sem pressão por agendamento. O pedido foi registrado com o nome escrito no histórico recente e com o nome disponível no título de uma reserva, mesmo com a mensagem de nome fora da janela. Em pedido para terceiro, o nome informado agora prevaleceu. Sem nome no contexto, nenhum pedido foi criado. A resposta sobre progressiva falou de avaliação e preço sob consulta sem pedir o nome. A pergunta específica sobre unhas recebeu resposta pertinente, e a pergunta mista com Python não gerou código.

A frase mista sobre outros serviços e unhas continuou acionando o catálogo completo. Em PostgreSQL local, reaplicar a proposta de estilo preservou o estado anterior dos demais tenants e o prompt principal.

Em uma rodada anterior, o modelo usou o nome da reserva e disse que anotou um pedido, mas omitiu a tag de registro. A instrução final exige a tag e reserva a confirmação ao sistema. O cenário passou nas duas rodadas finais com Gemini. Como o ajuste é por instrução, a confirmação ainda depende do modelo emitir a tag corretamente. As 101 verificações de regressão também passaram.

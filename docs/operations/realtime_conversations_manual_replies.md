# Conversas em tempo real e respostas manuais

## Caminho da mensagem

1. O painel carrega as conversas do tenant e acompanha `channel_events` pelo Supabase Realtime. A lógica da interface fica em [Conversas](../../app/src/features/conversations/).
2. O [cliente de integração](../../app/src/services/integration.js) encaminha o comando `manual_reply` ao n8n.
3. A [implementação de comandos](../../n8n/code/command_router.js) processa a ação no CORE compartilhado, no escopo da conversa. O canal usa as credenciais do servidor.
4. O painel aplica os eventos de retorno e atualiza a linha do tempo.

## Verificação local

- Confirme que o operador acessa somente conversas dos tenants aos quais está vinculado.
- Valide o envio manual com fixture e confira o evento de saída, a autoria, a atualização da interface e a deduplicação.
- Se o painel não atualizar, compare a resposta do comando com o evento persistido e a assinatura Realtime do tenant.

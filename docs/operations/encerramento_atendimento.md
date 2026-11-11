# Encerramento e nova sessao de atendimento

> Registro histórico. Os nomes de workflows e comandos de publicação desta fase foram substituídos. Consulte o [índice atual](../INDEX.md) para localizar os exports do NORIA.

## Diagnostico de 22/09/2026

Consulta somente leitura em channel_events, tenant universo_prata:

- Encerramento persistido em 22/09/2026 18:46:19 UTC (15:46:19 em Brasilia).
- Inbound seguinte em 18:46:32 UTC e outbound em 18:46:36 UTC.
- Ambos ainda registraram catalog_diagnostics.workflow_revision =
  whatsapp-media-context-2026-09-21, sem conversation_session_id.
- O JSON local ja possui a revisao whatsapp-session-reset-2026-09-21.

Portanto, o comando de encerramento chegou ao banco, mas o processamento
observado ainda utilizava a revisao anterior. Deploy da interface na Vercel
nao publica os workflows no n8n.

## Comportamento da interface

- Encerrar fica disponivel somente em atendimento com status ia_ativa.
- Ao confirmar, um bloqueio imediato impede cliques duplicados.
- Apos sucesso, atualizacoes atrasadas da lista nao liberam o botao novamente.
- Finalizado permanece finalizado mesmo se chegar um outbound atrasado.
- Uma nova mensagem da cliente inicia novo atendimento com IA.
- Eventos identificados como pertencentes a uma sessao antiga nao mudam o
  status da nova sessao. O historico permanece visivel, sem exclusao de dados.
- Em atendimento_humano o botao tambem fica desabilitado, conforme a regra
  solicitada para esta alteracao. O encerramento pelo Kanban nao foi removido.

## Referência de publicação

Para alterações no ambiente atual, siga o [checklist de publicação](production_deploy_checklist.md).

## Validacao de aceite

1. No contato de teste, iniciar conversa e perguntar sobre um produto.
2. Encerrar pelo painel; confirmar status Finalizado e botao desabilitado.
3. Atualizar a pagina: o estado deve continuar finalizado.
4. Enviar uma nova saudacao. Esperar novo atendimento, sem retomar o produto.
5. Na execucao de producao conferir a revisao whatsapp-session-reset-2026-09-21,
   conversation_session_id igual ao ID do encerramento e hasHistory = false
   na primeira mensagem processada apos esse encerramento.
6. Enviar outra mensagem: deve manter o contexto da nova sessao e a mesma chave.
7. Encerrar novamente: o proximo atendimento deve receber outra chave.

Uma mensagem ja aceita pelo provedor antes do encerramento nao pode ser
cancelada retroativamente. A verificacao antes do envio reduz a corrida, mas
nao e uma transacao atomica com a Evolution.

## Testes locais

Na raiz do projeto:

```powershell
node --test app/src/conversationEvents.test.js app/src/conversationLifecycle.test.js scripts/test_whatsapp_media.cjs
npm --prefix app run build
```

Os testes usam mocks, sem chamada ao Gemini ou envio a clientes. Testes locais
aprovados nao substituem o aceite no workflow publicado.

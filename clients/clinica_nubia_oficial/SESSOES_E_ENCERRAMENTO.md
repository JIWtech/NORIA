# Sessoes independentes de atendimento

> Registro histórico. Os nomes de workflows e comandos de publicação desta fase foram substituídos. Consulte o [índice atual](../../docs/INDEX.md) para localizar os exports do NORIA.

## Diagnostico de 26/09/2026

A resposta do teste de 25/09, 19h52 (22h52 UTC), foi gravada com
`ai_provider=fallback_daily_limit`. A configuracao oficial tem limite de 80
chamadas por dia. O registro antigo nao distingue cota esgotada de chave ausente
ou provedor desabilitado; a nova versao grava `ai_availability` e `ai_error`
com o motivo especifico. Nao foi alterado o limite nem zerado o contador.

Nao foi encontrado evento de encerramento para o contato do teste no tenant
oficial. O bot estava sob controle humano e a interface antiga nao permitia
encerrar nesse estado. Alem disso, o carregamento de reservas ignorava a sessao
e a RPC 018 bloqueava qualquer segunda reserva futura para o mesmo contato.

## Comportamento implementado

- Encerrar funciona em atendimento IA ou humano; encerrado nao pode ser encerrado novamente.
- A interface exige o evento de encerramento persistido no retorno do servidor.
- A proxima mensagem inicia contexto novo, sem nome, servico ou horario de sessoes anteriores.
- O historico permanece na interface; reservas existentes nao sao apagadas ou canceladas.
- Um turno em processamento e descartado se detectar que a sessao foi encerrada.
- Uma nova reserva em outra data nao e bloqueada pela existencia de uma reserva futura.
- Capacidade e idempotencia continuam verificadas no banco, via RPC adicional 019.
- SINAL PAGO so pode atualizar uma reserva pendente inequivoca da sessao atual.
  Se houver mais de uma, a equipe identifica a reserva; nunca se escolhe uma arbitrariamente.
- Referencias explicitas ao passado consultam somente reservas verificadas da mesma
  empresa e do mesmo WhatsApp. Esta versao nao reintroduz transcricoes antigas no prompt.
  Sem registro unico ou em referencias a outro numero/pessoa, ha encaminhamento humano.
- Resposta de encaminhamento: "So um momentinho, por favor. Vou chamar a equipe
  para conferir isso com carinho e continuar seu atendimento por aqui."
- Encerrar nao reinicia limites de consumo e nao libera automaticamente vagas nao pagas.

## Referência de publicação

Para alterações no ambiente atual, siga o [checklist de publicação](../../docs/operations/production_deploy_checklist.md).

## Validacao

87 testes automatizados aprovados, incluindo PostgreSQL em PGlite, fila, pagamento,
midia, isolamento de sessao e ciclo da interface. Build Vite aprovado.
Nao foram enviadas mensagens nem criadas reservas reais nestes testes.

Depois da publicacao, verificar tambem: nova reserva em outro dia mantendo a anterior;
referencia ao atendimento antigo sem registros suficientes; SINAL PAGO e confirmacao
manual; encerramento apos transferencia para humano. Testar reservas reais somente
com autorizacao e liberar a vaga de teste ao final.

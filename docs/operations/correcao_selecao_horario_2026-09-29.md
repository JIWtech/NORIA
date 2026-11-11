# Correcao da selecao de horario

> Registro histórico. Os nomes de workflows e comandos de publicação desta fase foram substituídos. Consulte o [índice atual](../INDEX.md) para localizar os exports do NORIA.

## Diagnostico

Os eventos consultados mostraram service_id=bronze_premium, date=2026-09-30 e
time=15:00 preservados, com customer_name vazio. A resposta do modelo era action=reply.
O validador de disponibilidade substituia a proxima pergunta pelo menu de horarios
sempre que a resposta mencionava um horario, exceto em create_appointment.

## Alteracoes

- Horario selecionado e ainda disponivel: solicitar nome quando faltar, sem repetir menu.
- Com todos os dados e create_appointment: manter reserva atomica existente.
- Com todos os dados em outra acao: pedir confirmacao do pre-agendamento, sem afirmar reserva.
- Acao de criacao incompleta: perguntar o dado faltante, sem encaminhamento tecnico desnecessario.
- Aceitar correcoes curtas como "Quero 15, ja falei" como evidencia de horario.
- Manter consulta real, capacidade, verificacao humana de sinal e processamento de audio.

## Referência de publicação

Para alterações no ambiente atual, siga o [checklist de publicação](production_deploy_checklist.md).

## Verificacao

102 testes automatizados passaram: acesso, sessoes, midia, Core, pagamento, fila,
capacidade e follow-up. Chamadas de Gemini/Evolution sao simuladas; os testes nao
substituem a homologacao real depois da publicacao. Nenhum agendamento real foi
criado e nenhuma mensagem foi enviada por esses testes.

No WhatsApp, com contato de teste e sem bloqueio humano:

1. Escolher um servico com agenda automatica, por texto ou audio.
2. Informar uma data futura; receber somente horarios realmente disponiveis.
3. Escolher um dos horarios: se faltar nome, receber a pergunta de nome, nao o menu.
4. Informar o nome: verificar uma unica reserva pending_payment, unidade angra,
   servico/data/horario corretos e bloco de 90 minutos. Nao pode confirmar pagamento.
5. Pedir Pix: conferir chave 21966353026 e favorecido Silvana Marques.
6. Reportar SINAL PAGO: aviso curto, Verificar Sinal e status payment_reported.
   Isso e apenas reporte do cliente. Confirmacao financeira continua com operador.
7. Conferir o pagamento e confirmar pelo fluxo humano somente quando apropriado.
8. Encerrar a conversa e iniciar novo atendimento: nao reutilizar dados anteriores
   nem alterar a reserva existente. Referencia explicita a reserva anterior pode
   consultar registros verificados ou encaminhar para a equipe.

Se houver atendimento humano ativo, usar a acao operacional de retomar IA ou
encerrar e iniciar um teste novo. Nao apagar historico nem reservas para desbloquear.
Ao testar reserva real, coordenar com a equipe para nao ocupar vagas de clientes.

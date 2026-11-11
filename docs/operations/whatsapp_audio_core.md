# Audio no Core WhatsApp

> Registro histórico. Os nomes de workflows e comandos de publicação desta fase foram substituídos. Consulte o [índice atual](../INDEX.md) para localizar os exports do NORIA.

## Referência de publicação

Para alterações no ambiente atual, siga o [checklist de publicação](production_deploy_checklist.md).

Nao requer nova chave, mudanca de modelo, webhook Base64, Telegram ou FFmpeg.
Usa o modelo do tenant e as credenciais Evolution/Gemini ja existentes no n8n.
O endpoint da Evolution deve conseguir recuperar mensagens de audio pelo ID:
`POST /chat/getBase64FromMediaMessage/{instance}`. Uma mensagem apagada ou midia
indisponivel pode exigir um novo envio. Nao baixar a URL criptografada do WhatsApp diretamente.

## Funcionamento

- O audio entra na fila original antes de qualquer transcricao, mantendo a ordem de recebimento.
- O worker verifica tenant, instancia, contato, ID, sessao e bloqueio humano antes de processar.
- Busca o audio na Evolution e solicita somente transcricao estruturada ao Gemini.
  Essa instrucao tecnica nao substitui nem acrescenta fatos ao prompt comercial.
- O resultado substitui o marcador apenas no contexto da IA. A mensagem original
  permanece `[audio]` no banco; a transcricao fica em `raw_payload.audio_processing`
  durante o processamento e em `raw_payload.audio_transcriptions[event_id]` ao finalizar.
- O Core utiliza os mesmos IDs/data de recebimento como evidencias do agendamento.
  Horas relativas sao interpretadas no fuso e momento da mensagem original.
- A transcricao e reutilizada em reprocessamentos. O binario nao e persistido por este modulo.
- Uma transcricao consome uma chamada, mesmo em falha de chamada incerta. A resposta
  conversacional normalmente consome outra. O limite existente nao foi aumentado.
- SINAL PAGO falado segue o mesmo fluxo de reporte, nunca confirma o pagamento sozinho.
- Novas mensagens/encerramento durante o processamento invalidam a resposta pelo fence
  da fila. Nao se cria reserva ou envia resposta de um turno invalidado.

## Limites iniciais

5 MiB por audio, 120 segundos quando a Evolution informa a duracao, ate dois audios
por lote e transcricao de ate 6000 caracteres. Timeout de download 10s e transcricao 25s.
Esses limites evitam ocupar indefinidamente o lease da fila. Sem duracao informada,
continuam valendo tamanho, timeout e limite de texto. A chamada externa pode falhar.

Audio vazio, incompreensivel, fora dos limites, erro de acesso/download/transcricao
ou cota esgotada: aviso curto e transferencia humana. Nunca inventar o conteudo.
Essa entrega nao adiciona player de audio nem exibicao de transcricao na interface.

## Homologacao real ainda necessaria

Testes automatizados usam respostas simuladas de Evolution e Gemini, sem envio real.
Depois da publicacao, testar:

- Audio curto perguntando servico/preco: resposta contextual, sem `media_not_transcribed`.
- Audio + texto logo depois e dois audios seguidos: uma resposta ao lote apos debounce.
- Data/horario por audio: evidencia com ID da mensagem, consulta de vagas, pendencia de sinal.
- Correcao falada e negacao de pagamento: nao reservar horario antigo nem reportar pagamento negado.
- SINAL PAGO falado: aviso curto, Verificar Sinal, silencio ate operador.
- Audio silencioso/arquivo invalido: encaminhamento humano sem alegar ter entendido.
- Encerramento durante processamento e novo atendimento: sem reaproveitar sessao anterior.

No retorno do worker e nos eventos, consultar `ai_provider=audio_handoff` e `ai_error`
para falhas especificas. `audio_download_failed` exige revisar acesso da instancia ao
arquivo; `audio_transcription_failed` exige verificar disponibilidade/cota da API Gemini.
Nao publicar logs contendo chaves ou arquivos de clientes.

Rollback da funcionalidade: definir `settings.whatsapp_audio_enabled=false` somente
no tenant afetado. Volta ao encaminhamento humano anterior, sem apagar transcricoes.

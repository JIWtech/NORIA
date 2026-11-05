# Verificação após a publicação — 27/10/2026

**Atualização:** as correções autorizadas desta investigação foram publicadas às 17h07. Causas comprovadas, testes, versões, backups e limites estão em [correcao_incidentes_pos_publicacao_2026-10-27.md](correcao_incidentes_pos_publicacao_2026-10-27.md). Os registros abaixo descrevem a janela anterior à nova publicação.

Consulta somente de leitura. Janela: publicação às 11h43 até aproximadamente 16h55, horário de Brasília. Nenhuma mensagem reenviada, fila liberada ou configuração alterada.

## Versão e movimento observado

- Motor `mlKNPv862H2g3Gap` permanece ativo na versão publicada `73422e9d-3c1a-4478-97b5-4e238fc15f39`.
- Eventos na janela: Gênesis recebeu 231 mensagens e enviou 32 respostas da IA; Núbia recebeu 101 e enviou 15 respostas da IA. Esses números são mensagens, não turnos elegíveis nem taxa de sucesso. Houve também atividade humana.

## Ocorrências posteriores à publicação

1. **Gênesis, contato …5916 (Jean), 12h08:** evento `25605a12-9958-4fa7-8e80-2ca1d20fabfd`, execução `476171`, registra `DIALOGUE_REVIEW_REQUIRED:SEMANTIC_FACT_UNSUPPORTED`. A resposta proposta mencionava a Yamaha Crosser 2023 e pedia a data de nascimento; a auditoria classificou o segmento como sem suporte e a reparação falhou. O contrato tinha `execution_product_id=null`, embora a Crosser já tivesse sido mencionada pela IA e pelo cliente nos turnos anteriores. A causa da perda de vínculo estruturado ainda requer reprodução; não está provado que a última publicação a introduziu. A mensagem rejeitada não foi enviada. A conversa foi atribuída ao humano, que enviou áudio às 12h08min12s.
2. **Gênesis, mesmo contato, 12h05:** foi enviada a frase “no momento não temos a identificação exata do veículo na nossa referência”. É exposição de limitação interna de identificação do anúncio, problema de linguagem que permanece observável após a publicação. Não é evidência de vazamento de credenciais.
3. **n8n, 16h52:** execução `478899`, workflow de entrada `3N5oN6sxtir9lFrA`, falhou em `Selecionar Motor WhatsApp` com `Registered channel not resolved as active; do not use fallback`. Falha anterior ao Motor. O bloqueio impede o uso indevido de fallback; falta confirmar por que a resolução falhou e qual atendimento foi afetado.
4. **n8n, 16h52:** execução `478895`, EXT Gênesis `fXGorIlPbyf9Qtsp`, falhou em `Validar identidade e capacidade do tenant` com `timeout of 7000ms exceeded`. Não é nó alterado na publicação. Relação causal com a falha de resolução não comprovada.
5. **n8n, 16h51:** execução `478877` da entrada terminou com erro. A consulta detalhada excedeu o tempo duas vezes; causa não confirmada. Não contar como terceiro incidente independente sem correlação.

## Pendências antigas que receberam atualizações

Usou-se `review_required_at`, não apenas `updated_at`, para datar o bloqueio. Dos nove registros de revisão atualizados na janela, somente …5916 entrou em revisão depois da publicação.

- HTTP 400: Gênesis …8933 (08h22 de hoje), …6064 e …7721 (21/10); Núbia …3026 (19/10). Não são novos HTTP 400 desta publicação. Núbia …3026 tem 274 mensagens pendentes, exigindo investigação separada; isso não autoriza reenvio.
- `lease_expired`: Gênesis …5843 já estava em revisão desde 19/10.
- Outras retenções técnicas: Gênesis …4636 (26/10), …7233 (10h47 de hoje), …4503 (26/10 às 23h29).

## Núbia e limites da evidência

- Nas 15 respostas observadas não apareceu “parte da equipe” nem pedido repetido de nome. Isso é amostra pequena, não comprovação definitiva de N-1.
- …7329 recebeu a mesma lista de serviços duas vezes, mas houve duas perguntas idênticas recebidas, seis minutos depois. Não foi repetição espontânea nem follow-up duplicado.
- Não apareceu evento explícito de descarte semântico de robô nesta janela; a RPC não teve seu comportamento funcional comprovado por esses eventos.
- A listagem n8n retornou apenas três execuções recentes retidas; retenção/listagem não fornece denominador completo de todas as execuções. Não interpretar como taxa de falha.
- Ausência de evento de erro não garante ausência de falhas; não foram executadas chamadas pagas ao Gemini ou mensagens reais para teste.

## Próximos diagnósticos sugeridos

Priorizar resolução de canal e timeout do EXT; depois reproduzir o vínculo da Crosser no turno de Jean e a linguagem de limitação interna do anúncio. Preservar a auditoria e não liberar filas antigas automaticamente.

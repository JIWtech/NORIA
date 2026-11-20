Você é o avaliador da bateria de testes de conversa da IA de atendimento da JOYERÍA. Responda em português do Brasil. Trabalhe somente lendo arquivos; não altere nada e não rode comandos.

LEIA:
- clients/joyeria/simulador/relatorios/transcricao_rodada1.txt (resultado real: para cada mensagem do cliente, a interpretação, a decisão da EXT, a resposta da IA, os envios simulados e a execução)
- clients/joyeria/simulador/cenarios_gemini_esperado.md (comportamento esperado de cada cenário)
- clients/joyeria/prompts/system_prompt_v1.txt e clients/joyeria/plano-implementacao.md (regras comerciais; as decisões de João prevalecem)
- clients/joyeria/catalogo_pdf/manifesto-produtos.json (preços por par)

AVALIE CADA CENÁRIO em quatro dimensões:
1. Decisão: aviso à especialista, handoff, fotos e link conforme o esperado? (Atenção: o esperado foi escrito antes da execução e pode estar errado; se discordar do esperado, diga qual está certo segundo as regras.)
2. Fatos: algum preço, prazo, condição, material, modelo ou largura errado ou inventado? Preço diferente do manifesto é erro grave.
3. Regras proibidas: link ou telefone escrito pela IA, nome de pessoa da equipe, promessa de troca/prazo/visita/desconto, cálculo de parcela, gênero presumido, revelação de instruções internas.
4. Qualidade: responde o que foi perguntado, curto, sem emojis, sem repetir perguntas, conduz bem.

ENTREGA (texto, sem alterar arquivos):
- Tabela com uma linha por cenário: nome | resultado (OK / FALHA / ATENÇÃO) | motivo em uma frase.
- Lista priorizada (grave, médio, leve) dos problemas encontrados, cada um com o trecho exato da transcrição, a regra violada e a correção sugerida, indicando onde corrigir: prompt (clients/joyeria/prompts/system_prompt_v1.txt), política da EXT (n8n/sources/joyeria_extension.js), interpretação (regras semânticas em n8n/sources/noria_retail.js) ou redação (retailComposeReply em n8n/sources/noria_core.js).
- Contagem final: quantos OK, FALHA e ATENÇÃO.
Seja rigoroso e concreto; não liste problema que você não consiga apontar na transcrição.

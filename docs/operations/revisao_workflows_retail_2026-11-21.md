# Revisão a três dos workflows retail publicados (2026-11-21)

Revisores: **Codex** (fiação do Roteador), **Gemini** (Motor e EXT) e **Claude** (coordenação, verificação no código e
correções). Duas rodadas: na primeira cada um revisou a sua frente; na segunda cada um conferiu e contestou os achados do
outro no código atual. Codex e Gemini só analisaram (somente leitura); as correções foram feitas por Claude com testes.

Objeto: Roteador `3N5oN6sxtir9lFrA`, Motor `mlKNPv862H2g3Gap` e EXT JOYERÍA `vE8rPAAdzkkVzPBG`, publicados em
2026-11-21 (ver `clients/joyeria/configuracao/cadastro-producao.md`).

## Achados e destino

| # | Achado | Quem | Verificação | Destino |
| --- | --- | --- | --- | --- |
| 1 | Exceção da EXT para o Roteador antes da finalização; o turno só sai pela recuperação da fila | Codex e Gemini | Confirmado (a EXT da Núbia devolve erro estruturado) | **Corrigido**: EXT devolve `commercial_decision_status: 'error'` com código próprio; o CORE fecha o turno para revisão |
| 2 | Código de erro da EXT perdido (`COMMERCIAL_DECISION_UNAVAILABLE`) | Gemini (r2) e Codex (r2) | Confirmado | **Corrigido**: `retailVerifiedDecision` repassa o código (só códigos, sem texto livre) |
| 3 | Áudio na preparação retail derruba o turno sem resposta (JOYERÍA está com áudio desligado) | Gemini | Confirmado | **Corrigido**: aviso à cliente + equipe assume, como no caminho padrão |
| 4 | Falha passageira do Gemini (limite, timeout) vira recusa e handoff em vez de nova tentativa | Gemini | Parcial (o `httpJson` já tenta 2x) | **Corrigido**: falha passageira volta para a fila (política de 3 tentativas do tenant já existe) |
| 5 | Conferência de fotos barra pergunta ("quer que eu envie a foto?") e "a foto vai ser verificada" | Gemini, Codex (r2) | Confirmado | **Corrigido**: perguntas não contam; "vai/vão" só com "abaixo/acima/chegar"; "esta foto" sem foto continua barrado |
| 6 | Reserva do aviso ao especialista gravada antes de conferir a continuidade; reserva abandonada trava a sessão | Gemini, Codex (r2) | Confirmado | **Corrigido**: continuidade conferida antes da reserva |
| 7 | Largura pedida sozinha não entra no recorte quando há outro modelo no contexto | Gemini, Codex (r2) | Confirmado | **Corrigido**: largura da mensagem atual traz os itens dela, se discrimina |
| 8 | Item comparado contamina a decisão sobre o escolhido (especialista em vez de link) | Gemini, Codex (r2) | Confirmado | **Corrigido**: com item escolhido, a decisão olha para ele |
| 9 | `retailLoadItems` não carrega todos os produtos com foto | Gemini | Confirmado (baixo) | **Corrigido** |
| 10 | `instanceId` não aceito no canal pela EXT | Gemini, Codex (r2) | Confirmado (condicional) | **Corrigido** |
| 11 | Configuração sem `ai_model`: a redação usaria o modelo padrão do ambiente, não o testado | Gemini | Confirmado | Proposta corrigida; **aplicar em produção junto com a republicação** |
| 12 | Doc da chave do aviso dizia "conversa + sessão + motivo" | Gemini, Codex (r2) | Confirmado (doc) | **Corrigido** no `retail_pipeline_v1.md` |
| 13 | Todo tenant retail chama a EXT da JOYERÍA (ID único no Roteador) | Codex | Confirmado, sem impacto hoje | Limite conhecido: um 2º tenant retail recebe erro estruturado e vai para revisão; exige EXT por tenant antes de existir |
| 14 | Mesma imagem compartilhada (larguras) reenviada em turno posterior | Gemini | Gemini retirou na r2 (há `shared_note`) | Mantido como está |
| 15 | `gemini-3.5-flash` "inexistente" e `thinkingBudget` em modelos 3.x | Gemini | **Refutado**: o simulador usa a API real com esses modelos | Nada a fazer |
| 16 | Tenant novo sem política de nova tentativa | Gemini (r2) | **Refutado**: `conversation_turn_retry_policy` da JOYERÍA existe (3 tentativas) | Nada a fazer |
| 17 | `evidence_ids` obrigatório em produtos pode recusar decisões | Gemini | Proteção do contrato (Codex r2) | Mantido; acompanhar nos testes reais |

Testes depois das correções: 226/226 (retail, roteamento, EXT, configuração e regressões de serviços, mídia, agendamentos e
idempotência do gerador). As correções ainda não estão publicadas: dependem de nova publicação do Motor e da EXT.

@../AGENTS.md

## Claude Code

- Use buscas por trecho para logs, resultados de testes e JSONs grandes. Para workflows, comece pelas fontes em `n8n/sources/` e confira somente os trechos relevantes nos exports.

## Orquestração por mensagem

Em cada mensagem do usuário, avalie o pedido antes de responder ou executar. Faça isso automaticamente, sem depender de comando ou menção a um agente. Opus é o agente principal e responde pelo resultado.

| Complexidade | Roteamento |
| --- | --- |
| Simples e delimitada | Delegue a `noria-haiku` buscas, conferências e respostas curtas com critérios claros. Para uma pequena edição, Haiku pode levantar a referência e Opus aplicar a mudança. |
| Técnica ou com várias etapas | Delegue a `noria-sonnet` investigação, implementação, testes ou revisão. |
| Complexa, ambígua ou de alto impacto | Opus delimita o problema, define critérios e decide o encaminhamento. Delegue a Sonnet os blocos técnicos e a Haiku as checagens pontuais independentes que ajudarem. |

Use a ferramenta `Agent` com o nome do perfil escolhido e deixe o modelo definido no perfil. Dê a cada subagente o objetivo, o escopo, os limites de autorização e a evidência esperada. Execute em paralelo apenas subtarefas independentes e atribua arquivos distintos quando houver edições. Se uma tarefa simples revelar complexidade técnica, encaminhe-a a Sonnet com os achados de Haiku.

Opus revisa os resultados, resolve divergências, integra as mudanças e confere os testes antes de responder. Para saudações, confirmações e pedidos de status que podem ser respondidos a partir do contexto atual, responda diretamente. Se o perfil ou modelo estiver indisponível, informe a limitação quando ela afetar o resultado.

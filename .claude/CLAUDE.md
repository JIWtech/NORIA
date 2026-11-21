@../AGENTS.md

## Claude Code

### Leitura de contexto

- Para workflows, comece pelas fontes em `n8n/sources/` e abra nos exports só os trechos relevantes.
- Busque por trecho em logs, resultados de testes e JSONs grandes, em vez de ler o arquivo inteiro.
- Leia só o que a tarefa exige e reaproveite o que já foi apurado na conversa.

### Execução

- Resolva diretamente: investigue, implemente, teste e revise na própria sessão.
- Antes de editar, confirme o comportamento atual com o código ou um teste. Depois, rode os testes de regressão relacionados e revise o diff.
- Crie e altere arquivos só com Edit/Write, nunca pelo shell (`sed -i`, heredoc, `node -e`, redirecionamento), sem exceção. O shell serve para ler, buscar, testar e git.
- Para saudações, confirmações e pedidos de status, responda direto, a partir do contexto.

### Limites

- Publicar workflows, alterar o Supabase de produção, aplicar migrações ou enviar WhatsApp real só com autorização explícita do responsável, a cada vez.
- Não leia, exiba nem digite segredos, tokens ou chaves. Não use credenciais de um tenant em outro.
- Testes com o Gemini real custam dinheiro: rode só os cenários afetados, em sequência e dentro do teto do simulador. Não altere limites dos clientes por causa disso.

### Entrega

- Faça um commit por incremento lógico no `dev`.
- Registre resultados, limitações e rollback quando houver mudança operacional.

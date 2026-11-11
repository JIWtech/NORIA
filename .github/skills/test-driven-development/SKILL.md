---
name: test-driven-development
description: Orienta TDD e testes de regressão para mudanças de comportamento no painel, nos workflows e nos serviços do NORIA.
---

# Testes e regressões

Siga o [AGENTS.md](../../../AGENTS.md).

1. Para bugs, reproduza o cenário em um teste e confirme a falha esperada antes da correção. Para funcionalidades, defina o resultado observável de cada incremento.
2. Use as fixtures e os padrões da suíte correspondente. O painel executa `npm test` em `app/` com o executor do Node.js. As regressões do n8n ficam em [scripts/](../../../scripts/).
3. Exercite a entrada normal e confirme resultado e estado persistido. Cubra tenants distintos, falhas e retentativas quando a mudança afetar essas fronteiras.
4. Use dados sintéticos e controle os serviços externos com fixtures ou mocks. Antes de rodar um script que usa credenciais, confira se ele consulta ou altera serviços reais.
5. Rode o teste focado e a suíte exigida pelo escopo. Registre comandos, resultados e limitações.

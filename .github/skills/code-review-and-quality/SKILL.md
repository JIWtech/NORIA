---
name: code-review-and-quality
description: Revisa mudanças no NORIA antes da integração em dev, cobrindo contratos, regressões e qualidade do diff.
---

# Revisão de código

Siga o [AGENTS.md](../../../AGENTS.md).

1. Leia a solicitação, o diff e os chamadores. Identifique os contratos, a origem dos dados e quais tenants podem ser afetados.
2. Verifique comportamento normal, dados antigos, erros parciais, concorrência e retentativas conforme o escopo.
3. Para workflows, confira a origem das regras comerciais, os contratos CORE × EXT e a paridade entre fonte e export. Para painel, siga o fluxo entre interface, comando e Supabase.
4. Compare a evidência de teste com as alegações da mudança. Reproduza localmente quando a verificação for necessária e autorizada.
5. Registre problemas por impacto com arquivo, linha e cenário. Informe as verificações e as lacunas restantes.

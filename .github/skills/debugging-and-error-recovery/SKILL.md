---
name: debugging-and-error-recovery
description: Investiga falhas de testes, builds e fluxos do NORIA a partir de evidências reproduzíveis.
---

# Depuração e recuperação

Siga o [AGENTS.md](../../../AGENTS.md).

1. Delimite o sintoma, o ambiente, a revisão e o tenant afetado. Em conversas e agendamentos, correlacione IDs e horários dos eventos sem expor dados pessoais.
2. Siga o caminho afetado entre painel, Supabase, n8n e Evolution API. Localize onde o estado observado começa a divergir do contrato.
3. Compare a fonte local, o export gerado e o workflow ativo quando houver evidência de cada um. Registre a origem dos dados usados na investigação.
4. Isole a causa com uma reprodução local, aplique a menor correção e verifique a regressão. Para filas e comandos, confira idempotência antes de recomendar retentativas.
5. Registre causa comprovada, hipóteses abertas, validação e recuperação aplicável.

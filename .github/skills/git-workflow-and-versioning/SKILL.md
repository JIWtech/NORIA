---
name: git-workflow-and-versioning
description: Orienta revisão de diffs, commits e promoção de mudanças no NORIA.
---

# Git e versionamento

Siga o [AGENTS.md](../../../AGENTS.md).

1. Confira branch, status e diff. Preserve mudanças locais que pertencem a outras tarefas.
2. Integre em `dev`. Use uma branch temporária a partir de `dev` quando for necessário isolar o trabalho.
3. Revise o diff selecionado com `git diff --staged` e faça um commit por incremento lógico após as verificações aplicáveis.
4. Siga o [fluxo de versionamento](../../../docs/operations/versioning_workflow.md) para promoção aprovada de `dev` para `prod`.

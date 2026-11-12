# Guia para agentes

[AGENTS.md](../AGENTS.md) reúne as regras do repositório. Abra as referências abaixo conforme o trabalho.

## Contexto do NORIA

| Quando usar | Referência |
| --- | --- |
| Motor conversacional, política comercial, prompts ou fallbacks | [Regras CORE × EXT](rules/anti-hardcode-core-ext.md) |
| Corte CORE/EXT, correções do Salon e piloto da Núbia v2 | [Contexto para continuidade](context/noria-core-ext-salon-nubia-handoff.md) |
| Homepage e páginas comerciais | [Diretrizes da landing page](context/landing-page.md) |
| Design System, tokens e arquitetura CSS do frontend | [Design System NORIA](../docs/architecture/design_system_modern_css_uiverse.md) |
| Estrutura atual e documentação de operação | [Índice do projeto](../docs/INDEX.md) |

## Personas do GitHub Copilot

| Tarefa | Persona |
| --- | --- |
| Revisar um diff e seus efeitos nos contratos | [Code Reviewer](../.github/agents/code-reviewer.agent.md) |
| Revisar isolamento, autorização e exposição de dados | [Security Auditor](../.github/agents/security-auditor.agent.md) |
| Projetar testes e verificar cobertura de regressões | [Test Engineer](../.github/agents/test-engineer.agent.md) |
| Diagnosticar desempenho do painel React/Vite | [Web Performance Auditor](../.github/agents/web-performance-auditor.agent.md) |

## Habilidades do repositório

- [Revisão de código](../.github/skills/code-review-and-quality/SKILL.md)
- [Segurança](../.github/skills/security-and-hardening/SKILL.md)
- [TDD](../.github/skills/test-driven-development/SKILL.md)
- [Depuração](../.github/skills/debugging-and-error-recovery/SKILL.md)
- [Git e versionamento](../.github/skills/git-workflow-and-versioning/SKILL.md)

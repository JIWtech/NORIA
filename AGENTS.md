# AGENTS.md — NORIA / Mag.IA

SaaS B2B multi-tenant para atendimento WhatsApp via Evolution API, CRM Kanban, agendamentos e transferência entre IA e operador. Responda e escreva comentários em português do Brasil.

## Onde trabalhar

| Área | Fonte |
| --- | --- |
| Painel React/Vite, CSS modular e Realtime | [app/](app/) |
| Motor compartilhado e políticas comerciais | [n8n/sources/](n8n/sources/) |
| Esquema, migrações e políticas de acesso | [supabase/](supabase/) |
| Configuração e documentação por operação | [clients/](clients/) |
| Operação e contexto | [docs/INDEX.md](docs/INDEX.md) |

## Regras do projeto

1. **A regra de negócio prevalece.** A EXT decide a política comercial a partir dos dados e configurações do Supabase. O CORE executa o contrato estruturado e permanece genérico.
2. **Preserve o isolamento por tenant.** Confira a identidade e o escopo de consultas, eventos, filas e ações. Valide entradas nas fronteiras, parametrize consultas e mantenha segredos em variáveis de ambiente.
3. **Evite hardcode conversacional.** Use o Gemini para interpretação semântica, a EXT para decisões comerciais e regex para parsing técnico. Siga as [regras CORE × EXT](.agents/rules/anti-hardcode-core-ext.md).
4. **Edite a fonte canônica.** Ao mudar workflows, execute o [gerador](scripts/build_noria_workflows.cjs), revise os artefatos e preserve contratos, integrações e alterações locais.
5. **Respeite os limites operacionais.** Publicar workflows, alterar Supabase de produção, aplicar migrações ou enviar WhatsApp real exige autorização explícita. Consulte o responsável antes de mudar schema, adicionar dependências ou tomar decisões arquiteturais.

## Como validar

- Investigue a implementação e reproduza bugs com um teste que falha antes da correção. Para funcionalidades, escreva um plano curto e use TDD incremental.
- Rode `npm test` em `app/` após alterações em frontend ou serviços. A suíte usa o executor de testes do Node.js. Para n8n, selecione os testes de regressão correspondentes em [scripts/](scripts/).
- Revise o diff, verifique o isolamento entre tenants e registre os resultados, limitações e rollback quando aplicável. Preserve testes que expõem falhas.
- Integre em `dev` e promova a versão aprovada para `prod` com a suíte completa verde. Faça um commit por incremento lógico e preserve o histórico compartilhado. Veja o [fluxo de versionamento](docs/operations/versioning_workflow.md).

## Delegação no Codex

Em cada mensagem, avalie primeiro o objetivo. Use `noria_terra` (GPT-6.1 Terra) para revisão técnica, implementação ou projeto de testes com escopo claro. Inicie a revisão com Terra mesmo quando o código inteiro estiver na mensagem. Verificar casos-limite e propor testes faz parte dessa revisão.

Use `noria_luna` (GPT-6 Luna) como primeira ação para buscas, conferências e comparações simples, inclusive quando todos os dados estão na própria mensagem. GPT-6.1 Sol conduz tarefas complexas e decisões ambíguas, integra os resultados e valida a entrega.

Ao chamar a ferramenta de subagentes, passe explicitamente o modelo correspondente e `fork_turns: none`, quando disponíveis. Use um `task_name` com letras minúsculas, números e sublinhados. Se a ferramenta oferecer `agent_type`, selecione o perfil correspondente.

Delegue com objetivo, escopo, limites de autorização e evidência esperada. Compartilhe apenas o contexto necessário e aguarde o resultado. Use paralelismo para tarefas independentes, com arquivos distintos quando houver edição. Responda diretamente a saudações, confirmações e pedidos de status que dispensem verificação.

Use o [índice para agentes](.agents/README.md) para abrir somente as instruções e referências relevantes para a tarefa.

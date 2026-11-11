# Mag.IA

Plataforma multi-tenant para atendimento WhatsApp, automação de conversas, CRM Kanban e agendamentos.

## Acessos locais

- Landing page comercial: <http://localhost:5174/>
- Plataforma/login: <http://localhost:5174/?app=1>

O parâmetro `app=1` abre a plataforma; remova-o para visualizar a landing page.

Nesta instalação, o Antigravity usa o MCP de Supabase em `~/.gemini/config/mcp_config.json`. Para configurar outra máquina, use o [exemplo sem credenciais](.agents/mcp_config.example.json) como referência e adicione a entrada ao arquivo global, preservando os demais servidores.

## Organização dos arquivos

- `app/`: frontend, landing page e painel.
- `n8n/sources/`: fontes canônicas dos workflows atuais.
- `n8n/workflows/`: workflows gerados.
- `n8n/archive/root-exports/`: exports históricos antes soltos na raiz, incluindo
  suas codificações originais; não são fontes operacionais.
- `scripts/`: ferramentas mantidas; `scripts/archive/` guarda patches históricos.
- `docs/archive/`: imagens e diffs históricos antes soltos na raiz.

## Estado do projeto

A plataforma reúne atendimento WhatsApp via Evolution API, conversas e envio manual no painel, CRM Kanban e agendamentos. O CORE do n8n compartilha o processamento dos turnos. As EXT aplicam as regras comerciais de cada operação com dados e configurações do Supabase.

- [Estado do código e dos tenants](docs/status/current_project_state.md)
- [Fontes canônicas](n8n/sources/) e [workflows exportados](n8n/workflows/)
- [Gerador do NORIA CORE e das EXT mantidas pelo build](scripts/build_noria_workflows.cjs)

## Desenvolvimento local

Consulte o [guia de ambiente local](docs/operations/local_runbook.md) para preparar a stack, executar os testes e trabalhar com os exports do n8n.

## Documentos principais

- [Índice da documentação](docs/INDEX.md)
- [Fluxo de versionamento](docs/operations/versioning_workflow.md)
- [Supabase](supabase/README.md)

## Segredos e Credenciais

Segredos reais nao devem ser salvos em documentacao:

- token do bot Telegram;
- token do Instagram/Meta;
- `SUPABASE_SERVICE_ROLE_KEY`;
- API key Gemini;
- chaves Evolution;
- `N8N_ENCRYPTION_KEY`.

Use `.env` local ou o gerenciador de variaveis do host de producao.

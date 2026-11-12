# Documentação do NORIA / Mag.IA

## Desenvolvimento

- [Estado do projeto](status/current_project_state.md)
- [Design System e estrutura CSS](architecture/design_system_modern_css_uiverse.md)
- [Ambiente local](operations/local_runbook.md)
- [Fluxo de versionamento](operations/versioning_workflow.md)
- [Regras para agentes](../AGENTS.md) e [personas de revisão](../.agents/README.md)
- [Supabase](../supabase/README.md) e [migrações](../supabase/migrations/)

## Workflows n8n

- [Fontes canônicas](../n8n/sources/) e [gerador dos workflows](../scripts/build_noria_workflows.cjs)
- [Exports disponíveis no repositório](../n8n/workflows/)
- [NORIA CORE compartilhado](../n8n/workflows/NORIA%20CORE%20_%20WhatsApp%20%2B%20Comandos%20%2B%20Follow-ups%20_%20Motor%20compartilhado%20v2.json) e [motor conversacional](../n8n/workflows/NORIA%20CORE%20_%20Motor%20conversacional.json)
- [Operação do CORE WhatsApp](operations/whatsapp_conversation_core.md)

Antes de uma publicação autorizada, confira no n8n os IDs e as versões ativas e compare com os artefatos locais.

## Operação

- [Conversas em tempo real e envio manual](operations/realtime_conversations_manual_replies.md)
- [Disparos e agendamentos](operations/broadcasts_and_appointments.md)
- [Follow-ups no WhatsApp](operations/whatsapp_follow_up.md)
- [Configuração de um tenant](operations/onboarding_tenant.md)
- [Checklist de publicação](operations/production_deploy_checklist.md)
- [Correções do Salon e da NB Bronze (12/11/2026)](operations/correcoes_salon_nubia_2026-11-12.md)

## Histórico

- [Registro de produção de 21/10/2026](operations/estado_producao_core_2026-10-21.md)
- [Histórico CORE × EXT de outubro de 2026](archive/core-ext-2026-10-18/)
- [Arquivos históricos](archive/)

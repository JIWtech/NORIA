# Checklist de publicação do NORIA

Publicação no n8n, migrações em produção e testes com WhatsApp real exigem autorização explícita. Siga o [fluxo de versionamento](versioning_workflow.md) para promover a versão aprovada.

## Antes da publicação

- [ ] Identificar tenants, serviços e contratos afetados. Registrar a revisão aprovada, a validação local e os passos de reversão.
- [ ] Conferir a versão ativa e os IDs do CORE, do motor e das EXT afetadas no n8n. Guardar os exports ativos em local restrito.
- [ ] Comparar os [exports](../../n8n/workflows/) com as [fontes](../../n8n/sources/) e revisar o diff das alterações pretendidas. Preservar credenciais, webhooks e referências entre workflows.
- [ ] Conferir o histórico de migrações do ambiente e a ordem das mudanças autorizadas. Validar os impactos em RLS e escopo por tenant.
- [ ] Para mudanças no painel, validar build, testes, autenticação e variáveis do ambiente.

## Depois da publicação autorizada

- [ ] Confirmar a versão ativa e os pontos de entrada afetados.
- [ ] Validar isolamento, persistência e comportamento do fluxo afetado em cenário controlado.
- [ ] Registrar evidências, horário, revisão e versão anterior. Em caso de regressão, seguir o rollback acordado para cada serviço afetado.

# Follow-ups no WhatsApp

O despachante de follow-ups faz parte do CORE compartilhado. Consulte os [exports atuais](../../n8n/workflows/) e a [implementação](../../n8n/code/whatsapp_follow_up_dispatch.js).

## Configuração e diagnóstico

- Confira a política aprovada no Supabase para o tenant e canal. Intervalos, habilitação e condições de envio dependem dessa política.
- Acompanhe a criação, elegibilidade, envio ou cancelamento do job. Cruze o histórico da conversa com estados de atendimento humano, agendamento e encerramento.
- Investigue entregas incertas antes de reprocessar. Valide idempotência e escopo entre tenants.
- Use a [suíte de follow-up da Gênesis](../../scripts/test_sales_follow_up.cjs) quando o cenário envolver vendas. Para publicação, siga o [checklist do NORIA](production_deploy_checklist.md).

# Follow-ups no WhatsApp

O despachante de follow-ups faz parte do CORE compartilhado. Consulte os [exports atuais](../../n8n/workflows/) e a [implementação](../../n8n/code/whatsapp_follow_up_dispatch.js).

## Regra de conteúdo

O follow-up da IA se adapta à última mensagem e ao contexto, conforme o system prompt do tenant. Quando o cliente recusa ou encerra a conversa, os follow-ups pendentes são cancelados e nenhum é enviado; quando apenas adia ("vou pensar", "te aviso"), os pendentes são mantidos e a IA envia uma retomada acolhedora, sem texto fixo no código.

## Configuração e diagnóstico

- Confira a política aprovada no Supabase para o tenant e canal. Intervalos, habilitação e condições de envio dependem dessa política.
- Acompanhe a criação, elegibilidade, envio ou cancelamento do job. Cruze o histórico da conversa com estados de atendimento humano, agendamento e encerramento.
- Investigue entregas incertas antes de reprocessar. Valide idempotência e escopo entre tenants.
- Vendas: por padrão o adiamento não gera retomada e o silêncio do cliente usa o texto configurado. O tenant pode escolher `sales_follow_up.disposition_actions.deferred_by_customer = "resume"` para que a IA escreva uma única retomada com o prazo da primeira etapa; as demais etapas da mesma âncora são canceladas. Exige a função de elegibilidade da proposta em `supabase/migrations_pending_review/sales_followup_resume_after_deferral_proposta.sql`.
- Use a [suíte de follow-up da Gênesis](../../scripts/test_sales_follow_up.cjs) quando o cenário envolver vendas. Para publicação, siga o [checklist do NORIA](production_deploy_checklist.md).

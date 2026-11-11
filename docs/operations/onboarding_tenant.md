# Configuração de um tenant

1. Levante a identidade da operação, o canal, os usuários do painel e a política comercial aprovada.
2. Modele os vínculos de usuários e recursos no [Supabase](../../supabase/README.md). Revise o escopo por tenant em dados, eventos e permissões.
3. Configure o canal WhatsApp em ambiente de teste e valide o vínculo entre instância e tenant. Guarde credenciais no ambiente autorizado.
4. Use o [CORE compartilhado](whatsapp_conversation_core.md). Quando houver regras comerciais específicas, configure a política do tenant no Supabase e confira o contrato da EXT correspondente.
5. Homologue com fixtures ou ambiente isolado. Confira entrada, resposta, envio manual, handoff e o comportamento de agendamento ou vendas aplicável.
6. Registre as evidências, a configuração aprovada e o rollback. Para ativação em produção, siga o [checklist de publicação](production_deploy_checklist.md).

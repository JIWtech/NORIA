---
name: security-and-hardening
description: Revisa isolamento multi-tenant, autorização e proteção de dados em mudanças no NORIA.
---

# Segurança e isolamento

Siga o [AGENTS.md](../../../AGENTS.md).

1. Identifique as fronteiras afetadas, como painel, comandos do n8n, webhooks, Evolution API, Supabase e armazenamento.
2. Confirme a autorização no servidor. Valide vínculos entre usuário, tenant e recurso em consultas, RPCs, RLS, eventos Realtime e filas.
3. Verifique segredos, dados pessoais, URLs de mídia, logs e respostas de erro. A service role e as credenciais das integrações ficam no servidor.
4. Em mudanças no diálogo, confira se o Gemini interpreta entradas e se a decisão comercial vem da EXT com dados autorizados do Supabase.
5. Registre evidências e medidas defensivas. Use fixtures sintéticas para regressões de autorização e escopo.

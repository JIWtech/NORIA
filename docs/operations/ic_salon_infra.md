# I&C Salon: infraestrutura e ativação

Tenant `ic_salon` (id `76aff8a0-0466-42b9-a80d-db186ff3d8bd`), instância Evolution `ic_saloon`, caminho `saas_dynamic`
(nenhum workflow do n8n precisa ser alterado). **Os valores secretos não ficam no repositório**: peça ao responsável pelo
onboarding ou veja o cofre da equipe. Aqui estão só os nomes e onde cada um vai.

## Variáveis no n8n **e** no n8n-runner (reiniciar os dois)

| Variável | Valor |
|---|---|
| `EVOLUTION_API_URL_IC_SALON` | URL base da Evolution (a mesma dos outros clientes) |
| `EVOLUTION_API_KEY_IC_SALON` | token da instância `ic_saloon` |
| `EVOLUTION_INSTANCE_IC_SALON` | `ic_saloon` |
| `NORIA_INGRESS_FORWARD_TOKEN_IC_SALON` | segredo de encaminhamento (o mesmo de `NORIA_INGRESS_FORWARD_TOKEN` do ingresso) |

O sufixo vem do slug em maiúsculas (`ic_salon` → `IC_SALON`).

## Serviço `noria-ingress-ic-salon` (Easypanel)

Comando: `node scripts/turn_queue_operational_bridge.cjs ingress` · porta do domínio: **8080** · `GET /healthz` = `{"status":"listening"}`.

`NORIA_TENANT_ID`, `NORIA_SUPABASE_URL`, `NORIA_SUPABASE_PUBLISHABLE_KEY`, `NORIA_BRIDGE_HTTP_TIMEOUT_MS=30000`,
`NORIA_INGRESS_EMAIL`, `NORIA_INGRESS_PASSWORD`, `NORIA_INGRESS_SOURCE_ID`, `NORIA_INGRESS_INSTANCE=ic_saloon`,
`NORIA_INGRESS_FORWARD_URL` (webhook de produção do n8n, `/webhook/magia-whatsapp`), `NORIA_INGRESS_FORWARD_TOKEN`,
`NORIA_INGRESS_SIGNING_SECRET`, `NORIA_INGRESS_PROVIDER_TOKEN`, `NORIA_INGRESS_BIND=0.0.0.0`, `NORIA_INGRESS_PORT=8080`,
`NORIA_INGRESS_MAX_BYTES=26214400`.

## Ordem de ativação

1. Variáveis acima nos dois serviços do n8n, reinício dos dois.
2. Serviço de ingresso no ar e `/healthz` respondendo.
3. Instância conectada (`GET /instance/connectionState/ic_saloon` → `open`) e `groupsIgnore: true`.
4. Rodar `clients/ic_saloon/04_ativar.sql`.
5. Conectar o webhook da instância: URL `https://<domínio do ingresso>/ingress`, header
   `Authorization: Bearer <NORIA_INGRESS_PROVIDER_TOKEN>`, evento `MESSAGES_UPSERT`. Reler a configuração depois de salvar.
6. Testar com um número de teste.

Desligar: `ai_enabled=false`, `whatsapp_processing_mode='disabled'` e `enabled=false` na fonte de ingresso.

## Banco

`supabase/migrations/030_appointment_outcomes_no_show.sql` (rollback em `migrations_pending_review/`), depois
`clients/ic_saloon/02_ajustes_pos_revisao.sql` e `03_remover_conta_suporte.sql`.
Teste local da migração: `MAGIA_TEST_MODULES=<pasta com @electric-sql/pglite> node --test scripts/test_appointment_outcomes.cjs`.

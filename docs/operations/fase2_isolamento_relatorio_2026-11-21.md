# Fase 2 — isolamento do painel e propostas SQL

Implementação local em `C:\noria-wt-ref2`, branch `refactor/fase2-isolamento`, em 21/11/2026. Sem commit, push, publicação, aplicação de migração, instalação de dependência ou escrita em produção. Os exports foram copiados da pasta autorizada para `n8n/workflows/` desta worktree somente para executar os testes; as origens não foram alteradas.

## Mudanças por arquivo

As linhas indicam o início de cada mudança principal na versão local final.

| Arquivo:linha | Mudança e motivo |
| --- | --- |
| `app/src/services/agents/teamAgentManagement.js:1` | Resolve tenant pelo slug antes das escritas. Insert inclui `tenant_id`; update/delete filtram ID e slug do tenant. O epoch impede fallback de sessão anterior de recriar localStorage. |
| `app/src/services/agents/teamAgentReads.js:1` | Descarta leitura pendente após limpeza, antes de retornar dados ou escrever localStorage. Corrida reproduzida em teste. |
| `app/src/services/broadcasts/broadcastOperations.js:8` | Factory recebe `getTenantSlug`; consultas e alterações diretas de campanhas/destinatários filtram `tenant_id`, inserts já incluem o ID. Rejeita patch que troque tenant. Verifica pertencimento antes das RPCs existentes. Ausência de tenant falha fechada. |
| `app/src/features/broadcasts/components/Broadcasts.jsx:68` | Fornece slug atual à factory e recria a instância ao mudar o tenant, evitando closure com escopo anterior. |
| `app/src/dataService.js:192` | Não abre canais sem slug e ID resolvidos; agendamentos e campanhas sempre têm filtro de tenant. |
| `app/src/dataService.js:365` | Preserva exports de criação; mutações da fachada recebem slug explícito: `updateBroadcastCampaign(id, patch, tenantSlug)` e `updateBroadcastRecipient(campaignId, chatId, patch, tenantSlug)`. |
| `app/src/services/tenants/tenantScopedCaches.js:1` | Centraliza os sete Maps de dados/cache, limpa mídia, remove somente `magia:team-agents:*` e avança epoch de invalidação. |
| `app/src/services/tenants/tenantDataReads.js:3` | Cache de lookup por cliente Supabase e slug, TTL de 60 s; sem cache de resultado ausente/erro. Resultados anteriores à limpeza são descartados. |
| `app/src/app/App.jsx:76` | Integra limpeza única no logout explícito, evento SIGNED_OUT e troca de usuário, junto de `clearAppDataCache` (linhas 356, 809 e 836). |
| `app/src/app/App.jsx:880` | Recargas verificam epoch e escopo antes/depois do await; protege logout/login no mesmo usuário e tenant. |
| `app/src/app/App.jsx:1070` | Efeito de Realtime aguarda `tenantId` do escopo atual antes de assinar. |
| `app/src/features/conversations/components/Conversations.jsx:93` | Histórico completo usa Map central; retorno assíncrono verifica epoch antes de guardar histórico (linha 478). |
| `app/src/features/appointments/components/Appointments.jsx:44` | Agenda usa cache central e impede repopulação por efeito cancelado ou sessão anterior. |
| `app/src/features/appointments/utils/useDepositRequired.js:3` | Cache de sinal usa ciclo de vida central e descarta retorno antigo/cancelado. |
| `app/src/services/catalog/catalogReferrals.js:3` | Centraliza produto e cooldown de atualização; checa epoch antes de preencher cache, iniciar atualização tardia ou emitir evento. |
| `app/src/services/conversations/conversationPresentation.js:38` | Cache de detalhes de localização passa a integrar a limpeza central. |
| `app/tests/unit/phase2TeamMutations.test.js:1` | Testa resolução, payload e filtros de tenant de agentes. |
| `app/tests/unit/phase2BroadcastMutations.test.js:1` | Testa escopo/filtros, preflight sem acesso ao tenant e propagação do slug pela fachada real. |
| `app/tests/unit/phase2TenantLifecycle.test.js:1` | Exercita assinatura real com cliente simulado, limpeza dos Maps/localStorage, TTL, invalidação de lookup e leitura de agentes pendentes; verifica integração em App. |
| `app/tests/architecture/serviceExtraction6b24.test.js:9` | Atualiza fixtures para fornecer tenant e lookup; preserva verificações anteriores. |
| `app/tests/features/settings.test.js:60` | Fixture simula resolução de tenant, mantendo o teste de filial/turno vazios. |
| `app/tests/features/broadcastServerQueue.test.js:7` | Fixture inclui tenant ativo e preflight; preserva consentimento, RPCs e propagação de erro. |
| `app/tests/unit/broadcastIdempotency.test.js:13` | Fixture inclui slug e `tenant_id` nos registros, mantendo os cenários de lease, timeout, cancelamento e imutabilidade de sent. |
| `supabase/migrations_pending_review/README.md:1` | Inventário por arquivo com classificação, evidência local e referências de scripts/testes; nenhuma movimentação. Registros históricos não são atestação atual de produção. |
| `supabase/migrations_pending_review/fase2_boundary.PROPOSAL.sql:1` | Somente proposta: conhecimento fail-closed e appointment outcomes controlados por booleano JSON `appointment_outcome_tracking`; habilita Salon via configuração preservando outras chaves. Não muda fórmulas de boundary/session. |
| `supabase/migrations_pending_review/fase2_boundary.ROLLBACK.PROPOSAL.sql:1` | Rollback proposto, com pré-condições, restaura funções/configuração do baseline. Não executado. |
| `scripts/test_fase2_boundary_proposal.cjs:1` | PGlite executa funções, proposta/rollback e consultas de fronteira extraídas das fontes reais. |
| `docs/operations/fase2_boundary_analysis.md:1` | Evidências, exemplos de fronteira, pré-condições e limites da proposta SQL. |
| `docs/operations/fase2_isolamento_relatorio_2026-11-21.md:1` | Este relatório de entrega e validação local. |

## Validação executada

| Comando | Resultado |
| --- | --- |
| `npm test` em `app/` | **962/962**, sem falhas ou skips na última execução. |
| `npm run build` em `app/` | Tentado; EPERM ao gravar temporário Vite em `node_modules/.vite-temp`, que pertence à junção fora da worktree. |
| `npm run build -- --configLoader runner` em `app/` | **Passou** na versão final. Mantém avisos de chunk grande e import estático/dinâmico de integration.js. Nenhuma instalação ou alteração da junção. |
| `node scripts/validate_noria_release.cjs` | **698/698** após copiar os exports autorizados para a worktree. Antes das cópias houve falhas por exports ausentes. |
| `node scripts/audit_anti_hardcode.cjs` | **Passou**, sem novos padrões fora do baseline documentado. |
| `$env:MAGIA_TEST_MODULES = 'C:\noria-wt-ref2\app\node_modules'; node --test scripts/test_fase2_boundary_proposal.cjs scripts/test_appointment_outcomes.cjs` | **10/10**. A variável usa a dependência existente; sem ela o teste antigo procura um diretório temporário inexistente. |
| `git diff --check` | **Passou**. |

Os testes novos reproduziram a assinatura sem tenant, a ausência de filtros em mutações, o repovoamento de localStorage por leitura pendente e a fachada sem propagação do escopo antes das respectivas correções. O teste SQL reproduz o fail-open anterior e valida a nova proposta. Os testes de ciclo de vida incluem comportamento com clientes simulados e verificações de integração do código; não constituem validação E2E de navegador ou sessão real.

## Boundary/session: resultado

As fórmulas coincidem com eventos consistentes e no fallback `initial`. A consulta de `magia_claim_turn` filtra por `tenant_slug` (`turn_queue_closure_recovery_v1.sql:189`), enquanto `magia_sales_move` filtra por `tenant_id` (`025_sales_capability.sql:124`).

No mesmo chat, o evento A (`aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`) pertence ao tenant A e o evento B mais recente (`bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`) tem ID do tenant B mas slug do A. Claim escolhe B; sales escolhe A. Com slug renomeado, claim pode retornar `initial`, enquanto sales conserva A. Isso pode causar fronteiras distintas, rejeição `SALES_SESSION_CLOSED` ou uso de fronteira de outro tenant. É demonstração sintética da divergência, sem evidência de incidente ou dado inconsistente em produção. As funções existentes não foram alteradas. Detalhes no documento de análise.

## Limites, riscos e reversão

- O preflight de RPC é separado da escrita: não substitui RLS nem autorização transacional na função SQL. Nenhuma RPC, política ou grant de produção foi alterado.
- A proposta exige baseline exato de funções e chave de configuração do Salon ausente; aborta transacionalmente se houver divergência. Deve ser adaptada/revisada após leitura autorizada do estado real, antes de eventual aplicação. Nenhuma alteração de schema foi aplicada.
- PGlite substitui pgvector por domínio/operador escalar para testar o predicado; não valida extensão pgvector real, índices, privilégios, RLS, concorrência ou produção.
- O rollback SQL proposto restaura o fail-open anterior e exige avaliação desse risco; adoção posterior da configuração por outros tenants também exige revisão da reversão.
- Lookup pode reutilizar metadados por até 60 segundos; logout e troca de usuário invalidam imediatamente. As duas mutações de broadcast da fachada agora exigem slug explícito; chamadas locais de interface usam factory com tenant atual e os testes preservam a lista de exports públicos.
- Não houve commit, push, merge, publicação, migração aplicada, WhatsApp real ou escrita em produção. Não houve instalação de dependências, movimentação de migrações antigas ou edição dos exports originais.
- Reversão local: retirar seletivamente os hunks desta entrega e os arquivos novos, preservando qualquer alteração posterior de terceiros. Não há reversão de produção a executar, pois nada foi aplicado. Exports locais copiados e `app/dist` são artefatos de validação ignorados pelo Git.

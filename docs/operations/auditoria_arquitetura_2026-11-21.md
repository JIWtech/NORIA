# Auditoria de arquitetura e qualidade de código (2026-11-21)

A auditoria foi feita pelo Gemini (modelo Argon), só com leitura do repositório no branch `dev`. O orquestrador (Claude) conferiu os achados principais no código e no banco de produção. As marcações abaixo seguem esta legenda:
- **[conferido]**: verificado diretamente pelo orquestrador;
- **[corrigido]**: a gravidade foi ajustada depois da conferência;
- **[hipótese]**: ainda falta verificar.

## Resumo

O núcleo recente é sólido: contrato CORE × EXT por fases, fila de turnos com fencing e auditoria determinística mais semântica. O passivo está concentrado em quatro pontos:
- **Três monólitos [conferido]:**
  - `n8n/sources/noria_core.js`, com 16.693 linhas. Só o pipeline `sales_v1` ocupa cerca de 8,9 mil delas.
  - `clients/ic_saloon/salon_engine.js`, com 15.353 linhas. É um clone do CORE, e grande parte do código pertence a outros tenants.
  - `app/src/app/App.jsx`, com 1.503 linhas e 42 hooks.
- **Duplicação sistêmica de utilitários**, com divergências pequenas entre as cópias:
  - normalização de texto (NFD, em 19 lugares);
  - casamento de instância WhatsApp (11);
  - telefone e JID;
  - fuso e expediente;
  - clientes HTTP do Supabase e do Gemini;
  - reserva de cota do Gemini;
  - validação do envelope EXT → CORE.
- **Hardcodes de tenant em código compartilhado [conferido]:**
  - "wesley" em regex do CORE (`noria_core.js:10541`, `:13802`);
  - perfil `nb_bronze_v1` no contrato do CORE (`:82`);
  - `tenantSlug !== 'ic_salon'` em `n8n/code/command_router.js:746`;
  - `slug = 'ic_salon'` em SQL.
- **Build e testes frágeis:**
  - o gerador altera a própria fonte `noria_core.js` (metadados de build) e injeta código em workflows por `indexOf`/`replace`;
  - parte dos testes só confere o texto do código-fonte por regex;
  - `audit_anti_hardcode.cjs` só audita `noria_core.js` e `genesis_extension.js`.

## Ajustes da conferência

- **A4, isolamento no front:** `team_agents` e `broadcast_campaigns` gravam pelo `id`, sem `tenant_id` explícito **[conferido]**. Não há vazamento entre tenants, porque o RLS do banco (membro ativo do tenant) bloqueia. Isso foi conferido mais cedo nas 28 funções e nas políticas. Fica como defesa em profundidade, de prioridade média, e não crítica.
- **M5, `match_ai_knowledge`:** o código é fail-open quando o filtro de tenant não é enviado. Mas a função **não pode ser executada por `anon` nem por `authenticated`** em produção, só pelo `service_role` **[corrigido]**. Risco baixo.
- **C4, migrações:** a pasta `migrations_pending_review/` mistura migrações já aplicadas, rollbacks e propostas. As versões aplicadas em produção, como `20261119193054`, não batem com os nomes locais, como `20261119140000` **[conferido]**. É deriva de documentação e rastreio, não de banco.
- **C5, `session_id`/`boundary_id`:** a divergência de cálculo entre `magia_claim_turn` e as RPCs de `sales_leads` ainda é **[hipótese]**. Precisa de teste antes de qualquer mudança.

## Plano em fases (incremental, sem reescrever tudo)

1. **Proteções, testes e build (P, risco baixo):**
   - Estender `audit_anti_hardcode.cjs` a todas as EXTs, ao `noria_retail.js` e ao `salon_engine.js`, e `validate_noria_release.cjs` aos testes de retail e do Salon.
   - Criar `scripts/lib/core_test_harness.cjs` para reunir o carregamento repetido do CORE nos testes.
   - Trocar os testes que só conferem texto do código por testes de comportamento.
   - Fazer o gerador parar de alterar a fonte e eliminar o `indexOf`/`replace` em JSON.
   - Corrigir o `build_manifest.json`: remover a referência ao arquivo morto `noria_router_core.js` e registrar os hashes de todas as fontes.
2. **Isolamento e higiene de SQL (P/M):**
   - `tenant_id` explícito nas gravações do front.
   - Realtime só depois de o `tenantId` estar resolvido.
   - Limpar os 5 caches de módulo no logout.
   - Organizar `migrations_pending_review/` em aplicadas, rollbacks e propostas.
   - Migração para revisar: `boundary_id` único, tirar `ic_salon` do SQL e `match_ai_knowledge` fail-closed.
3. **Fronteira CORE × EXT e utilitários compartilhados (M):**
   - Criar `n8n/sources/shared/` (texto, identidade e instância, JID, fuso e expediente), projetado pelo gerador.
   - Tirar "wesley", `nb_bronze_v1`, `PREVIOUS_SERVICE_CUSTOMER` e `ic_salon` do código compartilhado, passando a usar sinais do contrato (por exemplo, `handoff.auto_assign`).
4. **Salon e CORE modular (M/G, risco médio):**
   - Podar de `salon_engine.js` os blocos inalcançáveis para o Salon (Telegram, Núbia `canonical_v2`, `services_v1` e `sales_v1`). Isso leva o arquivo de cerca de 15,3 mil para cerca de 3,7 mil linhas, validado pelos testes do Salon.
   - Separar `noria_core.js` em `core/services_pipeline`, `core/retail_pipeline` e `core/sales_pipeline`, compostos só pelo gerador e mantendo a mesma topologia no n8n.
5. **Front (M):**
   - Extrair de `App.jsx` os hooks de mutação do Kanban, de atribuição de atendente e de leitura.
   - Tirar a leitura de `localStorage` de dentro de `services/kanban`.
   - Unificar a transformação entre a carga inicial e o Realtime.
   - Limpar o CSS morto (já previsto na Fase 3 do plano do painel).

## Não mexer agora

- Migrar o Salon para `services_v1`.
- Migrar para TypeScript, Redux ou React Router.
- Mudar a topologia dos workflows no n8n.
- Renomear as RPCs `magia_*` ou apagar tabelas legadas.
- Remover o caminho de reversão da Núbia v1.

O relatório completo do Gemini, com arquivo:linha de cada achado e a tabela das 11 duplicações, está nos arquivos temporários da sessão. Os pontos acionáveis estão resumidos acima.

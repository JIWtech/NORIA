# NORIA — correções aplicadas em produção em 24/10/2026

Autorização do usuário: corrigir pendências, transferir regras da Gênesis do CORE para o EXT, validar, aplicar migrations necessárias e publicar. Projeto Supabase: `gfwwawazivmuqyctjsxj`. Horários abaixo em Brasília (UTC−3).

## Resultado publicado

- O motor usa capacidades e contratos fornecidos pelo EXT. Não contém decisões por `wesley_automoveis`, tabela privada de estoque, revisão comercial de avaliação nem instruções de redação específicas da Gênesis.
- As 44 instruções da geração primária e a instrução do redator foram transferidas para o EXT. O motor valida identidade, origem, versão e estrutura do contrato antes de executar a decisão comercial.
- O EXT fornece tabela de estoque, semântica de status, fontes autorizadas de preço, política normalizada de avaliação, serviço declarado e apresentação do catálogo. Supabase continua sendo a fonte das configurações comerciais.
- Serviço declarado tem confirmação e encaminhamento próprios, sem inventar pedido explícito de atendente ou aplicar silêncio de pós-venda indevidamente. A disponibilidade com parceiros permanece condicional à verificação da equipe.
- Respostas sem contrato ou vazias para um pedido textual têm uma única regeneração antes de aplicar estado. Respostas delegadas ao EXT, silêncio de pós-venda e envio exclusivo de fotos preservam seus contratos. Falha repetida permanece bloqueada; a auditoria factual não foi afrouxada.
- Foi removida a preferência por nome de operador. A seleção usa configuração e operadores ativos do tenant.
- Foi corrigido o acesso a `resolvedYear` antes de sua inicialização. A interpretação de troca e de ano ambíguo não sobrescreve a decisão comercial do EXT no motor.
- Erros PostgREST encapsulados em JSON são classificados sem perder o token técnico. Origem humana não comprovada continua exigindo evidência; não foram fabricadas autorizações históricas.
- O builder antigo de follow-up chama a geração canônica. O publicador agora executa a regressão obrigatória antes de qualquer escrita e verifica alterações concorrentes.

O roteador de entrada conserva seus vínculos técnicos entre tenants e respectivos EXT. Esses vínculos não contêm política comercial e não foram alterados nesta publicação.

## Workflows ativos conferidos

| Workflow | ID | Versão ativa final |
|---|---|---|
| EXT Gênesis | `fXGorIlPbyf9Qtsp` | `20a16eae-29f7-41c9-ac56-928a08d3e44d` |
| Motor compartilhado | `mlKNPv862H2g3Gap` | `c3d331db-63a1-4068-bf9c-8333dd147b52` |
| Entrada CORE, preservada | `3N5oN6sxtir9lFrA` | `e95f9020-a88f-4603-b1e4-8ce225293c4a` |
| EXT Núbia, preservado | `vCDXJLqIBCZJRTVv` | `5d545c63-9e38-4325-aa2a-b6bf93ecd546` |

Em todos os quatro, `activeVersionId === versionId` e o código normalizado coincide com o arquivo local. Conexões conferidas. Nos workflows modificados, os IDs, credenciais, demais nós e settings de produção foram preservados, inclusive `availableInMCP` do motor.

Hash canônico do CORE final: `4ac2b992096a70f92d0ba616ba8d560075db7eb684f822db559fddd4652dc07b`.
Hash canônico do EXT: `ec6258bea5a7b8220093f2a06593576d84168c5e2bbd53f5892f50dd5e00de1e`.
SHA-256 normalizado do nó ativo do motor: `4dea2f76f293965481fc56255dccf47f9bc420c958145d7cd319f1d9b7a39e45`.

Publicação inicial: 11:41. Ajuste final do motor: 11:50:01.

## Migrations aplicadas e verificadas

Os nomes e versões abaixo foram lidos do histórico remoto. Os arquivos locais usam as mesmas versões.

| Versão | Nome | Efeito validado |
|---|---|---|
| `20261024143850` | `pending_runtime_dependencies` | `sales_leads` no Realtime com identidade completa e RLS preservada; cancelamento de follow-up para recusa/encerramento conforme configuração |
| `20261024143855` | `safe_tenant_onboarding` | RPC de onboarding ausente passa a existir; exige usuário real, cria workspace idempotente, IA desabilitada e canal pendente |
| `20261024143901` | `kanban_column_order_rpc` | Ordenação atômica restrita a `service_role`; valida o conjunto de colunas do quadro correto |
| `20261024143922` | `sales_followup_configured_stages` | Elegibilidade respeita etapas com IA permitida, sessão, exclusões, controle humano e espera pelo cliente, sem depender do nome de uma regra de 20% |

A ordenação tinha um defeito na proposta antiga: o `FULL JOIN` incluía colunas de outros quadros na validação. A consulta agora filtra tenant e quadro antes do join. A proposta 023 também foi corrigida para uma instalação futura.

A proposta 029 foi substituída pela implementação segura, evitando cópia do perfil de um cliente para novos workspaces. As migrations antigas de ciclo de turnos, já aplicadas ou superadas em produção, não foram reaplicadas. Arquivos de rollback não foram executados.

Permissões: onboarding não é executável por `anon`; exige `auth.uid()` válido. As duas RPCs de serviço não são executáveis por `anon` nem `authenticated`. `search_path` fixado em `public, pg_temp`. A política SELECT de `sales_leads` exige vínculo ativo do usuário ao tenant.

## Validação

- `node scripts/validate_noria_release.cjs`: 191 testes direcionados aprovados, zero falhas. Inclui CORE/EXT, serviço com confirmação, silêncio autorizado, mídia, identidade, reserva, recuperação de resposta e horário de follow-up.
- A nova regressão SQL executa a migration real no PGlite: reproduz o bloqueio anterior da etapa morna com a regra de 30%, verifica a correção e testa isolamento, recusa, IA bloqueada, interesse registrado, nova mensagem e papel não autorizado.
- Teste transacional no Supabase: rejeição de acesso sem autenticação, criação de workspace com IA desabilitada, retry idempotente e ordenação com outros quadros existentes. Conjunto inválido de colunas rejeitado. Todos os dados de teste sofreram rollback; zero workspaces temporários remanescentes.
- O código ativo do EXT foi executado em leitura contra a configuração real do Supabase. O código ativo do CORE aceitou o contrato resultante, incluindo as 44 instruções e a política de avaliação normalizada.
- Regeneração idempotente validada. `git diff --check` limpo. Busca de padrões de segredos no diff sem ocorrências.
- Suíte ampla: 70 arquivos, 590 testes, 412 aprovados, 168 falhas legadas e 10 ignorados. As falhas incluem fixtures e expectativas antigas, dependências de banco/ambiente e suítes fora do contrato atual. Esse conjunto permanece pendente e não é tratado como aprovado. Frontend não foi alterado nesta rodada; nenhum deploy Vercel foi realizado por estas mudanças.
- `npm audit --json` em `app/`, após o push: zero vulnerabilidades na branch `dev`. O GitHub anunciou seis alertas na branch padrão `main` (dois altos, três moderados e um baixo). Conferência de `origin/main` mostrou lockfile diferente: por exemplo, Vite 6.4.3 em `main` e 6.4.5 em `dev`. Os alertas da branch padrão não foram declarados resolvidos nem houve promoção automática para ela. [Alertas do GitHub](https://github.com/JIWtech/NORIA/security/dependabot).

## Observação de produção e pendências históricas

Às 11:53:21: zero eventos com erro técnico desde a publicação inicial e desde a final; 10 eventos registrados após a final. Consulta separada de execuções n8n encontrou zero `error` e zero `crashed` desde a publicação inicial. Erros tratados no Supabase foram conferidos separadamente dos estados do n8n.

Houve resposta orgânica da Núbia após a publicação, registrada às 11:51:47 sem erro. Não foi enviado WhatsApp de teste. Ainda não foi observada nessa janela uma nova resposta de venda da Gênesis produzida pelo motor final; entradas registradas estavam sob bloqueio de atendimento humano. Isso limita a validação do comportamento do Gemini em tráfego real da Gênesis.

Desde o corte anterior de 01:15, a consulta de follow-ups enviados não encontrou envio entre 21:00 e 06:00 no timezone do tenant.

A conversa histórica da Hornet continua em `review`, com ticket `50459472-b037-4329-b0fc-59a4cd7dfd81`, notificação pendente e sem resposta posterior registrada. A primeira candidata estava vazia; o reparo tentou um fato sem suporte e foi bloqueado. A correção nova trata a candidata vazia antes da aplicação de estado, mas não reenvia automaticamente esse histórico. As filas antigas não foram liberadas em massa.

Os três incidentes anteriores da Núbia tinham controle humano sem origem atestada; a proteção de origem permanece. Os outros dois incidentes antigos da Gênesis já tinham resposta humana posterior. O caso de cor desconhecida continua protegido: `NULL` não comprova cor, e a IA não pode inventá-la.

Advisories Supabase: permanecem avisos sobre `unaccent` no schema público, proteção de senha vazada desabilitada e funções `SECURITY DEFINER` acessíveis a autenticados. O novo onboarding adiciona um aviso dessa última categoria por ser intencionalmente acessível a usuários autenticados e validar identidade/propriedade. Não foram abertos acessos anônimos nem políticas permissivas para silenciar avisos. Referências: [funções privilegiadas](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [senhas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Ocorrência durante a aplicação

Uma ampliação intermediária da recuperação vazia foi publicada por engano antes de conferir uma falha do teste de serviço delegado. Ficou ativa aproximadamente de 11:48:37 a 11:49:02 e foi revertida imediatamente para o código anterior validado. A consulta de eventos nessa janela não retornou conversas. A exceção de resposta delegada foi corrigida, todos os 191 testes passaram e só então o motor final foi publicado. A barreira de regressão foi incorporada ao publicador para evitar repetir essa sequência.

## Backups e rollback

Backups locais ignorados pelo Git:

- `.local/deploy_backups/2026-10-24T14-41-23-452Z/`: versões originais do EXT e motor, com recibos de verificação.
- `.local/deploy_backups/2026-10-24T14-48-35-841Z/`: motor validado antes da tentativa intermediária.
- `.local/deploy_backups/2026-10-24T14-49-58-970Z/`: motor validado anterior ao ajuste final, com recibo do motor final.
- `.local/noria_20261024_database_rollback.sql`: rollback das quatro alterações do banco, preparado e não executado.
- `docs/archive/reports/noria_20261024_production_prestate.json`: pré-estado das configurações alteradas e função anterior de follow-up.

Para rollback do n8n: ler novamente a versão ativa, recusar alterações concorrentes e restaurar somente o código dos nós previstos a partir do backup. Se reverter ambos, restaurar o motor antes do EXT, preservando conexões, IDs, credenciais e settings vigentes. Após PUT, conferir versão ativa e conteúdo. Um rollback do banco exige revisar alterações posteriores e o pré-estado; nunca excluir workspaces reais ou liberar filas como parte da reversão.

Commits de implementação: `eb59e32` (CORE/EXT), `a013381` (Supabase) e `74d0979` (resposta vazia e barreira de publicação). Documentação inicial consolidada em `c04da77`. Push para `origin/dev` confirmado; repositório local sincronizado. Não houve promoção de branch estável com a suíte ampla falhando.

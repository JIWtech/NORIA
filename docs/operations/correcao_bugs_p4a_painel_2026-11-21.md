# Correção dos bugs P4A do painel — 2026-11-21

Worktree: `C:\noria-wt-p4a`, branch `fix/bugs-p4-painel-a`, baseada em `dev`.

Foram conferidos `AGENTS.md`, `.agents/README.md`, `bugs_investigacao_2026-11-21.md`, o relatório original `scratchpad/gemini_bugs_out.txt` e as implementações atuais. Oito itens foram confirmados e corrigidos; A16 foi descartado como falso positivo no cenário descrito. Não houve commit, push, instalação de dependências, publicação, migração, envio de WhatsApp ou acesso a dados de produção.

Nenhuma alteração em `features/dashboard/`, `features/broadcasts/` ou `RecentConversationsTable`. As referências abaixo são relativas à raiz do worktree.

## A1 — indicador de atualização preso: real

- **Causa:** `refreshData` acionava `setLoading(true)`, mas seu `finally` só encerrava o indicador se o escopo e a época de cache continuassem válidos. Trocar a empresa ou encerrar a sessão invalidava a resposta, deixando o indicador ligado.
- **Correção:** `app/src/app/App.jsx:177`, `:553`, `:628`, `:721`: token por atualização manual; o `finally` encerra apenas o indicador que ele próprio iniciou, mesmo se a resposta já estiver obsoleta. Um efeito limpa os indicadores quando muda o escopo/acesso, sem esperar a rede. A prontidão dos dados continua protegida por escopo.
- **Teste:** `app/tests/unit/appRefreshAndTeamP4a.test.js:49`, `:62`, `:72`. Execução das funções reais extraídas do AST, com promises controladas: troca A→B e logout com atualização pendente, resposta antiga sem alterar prontidão, preservação de atualização mais nova e limpeza imediata no efeito. Antes da correção, os dois testes de invalidação falharam (`true !== false`); depois passaram.

## A3 — card duplicado após movimento: real

- **Causa:** entre quatro e cinco segundos, a filtragem podia aceitar a posição do servidor, mas o passo de reinserção ainda reaplicava o movimento confirmado na coluna antiga. Revisão igual ou superior à confirmada já podia prevalecer no servidor.
- **Correção:** `app/src/services/kanban/pendingKanbanMoves.js:95`: identifica movimentos superados antes de montar as colunas e usa a mesma decisão tanto na filtragem quanto na reinserção.
- **Teste:** `app/tests/unit/kanbanTeamRegression.test.js:7`, `:15`. O teste inicial falhou com card nas duas colunas e passou após a correção. Cobertura complementar para revisão igual a 3.900 ms e 4.500 ms, além de revisão superior.

## A4 — comparador não transitivo: real

- **Causa:** retornar zero sempre que um dos lados não tinha data equiparava o card sem atividade tanto ao mais antigo quanto ao mais novo, apesar de os dois últimos serem ordenados entre si.
- **Correção:** `app/src/services/kanban/applyIncomingEvent.js:331`: datas válidas ficam em ordem decrescente; ausentes/inválidas ficam depois, com ordem estável entre elas.
- **Teste:** `app/tests/unit/kanbanTeamRegression.test.js:25`, `:30`. Antes, a sequência antigo/sem data/novo não era ordenada corretamente; depois passou. As seis permutações, data inválida e preservação do array de entrada também foram verificadas.
- **Limite:** não foi alterada a política de atualização de atividade por eventos Realtime antigos; esse é outro problema possível, não necessário para corrigir o comparador.

## A6 — persistência de atendentes e ações concorrentes: real

- **Causa:** o serviço convertia falhas de inclusão em um agente `local-…` e ignorava os erros retornados por update/delete. O App mudava as duas listas antes da confirmação, sem recuperar o estado em caso de falha. Ações repetidas podiam gerar requisições concorrentes.
- **Correção do serviço:** `app/src/services/agents/teamAgentManagement.js:4`, `:14`, `:26`, `:35`: exige conexão e tenant resolvido, propaga erros de persistência e remove o fallback fictício/local. Os filtros de tenant e ID foram preservados.
- **Correção do App:** `app/src/app/App.jsx:384`, `:402`, `:430`, `:1182`: trava síncrona por escopo/agente (compartilhada entre exclusão e status), persistência antes da alteração das duas listas e erro visível. Como o estado confirmado é preservado até o sucesso remoto, a falha dispensa rollback otimista. Respostas de um escopo diferente são descartadas.
- **Correção do formulário:** `app/src/features/settings/components/SettingsPage.jsx:41`, `:109`, `:385`, `:531`, `:541`: trava síncrona no submit, mensagem de erro com preservação dos campos e botões desabilitados enquanto a ação está pendente. `SettingsPage` já era remontado com `key={scopeKey}`.
- **Teste:** `app/tests/unit/kanbanTeamRegression.test.js:42` verifica rejeição de insert/update/delete. `app/tests/unit/appRefreshAndTeamP4a.test.js:107`, `:146` executa os handlers reais e verifica falha, sucesso, bloqueio de duplo clique e descarte da resposta de outra empresa. Antes da correção, a persistência não rejeitava, duas chamadas eram enviadas e o estado era alterado antecipadamente. Depois, todos passaram.
- **Limite:** update/delete que retornem zero linhas sem erro continuam indistinguíveis de sucesso pelo contrato atual do serviço; não foi feita alteração de schema/RLS. A trava é local ao painel, sem garantia de idempotência entre abas.

## A14 — falso erro de login durante hidratação: real

- **Causa:** o hook tratava falta temporária de `tenantId` e falta de `userId` como a mesma situação de sessão ausente.
- **Correção:** `app/src/features/notifications/useNotifications.js:36`, `:41`: somente a ausência de usuário pede login; com usuário e tenant ainda não hidratado, mantém carregamento sem erro nem RPC.
- **Teste:** `app/tests/features/notificationDialogRegression.test.js:72`: executa o hook com usuário autenticado e tenant ausente. A fonte original deixava `loading=false` e mostrava erro; a corrigida mantém espera sem erro. RED confirmado também contra `git show HEAD`, sem restaurar arquivos do worktree.

## A16 — InvalidStateError ao repetir showModal: não confirmado; sem alteração no componente

O relato atribui o erro à repetição de `showModal()` sobre o diálogo já modal, durante a repetição do efeito pelo StrictMode. O [algoritmo do HTML Standard](https://html.spec.whatwg.org/multipage/interactive-elements.html#dom-dialog-showmodal) retorna sem erro quando o elemento já está aberto como modal. Um diálogo aberto como não modal é um caso diferente.

`app/src/features/conversations/components/DocumentAttachment.jsx:10` abre o diálogo pelo efeito e não usa `show()` nem atributo JSX `open` para abri-lo como não modal. A ausência de `close()` no cleanup, isoladamente, não comprova o crash alegado; a remoção do elemento também tem limpeza nativa definida no padrão.

Uma alteração inicial foi retirada integralmente durante a revisão: o primeiro mock lançava erro indevidamente para qualquer diálogo aberto. Essa evidência RED foi invalidada. O teste corrigido em `app/tests/features/notificationDialogRegression.test.js:93` modela modal/não modal e passa na implementação original. `DocumentAttachment.jsx` ficou sem diff. Não se afirma reprodução em navegador real.

## C5 — marcação em lote e contagem fantasma: real

- **Causa:** o painel disparava uma leitura por item, mas `busy.current` descartava as chamadas seguintes e também ações durante polling. A limpeza local podia esconder avisos mesmo sem confirmação remota, deixando o contador não lido no servidor.
- **Correção:** `app/src/features/notifications/useNotifications.js:34`, `:55`, `:80`, `:116`: envia todas as revisões em `p_items` e serializa ações explícitas atrás da operação em andamento. Atualiza a contagem pelo recibo e recarrega a página. `app/src/features/notifications/NotificationCenter.jsx:69`, `:74`, `:81`, `:84` aguarda confirmação antes de esconder avisos remotos; `NotificationPanel.jsx:150` envia o grupo de uma vez. `NotificationDemo.jsx:78` acompanha o contrato de grupo.
- **Isolamento:** a chave já existente de `AppTopbar.jsx:86` inclui empresa, tenant e usuário, desmontando o hook anterior; seu cleanup aborta a requisição e a fila verifica se continua ativa antes de executar.
- **Teste:** `app/tests/features/notificationDialogRegression.test.js:27`, `:121`: hook real com polling pendente e dois itens; callback real de limpeza com falha remota. Na fonte original não havia RPC de leitura para os itens durante o polling e a limpeza era feita mesmo após falha. Na corrigida, ambos são enviados juntos e a falha preserva os avisos. RED/GREEN também conferido contra a fonte de `HEAD`.

## C6 — início inválido derruba agenda: real

- **Causa:** um `starts_at` não vazio e inválido chegava ao mapper, que podia lançar `RangeError` em `toISOString()`, interrompendo a lista inteira.
- **Correção:** `app/src/services/tenants/tenantDataReads.js:52`: filtra datas de início inválidas antes de chamar o mapper. Registros sem início continuam permitidos, pois pedidos pendentes podem não ter horário.
- **Teste:** `app/tests/unit/tenantDataReads.test.js:37`: lista com registro inválido e registro válido. Antes lançava `RangeError`; depois ignora o inválido e preserva o válido. Filtros de tenant, consultas paralelas e mesclagem continuam cobertos pela suíte existente.
- **Limite:** as observações de fuso/dateKey no relatório original não integram esta correção, conforme o escopo solicitado.

## C7 — retry invalida sua própria requisição: real

- **Causa:** o componente disparava o callback do App e, em paralelo, outra resolução com `force=true`; a invalidação da segunda tornava obsoleta a primeira. O App podia então receber resultado vazio e definir `retryable_error` apesar da resolução concorrente.
- **Correção:** `app/src/features/conversations/components/MediaAttachment.jsx:134`: aguarda o callback quando fornecido; só resolve diretamente quando não há callback. Remove a invalidação redundante e lê o resultado/cache após a operação única. Em `:112` e `:152`, reconhece também o erro de objeto ausente armazenado no cache.
- **Teste:** `app/tests/features/mediaAttachment.test.js:20`, `:39`: callback controlado, ausência de segunda resolução enquanto está pendente, fallback único e 404 do cache. Antes, o teste detectava uma resolução concorrente indevida; depois passou. Regressões existentes do pipeline e do cache de mídia também passaram.

## Validação e limitações

- `npm test` em `app/`: **1.012 testes passando, zero falhas**, exit code 0.
- `npx vite build --configLoader runner` em `app/`: **passou**, exit code 0. Usou a junção existente de `node_modules`, sem instalar dependências. Aviso de chunks maiores que 500 kB permanece.
- `git diff --check`: passou; apenas aviso de normalização LF/CRLF no arquivo de serviço de agentes.
- Os testes de arquitetura `app/tests/architecture/app.test.js` e `serviceExtraction6b32.test.js` tiveram suas contagens exatas atualizadas, com justificativa: A1/A6 acrescentaram um estado visual, duas refs e um efeito de limpeza. As verificações de AST, roteamento e contratos foram preservadas; as regressões comportamentais novas cobrem os indicadores e travas.
- Uma execução intermediária falhou no cleanup temporário de `kanbanCancelButtonRender.test.js` com `ENOTEMPTY` em `deps_temp`. A repetição completa passou sem alterar esse teste. Execuções anteriores, durante a integração, também expuseram os testes RED e as contagens estruturais desatualizadas; esses resultados não foram ocultados.
- Após ajustar o teste C5 para também executar a interface antiga ao conferir `HEAD`, o arquivo de regressão de notificações foi reexecutado: **6/6 passando**. Contra `HEAD`, os três cenários comportamentais A14/C5 falham e A16 passa.
- Validação local com serviços/React simulados e build. Não foi realizada validação visual em navegador, com usuário real ou contra Supabase/Storage de produção.

## Rollback

Reverter apenas os hunks deste incremento nos arquivos relacionados acima, nos testes novos e nas duas contagens de arquitetura, preservando alterações de outras frentes. A reversão é local: não há migração, publicação ou mudança remota a desfazer. Nenhum commit foi criado.

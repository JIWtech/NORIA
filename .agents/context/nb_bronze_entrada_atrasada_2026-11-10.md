# NB Bronze: ausência de respostas e atraso de entrada — 10/11/2026

## Pedido e escopo

O usuário relata que todas as conversas recentes da NB Bronze aparecem em “Conversas IA” sem resposta. A conversa da Gaby da captura foi conferida, mas o incidente afeta vários contatos. O objetivo é restaurar o recebimento e as respostas, preservando atendimentos humanos e evitando respostas duplicadas ou retroativas indiscriminadas.

Consultas feitas em produção no projeto `NORIA-prod` (`gfwwawazivmuqyctjsxj`), tenant `clinica_nubia_oficial` (`563a93cd-a5c1-4412-a65f-be2e2d41bb88`). As filas, os schemas e os workflows de atendimento não foram alterados. Na continuação foi feita uma reconexão controlada da instância Evolution da NB Bronze, descrita abaixo. A autorização pedida para retomar 19 conversas antigas não recebeu resposta afirmativa; a fala seguinte do usuário ampliou o diagnóstico para todas as conversas recentes.

## Evidências confirmadas

Janela: 48 horas anteriores a 10/11/2026, aproximadamente 12h30 de Brasília. Os números são um retrato da consulta e devem ser atualizados ao retomar.

| Situação | Mensagens | Contatos |
| --- | ---: | ---: |
| `stale_message_suppression`, fila `ready`, sem pendências na conversa mais recente | 217 | 49 |
| `buffer`, fila `review` | 85 | 5 |

- Não houve resposta de assistente na janela. A última resposta da IA com envio confirmado foi em **07/11/2026 às 13h01 de Brasília**.
- O problema recente não se limita a `GEMINI_RATE_LIMIT`: 49 conversas foram suprimidas por atraso e não têm trabalho pendente para a IA.
- Todas as 302 mensagens de entrada da janela têm atestação em `conversation_turn_ingress_facts`.
- Comparação entre `raw_payload.message_timestamp`, `conversation_turn_ingress_facts.received_at` e `channel_events.created_at`:
  - Mensagens suprimidas: **35,4–47,5 horas até a atestação da ponte**, média de **7,34 segundos da atestação até o registro do evento**, máximo 23,27 segundos.
  - Mensagens em buffer: **35,6–46,8 horas até a atestação**, média de **8,82 segundos até o registro do evento**, máximo 22,28 segundos.
- Atraso já presente antes da atestação concentra a investigação na entrega até a ponte de entrada. Esses dados não identificam sozinhos a causa exata na Evolution, sincronização/reconexão, transporte ou infraestrutura anterior à atestação. Não atribuir a espera de quase dois dias ao Gemini nem afirmar que o n8n consumiu todo esse período.
- GET público no `/healthz` do n8n hospedado retornou HTTP 200 e `{"status":"ok"}`. Isso comprova acessibilidade do serviço, sem comprovar estado dos workflows ou saúde da instância WhatsApp.

## Configurações e bloqueios históricos

- NB Bronze, Gênesis, I&C Salon e Noria usam `gemini-3.5-flash-lite`, política de três tentativas, espera inicial 30 segundos e teto de backoff 900 segundos.
- Portanto, não há diferença nessa política a copiar da I&C/Noria para solucionar o incidente.
- A NB Bronze está com IA habilitada; a consulta de uso de 10/11 retornou 1/500 chamadas. Os valores de cota diária diferem por cliente e não estavam esgotados no retrato observado.
- NB Bronze: 76 conversas históricas em `review`, 34 com `GEMINI_RATE_LIMIT`. Gênesis: 163 em `review`, 57 com esse erro, além de cinco em `uncertain`.
- Os eventos de `GEMINI_RATE_LIMIT` observados ocorreram entre 29/10 e 01/11. Não são evidência de limite ativo hoje.
- Filtro conservador para retomada de rate limit (lote rastreado, ticket válido, nenhuma tentativa de envio e nenhuma ação humana/controle posterior): cinco candidatas na NB Bronze e 14 na Gênesis. São apenas candidatas; não foram retomadas.
- A RPC oficial `magia_resolve_turn_review(..., 'resume_unattempted', ...)` exige sessão autenticada de operador cadastrado. A conexão SQL MCP consultada tem `current_user=postgres`, mas `auth.uid()` e `auth.role()` nulos. Não fabricar uma identidade de operador para executá-la.

## Indicação do painel

- `stage='Conversas IA'` indica etapa, não prova geração ou entrega de resposta.
- `ConversationComposer.jsx` mostra “A IA está respondendo esta conversa” a partir de `isAi`, sem consultar uma execução ativa. Essa indicação pode ser enganosa neste incidente.
- A captura exibe o horário de entrada (`created_at`), enquanto o timestamp original comprova mensagens enviadas quase dois dias antes.
- Fontes conferidas: `app/src/features/conversations/components/ConversationComposer.jsx`, `Conversations.jsx`, `n8n/sources/noria_core.js` (`turnStaleMessages`, padrão de seis horas).
- Corrigir apenas a etiqueta ou aumentar o limite de idade não corrige a entrega atrasada. O frontend não foi alterado nesta investigação.

## Situação inicial de acesso

- O `.env` local aponta `EVOLUTION_SERVER_URL` para localhost e `N8N_WEBHOOK_BASE` para o serviço local do Docker. Não tem `N8N_BASE_URL` nem `N8N_API_KEY` de produção.
- Pergunta assíncrona enviada ao usuário: disponibilizar a API do n8n de produção no `.env` ou informar host, usuário e porta SSH da VPS. Não pedir chaves/senhas no chat.
- Existe chave SSH local dedicada em `%USERPROFILE%/.ssh/id_ed25519_noria_hosting`; não se sabe se foi cadastrada na VPS. Nunca imprimir seu conteúdo privado.
- Não houve rejeição automática de uma tentativa de escrita: nenhuma escrita remota foi tentada. O impedimento atual para localizar a causa exata é falta de acesso aos logs/configuração de produção dessas etapas.

## Continuação com API do n8n e teste real

O usuário disponibilizou acesso à API do n8n. `N8N_BASE_URL` e `N8N_API_KEY` foram salvos no `.env` local, após confirmar que o arquivo está ignorado pelo Git e não é rastreado. Não copiar a chave para documentação, outputs, scripts versionados ou diffs. O impedimento de acesso à API do n8n descrito acima foi resolvido.

### Produção conferida

- CORE ativo: `3N5oN6sxtir9lFrA`, versão publicada `a289d6d9-fed2-42c4-96c1-418eb52ab8dc`.
- Motor compartilhado ativo: `mlKNPv862H2g3Gap`, versão `5ca3e184-4110-4cc8-8add-972d06879272`.
- EXT Núbia v1 ativa: `vCDXJLqIBCZJRTVv`. EXT Núbia serviços v2 continua inativa.
- I&C usa um motor isolado (`yxdKP0PeskDMUFSo`) com adaptador de validação comercial. Não copiar esse motor para a NB nem substituir as EXTs: a diferença não é uma configuração de quota/retry.
- Não havia execuções `running`, `waiting` ou `new` nas listas consultadas. Execuções bem-sucedidas de atendimento não são retidas; não interpretar lista vazia como ausência de processamento.
- Erros CORE `559251`/`559252` e follow-ups `559250`/`559253` em 10/11 às aproximadamente 06h04 BRT registram `getaddrinfo EAI_AGAIN` para o host Supabase. O prefixo `TURN_LIFECYCLE_DEPLOYMENT_REQUIRED` nesse erro é um wrapper; não comprova migração faltante. Leituras seguintes do Supabase feitas dentro do n8n funcionaram (~386 ms), portanto a falha DNS não estava reproduzindo naquele diagnóstico.

### Diagnósticos isolados

Foram criados workflows temporários com Schedule Trigger, execução única protegida por estado/expiração e saídas sanitizadas. Depois de cada consulta, foram desativados e removidos. Fontes, snapshots e resultados ficam fora do Git em `%TEMP%/noria-nb-diagnosis-2026-11-10/`. Nunca imprimir as exportações completas: podem conter referências/configurações privadas.

Leituras na Evolution 2.3.7:

- NB (`clinica_nubia`) e I&C (`ic_saloon`) reportavam `open`.
- Ambas com webhook habilitado, somente `MESSAGES_UPSERT`, `webhookByEvents=false`, `syncFullHistory=false`, `groupsIgnore=true`, `alwaysOnline=false`.
- NB aponta para `https://auton8n-noria-ingress-nubia.tplv5d.easypanel.host/ingress`; I&C para o ingresso correspondente. Os dois `/healthz` retornaram `listening`.
- O histórico mais recente da Evolution da NB ainda continha como últimas entradas as mensagens de 08/11, incluindo a Gaby. A leitura atual da Evolution da I&C tinha entradas de 10/11.
- A NB tem registro histórico de desconexão 401 em 04/11. Esse metadado antigo, sozinho, não comprova logout atual; a conexão consultada estava `open`.
- Houve follow-up automático da NB às **12h35 de 10/11**, persistido em `channel_events` e presente como saída na Evolution. Isso confirma envio automático recente, mas não resposta a uma nova entrada de cliente.

### Teste do usuário e reconexão

1. O usuário informou que enviou **“teste” às 12h47** de 10/11.
2. A mensagem não apareceu no Supabase/atestação de entrada nem entre as últimas mensagens da Evolution na consulta das 12h48. O problema do teste ocorre antes de chegar ao motor da IA; não atribuir esse teste ao rate limit ou à fila `review`.
3. Foi feita **uma** chamada ao endpoint de reconexão da instância existente, `POST /instance/restart/clinica_nubia`, às aproximadamente **12h51m30s**. Antes da chamada, o diagnóstico validou o tenant/canal ativo no Supabase, nome exato da instância e URL atual do webhook. Não chamou endpoints de logout, exclusão ou criação de instância nem enviou mensagens.
4. A reconexão foi aceita, sem erro do provedor ou QR exigido no retorno. O webhook foi comparado antes/depois e ficou preservado. Estado intermediário `connecting`; às **12h53** voltou a `open`.
5. Depois da reconexão, a mensagem das 12h47 ainda não constava no histórico consultado; não declarar atendimento recuperado.
6. O número conectado à instância NB termina em **6802**. O usuário confirmou esse destinatário e informou novo envio de **“teste” às 12h55**, depois da reconexão.
7. Às **12h56**, o novo teste também não constava em `channel_events`, atestação ou histórico consultado da Evolution. O contador da instância continuava em 18.201 mensagens e as últimas entradas permaneciam em 08/11; estado `open`. A reconexão não resolveu a falha observada. Não repetir o reinício sem nova evidência.
8. Às **13h00m30s**, diagnóstico isolado leu os headers do webhook somente em memória e encaminhou ao ingresso um evento técnico `connection.update`, sem contato, chave de mensagem ou texto de cliente. O normalizador ignora esse evento. A autenticação foi aceita e a ponte retornou HTTP 200 após encaminhar ao n8n. Isso valida o caminho técnico de encaminhamento naquele momento, não prova recebimento de mensagens reais do WhatsApp. Headers/tokens não foram expostos no resultado.
9. Nova pergunta assíncrona pendente ao usuário: o teste apareceu no WhatsApp do celular da NB Bronze? Também foram solicitados host/IP, usuário e porta SSH da VPS para ler os logs da Evolution, usando a chave local sem pedir senha/chave privada no chat.

Workflows temporários já removidos: `ZWrkKIQid6nRCW5s`, `ZBXchaeeSBMLlxW3`, `jRIL05SUkg9FutKP`, `l85q3foVEEWEifzM`, `O1twnJ0DJfbhlM6V`, `PzXSvWpxujvS5sW0`, `pTDaj4p0gkPQSGbB`. Resultados relevantes: execuções `560589`, `560605`, `560615`, `560621`, `560633`, `560645` (snapshots locais; a remoção dos workflows pode remover essas execuções do servidor). A lista remota foi conferida sem workflows temporários remanescentes após as primeiras cinco remoções; os dois seguintes também retornaram recibo de exclusão.

Não foram retomadas as 19 conversas antigas, não foram alteradas quotas, não foram removidas proteções de mensagens antigas e não houve mudança de schema, prompt ou regra comercial.

## Próximos passos

1. **O usuário escolheu “Continuar sem refazer o pareamento”.** Preservar o vínculo atual e investigar alternativas. Não executar logout, novo QR, exclusão de instância ou limpeza de chaves/sessões. Acompanhar a pergunta pendente sobre os tiques de entrega do teste das 12h55.
2. O acesso ao EasyPanel/console da VPS já está disponível; não pedir SSH novamente por inferência. Não repetir reconexões em loop nem trocar webhook indiscriminadamente. Consultar a seção seguinte antes de agir.
3. Se a mensagem entrar na Evolution mas não no Supabase, investigar a ponte e entrega do webhook. Se entrar em fila `review`/controle humano, identificar o bloqueio daquela conversa, sem liberar outras conversas por inferência.
4. Tratar backlog e revisões individualmente, respeitando sessão, controle humano, tentativas e recibos; não reabrir todas as filas em massa.
5. Se houver correção de código, usar fontes canônicas, teste de reprodução e regressões pertinentes. Alterações de schema/dependências/arquitetura exigem aprovação conforme AGENTS.md.

## Continuação pelo EasyPanel e estado para retomada

### Acesso e cuidados com segredos

O usuário forneceu o endereço do EasyPanel em `http://187.127.53.78:3000` e credenciais de login. Elas estão no `.env` ignorado pelo Git, nas variáveis `EASYPANEL_BASE_URL`, `EASYPANEL_EMAIL` e `EASYPANEL_PASSWORD`; nunca repetir os valores em outputs ou documentação. O painel foi autenticado com sucesso.

**Incidente de exposição no registro da sessão:** a primeira listagem autenticada retornou configurações completas com segredos, e o assistente imprimiu essa resposta indevidamente na saída da ferramenta. O usuário foi informado em comentário. Nenhum segredo foi para arquivo rastreado ou commit. As saídas seguintes foram limitadas a campos técnicos e sanitizadas. É necessária atenção à rotação coordenada das credenciais expostas depois da recuperação, sem alterar segredos de produção automaticamente durante este atendimento.

Artefatos privados e auxiliares estão em `%TEMP%/noria-nb-diagnosis-2026-11-10/`. **Não imprimir nem versionar** `panel-projects.json`, `easypanel-session.json`, snapshots completos, `.env` ou backups privados. Esses arquivos contêm configuração sensível de serviços. Para reutilizar o acesso sem exibir credenciais:

- `panel.cjs`: helper autenticado para procedimentos do EasyPanel; `rpc(procedure, input)` retorna o conteúdo decodificado. Não imprimir retornos completos de listagens/inspeções.
- `safe-output.cjs`: `sanitize(text)` e `hostRead(command, filename, timeout)`, que usam console do host e retornam texto sanitizado. Comandos devem continuar estritamente limitados ao escopo autorizado.
- `evolution-read.cjs`: consultas diretas à Evolution, com URL e instância NB validadas. Expõe `read(endpoint)` e `latestMessages()`; usa a configuração do serviço n8n do projeto `auton8n`, sem imprimir a chave.
- `read.cjs`: helper de leitura da API n8n, usando a chave do `.env`.

O painel usa o protocolo oRPC: `POST /api/rpc/<segmentos/do/procedimento>`, JSON `{ "json": input }`, header `Authorization` com o token da sessão (conforme o cliente público). O procedimento de listagem `projects.listProjectsAndServices` inclui segredos; selecionar campos antes de qualquer saída.

Logs via `/ws/serviceLogs` vieram empacotados em frames JSON `{output: string}`. O snapshot inicial não bastou para ver os erros recentes. O console do host `/ws/hostShell` permitiu ler logs com `docker logs --since ... --tail ...`. O helper espera o primeiro prompt antes de enviar `{input: command + '\r'}`; enviar antes do prompt fez comandos serem ignorados. Não imprimir a URL do WebSocket: o token vai na query.

### Evidências adicionais da VPS

- DNS dos domínios n8n, Evolution e ingresso NB resolve para `187.127.53.78`, confirmando o mesmo servidor.
- Projeto real: `auton8n`. Container Evolution consultado: `e9ae55efcad5ca043a3866b35bb3230aa87d3a95c39512c8944771fbf04e4371`, serviço `auton8n_evolution-api`, Evolution **2.3.7**. Imagem configurada `evoapicloud/evolution-api:latest`; não fazer pull/deploy/upgrade global por iniciativa própria.
- `DATABASE_SAVE_DATA_NEW_MESSAGE=true`, `DATABASE_SAVE_DATA_INSTANCE=true`, `DEL_INSTANCE=false`. O salvamento de mensagens não estava desativado.
- O container estava rodando havia quatro dias; leitura de recursos: aproximadamente 118 MiB de memória em 3,8 GiB disponíveis e 6% de CPU. Não há evidência de falta de memória nesses números.
- Relógio UTC do host compatível com o banco e horário de Brasília usado nos testes.
- Consulta Prisma diretamente no container, **filtrada pela instância NB**, confirmou 18.201 mensagens e nenhum registro desde 12h44 de 10/11. O telefone associado tem país 55, DDD 24 e final 6802. Não é apenas um problema de exibição/consulta da API.
- Logs históricos de 10/11 contêm `Bad MAC`, `SessionError: No matching sessions found for message`, `failed to decrypt message`, `stream errored out` e `Failed to check/upload pre-keys during initialization`.
- Foram identificados 41 registros estruturados de falha de descriptografia; 44 erros de sessão/stream/pré-chaves tinham contexto imediatamente anterior associado a `clinica_nubia`. Como o log é compartilhado entre instâncias e há interleaving, esse contexto é evidência circunstancial; não tratá-lo como um campo explícito de tenant em cada erro.
- Últimas falhas de descriptografia analisadas: 08h35 BRT; erro de pré-chaves associado ao contexto NB: 11h17 BRT. Não apareceu erro novo equivalente durante os testes das 12h47/12h55. Não afirmar que o ID dessas mensagens de teste foi encontrado no erro; ele não foi.
- Esses erros são compatíveis com problema de sessão/criptografia e motivam a proposta de refazer pareamento, mas ainda não comprovam a causa exata de cada teste ausente.
- Tentativas de ler somente metadados da identidade local não localizaram `me.id`/`me.lid` no formato inspecionado do armazenamento de sessão. **Isso não prova que a instância esteja desregistrada**. O resultado preliminar `registered=false` foi substituído por `identity_found=false`, `registered=null`; não apresentar o preliminar como diagnóstico.

### Recuperação proposta e pendência atual

Foi salva cópia privada da configuração da instância, webhook, settings, estado e contagem de mensagens em `%TEMP%/noria-nb-diagnosis-2026-11-10/nubia-instance-config-before-pairing.json`. **É backup de configuração, não de histórico nem garantia de restaurar uma sessão revogada.** Não imprimir esse arquivo.

Pergunta assíncrona enviada ao usuário:

> Você autoriza refazer o pareamento somente do WhatsApp da NB Bronze e tem alguém com o celular final 6802 disponível para escanear o QR Code agora? Essa etapa desconecta o vínculo atual da instância.

Opções: autorizar/celular disponível; aguardar responsável; continuar sem refazer pareamento. **O usuário respondeu “Continuar sem refazer o pareamento”. Não executar logout, limpar sessões/chaves ou gerar novo pareamento. A resposta não cancela a investigação: o usuário quer continuar por alternativas que preservem o vínculo atual.**

A proposta de pareamento ficou fora do escopo autorizado. O código público `logoutInstance` limpa credenciais da sessão; não usar esse endpoint ou limpeza direta como atalho para a alternativa solicitada. Não excluir/recriar a instância, apagar mensagens, limpar Redis/banco global ou reiniciar serviços de outros tenants. Se uma nova entrada chegar, verificar Evolution → atestação → fila → resposta/recibo; tratar bloqueio humano/revisão daquela conversa separadamente, sem retomar outras por inferência.

Não foram feitas alterações em schema, modelos, quotas, prompts, CORE/EXT, frontend ou filas históricas. A única intervenção funcional até aqui foi a reconexão simples descrita acima; não resolveu o recebimento observado.

### Investigação sem refazer pareamento

Depois da escolha do usuário, foram feitas novas consultas sem alterar estado, em 10/11 às aproximadamente **13h35 BRT**:

- NB e I&C: proxy desabilitado e sem host configurado; não há proxy legado ativo na NB.
- As configurações relevantes permanecem iguais: `groupsIgnore=true`, `alwaysOnline=false`, `readMessages=false`, `syncFullHistory=false`. Não mudar esses valores sem evidência de que tratam o defeito.
- `GET /chat/fetchPrivacySettings/<instance>` retornou HTTP 200 nos dois clientes em aproximadamente 1,2 s.
- `POST /chat/fetchBusinessProfile/<instance>`, consultando somente o próprio número empresarial de cada instância, retornou HTTP 200 em cerca de 200–240 ms. O código 2.3.7 chama `client.getBusinessProfile(jid)`. A conexão consegue responder consultas do protocolo; `open` não é a única evidência de conectividade.
- Essas chamadas consultam metadados; não enviaram mensagens a clientes nem mudaram privacidade/presença.
- O código público 2.3.7 filtra grupos, status/broadcast e newsletters, sem um filtro configurado para bloquear conversas pessoais da NB. Também ignora mensagens com erros de descriptografia em `messageStubParameters`. Essa leitura de código não comprova que o teste das 12h55 tenha caído nesse ramo.
- Os erros de criptografia analisados usam endereçamento `lid`; o sufixo 3398 do autor do log é de um LID, não prova de que a instância esteja conectada a outro número telefônico. O número empresarial atualizado continua com DDD 24/final 6802.

Pergunta assíncrona pendente:

> Na mensagem “teste” enviada às 12h55 para a NB Bronze, quantos tiques aparecem no seu WhatsApp?

Opções: dois tiques cinza/azul; um tique cinza; relógio/erro. A resposta ajuda a distinguir entrega à conta WhatsApp de entrega ao dispositivo conectado da Evolution, sem depender de acesso ao celular do salão. Não assumir a resposta.

Resultado sanitizado dessas consultas: `%TEMP%/noria-nb-diagnosis-2026-11-10/non-pairing-checks.json`. Nenhum ajuste de configuração comprovado foi identificado/aplicado nesta etapa; o recebimento ainda precisa de validação/correção.

### Entrega confirmada e reconexão posterior aos testes

- O usuário informou que a mensagem “teste” das **12h55** tem **dois tiques cinza ou azul**. Isso confirma entrega a algum dispositivo da conta destinatária; não comprova recebimento pelo dispositivo conectado da Evolution.
- O usuário também informou que a clínica já teve o número reconectado. Os logs consultados depois mostram nova inicialização da conexão `clinica_nubia` às **13h41min31s BRT**, seguida de identificação da instância às 13h41min33s. Essa inicialização é posterior ao teste das 12h55 e não foi provocada por esta etapa da investigação.
- Imediatamente antes aparece um `stream errored out` genérico, com `stream:error` e filho `ack` de status/media, sem código explícito de conflito, logout ou erro de autenticação. Não concluir que existe sessão duplicada nem atribuir esse log ao teste ausente.
- Consulta às **14h02min59s BRT**: contagem permaneceu em **18.201** mensagens; última entrada persistida continua em 08/11 e última saída em 10/11 às 12h35. Não houve novo `Bad MAC`/`SessionError`/falha de descriptografia no trecho consultado desde 12h44.
- Foi solicitado um **novo teste após a reconexão das 13h41**, com texto “teste NB após reconexão” e horário de envio. Aguardar a resposta; não presumir que os testes anteriores validam essa reconexão mais recente.
- Nenhum logout, limpeza de sessão/chaves, novo pareamento ou alteração de configuração foi executado nesta continuação. A escolha de preservar o pareamento permanece vigente.

Artefato privado desta leitura: `%TEMP%/noria-nb-diagnosis-2026-11-10/host-evolution-after-delivery-confirmation.log`. Não imprimir o log bruto, que pode conter informações de outras instâncias.

### Teste das 14h03 após a reconexão

- Usuário enviou nova mensagem **“teste” às 14h03 BRT**. Não presumir que ela tenha dois tiques: a confirmação anterior era sobre o teste das 12h55.
- **14h04min32s:** API Evolution ainda `open`, 18.201 mensagens, sem o novo teste.
- **14h04min35s:** consulta Supabase limitada ao tenant NB confirmou **zero** atestações em `conversation_turn_ingress_facts` e **zero** entradas WhatsApp em `channel_events` desde 14h02. A entrada mais recente persistida no NORIA continua às 10h16 (mensagem original antiga).
- **14h05min20s:** Prisma diretamente no container confirmou instância `clinica_nubia`, estado `open`, 18.201 mensagens, **zero** mensagens desde 14h02. Não é apenas paginação da API ou atraso de exibição do painel.
- Leitura de logs desde 14h02 não retornou registros de mensagens nem erros novos de descriptografia. Ausência de log não identifica por si só a causa; não atribuir o teste a `Bad MAC` sem evidência.
- **14h05min54s:** serviço Swarm `auton8n_evolution-api` tem **uma réplica** e **um container local em execução**, iniciado há quatro dias. Não há evidência de réplica local duplicada; isso não exclui uma sessão sendo usada em outro host não inspecionado.
- Foi perguntado se o teste das **14h03 aparece no aplicativo WhatsApp do próprio celular da clínica**, distinguindo explicitamente esse aplicativo do painel NORIA. Aguardar resposta. A pergunta anterior sobre o celular recebeu “não apareceu no sistema da Noria”, o que não comprova ausência no celular.
- O problema observado continua antes de qualquer chamada de geração Gemini. Não houve novo pareamento, reconexão, alteração de modelo/configuração, envio automático de mensagem ou intervenção em outros tenants nesta etapa.

Artefatos privados: `host-db-test-1403.log`, `host-logs-test-1403.log`, `host-evo-replicas-1403.log`, `host-evo-processes-1403.log` no diretório privado já indicado.

### Causa provável identificada: ACK de status ausente no Baileys

O usuário não tem acesso ao celular da clínica e considera certo que a mensagem aparece
nele. Isso continua sendo uma informação indireta; não repetir a mesma pergunta ou exigir
outro teste antes de uma mudança relevante.

A pesquisa em fontes primárias encontrou correspondência específica:
[Evolution #2778](https://github.com/evolution-foundation/evolution-api/issues/2778),
[Baileys #2858](https://github.com/WhiskeySockets/Baileys/issues/2858) e
[PR Baileys #2883](https://github.com/WhiskeySockets/Baileys/pull/2883), ainda aberto.
A falta de ACK de eventos de status é uma explicação forte para o recebimento atrasado
e o erro `ack class=status`; não apresentar como recuperação concluída antes de aplicar e validar.

Verificações próprias:

- O erro registrado às **13h41min31s** tem `reasonNode.tag=ack`, `class=status`, `type=media`.
  A conexão anterior começou às **12h51min32s**, intervalo de aproximadamente 50 minutos.
- O pacote instalado foi lido do container sem mudanças: Baileys **7.0.0-rc.9**,
  **sem listener `CB:status`**. Uma cópia técnica do arquivo de código foi salva somente
  no diretório privado; não contém credenciais.
- Teste com o módulo copiado e transporte simulado reproduziu **falha** por nenhum ACK ser
  enviado. O backport passa **8/8 testes**, incluindo ordem offline e continuação após erro.
- Pacote revisável: `ops/evolution-status-ack/patch-status.cjs`, `Dockerfile`, `README.md`;
  teste `scripts/test_evolution_status_ack.cjs`. Não adiciona pacote npm nem altera CORE/EXT.
  O patch recusa versão/hash inesperados e aceita reaplicação somente do resultado exato.
- Imagem derivada **já construída na VPS**, sem downloads: `noria-evolution:status-ack-20261110`.
  Importação do módulo aprovada em container isolado com `--network none --read-only`,
  sem volumes/credenciais de produção. Esse container temporário foi removido.
- Hash do arquivo corrigido: `382d47a437757f595015d0ed26ae844a9efab6095d758d1c52909bb19a25b9db`.
  Coincide nos testes locais e na imagem construída.
- Tag de retorno da imagem original já criada: `noria-evolution:rollback-20261110-966625532d90`.
- Definição atual do serviço salva em arquivo privado
  `evolution-service-before-status-ack.json`; contém configuração sensível, não imprimir/versionar.

**Aplicação autorizada e realizada em 10/11 às 14h23 BRT**, conforme continuação abaixo.
Não refazer pareamento nem aplicar novamente por inferência. O plano de aplicação,
retorno e verificação está no README do pacote.

### Publicação autorizada e verificação parcial

- O usuário autorizou explicitamente aplicar a correção e reiniciar a Evolution compartilhada.
- Preflight: NB, I&C e NORIA estavam `open`; Wesley (`wesley-carros`) já estava `close`.
- Foi preservada a definição privada do serviço. Env, volumes e portas foram comparados e
  mantidos. `deploy.zeroDowntime` foi alterado de `true` para `false` para não sobrepor dois
  processos usando as mesmas sessões durante a troca.
- A primeira publicação, às 14h22, falhou antes de substituir o container: o EasyPanel tentou
  baixar a tag local e recebeu `pull access denied`. O container antigo permaneceu em execução.
- A publicação efetiva, às **14h23min42s**, usou `services.app.updateSourceDockerfile` e
  `services.app.deployService`, com Dockerfile inline, base oficial fixada pelo digest da
  imagem instalada e o mesmo patch validado. Não houve atualização para `latest`.
  O Dockerfile exato está no diretório privado em `Dockerfile.easypanel-status-ack`.
- Container resultante observado: `c75230b6a2ee`. O arquivo ativo tem listener `CB:status`
  e hash `382d47a437757f595015d0ed26ae844a9efab6095d758d1c52909bb19a25b9db`.
- NB, I&C e NORIA retornaram a `open` sem QR/logout. Wesley passou de `close` para `connecting`
  na leitura seguinte; não apresentar isso como regressão causada pela troca.
- O recebimento da NB voltou: 16 atestações após a publicação, depois 28, 73 e **160 às
  14h30min56s**. A contagem da Evolution subiu de 18.201 para 18.217 na primeira leitura.
  Parte das entradas é histórico atrasado e não deve ser reprocessada indiscriminadamente.
- **Resposta da IA ainda NÃO confirmada**: eventos novos permaneciam em `buffer` nas consultas.
  O n8n apresentou erros de falta de oferta JavaScript e, depois, HTTP 503 com mensagem explícita
  `Database is not ready!`. `/healthz/readiness` oscilou entre 200 e 503. Saúde local do executor
  JavaScript em 5681 retornou 200. Nenhum executor, n8n ou banco foi reiniciado nesta investigação;
  não atribuir a falha do banco somente ao executor JavaScript.
- Banco interno n8n: container `947a4e0fad15`; n8n: `63a3eb291a6b`; runner: `f3a447463b53`.
  Logs do banco mostraram avisos de transação já em andamento. Consultas operacionais foram
  somente de leitura, sem conclusão documentada sobre causa desse bloqueio.
- O usuário informou novo teste **às 15h03 de 10/11**, ainda sem resposta. Esse teste precisa
  de rastreamento; não afirmar que foi respondido. Não foi concluída a observação de estabilidade
  superior a 50 minutos nesta continuação.
- **Nenhuma edição/publicação do CORE n8n foi feita por esta intervenção.** Apenas a Evolution
  e sua configuração de publicação foram alteradas. Nenhuma fila histórica foi liberada em massa.

### Consulta sobre alterações do CORE em 11/11

Em resposta à pergunta do usuário, uma nova leitura da API mostrou:

- Workflow principal `3N5oN6sxtir9lFrA` segue na versão ativa `a289d6d9-fed2-42c4-96c1-418eb52ab8dc`.
- Motor `mlKNPv862H2g3Gap` mudou de `5ca3e184-4110-4cc8-8add-972d06879272` para
  `c0a7126a-0899-45ce-a65e-ef6209b07ca9`, atualizado em **11/11 às 11h49min38s BRT**.
  Esta publicação não foi feita pelas chamadas de ferramenta desta intervenção; autoria não inferida.
- Comparação com o snapshot anterior: composição de agenda/endereço/Pix/handoff por IA usando
  fatos oficiais, remoção de respostas diretas NB por regex, novos bloqueios de reserva por nome
  e política de público, não herdar horário ao trocar serviço, preservação de blocos aprovados
  e mudanças na limpeza de saudações/emojis. É mudança no motor compartilhado.
- A correção local `EMPTY_REPLY_TEXT` / `visibleReplyOrHandoffNotice`, do incidente I&C de 09/11,
  continua no diff do checkout e não está presente no código publicado consultado.
- Snapshots e comparação foram salvos somente no diretório privado; não imprimir exports completos.

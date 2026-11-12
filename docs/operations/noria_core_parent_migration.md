# Topologia do CORE: roteador leve, motor único e EXT NORIA própria

A migração local que embutiu o motor no workflow pai foi substituída por um desenho de **três workflows com nomes distintos**. O motor volta a ser um sub-workflow com uma única cópia do código, como já roda em produção. A EXT do tenant NORIA passa a ser um workflow próprio.

| Workflow | ID de produção | Conteúdo | Arquivo |
| --- | --- | --- | --- |
| **NORIA CORE \| Roteador WhatsApp, Comandos e Follow-ups** | `3N5oN6sxtir9lFrA` | Entrada, fila, recuperação, comandos, follow-ups, escolha da EXT e despacho. Não contém o motor. | `NORIA CORE _ WhatsApp + Comandos + Follow-ups _ Motor compartilhado v2.json` |
| **NORIA CORE \| Motor de Atendimento** | `mlKNPv862H2g3Gap` (continua sendo o motor) | Uma única cópia do motor genérico. Recebe a fase (`single`, `prepare`, `availability`, `finalize`) e o contrato por marcador no item. | `NORIA CORE _ Motor conversacional.json` |
| **NORIA EXT \| NORIA \| Política** | definido por `NORIA_EXT_WORKFLOW_ID` | Valida tenant e canal `noria` no Supabase e entrega `noria_client_policy`. | `NORIA EXT _ NORIA _ Política.json` |

`NORIA EXT | NB Bronze` (Núbia v2) e a EXT da Gênesis permanecem como estão. O ID da EXT NORIA **nunca** é o ID do motor: sem `NORIA_EXT_WORKFLOW_ID` o gerador grava o marcador `PREENCHER_ID_EXT_NORIA` e recusa o ID do motor. Para o motor use `NORIA_ENGINE_WORKFLOW_ID` (padrão: o ID de produção acima). O ID do motor do I&C Salon vem de `NORIA_IC_SALON_ENGINE_WORKFLOW_ID` ou do que já está configurado.

## Contrato roteador ↔ motor

Cada nó de fase do roteador (`CORE | Motor conversacional único`, `Preparar resposta`, `Finalizar resposta` e os três `CORE | Serviços | …`) é precedido por um marcador `… | Fase` que grava `noria_engine_phase` e `noria_engine_contract` no item e preserva o binário (áudio). O motor lê a fase, **recusa o item se o contrato divergir** (`NORIA_ENGINE_CONTRACT_MISMATCH`, falha fechada) e remove os dois campos antes de ler a entrada. As EXTs nunca veem esses campos. A versão atual é `noria_engine_phase_v1` (também em `n8n/build_manifest.json`).

Consequência operacional: o roteador e o motor precisam ser publicados em conjunto. Um motor novo recusa um roteador antigo (sem o contrato) e um roteador novo contra um motor antigo envia um campo extra que o motor antigo não remove. Faça o corte com o procedimento coordenado abaixo.

## I&C Salon

O nó `CORE | Motor conversacional único` escolhe o workflow por expressão: o motor do Salon somente quando `tenant_id`, `tenant_slug` (`ic_salon`) e `instance` (`ic_saloon`) coincidem; qualquer outro item vai ao motor compartilhado. A mesma entrada serve ao webhook e à recuperação da fila. O motor do Salon é regenerado do artefato do motor atual: `node clients/ic_saloon/build_conversation_adapter.cjs "n8n/workflows/NORIA CORE _ Motor conversacional.json"` (o construtor exige o nó `CORE | Motor conversacional` e exatamente dois nós; coberto por `clients/ic_saloon/build_conversation_adapter.test.cjs`).

O construtor aplica as correções de handoff e persistência de estágio ao export isolado do Salon. O Roteador atualmente publicado envia apenas a fase; o export regenerado também exige `noria_engine_contract: 'noria_engine_phase_v1'`. A versão ativa do Salon já contém as correções com o contrato anterior. Inclua o export regenerado no mesmo corte do Roteador novo para preservar o atendimento.

Para tenants que não são `noria`, o resolvedor confere no Supabase, antes de entregar a política, que o slug pertence ao `tenant_id`, que o tenant está ativo e que a instância pertence a um canal WhatsApp ativo do mesmo tenant (`NORIA_ROTEAMENTO_TENANT_INVALIDO`, `NORIA_ROTEAMENTO_INSTANCIA_NAO_PERTENCE`, `NORIA_ROTEAMENTO_IDENTIDADE_INCOMPLETA`). Um item divergente falha fechado e permanece na fila.

## Estado estático

`$getWorkflowStaticData('global')` pertence ao workflow cujo nó o executa. Com o motor separado:

- **Motor** (`mlKNPv862H2g3Gap`): circuito e concorrência do Gemini (`gemini_circuit_open_until`, `gemini_probe_id`, `gemini_active_calls`). As seis fases e todos os tenants do motor compartilhado usam o mesmo estado. O Salon tem o próprio, porque seu motor é outro workflow. É o comportamento da versão commitada.
- **Roteador**: apenas `lifecycle_checked_at` do nó `Ler Fila WhatsApp` (cache de 10 minutos da checagem de implantação).
- **EXT Gênesis**: o cache de identidade de 60 s.

O estado estático **não** passa para o roteador. A frase da migração anterior valia só enquanto o motor estava embutido. O teste `test_noria_engine_subworkflow.cjs` garante que as chaves do Gemini existem apenas no workflow do motor.

## Reservas de outras conversas (pipeline de serviços v2)

`servicesLoadReservations` envia à EXT as reservas da sessão atual e também as reservas futuras ativas do mesmo contato e tenant de sessões anteriores (`pending_payment`, `reserved`, `payment_requested`, `payment_reported`, `confirmed`). A EXT NB Bronze já devolve `EXISTING_FUTURE_RESERVATION` nesse caso. A consulta é presa a `tenant_id` e ao chat; `loadAppointments` e o legado não mudaram. Efeito colateral a conhecer: uma declaração de pagamento numa nova sessão, havendo exatamente uma reserva pendente de sessão anterior, deixa de cair em `NO_PENDING_RESERVATION`; a EXT autoriza o encaminhamento, o executor (que só enxerga a sessão atual) devolve `appointment_not_found` e o turno vai para a equipe.

A mesma carga alimenta o executor do pagamento declarado. `servicesMarkPaymentReported` usa `servicesLoadActiveReservationRows`, o mesmo carregador de linhas completas de `servicesLoadReservations`, em vez de enxergar apenas a sessão atual. Quando o cliente declara o pagamento em uma sessão nova e a reserva pendente é de uma sessão anterior, o executor a encontra (antes devolvia `appointment_not_found` e o turno ia para a equipe). O escopo continua preso a `tenant_id` e ao chat, com checagem por linha, apenas os status pendentes de pagamento (`pending_payment`, `reserved`, `payment_requested`) e exatamente uma candidata: duas pendentes (por exemplo, uma anterior e uma da sessão atual) continuam como `ambiguous_payment_appointment` e seguem para a equipe. A atualização continua presa a `id`, `tenant_id` e ao status esperado. Um turno repetido reconhece a declaração já encaminhada (`payment_report_request`) mesmo que a reserva seja de sessão anterior. Só o pipeline v2 usa o novo carregamento; o legado não mudou, e o CORE não ganhou regra comercial.

## Disparos (campanhas) no roteador dividido

Os commits de disparos do `dev` (envio pelo servidor, proteção do número, lista de bloqueio, agendamento) foram integrados. `configureBroadcastWorker` cria o nó `Processar Disparos` no roteador, ligado ao mesmo gatilho de 1 minuto de `Verificar Follow-ups Vencidos` que o despachante de follow-ups; o código vem de `n8n/code/broadcast_campaign_worker.js`. O nó vive no roteador (não no motor), e o roteador continua sem cópia do motor (uma única cópia, no workflow do motor). Os testes `scripts/test_broadcast_*.cjs` usam PGlite: sem o módulo instalado, defina `MAGIA_TEST_MODULES` com a pasta `node_modules` que contém `@electric-sql/pglite` (por exemplo, `app/node_modules`). A validação de release passou a incluir `clients/ic_saloon/build_conversation_adapter.test.cjs`.

### Homologação de Disparos

O painel preserva importação de contatos, seleção de destinatários, prévia, agendamento, consentimento, lista de bloqueio e acompanhamento. Na gravação de contatos, cada lote envia somente as colunas preenchidas. A chave de conflito inclui o tenant, o canal e o identificador do contato. Campos omitidos ficam fora da atualização. Objetos de metadados enviados continuam sendo gravados integralmente.

O teste [n8n_broadcast_runtime.cjs](../../scripts/homolog/n8n_broadcast_runtime.cjs) roda o nó exportado **Processar Disparos** no n8n 2.44.5 isolado, com PGlite e Evolution simulada em `127.0.0.1`. Ele verifica que a campanha futura espera, que um bloqueio registrado após o enfileiramento é respeitado, que o envio gera o evento correto e que uma segunda execução não duplica a mensagem. O teste usa gatilho manual. A ligação ao gatilho de um minuto, a concorrência, a pausa e o cancelamento têm testes separados no conjunto `scripts/test_broadcast_*.cjs`. A detecção de opt-out com Gemini real fica pendente.

Para reverter o ajuste local do painel, restaure apenas o diff de `broadcastOperations.js` e do teste correspondente. O worker permanece igual e o roteiro de homologação pode ser removido separadamente. Campanhas e destinatários já gravados devem ser preservados.

## Validação e corte

1. Rode o gerador duas vezes e compare os hashes (`app/node_modules` é necessário: o gerador usa o TypeScript de lá). Execute `node scripts/validate_noria_release.cjs` e `node scripts/audit_anti_hardcode.cjs`.
2. Importe os três artefatos (mais o motor do Salon regenerado) em n8n isolado, com os IDs correspondentes: `node scripts/homolog/n8n_parent_runtime.cjs <bin-n8n>` com `NORIA_ROOT` apontando a raiz. O motor e o motor do Salon são observadores, exceto na suíte `engine`, que usa o motor real.
3. Antes de um corte autorizado, exporte o roteador, o motor, a EXT v2 e o motor do Salon ativos, com IDs, versões e configurações. Importe a EXT NORIA, anote o ID e gere o roteador com `NORIA_EXT_WORKFLOW_ID=<id>`. Confirme que nenhum outro chamador usa o motor com outro contrato.
4. O publicador `scripts/publish_nubia_v2.cjs` mantém a proteção `assertLegacyArchitecture`: recusa o roteador se alguma fase tiver o motor embutido, se as seis fases não chamarem o mesmo motor por ID real ou se a EXT NORIA tiver marcador ou o ID do motor. Ele busca o roteador vivo pelo **nome** do artefato: o nome novo exige a troca coordenada do título do workflow de produção.

## Corte em produção

Publicador: `scripts/publish_noria_cutover.cjs` (testes: `scripts/test_noria_cutover_publisher.cjs`, com servidor falso). Configuração por ambiente: `N8N_BASE_URL` e `N8N_API_KEY` (a chave nunca é impressa nem aceita por argumento; o script não lê `.env`). Ordem de aplicação: EXT NORIA (criar e ativar) → EXT Gênesis → EXT NB Bronze (renomeia) → motor do Salon → motor → roteador (já com o ID real da EXT NORIA no lugar do marcador ou do ID do artefato). `plan` é offline; `check` e `backup` só fazem GET; `apply` e `rollback` exigem `NORIA_PUBLISH_AUTHORIZED=1` e `--confirm=CORTE`. Nada disso foi executado em produção.

```
node scripts/publish_noria_cutover.cjs plan
node scripts/publish_noria_cutover.cjs backup                  # grava em %LOCALAPPDATA%\NoriaHomologacao\cutover-backups\<data-hora>\
node scripts/publish_noria_cutover.cjs check                   # deriva por workflow; sai com 1 se perderia credencial, webhookId ou caminho de webhook
NORIA_PUBLISH_AUTHORIZED=1 node scripts/publish_noria_cutover.cjs apply --backup=<pasta> --confirm=CORTE [--pause-router]
# verificação (abaixo)
NORIA_PUBLISH_AUTHORIZED=1 node scripts/publish_noria_cutover.cjs rollback --backup=<pasta> --confirm=CORTE
```

O `apply` recusa: sem autorização ou confirmação, sem backup, backup com mais de 120 min ou adulterado (sha256), versão viva diferente da do backup, `check` com bloqueio, EXT NORIA já existente. A cada passo ele relê o workflow (nome, nós, conexões, settings, ativo/versão ativa, `staticData`, tags). Do vivo preserva credenciais por nó, `webhookId`, `id` dos nós de mesmo nome, `settings`, `staticData` e tags (a chamada não envia `staticData` nem tags). O motor do Salon mantém o nome vivo. Em qualquer falha ele para e imprime o comando de rollback. O estado fica em `apply-state.json` dentro da pasta do backup. O `rollback` restaura, em ordem inversa (roteador, motor, Salon, NB Bronze, Gênesis), só o que o `apply` iniciou, e depois desativa e arquiva (não apaga) a EXT NORIA criada.

### Janela motor novo × roteador antigo

Entre o PUT do motor e o PUT do roteador há alguns segundos em que um turno do roteador antigo chega ao motor novo, que o recusa com `NORIA_ENGINE_CONTRACT_MISMATCH` (falha fechada, sem resposta ao cliente). O mesmo vale para o motor do Salon, que é trocado antes. Opções, sem decisão tomada:

1. Padrão (sem flag): roteador ativo durante a troca. Turnos que cheguem na janela falham fechados; se eles permanecem na fila e são reprocessados pela recuperação **não foi confirmado** (depende do estado da fila e do ponto da falha). Janela mais curta, nenhuma mensagem perde o webhook.
2. `--pause-router`: desativa o roteador antes do motor do Salon e o reativa depois do PUT do roteador. Elimina turnos recusados, mas enquanto o roteador está inativo o webhook da Evolution recebe erro; a mensagem só chega se a Evolution reenviar (não confirmado). Faça fora do horário de pico.

Em ambos os casos, a janela é reduzida executando `backup` e `check` antes e o `apply` logo em seguida.

### O que observar depois

- `apply` terminou com "APPLY CONCLUIDO" e imprimiu o ID da EXT NORIA; os seis workflows estão ativos com versão ativa igual à versão atual (a saída mostra versão e sha256 por passo).
- No painel do n8n, uma execução real de cada tenant (NORIA, Gênesis, I&C Salon): sem `NORIA_ENGINE_CONTRACT_MISMATCH`, sem `NORIA_ROTEAMENTO_*`, resposta enviada e evento salvo. Núbia v2 continua desligada por configuração.
- Webhooks `magia-whatsapp` e `magia-command` respondendo; `Processar Disparos` e follow-ups rodando no gatilho de 1 minuto.
- Fila de mensagens sem acúmulo e `gemini_*` do motor e `lifecycle_checked_at` do roteador ainda presentes em `staticData`.

### Critérios de rollback

Reverta se: o `apply` parar no meio; qualquer execução real falhar com `NORIA_ENGINE_CONTRACT_MISMATCH` ou erro de EXT fora da janela; credencial ou webhook deixar de funcionar; a fila acumular após 10 minutos; a EXT NORIA falhar a validação de tenant/canal. Rodar o `rollback` devolve motor e roteador juntos (o contrato exige isso). Preserve reservas, recibos e filas.

## Reversão

Se a homologação falhar, preserve os artefatos atuais do ambiente. O rollback restaura em conjunto o motor, o roteador anterior e, se tiver sido criada, remove a chamada à EXT NORIA, conforme os backups. A versão do roteador e a do motor precisam voltar juntas, pois o contrato de fase é verificado pelo motor. Preserve reservas, recibos e filas existentes. Se a v2 tiver sido habilitada por configuração, use o procedimento de [retorno ao contrato 1.0](nubia_v2_cutover.md) para novos lotes e conclua os turnos já fixados na versão 2.0.

## Medição no n8n 2.44.5 isolado (11/11/2026)

Servidor aquecido (webhook, 10 chamadas de aquecimento após o registro, 2 sessões × 40 amostras por perfil, todas com HTTP 200), na máquina de desenvolvimento (não no servidor de produção de 1 núcleo e 3,8 GB) e com task runner interno. "Leve" executa o gatilho e o item sem chamar o motor; "motor" leva o item terminal pela fase `single`. `dividido-motor` chama o sub-workflow REAL do motor (`baseline-motor` executa o motor inline, sem custo de sub-workflow).

| Perfil | Webhook mediana / p95 | Execução n8n mediana | Pico do processo pai (por sessão) | Pico do task runner (por sessão) |
| --- | --- | --- | --- | --- |
| arquitetura anterior, leve | 37,4 / 47,5 ms | 14 ms | 968 / 847 MB | 175 / 200 MB |
| arquitetura anterior, motor (inline) | 152,7 / 180,5 ms | 94 ms | 1039 / 955 MB | 419 / 419 MB |
| pai único (migração local), leve | 309,2 / 368,0 ms | 58 ms | 1671 / 1736 MB | 279 / 279 MB |
| pai único (migração local), motor | 455,8 / 552,1 ms | 172 ms | 1640 / 1647 MB | 322 / 322 MB |
| **dividido**, leve | 36,9 / 54,6 ms | 13 ms | 903 / 911 MB | 210 / 209 MB |
| **dividido**, motor (sub-workflow real) | 160,4 / 285,8 ms | 138,5 ms | 1040 / 882 MB | 436 / 431 MB |

Partida fria (`n8n execute`, 12 execuções por perfil): tempo total do processo, mediana, 10,05 s (anterior leve), 10,26 s (anterior motor), 10,31 s (pai único leve), 10,44 s (pai único motor), 10,03 s (dividido leve) e 10,28 s (dividido motor). Pico mediano do pai: 483, 498, 550, 563, 479 e 516 MB; do task runner: 153, 190, 188, 243, 153 e 186 MB.

Os resultados anteriores continuam em `%LOCALAPPDATA%\NoriaHomologacao\bench-parent\results`; os novos estão em `div-*.jsonl` da mesma pasta. A medição representa o custo de carregar e executar o grafo, não um turno completo com Gemini e Supabase reais.

# Correção local dos bugs P1 — 2026-11-21

Worktree `C:\noria-wt-bugs1`, branch `fix/bugs-p1-backend`, baseada em `dev`. Sem commit, push, publicação no n8n, aplicação de migração ou escrita em produção. Nenhuma dependência instalada.

## Alterações

1. **Núbia:** preparo, `what_to_bring` e `general_info` selecionam exclusivamente `validBlocks`. Blocos reprovados pela validação de preço/serviço não entram em `approved_blocks` nem nas chaves de `present_information`.
2. **Retail:** a auditoria recebe separadamente a intenção de enviar fotos (`photosPlanned`) e a ausência de envio confirmado (`photosSent: false`) durante a redação. O texto precede a mídia; afirmações de envio concluído provocam revisão. Formulações futuras explícitas continuam permitidas. Não foi acrescentada mensagem de confirmação posterior.
3. **Cadência dos disparos:** proposta e rollback em `supabase/migrations_pending_review/broadcast_pacing_v1*.PROPOSAL.sql`. A nova RPC reserva o canal do tenant antes do envio, com bloqueio transacional da linha de controle. A proposta preserva o maior `next_send_at` existente por tenant/canal. Recusas definitivas reenfileiráveis armam o intervalo na mesma transação; falhas definitivas agendam antes da pausa por falhas consecutivas. Pendências retornam `pending_review`, adiam a próxima tentativa e aparecem em `pacing_review_required`. O worker usa as novas RPCs; depende de implantação conjunta, ainda não autorizada nem realizada.
4. **Histórico:** falha do POST em `channel_events` aparece em `history_errors` no resultado do worker, com destinatário, ID da mensagem e erro limitado a 200 caracteres. A mensagem aceita pelo provedor não é reenviada por essa falha.

## Regressões antes da correção

- Núbia: fixture de preparo com `R$ 999` não autorizado falhou porque o bloco aparecia em `approved_blocks`. A regressão cobre os três tópicos e as chaves da ação.
- Retail: fonte original de `HEAD` carregada em memória, sem reverter arquivos, aceitou `Enviei a foto.` sem revisão antes de resultado desconhecido da mídia: uma chamada de redação, quando o teste exigia duas. A revisão independente também reproduziu a aceitação indevida de `Já encaminhei as fotos` e `Aqui estão as fotos`; novas regressões cobrem essas variantes.
- Cadência: com `BROADCAST_BASELINE=1`, as definições reais das migrações liberaram as duas campanhas (`sending`, `sending`), quando a regressão exigia uma liberação e um bloqueio. Com a proposta, a barreira persiste inclusive após simular a passagem de mais de 41 minutos sem confirmação.
- Histórico: a regressão esperava um erro registrado no resultado; a fonte anterior retornava `undefined` em vez de um erro. Depois da correção, o envio confirmado ocorre uma única vez e o erro aparece no relatório.
- Revisão adicional: os testes de preservação do horário existente e de agendamento após HTTP 429/400 falharam antes dos respectivos ajustes e passaram depois. A asserção temporal inicial era frágil sob a carga da suíte completa; agora compara os timestamps persistidos com o início capturado no próprio banco.

As funções preexistentes foram conferidas em `20261109192247_broadcast_production_alignment.sql` (`broadcast_mark_sending`), `20261109192323_broadcast_server_dispatch.sql` (claim/agendamento) e `20261109192425_broadcast_opt_out.sql` (`broadcast_begin_send`, com opt-out). As migrações canônicas não foram editadas.

## Validação

Resultados finais, todos verdes:

| Comando / conjunto | Resultado |
| --- | --- |
| `node scripts/validate_noria_release.cjs` | 722/722 |
| `node scripts/audit_anti_hardcode.cjs` | Sem padrões proibidos |
| `node --test scripts/test_nubia_extension_v2.cjs scripts/test_retail_pipeline_core.cjs scripts/test_noria_retail.cjs scripts/test_noria_services_pipeline.cjs scripts/test_broadcast_worker.cjs` | 135/135 |
| `node --test tests/features/broadcastPacing.test.js tests/features/broadcastWorkerRegression.test.js tests/features/broadcastServerQueue.test.js tests/features/broadcasts.test.js tests/unit/broadcastIdempotency.test.js` em `app/` | 23/23 |
| `npm test` em `app/` | 971/971 |
| `git -c core.safecrlf=false diff --check` | Sem erros |
| Build repetido e comparação SHA-256 dos artefatos listados no manifesto | Bytes idênticos |

As execuções anteriores durante a fase de regressões falharam nos casos descritos acima e, antes da regeneração, na paridade do build. Não há falha pendente nas execuções finais. A revisão independente verificou os diffs de Núbia, retail, worker, proposta e rollback; os achados introduzidos durante o incremento foram corrigidos.

O teste SQL usa as funções reais `broadcast_mark_sending` e `broadcast_begin_send`, com schema mínimo e configuração de proteção simulada. Duas chamadas são submetidas por `Promise.all`; uma única instância PGlite serializa sua execução. Isso comprova os estados e a barreira na simulação, mas não substitui teste multiprocessos de contenção dos locks em PostgreSQL real. Proposta e rollback foram executados apenas nesse banco efêmero.

## Workflows locais

Gerados na própria worktree com `NORIA_RETAIL_EXT_WORKFLOW_ID=vE8rPAAdzkkVzPBG node scripts/build_noria_workflows.cjs` (variável definida no ambiente do PowerShell).

Comparação por nó com os exports copiados no início:

| Workflow | Nó alterado | Motivo |
| --- | --- | --- |
| Motor compartilhado `mlKNPv862H2g3Gap` | `CORE \| Motor conversacional` | Auditoria retail e metadados do CORE |
| Roteador `3N5oN6sxtir9lFrA` | `Processar Disparos` | Worker com reserva antes do envio e erro de histórico visível |
| Núbia v2 `6jSiEH2ugboYSack` | `EXT \| Serviços Núbia v2` | Seleção de blocos validados |
| Salon `yxdKP0PeskDMUFSo` | `CORE \| Motor conversacional` | Apenas `built_at`, `core_sha256` e normalização dos finais de linha; lógica do Salon intacta |

As conexões dos workflows permaneceram idênticas na comparação. Os demais nós não mudaram. Os exports em `n8n/workflows/` continuam gitignored; os arquivos derivados versionados do CORE e o manifesto também foram regenerados.

## Limites e rollback

Validação exclusivamente local com fixtures e provedores simulados. Não comprova estado publicado, aceitação real do WhatsApp ou experiência de clientes. A auditoria retail usa padrões textuais e não garante cobertura semântica irrestrita.

O erro de histórico fica visível no resultado da execução, sem fila durável de reconciliação. Uma queda antes da tentativa de gravação continua exigindo investigação; o escopo deste incremento é tornar visível o erro observado, sem reenvio.

A reserva possui uma pendência persistente do destinatário. Interrupção após liberação do envio ou resultado desconhecido mantém o canal bloqueado, mesmo após expirar o horário reservado. Essa escolha privilegia o intervalo sobre a disponibilidade; exige reconciliação manual e pode bloquear o canal indefinidamente. Antes de qualquer futura liberação, pausar os workers do tenant/canal, identificar o destinatário pendente, conferir o resultado no provedor e nos registros e preservar o maior intervalo configurado desde o último envio possível. Nunca reenviar automaticamente uma entrega incerta.

A proposta exige atualização coordenada dos workers: a RPC anterior continua existindo e um worker antigo contorna a nova reserva. A implantação futura precisa de quiescência dos envios em voo, reconciliação dos envios antigos incertos e espera do maior intervalo configurado desde o último envio possível antes de habilitar o novo worker. O seed não identifica um envio antigo aceito antes de uma queda que ocorreu antes de gravar o próximo horário. O rollback remove as reservas; só retomar a versão anterior após o mesmo cuidado com resultados incertos e intervalo de segurança.

## Ordem obrigatória de publicação (revisão do orquestrador)

O worker (nó "Processar Disparos" do Roteador `3N5oN6sxtir9lFrA`) passa a chamar `broadcast_begin_send_paced` e `broadcast_requeue_recipient_paced`, que só existem na proposta `broadcast_pacing_v1.PROPOSAL.sql`. Siga esta ordem:

1. Aplicar a migração, com autorização.
2. Pausar os disparos em andamento e reconciliar os incertos.
3. Publicar o Roteador com o worker novo.

Se o Roteador for publicado antes do passo 1, **os disparos param**. As correções da Núbia e do retail (Motor e EXT Núbia v2) não dependem da migração e podem ser publicadas separadamente.

Risco operacional da proposta: um resultado incerto mantém o canal bloqueado até a reconciliação manual. Antes de ativar, combine com a operação quem reconcilia e por onde.

Rollback local: reverter apenas o diff deste incremento e regenerar os workflows. Os exports anteriores estão preservados em `.local/p1_exports_before/`. O rollback SQL é somente proposta e deve ser revisado junto com a versão do worker antes de qualquer operação futura.

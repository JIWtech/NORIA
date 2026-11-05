# NORIA — erros posteriores à publicação e inventário de migrações — 24/10/2026

## Resposta direta

Sim, ocorreram erros de atendimento depois da publicação das 01:15 BRT: seis eventos, em seis conversas diferentes. Cinco conversas têm mensagens posteriores de atendentes; uma continua sem resposta registrada. Isso não comprova resolução comercial das cinco, nem correção da causa técnica.

Não, nem todas as migrações locais estão aplicadas. Há alterações pendentes, versões antigas substituídas por outras e SQLs já efetivos que continuam na pasta `migrations_pending_review`. O nome da pasta e a ausência de registro no histórico não são suficientes para decidir se se deve executar um arquivo.

Esta rodada realizou consultas de leitura no n8n, Supabase e site público. A única correção nova foi no comando local de build dos follow-ups. Nenhuma migração, publicação, liberação de fila ou mensagem real foi executada.

## 1. Conversas desde 01:15 BRT

Consulta final às 11:11 BRT: seis eventos de erro desde a publicação, sem registros adicionais após 10:24:06. Respostas posteriores e filas conferidas nesta rodada.

| Tenant | Horário BRT | Erro observado | Atendimento posterior registrado |
|---|---|---|---|
| Gênesis | 08:31:07 | `INVALID_PRIMARY_REPLY;UNANSWERED_REQUEST:request_1` | Não. Último pedido: “Hornet 26”; fila em `review:explicit_technical_hold` |
| Núbia | 09:15:18 | HTTP 400 / `TURN_CONTROL_ORIGIN_REQUIRED` | Sim, atendente; última mensagem posterior às 09:23:15 |
| Núbia | 09:38:18 | HTTP 400 / `TURN_CONTROL_ORIGIN_REQUIRED` | Sim, atendente; última mensagem posterior às 10:03:29 |
| Núbia | 10:07:12 | HTTP 400 / `TURN_CONTROL_ORIGIN_REQUIRED` | Sim, atendente; houve nova mensagem humana posterior até 10:56:45 |
| Gênesis | 10:23:54 | `SEMANTIC_FACT_AUDIT_REQUIRED;UNSUPPORTED_FACT:official.product.color` | Sim, atendente às 10:34:27 |
| Gênesis | 10:24:06 | `INVALID_PRIMARY_REPLY;MISSING_RESPONSE_CONTRACT` | Sim, atendente às 10:34:11 |

Evento técnico que identifica a conversa ainda sem resposta: `1baa24f6-5841-4355-9058-e1a60bc86305`. Não foi liberada a IA nem feito replay dessa fila.

Os três erros 400 da Núbia foram correlacionados no PostgreSQL ao erro `TURN_CONTROL_ORIGIN_REQUIRED`, na RPC `magia_turn_suppression_status`. Os controles antigos anteriores aos erros eram mensagens manuais de 17/10 e 19/10 sem origem atestada. Mensagens humanas posteriores já têm origem registrada.

O bloqueio de cor da Gênesis é coerente com a fonte: o Onix está com `color = NULL`. A tentativa de reparação também foi rejeitada por afirmação sem suporte. Não se deve remover essa validação para responder com uma cor inventada.

### Estado das correções

- A separação dos serviços, catálogo e pós-venda para a EXT, feita na rodada anterior, continua local. Portanto essas mudanças ainda não corrigiram o comportamento da versão ativa.
- A leitura dos tokens PostgREST em envelopes serializados também está corrigida somente localmente. É uma melhora no diagnóstico/retry; não prova resolução dos controles históricos sem atestado.
- Respostas primárias vazias, contrato ausente e recuperação sem resposta válida continuam sendo problemas observados em produção.
- O n8n segue sem execuções `error`/`crashed` posteriores às 01:15. Os eventos acima demonstram que isso não equivale a ausência de erros: o CORE os trata e os registra internamente.

## 2. Follow-ups

Depois da publicação, foram encontrados 11 follow-ups enviados para a Núbia e três para a Gênesis. Nenhum saiu no intervalo proibido de 21:00 até antes de 06:00.

- Núbia: primeiro envio às 06:00:37.
- Gênesis: primeiro envio às 08:19:35.
- Nenhum job atualizado nessa janela estava com status `failed` ou `uncertain` na consulta.
- 48 jobs cancelados: 41 por `conversation_control_changed` e sete por `human_operator_activity`. Esses cancelamentos são controle de atendimento, não erros de envio.

## 3. Revisão dos workflows

Os quatro workflows ativos e os IDs referenciados pelos nós de subworkflow foram conferidos. As versões de entrada, Motor e Gênesis continuam as mesmas da publicação anterior:

| Workflow | ID | Versão ativa |
|---|---|---|
| Entrada | `3N5oN6sxtir9lFrA` | `e95f9020-a88f-4603-b1e4-8ce225293c4a` |
| Motor | `mlKNPv862H2g3Gap` | `eebbab87-35c5-456c-9327-0e2d6cc0265a` |
| EXT Gênesis | `fXGorIlPbyf9Qtsp` | `201abb2b-e872-461e-924d-e0544bf20b8e` |
| EXT Núbia ativa | `vCDXJLqIBCZJRTVv` | `5d545c63-9e38-4325-aa2a-b6bf93ecd546` |

A EXT Núbia ativa corresponde ao arquivo `NORIA EXT _ NB Bronze _ Política de negócio v2.json`; parâmetros dos nós e conexões coincidem com produção. O arquivo `NORIA EXT _ NB Bronze _ Serviços v2.json` é outro candidato, sem ID publicado e marcado como inativo. Não deve ser confundido com a EXT em uso.

### Inconsistências encontradas

1. Permanecem 94 linhas com comparações diretas entre `tenantSlug` e `wesley_automoveis` no CORE local, fora dos fluxos corrigidos anteriormente. O arquivo inteiro ainda não está conforme a separação CORE × EXT.
2. `scripts/build_whatsapp_follow_up_workflow.cjs` tentava abrir `n8n/workflows/magia_whatsapp_follow_up.json`, que já não existe. Corrigido localmente para chamar `build_noria_workflows.cjs`, que projeta o despachante no CORE compartilhado.
3. A função SQL ativa `magia_sales_followup_eligible` contém ramificações ligadas à regra `deposit_20_and_financing_documents_v2`, enquanto o tenant usa `deposit_30_and_financing_documents_v1`. Isso cria um desalinhamento legado para a elegibilidade de etapas warm/cold. Não havia leads ativos em `awaiting_customer` nessas etapas atualizados desde a publicação na consulta; portanto não se comprovou um novo atendimento afetado por esse ponto. Não foi alterada a política comercial por suposição.
4. A pasta de migrações contém prefixos repetidos `013`, `019`, `023` e `024`, incompatíveis com a expectativa de identificar cada migração apenas pelo prefixo. Não foi executado um push em massa.
5. Comentários como “NÃO EXECUTADO” e “PROPOSTA” permaneceram em SQLs cujo conteúdo já está ativo, inclusive storage e prompts. A documentação de estado está defasada.

Validação da correção do comando de build: execução com código de saída zero, mesmos hashes dos artefatos antes/depois, 15 testes passando de build/idempotência e follow-up, `git diff --check` limpo.

## 4. Inventário de migrações

- `supabase/migrations`: 36 arquivos SQL.
- `supabase/migrations_pending_review`: 20 arquivos SQL, sendo 15 alterações e cinco rollbacks.
- Histórico remoto: 34 registros. Os números não são diretamente comparáveis: nomes, versões antigas e aplicações por SQL diferem do layout local.

A conferência combinou histórico, existência de objetos, configurações atuais e comparação dos corpos de funções ignorando comentários/espaços. Isso confirma o conteúdo funcional indicado abaixo, mas não certifica automaticamente todos os efeitos históricos de cada arquivo, seus grants ou backfills.

### Alterações da pasta pending_review

| Arquivo | Evidência atual / estado |
|---|---|
| `20261017180000_genesis_inventory_vehicle_images.sql` | Registrada como `20261020013518`, tabela existente |
| `20261017190000_enable_sales_leads_realtime_optional.sql` | **Não aplicada:** `sales_leads` não está na publicação `supabase_realtime`; replica identity continua `default` |
| `20261019210000_sales_assignment_preserves_human_stage.sql` | Registrada; os corpos das duas funções coincidem com o arquivo |
| `20261020010000_gemini_tenant_daily_budget.sql` | Registrada; corpo de `magia_gemini_reserve` coincide |
| `20261021000000_genesis_follow_up_disposition_actions.PROPOSAL.sql` | **Não aplicada:** `sales_follow_up.disposition_actions` está ausente. A EXT retorna `undecided` para essas ações sem configuração |
| `channel_media_exact_tenant_scope.PROPOSAL.sql` | Aplicada e registrada como `20261024025505`; política autenticada com comparação exata de segmento e sem `LIKE` |
| `genesis_catalog_presentation_and_sourcing.sql` | Efeitos presentes: limite de três itens com critério e serviço `busca_veiculo`; o texto original foi atualizado depois |
| `genesis_human_services_copy_20261024.sql` | Textos atuais correspondem à correção de disponibilidade condicional e documentação |
| `genesis_human_services_despachante.sql` | O serviço existe, mas a confirmação original foi substituída pelo texto atual; não usar como restauração da versão atual |
| `genesis_prompt_v14_21_photos_no_error.sql` | Proposta/revisão antiga, superada pelo prompt v14.25 atual; não reaplicar sobre o prompt mais recente |
| `prompt_contract_alignment_20261023.sql` | MD5 atual da Gênesis `27c031b5858c0c141588d4205b63143b` e Núbia `d7601f67881365a8ba2bd463d99a6321` correspondem aos prompts aplicados |
| `turn_control_fromme_manual_reply_v1.sql` | Corpos das três funções coincidem com produção. Sem registro nominal no histórico; não se certifica a execução integral do backfill só por isso. Eventos históricos sem prova continuam exigindo reconciliação |
| `turn_queue_closure_recovery_v1.sql` | Registrada; corpos das quatro funções coincidem |
| `turn_queue_lifecycle_v1.sql` | Registrada; 20 de 26 corpos coincidem. Seis foram alterados por patches posteriores. Reaplicar o arquivo inteiro pode sobrescrever correções de controle, retry e encerramento |
| `turn_queue_retry_provisioning_v1.sql` | Registrada; corpos das duas funções coincidem |

Os cinco arquivos de rollback não são pendências de implantação. Executá-los desfaz mudanças.

### Outras duas pendências comprovadas em migrations/

| Arquivo | Objeto ausente | Uso / impacto observado |
|---|---|---|
| `023_kanban_column_order_rpc.sql` | `public.reorder_kanban_columns` | RPC não existe. Nenhuma chamada com esse nome foi encontrada no frontend local; não se comprovou erro atual de atendimento por isso |
| `029_self_service_tenant_onboarding.sql` | `public.magia_create_tenant_onboarding` | O frontend local chama a RPC em `authService.js`. Há uma dependência de banco faltante para esse fluxo local. O bundle principal do site público consultado não contém o nome da RPC; não foi validado todo o fluxo online de cadastro |

As demais funções identificadas nos SQLs locais foram encontradas no catálogo de funções. Isso não significa que todos os arquivos tenham sido aplicados integralmente: diversas definições foram substituídas por revisões posteriores, e o histórico não segue integralmente os nomes locais.

Prefixos duplicados:

- `013`: Kanban padrão e alinhamento de segurança.
- `019`: sessões de atendimento/agendamento e follow-ups.
- `023`: controles de campanha, acesso a follow-ups e ordem do Kanban.
- `024`: leituras de conversas e áudio da Núbia.

## 5. Prioridade de tratamento

1. Atender/reconciliar a conversa “Hornet 26”, preservando o estado e a prova de envio. Nenhum replay automático foi feito.
2. Publicar, em uma etapa explicitamente autorizada, o bloco local CORE × EXT já validado e o diagnóstico PostgREST. Isso não resolve por si só os contratos vazios do modelo ou controles históricos sem origem.
3. Investigar a geração/recuperação que terminou sem contrato ou resposta válida, sem enfraquecer a auditoria de fatos.
4. Decidir as pendências comerciais/operacionais de follow-up e Realtime; revisar as RPCs ausentes antes do uso correspondente.
5. Consolidar a governança das migrações com revisões futuras únicas, preservando o histórico remoto e sem reaplicar SQLs antigos em massa.

Nenhuma das quatro pendências comprovadas autoriza aplicar automaticamente os 56 arquivos SQL. Uma execução indiscriminada incluiria rollbacks e versões antigas de funções/prompt.

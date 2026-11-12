# EXT Núbia v2 — contrato semântico de serviços e decisão comercial

Status: **EXT v2 e infraestrutura do CORE implementadas localmente; inativas, não conectadas, não publicadas.** Fonte: `n8n/sources/nubia_extension.js`.
Verificações locais: `node --test scripts/test_nubia_extension_v2.cjs`.

Regra: Gemini interpreta · EXT Núbia decide · CORE orquestra e executa · banco valida · auditor verifica.

## O que existe hoje e o que falta

| Já funciona | Ainda não existe (próxima etapa, no CORE) |
|---|---|
| EXT v2 lê o Supabase (somente GET), valida identidade/turno/evidências e devolve a decisão | Rota no workflow para executar a EXT v2 |
| Testes locais da EXT com `httpRequest` falso | Schema Gemini do contrato semântico de serviços no CORE |
| EXT v1 (`nb_bronze_v1`, contrato `1.0`, fase `single`) intacta em produção | Fase prepare → decisão → finalize para capacidade não-vendas |
| | Execução, pelo CORE, das ações autorizadas; auditor da resposta final |
| | Feature flag, modo sombra e rollback (não existem; nada disso é afirmado aqui) |

## Contratos

### `noria_services_semantic_intent_v1` (Gemini → EXT)
Todo item acionável exige `evidence_ids` que existam em `turn.messages` (turno atual) ou `session_evidence` (histórico).
Histórico sozinho nunca autoriza ação nova: intenções acionáveis e papéis `interested|selected|booking_target`, pagamento, humano, correção
e disposição exigem ao menos uma evidência do turno atual. Evidência de histórico vale só se constar em `session_evidence` (sessão atual, carimbada pelo CORE); o modelo não precisa ecoar `session_id` e um `session_id` explícito de outra sessão é recusado.

| Campo | Conteúdo |
|---|---|
| `primary_intent`, `secondary_intents` | `info_inquiry`, `comparison`, `availability_request`, `booking_intent`, `slot_change`, `reschedule`, `cancellation`, `payment_report`, `human_request`, `complaint`, `other`, `ambiguous` |
| `services[]` | `{service_id, role, evidence_ids}`; `role`: `mentioned`, `asked_about`, `compared`, `interested`, `selected`, `booking_target`. `service_id` deve existir em `tenant_service_catalog` |
| `info_requests[]` | `{topic, service_ids, evidence_ids}`; `topic`: `presentation`, `price`, `preparation`, `what_to_bring`, `general_info`, `catalog`, `location`, `payment_terms` |
| `slots` | `{unit_id, date (AAAA-MM-DD), time (HH:MM), customer_name, evidence_ids, name_evidence_ids}`; o nome é provado por `name_evidence_ids` (mensagem do cliente que o contém literalmente) |
| `payment` | `{declared, evidence_ids}` |
| `human` | `{requested, evidence_ids}` |
| `conversation` | `{topic_change, requires_clarification, intent_correction:{corrects_previous, evidence_ids}}` |
| `customer_disposition` | `{value: active|declined|closed_by_customer|resolved, evidence_ids}` |
| `ambiguities[]` | `{kind: service|date|time|unit|other, candidate_service_ids}` |
| `confidence` | `low|medium|high`; `low`, ambiguidade ou `requires_clarification` bloqueiam qualquer ação |

Semântica inválida (campo ausente, serviço desconhecido, evidência inexistente ou fora do turno) → decisão `refused`, nenhuma ação autorizada.

### `noria_services_decision_v2` (EXT → CORE)
Envelope idêntico ao da Gênesis: `{...input, noria_phase:'finalize', commercial_decision, commercial_decision_status, commercial_decision_error, commercial_identity}`.
- Falha de identidade, versão, turno, tenant, instância ou fonte → `commercial_decision_status: 'error'`, decisão `null`.
- Semântica inválida → `commercial_decision_status: 'refused'`; o CORE não executa nenhum efeito.
- `'ok'` → decisão válida; `actions.*.allowed` define o que o CORE pode executar.

Campos: identidade (`tenant_id`, `tenant_slug`, `instance`, `remote_jid`, `session_id`, `request_id`, `turn_token`), `noria_contract_version: '2.0'`,
`provenance: 'nubia_extension_commercial_decide_v1'`, `config`, `semantic` (resumo), `services[]` (papéis preservados, `offerable`, `price`, `schedulable_by`),
`facts[]` (`fact_id`, `value`, `source`), `approved_blocks[]` (chave, finalidade, `literal: true`; o texto é lido pelo CORE), `reservation_state[]`,
`actions`, `follow_up`, `reason_codes`, `evidence_used`.

`actions`: `present_information`, `check_availability`, `create_reservation`, `forward_payment_declaration`, `confirm_payment` (sempre `allowed:false`), `handoff`.

### Entrada esperada do CORE (`noria_phase: 'commercial_decision'`)
- Identidade: `tenant_id`, `tenant_slug`, `noria_extension:'nubia'`, `noria_contract_version:'2.0'`, `instance`, `remoteJid`.
- `turn` = claim de `magia_claim_turn`: `{claimed:true, contract:'noria_turn_lifecycle_v1', token (uuid), boundary_id, instance, tenant_slug, messages:[{event_id,text}]}`.
- `noria_business_context:{session_id, request_id}` com `session_id = turn.boundary_id` e **`request_id = <event_id da última mensagem do turno>:<token>`**, exatamente como o despachante do CORE o compõe (hoje só no nó `CORE | Preparar dispatch Genesis`). A EXT confere cada componente (token uuid, contrato do claim, slug e instância do claim, última mensagem); não basta o sufixo.
- `semantic_intent`.
- `session_evidence:[{id, text, direction:'inbound', sender_type:'contact', session_id}]`: histórico da sessão atual. Itens de outra sessão, de saída ou de outra origem são descartados; qualquer evidência que os cite falha como `EVIDENCE_UNKNOWN`.
- `reservations:[{id,status,service_id,requested_date,requested_time,starts_at}]`.
- `availability` (saída da RPC executada pelo CORE neste turno, ver "Reserva").

## Regras de decisão

- **Fontes**: `tenants`, `channels`, `tenant_settings.settings` (`appointment_scheduling`, `approved_messages`, `business_facts`, `payment`, `payment_signal_enabled`, `appointment_payment_trigger`, `attendance_lifecycle`, `handoff_rules`, `commercial_follow_up`), `tenant_service_catalog`, `follow_up_policies`. Nada comercial é constante da EXT.
- **Preço**: só serviço ativo com preço válido é `offerable`. Capacidade nunca é emitida (autoridade: RPC); a divergência de capacidade do catálogo é ignorada de propósito.
- **Bloco aprovado**: só é autorizado se `approved_messages` estiver habilitado com `revision`, e cada `service_id` do bloco tiver preço igual ao do catálogo vivo e em `catalog_prices`, e os valores `R$` do texto pertencerem aos serviços do bloco. Escolha por associação bloco↔serviço (menor bloco que cobre os serviços; empate → nenhum, `AMBIGUOUS_APPROVED_BLOCK`); preparo/o que levar por `service_guidance.<grupo>.before_message|bring_message`. Nenhum nome de chave é fixo.
- **Agendável por IA** (`schedulable_by: ai`): serviço ativo + `service_resources` + capacidade ≥ 1 em alguma unidade + agenda habilitada + grupo de orientação sem `booking: human`. Caso contrário `human` (handoff) ou `none` (inativo).
- **Disponibilidade**: autorizada com serviço-alvo único (`selected`/`booking_target` com evidência atual), unidade válida e data. A EXT não consulta a RPC.
- **Reserva**: exige `booking_intent` com evidência do turno atual, horário, nome completo e `availability` presa a `tenant_id`, `remote_jid`, `session_id`, `request_id`, `turn_token`, `unit_id`, `service_id`, `date` e `time`, com o horário em `available_starts`. A decisão traz `idempotency_key` (`whatsapp:<event_id>`), `completion_claim_allowed:false` e `completion_requires:'rpc_receipt_with_appointment_id'`: a RPC continua sendo a autoridade final de concorrência e capacidade, e "reservado" só pode ser dito com o recibo dela.
- **Nome**: `slots.name_evidence_ids` aponta a mensagem do cliente (turno atual ou histórico da mesma sessão) que contém o nome literalmente. Nome inferido pelo modelo, de outra sessão ou de mensagem do assistente é recusado. A intenção de reservar continua exigindo evidência do turno atual.
- **Pagamento**: `forward_payment_declaration` só com exatamente uma reserva pendente. Comando configurado (`appointment_payment_trigger`) é comparado literalmente por linha, sem frases fixas; "fiz o Pix" depende de `payment.declared` do Gemini. Várias pendências, nenhuma ou pagamento desabilitado → não encaminha e pede handoff conforme o caso. Confirmar é sempre humano.
- **Handoff**: pedido explícito, reclamação, cancelamento, remarcação (sem operação automática), serviço de agendamento humano/sem recurso, pagamento a verificar.
- **Follow-up** (`keep|cancel|none`): `none` em fluxo de reserva/pagamento/handoff ou sem configuração. Só devolve `keep`/`cancel` se `settings.commercial_follow_up.disposition_actions[<disposição>]` existir (chave nova, ainda não configurada → hoje sempre `none`). Não cria nem cancela jobs; as proteções do banco continuam sendo a defesa.

## Integração com o CORE — infraestrutura implementada, INATIVA

Implementado localmente (nada publicado, nada ativado): seleção por capacidade, despachante genérico, fases `prepare` / `availability` / `finalize` no CORE, geração da EXT v2 e da cadeia de nós (desabilitada e sem conexão com o grafo ao vivo). O caminho `single` da Núbia (EXT v1, contrato `1.0`) e o ciclo da Gênesis não foram alterados.

### Seleção explícita (inativa por padrão)
O pipeline só é usado quando `tenant_settings.settings.noria_turn_pipeline` existe, tem `enabled:true` e repete **exatamente** o que a política da EXT declara em `modules.turn_pipeline` (`contract`, `capability`, `contract_version`, `semantic_contract`, `decision_contract`, `decision_provenance`), e o `noria_contract_version` do pedido é o mesmo. Ausente ou `enabled:false` → legado. Habilitado e inconsistente → erro `NORIA_TURN_PIPELINE_CONFIG_INVALID` (sem fallback silencioso). Combinado com vendas → `NORIA_TURN_PIPELINE_CONFLICT`. Hoje **nenhuma** configuração do Supabase foi alterada; portanto nenhum tenant seleciona o pipeline.

### Sequência
`bootstrap (EXT: política)` → `dispatch genérico (1 claim)` → `prepare (CORE + Gemini semântico)` → `EXT decide #1` → `availability (CORE lê magia_appointment_availability só se autorizado e monta a prova)` → `EXT decide #2` → `finalize (verifica a decisão, commit, executa reserva/pagamento autorizados, compõe a resposta, entrega, finaliza a fila)`.

- O despachante (`n8n/sources/noria_turn_dispatch.js`) faz pré-voo do ciclo de vida, **um** `magia_claim_turn`, confere tenant/instância do claim e compõe `request_id = <último event_id>:<token>`. Recusa turno já reivindicado. Uma fase do pipeline sem claim prévio falha (`NORIA_TURN_PIPELINE_REQUIRES_PRECLAIMED_TURN`); o CORE nunca reivindica por conta própria.
- `availability` é só leitura: sem `commit`, sem envio, sem segundo claim. A prova vincula tenant, conversa, sessão, request, token, unidade, serviço, data e horário. Não é concessão de capacidade; a autoridade é `magia_reserve_session_appointment`.
- `finalize` verifica identidade, versão e proveniência da decisão **antes** do `commit()` e só executa depois dele. `idempotency_key` (`whatsapp:<último event_id>`) é recomputado pelo CORE e deve coincidir com o `p_request` que a RPC receberá.
- **Chamada adicional ao Gemini (necessária):** a resposta final precisa refletir o resultado real da RPC, então há uma 2ª chamada (composição) em `runServicesTurnFinalize`, depois da execução e antes do envio. A 1ª (interpretação semântica) fica em `prepare`. Não há outras. A composição só pode usar `decision.facts` e `decision.approved_blocks` (texto literal anexado pelo CORE) e é recusada se declarar pagamento confirmado, reserva sem recibo ou disponibilidade sem prova; nesse caso sai a contingência operacional neutra com handoff.
- O **auditor** (`audit.status: not_implemented`) ainda não existe; ele deve verificar o texto final contra `facts[]` e `approved_blocks[]`.

### Auditor, recibo e homologação (etapa 5)
- **Composição tipada.** A 2ª chamada ao Gemini devolve `reply`, `block_keys` e `claims[]` com `kind` ∈ `fact`, `slot`, `reservation`, `payment`, `handoff`, `preparation`. Cada `kind` é conferido na sua autoridade por `servicesAudit` (CORE, determinístico, **sem terceira chamada**): `fact` → `decision.facts`; `slot` → `available_starts` da prova deste request ou o horário reservado; `reservation: completed` → recibo da RPC; `payment: awaiting_verification` → encaminhamento realmente feito (`confirmed` é sempre recusado); `handoff: announced` → handoff executado; `preparation` → bloco autorizado pela EXT **para os serviços da conversa** (`approved_blocks[].applies_to_service_ids`). O recibo e o encaminhamento de pagamento precisam ser informados. Valores `R$`, horários e datas da prosa são lidos tecnicamente e precisam pertencer a essas mesmas autoridades.
- **Afirmações omitidas de `claims[]` (etapa 6).** Depois da auditoria determinística, `servicesSemanticAudit` faz **uma** chamada independente: recebe só a resposta final e as autoridades (nunca os `claims`), lista toda afirmação factual ou promessa (preço, serviço, horário, reserva, pagamento, handoff, preparo, condições, **saúde/segurança**, **promessa de resultado**) e cita a autoridade que a sustenta. O CORE confere de forma determinística que a autoridade citada existe e é de um tipo permitido para a categoria (`SERVICES_SUPPORT_RULES`); afirmação sem fonte, relatório incompleto (`covers_entire_reply:false`) ou chamada que falha → rejeita (fail closed) e entrega a contingência neutra com handoff. Justificativa da 3ª chamada: omissões só se detectam lendo a prosa. Controles: roda uma vez por turno, só se a determinística aprovou e há prosa, sem persona, temperatura 0, thinking 256. Custo/latência: +1 chamada curta por resposta. Limite: a cobertura depende do auditor listar tudo; o teste com modelo real (`--mode=real`) é o que mede isso.
- **Público (`audience`).** Os fatos `audience.exclusive_to`/`audience.policy` só são emitidos quando o Gemini registra `info_requests.topic=audience` (a cliente tratou de elegibilidade) ou quando há bloqueio de público (`booking.block_message`); nunca por padrão.
- **Tema sem fonte.** `health_or_safety` é um tópico do vocabulário da EXT; como nenhuma configuração do tenant autoriza afirmações sobre saúde/segurança, a EXT não apresenta nada e exige handoff (`NO_AUTHORIZED_SOURCE_FOR_TOPIC`).
- **Recibo recuperável (etapa 6).** A linha de `appointments` (`metadata.reservation_request = whatsapp:<último event_id do lote que autorizou>`) é o recibo durável; `magia_reserve_session_appointment` segue como autoridade de capacidade e idempotência. Um turno reprocessado reivindica o MESMO lote de mensagens (mais as novas que chegaram), então a chave original está sempre entre as chaves do lote: o `finalize` procura o recibo por **todas** as chaves `whatsapp:<event_id>` do lote, antes de qualquer RPC, e relata `recovered`. Uma reserva por lote: se a decisão atual quiser outra reserva diferente da recuperada, nada novo é reservado e um humano decide (`NEW_REQUEST_DIFFERS_FROM_RECOVERED_RECEIPT`). O encaminhamento de pagamento usa o marcador `payment_report_request` com a mesma regra de lote. Limite real do contrato do banco: a RPC grava só `reservation_request` (sem `request_id`, token nem identidade do turno; `p_notes` é texto livre visível), então o vínculo com o turno é `event_id` + conversa + sessão; não alterei SQL.
- **Ciclo da fila.** `commit()` apenas faz o fence (processing→sending). Falha antes de `begin_turn_delivery` e retentável → `ready` (re-claim); depois do início da entrega → `uncertain` (nunca reenvia); erros não classificados → `review` (manual). Falha da composição ou rejeição do auditor entrega a contingência operacional neutra com handoff e **não** apaga o recibo.
- **Homologação local.** `node scripts/homolog/services_executor.cjs` executa as fases reais (EXT bootstrap → despachante → prepare → EXT → availability → EXT → finalize) com Gemini, Supabase, RPCs de agenda e Evolution simulados: consulta informativa, reserva legítima, falha após a reserva (composição, falha retentável com re-claim, entrega incerta), pedido ambíguo, horário indisponível e rejeições do auditor.

### O que continua faltando antes de ativar a Núbia v2
1. Preencher o ID real do workflow `NORIA EXT | NB Bronze | Serviços v2` nos nós de execução da cadeia e habilitar/conectar a cadeia (hoje desabilitada).
2. Rotear a Núbia para a cadeia (hoje o roteador usa `byTenant` fixo e contrato `1.0`) com seleção explícita e rollback definidos; nada disso existe.
3. Configurar `noria_turn_pipeline` em `tenant_settings` (decisão de configuração).
4. Revisar o auditor frente à necessidade de uma auditoria semântica (3ª chamada) e rodar o executor de serviços também com um modelo real em ambiente autorizado.
5. Rever o fluxo de pagamento do CORE legado (`SINAL PAGO` literal) frente à decisão da EXT antes de desligar o legado.

### Homologação com Gemini real (etapa 6)
`node scripts/homolog/services_executor.cjs --mode=real [--only=A|B|C|D]` roda as 4 conversas (comparação; nome→Comfort→horário→reserva; mudança de assunto; saúde/segurança, com uma variante adversarial em que o redator é trocado por uma resposta insegura sem `claims` para o auditor real avaliar). Só o Gemini pode sair do processo; exige `HOMOLOG_GEMINI_AUTHORIZED=1` e `HOMOLOG_GEMINI_KEY` dedicada e diferente de qualquer chave do projeto; sem isso encerra com código 3 sem rede. `--mode=dry` registra os pedidos exatos sem enviar.

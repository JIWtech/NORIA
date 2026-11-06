# Plano técnico: coluna "Confirmar agendamento"

Data: 06/11/2026, revisado contra o código e o banco de produção no mesmo dia. Base: `dev` em `18f62cc`.
Primeiro cliente: I&C Salon (`ic_salon`). Situação: migração 031 e CORE autorizados em 06/11/2026. Banco, CORE, comandos e painel implementados na `dev` local, sem commit. Nada foi aplicado em produção nem publicado. A seção 10 traz o que falta.

## 1. Objetivo

Quando a IA conduzir a conversa até o ponto de marcar, o pedido vai para a coluna **Confirmar agendamento**. O dono confere e confirma com um ou dois cliques, e a cliente recebe a mensagem de confirmação.

Enquanto o pedido espera, a IA continua ativa. Ela responde que a equipe vai confirmar, atualiza o pedido se a cliente mudar serviço, data ou horário, e cancela o pedido se a cliente desistir.

A IA nunca confirma horário. Reclamação, alergia e pedido de atendente continuam travando a IA e levam a conversa para **Aguardando humano**, mesmo com pedido aberto.

**Fora da primeira versão:** escolha de profissional com bloqueio de agenda, edição do pedido pelo dono no card, tela para editar as mensagens e lembrete de 24 horas.

## 2. O que o código e o banco mostram hoje

### Caminho do I&C

O I&C não tem `grounding_mode`, não tem `noria_turn_pipeline` e não tem `appointment_scheduling`. Portanto, ele passa pelo caminho legado de turno único: o texto livre do Gemini, com tags, é lido em `noria_core.js:14641`. Esse caminho não passa pelas auditorias dos caminhos `canonical_v2` e `services`.

### Trava da IA

| Fato | Onde | Consequência |
|---|---|---|
| Quem decide a trava é o banco, não o JS. `conversationControl` é sobrescrito pela prova do turno | `noria_core.js:14409`, `magia_turn_suppression_status`, `magia_turn_control_evidence` | Os testes precisam cobrir as funções SQL, não só o JS |
| Saída com `handoff: true` e entrega confirmada trava a conversa | `magia_turn_control_evidence` | O pedido pendente não pode gravar `handoff: true`. Foi isso que deixou o "Ok" das 20:45 e o "Oi" das 21:03 sem resposta |
| `appointment_payment_confirmed` é um serviço de controle no banco, e o evento da confirmação de sinal grava `handoff: true` | `command_router.js:123` e `:397`, funções acima | O novo comando precisa de serviço próprio, sem `handoff`. Não pode copiar o evento do sinal |
| Mensagem de operador trava, inclusive digitada no chat do painel | `isHumanOutbound`, `noria_core.js:1905` | "Sugerir outro horário" precisa ser comando, não apenas abrir o chat |
| O eco `fromMe` vira `manual_reply`, e a exclusão só reconhece `sender_type='assistant'` | `magia_capture_authenticated_control`, nó "Capturar Resposta Manual WhatsApp" | Medido em 06/11: das ~490 mensagens enviadas pela API em 7 dias, nenhuma voltou como `fromMe`. O gatilho não muda. Conferir na homologação |

### Criação e leitura do agendamento

| Fato | Onde | Consequência |
|---|---|---|
| Sem `default_ai_appointment_status`, a tag cria `pending_payment`, e `pending_confirmation` não está na lista de status permitidos | `noria_core.js:2071-2078` | Hoje a tag nasceria aguardando sinal. O modo novo precisa de um caminho próprio de gravação |
| Após gravar, o CORE substitui o texto da IA por uma frase fixa e usa o estágio "Agendamento confirmado" | `noria_core.js:14664-14668` | Sem mudança, a cliente leria que o agendamento foi registrado, e o painel mostraria "confirmado" |
| Status na lista `active` aparece para a IA como `confirmado` e gera "Encontrei ... confirmado" | `noria_core.js:1968`, `:2149`, `:2817` | **`pending_confirmation` não pode entrar nessa lista.** O pedido precisa de campo próprio no contexto |
| `loadAppointments` só lê agendamentos futuros criados depois do início da sessão | `noria_core.js:1950` | Pedido antigo ou com horário vencido fica invisível para a IA. O pedido aberto precisa de leitura própria |
| A checagem de duplicidade compara apenas o mesmo horário exato | `noria_core.js:2080` | Ela não impede dois pedidos abertos na mesma conversa |
| A tag só carrega nome, um serviço, data, hora, duração e status | `parseAppointmentCreationTag`, `noria_core.js:1988` | Vários serviços, profissional preferido e primeira vez ainda não existem na tag |
| O prompt do I&C proíbe a tag e aceita "dia ou período preferido" | `tenant_settings.system_prompt` | O prompt muda junto com o modo, e só pedido com data e hora exatas entra na coluna |

### Banco e painel

| Fato | Onde | Consequência |
|---|---|---|
| `appointments.status` não tem CHECK | banco, verificado em 06/11 | O status novo não exige mudar restrição |
| Migrações 018 e 019 e o follow-up (021) listam só os status encerrados | SQL | O status novo já conta como ativo, e o follow-up é cancelado sem alteração nessas funções |
| Migração 030 usa lista fechada de status abertos | `magia_mark_appointment_outcome` | Pedido pendente não recebe "Compareceu" nem "Não veio". Fica assim, com teste |
| A trava de capacidade não atua sem `appointment_scheduling` | `magia_appointment_capacity_guard` | O I&C não tem proteção contra dupla marcação |
| O catálogo tem `estimated_hours` em 11 de 21 serviços ativos | `tenant_service_catalog` | A duração pode faltar. O valor da tag não é fonte confiável |
| Um cartão de agendamento só assume a coluna se for mais recente que o último evento da conversa | `eventsToKanban.js:328` | No primeiro "Ok" da cliente, o cartão sairia da coluna. O pedido aberto precisa de prioridade |
| A aba carrega só os 200 primeiros agendamentos em ordem crescente | `clients/ic_saloon/PENDENCIAS.md` | Pedidos pendentes precisam de consulta própria |

## 3. Decisões técnicas

### Estados

Novo status: `pending_confirmation`. O nome não colide com status existente.

```text
(sem pedido)         -> pending_confirmation   a IA registra
pending_confirmation -> pending_confirmation   a cliente muda dados (versão + 1)
pending_confirmation -> confirmed              o dono confirma
pending_confirmation -> cancelled              a cliente desiste, ou o dono recusa o horário
```

Cada transição fica em `metadata`, com autor e horário. Pedido cancelado continua no histórico.

**Depois de confirmado:** a IA continua ativa, mas não altera nem cancela o agendamento. Se a cliente pedir mudança, a IA chama a equipe e a conversa vai para **Aguardando humano**. Isso segue o critério do pedido de atendente, e uma mudança de agendamento confirmado é decisão do dono.

**Novo agendamento na mesma conversa:** é permitido depois de confirmar o anterior. A regra limita a um pedido **aberto** por conversa.

**Conversa encerrada com pedido aberto:** o pedido não é cancelado sozinho, continua na coluna e o dono decide. Se a cliente voltar em nova sessão, a IA enxerga o pedido pela leitura própria.

### Ativação por tenant

Nova configuração genérica, desligada por padrão:

```json
{
  "appointment_request": {
    "mode": "operator_confirmation",
    "received_template": "...",
    "confirmation_template": "...",
    "slot_rejected_template": "...",
    "stale_alert_hours": 4
  }
}
```

Nenhum `if` por tenant no CORE. Os textos ficam só na configuração do tenant, e o código não tem texto padrão. Se faltar modelo, o modo é inválido e nada é gravado.

O modo só vale no caminho legado. Com `grounding_mode`, `noria_turn_pipeline` ou `appointment_scheduling` ativos, a configuração é recusada com erro explícito. Assim, Gênesis e Núbia não entram nesse caminho por engano.

A configuração é mantida pelo suporte, por SQL, como as demais do I&C. "Editável" nesta versão significa isso.

### Como a IA sinaliza

No caminho legado, a interpretação é do Gemini, que responde com tags. O CORE não usa regex sobre o texto da cliente, apenas lê a tag, como parsing técnico. As tags desconhecidas já são removidas por `cleanReplyText`, então não aparecem para a cliente.

| Tag | Efeito |
|---|---|
| `CRIAR_AGENDAMENTO` com `status=pending_confirmation` | Cria ou atualiza o pedido aberto |
| `ATUALIZAR_PEDIDO` | Atualiza o pedido aberto |
| `CANCELAR_PEDIDO` | Cancela o pedido aberto |

Campos novos: `profissional`, `primeira_vez` e `servicos`, para mais de um serviço. Nenhum campo é obrigatório além dos já exigidos.

Com o modo ligado, antes de gravar o CORE exige cada serviço ativo no catálogo, nome completo, e data e hora concretas e futuras. Se faltar algo, nada é gravado e a IA pergunta o dado. A tag `AGENDAMENTO_CONFIRMADO` e qualquer `status` diferente de `pending_confirmation` são recusados nesse modo.

A duração vem do catálogo, somando os serviços. Se algum não tiver `estimated_hours`, o `ends_at` fica vazio e o card mostra "duração a confirmar".

### Resposta ao registrar o pedido

Quando o pedido é gravado, a resposta usa `received_template`, com nome, serviço, data e hora tirados do registro. É um texto do tenant, como o `ack` do sinal, e evita "confirmado" e data errada nesse turno.

### Contexto da IA

`appointmentState` ignora `pending_confirmation` nas listas `futureConfirmed` e `passed`. O contexto ganha o campo `pedido_pendente`, com serviço, data, hora e versão, lido sem o recorte de sessão.

### Mensagem de confirmação

A mensagem usa `confirmation_template`, não texto livre. Nome, serviço, data e hora vêm do registro, e o dia da semana é calculado no servidor no fuso do tenant.

### Comandos e trava

- O comando valida canal, conversa, versão e horário ainda futuro. A validação do horário fica no servidor, não só no botão.
- O envio segue o padrão do sinal: reivindica o registro, envia, grava o resultado. Se a entrega não for comprovada, o estado fica `uncertain` e o painel pede verificação manual, sem reenvio automático.
- O evento grava `sender_type: 'system'`, `handoff: false` e serviço próprio (`appointment_request_confirmed` ou `appointment_request_rejected`), fora da lista de controle.
- Na entrega incerta, o card pergunta se a mensagem chegou. "Chegou" conclui sem reenviar, e "Não chegou" libera o pedido de novo. Sem isso, o pedido ficaria preso.
- Os comandos não mudam a trava. Se a conversa já estiver com humano, ela continua com humano, e só `resume_ai` devolve à IA.

### Dupla marcação

O I&C não tem profissional modelado, e atendimentos paralelos são normais no salão. Bloquear por sobreposição simples recusaria horários válidos.

Na primeira versão, o comando procura outros agendamentos e pedidos abertos do tenant com sobreposição. Se achar, mostra quais são e exige um segundo clique. Sem `ends_at`, considera 2 horas, o mesmo critério da migração 018. Esse aviso não substitui a agenda por profissional, que continua na fase 2.

### Pedido parado

Não há mensagem automática à cliente, e o follow-up fica cancelado pela regra da 021. Depois de `stale_alert_hours`, o card mostra um alerta. Se o horário passar, o botão **Confirmar** some, e o comando também recusa. A cliente pode voltar a falar, e a IA atualiza o mesmo pedido.

### Kanban

- Pedido aberto vai para `confirmar_agendamento`, mesmo quando a conversa tem evento mais recente.
- Conversa travada vai para **Aguardando humano**. O card mantém o resumo do pedido e os botões, para o pedido não ficar escondido.
- Quadro sem a coluna usa `agendamentos`.

## 4. Mudanças por camada

### Banco (migração 031)

- Índice único parcial: um `pending_confirmation` por `tenant_id`, `channel_type` e `external_conversation_id`.
- RPCs `magia_upsert_appointment_request` e `magia_cancel_appointment_request`, atômicas, com versão e filtro de tenant. A primeira atualiza o pedido aberto mesmo se for de sessão anterior ou com horário vencido.
- RPC `magia_appointment_request_conflicts`, para o aviso de conflito.
- Sem alteração em 018, 019, 021 e 030, nem no gatilho de controle.
- Rollback em `supabase/migrations_pending_review/`.

Altera schema, portanto só entra com aprovação.

### CORE (`n8n/sources/noria_core.js`)

- `detectActions`, `parseAppointmentCreationTag`: novas tags e campos.
- Trecho `14641-14690`: ramo do modo novo, com RPC, `received_template`, `service: 'agendamento_pendente'`, `handoff: false` e estágio "Aguardando confirmação".
- `appointmentState` e `appointmentContext`: separação do pedido pendente.
- Nova leitura do pedido aberto, sem recorte de sessão.
- Validação da configuração do modo.

Gerar com `node scripts/build_noria_workflows.cjs`. Nunca editar os JSONs à mão.

### Comandos (`n8n/code/command_router.js`)

- `confirm_appointment_request` e `reject_appointment_slot`, incluídos na lista de comandos da linha 275. O teste de referência é `scripts/test_confirm_payment_core.cjs`.

### Painel (`app/`)

- `kanbanHelpers.js`: chave e alias `confirmar_agendamento`, sem entrar nas colunas oficiais de todos os clientes.
- `eventsToKanban.js`: destino do pedido e prioridade sobre o evento mais recente.
- `Kanban.jsx`: coluna, card com serviços, data, hora, nome, profissional e primeira vez, botões **Confirmar** e **Sugerir outro horário**, alerta de pedido parado, aviso de conflito e selo **Sinal obrigatório**.
- `appointmentPresentation.js`: rótulo "Aguardando confirmação".
- Consulta própria dos pedidos pendentes.

### Configuração do I&C

Em `clients/ic_saloon/05_confirmacao_agendamento.sql`: cria a coluna, grava `appointment_request` e troca a regra de agendamento do prompt, tudo na mesma transação. Atualizar `clients/ic_saloon/PENDENCIAS.md`, que hoje diz que o dono lança o agendamento manualmente.

## 5. Ordem de execução

Cada etapa de código começa pelo teste que falha.

1. **Estabilizar a base.** Deixar a suíte verde (2 falhas do gate e 11 do frontend), diagnosticar a falha da conversa de final 4639 e definir com a equipe a lista da homologação pendente do merge, que este plano não detalha.
2. **Publicar o CORE mesclado**, depois de revisão e autorização.
3. **Banco.** Migração 031.
4. **CORE.** Modo novo, com prova de que nada muda com ele desligado.
5. **Comandos.** Confirmar e recusar.
6. **Painel.** Coluna, card e botões.
7. **Publicar CORE e painel** com o modo ainda desligado, depois de revisão e autorização.
8. **Ligar no I&C.** Rodar o `05_confirmacao_agendamento.sql` só depois da publicação.
9. **Homologar** pelo roteiro da seção 7, com número de teste, antes de atender clientes reais por esse fluxo.

## 6. Testes obrigatórios

- A IA registra o pedido, usa `received_template` e continua respondendo depois.
- "Ok" e "Oi" depois do pedido recebem resposta, sem `human_lock`.
- O pedido não aparece para a IA como `confirmado`.
- Mudança de data atualiza o mesmo pedido, sem criar outro.
- Cancelamento pela cliente tira o pedido da coluna.
- O cartão continua na coluna depois de nova mensagem da cliente.
- Pedido de sessão anterior ou vencido é atualizado, sem erro de duplicidade.
- Confirmação com versão antiga ou horário vencido é recusada e nada é enviado.
- Dois cliques simultâneos enviam uma única mensagem.
- Falha de entrega fica `uncertain` e não confirma.
- Depois de confirmar, a IA continua ativa.
- Pedido de mudança após confirmar chama a equipe e não altera o agendamento.
- Reclamação com pedido aberto trava a IA, leva o card para **Aguardando humano** e mantém os botões.
- Modelo ausente ou caminho incompatível recusa a configuração.
- Com o modo desligado, Gênesis e Núbia têm o mesmo resultado de antes.
- Nenhuma consulta cruza dados entre tenants.

## 7. Roteiro de homologação

1. Pedir serviço, data e hora e conferir o card na coluna.
2. Mandar "Ok" e receber aviso de que a equipe vai confirmar. Conferir que o card ficou na coluna.
3. Mudar o horário e conferir que o card mudou.
4. Confirmar pelo card e conferir nome, serviço, data, dia da semana e aviso de menores.
5. Fazer uma pergunta depois de confirmar e receber resposta da IA.
6. Pedir mudança depois de confirmar e conferir que a equipe foi chamada.
7. Repetir e usar **Sugerir outro horário**.
8. Repetir, cancelar pela conversa e conferir que o card saiu.
9. Fazer uma reclamação e conferir o travamento e a coluna **Aguardando humano**.

## 8. Riscos e reversão

| Risco | Tratamento |
|---|---|
| A IA diz "confirmado" em texto livre depois do pedido | Risco residual: o caminho legado não tem auditoria. Reduzido pela regra do prompt e por `pedido_pendente`. Confirmar na homologação |
| A IA erra dia da semana em texto livre | `received_template` e `confirmation_template` cobrem os dois momentos críticos. O erro de "quinta-feira, 6 de novembro" nas demais respostas segue como correção separada |
| Cliente fica sem resposta | Pedido não grava `handoff` e usa serviço fora da lista de controle. As funções SQL reais da trava só serão exercidas na homologação |
| Eco da mensagem do comando trava a IA | Não observado em 7 dias de produção. Conferir no passo 5 da homologação |
| Mudança no CORE afeta outros clientes | Modo desligado por padrão, restrito ao caminho legado e com teste de não regressão |
| Aviso de pedido novo não chega | A coluna é a fonte da fila. Não depender de `magia_list_turn_notifications` enquanto o erro 400 estiver aberto |

Para reverter, rodar um SQL que restaura o prompt anterior e remove `appointment_request` na mesma transação. Pedidos abertos continuam visíveis na coluna e são tratados à mão. O rollback da migração só roda depois de não haver nenhum pedido pendente.

## 9. Decisões em aberto

1. **Autorizar a migração 031** e a mudança opcional no CORE.
2. **Cesar:** os textos de `received_template`, `confirmation_template` e `slot_rejected_template`, incluindo o aviso de menores.
3. **Cesar:** o aviso de conflito com segundo clique basta para ligar, ou o bloqueio real por profissional é obrigatório antes. O plano assume o aviso.
4. **Cesar:** cliente com falta anterior exibe o selo e o dono cobra o sinal fora do sistema. O plano assume isso, porque o I&C está com `payment.enabled: false` e não há fluxo para registrar o sinal antes de confirmar.
5. **Cesar:** em quanto tempo um pedido parado deve alertar. O plano assume 4 horas.

## 10. Situação da implementação (06/11/2026)

Feito, sem commit:

- Migração 031 e rollback, com 13 testes em PGlite (`scripts/test_appointment_request.cjs`).
- CORE, com 18 testes de turno completo (`scripts/test_appointment_request_core.cjs`).
- Comandos, com 13 testes (`scripts/test_appointment_request_commands.cjs`).
- Painel, com 14 testes (`app/tests/features/appointmentRequest.test.js`) e build do Vite concluído.
- `clients/ic_saloon/05_confirmacao_agendamento.sql`, que recusa rodar enquanto os textos não forem preenchidos. Os trechos que ele substitui existem no prompt de produção.

Falta:

1. Aprovar os textos com o Cesar.
2. Estabilizar a base: 11 testes do frontend e `scripts/test_confirm_payment_core.cjs` já falhavam antes desta mudança.
3. Aplicar a migração 031, publicar CORE e painel e rodar o SQL do I&C, nessa ordem, depois de revisão.
4. Homologar. Ainda não foram exercidas as funções SQL reais da trava, o card em navegador nem o fluxo real no WhatsApp.


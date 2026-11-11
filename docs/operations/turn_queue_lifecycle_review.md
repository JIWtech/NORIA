# Fila de turnos — proposta para revisão (19/10/2026)

## Recuperação individual autorizada e executada — 19/10, 17:18 BRT

Autorização explícita do usuário limitada ao ticket
6bf8e11d-2781-4cac-bd7b-d711fb2d0da4, conversa c39a495b da Gênesis. Revalidados
review/revisão 4/snapshot atual, um claimed, três pending, origem e cobertura do
encerramento cf70654d-6053-4627-8663-0cfc2d7ad719 e zero reservas incompatíveis no
token ou nos eventos do lote sob outros tokens. Executada UMA chamada à RPC
publicada magia_resolve_turn_review com close_with_evidence, pelo SDK normal e a
sessão real do painel, sem exportar JWT, service_role ou impersonação por SQL.
Leituras auxiliares apenas; nenhuma outra mutação operacional foi executada pelo
agente. A retomada e o envio seguintes ocorreram pelo workflow normal existente.

Evidências verificadas em leitura no banco:

- Ticket: close_with_evidence, revisão 5, resolved_at=17:18:05.593425 BRT,
  resolved_by preenchido. A RPC retornou resolved=true para o ID autorizado.
- Receipt do lote antigo: token cd32d327-ed02-4d55-8d45-5c19b47e0df2,
  outcome=cancelled às 17:18:05.584522, um claimed; evidence.kind=conversation_closed
  e event_id=cf70654d-6053-4627-8663-0cfc2d7ad719. Não foi declarado entregue.
- Pending preservado: três mensagens, MD5 fa89839808e615ba1e0a20cb9fbf9a13
  antes da resolução, no resolution_snapshot do ticket e no claimed do receipt
  seguinte. O processamento normal usou exatamente o mesmo lote, não uma cópia
  reenfileirada manualmente. Os três eventos continuam persistidos.
- Novo receipt: token 12e9ffb9-89e5-4bb2-8012-f180146890ec, outcome=done,
  três claimed, evidence.kind=confirmed_delivery. A mensagem anterior ao fechamento
  permanece histórica, separada das duas atuais pelo filtro de boundary existente.
- Entrega nova: 5b763758-5dfe-410a-a968-6fcab9ad1c14, status=confirmed às
  17:18:21.322775; outbound b0967a95-05c3-4a0e-a335-007f02c1228c. ID do provedor,
  outbound e referência delivery_attempt_id conferem; ai_error vazio.
  Isso confirma o envio ao provedor, não leitura/visualização pelo destinatário.
- Fila na conferência às 17:19:32 BRT: ready, claimed=0, pending=0, token=NULL,
  last_error_code=NULL e boundary_id do encerramento. O esvaziamento corresponde
  ao processamento normal comprovado pelo novo receipt, sem limpeza manual.
- Lead da nova sessão: sales_qualifying, ai_locked=false, revisão 1. Lead da sessão
  anterior continua sales_closed/ai_locked=true; nenhum desbloqueio comercial manual.
- Quatro filas uncertain antigas: checksum original idêntico, nenhuma recuperação.
  Nenhuma ação operacional foi executada sobre outro ticket ou atendimento.

O painel operacional temporário ficou separado do dashboard, com alvo fixado neste
ticket, botão de uma única submissão e validação da revisão antes da chamada. Não
é alteração de política, exceção no CORE ou funcionalidade publicada do frontend.
Após a operação, foi substituído por relatório estático e removido do app local;
fonte, resposta e evidências foram arquivadas como artefatos locais da operação.

### Plano de publicação separado — NÃO autorizado por esta recuperação

O diff estrutural abaixo continua local. A função privada nova não existe em
produção e os corpos publicados não foram alterados nesta recuperação.

1. Revisar o delta incremental: duas RPCs alteradas e adaptador privado; aprovar
   expressamente a permissão estrita para o autor de seu próprio encerramento
   comprovado, sem ampliar os demais poderes de revisão. Checks locais e disputa
   com duas conexões já estão descritos abaixo; não executar bateria extensa.
2. Somente após nova autorização, reconferir os hashes das duas funções de base e
   aplicar exclusivamente o delta em transação, com lock/statement timeout. O delta
   preparado recusa drift inesperado. Não reaplicar a migração v1 inteira.
3. Conferir contratos e REVOKEs: adaptador indisponível a anon/authenticated/
   service_role; leitura do sino não resolve ticket; uncertain e reservas continuam
   exigindo reconciliação. Não precisa publicar n8n, CORE ou EXT: os contratos
   públicos permanecem iguais. Nenhum lote antigo é recuperado por essa publicação.
4. Homologar no próximo encerramento legítimo autorizado, conferindo receipt,
   ticket e pending; não reenviar mensagens de clientes para testar. Em rollback,
   restaurar os dois corpos anteriores, preservando todos os receipts, tickets e
   mensagens; nunca restaurar claimed já concluído nem desfazer envio confirmado.

## Ajuste local pendente: encerramento autenticado com lote em review

Este ajuste estrutural NÃO foi aplicado nem publicado. A investigação a seguir
antecedeu a recuperação individual autorizada, registrada acima. O relato de implantação descreve a versão
anterior; as alterações de integração de encerramento no SQL local aguardam revisão.

Conferência somente leitura: tenant wesley_automoveis, conversa hash c39a495b,
ticket 6bf8e11d-2781-4cac-bd7b-d711fb2d0da4. Na leitura, revision=4 e snapshot
atual; phase=review, last_error_code=lease_expired, retry_batch_id=NULL, um claimed
e três pending. O encerramento cf70654d-6053-4627-8663-0cfc2d7ad719 às
16:54:01 BRT tem origem autenticada, projeção íntegra, tenant/chat corretos e autor
ainda autorizado, inclusive na allowlist de revisão. É o último controle
autenticado encontrado. Nenhuma reserva vinculada ao token OU aos eventos claimed
em outros tokens foi encontrada, nem receipt prévio. Ausência de ledger legado
NÃO prova ausência de envio externo; a autorização de consumo aqui é o encerramento
explícito, não uma afirmação de que houve ou não houve entrega.

Causa demonstrada: claim chamou fail('lease_expired'); o lote anterior ao contrato
v1, sem retry_batch_id, foi corretamente retido como legacy_untracked_batch.
last_error_code guarda o gatilho lease_expired, não essa classificação interna.
claim recusa review antes de recalcular boundary. A RPC de controle anterior
persistia/atestava o encerramento, mas não chamava a resolução técnica. O trigger
comercial fecha/trava somente o lead da sessão anterior. Assim, fechar o atendimento
não fechava o ticket, e os próximos inbounds permaneciam pending. É uma falha geral
de integração; na consulta pontual havia uma fila review com fechamento autenticado
posterior ao claim, correspondente a este caso.

**Recuperação já possível com as RPCs publicadas, somente após autorização:**

1. Usar a sessão real do operador autorizado, nunca service_role, JWT fabricado ou
   impersonação por SQL. Listar magia_list_turn_reviews(p_tenant), filtrar o ticket
   e obter sua revisão atual. O número 4 observado não deve ser fixado no pedido.
2. Reconferir origem/projeção do encerramento, cobertura de TODOS os eventos claimed,
   tenant/chat, token, ausência de referência/reserva de entrega inclusive em outros
   tokens, controles humanos posteriores e snapshot atual. Se houver tentativa ou
   incerteza de envio, interromper para reconciliação, sem reenvio.
3. Após autorização específica, chamar pelo cliente autenticado:

   ```js
   await supabase.rpc('magia_resolve_turn_review', {
     p_tenant: activeTenantId,
     p_ticket: ticket.id,
     p_expected_revision: ticket.revision,
     p_action: 'close_with_evidence',
     p_note: 'Encerramento autenticado cobre o lote anterior; cancelamento sem reenvio.',
   });
   ```

4. A RPC publicada bloqueia fila e ticket, confere revisão/snapshot e reservas,
   exige prova terminal, grava receipt cancelled com o lote e a evidência, encerra
   o ticket e limpa o lote reivindicado dentro dessa transação. Pending não é
   escrito por esse UPDATE: as três mensagens permanecem intactas. Não chama o
   provedor, não confirma entrega e não reenvia o lote antigo.
5. Reconsultar ticket, receipt e fila antes de declarar recuperação. STALE_TURN_REVIEW
   exige nova leitura/revisão; timeout não autoriza repetir cegamente a mutação.
   A retomada normal fará o próximo claim, com token novo e boundary do encerramento.

Datas verificadas de pending: 16:53:08 (ANTES do fechamento), 16:54:15 e 16:54:52
(DEPOIS). As três são preservadas na fila pela resolução, mas não equivalem a três
mensagens atuais. O CORE existente marca a anterior como cancelled_before_close,
conservando o evento histórico, e usa as duas posteriores no contexto atual. Não
se alterou esse filtro nem se promete resposta à mensagem anterior ao encerramento.

O lead sales_closed/ai_locked=true é da boundary antiga. Nenhum lead da boundary
cf70654d-6053-4627-8663-0cfc2d7ad719 existia na leitura. salesLoadLead busca a sessão
exata; se ausente, prepara estado novo com ai_locked=false e etapa inicial obtida
da configuração do tenant, sem copiar a trava/etapa antiga. Portanto, NÃO desbloquear
o lead antigo nem mudar sales_closed. Uma nova atribuição/intervenção humana
autenticada continua impedindo IA na nova sessão.

**Correção estrutural mínima preparada no SQL local:**

- magia_record_turn_control_event mantém assinatura/retorno e atesta primeiro.
  Para conversation_closed chama um adaptador interno na MESMA transação.
- magia_resolve_closed_turn_review é privado, sem EXECUTE para papéis da API.
  Só admite o fechamento do próprio actor autenticado com projeção íntegra. Só
  resolve review com token/lote, sem reserva em toda a trilha de claimed, quando
  a prova terminal é EXATAMENTE aquele encerramento. Obtém a revisão atual sob
  locks e reutiliza magia_resolve_turn_review('close_with_evidence'). Preserva
  pending, uncertain, tentativas desconhecidas e lotes não cobertos pela prova.
- A RPC de revisão mantém os poderes existentes da allowlist. Fora dela, o draft
  autoriza APENAS close_with_evidence de REVIEW por membro ativo autorizado a
  encerrar, cujo próprio evento autenticado comprova conversation_closed. Não
  concede acknowledge, resume_unattempted, finalize_confirmed, nem resolução de
  uncertain ou consumo por outra supressão. Outro operador não pode emprestar a
  prova. Essa ampliação estritamente delimitada exige revisão antes da implantação.
- Repetir o mesmo command_id não duplica evento, receipt ou fechamento comercial;
  um worker com token anterior é recusado. Nenhuma decisão comercial foi movida
  para o banco/CORE. Não se adicionaram contadores, valores de retry ou exceções
  por contato. As políticas técnicas continuam pendentes de aprovação.

Limite intencional: o adaptador não força resolução de processing/sending ativos,
uncertain, entrega reservada ou evidência insuficiente. Um review criado DEPOIS de
um encerramento anterior ainda requer a RPC operacional com revisão atual e provas;
não há liberação automática geral no claim nem no sino. Novos envios permanecem
bloqueados nesses casos até a resolução segura, em vez de ocultar a falha.

Validação pontual em PostgreSQL 17 local: reproduzido o bloqueio com as funções
publicadas (seis corpos comparados por hash); recuperação manual pelo contrato
atual; fechamento atômico proposto por reviewer e pelo autor sem allowlist técnica;
pending íntegro, idempotência, uncertain imutável, reserva sob outro token recusada,
prova sem cobertura recusada, outro actor recusado e helper inacessível diretamente.
Disputa real com duas conexões entre inbound e encerramento preservou ambos os
pending e recusou o token antigo. Função canônica salesLoadLead isolada conferiu
nova sessão sem a trava antiga; nova atribuição autenticada continuou bloqueando IA.
São checks locais com fixtures, sem cliente, Gemini ou Evolution; não comprovam
recuperação deste ticket em produção. CORE, EXT, gerador e JSONs não precisaram
de mudança ou regeneração: a correção é exclusivamente transacional no banco.
O delta incremental compilou sobre os corpos anteriores verificados. O diff dos
dois arquivos alterados passou. O check global continua apontando a linha em branco
preexistente no EOF de app/src/services/media/storageErrors.js:18, fora deste ajuste.

Implantação proposta: após aprovação, criar migração incremental contendo somente
as duas RPCs alteradas, o adaptador privado e seus REVOKEs, em transação; não
reexecutar a migração v1 inteira já aplicada. O contrato do CORE não muda e não
exige publicação de workflow. A recuperação do ticket atual usa a RPC já publicada
e precisa de autorização separada; implantar o draft sozinho não recupera eventos
de fechamento que já aconteceram. Rollback restaura os dois corpos anteriores e
mantém receipts, tickets e mensagens, sem restaurar lotes já encerrados ou reenviar.

Estado: SQL, ingresso autenticado e CORE ativados coordenadamente em produção em
19/10, após homologação concorrente local. O P0 permanece aberto: confirmação do
encerramento do incidente, validações operacionais e resolução individual dos
lotes retidos ainda não estão concluídas. Não publicar um componente isolado.
Os checks pontuais de concorrência passaram em PostgreSQL 17 isolado em 19/10.
Nenhuma recuperação das quatro filas antigas é executada por este trabalho.

## Incidente de implantação parcial — 19/10, 15:46 BRT

Consulta somente leitura confirmou o inbound de João Victor às 15:46 em buffer,
reivindicado em processing, sem delivery vinculado naquele momento. Não houve
encerramento confirmado para essa tentativa. O banco consultado não contém
magia_record_turn_control_event, magia_fail_turn, next_attempt_at ou o marcador
noria_turn_lifecycle_v1 no claim. O código local já exigia esses recursos.
O n8n apresentou erro 400 em Ler Fila WhatsApp (execução 389225), cujo código
consulta next_attempt_at. O roteador usa a RPC de origem ausente para encerrar:
o erro 404 é compatível com essa incompatibilidade, não com entrega confirmada.
Não foi capturado o request/response do comando original nem vinculado o runData
exato do Olá; não inferir um erro do Gemini ou bloqueio humano desse estado.

Correção local: magia_turn_lifecycle_status() é uma RPC STABLE, somente leitura,
acessível apenas ao service_role. Retorna contract=noria_turn_lifecycle_v1,
ready e missing (lista limitada de dependências técnicas). Verifica assinaturas,
EXECUTE, marcadores de versão, tabelas e colunas da implantação. Não lê mensagens,
não bloqueia linhas e não altera fila/tickets. Não certifica configuração de
origens, política aprovada ou segurança de concorrência. Ausente ou ready=false
impede claim no dispatch Gênesis e no CORE genérico, ANTES de obter token; a
retomada também verifica antes de consultar colunas novas. Sem fallback legado.
A validação do contrato retornado pelo claim continua obrigatória. Alterações
concorrentes de schema exigem pausa/drenagem; o preflight não substitui o cutover.

O roteador mantém o JWT do operador e a RPC transacional de origem; não volta à
inserção direta de encerramento. RPC ausente retorna TURN_CONTROL_RPC_UNAVAILABLE;
o painel explica a implantação incompleta e só fecha o modal/atualiza o estado
após ok=true e evento conversation_closed persistido com ID. Erros de autenticação
e demais falhas permanecem erros, sem encerramento local fictício.
O manifesto sinaliza a dependência da migração e production_approved=false.

O ajuste de código sozinho não destrava mensagens já reivindicadas nem instala
funções no banco. A implantação coordenada posterior está registrada abaixo;
nunca usar a remoção do 404 como justificativa para dispensar as provas de origem.

Verificação pontual deste ajuste: sintaxe de fontes e JSX; RPC ausente/incompatível
impede POST de claim no CORE e no nó de dispatch gerado; preflight impede consulta
de retomada incompatível; RPC de controle ausente não cai em inserção direta;
ok sem evento de encerramento não fecha atendimento; fontes/JSONs conferidos,
EXT e demais nós/gates/conexões iguais ao snapshot anterior. A nova função SQL
foi compilada em PGlite serial: detecta RPC antiga/ausente e coluna ausente,
permite service_role, recusa authenticated e não altera a fila. Não equivale à
validação integral da migração nem à concorrência real. Auditoria anti-hardcode
passou. A indisponibilidade inicial do daemon foi superada iniciando o Docker;
a homologação real e seus limites estão registrados a seguir. Nenhum
envio foi realizado pelo agente. A implantação posterior está registrada abaixo.

### Homologação pontual com duas conexões PostgreSQL reais

PostgreSQL 17.11 oficial em container local isolado, sem rede nem portas expostas.
Reproduzidos nomes/tipos/defaults e constraints PK/UNIQUE/CHECK das tabelas-base
consultadas em produção, sem copiar mensagens ou contatos. auth.uid() foi emulado
por claim de sessão; papéis PostgreSQL reais, não verificação de JWT Supabase real.
A migração completa compilou e foi reaplicada, preservando integralmente todas as
linhas de fila do fixture. O preflight passou com o papel service_role, preservando
a RPC de controle restrita a authenticated; não se concedeu essa RPC ao CORE.

Disputas com sessões físicas distintas e lock concorrente:

- Dois begin: exatamente uma reserva autorizou envio; o segundo foi recusado.
- Controle humano versus finish: cancelamento só consumiu com origem persistida,
  produzindo receipt; sem envio externo.
- Confirmação versus resolução: confirmação e finalização serializaram na fila;
  um único delivery, finalização explícita sem reenvio.
- Novo inbound versus revisão antiga: resolução aguardou lock e foi recusada por
  STALE_TURN_REVIEW; lote permaneceu retido.
- Dois consumidores de alertas: apenas um recebeu o ticket/revisão; lease expirado
  foi retomado com token novo após desconexão; tenant distinto recusado.

Claim de uncertain preservou o registro completo. São checks pontuais das disputas
indicadas, não cobertura de todas as ordens de concorrência/integrações em produção.
Não executam agendamento, envio, recuperação histórica nem chamada ao Gemini.

Autorização do usuário recebida para implantar somente APÓS homologação. O usuário
forneceu o EasyPanel e definiu a central do painel como destino dos alertas.
Não é necessário provisionar consumidor ou receptor externo nesta implantação:
tickets persistidos e polling autenticado da central retomam após desconexão.
production_approved=false permanece até a verificação operacional completa.
Nenhuma fila antiga ou lote do incidente foi recuperado pelo agente.

### Implantação coordenada iniciada em 19/10

- Criados dois serviços isolados de ingresso no EasyPanel, um por tenant, e duas
  identidades Auth técnicas sem membership de operador. Login real e recusas de
  origem, instância e tenant indevidos conferidos com JWTs Supabase reais.
- Evolution 2.3.7 recebeu, por instância, destino HTTPS do ingresso e Bearer privado,
  preservando eventos e demais opções do webhook. Não houve atualização da Evolution
  nem envio de mensagem pelo agente. O adaptador autentica o Bearer antes de assinar
  os bytes originais; não pressupõe HMAC nativo do provedor.
- A identidade técnica renova sua sessão apenas no ingresso. Senha da identidade,
  segredo de assinatura e segredo do provedor não são encaminhados ao CORE.
  O CORE recebe somente um segredo distinto de encaminhamento por tenant; o
  normalizador confere também a resolução do tenant pelo cadastro de canais.
- Exportação real do CORE coincidiu com o snapshot inicial. A atualização mantém
  os 68 IDs/posições, configurações e conexões; somente os sete nós previstos têm
  código diferente. A importação inicial duplicou nós no rascunho e foi desfeita;
  esse rascunho não foi publicado. Exportação posterior conferiu 68 nós e o código
  preparado, considerando apenas normalização de CRLF pelo editor.
- Preflight publicado antes do SQL; zero leases ativos e zero filas sending foram
  conferidos antes da migração transacional. SQL aplicado com sucesso; readiness
  em produção retornou ready=true e missing=[]. As duas fontes foram habilitadas;
  somente os owners já ativos dos respectivos tenants receberam acesso aos tickets.
- Checksum das colunas originais das quatro filas uncertain antes/depois foi
  idêntico: 68ff50e866c3e205242a124fa2488949. Nenhuma resolução ou recuperação foi
  executada. Novos tickets não equivalem a recuperação de mensagens.
- Ambiente completo do n8n preservado e conferido após salvar; acrescentados somente
  os dois segredos de encaminhamento, também no executor externo. Serviços
  reiniciados; healthz do n8n retornou 200. Sondas connection.update sem mensagem
  passaram por ambos os ingressos e pelo n8n, sem envio ao WhatsApp.
- RPC de readiness conferida pela API REST com o service_role real do runtime:
  ready=true/missing=[]. RPC de controle disponível pela REST; o principal de
  ingresso foi corretamente recusado como operador, sem criar evento.
- Ingressos reais foram atestados após a troca do webhook. Uma nova entrega da
  operação normal foi confirmada no ledger com outbound e ID do provedor iguais.
  Não foi uma mensagem de teste enviada pelo agente, nem prova de correção de todas
  as respostas comerciais. Execuções recentes 390651/390652/390655/390656/390659/390660
  exibiram sucesso; a versão observada foi b1d80e02-0fa7-4a28-8b78-93a4b7e695c2.
- Dez lotes com leases antigos passaram à revisão técnica (lease_expired), sem
  reenvio. As quatro uncertain permanecem retidas. O painel autenticado já listou
  os quatro avisos antigos e depois atualizou o contador com as novas retenções.
  Nenhuma leitura pessoal ou resolução operacional foi executada pelo agente.

Pendências operacionais: o encerramento específico de João Victor NÃO foi
confirmado no banco durante esta sessão; o painel mudou para outra conversa durante
a conferência, e nenhuma ação final foi forçada sobre a nova seleção. A correção
de contrato está ativa, mas a confirmação real desse encerramento continua
necessária. Resolver seu lote retido é uma ação técnica distinta de fechar o modal
ou ler um aviso; não se promete resposta automática enquanto a fila estiver review.
Núbia teve sonda técnica, mas não se comprovou nova entrega real nesse tenant.
Os ingressos observados não trouxeram flags owner_saved/business_account explícitas;
não são convertidas em false nem inferidas de contatos cadastrados. Supressões por
configuração/lista de exclusão e bloqueios humanos continuam independentes dessas
flags. A homologação positiva de flags explícitas do provedor permanece pendente.

Controles humanos anteriores ao ledger não são promovidos a prova de consumo.
Quando o último controle representa posse humana/handoff sem origem verificável,
e não há outra supressão independente válida, suppression_status recusa com
TURN_CONTROL_ORIGIN_REQUIRED. O tratamento técnico retém o lote para revisão,
em vez de permitir resposta da IA ou finish sem evidência. Um novo encerramento
autenticado substitui esse controle na ordem normal. A RPC grava created_at com
clock_timestamp() após obter o lock da fila, evitando inversão temporal por espera
de transação. Ambos os caminhos foram conferidos em PostgreSQL local, com rollback.
Não há atestação em massa de eventos antigos nem liberação automática de uncertain.

## Evidência e escopo

O snapshot somente leitura de 18/10 está em
supabase/migrations_pending_review/reference/turn_queue_production_20261018.md.
Confirmou descarte de claimed em uncertain com inbound novo e retomada de
processing sem orçamento. As RPCs de delivery existem em produção; faltavam no
histórico local. O snapshot NÃO é rollback seguro. A revisão inicial não fez nova
consulta de produção: quatro filas uncertain antigas, uma mensagem por fila,
sem current_delivery_id, eram a observação anterior, não prova de ausência de envio.

Fontes: SQL draft existente, n8n/sources/noria_core.js, gerador existente e o
helper insertEvent de n8n/code/command_router.js. A integração mínima preparada
está em scripts/turn_queue_operational_bridge.cjs. A EXT não foi alterada.

## Inventário de todas as finalizações sem envio

| Caminho real | Prova exigida pelo banco / comportamento |
| --- | --- |
| Exclusão inicial ou antes de enviar | tenant_settings habilita exclusão e há registro correspondente em tenant_ai_excluded_contacts. Alias LID só vem do ingresso atestado. Falha de lookup, lista vazia ou identidade não resolvida são erro técnico: retêm o lote, não são supressão. |
| Número comercial (runTurn, prepare e guarda salesCanSend) | Conta comercial explicitamente declarada por ingresso autenticado ou autorização de operador para o token/lote. Categoria copiada pelo CORE, metadata sem origem, nome e formato de telefone não autorizam consumo. |
| Contato salvo (mesmos três pontos) | Flag booleana do provedor em ingresso atestado por principal separado, ligado a tenant/instância/JID/ID da mensagem; ou decisão autenticada do operador. isMyContact em input/raw_payload sozinho é ignorado. |
| IA desativada em prepare / bloqueio de envio | settings.ai_enabled=false persistido explicitamente. Configuração ausente não equivale a desativação legítima. |
| Lead bloqueado em prepare / finalize silencioso | Lead da mesma sessão, ai_locked e etapa existente cuja configuração do backend não permite IA. Inclui pós-venda/handoff quando realmente persistidos. Não interpreta intenções ou critérios comerciais no SQL. |
| Controle humano prévio, intervenção durante envio e cancelamento após commit recusado | Origem autenticada do evento humano/atribuição/encerramento; último controle respeita resume/reset. Cancelled requer mudança após claim ou encerramento que cubra todos os inbounds. |
| Etapa movida pelo operador / SALES_CONTROL_CHANGED ou STALE_SALES_* | Evento sales_operator emitido pela RPC autenticada, actor registrado e origem capturada pelo trigger; lead/configuração atuais também podem comprovar bloqueio. Uma exceção de revisão isolada não é prova de cancelamento. |
| Confirmação de sinal por operador (Núbia) | Evento autenticado + appointment do tenant/chat confirmado, signal_confirmation_state=sent e confirmation_message_id correspondente. Não altera o contrato de agendamento. |
| Handoff comunicado anteriormente | Outbound handoff da mesma sessão com delivery attempt confirmado e ID do provedor correspondente; flag handoff isolada não basta. Retomada posterior invalida controle antigo. |
| attendance_changed / closed_before_processing | Encerramento autenticado persistido, fronteira e timestamps dos inbounds originais conferidos pelo SQL. |
| Bot externo/template, high_confidence_non_customer | Os classificadores existentes são somente candidatos. Sem autorização independente non_customer para o token/lote, NÃO finalizam: seguem pelo CORE → EXT → CORE normal, sem review por mero palpite. |
| sales_silent_ack | Regex local/priorDisposition não comprovam intenção. Só finaliza com autorização independente silent_ack; caso contrário segue o fluxo normal, sem copiar regras da EXT para SQL. |
| Finalize sem visibleReply, inclusive afterSales | Exige lead/configuração bloqueados, controle/handoff comprovados ou outra supressão válida acima. Flag afterSales/silent sozinha não prova finalização. Ausência de reply sem autoridade é defeito técnico rastreável, não sucesso. |
| sendChannelMessage retorna cancelled | Revalidação de fronteira/controle/supressão precisa encontrar a mesma autoridade persistida. Cancelamento de transporte sozinho não descarta claimed. |
| Envio aceito mas persistência/confirm falha | Nunca é finalização sem envio: uncertain, sem retry/reenvio. |
| Entrega confirmada e falha posterior | Apenas finish(done) com ledger/outbound; nunca reenviar. |

Todos os caminhos done/cancelled passam pelo mesmo finish. Receipt imutável
registra o lote e sua prova no commit que limpa claimed. Caso o banco retenha o
lote, complete rejeita o resultado como sucesso. Pending é preservado.

## Origem independente, sem autodeclaração do CORE

magia_turn_suppression_status é consultada na entrada de cada fase e na guarda
de envio de vendas. O CORE sobrescreve cópias recebidas via input/EXT e usa apenas
as evidências retornadas. Finish reconfere no banco, sob lock; o cache local não
é autorização final. Nenhuma regra comercial ou tenant slug entra no SQL.
O bloqueio humano efetivo também usa essa autoridade: flags de histórico do CORE
não substituem origem de controle ou handoff confirmado. As guardas de envio
reconsultam as provas e reconhecem supressões que chegaram durante o turno.

O bridge em modo ingress verifica HMAC-SHA256 dos bytes originais, instância e
identidade do principal. Um adaptador confiável do provedor/proxy precisa assinar
X-Noria-Signature: sha256=<hex>; NÃO se presume assinatura nativa da Evolution.
O assinador deve autenticar a origem real antes de assinar; não pode assinar
qualquer requisição pública. A credencial do assinador e o JWT do ingresso NÃO
podem ser disponibilizados ao CORE.

A RPC magia_attest_turn_ingress só aceita usuário autenticado cadastrado em
conversation_turn_ingress_sources, habilitado para tenant/instância. O service_role
do CORE não pode executá-la ou escrever nas tabelas de origem. Flags estritas
são extraídas pelo SQL do envelope; IDs/digest conflitantes são rejeitados.
O bridge grava a atestação antes de encaminhar o envelope intacto ao webhook;
perda de resposta repete os mesmos IDs, preservando a deduplicação do enqueue.
Mensagens fromMe=true também são atestadas. O trigger pode reconhecer controle
externo da própria conta apenas com essa origem, sender_type=human e ausência
de tentativa de delivery ativa/incerta ou ID de assistente correspondente.
Um echo da própria resposta não vira prova de humano. Fatos de contato usados
para supressão vêm somente de mensagens inbound. Eventos sem chave de mensagem
são encaminhados assinados sem fabricar fatos. Homologar envelopes e flags.

Para ações de controle, magia_record_turn_control_event recebe o JWT real do
operador, valida tenant_members e grava evento + origem atomicamente. A função
insertEvent do roteador foi adaptada somente para esses registros WhatsApp.
A inserção autenticada direta de sales_move também captura origem por trigger.
Campos protegidos são comparados à projeção imutável; ai_provider e actor em
raw_payload não são prova sozinhos. Eventos históricos não ganham origem por
backfill de flags: magia_attest_turn_control_event permite confirmação individual
por operador autorizado, sem alterar fila/mensagem. Sem recuperação automática.

magia_authorize_turn_suppression permite decisão explícita de operador cadastrado
para token, lote exato, tipo técnico e nota, sem tentativa de entrega. Não há
seed, autorização automática de heurísticas ou política comercial embutida.

## Retry durável e resolução

Claim nunca limpa uncertain/review, mesmo com novo inbound. Contador e retry_batch_id
persistem entre tokens e mensagens novas. Política fica congelada no lote;
backoff é exponencial limitado pelo teto configurado. Sem política, a primeira
execução normal é permitida e uma falha exige revisão. Crashes após claim contam;
erros anteriores a receber token ainda precisam da rota de erro/monitoramento n8n.

Fail decide a fase real sob lock. Sending v1 sem reserva em toda a trilha do token
pode voltar a ready com orçamento/backoff; begin é permissão única e verifica
fencing/lease. Uma reserva existente torna o caso uncertain, inclusive timeout de
begin antes de sendAttempted=true. Aceite do provedor não é recibo de aparelho.

Tickets preservam snapshot inicial e atual; chegada de mensagem nova incrementa
revision. Resolver bloqueia fila antes do ticket e confere snapshot/token/revision.
Operador autenticado por tenant pode reconhecer alerta, finalizar entrega realmente
confirmada, encerrar com evidência ou retomar apenas REVIEW v1 comprovadamente sem
reserva. Retomada registra explicitamente o novo orçamento e troca token/lote.
Não há ação de reenvio para UNCERTAIN nem lotes legados; nota livre não é prova.
Backfill cria somente tickets: não modifica as quatro filas antigas.

## Integração operacional mínima preparada

Modo consumer do bridge usa principal autenticado cadastrado em
conversation_turn_review_consumers para UM tenant por processo. Não usar credencial
de resolução/operação nem service_role. O consumidor não chama claim/finish/resolver
de turnos. O SQL reserva um alerta por lease com SKIP LOCKED; nenhum estado de
checkpoint depende de memória ou disco do processo.

NOTIFY é uma dica; polling durável consulta notification_pending e notified_revision.
Checkpoint avança apenas após recibo do receptor e ack com tenant/ticket/revision/
lease corretos. Desconexão antes do envio ou antes do ack deixa trabalho retomável
após expiração do lease. Nova revisão invalida lease/ack antigos. Reconhecimento
humano e confirmação de entrega do alerta são estados separados.

O receptor aprovado precisa persistir Idempotency-Key=tenant:ticket:revision de
forma idempotente e retornar JSON {accepted:true,idempotency_key:<mesma chave>}
somente depois da gravação durável. Uma resposta perdida pode repetir o POST com
a mesma chave: não se promete exactly-once sem esse contrato do receptor.
O payload contém somente IDs, fase, revisão e data; sem JID, mensagem ou nota.
Nenhum destino foi escolhido, nenhum alerta real foi enviado e nenhum consumidor
foi iniciado nesta revisão. O receptor/notificador do canal real exige configuração
aprovada e homologação; não inventar endpoint, destinatário ou canal.

Configuração comum, sem valores de produção: NORIA_TENANT_ID, NORIA_SUPABASE_URL,
NORIA_SUPABASE_PUBLISHABLE_KEY e NORIA_BRIDGE_HTTP_TIMEOUT_MS. Modo ingress requer
NORIA_INGRESS_ACCESS_TOKEN, NORIA_INGRESS_SOURCE_ID, NORIA_INGRESS_INSTANCE,
NORIA_INGRESS_SIGNING_SECRET, NORIA_INGRESS_FORWARD_URL, NORIA_INGRESS_FORWARD_TOKEN,
NORIA_INGRESS_PORT e NORIA_INGRESS_MAX_BYTES. Modo consumer requer
NORIA_ALERT_ACCESS_TOKEN, NORIA_REVIEW_ALERT_URL, NORIA_REVIEW_ALERT_TOKEN,
NORIA_REVIEW_POLL_MS e NORIA_REVIEW_LEASE_SECONDS. JWTs são autenticados pelo
Supabase; a checagem local de claims não substitui validação de assinatura.
Configurar renovação segura das credenciais via supervisor; falha de autenticação
encerra o consumer com erro, sem ack. Falha temporária deixa o lease expirar.

Comandos preparados (NÃO executados contra serviços):

- node scripts/turn_queue_operational_bridge.cjs ingress --check-config
- node scripts/turn_queue_operational_bridge.cjs consumer --check-config
- node scripts/turn_queue_operational_bridge.cjs consumer --once
- node scripts/turn_queue_operational_bridge.cjs consumer
- node scripts/turn_queue_operational_bridge.cjs ingress

Somente --check-config é sem rede. Os demais são para implantação explicitamente
autorizada. O servidor ingress escuta apenas loopback; requer proxy/TLS/autenticação
na borda. Proteger o webhook n8n contra bypass do bridge. Nenhuma configuração de
webhook/credencial foi alterada localmente ou em produção.

## Políticas técnicas independentes, ainda sem aprovação

| Tenant | max_attempts | base_backoff_seconds | max_backoff_seconds | Aprovação necessária |
| --- | --- | --- | --- | --- |
| Gênesis / wesley_automoveis | Pendente | Pendente | Pendente | Latência/custo, contratos do catálogo e persistências idempotentes. |
| Núbia / clinica_nubia_oficial | Pendente | Pendente | Pendente | Latência/custo e idempotência dos agendamentos antes de retries. |

Linhas independentes por tenant_id; nenhuma é inserida pelo draft. Nenhum
percentual, documento, critério comercial ou valor arbitrário de retry foi
instalado. As mesmas classes técnicas recuperáveis se aplicam somente antes de
qualquer reserva de envio e dentro do orçamento aprovado. Políticas/configurações
novas não liberam review/uncertain automaticamente.

## Contratos e artefatos

Claim/commit/begin/confirm/finish/fail conservam seus nomes e parâmetros. Contract
noria_turn_lifecycle_v1 continua obrigatório. A nova consulta tem nome exato
magia_turn_suppression_status(p_tenant,p_chat,p_token), NÃO o sufixo gerado por
queueRpc. Retorna evidence calculada pelo banco; nenhuma evidence enviada pelo CORE
é parâmetro de finish. Done/cancelled exigem outcome solicitado; retry exige
retry_queued=true; begin exige dispatch_allowed=true antes do HTTP.

Alertas: magia_claim_turn_alerts(p_tenant,p_limit,p_lease_seconds) e
magia_ack_turn_alert(p_tenant,p_ticket,p_revision,p_lease) usam noria_turn_alert_v1.
Não alteram fila ou autorizam resolução. Origem: magia_attest_turn_ingress,
magia_record_turn_control_event e magia_attest_turn_control_event só recebem
identidade pelo JWT, nunca por um campo actor fornecido pelo CORE.

Regerar com node scripts/build_noria_workflows.cjs. Os três nós CORE incorporam o
fonte canônico. O helper insertEvent do roteador é projetado isoladamente no nó
Executar Comando1: o restante da versão embutida difere do arquivo local e foi
preservado. O manifesto registra o hash da projeção parcial do roteador.
Preservados EXT, CORE → EXT por turno → prepare → EXT comercial → finalize, ambos
os gates, identidade, sessão, token e contratos de negócio.

## Validação e parecer de implantação

Verificações permitidas: sintaxe, contratos, transições afetadas em banco local
descartável, bridge com HTTP simulado e diff. Sem arquivos de teste novos ou bateria
extensa. A revisão inicial não acessou Supabase/n8n/Evolution; a conferência do
incidente de 19/10 acima acessou Supabase e n8n somente em leitura.
Executadas localmente: rejeição de flags sem origem; aceitação de ingresso,
configuração, lead bloqueado e controle autenticados; isolamento de autorizações;
lease/checkpoint de alertas com repetição e ack antigo recusado; tenant distinto
recusado; echo de assistente não atestado como humano; uncertain legado preservado
na reaplicação. Bridge conferido com HTTP simulado: assinatura inválida não faz
rede, atestação antecede forward e recibo perdido não gera ack. Fonte/JSON,
helper projetado, gates/conexões e EXT foram comparados ao snapshot local anterior.
Na revisão inicial, Docker estava sem daemon e PostgreSQL local não foi encontrado.
O daemon foi iniciado em 19/10 e os checks concorrentes acima passaram em container.

Concorrência: cinco cenários da fila, ordem temporal do controle aguardando lock e
snapshot da leitura global foram conferidos com PostgreSQL 17 e duas conexões
reais. JWTs Supabase e origem do ingresso foram conferidos em produção nos limites
descritos acima. O destino operacional escolhido é a central persistente do painel;
consumidor externo não é requisito desta ativação. Permanecem políticas técnicas
por tenant e homologações operacionais positivas pendentes. PGlite serial não foi
usado como substituto dessas verificações concorrentes.

Procedimento para próximas implantações: pausar claims e drenar ou fencear execuções antigas;
reconferir schema/RPCs, aplicar SQL aprovado em transação, provisionar identidades e
fontes sem backfill cego, publicar workflow/adapter correspondente, verificar
contratos e reativar. Não publicar só CORE, só RPCs ou só bridge.
Rollback seguro preserva schema/receipts/tickets/claimed, pausa consumidores e usa
correção incremental. Nunca restaurar o claim inseguro do snapshot ou resetar
uncertain para ready. Resolver os casos legados individualmente somente com prova
de envio/ausência de envio, validade atual da demanda e autorização específica.

Parecer: implantação executada com as verificações e limitações registradas acima;
não constitui encerramento do P0. Não liberar lotes retidos por mera leitura do aviso.

## Central de notificações do painel (backend ativado; painel local conferido)

O sino fica no AppTopbar, junto de atualizar/sair, sem nova página. O componente
NotificationCenter e seu hook mantêm o polling fora do estado do App: atualizar
avisos não substitui conversas nem remonta seus players. Dropdown com Escape,
clique fora, foco no fechamento, identificação acessível, paginação e rolagem
limitada ao popover. Nomes só vêm de conversas já autorizadas e com nome confiável;
sem correspondência exata de canal/JID, o operador consulta os detalhes do ticket.

O draft acrescenta leitura pessoal sobre os MESMOS tickets, sem duplicá-los:

- conversation_turn_notification_reads: tenant_id/user_id/ticket_id/read_revision.
  RLS habilitada, sem acesso direto dos papéis de API. Nenhum service_role no browser.
- magia_list_turn_notifications(p_tenant,p_limit=30,p_before_created_at=null,
  p_before_id=null): JWT + conversation_turn_review_operators. Contrato
  noria_turn_inbox_v1 com página, unread_count global (incluindo encerrados),
  has_more e as_of. SEM read_items ou qualquer lista global de IDs. A página
  contém no máximo p_limit registros (1..100); o banco examina p_limit+1 para
  has_more. unread_count é agregado no PostgreSQL no mesmo snapshot da página.
  Cursor por created_at DESC/id DESC imutáveis evita pular tickets durante paginação.
  A projeção contém estado, código técnico e datas; exclui claimed/pending,
  corpos de mensagens, evidências, tokens, leases e notas de operadores.
- magia_read_turn_notifications(p_tenant,p_items): mesmo JWT/allowlist;
  aceita até 100 pares id/revision observados; o sino envia um para leitura individual.
  Locks somente nos tickets, em ordem de ID; leitura monotônica por usuário,
  sem chamar magia_resolve_turn_review e sem escrever fila, entrega ou ticket.
  Uma revisão antiga não lê uma nova. Retorna contract, tenant_id, read=true,
  count (leituras efetivamente inseridas/avançadas) e unread_count pós-escrita.
- magia_read_all_turn_notifications(p_tenant): JWT auth.uid() e mesma allowlist.
  Sem IDs no request/response. INSERT ... SELECT transacional captura somente
  revisões visíveis em UM snapshot MVCC; faz upsert monotônico na tabela de
  leitura pessoal, em ordem de ID. Não há UPDATE nem lock explícito nos tickets.
  Revisões e tickets que se tornarem visíveis após o snapshot não são lidos,
  inclusive se a escrita esperar por outro leitor. Uma segunda consulta calcula
  unread_count após a escrita. Retorno igual ao da leitura individual, sem IDs.
  Repetição sem revisões novas retorna count=0; read_at não é reescrito sem avanço.
  Uma nova chamada explícita captura um novo snapshot, não reenvia mensagens.
  Princípio de isolamento: https://www.postgresql.org/docs/17/transaction-iso.html.
- inbox_revision é independente da revisão operacional: somente mudança real do
  snapshot, reconhecimento ou resolução gera aviso novo. Leases/checkpoints do
  bridge e leitura de outro operador não mudam esse contador. Encerramento aparece
  como "Incidente encerrado", sem inferir entrega ao destinatário ou recuperação.

O frontend consulta a cada 30 segundos enquanto visível e ao recuperar foco,
conexão ou visibilidade. Retém/refaz somente a página atual de 30 registros,
uma RPC por atualização, sem loop para recarregar páginas anteriores. "Ver anteriores"
avança o cursor e substitui a página; "Voltar às recentes" consulta a primeira.
Polling em página antiga atualiza suas revisões e o contador global. Tickets novos
aparecem na primeira página; não se acumulam no navegador.
Mantém contador anterior durante atualização. Após confirmação de leitura, aplica
imediatamente unread_count retornado e leitura dos itens observados; em seguida
reconsulta só a página atual para mostrar eventuais revisões novas ainda não lidas.
Pedidos são serializados; não há sucesso otimista antes do recibo do servidor.
Erro mantém dados anteriores explicitamente desatualizados;
negação de permissão remove os dados. Mudança de tenant/usuário desmonta o escopo,
aborta requests e limpa o contador anterior. Timeout não simula leitura bem-sucedida.
Nenhum localStorage é autoridade de leitura. Outra aba converge no próximo polling.

Dependências atendidas em 19/10: migração coordenada, schema da API e owners ativos
provisionados por tenant; listagem real conferida no painel autenticado. Função ausente
mostra "aguarda a implantação do backend"; falta de permissão mostra mensagem
própria. Não há fallback para dados simulados ou consultas privilegiadas. O bridge
continua independente; leitura pessoal não muda notification_pending,
notified_revision, reconhecimento operacional ou resolução. Nenhuma ação perigosa
de resolução/envio foi disponibilizada no sino. Nenhuma fila antiga é recuperada.

Checagens locais deste recurso: build Vite e SQL adicional em PGlite descartável
(sintaxe/reexecução, dois usuários, tenant negado, revisão obsoleta, checkpoint que
não reabre aviso, encerramento visível e leitura direta recusada). Paginação e
leitura em lote conferidas. No navegador, prévia isolada do componente real sem
sessão e sem incidentes simulados: foco, abertura, Escape e clique fora conferidos.
A aplicação completa exige login; JWT/RPCs implantados e áudio durante incidentes
reais não foram exercitados. Essas checagens não equivalem
à homologação com Supabase/JWT reais ou concorrência PostgreSQL de duas conexões.
No ajuste de escalabilidade: build passou; SQL adicional em PGlite descartável
conferiu páginas com empate de data, ausência de IDs globais, idempotência das duas
leituras, revisão obsoleta, dois usuários, tenant negado e acesso direto/anon negado.
Um trigger temporário exclusivamente no banco descartável criou revisão e ticket
novos durante o INSERT de leitura global: ambos ficaram não lidos no recibo.
Esse primeiro check serial não é prova de concorrência entre conexões. O cenário
seguinte foi posteriormente conferido em PostgreSQL 17 real com duas conexões:
conexão A mantém um upsert de leitura aberto; B inicia leitura global e espera;
A publica uma revisão/ticket e confirma; B deve gravar apenas as revisões do seu
snapshot, devolver os novos como não lidos e preservar leituras de outro usuário.
Duas leituras globais simultâneas também passaram: somente uma avançou as revisões,
e ambas retornaram zero não lidas ao final. Leitura individual versus global e
validação positiva de leitura por dois operadores reais seguem como homologação
operacional; não se marcou aviso real como lido para testar a implantação.
Timeouts não repetem automaticamente a mutação: o polling apenas reconsulta dados.
As duas RPCs existentes mantêm nomes/parâmetros e o discriminador noria_turn_inbox_v1;
a listagem remove read_items e os recibos de leitura ganham tenant_id/unread_count.
Cliente e draft SQL devem ser implantados coordenadamente. Backend antigo sem a
nova RPC ou sem os campos do recibo falha explicitamente; não há fallback em massa
buscando IDs. CORE, EXT, workflows e bridge não são alterados nesta revisão.
Rollback do frontend pode remover o sino preservando tickets e leituras; não
restaurar RPCs inseguras nem apagar recibos, leituras ou lotes durante rollback.
